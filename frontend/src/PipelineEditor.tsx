import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Controls,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  Handle,
  type Node,
  type NodeChange
} from "@xyflow/react";
import { useMemo, useState } from "react";
import type { ConnectorDescriptor, Credential, GraphNode, PipelineGraph } from "./types";
import { NodePalette } from "./NodePalette";
import { PropertyPanel } from "./PropertyPanel";

type PipelineEditorProps = {
  graph: PipelineGraph;
  connectors: ConnectorDescriptor[];
  credentials: Credential[];
  selectedNodeId: string | null;
  onGraphChange: (graph: PipelineGraph) => void;
  onSelectedNodeChange: (nodeId: string | null) => void;
};

export function PipelineEditor({
  graph,
  connectors,
  credentials,
  selectedNodeId,
  onGraphChange,
  onSelectedNodeChange
}: PipelineEditorProps) {
  const nodes = graph.nodes.map(toFlowNode);
  const edges = graph.edges.map(toFlowEdge);
  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedConnector = selectedNode
    ? connectors.find((connector) => connector.type === selectedNode.type) ?? null
    : null;
  const nodeTypes = useMemo(() => ({ pipelineNode: PipelineFlowNode }), []);
  const [debugSamples, setDebugSamples] = useState<Record<string, unknown>>({});
  const [connectionError, setConnectionError] = useState("");
  const upstreamSample = selectedNode ? firstUpstreamSample(selectedNode.id, graph, debugSamples) : null;

  function updateFromFlow(nextNodes: Node[], nextEdges: Edge[]) {
    const nextGraph: PipelineGraph = {
      nodes: nextNodes.map((node) => {
        const previous = graph.nodes.find((item) => item.id === node.id);
        return {
          ...(previous ?? createGraphNode(node.id, "handler", "handler", node.position)),
          position: node.position
        };
      }),
      edges: nextEdges.map((edge) => ({ from: String(edge.source), to: String(edge.target) }))
    };
    onGraphChange(nextGraph);
  }

  function handleNodesChange(changes: NodeChange[]) {
    updateFromFlow(applyNodeChanges(changes, nodes), edges);
  }

  function handleEdgesChange(changes: EdgeChange[]) {
    updateFromFlow(nodes, applyEdgeChanges(changes, edges));
  }

  function handleConnect(connection: Connection) {
    const error = validateGraphConnection(graph, connection.source, connection.target);
    if (error) {
      setConnectionError(error);
      return;
    }
    setConnectionError("");
    updateFromFlow(
      nodes,
      addEdge(
        {
          ...connection,
          markerEnd: { type: MarkerType.ArrowClosed },
          animated: true
        },
        edges
      )
    );
  }

  function addConnectorNode(connector: ConnectorDescriptor) {
    const count = graph.nodes.length + 1;
    const nextNode = createGraphNode(
      `n${count}`,
      connector.type,
      connector.category,
      { x: 120 + count * 80, y: 140 + count * 22 }
    );
    onGraphChange({ ...graph, nodes: [...graph.nodes, nextNode] });
    onSelectedNodeChange(nextNode.id);
  }

  function updateNode(node: GraphNode) {
    onGraphChange({
      ...graph,
      nodes: graph.nodes.map((item) => (item.id === node.id ? node : item))
    });
  }

  function updateDebugSample(nodeId: string, sample: unknown) {
    setDebugSamples((current) => ({ ...current, [nodeId]: sample }));
  }

  return (
    <main className="builder-grid">
      <NodePalette connectors={connectors} onAddNode={addConnectorNode} />
      <section className="canvas-shell" aria-label="Pipeline canvas">
        {connectionError ? <div className="canvas-alert">{connectionError}</div> : null}
        <ReactFlow
          edges={edges}
          fitView
          nodeTypes={nodeTypes}
          nodes={nodes}
          onConnect={handleConnect}
          onEdgesChange={handleEdgesChange}
          onNodeClick={(_, node) => onSelectedNodeChange(String(node.id))}
          onNodesChange={handleNodesChange}
          onPaneClick={() => onSelectedNodeChange(null)}
        >
          <Background gap={24} />
          <MiniMap pannable zoomable />
          <Controls />
        </ReactFlow>
      </section>
      <PropertyPanel
        connector={selectedConnector}
        credentials={credentials}
        node={selectedNode}
        onDebugSample={updateDebugSample}
        onChange={updateNode}
        upstreamSample={upstreamSample}
      />
    </main>
  );
}

