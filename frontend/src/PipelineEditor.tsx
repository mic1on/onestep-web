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
import { useMemo } from "react";
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

  return (
    <main className="builder-grid">
      <NodePalette connectors={connectors} onAddNode={addConnectorNode} />
      <section className="canvas-shell" aria-label="Pipeline canvas">
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
        onChange={updateNode}
      />
    </main>
  );
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
