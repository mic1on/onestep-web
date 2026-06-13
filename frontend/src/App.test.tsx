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
    expect(await screen.findByText("Global credentials")).toBeInTheDocument();
  });

  it("shows node debug controls when a connector is selected", async () => {
    render(<App />);

    fireEvent.click(await screen.findByText("RabbitMQ Source"));

    expect(await screen.findByText("Test Connection")).toBeInTheDocument();
    expect(await screen.findByText("Fetch Sample")).toBeInTheDocument();
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
    fireEvent.click(screen.getByText("Update Credential"));

    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
    expect(onUpdate).toHaveBeenCalledWith(
      "cred_1",
      expect.objectContaining({
        name: "DEV_RABBITMQ",
        connector_type: "rabbitmq",
        config: { url: "amqp://user:${PASSWORD}@host:5672/" }
      })
    );

    fireEvent.click(screen.getByText("Delete"));
    expect(onDelete).toHaveBeenCalledWith("cred_1");
    expect(onCreate).not.toHaveBeenCalled();
  });
});
