from __future__ import annotations

from onestep.config import validate_app_config

from helpers import sample_graph, scheduled_http_graph
from onestep_web.onestep_adapter import build_onestep_config, build_runtime_app
from onestep_web.schemas import PipelineGraph


def test_build_onestep_config_maps_connectors_and_edges() -> None:
    config = build_onestep_config(
        "订单同步管道",
        PipelineGraph.model_validate(sample_graph()),
        handler_module="worker.handlers",
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
        runtime=False,
    )

    resources = config["resources"]
    assert resources["cred_PROD_RABBITMQ"] == {
        "type": "rabbitmq",
        "url": "amqp://user:${PROD_RABBITMQ_PASSWORD}@host:5672/",
    }
    assert resources["node_n1"]["type"] == "rabbitmq_queue"
    assert resources["node_n1"]["connector"] == "cred_PROD_RABBITMQ"
    assert resources["edge_n1__n2"] == {"type": "memory", "maxsize": 1000}
    assert resources["node_n3"]["type"] == "mysql_table_sink"
    assert resources["node_n3"]["connector"] == "cred_PROD_MYSQL"
    assert resources["node_n3"]["keys"] == ["id"]
    assert config["tasks"][0]["source"] == "node_n1"
    assert config["tasks"][0]["emit"] == ["edge_n1__n2"]
    assert config["tasks"][1]["handler"]["ref"] == "worker.handlers:handler_n2"
    assert config["tasks"][2]["emit"] == ["node_n3"]


def test_build_onestep_config_is_strict_valid_for_builtin_resources() -> None:
    config = build_onestep_config(
        "scheduled notify",
        PipelineGraph.model_validate(scheduled_http_graph()),
        handler_module="worker.handlers",
        credentials={},
        runtime=False,
    )

    validate_app_config(config)


async def test_build_runtime_app_returns_real_onestep_app() -> None:
    events: list[tuple[str, str, str]] = []

    async def log(event_kind: str, task_name: str, message: str) -> None:
        events.append((event_kind, task_name, message))

    app, module_name = build_runtime_app(
        "pipe_test",
        "scheduled notify",
        PipelineGraph.model_validate(scheduled_http_graph()),
        credentials={},
        log=log,
    )

    try:
        described = app.describe()
        assert described["name"] == "scheduled_notify"
        assert {task["name"] for task in described["tasks"]} == {"tick", "shape", "notify"}
        assert any(resource["key"] == "edge_tick__shape" for resource in described["resources"])
    finally:
        assert module_name.startswith("onestep_web._runtime_handlers_")
