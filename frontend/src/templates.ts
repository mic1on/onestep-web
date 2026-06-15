import type { PipelineGraph } from "./types";

export type PipelineTemplate = {
  id: string;
  name: string;
  graph: PipelineGraph;
};

export const PIPELINE_TEMPLATES: PipelineTemplate[] = [
  {
    id: "webhook_http",
    name: "Webhook to HTTP",
    graph: {
      nodes: [
        {
          id: "webhook",
          type: "webhook_source",
          kind: "source",
          config: {
            path: "/webhooks/orders",
            methods: ["POST"],
            sample_payload: "{\"order_id\":\"A001\",\"amount\":99.5}"
          },
          mapping: {},
          input_schema: {},
          position: { x: 40, y: 100 }
        },
        {
          id: "shape",
          type: "handler",
          kind: "handler",
          mode: "visual",
          config: {},
          mapping: {
            order_id: "{{order_id}}",
            amount: "{{amount}}",
            source: "webhook"
          },
          input_schema: {},
          position: { x: 330, y: 100 }
        },
        {
          id: "notify",
          type: "http_sink",
          kind: "sink",
          config: {
            url: "https://example.com/hooks/orders",
            method: "POST",
            timeout_s: 10
          },
          mapping: {},
          input_schema: {},
          position: { x: 620, y: 100 }
        }
      ],
      edges: [
        { from: "webhook", to: "shape" },
        { from: "shape", to: "notify" }
      ]
    }
  },
  {
    id: "mysql_feishu",
    name: "MySQL to Feishu",
    graph: {
      nodes: [
        {
          id: "orders",
          type: "mysql_source",
          kind: "source",
          config: {
            dsn: "mysql://sync:${MYSQL_PASSWORD}@mysql.example.com:3306/orders",
            mode: "incremental",
            table: "orders",
            cursor_column: "updated_at"
          },
          mapping: {},
          input_schema: {},
          position: { x: 40, y: 100 }
        },
        {
          id: "shape",
          type: "handler",
          kind: "handler",
          mode: "visual",
          config: {},
          mapping: {
            order_id: "{{id}}",
            amount: "{{amount}}",
            updated_at: "{{updated_at}}"
          },
          input_schema: {},
          position: { x: 330, y: 100 }
        },
        {
          id: "bitable",
          type: "feishu_bitable_sink",
          kind: "sink",
          config: {
            app_id: "${FEISHU_APP_ID}",
            app_secret: "${FEISHU_APP_SECRET}",
            app_token: "${FEISHU_APP_TOKEN}",
            table_id: "${FEISHU_TABLE_ID}",
            mode: "upsert",
            match_fields: ["order_id"]
          },
          mapping: {},
          input_schema: {},
          position: { x: 620, y: 100 }
        }
      ],
      edges: [
        { from: "orders", to: "shape" },
        { from: "shape", to: "bitable" }
      ]
    }
  },
  {
    id: "cron_http",
    name: "Cron Health Ping",
    graph: {
      nodes: [
        {
          id: "tick",
          type: "cron_source",
          kind: "source",
          config: {
            expression: "*/5 * * * *",
            timezone: "UTC",
            payload: { source: "cron" }
          },
          mapping: {},
          input_schema: {},
          position: { x: 40, y: 100 }
        },
        {
          id: "shape",
          type: "handler",
          kind: "handler",
          mode: "visual",
          config: {},
          mapping: {
            status: "ok",
            source: "{{source}}"
          },
          input_schema: {},
          position: { x: 330, y: 100 }
        },
        {
          id: "notify",
          type: "http_sink",
          kind: "sink",
          config: {
            url: "https://example.com/health/onestep",
            method: "POST",
            timeout_s: 5
          },
          mapping: {},
          input_schema: {},
          position: { x: 620, y: 100 }
        }
      ],
      edges: [
        { from: "tick", to: "shape" },
        { from: "shape", to: "notify" }
      ]
    }
  }
];
