from __future__ import annotations

import asyncio
import contextlib
import inspect
import io
import json
import re
import time
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

import httpx
from sqlalchemy import create_engine, text
from sqlalchemy.ext.asyncio import create_async_engine

from onestep_web.compiler import PipelineCompiler
from onestep_web.credentials import interpolate_env_vars
from onestep_web.schemas import DebugResult, GraphNode


@dataclass(frozen=True)
class DebugCredential:
    connector_type: str
    config: dict[str, Any]
    env_vars: dict[str, str]


class PipelineDebugger:
    def __init__(self, compiler: PipelineCompiler | None = None) -> None:
        self.compiler = compiler or PipelineCompiler()

    async def test_connection(
        self,
        node: GraphNode,
        credentials: dict[str, DebugCredential],
    ) -> DebugResult:
        started = time.perf_counter()
        try:
            if node.type.startswith("mysql_"):
                await self._test_mysql(node, credentials)
                return _result("ok", "connection succeeded", started=started)
            if node.type.startswith("postgres_"):
                await self._test_postgres(node, credentials)
                return _result("ok", "connection succeeded", started=started)
            if node.type.startswith("rabbitmq_"):
                await self._test_rabbitmq(node, credentials)
                return _result("ok", "connection succeeded", started=started)
            if node.type.startswith("redis_"):
                await self._test_redis(node, credentials)
                return _result("ok", "connection succeeded", started=started)
            if node.type.startswith("sqs_"):
                await self._test_sqs(node, credentials)
                return _result("ok", "connection succeeded", started=started)
            if node.type == "http_sink":
                await self._test_http(node)
                return _result("ok", "endpoint is reachable", started=started)
            if node.type == "webhook_source":
                self._validate_webhook(node)
                return _result("ok", "webhook configuration is valid", started=started)
            if node.type.startswith("feishu_bitable_"):
                await self._test_feishu(node, credentials)
                return _result("ok", "Feishu credentials are valid", started=started)
            if node.type in {"cron_source", "interval_source"}:
                return _result("ok", "source does not require an external connection", started=started)
            return _result(
                "unsupported",
                f"{node.type} connection testing is not implemented yet",
                started=started,
            )
        except Exception as exc:
            return _result("error", str(exc), started=started)

    async def fetch_sample(
        self,
        node: GraphNode,
        credentials: dict[str, DebugCredential],
        *,
        sample_limit: int,
    ) -> DebugResult:
        started = time.perf_counter()
        try:
            if node.type.startswith("mysql_") and _node_kind(node) == "source":
                rows = await self._fetch_mysql_sample(node, credentials, sample_limit=sample_limit)
                return _result("ok", f"fetched {len(rows)} row(s)", data=rows, started=started)
            if node.type.startswith("postgres_") and _node_kind(node) == "source":
                rows = await self._fetch_postgres_sample(node, credentials, sample_limit=sample_limit)
                return _result("ok", f"fetched {len(rows)} row(s)", data=rows, started=started)
            if node.type.startswith("redis_") and _node_kind(node) == "source":
                rows = await self._fetch_redis_sample(node, credentials, sample_limit=sample_limit)
                return _result("ok", f"previewed {len(rows)} stream item(s)", data=rows, started=started)
            if node.type.startswith("feishu_bitable_") and _node_kind(node) == "source":
                rows = await self._fetch_feishu_sample(node, credentials, sample_limit=sample_limit)
                return _result("ok", f"previewed {len(rows)} record(s)", data=rows, started=started)
            if node.type == "webhook_source":
                payload = self._webhook_sample_payload(node)
                return _result("ok", "generated webhook sample payload", data=[payload], started=started)
            if node.type.startswith(("rabbitmq_", "sqs_")) and _node_kind(node) == "source":
                payload = self._queue_sample_payload(node)
                if payload is not None:
                    return _result(
                        "ok",
                        "generated configured queue sample payload",
                        data=[payload],
                        started=started,
                    )
                return _result(
                    "unsupported",
                    f"{node.type} sample fetch requires sample_payload because peeking can mutate queue state",
                    started=started,
                )
            if node.type in {"cron_source", "interval_source"}:
                payload = self._schedule_payload(node)
                return _result("ok", "generated source payload", data=[payload], started=started)
            if _node_kind(node) == "sink":
                return _result("unsupported", "sink nodes do not expose readable sample data", started=started)
            return _result(
                "unsupported",
                f"{node.type} sample fetch is not implemented yet",
                started=started,
            )
        except Exception as exc:
            return _result("error", str(exc), started=started)

    async def run_handler(self, node: GraphNode, payload: Any) -> DebugResult:
        started = time.perf_counter()
        stdout = io.StringIO()
        stderr = io.StringIO()
        try:
            if _node_kind(node) != "handler":
                return _result("unsupported", "only handler nodes can be executed", started=started)
            handler = self._load_handler(node)
            ctx = SimpleNamespace(config={}, task_config={"node_id": node.id, "node_type": node.type}, resources={})
            with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                result = handler(ctx, payload)
                if inspect.isawaitable(result):
                    result = await asyncio.wait_for(result, timeout=5)
            return _result(
                "ok",
                "handler completed",
                data=result,
                stdout=stdout.getvalue(),
                stderr=stderr.getvalue(),
                started=started,
            )
        except Exception as exc:
            return _result(
                "error",
                f"{exc.__class__.__name__}: {exc}",
                stdout=stdout.getvalue(),
                stderr=stderr.getvalue(),
                started=started,
            )

    def _load_handler(self, node: GraphNode):
        code = self.compiler.generate_handler_code(node)
        namespace: dict[str, Any] = {"__builtins__": __builtins__}
        exec(compile(code, f"<onestep-web-debug:{node.id}>", "exec"), namespace)
        handler = namespace.get("handler")
        if not callable(handler):
            raise ValueError("handler code must define handler(ctx, payload)")
        return handler

    async def _test_mysql(self, node: GraphNode, credentials: dict[str, DebugCredential]) -> None:
        dsn = _mysql_dsn(node, credentials)
        engine = create_async_engine(_async_mysql_dsn(dsn), pool_pre_ping=True)
        try:
            async with engine.connect() as connection:
                await connection.execute(text("SELECT 1"))
        finally:
            await engine.dispose()

    async def _test_postgres(self, node: GraphNode, credentials: dict[str, DebugCredential]) -> None:
        dsn = _postgres_dsn(node, credentials)
        engine = create_engine(_sync_postgres_dsn(dsn), pool_pre_ping=True)
        try:
            await asyncio.to_thread(_execute_probe, engine)
        finally:
            await asyncio.to_thread(engine.dispose)

    async def _test_rabbitmq(self, node: GraphNode, credentials: dict[str, DebugCredential]) -> None:
        import aio_pika

        config, env_vars = _connection_config(node, credentials)
        url = _required_interpolated(config, env_vars, "url", "dsn")
        connection = await aio_pika.connect_robust(url, timeout=5, **_options(config))
        try:
            queue = str(node.config.get("queue") or "").strip()
            if queue:
                channel = await connection.channel()
                try:
                    await channel.declare_queue(queue, passive=True)
                finally:
                    await channel.close()
        finally:
            await connection.close()

    async def _test_redis(self, node: GraphNode, credentials: dict[str, DebugCredential]) -> None:
        from redis.asyncio import Redis

        config, env_vars = _connection_config(node, credentials)
        url = _required_interpolated(config, env_vars, "url", "dsn")
        redis = Redis.from_url(url, decode_responses=True, **_options(config))
        try:
            await redis.ping()
        finally:
            await redis.aclose()

    async def _test_sqs(self, node: GraphNode, credentials: dict[str, DebugCredential]) -> None:
        import boto3

        config, _ = _connection_config(node, credentials)
        queue_url = _required_node_config(node, "url", "queue_url")
        client = boto3.client("sqs", region_name=config.get("region_name"), **_options(config))
        await asyncio.to_thread(
            client.get_queue_attributes,
            QueueUrl=queue_url,
            AttributeNames=["QueueArn", "ApproximateNumberOfMessages"],
        )

    async def _test_http(self, node: GraphNode) -> None:
        url = _required_node_config(node, "url")
        method = str(node.config.get("method") or "HEAD").upper()
        probe_method = "HEAD" if method in {"POST", "PUT", "PATCH", "DELETE"} else method
        async with httpx.AsyncClient(timeout=float(node.config.get("timeout_s") or 5.0)) as client:
            response = await client.request(probe_method, url)
            if response.status_code == 405 and probe_method == "HEAD":
                response = await client.get(url)
        if response.status_code >= 400:
            raise ValueError(f"HTTP endpoint returned {response.status_code}")

    @staticmethod
    def _validate_webhook(node: GraphNode) -> None:
        path = _required_node_config(node, "path")
        if not str(path).startswith("/"):
            raise ValueError("Webhook path must start with /")

    async def _test_feishu(self, node: GraphNode, credentials: dict[str, DebugCredential]) -> None:
        token = await _feishu_token(node, credentials)
        if not token:
            raise ValueError("Feishu token response was empty")

    async def _fetch_mysql_sample(
        self,
        node: GraphNode,
        credentials: dict[str, DebugCredential],
        *,
        sample_limit: int,
    ) -> list[dict[str, Any]]:
        table = str(node.config.get("table", "")).strip()
        if not _SAFE_SQL_NAME.fullmatch(table):
            raise ValueError("MySQL sample fetch requires a simple table name")
        dsn = _mysql_dsn(node, credentials)
        engine = create_async_engine(_async_mysql_dsn(dsn), pool_pre_ping=True)
        try:
            async with engine.connect() as connection:
                result = await connection.execute(text(f"SELECT * FROM {_quote_sql_name(table)} LIMIT :limit"), {"limit": sample_limit})
                return [dict(row._mapping) for row in result]
        finally:
            await engine.dispose()

    async def _fetch_postgres_sample(
        self,
        node: GraphNode,
        credentials: dict[str, DebugCredential],
        *,
        sample_limit: int,
    ) -> list[dict[str, Any]]:
        table = str(node.config.get("table", "")).strip()
        if not _SAFE_SQL_NAME.fullmatch(table):
            raise ValueError("Postgres sample fetch requires a simple table name")
        dsn = _postgres_dsn(node, credentials)
        engine = create_engine(_sync_postgres_dsn(dsn), pool_pre_ping=True)
        try:
            return await asyncio.to_thread(
                _fetch_table_sample,
                engine,
                _quote_postgres_name(table),
                sample_limit,
            )
        finally:
            await asyncio.to_thread(engine.dispose)

    async def _fetch_redis_sample(
        self,
        node: GraphNode,
        credentials: dict[str, DebugCredential],
        *,
        sample_limit: int,
    ) -> list[dict[str, Any]]:
        from redis.asyncio import Redis

        config, env_vars = _connection_config(node, credentials)
        url = _required_interpolated(config, env_vars, "url", "dsn")
        stream = _required_node_config(node, "stream", "queue")
        redis = Redis.from_url(url, decode_responses=True, **_options(config))
        try:
            rows = await redis.xrevrange(str(stream), count=sample_limit)
            return [{"id": item_id, "fields": fields} for item_id, fields in rows]
        finally:
            await redis.aclose()

    async def _fetch_feishu_sample(
        self,
        node: GraphNode,
        credentials: dict[str, DebugCredential],
        *,
        sample_limit: int,
    ) -> list[dict[str, Any]]:
        config, _ = _connection_config(node, credentials)
        token = await _feishu_token(node, credentials)
        base_url = str(config.get("base_url") or "https://open.feishu.cn").rstrip("/")
        app_token = _required_node_config(node, "app_token")
        table_id = _required_node_config(node, "table_id")
        params: dict[str, str] = {}
        if node.config.get("user_id_type"):
            params["user_id_type"] = str(node.config["user_id_type"])
        async with httpx.AsyncClient(timeout=float(config.get("timeout_s") or 10.0)) as client:
            response = await client.post(
                f"{base_url}/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/records/search",
                headers={"Authorization": f"Bearer {token}"},
                params=params,
                json={"page_size": sample_limit},
            )
        payload = _feishu_payload(response)
        data = payload.get("data")
        if not isinstance(data, dict):
            return []
        items = data.get("items", [])
        return [dict(item) for item in items if isinstance(item, dict)]

    @staticmethod
    def _schedule_payload(node: GraphNode) -> dict[str, Any]:
        payload = _parse_json_config(node.config.get("payload"))
        if isinstance(payload, dict):
            return dict(payload)
        if payload is not None:
            return {"payload": payload}
        return {
            "source": node.id,
            "node_type": node.type,
            "triggered_at": datetime.now(UTC).isoformat(),
        }

    @staticmethod
    def _webhook_sample_payload(node: GraphNode) -> dict[str, Any]:
        payload = _parse_json_config(node.config.get("sample_payload"))
        if isinstance(payload, dict):
            return dict(payload)
        if payload is not None:
            return {"payload": payload}
        return {
            "method": "POST",
            "path": node.config.get("path", f"/webhooks/{node.id}"),
            "body": {"event": "sample"},
        }

    @staticmethod
    def _queue_sample_payload(node: GraphNode) -> dict[str, Any] | None:
        if "sample_payload" not in node.config:
            return None
        payload = _parse_json_config(node.config.get("sample_payload"))
        if isinstance(payload, dict):
            return dict(payload)
        if payload is not None:
            return {"payload": payload}
        return None


