from __future__ import annotations

import asyncio
import contextlib
import inspect
import io
import re
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

from sqlalchemy import text
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

    @staticmethod
    def _schedule_payload(node: GraphNode) -> dict[str, Any]:
        payload = node.config.get("payload")
        if isinstance(payload, dict):
            return dict(payload)
        if payload is not None:
            return {"payload": payload}
        return {
            "source": node.id,
            "node_type": node.type,
            "triggered_at": datetime.now(UTC).isoformat(),
        }


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
    config = dict(node.config)
    env_vars: dict[str, str] = {}
    if node.credential_ref:
        credential = credentials.get(node.credential_ref)
        if credential is None:
            raise ValueError(f"credential {node.credential_ref} is not defined")
        config = credential.config
        env_vars = credential.env_vars
    raw = str(config.get("dsn") or config.get("url") or "").strip()
    if not raw:
        raise ValueError("MySQL connection requires dsn or url")
    return interpolate_env_vars(raw, env_vars) if env_vars else raw


def _async_mysql_dsn(dsn: str) -> str:
    if dsn.startswith("mysql://"):
        return "mysql+aiomysql://" + dsn.removeprefix("mysql://")
    if dsn.startswith("mysql+pymysql://"):
        return "mysql+aiomysql://" + dsn.removeprefix("mysql+pymysql://")
    return dsn


_SAFE_SQL_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?")


def _quote_sql_name(name: str) -> str:
    return ".".join(f"`{part}`" for part in name.split("."))


def _node_kind(node: GraphNode) -> str:
    if node.kind:
        return node.kind
    if node.type == "handler":
        return "handler"
    if node.type.endswith("_sink"):
        return "sink"
    return "source"
