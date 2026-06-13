from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from onestep_web.debug import PipelineDebugger


def test_debug_fetches_schedule_sample(client: TestClient) -> None:
    response = client.post(
        "/api/debug/nodes/fetch-sample",
        json={
            "node": {
                "id": "tick",
                "type": "cron_source",
                "kind": "source",
                "config": {"payload": {"source": "orders", "batch": 1}},
            },
            "sample_limit": 3,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["data"] == [{"source": "orders", "batch": 1}]
    assert body["schema"] == [{"source": "str", "batch": "int"}]


def test_debug_runs_visual_handler_and_infers_output_schema(client: TestClient) -> None:
    response = client.post(
        "/api/debug/handlers/run",
        json={
            "node": {
                "id": "shape",
                "type": "handler",
                "kind": "handler",
                "mode": "visual",
                "mapping": {"id": "{{order_id}}", "price": "{{amount * 1.1}}"},
            },
            "payload": {"order_id": "A001", "amount": 10},
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["data"] == {"id": "A001", "price": 11.0}
    assert body["schema"] == {"id": "str", "price": "float"}


def test_debug_runs_code_handler_with_stdout(client: TestClient) -> None:
    response = client.post(
        "/api/debug/handlers/run",
        json={
            "node": {
                "id": "code",
                "type": "handler",
                "kind": "handler",
                "mode": "code",
                "code": "async def handler(ctx, payload):\n    print(payload['id'])\n    return {'id': payload['id'], 'ok': True}\n",
            },
            "payload": {"id": "A001"},
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["stdout"] == "A001\n"
    assert body["data"] == {"id": "A001", "ok": True}


def test_debug_tests_rabbitmq_connection_provider(
    client: TestClient,
    monkeypatch,
) -> None:
    async def fake_test_rabbitmq(self, node, credentials) -> None:
        assert node.type == "rabbitmq_source"

    monkeypatch.setattr(PipelineDebugger, "_test_rabbitmq", fake_test_rabbitmq)

    response = client.post(
        "/api/debug/nodes/test-connection",
        json={
            "node": {
                "id": "queue",
                "type": "rabbitmq_source",
                "kind": "source",
                "config": {"url": "amqp://guest:guest@localhost:5672/", "queue": "orders"},
            }
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["message"] == "connection succeeded"


def test_debug_refuses_rabbitmq_sample_fetch_to_avoid_mutation(client: TestClient) -> None:
    response = client.post(
        "/api/debug/nodes/fetch-sample",
        json={
            "node": {
                "id": "queue",
                "type": "rabbitmq_source",
                "kind": "source",
                "config": {"queue": "orders"},
            }
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "unsupported"
    assert "mutate queue state" in body["message"]


def test_debug_fetches_redis_stream_sample(client: TestClient, monkeypatch) -> None:
    async def fake_fetch_redis_sample(
        self,
        node,
        credentials,
        *,
        sample_limit: int,
    ) -> list[dict[str, Any]]:
        assert sample_limit == 2
        return [{"id": "1-0", "fields": {"order_id": "A001"}}]

    monkeypatch.setattr(PipelineDebugger, "_fetch_redis_sample", fake_fetch_redis_sample)

    response = client.post(
        "/api/debug/nodes/fetch-sample",
        json={
            "node": {
                "id": "redis",
                "type": "redis_stream_source",
                "kind": "source",
                "config": {"url": "redis://localhost:6379", "stream": "orders"},
            },
            "sample_limit": 2,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["data"] == [{"id": "1-0", "fields": {"order_id": "A001"}}]
    assert body["schema"] == [{"id": "str", "fields": {"order_id": "str"}}]


def test_debug_tests_sqs_connection_provider(client: TestClient, monkeypatch) -> None:
    async def fake_test_sqs(self, node, credentials) -> None:
        assert node.type == "sqs_source"

    monkeypatch.setattr(PipelineDebugger, "_test_sqs", fake_test_sqs)

    response = client.post(
        "/api/debug/nodes/test-connection",
        json={
            "node": {
                "id": "sqs",
                "type": "sqs_source",
                "kind": "source",
                "config": {"url": "https://sqs.us-east-1.amazonaws.com/123/orders"},
            }
        },
    )

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_debug_fetches_webhook_sample_payload(client: TestClient) -> None:
    response = client.post(
        "/api/debug/nodes/fetch-sample",
        json={
            "node": {
                "id": "hook",
                "type": "webhook_source",
                "kind": "source",
                "config": {"path": "/hooks/orders", "sample_payload": "{\"order_id\":\"A001\"}"},
            }
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["data"] == [{"order_id": "A001"}]


def test_debug_fetches_feishu_sample_provider(client: TestClient, monkeypatch) -> None:
    async def fake_fetch_feishu_sample(
        self,
        node,
        credentials,
        *,
        sample_limit: int,
    ) -> list[dict[str, Any]]:
        assert sample_limit == 1
        return [{"record_id": "rec1", "fields": {"Name": "A001"}}]

    monkeypatch.setattr(PipelineDebugger, "_fetch_feishu_sample", fake_fetch_feishu_sample)

    response = client.post(
        "/api/debug/nodes/fetch-sample",
        json={
            "node": {
                "id": "feishu",
                "type": "feishu_bitable_source",
                "kind": "source",
                "config": {
                    "app_token": "base_token",
                    "table_id": "tbl1",
                    "cursor_field": "updated_at",
                },
            },
            "sample_limit": 1,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["data"] == [{"record_id": "rec1", "fields": {"Name": "A001"}}]
