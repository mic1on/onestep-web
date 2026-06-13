import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

describe("App", () => {
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
});
