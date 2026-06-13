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
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type SyntheticEvent
} from "react";
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
  hasConnections?: boolean;
  onConfigure?: (nodeId: string) => void;
  onDelete?: (nodeId: string) => void;
  onDisconnect?: (nodeId: string) => void;
  onDuplicate?: (nodeId: string) => void;
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
  const selectedEdgeConditionError = selectedGraphEdge
    ? validateGraphEdgeCondition(graph, selectedGraphEdge)
    : null;
  const selectedEdgeConditionFields = selectedGraphEdgeSource?.kind === "handler"
    ? conditionFieldSuggestions(debugSamples[selectedGraphEdgeSource.id])
    : [];

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

  const configureNode = useCallback((nodeId: string) => {
    setConnectionError("");
    setContextMenu(null);
    setSelectedEdgeId(null);
    onSelectedNodeChange(nodeId);
  }, [onSelectedNodeChange]);

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

  const disconnectNode = useCallback((nodeId: string) => {
    onGraphChange(disconnectGraphNode(graph, nodeId));
    setConnectionError("");
    setContextMenu(null);
    setSelectedEdgeId(null);
    onSelectedNodeChange(nodeId);
  }, [graph, onGraphChange, onSelectedNodeChange]);

  const duplicateNode = useCallback((nodeId: string) => {
    const duplicated = duplicateGraphNode(graph, nodeId);
    if (!duplicated) {
      return;
    }
    onGraphChange(duplicated.graph);
    setConnectionError("");
    setContextMenu(null);
    setSelectedEdgeId(null);
    onSelectedNodeChange(duplicated.nodeId);
  }, [graph, onGraphChange, onSelectedNodeChange]);

  const nodeActions = useMemo(
    () => ({
      onConfigure: configureNode,
      onDelete: deleteNode,
      onDisconnect: disconnectNode,
      onDuplicate: duplicateNode
    }),
    [configureNode, deleteNode, disconnectNode, duplicateNode]
  );

  const nodes = useMemo(
    () => graph.nodes.map((node) => toFlowNode(node, graph.edges, selectedNodeId, nodeActions)),
    [graph.edges, graph.nodes, nodeActions, selectedNodeId]
  );
  const edges = useMemo(
    () => graph.edges.map((edge) => toFlowEdge(edge, selectedEdgeId)),
    [graph.edges, selectedEdgeId]
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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target)) {
        return;
      }
      if (event.key === "Escape") {
        setConnectionError("");
        setContextMenu(null);
        setSelectedEdgeId(null);
        onSelectedNodeChange(null);
        return;
      }
      if (event.key !== "Delete" && event.key !== "Backspace") {
        return;
      }
      if (selectedNodeId) {
        event.preventDefault();
        deleteNode(selectedNodeId);
        return;
      }
      if (selectedEdgeId) {
        event.preventDefault();
        deleteEdge(selectedEdgeId);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deleteEdge, deleteNode, onSelectedNodeChange, selectedEdgeId, selectedNodeId]);

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

  const insertSelectedEdgeConditionField = useCallback((fieldName: string) => {
    if (!selectedGraphEdge) {
      return;
    }
    const current = selectedGraphEdge.condition?.trim() ?? "";
    updateSelectedEdgeCondition(current ? `${current} and ${fieldName} == ""` : `${fieldName} == ""`);
  }, [selectedGraphEdge, updateSelectedEdgeCondition]);

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
  const contextNodeHasConnections = contextGraphNode
    ? graph.edges.some((edge) => edge.from === contextGraphNode.id || edge.to === contextGraphNode.id)
    : false;

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
              <div className={`edge-condition-editor ${selectedEdgeConditionError ? "invalid" : ""}`}>
                <label className="edge-condition-field">
                  <span>When</span>
                  <input
                    aria-invalid={selectedEdgeConditionError ? "true" : "false"}
                    onChange={(event) => updateSelectedEdgeCondition(event.target.value)}
                    placeholder='status == "paid"'
                    value={selectedGraphEdge.condition ?? ""}
                  />
                </label>
                {selectedEdgeConditionFields.length ? (
                  <div className="condition-field-suggestions">
                    <span>Fields</span>
                    {selectedEdgeConditionFields.map((field) => (
                      <button
                        key={field}
                        onClick={() => insertSelectedEdgeConditionField(field)}
                        type="button"
                      >
                        {field}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="edge-condition-hint">Use handler result fields. Empty means always emit.</p>
                )}
                {selectedEdgeConditionError ? (
                  <p className="edge-condition-error">{selectedEdgeConditionError}</p>
                ) : null}
              </div>
            ) : selectedEdgeConditionError ? (
              <p className="edge-condition-error">{selectedEdgeConditionError}</p>
            ) : null}
            {selectedGraphEdge.condition ? (
              <button onClick={() => clearEdgeCondition(flowEdgeId(selectedGraphEdge))} type="button">
                Clear Condition
              </button>
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
                <button onClick={() => configureNode(contextGraphNode.id)} type="button">
                  Configure Node
                </button>
                <button onClick={() => duplicateNode(contextGraphNode.id)} type="button">
                  Duplicate Node
                </button>
                <button
                  disabled={!contextNodeHasConnections}
                  onClick={() => disconnectNode(contextGraphNode.id)}
                  type="button"
                >
                  Disconnect Node
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
          connectionLineType={ConnectionLineType.SmoothStep}
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

export function disconnectGraphNode(graph: PipelineGraph, nodeId: string): PipelineGraph {
  return {
    ...graph,
    edges: graph.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId)
  };
}

export function duplicateGraphNode(
  graph: PipelineGraph,
  nodeId: string
): { graph: PipelineGraph; nodeId: string } | null {
  const node = graph.nodes.find((item) => item.id === nodeId);
  if (!node) {
    return null;
  }
  const nextNodeId = nextDuplicateNodeId(graph, nodeId);
  const nextNode: GraphNode = {
    ...node,
    id: nextNodeId,
    config: { ...node.config },
    mapping: { ...node.mapping },
    input_schema: { ...node.input_schema },
    position: {
      x: node.position.x + 36,
      y: node.position.y + 36
    }
  };
  return {
    graph: {
      ...graph,
      nodes: [...graph.nodes, nextNode]
    },
    nodeId: nextNodeId
  };
}

export function validatePipelineGraphConditions(graph: PipelineGraph): string[] {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const errors: string[] = [];
  for (const edge of graph.edges) {
    const error = validateGraphEdgeCondition(graph, edge, nodesById);
    if (error) {
      errors.push(`Connection ${edge.from} -> ${edge.to}: ${error}`);
    }
  }
  return errors;
}

function validateGraphEdgeCondition(
  graph: PipelineGraph,
  edge: GraphEdge,
  nodesById = new Map(graph.nodes.map((node) => [node.id, node]))
): string | null {
  const condition = edge.condition?.trim();
  if (!condition) {
    return null;
  }
  const source = nodesById.get(edge.from);
  if (!source) {
    return "condition references a missing source node.";
  }
  if (source.kind !== "handler") {
    return "conditions can only start from handler nodes.";
  }
  return validateConditionExpression(condition);
}

export function validateConditionExpression(condition: string): string | null {
  const trimmed = condition.trim();
  if (!trimmed) {
    return null;
  }
  if ((trimmed.startsWith("{{") && !trimmed.endsWith("}}")) || (!trimmed.startsWith("{{") && trimmed.endsWith("}}"))) {
    return "Template condition must use matching {{ }} braces.";
  }

  const expression = conditionExpressionBody(trimmed);
  if (!expression) {
    return "Condition cannot be empty.";
  }
  if (expression.includes("&&") || expression.includes("||")) {
    return "Use Python-style and/or instead of &&/||.";
  }
  if (expression.includes(";")) {
    return "Condition must be a single expression.";
  }
  if (/(^|[^=!<>])=($|[^=])/.test(expression)) {
    return "Use == for comparisons; assignments are not valid conditions.";
  }
  if (/^(==|!=|<=|>=|<|>|\band\b|\bor\b)/.test(expression.trim())) {
    return "Condition cannot start with an operator.";
  }
  if (/(\band\b|\bor\b|==|!=|<=|>=|<|>|[+\-*/%])\s*$/.test(expression)) {
    return "Condition cannot end with an operator.";
  }
  return validateBalancedExpression(expression);
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
  selectedNodeId: string | null,
  actions: Pick<PipelineNodeData, "onConfigure" | "onDelete" | "onDisconnect" | "onDuplicate">
): Node {
  const connectionState = connectionStateForNode(node, edges);
  const hasConnections = edges.some((edge) => edge.from === node.id || edge.to === node.id);
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
      connectionState,
      hasConnections,
      ...actions
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
    interactionWidth: 24,
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

function conditionExpressionBody(condition: string): string {
  const match = /^\{\{\s*(.*?)\s*\}\}$/.exec(condition);
  return (match ? match[1] : condition).trim();
}

function validateBalancedExpression(expression: string): string | null {
  const stack: string[] = [];
  let quote: "\"" | "'" | null = null;
  let escaped = false;
  const opening = new Set(["(", "[", "{"]);
  const closing: Record<string, string> = {
    ")": "(",
    "]": "[",
    "}": "{"
  };

  for (const char of expression) {
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (opening.has(char)) {
      stack.push(char);
      continue;
    }
    const expected = closing[char];
    if (expected) {
      const actual = stack.pop();
      if (actual !== expected) {
        return `Unexpected "${char}".`;
      }
    }
  }

  if (quote) {
    return "Unclosed string literal.";
  }
  const unclosed = stack.pop();
  if (unclosed) {
    return `Unclosed "${unclosed}".`;
  }
  return null;
}

function conditionFieldSuggestions(value: unknown): string[] {
  const sample = Array.isArray(value) ? value[0] : value;
  if (!sample || typeof sample !== "object") {
    return [];
  }
  return Object.keys(sample)
    .filter((key) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
    .slice(0, 8);
}

function nextDuplicateNodeId(graph: PipelineGraph, nodeId: string): string {
  const existingIds = new Set(graph.nodes.map((node) => node.id));
  let index = 1;
  let candidate = `${nodeId}_copy`;
  while (existingIds.has(candidate)) {
    index += 1;
    candidate = `${nodeId}_copy_${index}`;
  }
  return candidate;
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select" || target.isContentEditable;
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
  const nodeId = data.nodeId ?? "";
  const handles = handlesForNodeKind(kind);
  const stopNodeAction = (event: SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  return (
    <div className={`pipeline-flow-node ${kind}`}>
      {handles.target ? <Handle className="pipeline-handle target-handle" type="target" position={Position.Left} /> : null}
      {nodeId ? (
        <div className="node-quick-actions">
          <button
            className="nodrag"
            onClick={(event) => {
              stopNodeAction(event);
              data.onConfigure?.(nodeId);
            }}
            onPointerDown={stopNodeAction}
            title="Configure node"
            type="button"
          >
            Edit
          </button>
          <button
            className="nodrag"
            onClick={(event) => {
              stopNodeAction(event);
              data.onDuplicate?.(nodeId);
            }}
            onPointerDown={stopNodeAction}
            title="Duplicate node"
            type="button"
          >
            Copy
          </button>
          <button
            className="nodrag"
            disabled={!data.hasConnections}
            onClick={(event) => {
              stopNodeAction(event);
              data.onDisconnect?.(nodeId);
            }}
            onPointerDown={stopNodeAction}
            title="Disconnect node"
            type="button"
          >
            Cut
          </button>
          <button
            className="nodrag danger"
            onClick={(event) => {
              stopNodeAction(event);
              data.onDelete?.(nodeId);
            }}
            onPointerDown={stopNodeAction}
            title="Delete node"
            type="button"
          >
            Del
          </button>
        </div>
      ) : null}
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