def _result(
    status: str,
    message: str,
    *,
    data: Any = None,
    stdout: str = "",
    stderr: str = "",
    started: float,
) -> DebugResult:
    return DebugResult(
        status=status,  # type: ignore[arg-type]
        message=message,
        data=data,
        schema=infer_schema(data),
        stdout=stdout,
        stderr=stderr,
        duration_ms=round((time.perf_counter() - started) * 1000, 2),
    )


def infer_schema(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): infer_schema(item) for key, item in value.items()}
    if isinstance(value, list):
        if not value:
            return []
        return [infer_schema(value[0])]
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, int) and not isinstance(value, bool):
        return "int"
    if isinstance(value, float):
        return "float"
    if isinstance(value, str):
        return "str"
    return value.__class__.__name__


def build_debug_credentials(raw_credentials: dict[str, dict[str, Any]]) -> dict[str, DebugCredential]:
    return {
        name: DebugCredential(
            connector_type=str(value.get("connector_type", "")),
            config=dict(value.get("config", {})),
            env_vars={str(key): str(item) for key, item in dict(value.get("env_vars", {})).items()},
        )
        for name, value in raw_credentials.items()
    }


def _mysql_dsn(node: GraphNode, credentials: dict[str, DebugCredential]) -> str:
    config, env_vars = _connection_config(node, credentials)
    raw = str(config.get("dsn") or config.get("url") or "").strip()
    if not raw:
        raise ValueError("MySQL connection requires dsn or url")
    return interpolate_env_vars(raw, env_vars) if env_vars else raw


