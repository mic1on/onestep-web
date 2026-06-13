import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PropertyPanel } from "./PropertyPanel";
import type { ConnectorDescriptor, GraphNode } from "./types";

const handlerConnector: ConnectorDescriptor = {
  type: "handler",
  label: "Python Handler",
  category: "handler",
  description: "Transform payloads",
  fields: []
};

const handlerNode: GraphNode = {
  id: "n2",
  type: "handler",
  kind: "handler",
  config: {},
  mode: "visual",
  mapping: { id: "" },
  input_schema: {},
  position: { x: 0, y: 0 }
};

const rabbitmqConnector: ConnectorDescriptor = {
  type: "rabbitmq_source",
  label: "RabbitMQ Source",
  category: "source",
  description: "Consume messages",
  credential_type: "rabbitmq",
  fields: [
    { name: "queue", label: "Queue", required: true, type: "text" },
    { name: "sample_payload", label: "Sample Payload JSON", required: false, type: "text" }
  ]
};

const rabbitmqNode: GraphNode = {
  id: "n1",
  type: "rabbitmq_source",
  kind: "source",
  config: { queue: "orders" },
  mapping: {},
  input_schema: {},
  position: { x: 0, y: 0 }
};

describe("PropertyPanel handler mapping editor", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows upstream fields and inserts a field expression into the active mapping row", () => {
    const onChange = vi.fn();

    render(
      <PropertyPanel
        connector={handlerConnector}
        credentials={[]}
        node={handlerNode}
        onChange={onChange}
        onDebugSample={vi.fn()}
        upstreamSample={{ order_id: "A001", amount: 99.5, status: "new" }}
      />
    );

    expect(screen.getByText("order_id")).toBeInTheDocument();
    expect(screen.getByText("amount")).toBeInTheDocument();

    fireEvent.focus(screen.getByLabelText("Expression for id"));
    fireEvent.click(screen.getByRole("button", { name: "Insert order_id" }));

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mapping: { id: "{{order_id}}" }
      })
    );
  });

  it("adds and removes visual mapping rows without leaving stale keys", () => {
    const onChange = vi.fn();

    render(
      <PropertyPanel
        connector={handlerConnector}
        credentials={[]}
        node={{ ...handlerNode, mapping: { id: "{{order_id}}" } }}
        onChange={onChange}
        onDebugSample={vi.fn()}
        upstreamSample={{ order_id: "A001" }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Add mapping" }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mapping: { id: "{{order_id}}", field_1: "" }
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove mapping id" }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mapping: {}
      })
    );
  });

  it("requires sample payload before fetching RabbitMQ samples", () => {
    render(
      <PropertyPanel
        connector={rabbitmqConnector}
        credentials={[]}
        node={rabbitmqNode}
        onChange={vi.fn()}
        onDebugSample={vi.fn()}
        upstreamSample={null}
      />
    );

    expect(screen.getByLabelText("Sample Payload JSON").tagName).toBe("TEXTAREA");
    expect(screen.getByRole("button", { name: "Fetch Sample" })).toBeDisabled();
    expect(screen.getByText(/samples require Sample Payload JSON/)).toBeInTheDocument();
  });

  it("enables RabbitMQ sample fetch when a sample payload is configured", () => {
    render(
      <PropertyPanel
        connector={rabbitmqConnector}
        credentials={[]}
        node={{
          ...rabbitmqNode,
          config: { queue: "orders", sample_payload: '{"order_id":"A001"}' }
        }}
        onChange={vi.fn()}
        onDebugSample={vi.fn()}
        upstreamSample={null}
      />
    );

    expect(screen.getByRole("button", { name: "Fetch Sample" })).toBeEnabled();
    expect(screen.getByText(/does not read from the live queue/)).toBeInTheDocument();
  });
});
