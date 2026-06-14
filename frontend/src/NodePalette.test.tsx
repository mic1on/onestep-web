import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NodePalette } from "./NodePalette";
import type { ConnectorDescriptor } from "./types";

describe("NodePalette", () => {
  afterEach(() => {
    cleanup();
  });

  it("filters connectors by label, type, description, or category", () => {
    render(<NodePalette connectors={connectors} onAddNode={vi.fn()} recentConnectorTypes={[]} />);

    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "queue" } });

    expect(screen.getByText("RabbitMQ Source")).toBeInTheDocument();
    expect(screen.queryByText("Python Handler")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "missing" } });

    expect(screen.getByText("No matching nodes.")).toBeInTheDocument();
  });

  it("shows recent and common connectors without duplicating category entries", () => {
    const onAddNode = vi.fn();

    render(
      <NodePalette
        connectors={connectors}
        onAddNode={onAddNode}
        recentConnectorTypes={["rabbitmq_source"]}
      />
    );

    expect(screen.getByRole("heading", { name: "Recent" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Common" })).toBeInTheDocument();
    expect(screen.getAllByText("RabbitMQ Source")).toHaveLength(1);
    expect(screen.getAllByText("Python Handler")).toHaveLength(1);
    expect(screen.getByText("Redis Stream Source")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Python Handler/ }));

    expect(onAddNode).toHaveBeenCalledWith(connectors[2]);
  });
});

const connectors: ConnectorDescriptor[] = [
  {
    type: "rabbitmq_source",
    label: "RabbitMQ Source",
    category: "source",
    description: "Consume messages from a queue.",
    fields: []
  },
  {
    type: "redis_stream_source",
    label: "Redis Stream Source",
    category: "source",
    description: "Consume Redis Stream entries.",
    fields: []
  },
  {
    type: "handler",
    label: "Python Handler",
    category: "handler",
    description: "Transform payloads.",
    fields: []
  },
  {
    type: "mysql_sink",
    label: "MySQL Sink",
    category: "sink",
    description: "Write rows to MySQL.",
    fields: []
  }
];
