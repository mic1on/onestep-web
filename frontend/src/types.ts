export type PipelineStatus = "draft" | "running" | "stopped" | "error";
export type NodeKind = "source" | "handler" | "sink";
export type HandlerMode = "visual" | "code";

export type GraphNode = {
  id: string;
  type: string;
  kind: NodeKind;
  credential_ref?: string | null;
  config: Record<string, unknown>;
  mode?: HandlerMode | null;
  mapping: Record<string, string>;
  code?: string | null;
  input_schema: Record<string, unknown>;
  position: { x: number; y: number };
};

export type GraphEdge = {
  from: string;
  to: string;
};

export type PipelineGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type Pipeline = {
  id: string;
  name: string;
  description: string;
  graph: PipelineGraph;
  status: PipelineStatus;
  created_at: string;
  updated_at: string;
};

export type ConnectorField = {
  name: string;
  label: string;
  type: string;
  required: boolean;
};

export type ConnectorDescriptor = {
  type: string;
  label: string;
  category: NodeKind;
  description: string;
  credential_type?: string | null;
  fields: ConnectorField[];
};

export type Credential = {
  id: string;
  name: string;
  connector_type: string;
  config: Record<string, unknown>;
  env_vars: Record<string, string>;
  created_at: string;
  updated_at: string;
};

export type PipelineLog = {
  id: number;
  pipeline_id: string;
  event_kind: string;
  task_name: string;
  message: string;
  timestamp: string;
};

export type RuntimeStatus = {
  pipeline_id: string;
  status: PipelineStatus;
  message: string;
};

