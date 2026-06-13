from __future__ import annotations

import asyncio
import os
import time
from collections.abc import Awaitable, Callable
from typing import Any, TypeVar

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from onestep_web.debug import PipelineDebugger
from onestep_web.schemas import GraphNode


pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        os.getenv("ONESTEP_WEB_CONNECTOR_INTEGRATION") != "1",
        reason="set ONESTEP_WEB_CONNECTOR_INTEGRATION=1 and start docker-compose.connectors.yml",
    ),
]


MYSQL_DSN = os.getenv(
    "ONESTEP_WEB_TEST_MYSQL_DSN",
    "mysql://onestep:onestep@127.0.0.1:33306/onestep_test",
)
RABBITMQ_URL = os.getenv(
    "ONESTEP_WEB_TEST_RABBITMQ_URL",
    "amqp://onestep:onestep@127.0.0.1:35672/",
)
REDIS_URL = os.getenv("ONESTEP_WEB_TEST_REDIS_URL", "redis://127.0.0.1:36379/0")
SQS_ENDPOINT_URL = os.getenv("ONESTEP_WEB_TEST_SQS_ENDPOINT_URL", "http://127.0.0.1:4566")
SQS_REGION = os.getenv("ONESTEP_WEB_TEST_SQS_REGION", "us-east-1")

T = TypeVar("T")


async def test_mysql_connection_and_source_sample_against_real_service() -> None:
    await _seed_mysql()
    node = GraphNode.model_validate(
        {
            "id": "mysql_orders",
            "type": "mysql_source",
            "kind": "source",
            "config": {"dsn": MYSQL_DSN, "table": "orders"},
        }
    )
    debugger = PipelineDebugger()

    connection = await debugger.test_connection(node, {})
    sample = await debugger.fetch_sample(node, {}, sample_limit=5)

    assert connection.status == "ok"
    assert sample.status == "ok"
    assert sample.data
    assert sample.data[0]["order_id"] == "A001"


async def test_rabbitmq_connection_and_configured_sample_against_real_service() -> None:
    await _seed_rabbitmq()
    node = GraphNode.model_validate(
        {
            "id": "rabbit_orders",
            "type": "rabbitmq_source",
            "kind": "source",
            "config": {
                "url": RABBITMQ_URL,
                "queue": "orders",
                "sample_payload": {"order_id": "A002", "source": "rabbitmq"},
            },
        }
    )
    debugger = PipelineDebugger()

    connection = await debugger.test_connection(node, {})
    sample = await debugger.fetch_sample(node, {}, sample_limit=5)

    assert connection.status == "ok"
    assert sample.status == "ok"
    assert sample.data == [{"order_id": "A002", "source": "rabbitmq"}]


async def test_redis_connection_and_stream_sample_against_real_service() -> None:
    await _seed_redis()
    node = GraphNode.model_validate(
        {
            "id": "redis_orders",
            "type": "redis_stream_source",
            "kind": "source",
            "config": {"url": REDIS_URL, "stream": "orders"},
        }
    )
    debugger = PipelineDebugger()

    connection = await debugger.test_connection(node, {})
    sample = await debugger.fetch_sample(node, {}, sample_limit=5)

    assert connection.status == "ok"
    assert sample.status == "ok"
    assert sample.data
    assert sample.data[0]["fields"]["order_id"] == "A003"


async def test_sqs_connection_and_configured_sample_against_localstack() -> None:
    queue_url = await _seed_sqs()
    node = GraphNode.model_validate(
        {
            "id": "sqs_orders",
            "type": "sqs_source",
            "kind": "source",
            "config": {
                "url": queue_url,
                "sample_payload": {"order_id": "A004", "source": "sqs"},
                "region_name": SQS_REGION,
                "options": {
                    "endpoint_url": SQS_ENDPOINT_URL,
                    "aws_access_key_id": "test",
                    "aws_secret_access_key": "test",
                },
            },
        }
    )
    debugger = PipelineDebugger()

    connection = await debugger.test_connection(node, {})
    sample = await debugger.fetch_sample(node, {}, sample_limit=5)

    assert connection.status == "ok"
    assert sample.status == "ok"
    assert sample.data == [{"order_id": "A004", "source": "sqs"}]


async def _seed_mysql() -> None:
    engine = create_async_engine(_async_mysql_dsn(MYSQL_DSN), pool_pre_ping=True)
    try:
        await _retry_async(
            "mysql",
            lambda: _mysql_exec(engine, "SELECT 1"),
        )
        async with engine.begin() as connection:
            await connection.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS orders (
                        id INT PRIMARY KEY AUTO_INCREMENT,
                        order_id VARCHAR(32) NOT NULL,
                        amount INT NOT NULL
                    )
                    """
                )
            )
            await connection.execute(text("DELETE FROM orders"))
            await connection.execute(
                text("INSERT INTO orders (order_id, amount) VALUES (:order_id, :amount)"),
                {"order_id": "A001", "amount": 42},
            )
    finally:
        await engine.dispose()


async def _seed_rabbitmq() -> None:
    import aio_pika

    connection = await _retry_async(
        "rabbitmq",
        lambda: aio_pika.connect_robust(RABBITMQ_URL, timeout=5),
    )
    try:
        channel = await connection.channel()
        try:
            await channel.declare_queue("orders", durable=False)
        finally:
            await channel.close()
    finally:
        await connection.close()


async def _seed_redis() -> None:
    from redis.asyncio import Redis

    redis = Redis.from_url(REDIS_URL, decode_responses=True)
    try:
        await _retry_async("redis", redis.ping)
        await redis.delete("orders")
        await redis.xadd("orders", {"order_id": "A003", "source": "redis"})
    finally:
        await redis.aclose()


async def _seed_sqs() -> str:
    import boto3

    client = boto3.client(
        "sqs",
        region_name=SQS_REGION,
        endpoint_url=SQS_ENDPOINT_URL,
        aws_access_key_id="test",
        aws_secret_access_key="test",
    )
    await _retry_async("localstack sqs", lambda: asyncio.to_thread(client.list_queues))
    response = await asyncio.to_thread(client.create_queue, QueueName="orders")
    return response["QueueUrl"]


async def _mysql_exec(engine: Any, statement: str) -> None:
    async with engine.connect() as connection:
        await connection.execute(text(statement))


async def _retry_async(name: str, operation: Callable[[], Awaitable[T]], timeout_s: float = 60) -> T:
    deadline = time.monotonic() + timeout_s
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            return await operation()
        except Exception as exc:
            last_error = exc
            await asyncio.sleep(1)
    raise AssertionError(f"{name} did not become ready within {timeout_s}s: {last_error}") from last_error


def _async_mysql_dsn(dsn: str) -> str:
    if dsn.startswith("mysql://"):
        return "mysql+aiomysql://" + dsn.removeprefix("mysql://")
    return dsn
