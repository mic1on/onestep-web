import { describe, expect, it } from "vitest";
import {
  connectionStateForNode,
  disconnectGraphNode,
  duplicateGraphNode,
  handlesForNodeKind,
  nextGraphNodeId,
  nextNodePosition,
  removeGraphNode,
  validateConditionExpression,
  validatePipelineGraphConditions,
  validateGraphConnection
} from "./PipelineEditor";
import type { GraphNode, PipelineGraph } from "./types";

describe("validateGraphConnection", () => {
  it("accepts legal source to handler and handler to sink edges", () => {
    const graph = graphWithNodes(source("source"), handler("handler"), sink("sink"));

    expect(validateGraphConnection(graph, "source", "handler")).toBeNull();
    expect(validateGraphConnection(graph, "handler", "sink")).toBeNull();
  });

  it("rejects source incoming and sink outgoing edges", () => {
    const graph = graphWithNodes(source("source"), handler("handler"), sink("sink"));

    expect(validateGraphConnection(graph, "handler", "source")).toBe(
      "Source nodes cannot have incoming edges."
    );
    expect(validateGraphConnection(graph, "sink", "handler")).toBe(
      "Sink nodes cannot have outgoing edges."
    );
  });

  it("rejects duplicate and self connections", () => {
    const graph: PipelineGraph = {
      ...graphWithNodes(source("source"), handler("handler")),
      edges: [{ from: "source", to: "handler" }]
    };

    expect(validateGraphConnection(graph, "source", "handler")).toBe(
      "This connection already exists."
    );
    expect(validateGraphConnection(graph, "handler", "handler")).toBe(
      "A node cannot connect to itself."
    );
  });

  it("rejects edges that would create a cycle", () => {
    const graph: PipelineGraph = {
      ...graphWithNodes(handler("a"), handler("b"), handler("c")),
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" }
      ]
    };

    expect(validateGraphConnection(graph, "c", "a")).toBe("This connection would create a cycle.");
  });
});

describe("connection affordances", () => {
  it("exposes only legal handles for each node kind", () => {
    expect(handlesForNodeKind("source")).toEqual({ source: true, target: false });
    expect(handlesForNodeKind("handler")).toEqual({ source: true, target: true });
    expect(handlesForNodeKind("sink")).toEqual({ source: false, target: true });
  });

  it("marks nodes that still need explicit user connections", () => {
    const graph = graphWithNodes(source("source"), handler("handler"), sink("sink"));

    expect(connectionStateForNode(graph.nodes[0], graph.edges)).toBe("needs output");
    expect(connectionStateForNode(graph.nodes[1], graph.edges)).toBe("needs input/output");
    expect(connectionStateForNode(graph.nodes[2], graph.edges)).toBe("needs input");
  });

  it("keeps extra sinks unconnected until the user chooses them", () => {
    const graph: PipelineGraph = {
      nodes: [source("source"), handler("handler"), sink("mysql"), sink("http")],
      edges: [
        { from: "source", to: "handler" },
        { from: "handler", to: "mysql" }
      ]
    };

    expect(connectionStateForNode(graph.nodes[1], graph.edges)).toBeNull();
    expect(connectionStateForNode(graph.nodes[2], graph.edges)).toBeNull();
    expect(connectionStateForNode(graph.nodes[3], graph.edges)).toBe("needs input");
  });

  it("places new nodes in visible non-overlapping rows", () => {
    expect(nextNodePosition(graphWithNodes(), "source")).toEqual({ x: 40, y: 80 });
    expect(nextNodePosition(graphWithNodes(source("source")), "handler")).toEqual({ x: 330, y: 80 });
    expect(nextNodePosition(graphWithNodes(source("source"), handler("handler")), "sink")).toEqual({
      x: 620,
      y: 80
    });
    expect(nextNodePosition(graphWithNodes(source("a"), source("b"), handler("handler")), "source")).toEqual({
      x: 40,
      y: 320
    });
  });

  it("generates unique node ids after prior additions or deletions", () => {
    const graph = graphWithNodes(source("n1"), handler("n3"));

    expect(nextGraphNodeId(graph)).toBe("n4");
  });
});

