from __future__ import annotations

from fastapi.testclient import TestClient

from helpers import sample_graph


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
    connector_types = {item["type"] for item in response.json()["items"]}
    assert {"rabbitmq_source", "handler", "mysql_sink", "http_sink"} <= connector_types


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
    client.post(
        "/api/credentials",
        json={
            "name": "PROD_RABBITMQ",
            "connector_type": "rabbitmq",
            "config": {"url": "amqp://user:${PASSWORD}@host:5672/"},
            "env_vars": {"PASSWORD": "secret"},
        },
    )
    client.post(
        "/api/credentials",
        json={
            "name": "PROD_MYSQL",
            "connector_type": "mysql",
            "config": {"url": "mysql://user:${PASSWORD}@host/db"},
            "env_vars": {"PASSWORD": "secret"},
        },
    )
    pipeline = client.post(
        "/api/pipelines",
        json={"name": "订单同步管道", "description": "demo", "graph": sample_graph()},
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


def test_export_pipeline_returns_zip(client: TestClient) -> None:
    pipeline = client.post(
        "/api/pipelines",
        json={"name": "订单同步管道", "description": "demo", "graph": sample_graph()},
    ).json()

    response = client.post(f"/api/pipelines/{pipeline['id']}/export")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert response.content.startswith(b"PK")
