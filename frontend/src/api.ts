import type {
  ConnectorDescriptor,
  Credential,
  Pipeline,
  PipelineGraph,
  PipelineLog,
  RuntimeStatus
} from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    ...init
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

export const api = {
  async listPipelines(): Promise<Pipeline[]> {
    const response = await request<{ items: Pipeline[] }>("/api/pipelines");
    return response.items;
  },
  async createPipeline(input: { name: string; description: string; graph: PipelineGraph }): Promise<Pipeline> {
    return request<Pipeline>("/api/pipelines", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  async updatePipeline(id: string, input: { name?: string; description?: string; graph?: PipelineGraph }): Promise<Pipeline> {
    return request<Pipeline>(`/api/pipelines/${id}`, {
      method: "PUT",
      body: JSON.stringify(input)
    });
  },
  async startPipeline(id: string): Promise<RuntimeStatus> {
    return request<RuntimeStatus>(`/api/pipelines/${id}/start`, { method: "POST" });
  },
  async stopPipeline(id: string): Promise<RuntimeStatus> {
    return request<RuntimeStatus>(`/api/pipelines/${id}/stop`, { method: "POST" });
  },
  async listConnectors(): Promise<ConnectorDescriptor[]> {
    const response = await request<{ items: ConnectorDescriptor[] }>("/api/connectors");
    return response.items;
  },
  async listCredentials(): Promise<Credential[]> {
    const response = await request<{ items: Credential[] }>("/api/credentials");
    return response.items;
  },
  async createCredential(input: {
    name: string;
    connector_type: string;
    config: Record<string, unknown>;
    env_vars: Record<string, string>;
  }): Promise<Credential> {
    return request<Credential>("/api/credentials", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  async listLogs(id: string): Promise<PipelineLog[]> {
    return request<PipelineLog[]>(`/api/pipelines/${id}/logs`);
  },
  async exportPipeline(id: string): Promise<Blob> {
    const response = await fetch(`/api/pipelines/${id}/export`, { method: "POST" });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    return response.blob();
  }
};

export function openPipelineLogSocket(id: string): WebSocket {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return new WebSocket(`${protocol}://${window.location.host}/ws/pipelines/${id}`);
}