def _postgres_dsn(node: GraphNode, credentials: dict[str, DebugCredential]) -> str:
    config, env_vars = _connection_config(node, credentials)
    raw = str(config.get("dsn") or config.get("url") or "").strip()
    if not raw:
        raise ValueError("Postgres connection requires dsn or url")
    return interpolate_env_vars(raw, env_vars) if env_vars else raw


def _connection_config(
    node: GraphNode,
    credentials: dict[str, DebugCredential],
) -> tuple[dict[str, Any], dict[str, str]]:
    config = dict(node.config)
    env_vars: dict[str, str] = {}
    if node.credential_ref:
        credential = credentials.get(node.credential_ref)
        if credential is None:
            raise ValueError(f"credential {node.credential_ref} is not defined")
        config = {**credential.config, **config}
        env_vars = credential.env_vars
    if env_vars:
        config = _interpolate_config(config, env_vars)
    return config, env_vars


def _required_interpolated(
    config: dict[str, Any],
    env_vars: dict[str, str],
    *keys: str,
) -> str:
    for key in keys:
        raw = str(config.get(key) or "").strip()
        if raw:
            return interpolate_env_vars(raw, env_vars) if env_vars else raw
    raise ValueError(f"connection requires {' or '.join(keys)}")


def _required_node_config(node: GraphNode, *keys: str) -> str:
    for key in keys:
        raw = str(node.config.get(key) or "").strip()
        if raw:
            return raw
    raise ValueError(f"{node.type} requires {' or '.join(keys)}")


