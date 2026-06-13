from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from onestep_web.api import create_api
from onestep_web.db import Database
from onestep_web.models import Pipeline
from onestep_web.settings import Settings
from helpers import sample_graph, scheduled_http_graph


def test_pipeline_crud(client: TestClient) -> None:
    created = client.post(
        "/api/pipelines",
        json={"name": "订单同步管道", "description": "demo", "graph": sample_graph()},
    )
    assert created.status_code == 200
    pipeline = created.json()
    assert pipeline["status"] == "draft"

    listed = client.get("/api/pipelines")
    assert listed.status_code == 200
    assert listed.json()["items"][0]["id"] == pipeline["id"]

    updated = client.put(
        f"/api/pipelines/{pipeline['id']}",
        json={"name": "订单同步管道 v2"},
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "订单同步管道 v2"

    deleted = client.delete(f"/api/pipelines/{pipeline['id']}")
    assert deleted.status_code == 204


def test_connectors_endpoint_includes_spec_nodes(client: TestClient) -> None:
    response = client.get("/api/connectors")

    assert response.status_code == 200
    connectors = response.json()["items"]
    connector_types = {item["type"] for item in connectors}
    assert {"rabbitmq_source", "handler", "mysql_sink", "http_sink"} <= connector_types
    fields_by_type = {
        item["type"]: {field["name"] for field in item["fields"]}
        for item in connectors
    }
    assert "sample_payload" in fields_by_type["rabbitmq_source"]
    assert "sample_payload" in fields_by_type["sqs_source"]


def test_credentials_are_returned_masked(client: TestClient) -> None:
    response = client.post(
        "/api/credentials",
        json={
            "name": "PROD_RABBITMQ",
            "connector_type": "rabbitmq",
            "config": {"url": "amqp://user:${PASSWORD}@host:5672/"},
            "env_vars": {"PASSWORD": "secret"},
        },
    )

    assert response.status_code == 200
    assert response.json()["env_vars"] == {"PASSWORD": "********"}


def test_start_pipeline_validates_graph_and_writes_logs(client: TestClient) -> None:
    pipeline = client.post(
        "/api/pipelines",
        json={"name": "定时通知管道", "description": "demo", "graph": scheduled_http_graph()},
    ).json()

    started = client.post(f"/api/pipelines/{pipeline['id']}/start")
    assert started.status_code == 200
    assert started.json()["status"] == "running"

    logs = client.get(f"/api/pipelines/{pipeline['id']}/logs")
    assert logs.status_code == 200
    assert logs.json()[0]["event_kind"] == "started"

    stopped = client.post(f"/api/pipelines/{pipeline['id']}/stop")
    assert stopped.status_code == 200
    assert stopped.json()["status"] == "stopped"


def test_update_running_pipeline_restarts_local_runtime(client: TestClient) -> None:
    pipeline = client.post(
        "/api/pipelines",
        json={"name": "定时通知管道", "description": "demo", "graph": scheduled_http_graph()},
    ).json()

    started = client.post(f"/api/pipelines/{pipeline['id']}/start")
    assert started.status_code == 200

    next_graph = scheduled_http_graph()
    next_graph["nodes"][1]["mapping"] = {"status": "updated", "source": "{{source}}"}
    updated = client.put(
        f"/api/pipelines/{pipeline['id']}",
        json={"graph": next_graph},
    )

    assert updated.status_code == 200
    assert updated.json()["status"] == "running"
    assert updated.json()["graph"]["nodes"][1]["mapping"] == {"status": "updated", "source": "{{source}}"}

    logs = client.get(f"/api/pipelines/{pipeline['id']}/logs").json()
    runtime_events = [(item["event_kind"], item["message"]) for item in logs if item["task_name"] == "runtime"]
    assert ("stopped", "pipeline stopped") in runtime_events
    assert sum(1 for event_kind, _ in runtime_events if event_kind == "started") == 2


async def test_startup_reconciles_stale_running_pipelines(tmp_path: Path) -> None:
    db = Database(
        Settings(
            data_dir=tmp_path,
            database_url=f"sqlite+aiosqlite:///{tmp_path / 'test.db'}",
            fernet_key="",
            frontend_dist=tmp_path / "dist",
        )
    )
    await db.init()
    async for session in db.session():
        session.add(
            Pipeline(
                name="stale",
                description="",
                graph_json=scheduled_http_graph(),
                status="running",
            )
        )
        await session.commit()
        break
    await db.dispose()

    with TestClient(create_api(db)) as client:
        listed = client.get("/api/pipelines")
        assert listed.status_code == 200
        pipeline = listed.json()["items"][0]
        assert pipeline["status"] == "stopped"

        logs = client.get(f"/api/pipelines/{pipeline['id']}/logs")
        assert logs.status_code == 200
        assert logs.json()[0]["message"] == "pipeline marked stopped after Web server restart"


def test_export_pipeline_returns_zip(client: TestClient) -> None:
    pipeline = client.post(
        "/api/pipelines",
        json={"name": "定时通知管道", "description": "demo", "graph": scheduled_http_graph()},
    ).json()

    response = client.post(f"/api/pipelines/{pipeline['id']}/export")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert response.content.startswith(b"PK")
