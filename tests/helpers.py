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
