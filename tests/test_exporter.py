from __future__ import annotations

import io
import zipfile

import yaml

from onestep_web.exporter import WorkerExporter
from onestep_web.schemas import PipelineGraph
from helpers import sample_graph


def test_exporter_builds_worker_zip() -> None:
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
        assert "onestep_worker/.env.example" in names
        assert "onestep_worker/requirements.txt" in names
        assert "onestep_worker/src/onestep_worker/handlers.py" in names
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
