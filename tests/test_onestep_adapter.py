from __future__ import annotations

from onestep.config import validate_app_config

from helpers import conditional_sink_graph, postgres_graph, sample_graph, scheduled_http_graph
from onestep_web.onestep_adapter import build_onestep_config, build_requirements, build_runtime_app
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
    assert resources["cred_PROD_MYSQL"]["dsn"] == "mysql+pymysql://user:${PROD_MYSQL_PASSWORD}@host/db"
    assert config["tasks"][0]["source"] == "node_n1"
    assert config["tasks"][0]["emit"] == ["edge_n1__n2"]
    assert config["tasks"][1]["handler"]["ref"] == "worker.handlers:handler_n2"
    assert config["tasks"][2]["emit"] == ["node_n3"]
    validate_app_config(config)


def test_build_onestep_config_is_strict_valid_for_builtin_resources() -> None:
    config = build_onestep_config(
        "scheduled notify",
        PipelineGraph.model_validate(scheduled_http_graph()),
        handler_module="worker.handlers",
        credentials={},
        runtime=False,
    )

    validate_app_config(config)


def test_build_onestep_config_maps_conditional_handler_edges() -> None:
    config = build_onestep_config(
        "conditional route",
        PipelineGraph.model_validate(conditional_sink_graph()),
        handler_module="worker.handlers",
        credentials={},
        runtime=False,
    )

    handler_task = next(task for task in config["tasks"] if task["name"] == "shape")
    assert handler_task["emit"] == [
        "edge_shape__notify",
        {
            "when": "worker.handlers:predicate_shape__paid_notify",
            "then": "edge_shape__paid_notify",
        },
    ]
    validate_app_config(config)


def test_build_onestep_config_preserves_sqs_options() -> None:
    config = build_onestep_config(
        "sqs orders",
        PipelineGraph.model_validate(
            {
                "nodes": [
                    {
                        "id": "orders",
                        "type": "sqs_source",
                        "kind": "source",
                        "credential_ref": "PROD_SQS",
                        "config": {"url": "https://sqs.us-east-1.amazonaws.com/123/orders"},
                    },
                    {
                        "id": "notify",
                        "type": "http_sink",
                        "kind": "sink",
                        "config": {"url": "https://example.com/orders"},
                    },
                ],
                "edges": [
                    {
                        "from": "orders",
                        "to": "notify",
                    },
                ],
            }
        ),
        handler_module="worker.handlers",
        credentials={
            "PROD_SQS": {
                "connector_type": "sqs",
                "config": {
                    "region_name": "us-east-1",
                    "options": {
                        "aws_access_key_id": "${ACCESS_KEY_ID}",
                        "aws_secret_access_key": "${SECRET_ACCESS_KEY}",
                    },
                },
                "env_vars": {
                    "ACCESS_KEY_ID": "test-key",
                    "SECRET_ACCESS_KEY": "test-secret",
                },
            },
        },
        runtime=False,
    )

    assert config["resources"]["cred_PROD_SQS"] == {
        "type": "sqs",
        "region_name": "us-east-1",
        "options": {
            "aws_access_key_id": "${PROD_SQS_ACCESS_KEY_ID}",
            "aws_secret_access_key": "${PROD_SQS_SECRET_ACCESS_KEY}",
        },
    }


def test_build_onestep_config_maps_postgres_source_sink_and_requirement() -> None:
    graph = PipelineGraph.model_validate(postgres_graph())
    config = build_onestep_config(
        "postgres orders",
        graph,
        handler_module="worker.handlers",
        credentials={
            "PROD_POSTGRES": {
                "connector_type": "postgres",
                "config": {"dsn": "postgresql://sync:${PASSWORD}@db.internal/orders"},
                "env_vars": {"PASSWORD": "secret"},
            },
        },
        runtime=False,
    )

    resources = config["resources"]
    assert resources["cred_PROD_POSTGRES"] == {
        "type": "postgres",
        "dsn": "postgresql+psycopg://sync:${PROD_POSTGRES_PASSWORD}@db.internal/orders",
    }
    assert resources["node_orders"] == {
        "type": "postgres_incremental",
        "connector": "cred_PROD_POSTGRES",
        "table": "orders",
        "key": "id",
        "cursor": ["updated_at", "id"],
        "batch_size": 25,
    }
    assert resources["node_processed"] == {
        "type": "postgres_table_sink",
        "connector": "cred_PROD_POSTGRES",
        "table": "processed_orders",
        "mode": "upsert",
        "keys": ["id"],
    }
    assert build_requirements(graph) == ["onestep[yaml]", "onestep-postgres"]
    validate_app_config(config)


def test_build_onestep_config_maps_postgres_table_queue_json_fields() -> None:
    config = build_onestep_config(
        "postgres queue",
        PipelineGraph.model_validate(
            {
                "nodes": [
                    {
                        "id": "orders",
                        "type": "postgres_source",
                        "kind": "source",
                        "credential_ref": "PROD_POSTGRES",
                        "config": {
                            "mode": "table_queue",
                            "table": "orders",
                            "key": "id",
                            "where": "status = 'pending'",
                            "claim": '{"status":"processing"}',
                            "ack": '{"status":"done"}',
                            "nack": '{"status":"pending"}',
                        },
                    },
                    {
                        "id": "processed",
                        "type": "postgres_sink",
                        "kind": "sink",
                        "credential_ref": "PROD_POSTGRES",
                        "config": {"table": "processed_orders"},
                    },
                ],
                "edges": [{"from": "orders", "to": "processed"}],
            }
        ),
        handler_module="worker.handlers",
        credentials={
            "PROD_POSTGRES": {
                "connector_type": "postgres",
                "config": {"dsn": "postgresql+psycopg://sync:${PASSWORD}@db.internal/orders"},
                "env_vars": {"PASSWORD": "secret"},
            },
        },
        runtime=False,
    )

    assert config["resources"]["node_orders"] == {
        "type": "postgres_table_queue",
        "connector": "cred_PROD_POSTGRES",
        "table": "orders",
        "key": "id",
        "where": "status = 'pending'",
        "claim": {"status": "processing"},
        "ack": {"status": "done"},
        "nack": {"status": "pending"},
    }


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


async def test_build_runtime_app_loads_conditional_predicates() -> None:
    async def log(event_kind: str, task_name: str, message: str) -> None:
        _ = (event_kind, task_name, message)

    app, module_name = build_runtime_app(
        "pipe_conditional",
        "conditional route",
        PipelineGraph.model_validate(conditional_sink_graph()),
        credentials={},
        log=log,
    )

    try:
        task = next(task for task in app.tasks if task.name == "shape")
        conditional_route = task.emit_routes[1]
        assert conditional_route.predicate_ref == f"{module_name}:predicate_shape__paid_notify"
        assert conditional_route.predicate(None, {}, {"status": "paid"}) is True
        assert conditional_route.predicate(None, {}, {"status": "new"}) is False
    finally:
        assert module_name.startswith("onestep_web._runtime_handlers_")
