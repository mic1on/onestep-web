import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { CredentialManager } from "./CredentialManager";
import { LogsPanel } from "./LogsPanel";
import { PipelineEditor } from "./PipelineEditor";
import type { ConnectorDescriptor, Credential, Pipeline, PipelineGraph } from "./types";

const EMPTY_GRAPH: PipelineGraph = { nodes: [], edges: [] };

export function App() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [connectors, setConnectors] = useState<ConnectorDescriptor[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [activePipelineId, setActivePipelineId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("订单同步管道");
  const [draftGraph, setDraftGraph] = useState<PipelineGraph>(EMPTY_GRAPH);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const activePipeline = useMemo(
    () => pipelines.find((pipeline) => pipeline.id === activePipelineId) ?? null,
    [activePipelineId, pipelines]
  );

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    const [nextPipelines, nextConnectors, nextCredentials] = await Promise.all([
      api.listPipelines(),
      api.listConnectors(),
      api.listCredentials()
    ]);
    setPipelines(nextPipelines);
    setConnectors(nextConnectors);
    setCredentials(nextCredentials);
    if (!activePipelineId && nextPipelines[0]) {
      setActivePipelineId(nextPipelines[0].id);
      setDraftName(nextPipelines[0].name);
      setDraftGraph(nextPipelines[0].graph);
    }
  }

  function loadPipeline(pipeline: Pipeline) {
    setActivePipelineId(pipeline.id);
    setDraftName(pipeline.name);
    setDraftGraph(pipeline.graph);
    setSelectedNodeId(null);
    setMessage(`Loaded ${pipeline.name}`);
  }

  async function savePipeline(): Promise<Pipeline> {
    if (activePipelineId) {
      const saved = await api.updatePipeline(activePipelineId, { name: draftName, graph: draftGraph });
      setPipelines((current) => current.map((item) => (item.id === saved.id ? saved : item)));
      setMessage("Saved changes");
      return saved;
    }
    const created = await api.createPipeline({ name: draftName, description: "", graph: draftGraph });
    setPipelines((current) => [created, ...current]);
    setActivePipelineId(created.id);
    setMessage("Created pipeline");
    return created;
  }

  async function startPipeline() {
    const pipeline = activePipelineId
      ? await api.updatePipeline(activePipelineId, { name: draftName, graph: draftGraph })
      : await savePipeline();
    const id = pipeline.id;
    const status = await api.startPipeline(id);
    await refresh();
    setActivePipelineId(id);
    setMessage(status.message);
  }

  async function stopPipeline() {
    if (!activePipelineId) {
      return;
    }
    const status = await api.stopPipeline(activePipelineId);
    await refresh();
    setMessage(status.message);
  }

  async function createCredential(input: Parameters<typeof api.createCredential>[0]) {
    await api.createCredential(input);
    setCredentials(await api.listCredentials());
    setMessage("Credential saved");
  }

  async function updateCredential(id: string, input: Parameters<typeof api.updateCredential>[1]) {
    await api.updateCredential(id, input);
    setCredentials(await api.listCredentials());
    setMessage("Credential updated");
  }

  async function deleteCredential(id: string) {
    await api.deleteCredential(id);
    setCredentials(await api.listCredentials());
    setMessage("Credential deleted");
  }

  async function exportPipeline() {
    if (!activePipelineId) {
      return;
    }
    const blob = await api.exportPipeline(activePipelineId);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${activePipelineId}.zip`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setMessage("Export started");
  }

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="brand-block">
          <span className="brand-mark">OS</span>
          <div>
            <strong>OneStep Web</strong>
            <span>Visual pipeline builder</span>
          </div>
        </div>
        <label className="pipeline-name">
          <span>Pipeline</span>
          <input onChange={(event) => setDraftName(event.target.value)} value={draftName} />
        </label>
        <div className="toolbar">
          <button onClick={savePipeline} type="button">
            Save
          </button>
          {activePipeline?.status === "running" ? (
            <button className="danger-button" onClick={stopPipeline} type="button">
              Stop
            </button>
          ) : (
            <button className="primary-button" onClick={startPipeline} type="button">
              Start
            </button>
          )}
          <button
            className={activePipelineId ? "button-link-export" : "button-link-export disabled"}
            disabled={!activePipelineId}
            onClick={exportPipeline}
            type="button"
          >
            Export
          </button>
        </div>
      </header>

      <section className="workspace-strip">
        <div className="pipeline-tabs">
          {pipelines.map((pipeline) => (
            <button
              className={pipeline.id === activePipelineId ? "active" : ""}
              key={pipeline.id}
              onClick={() => loadPipeline(pipeline)}
              type="button"
            >
              <strong>{pipeline.name}</strong>
              <span>{pipeline.status}</span>
            </button>
          ))}
          <button
            onClick={() => {
              setActivePipelineId(null);
              setDraftName("订单同步管道");
              setDraftGraph(EMPTY_GRAPH);
              setSelectedNodeId(null);
            }}
            type="button"
          >
            <strong>New Pipeline</strong>
            <span>draft</span>
          </button>
        </div>
        <div className="status-line">{message || "Ready"}</div>
      </section>

      <PipelineEditor
        connectors={connectors}
        credentials={credentials}
        graph={draftGraph}
        onGraphChange={setDraftGraph}
        onSelectedNodeChange={setSelectedNodeId}
        selectedNodeId={selectedNodeId}
      />

      <section className="lower-grid">
        <CredentialManager
          credentials={credentials}
          onCreate={createCredential}
          onDelete={deleteCredential}
          onUpdate={updateCredential}
        />
        <LogsPanel pipelineId={activePipelineId} />
      </section>
    </div>
  );
}
