from __future__ import annotations


def sample_graph() -> dict:
    return {
        "nodes": [
            {
                "id": "n1",
                "type": "rabbitmq_source",
                "kind": "source",
                "credential_ref": "PROD_RABBITMQ",
                "config": {"queue": "orders.incoming", "prefetch": 10},
                "position": {"x": 120, "y": 160},
            },
            {
                "id": "n2",
                "type": "handler",
                "kind": "handler",
                "mode": "visual",
                "mapping": {"id": "{{order_id}}", "price": "{{amount * 1.1}}"},
                "position": {"x": 420, "y": 160},
            },
            {
                "id": "n3",
                "type": "mysql_sink",
                "kind": "sink",
                "credential_ref": "PROD_MYSQL",
                "config": {"table": "dw_orders", "mode": "upsert", "keys": ["id"]},
                "position": {"x": 720, "y": 160},
            },
        ],
        "edges": [
            {"from": "n1", "to": "n2"},
            {"from": "n2", "to": "n3"},
        ],
    }


def scheduled_http_graph() -> dict:
    return {
        "nodes": [
            {
                "id": "tick",
                "type": "cron_source",
                "kind": "source",
                "config": {
                    "expression": "0 0 1 1 *",
                    "timezone": "UTC",
                    "overlap": "skip",
                    "immediate": False,
                },
                "position": {"x": 120, "y": 160},
            },
            {
                "id": "shape",
                "type": "handler",
                "kind": "handler",
                "mode": "visual",
                "mapping": {"status": "scheduled", "source": "{{source}}"},
                "position": {"x": 420, "y": 160},
            },
            {
                "id": "notify",
                "type": "http_sink",
                "kind": "sink",
                "config": {
                    "url": "https://example.com/hooks/orders",
                    "method": "POST",
                    "success_statuses": [200, 202],
                },
                "position": {"x": 720, "y": 160},
            },
        ],
        "edges": [
            {"from": "tick", "to": "shape"},
            {"from": "shape", "to": "notify"},
        ],
    }


def postgres_graph() -> dict:
    return {
        "nodes": [
            {
                "id": "orders",
                "type": "postgres_source",
                "kind": "source",
                "credential_ref": "PROD_POSTGRES",
                "config": {
                    "mode": "incremental",
                    "table": "orders",
                    "key": "id",
                    "cursor_column": "updated_at",
                    "batch_size": 25,
                },
                "position": {"x": 120, "y": 160},
            },
            {
                "id": "shape",
                "type": "handler",
                "kind": "handler",
                "mode": "visual",
                "mapping": {"id": "{{id}}", "status": "{{status}}"},
                "position": {"x": 420, "y": 160},
            },
            {
                "id": "processed",
                "type": "postgres_sink",
                "kind": "sink",
                "credential_ref": "PROD_POSTGRES",
                "config": {"table": "processed_orders", "mode": "upsert", "keys": "id"},
                "position": {"x": 720, "y": 160},
            },
        ],
        "edges": [
            {"from": "orders", "to": "shape"},
            {"from": "shape", "to": "processed"},
        ],
    }


def conditional_sink_graph() -> dict:
    graph = scheduled_http_graph()
    graph["nodes"][1]["mapping"] = {
        "source": "{{source}}",
        "status": "{{status}}",
    }
    graph["nodes"].append(
        {
            "id": "paid_notify",
            "type": "http_sink",
            "kind": "sink",
            "config": {
                "url": "https://example.com/paid-orders",
                "method": "POST",
            },
            "position": {"x": 720, "y": 300},
        }
    )
    graph["edges"].append({"from": "shape", "to": "paid_notify", "condition": 'status == "paid"'})
    return graph