describe("graph editing", () => {
  it("removes connected edges when a node is deleted", () => {
    const graph: PipelineGraph = {
      nodes: [source("source"), handler("handler"), sink("sink"), sink("audit")],
      edges: [
        { from: "source", to: "handler" },
        { from: "handler", to: "sink" },
        { from: "handler", to: "audit", condition: 'status == "paid"' }
      ]
    };

    expect(removeGraphNode(graph, "handler")).toEqual({
      nodes: [graph.nodes[0], graph.nodes[2], graph.nodes[3]],
      edges: []
    });
  });

  it("removes only connected edges when a node is disconnected", () => {
    const graph: PipelineGraph = {
      nodes: [source("source"), handler("handler"), sink("sink"), sink("audit")],
      edges: [
        { from: "source", to: "handler" },
        { from: "handler", to: "sink" },
        { from: "source", to: "audit" }
      ]
    };

    expect(disconnectGraphNode(graph, "handler")).toEqual({
      nodes: graph.nodes,
      edges: [{ from: "source", to: "audit" }]
    });
  });

  it("duplicates a node with a unique id and offset position", () => {
    const graph: PipelineGraph = {
      nodes: [handler("handler"), handler("handler_copy")],
      edges: []
    };
    graph.nodes[0] = {
      ...graph.nodes[0],
      config: { queue: "orders" },
      mapping: { id: "{{order_id}}" },
      input_schema: { type: "object" },
      position: { x: 120, y: 180 }
    };

    expect(duplicateGraphNode(graph, "handler")).toEqual({
      graph: {
        nodes: [
          graph.nodes[0],
          graph.nodes[1],
          {
            ...graph.nodes[0],
            id: "handler_copy_2",
            config: { queue: "orders" },
            mapping: { id: "{{order_id}}" },
            input_schema: { type: "object" },
            position: { x: 156, y: 216 }
          }
        ],
        edges: []
      },
      nodeId: "handler_copy_2"
    });
  });
});

describe("condition validation", () => {
  it("accepts plain and template-wrapped condition expressions", () => {
    expect(validateConditionExpression('status == "paid"')).toBeNull();
    expect(validateConditionExpression('{{ amount >= 100 and status == "paid" }}')).toBeNull();
    expect(validateConditionExpression("")).toBeNull();
  });

  it("rejects common invalid condition expressions", () => {
    expect(validateConditionExpression('status = "paid"')).toBe("Use == for comparisons; assignments are not valid conditions.");
    expect(validateConditionExpression('status == "paid')).toBe("Unclosed string literal.");
    expect(validateConditionExpression("(amount > 100")).toBe('Unclosed "(".');
    expect(validateConditionExpression("status ==")).toBe("Condition cannot end with an operator.");
    expect(validateConditionExpression('status == "paid" && amount > 100')).toBe("Use Python-style and/or instead of &&/||.");
  });

  it("validates conditions against graph edge semantics", () => {
    const graph: PipelineGraph = {
      nodes: [source("source"), handler("handler"), sink("sink")],
      edges: [
        { from: "source", to: "handler", condition: 'status == "paid"' },
        { from: "handler", to: "sink", condition: "amount ==" }
      ]
    };

    expect(validatePipelineGraphConditions(graph)).toEqual([
      "Connection source -> handler: conditions can only start from handler nodes.",
      "Connection handler -> sink: Condition cannot end with an operator."
    ]);
  });
});

function graphWithNodes(...nodes: GraphNode[]): PipelineGraph {
  return { nodes, edges: [] };
}

function source(id: string): GraphNode {
  return node(id, "mysql_source", "source");
}

function handler(id: string): GraphNode {
  return node(id, "handler", "handler");
}

function sink(id: string): GraphNode {
  return node(id, "mysql_sink", "sink");
}

function node(id: string, type: string, kind: GraphNode["kind"]): GraphNode {
  return {
    id,
    type,
    kind,
    config: {},
    mapping: {},
    input_schema: {},
    position: { x: 0, y: 0 }
  };
}
