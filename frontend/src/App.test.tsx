import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { CredentialManager } from "./CredentialManager";

describe("App", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/pipelines")) {
          return Response.json({ items: [] });
        }
        if (url.endsWith("/api/connectors")) {
          return Response.json({
            items: [
              {
                type: "rabbitmq_source",
                label: "RabbitMQ Source",
                category: "source",
                description: "Queue consume",
                fields: []
              },
              {
                type: "handler",
                label: "Python Handler",
                category: "handler",
                description: "Transform",
                fields: []
              },
              {
                type: "mysql_sink",
                label: "MySQL Sink",
                category: "sink",
                description: "Write rows",
                fields: []
              }
            ]
          });
        }
        if (url.endsWith("/api/credentials")) {
          return Response.json({ items: [] });
        }
        if (url.includes("/logs")) {
          return Response.json([]);
        }
        return Response.json({});
      })
    );
    vi.stubGlobal(
      "WebSocket",
      class {
        onmessage: ((event: MessageEvent) => void) | null = null;
        close() {}
      }
    );
    vi.stubGlobal("confirm", vi.fn(() => true));
  });

  it("renders the pipeline builder shell", async () => {
    render(<App />);

    expect(await screen.findByText("OneStep Web")).toBeInTheDocument();
    expect(await screen.findByText("RabbitMQ Source")).toBeInTheDocument();
    expect(screen.queryByText("Global credentials")).not.toBeInTheDocument();
  });

  it("opens credentials on a dedicated page", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Credentials" }));

    expect(await screen.findByText("Global credentials")).toBeInTheDocument();
    expect(screen.getByLabelText("Host")).toBeInTheDocument();
    expect(screen.getByLabelText("Database")).toBeInTheDocument();
    expect(screen.getByLabelText(/Password \(secret\)/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/\$\{/)).not.toBeInTheDocument();
  });

  it("opens pipeline logs from an explicit drawer entry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/pipelines")) {
          return Response.json({
            items: [
              {
                id: "pipe_1",
                name: "Logged pipeline",
                description: "",
                graph: { nodes: [], edges: [] },
                status: "stopped",
                created_at: "2026-06-13T00:00:00Z",
                updated_at: "2026-06-13T00:00:00Z"
              }
            ]
          });
        }
        if (url.endsWith("/api/connectors")) {
          return Response.json({ items: [] });
        }
        if (url.endsWith("/api/credentials")) {
          return Response.json({ items: [] });
        }
        if (url.includes("/logs")) {
          return Response.json([
            {
              id: 1,
              pipeline_id: "pipe_1",
              event_kind: "started",
              task_name: "runtime",
              message: "pipeline started",
              timestamp: "2026-06-13T00:00:00Z"
            },
            {
              id: 2,
              pipeline_id: "pipe_1",
              event_kind: "task_failed",
              task_name: "handler",
              message: "handler failed",
              timestamp: "2026-06-13T00:00:03Z"
            },
            {
              id: 3,
              pipeline_id: "pipe_1",
              event_kind: "retrying",
              task_name: "sink",
              message: "retry sink",
              timestamp: "2026-06-13T00:00:02Z"
            }
          ]);
        }
        return Response.json({});
      })
    );

    render(<App />);

    expect(await screen.findByDisplayValue("Logged pipeline")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Pipeline runtime logs" })).not.toBeInTheDocument();
    expect(screen.queryByText("pipeline started")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Logs" }));

    const dialog = await screen.findByRole("dialog", { name: "Pipeline runtime logs" });
    expect(within(dialog).getByText("Pipeline logs")).toBeInTheDocument();
    expect(await within(dialog).findByText("pipeline started")).toBeInTheDocument();
    expect(within(dialog).getAllByRole("article")[0]).toHaveTextContent("handler failed");

    fireEvent.change(within(dialog).getByLabelText("Severity"), { target: { value: "error" } });
    expect(within(dialog).getByText("handler failed")).toBeInTheDocument();
    expect(within(dialog).queryByText("pipeline started")).not.toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText("Severity"), { target: { value: "all" } });
    fireEvent.change(within(dialog).getByLabelText("Node"), { target: { value: "sink" } });
    expect(within(dialog).getByText("retry sink")).toBeInTheDocument();
    expect(within(dialog).queryByText("handler failed")).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Clear" }));
    expect(within(dialog).getByText("No runtime events yet.")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("dialog", { name: "Pipeline runtime logs" })).not.toBeInTheDocument();
  });

  it("blocks Start and Export when the saved graph is not runnable", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/pipelines")) {
        return Response.json({
          items: [
            {
              id: "pipe_1",
              name: "Disconnected pipeline",
              description: "",
              graph: {
                nodes: [
                  {
                    id: "n1",
                    type: "rabbitmq_source",
                    kind: "source",
                    config: {},
                    mapping: {},
                    input_schema: {},
                    position: { x: 0, y: 0 }
                  },
                  {
                    id: "n2",
                    type: "handler",
                    kind: "handler",
                    config: {},
                    mapping: { id: "{{order_id}}" },
                    mode: "visual",
                    input_schema: {},
                    position: { x: 0, y: 0 }
                  },
                  {
                    id: "n3",
                    type: "mysql_sink",
                    kind: "sink",
                    config: {},
                    mapping: {},
                    input_schema: {},
                    position: { x: 0, y: 0 }
                  }
                ],
                edges: []
              },
              status: "stopped",
              created_at: "2026-06-13T00:00:00Z",
              updated_at: "2026-06-13T00:00:00Z"
            }
          ]
        });
      }
      if (url.endsWith("/api/connectors")) {
        return Response.json({ items: [] });
      }
      if (url.endsWith("/api/credentials")) {
        return Response.json({ items: [] });
      }
      if (url.includes("/logs")) {
        return Response.json([]);
      }
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByDisplayValue("Disconnected pipeline")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Export" })).toBeDisabled();
    expect(screen.getByText("5 validation issues")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Show details"));
    expect(screen.getAllByText("source node n1 requires at least one outgoing edge").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() => {
      const calls = fetchMock.mock.calls.map(([input]) => String(input));
      expect(calls).not.toContain("/api/pipelines/pipe_1/start");
      expect(calls).not.toContain("/api/pipelines/pipe_1/export");
    });
  });

  it("loads a template as an unsaved draft and saves its graph", async () => {
    let createdBody: { name: string; graph: { nodes: Array<{ id: string; type: string }> } } | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/pipelines") && init?.method === "POST") {
          createdBody = JSON.parse(String(init.body));
          return Response.json({
            id: "pipe_template",
            name: createdBody!.name,
            description: "",
            graph: createdBody!.graph,
            status: "draft",
            created_at: "2026-06-13T00:00:00Z",
            updated_at: "2026-06-13T00:00:00Z"
          });
        }
        if (url.endsWith("/api/pipelines")) {
          return Response.json({ items: [] });
        }
        if (url.endsWith("/api/connectors")) {
          return Response.json({ items: [] });
        }
        if (url.endsWith("/api/credentials")) {
          return Response.json({ items: [] });
        }
        if (url.includes("/logs")) {
          return Response.json([]);
        }
        return Response.json({});
      })
    );

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Webhook to HTTP/ }));
    expect(screen.getByDisplayValue("Webhook to HTTP")).toBeInTheDocument();
    expect(screen.getByText("Loaded template: Webhook to HTTP")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start" })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(createdBody).not.toBeNull());
    expect(createdBody).toMatchObject({
      name: "Webhook to HTTP",
      graph: {
        nodes: [
          { id: "webhook", type: "webhook_source" },
          { id: "shape", type: "handler" },
          { id: "notify", type: "http_sink" }
        ]
      }
    });
  });

  it("keeps connection testing out of the builder node panel", async () => {
    render(<App />);

    fireEvent.click(await screen.findByText("RabbitMQ Source"));

    expect(await screen.findByText("Fetch Sample")).toBeInTheDocument();
    expect(screen.queryByText("Test Connection")).not.toBeInTheDocument();
  });

  it("opens a focused step-based configuration view on node double click", async () => {
    const { container } = render(<App />);

    fireEvent.click(await screen.findByText("Python Handler"));
    const flowNode = await waitFor(() => {
      const node = container.querySelector(".react-flow__node");
      expect(node).not.toBeNull();
      return node as Element;
    });

    fireEvent.doubleClick(flowNode);

    const dialog = await screen.findByRole("dialog", { name: "Focused node configuration" });
    expect(dialog.closest(".builder-grid")).toBeNull();
    expect(within(dialog).getByText("Focused configuration")).toBeInTheDocument();
    expect(within(dialog).getByText("Step 1")).toBeInTheDocument();
    expect(within(dialog).getByText("Transform")).toBeInTheDocument();
    expect(within(dialog).getByText("Step 2")).toBeInTheDocument();
    expect(within(dialog).getByText("Handler Debug")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Close focused configuration" }));

    expect(screen.queryByRole("dialog", { name: "Focused node configuration" })).not.toBeInTheDocument();
  });

  it("does not create default edges when nodes are added to the canvas", async () => {
    let savedGraph: unknown = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/pipelines") && init?.method === "POST") {
          const body = JSON.parse(String(init.body));
          savedGraph = body.graph;
          return Response.json({
            id: "pipe_1",
            name: body.name,
            description: body.description,
            graph: body.graph,
            status: "draft",
            created_at: "2026-06-13T00:00:00Z",
            updated_at: "2026-06-13T00:00:00Z"
          });
        }
        if (url.endsWith("/api/pipelines")) {
          return Response.json({ items: [] });
        }
        if (url.endsWith("/api/connectors")) {
          return Response.json({
            items: [
              {
                type: "rabbitmq_source",
                label: "RabbitMQ Source",
                category: "source",
                description: "Queue consume",
                fields: []
              },
              {
                type: "handler",
                label: "Python Handler",
                category: "handler",
                description: "Transform",
                fields: []
              },
              {
                type: "mysql_sink",
                label: "MySQL Sink",
                category: "sink",
                description: "Write rows",
                fields: []
              }
            ]
          });
        }
        if (url.endsWith("/api/credentials")) {
          return Response.json({ items: [] });
        }
        if (url.includes("/logs")) {
          return Response.json([]);
        }
        return Response.json({});
      })
    );

    render(<App />);

    fireEvent.click(await screen.findByText("RabbitMQ Source"));
    fireEvent.click(await screen.findByText("Python Handler"));
    fireEvent.click(await screen.findByText("MySQL Sink"));
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(savedGraph).not.toBeNull());
    expect(savedGraph).toMatchObject({
      nodes: [
        { id: "n1", kind: "source" },
        { id: "n2", kind: "handler" },
        { id: "n3", kind: "sink" }
      ],
      edges: []
    });
  });

  it("deletes the active pipeline and loads the next saved pipeline", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/pipelines/pipe_1") && init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      if (url.endsWith("/api/pipelines")) {
        return Response.json({
          items: [
            {
              id: "pipe_1",
              name: "Old pipeline",
              description: "",
              graph: { nodes: [], edges: [] },
              status: "draft",
              created_at: "2026-06-13T00:00:00Z",
              updated_at: "2026-06-13T00:00:00Z"
            },
            {
              id: "pipe_2",
              name: "Next pipeline",
              description: "",
              graph: { nodes: [], edges: [] },
              status: "draft",
              created_at: "2026-06-13T00:00:00Z",
              updated_at: "2026-06-13T00:00:00Z"
            }
          ]
        });
      }
      if (url.endsWith("/api/connectors")) {
        return Response.json({ items: [] });
      }
      if (url.endsWith("/api/credentials")) {
        return Response.json({ items: [] });
      }
      if (url.includes("/logs")) {
        return Response.json([]);
      }
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByDisplayValue("Old pipeline")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(window.confirm).toHaveBeenCalledWith('Delete pipeline "Old pipeline"? This cannot be undone.');
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/pipelines/pipe_1", { method: "DELETE" });
    });
    expect(await screen.findByDisplayValue("Next pipeline")).toBeInTheDocument();
    expect(screen.getByText("Deleted pipeline")).toBeInTheDocument();
  });

  it("keeps the active pipeline when delete confirmation is cancelled", async () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/pipelines")) {
        return Response.json({
          items: [
            {
              id: "pipe_1",
              name: "Old pipeline",
              description: "",
              graph: { nodes: [], edges: [] },
              status: "draft",
              created_at: "2026-06-13T00:00:00Z",
              updated_at: "2026-06-13T00:00:00Z"
            }
          ]
        });
      }
      if (url.endsWith("/api/connectors")) {
        return Response.json({ items: [] });
      }
      if (url.endsWith("/api/credentials")) {
        return Response.json({ items: [] });
      }
      if (url.includes("/logs")) {
        return Response.json([]);
      }
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByDisplayValue("Old pipeline")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(window.confirm).toHaveBeenCalledWith('Delete pipeline "Old pipeline"? This cannot be undone.');
    await waitFor(() => {
      const calls = fetchMock.mock.calls.map(([input]) => String(input));
      expect(calls).not.toContain("/api/pipelines/pipe_1");
    });
    expect(screen.getByDisplayValue("Old pipeline")).toBeInTheDocument();
  });

  it("creates typed MySQL credentials without manually adding env vars", async () => {
    const onCreate = vi.fn();
    const onUpdate = vi.fn();
    const onDelete = vi.fn();

    render(
      <CredentialManager
        credentials={[]}
        onCreate={onCreate}
        onDelete={onDelete}
        onUpdate={onUpdate}
      />
    );

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "PROD_MYSQL" } });
    fireEvent.change(screen.getByLabelText("Host"), { target: { value: "db.internal" } });
    fireEvent.change(screen.getByLabelText("Port"), { target: { value: "3307" } });
    fireEvent.change(screen.getByLabelText("Database"), { target: { value: "orders" } });
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "sync" } });
    fireEvent.change(screen.getByLabelText(/Password \(secret\)/), { target: { value: "secret" } });
    fireEvent.click(screen.getByText("Add Credential"));

    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onCreate).toHaveBeenCalledWith({
      name: "PROD_MYSQL",
      connector_type: "mysql",
      config: { dsn: "mysql://sync:${PASSWORD}@db.internal:3307/orders" },
      env_vars: { PASSWORD: "secret" }
    });
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("creates typed Postgres credentials without manually adding env vars", async () => {
    const onCreate = vi.fn();
    const onUpdate = vi.fn();
    const onDelete = vi.fn();

    render(
      <CredentialManager
        credentials={[]}
        onCreate={onCreate}
        onDelete={onDelete}
        onUpdate={onUpdate}
      />
    );

    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "postgres" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "PROD_POSTGRES" } });
    fireEvent.change(screen.getByLabelText("Host"), { target: { value: "pg.internal" } });
    fireEvent.change(screen.getByLabelText("Port"), { target: { value: "5433" } });
    fireEvent.change(screen.getByLabelText("Database"), { target: { value: "orders" } });
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "sync" } });
    fireEvent.change(screen.getByLabelText(/Password \(secret\)/), { target: { value: "secret" } });
    fireEvent.click(screen.getByText("Add Credential"));

    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onCreate).toHaveBeenCalledWith({
      name: "PROD_POSTGRES",
      connector_type: "postgres",
      config: { dsn: "postgresql+psycopg://sync:${PASSWORD}@pg.internal:5433/orders" },
      env_vars: { PASSWORD: "secret" }
    });
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("tests typed MySQL credentials from the credential page without placeholder variables", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        status: "ok",
        message: "connection succeeded",
        data: null,
        schema: null,
        stdout: "",
        stderr: "",
        duration_ms: 12
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CredentialManager
        credentials={[]}
        onCreate={vi.fn()}
        onDelete={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("Host"), { target: { value: "db.internal" } });
    fireEvent.change(screen.getByLabelText("Port"), { target: { value: "3307" } });
    fireEvent.change(screen.getByLabelText("Database"), { target: { value: "orders" } });
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "sync" } });
    fireEvent.change(screen.getByLabelText(/Password \(secret\)/), { target: { value: "secret" } });
    fireEvent.click(screen.getByText("Test Connection"));

    expect(await screen.findByText("connection succeeded")).toBeInTheDocument();
    const fetchCalls = fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit?]>;
    const requestInit = fetchCalls[0][1];
    expect(requestInit).toBeDefined();
    const requestBody = JSON.parse(String(requestInit!.body));
    expect(requestBody.node).toMatchObject({
      type: "mysql_source",
      credential_ref: null,
      config: { dsn: "mysql://sync:secret@db.internal:3307/orders" }
    });
    expect(requestBody.node.config.dsn).not.toContain("${");
  });

  it("tests typed Postgres credentials from the credential page without placeholder variables", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        status: "ok",
        message: "connection succeeded",
        data: null,
        schema: null,
        stdout: "",
        stderr: "",
        duration_ms: 12
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CredentialManager
        credentials={[]}
        onCreate={vi.fn()}
        onDelete={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "postgres" } });
    fireEvent.change(screen.getByLabelText("Host"), { target: { value: "pg.internal" } });
    fireEvent.change(screen.getByLabelText("Port"), { target: { value: "5433" } });
    fireEvent.change(screen.getByLabelText("Database"), { target: { value: "orders" } });
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "sync" } });
    fireEvent.change(screen.getByLabelText(/Password \(secret\)/), { target: { value: "secret" } });
    fireEvent.click(screen.getByText("Test Connection"));

    expect(await screen.findByText("connection succeeded")).toBeInTheDocument();
    const fetchCalls = fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit?]>;
    const requestInit = fetchCalls[0][1];
    expect(requestInit).toBeDefined();
    const requestBody = JSON.parse(String(requestInit!.body));
    expect(requestBody.node).toMatchObject({
      type: "postgres_source",
      credential_ref: null,
      config: { dsn: "postgresql+psycopg://sync:secret@pg.internal:5433/orders" }
    });
    expect(requestBody.node.config.dsn).not.toContain("${");
  });

  it("tests edited MySQL credentials with stored masked secrets", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        status: "ok",
        message: "connection succeeded",
        data: null,
        schema: null,
        stdout: "",
        stderr: "",
        duration_ms: 15
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CredentialManager
        credentials={[
          {
            id: "cred_1",
            name: "PROD_MYSQL",
            connector_type: "mysql",
            config: { dsn: "mysql://sync:${PASSWORD}@db.internal:3307/orders" },
            env_vars: { PASSWORD: "********" },
            created_at: "2026-06-13T00:00:00Z",
            updated_at: "2026-06-13T00:00:00Z"
          }
        ]}
        onCreate={vi.fn()}
        onDelete={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("Edit"));
    fireEvent.click(screen.getByText("Test Connection"));

    expect(await screen.findByText("connection succeeded")).toBeInTheDocument();
    const fetchCalls = fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit?]>;
    const requestInit = fetchCalls[0][1];
    expect(requestInit).toBeDefined();
    const requestBody = JSON.parse(String(requestInit!.body));
    expect(requestBody.node).toMatchObject({
      type: "mysql_source",
      credential_ref: "PROD_MYSQL",
      config: { dsn: "mysql://sync:${PASSWORD}@db.internal:3307/orders" }
    });
    expect(requestBody.node.config.dsn).not.toContain("********");
  });

  it("edits and deletes credentials from the credential manager", async () => {
    const onCreate = vi.fn();
    const onUpdate = vi.fn();
    const onDelete = vi.fn();

    render(
      <CredentialManager
        credentials={[
          {
            id: "cred_1",
            name: "PROD_RABBITMQ",
            connector_type: "rabbitmq",
            config: { url: "amqp://user:${PASSWORD}@host:5672/" },
            env_vars: { PASSWORD: "********" },
            created_at: "2026-06-13T00:00:00Z",
            updated_at: "2026-06-13T00:00:00Z"
          }
        ]}
        onCreate={onCreate}
        onDelete={onDelete}
        onUpdate={onUpdate}
      />
    );

    fireEvent.click(screen.getByText("Edit"));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "DEV_RABBITMQ" } });
    fireEvent.click(screen.getByText("Advanced environment variables"));
    fireEvent.click(screen.getByText("Add Env Var"));
    fireEvent.change(screen.getByLabelText("Env key 1"), { target: { value: "TOKEN" } });
    fireEvent.change(screen.getByLabelText("Env value 1"), { target: { value: "new-token" } });
    fireEvent.click(screen.getByText("Update Credential"));

    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
    expect(onUpdate).toHaveBeenCalledWith(
      "cred_1",
      expect.objectContaining({
        name: "DEV_RABBITMQ",
        connector_type: "rabbitmq",
        config: { url: "amqp://user:${PASSWORD}@host:5672/%2F" },
        env_vars: { PASSWORD: "********", TOKEN: "new-token" }
      })
    );

    fireEvent.click(screen.getByText("Delete"));
    expect(onDelete).toHaveBeenCalledWith("cred_1");
    expect(onCreate).not.toHaveBeenCalled();
  });
});