def _options(config: dict[str, Any]) -> dict[str, Any]:
    raw = config.get("options")
    return dict(raw) if isinstance(raw, dict) else {}


async def _feishu_token(node: GraphNode, credentials: dict[str, DebugCredential]) -> str:
    config, env_vars = _connection_config(node, credentials)
    app_id = _required_interpolated(config, env_vars, "app_id")
    app_secret = _required_interpolated(config, env_vars, "app_secret")
    base_url = str(config.get("base_url") or "https://open.feishu.cn").rstrip("/")
    async with httpx.AsyncClient(timeout=float(config.get("timeout_s") or 10.0)) as client:
        response = await client.post(
            f"{base_url}/open-apis/auth/v3/tenant_access_token/internal",
            json={"app_id": app_id, "app_secret": app_secret},
        )
    payload = _feishu_payload(response)
    token = payload.get("tenant_access_token")
    if not isinstance(token, str) or not token:
        raise ValueError("Feishu token response did not include tenant_access_token")
    return token


def _feishu_payload(response: httpx.Response) -> dict[str, Any]:
    try:
        payload = response.json()
    except ValueError as exc:
        raise ValueError(f"Feishu returned non-JSON response {response.status_code}") from exc
    if not isinstance(payload, dict):
        raise ValueError("Feishu returned a non-object response")
    code = payload.get("code")
    if response.status_code >= 400 or code not in {None, 0}:
        message = payload.get("msg") or payload.get("message") or response.reason_phrase
        raise ValueError(f"Feishu returned {response.status_code}/{code}: {message}")
    return payload


