import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  ConnectionLineType,
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
import { memo, useCallback, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { ConnectorDescriptor, Credential, GraphEdge, GraphNode, PipelineGraph } from "./types";
import { NodePalette } from "./NodePalette";
import { PropertyPanel } from "./PropertyPanel";

type ConnectionHandles = {
  source: boolean;
  target: boolean;
};

type PipelineNodeData = {
  label?: string;
  nodeId?: string;
  kind?: GraphNode["kind"];
  connectionState?: string | null;
};

type CanvasContextMenu = {
  target: "node" | "edge";
  id: string;
  x: number;
  y: number;
};

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
  const [debugSamples, setDebugSamples] = useState<Record<string, unknown>>({});
  const [connectionError, setConnectionError] = useState("");
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<CanvasContextMenu | null>(null);
  const canvasRef = useRef<HTMLElement | null>(null);
  const nodes = useMemo(
    () => graph.nodes.map((node) => toFlowNode(node, graph.edges, selectedNodeId)),
    [graph.edges, graph.nodes, selectedNodeId]
  );
  const edges = useMemo(
    () => graph.edges.map((edge) => toFlowEdge(edge, selectedEdgeId)),
    [graph.edges, selectedEdgeId]
  );
  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedConnector = selectedNode
    ? connectors.find((connector) => connector.type === selectedNode.type) ?? null
    : null;
  const upstreamSample = selectedNode ? firstUpstreamSample(selectedNode.id, graph, debugSamples) : null;
  const selectedGraphEdge = selectedEdgeId
    ? graph.edges.find((edge) => flowEdgeId(edge) === selectedEdgeId) ?? null
    : null;
  const selectedGraphEdgeSource = selectedGraphEdge
    ? graph.nodes.find((node) => node.id === selectedGraphEdge.from) ?? null
    : null;

  const updateFromFlow = useCallback(
    (nextNodes: Node[], nextEdges: Edge[]) => {
      const nextGraph: PipelineGraph = {
        nodes: nextNodes.map((node) => {
          const previous = graph.nodes.find((item) => item.id === node.id);
          return {
            ...(previous ?? createGraphNode(node.id, "handler", "handler", node.position)),
            position: node.position
          };
        }),
        edges: nextEdges.map((edge) => {
          const from = String(edge.source);
          const to = String(edge.target);
          const previous = graph.edges.find((item) => item.from === from && item.to === to);
          return {
            ...(previous ?? {}),
            from,
            to
          };
        })
      };
      onGraphChange(nextGraph);
    },
    [graph.edges, graph.nodes, onGraphChange]
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const graphChanges = changes.filter((change) => change.type !== "select" && change.type !== "dimensions");
      if (!graphChanges.length) {
        return;
      }
      updateFromFlow(applyNodeChanges(graphChanges, nodes), edges);
    },
    [edges, nodes, updateFromFlow]
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const graphChanges = changes.filter((change) => change.type !== "select");
      if (!graphChanges.length) {
        return;
      }
      if (
        selectedEdgeId &&
        graphChanges.some((change) => "id" in change && change.id === selectedEdgeId && change.type === "remove")
      ) {
        setSelectedEdgeId(null);
      }
      updateFromFlow(nodes, applyEdgeChanges(graphChanges, edges));
    },
    [edges, nodes, selectedEdgeId, updateFromFlow]
  );

  const handleConnect = useCallback((connection: Connection) => {
    const error = validateGraphConnection(graph, connection.source, connection.target);
    if (error) {
      setSelectedEdgeId(null);
      setConnectionError(error);
      return;
    }
    setConnectionError("");
    setSelectedEdgeId(null);
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
  }, [edges, graph, nodes, updateFromFlow]);

  const deleteSelectedEdge = useCallback(() => {
    if (!selectedEdgeId) {
      return;
    }
    updateFromFlow(
      nodes,
      edges.filter((edge) => edge.id !== selectedEdgeId)
    );
    setSelectedEdgeId(null);
  }, [edges, nodes, selectedEdgeId, updateFromFlow]);

  const deleteNode = useCallback((nodeId: string) => {
    onGraphChange(removeGraphNode(graph, nodeId));
    setDebugSamples((current) => {
      const next = { ...current };
      delete next[nodeId];
      return next;
    });
    setConnectionError("");
    setContextMenu(null);
    setSelectedEdgeId(null);
    if (selectedNodeId === nodeId) {
      onSelectedNodeChange(null);
    }
  }, [graph, onGraphChange, onSelectedNodeChange, selectedNodeId]);

  const deleteEdge = useCallback((edgeId: string) => {
    updateFromFlow(
      nodes,
      edges.filter((edge) => edge.id !== edgeId)
    );
    setConnectionError("");
    setContextMenu(null);
    if (selectedEdgeId === edgeId) {
      setSelectedEdgeId(null);
    }
  }, [edges, nodes, selectedEdgeId, updateFromFlow]);

  const clearEdgeCondition = useCallback((edgeId: string) => {
    onGraphChange({
      ...graph,
      edges: graph.edges.map((edge) =>
        flowEdgeId(edge) === edgeId
          ? { ...edge, condition: null }
          : edge
      )
    });
    setContextMenu(null);
  }, [graph, onGraphChange]);

  const updateSelectedEdgeCondition = useCallback((condition: string) => {
    if (!selectedEdgeId) {
      return;
    }
    const nextCondition = condition.trim() ? condition : null;
    onGraphChange({
      ...graph,
      edges: graph.edges.map((edge) =>
        flowEdgeId(edge) === selectedEdgeId
          ? { ...edge, condition: nextCondition }
          : edge
      )
    });
  }, [graph, onGraphChange, selectedEdgeId]);

  const addConnectorNode = useCallback((connector: ConnectorDescriptor) => {
    const count = graph.nodes.length + 1;
    const nextNode = createGraphNode(
      `n${count}`,
      connector.type,
      connector.category,
      nextNodePosition(graph, connector.category)
    );
    onGraphChange({ ...graph, nodes: [...graph.nodes, nextNode] });
    setConnectionError("");
    setSelectedEdgeId(null);
    onSelectedNodeChange(nextNode.id);
  }, [graph, onGraphChange, onSelectedNodeChange]);

  const updateNode = useCallback((node: GraphNode) => {
    onGraphChange({
      ...graph,
      nodes: graph.nodes.map((item) => (item.id === node.id ? node : item))
    });
  }, [graph, onGraphChange]);

  const updateDebugSample = useCallback((nodeId: string, sample: unknown) => {
    setDebugSamples((current) => ({ ...current, [nodeId]: sample }));
  }, []);

  const handleEdgeClick = useCallback((_: unknown, edge: Edge) => {
    setConnectionError("");
    setContextMenu(null);
    setSelectedEdgeId(String(edge.id));
    onSelectedNodeChange(null);
  }, [onSelectedNodeChange]);

  const handleNodeClick = useCallback((_: unknown, node: Node) => {
    setContextMenu(null);
    setSelectedEdgeId(null);
    onSelectedNodeChange(String(node.id));
  }, [onSelectedNodeChange]);

  const handlePaneClick = useCallback(() => {
    setContextMenu(null);
    setSelectedEdgeId(null);
    onSelectedNodeChange(null);
  }, [onSelectedNodeChange]);

  const handlePaneContextMenu = useCallback((event: MouseEvent | ReactMouseEvent) => {
    event.preventDefault();
    setContextMenu(null);
  }, []);

  const openContextMenu = useCallback(
    (event: ReactMouseEvent, target: CanvasContextMenu["target"], id: string) => {
      event.preventDefault();
      event.stopPropagation();
      const bounds = canvasRef.current?.getBoundingClientRect();
      setContextMenu({
        target,
        id,
        x: Math.max(8, event.clientX - (bounds?.left ?? 0)),
        y: Math.max(8, event.clientY - (bounds?.top ?? 0))
      });
      setConnectionError("");
      if (target === "node") {
        setSelectedEdgeId(null);
        onSelectedNodeChange(id);
      } else {
        setSelectedEdgeId(id);
        onSelectedNodeChange(null);
      }
    },
    [onSelectedNodeChange]
  );

  const handleNodeContextMenu = useCallback(
    (event: ReactMouseEvent, node: Node) => {
      openContextMenu(event, "node", String(node.id));
    },
    [openContextMenu]
  );

  const handleEdgeContextMenu = useCallback(
    (event: ReactMouseEvent, edge: Edge) => {
      openContextMenu(event, "edge", String(edge.id));
    },
    [openContextMenu]
  );

  const contextGraphNode = contextMenu?.target === "node"
    ? graph.nodes.find((node) => node.id === contextMenu.id) ?? null
    : null;
  const contextGraphEdge = contextMenu?.target === "edge"
    ? graph.edges.find((edge) => flowEdgeId(edge) === contextMenu.id) ?? null
    : null;

  return (
    <main className="builder-grid">
      <NodePalette connectors={connectors} onAddNode={addConnectorNode} />
      <section className="canvas-shell" aria-label="Pipeline canvas" ref={canvasRef}>
        {connectionError ? <div className="canvas-alert">{connectionError}</div> : null}
        {selectedGraphEdge ? (
          <div className="canvas-alert canvas-edge-toolbar">
            <span>
              Connection {selectedGraphEdge.from}
              {" -> "}
              {selectedGraphEdge.to}
            </span>
            {selectedGraphEdgeSource?.kind === "handler" ? (
              <label className="edge-condition-field">
                <span>Condition</span>
                <input
                  onChange={(event) => updateSelectedEdgeCondition(event.target.value)}
                  placeholder='status == "paid"'
                  value={selectedGraphEdge.condition ?? ""}
                />
              </label>
            ) : null}
            <button onClick={deleteSelectedEdge} type="button">
              Delete Connection
            </button>
          </div>
        ) : null}
        {contextMenu ? (
          <div
            className="canvas-context-menu"
            onClick={(event) => event.stopPropagation()}
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            {contextGraphNode ? (
              <>
                <button
                  onClick={() => {
                    onSelectedNodeChange(contextGraphNode.id);
                    setContextMenu(null);
                  }}
                  type="button"
                >
                  Configure Node
                </button>
                <button onClick={() => deleteNode(contextGraphNode.id)} type="button">
                  Delete Node
                </button>
              </>
            ) : null}
            {contextGraphEdge ? (
              <>
                <button
                  onClick={() => {
                    setSelectedEdgeId(flowEdgeId(contextGraphEdge));
                    setContextMenu(null);
                  }}
                  type="button"
                >
                  Select Connection
                </button>
                {contextGraphEdge.condition ? (
                  <button onClick={() => clearEdgeCondition(flowEdgeId(contextGraphEdge))} type="button">
                    Clear Condition
                  </button>
                ) : null}
                <button onClick={() => deleteEdge(flowEdgeId(contextGraphEdge))} type="button">
                  Delete Connection
                </button>
              </>
            ) : null}
          </div>
        ) : null}
        <ReactFlow
          autoPanOnConnect
          autoPanOnNodeDrag
          connectionLineStyle={CONNECTION_LINE_STYLE}
          connectionLineType={ConnectionLineType.Straight}
          connectionRadius={28}
          defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
          defaultViewport={DEFAULT_VIEWPORT}
          edges={edges}
          elevateEdgesOnSelect
          nodeDragThreshold={2}
          nodeTypes={PIPELINE_NODE_TYPES}
          nodes={nodes}
          onConnect={handleConnect}
          onEdgesChange={handleEdgesChange}
          onEdgeClick={handleEdgeClick}
          onEdgeContextMenu={handleEdgeContextMenu}
          onNodeClick={handleNodeClick}
          onNodeContextMenu={handleNodeContextMenu}
          onNodesChange={handleNodesChange}
          onPaneClick={handlePaneClick}
          onPaneContextMenu={handlePaneContextMenu}
          paneClickDistance={3}
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

export function removeGraphNode(graph: PipelineGraph, nodeId: string): PipelineGraph {
  return {
    nodes: graph.nodes.filter((node) => node.id !== nodeId),
    edges: graph.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId)
  };
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

function toFlowNode(
  node: GraphNode,
  edges: Array<{ from: string; to: string }>,
  selectedNodeId: string | null
): Node {
  const connectionState = connectionStateForNode(node, edges);
  return {
    id: node.id,
    position: node.position,
    selected: node.id === selectedNodeId,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    data: {
      label: node.type,
      nodeId: node.id,
      kind: node.kind,
      connectionState
    },
    type: "pipelineNode",
    measured: { width: PIPELINE_NODE_WIDTH, height: PIPELINE_NODE_HEIGHT },
    initialWidth: PIPELINE_NODE_WIDTH,
    initialHeight: PIPELINE_NODE_HEIGHT,
    style: { width: PIPELINE_NODE_WIDTH, height: PIPELINE_NODE_HEIGHT },
    className: connectionState ? "needs-connection" : undefined
  };
}

function toFlowEdge(edge: GraphEdge, selectedEdgeId: string | null): Edge {
  const id = flowEdgeId(edge);
  const condition = edge.condition?.trim();
  return {
    id,
    source: edge.from,
    target: edge.to,
    type: "smoothstep",
    label: condition || undefined,
    labelBgPadding: [8, 4],
    labelBgBorderRadius: 2,
    labelBgStyle: { fill: "#fff" },
    labelStyle: { fontSize: 12, fontWeight: 700 },
    markerEnd: { type: MarkerType.ArrowClosed },
    animated: true,
    style: { strokeDasharray: condition ? "6 4" : undefined, strokeWidth: 2 },
    selected: id === selectedEdgeId
  };
}

function flowEdgeId(edge: Pick<GraphEdge, "from" | "to">): string {
  return `${edge.from}-${edge.to}`;
}

export function nextNodePosition(graph: PipelineGraph, kind: GraphNode["kind"]): { x: number; y: number } {
  const columnX = {
    source: 40,
    handler: 330,
    sink: 620
  }[kind];
  const row = graph.nodes.filter((node) => node.kind === kind).length;
  return {
    x: columnX,
    y: 80 + row * 120
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

export function handlesForNodeKind(kind: GraphNode["kind"]): ConnectionHandles {
  return {
    source: kind !== "sink",
    target: kind !== "source"
  };
}

export function connectionStateForNode(
  node: Pick<GraphNode, "id" | "kind">,
  edges: Array<{ from: string; to: string }>
): string | null {
  const hasIncoming = edges.some((edge) => edge.to === node.id);
  const hasOutgoing = edges.some((edge) => edge.from === node.id);

  if (node.kind === "source") {
    return hasOutgoing ? null : "needs output";
  }
  if (node.kind === "sink") {
    return hasIncoming ? null : "needs input";
  }
  if (!hasIncoming && !hasOutgoing) {
    return "needs input/output";
  }
  if (!hasIncoming) {
    return "needs input";
  }
  if (!hasOutgoing) {
    return "needs output";
  }
  return null;
}

const PipelineFlowNode = memo(function PipelineFlowNode({ data }: { data: PipelineNodeData }) {
  const kind = data.kind ?? "handler";
  const handles = handlesForNodeKind(kind);
  return (
    <div className={`pipeline-flow-node ${kind}`}>
      {handles.target ? <Handle className="pipeline-handle target-handle" type="target" position={Position.Left} /> : null}
      <span>{kind}</span>
      <strong>{data.label}</strong>
      <small className={data.connectionState ? "connection-state" : undefined}>
        {data.connectionState ?? data.nodeId}
      </small>
      {handles.source ? <Handle className="pipeline-handle source-handle" type="source" position={Position.Right} /> : null}
    </div>
  );
});

const PIPELINE_NODE_TYPES = { pipelineNode: PipelineFlowNode };
const PIPELINE_NODE_WIDTH = 220;
const PIPELINE_NODE_HEIGHT = 74;

const DEFAULT_EDGE_OPTIONS: Partial<Edge> = {
  animated: true,
  markerEnd: { type: MarkerType.ArrowClosed },
  style: { strokeWidth: 2 },
  type: "smoothstep"
};

const CONNECTION_LINE_STYLE = { strokeWidth: 2 };
const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 1 };