export function validateGraphConnection(
  graph: PipelineGraph,
  sourceId: string | null,
  targetId: string | null
): string | null {
  if (!sourceId || !targetId) {
    return "Connection must have both a source and a target node.";
  }
  if (sourceId === targetId) {
    return "A node cannot connect to itself.";
  }

  const source = graph.nodes.find((node) => node.id === sourceId);
  const target = graph.nodes.find((node) => node.id === targetId);
  if (!source || !target) {
    return "Connection references a missing node.";
  }
  if (source.kind === "sink") {
    return "Sink nodes cannot have outgoing edges.";
  }
  if (target.kind === "source") {
    return "Source nodes cannot have incoming edges.";
  }
  if (graph.edges.some((edge) => edge.from === sourceId && edge.to === targetId)) {
    return "This connection already exists.";
  }
  if (wouldCreateCycle(graph, sourceId, targetId)) {
    return "This connection would create a cycle.";
  }
  return null;
}

function wouldCreateCycle(graph: PipelineGraph, sourceId: string, targetId: string): boolean {
  const outgoing = new Map<string, string[]>();
  for (const node of graph.nodes) {
    outgoing.set(node.id, []);
  }
  for (const edge of graph.edges) {
    outgoing.get(edge.from)?.push(edge.to);
  }
  outgoing.get(sourceId)?.push(targetId);

  const seen = new Set<string>();
  const stack = [targetId];
  while (stack.length) {
    const current = stack.pop();
    if (!current || seen.has(current)) {
      continue;
    }
    if (current === sourceId) {
      return true;
    }
    seen.add(current);
    stack.push(...(outgoing.get(current) ?? []));
  }
  return false;
}

function firstUpstreamSample(
  nodeId: string,
  graph: PipelineGraph,
  samples: Record<string, unknown>
): unknown {
  const upstream = graph.edges.find((edge) => edge.to === nodeId);
  if (!upstream) {
    return null;
  }
  return samples[upstream.from] ?? null;
}

function toFlowNode(node: GraphNode): Node {
  return {
    id: node.id,
    position: node.position,
    data: {
      label: node.type,
      nodeId: node.id,
      kind: node.kind
    },
    type: "pipelineNode",
    width: 220,
    height: 74,
    style: { width: 220, height: 74 }
  };
}

function toFlowEdge(edge: { from: string; to: string }): Edge {
  return {
    id: `${edge.from}-${edge.to}`,
    source: edge.from,
    target: edge.to,
    markerEnd: { type: MarkerType.ArrowClosed },
    animated: true
  };
}

function createGraphNode(id: string, type: string, kind: GraphNode["kind"], position: { x: number; y: number }): GraphNode {
  return {
    id,
    type,
    kind,
    config: {},
    mapping: kind === "handler" ? { id: "{{order_id}}" } : {},
    mode: kind === "handler" ? "visual" : null,
    input_schema: {},
    position
  };
}

function PipelineFlowNode({ data }: { data: { label?: string; nodeId?: string; kind?: string } }) {
  return (
    <div className={`pipeline-flow-node ${data.kind ?? "handler"}`}>
      <Handle type="target" position={Position.Top} />
      <span>{data.kind}</span>
      <strong>{data.label}</strong>
      <small>{data.nodeId}</small>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
