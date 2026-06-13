import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { CredentialManager } from "./CredentialManager";

describe("App", () => {
  afterEach(() => {
    cleanup();
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

  it("keeps connection testing out of the builder node panel", async () => {
    render(<App />);

    fireEvent.click(await screen.findByText("RabbitMQ Source"));

    expect(await screen.findByText("Fetch Sample")).toBeInTheDocument();
    expect(screen.queryByText("Test Connection")).not.toBeInTheDocument();
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
