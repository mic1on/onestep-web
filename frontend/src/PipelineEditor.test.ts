import { describe, expect, it } from "vitest";
import { validateGraphConnection } from "./PipelineEditor";
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