def _parse_json_config(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    stripped = value.strip()
    if not stripped:
        return None
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        return value


def _interpolate_config(value: Any, env_vars: dict[str, str]) -> Any:
    if isinstance(value, str):
        return interpolate_env_vars(value, env_vars)
    if isinstance(value, Mapping):
        return {key: _interpolate_config(item, env_vars) for key, item in value.items()}
    if isinstance(value, list):
        return [_interpolate_config(item, env_vars) for item in value]
    return value


def _async_mysql_dsn(dsn: str) -> str:
    if dsn.startswith("mysql://"):
        return "mysql+aiomysql://" + dsn.removeprefix("mysql://")
    if dsn.startswith("mysql+pymysql://"):
        return "mysql+aiomysql://" + dsn.removeprefix("mysql+pymysql://")
    return dsn


def _sync_postgres_dsn(dsn: str) -> str:
    if dsn.startswith("postgresql://"):
        return "postgresql+psycopg://" + dsn.removeprefix("postgresql://")
    if dsn.startswith("postgres://"):
        return "postgresql+psycopg://" + dsn.removeprefix("postgres://")
    return dsn


_SAFE_SQL_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?")


def _quote_sql_name(name: str) -> str:
    return ".".join(f"`{part}`" for part in name.split("."))


def _quote_postgres_name(name: str) -> str:
    return ".".join(f'"{part}"' for part in name.split("."))


def _execute_probe(engine: Any) -> None:
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))


def _fetch_table_sample(engine: Any, table_name: str, sample_limit: int) -> list[dict[str, Any]]:
    with engine.connect() as connection:
        result = connection.execute(text(f"SELECT * FROM {table_name} LIMIT :limit"), {"limit": sample_limit})
        return [dict(row._mapping) for row in result]


def _node_kind(node: GraphNode) -> str:
    if node.kind:
        return node.kind
    if node.type == "handler":
        return "handler"
    if node.type.endswith("_sink"):
        return "sink"
    return "source"
