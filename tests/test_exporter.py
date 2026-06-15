from __future__ import annotations

import io
import zipfile
from pathlib import Path
from typing import Any

import yaml

from onestep.cli import main as onestep_main
from onestep_web.exporter import WorkerExporter
from onestep_web.schemas import PipelineGraph
from helpers import conditional_sink_graph, postgres_graph, sample_graph


def test_exporter_builds_worker_zip(tmp_path: Path, monkeypatch: Any) -> None:
    exported = WorkerExporter().export(
        "pipe_123",
        "订单同步管道",
        PipelineGraph.model_validate(sample_graph()),
        credentials={
            "PROD_RABBITMQ": {
                "connector_type": "rabbitmq",
                "config": {"url": "amqp://user:${PASSWORD}@host:5672/"},
                "env_vars": {"PASSWORD": "secret"},
            },
            "PROD_MYSQL": {
                "connector_type": "mysql",
                "config": {"dsn": "mysql://user:${PASSWORD}@host/db"},
                "env_vars": {"PASSWORD": "secret"},
            },
        },
    )

    with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
        names = set(archive.namelist())
        assert "onestep_worker/worker.yaml" in names
        assert "onestep_worker/docker-compose.yml" in names
        assert "onestep_worker/.env.example" in names
        assert "onestep_worker/requirements.txt" in names
        assert "onestep_worker/src/onestep_worker/handlers.py" in names
        compose = yaml.safe_load(archive.read("onestep_worker/docker-compose.yml").decode())
        assert compose["services"]["worker"]["image"].startswith(
            "${ONESTEP_WORKER_IMAGE:-ghcr.io/mic1on/onestep-worker:"
        )
        assert compose["services"]["worker"]["volumes"] == ["./:/workspace"]
        assert compose["services"]["worker"]["env_file"] == [".env.example"]
        assert compose["services"]["worker"]["environment"] == {
            "ONESTEP_TARGET": "/workspace/worker.yaml"
        }
        worker = yaml.safe_load(archive.read("onestep_worker/worker.yaml").decode())
        assert worker["resources"]["node_n1"]["type"] == "rabbitmq_queue"
        assert worker["resources"]["node_n3"]["type"] == "mysql_table_sink"
        assert worker["resources"]["edge_n1__n2"] == {"type": "memory", "maxsize": 1000}
        env_example = archive.read("onestep_worker/.env.example").decode()
        assert "PROD_RABBITMQ_PASSWORD=" in env_example
        requirements = archive.read("onestep_worker/requirements.txt").decode()
        assert "onestep[mysql,rabbitmq,yaml]" in requirements
        handlers = archive.read("onestep_worker/src/onestep_worker/handlers.py").decode()
        assert "async def handler_n2" in handlers

        archive.extractall(tmp_path)

    monkeypatch.chdir(tmp_path / "onestep_worker")
    assert onestep_main(["check", "--strict", "--env-file", ".env.example", "worker.yaml"]) == 0


def test_exporter_includes_conditional_route_predicates() -> None:
    exported = WorkerExporter().export(
        "pipe_conditional",
        "conditional route",
        PipelineGraph.model_validate(conditional_sink_graph()),
        credentials={},
    )

    with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
        worker = yaml.safe_load(archive.read("conditional_route/worker.yaml").decode())
        handler_task = next(task for task in worker["tasks"] if task["name"] == "shape")
        assert handler_task["emit"][1] == {
            "when": "conditional_route.handlers:predicate_shape__paid_notify",
            "then": "edge_shape__paid_notify",
        }
        handlers = archive.read("conditional_route/src/conditional_route/handlers.py").decode()
        assert "def predicate_shape__paid_notify" in handlers
        assert "result['status'] == 'paid'" in handlers


def test_exporter_includes_postgres_plugin_requirement() -> None:
    exported = WorkerExporter().export(
        "pipe_postgres",
        "postgres orders",
        PipelineGraph.model_validate(postgres_graph()),
        credentials={
            "PROD_POSTGRES": {
                "connector_type": "postgres",
                "config": {"dsn": "postgresql://sync:${PASSWORD}@db.internal/orders"},
                "env_vars": {"PASSWORD": "secret"},
            },
        },
    )

    with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
        worker = yaml.safe_load(archive.read("postgres_orders/worker.yaml").decode())
        assert worker["resources"]["cred_PROD_POSTGRES"]["type"] == "postgres"
        assert worker["resources"]["node_orders"]["type"] == "postgres_incremental"
        assert worker["resources"]["node_processed"]["type"] == "postgres_table_sink"
        assert archive.read("postgres_orders/requirements.txt").decode() == (
            "onestep[yaml]\nonestep-postgres\n"
        )
