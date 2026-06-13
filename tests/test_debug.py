from __future__ import annotations

from fastapi.testclient import TestClient


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


def test_debug_reports_unsupported_connector_without_500(client: TestClient) -> None:
    response = client.post(
        "/api/debug/nodes/test-connection",
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
    assert "rabbitmq_source" in body["message"]
