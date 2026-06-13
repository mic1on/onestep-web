from __future__ import annotations

from onestep_web.schemas import ConnectorDescriptor, ConnectorField


CONNECTORS: list[ConnectorDescriptor] = [
    ConnectorDescriptor(
        type="mysql_source",
        label="MySQL Source",
        category="source",
        description="Read from MySQL table_queue, incremental rows, or binlog.",
        credential_type="mysql",
        fields=[
            ConnectorField(name="mode", label="Mode", required=True),
            ConnectorField(name="table", label="Table", required=True),
            ConnectorField(name="cursor_column", label="Cursor Column"),
        ],
    ),
    ConnectorDescriptor(
        type="rabbitmq_source",
        label="RabbitMQ Source",
        category="source",
        description="Consume messages from a RabbitMQ queue.",
        credential_type="rabbitmq",
        fields=[
            ConnectorField(name="queue", label="Queue", required=True),
            ConnectorField(name="exchange", label="Exchange"),
            ConnectorField(name="routing_key", label="Routing"),
            ConnectorField(name="prefetch", label="Prefetch", type="number"),
        ],
    ),
    ConnectorDescriptor(type="redis_stream_source", label="Redis Stream Source", category="source", description="Consume Redis Stream entries.", credential_type="redis"),
    ConnectorDescriptor(type="sqs_source", label="SQS Source", category="source", description="Consume AWS SQS messages.", credential_type="sqs"),
    ConnectorDescriptor(type="cron_source", label="Cron Source", category="source", description="Trigger from cron expressions."),
    ConnectorDescriptor(type="interval_source", label="Interval Source", category="source", description="Trigger on fixed intervals."),
    ConnectorDescriptor(type="webhook_source", label="Webhook Source", category="source", description="Expose an HTTP entrypoint."),
    ConnectorDescriptor(type="feishu_bitable_source", label="Feishu Bitable Source", category="source", description="Read incremental Feishu Bitable records.", credential_type="feishu_bitable"),
    ConnectorDescriptor(type="handler", label="Python Handler", category="handler", description="Transform payloads with visual mappings or Python code."),
    ConnectorDescriptor(type="mysql_sink", label="MySQL Sink", category="sink", description="Write rows to a MySQL table.", credential_type="mysql"),
    ConnectorDescriptor(type="rabbitmq_sink", label="RabbitMQ Sink", category="sink", description="Publish messages to RabbitMQ.", credential_type="rabbitmq"),
    ConnectorDescriptor(type="redis_stream_sink", label="Redis Stream Sink", category="sink", description="Append entries to a Redis Stream.", credential_type="redis"),
    ConnectorDescriptor(type="sqs_sink", label="SQS Sink", category="sink", description="Publish messages to AWS SQS.", credential_type="sqs"),
    ConnectorDescriptor(type="http_sink", label="HTTP Sink", category="sink", description="Call an external HTTP endpoint."),
    ConnectorDescriptor(type="feishu_bitable_sink", label="Feishu Bitable Sink", category="sink", description="Write records to Feishu Bitable.", credential_type="feishu_bitable"),
]


CONNECTOR_BY_TYPE = {connector.type: connector for connector in CONNECTORS}

