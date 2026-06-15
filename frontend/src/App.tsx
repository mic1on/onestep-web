import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { CredentialManager } from "./CredentialManager";
import { LogsPanel } from "./LogsPanel";
import { PipelineEditor, validatePipelineGraphIssues } from "./PipelineEditor";
import { PIPELINE_TEMPLATES, type PipelineTemplate } from "./templates";
import type { ConnectorDescriptor, Credential, Pipeline, PipelineGraph } from "./types";

const EMPTY_GRAPH: PipelineGraph = { nodes: [], edges: [] };
const DEFAULT_PIPELINE_NAME = "订单同步管道";
type AppView = "builder" | "credentials";

export function App() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [connectors, setConnectors] = useState<ConnectorDescriptor[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [activePipelineId, setActivePipelineId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState(DEFAULT_PIPELINE_NAME);
  const [draftGraph, setDraftGraph] = useState<PipelineGraph>(EMPTY_GRAPH);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [activeView, setActiveView] = useState<AppView>("builder");
  const [isLogsOpen, setIsLogsOpen] = useState(false);

  const activePipeline = useMemo(
    () => pipelines.find((pipeline) => pipeline.id === activePipelineId) ?? null,
    [activePipelineId, pipelines]
  );
  const credentialNames = useMemo(() => new Set(credentials.map((credential) => credential.name)), [credentials]);
  const graphIssues = useMemo(
    () => validatePipelineGraphIssues(draftGraph, { credentialNames }),
    [credentialNames, draftGraph]
  );
  const graphError = graphIssues[0]?.message ?? null;
  const canRunPipeline = graphIssues.length === 0;
  const canExportPipeline = Boolean(activePipelineId) && graphIssues.length === 0;

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

  function loadTemplate(template: PipelineTemplate) {
    setActivePipelineId(null);
    setDraftName(template.name);
    setDraftGraph(cloneGraph(template.graph));
    setSelectedNodeId(null);
    setIsLogsOpen(false);
    setMessage(`Loaded template: ${template.name}`);
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
    if (graphError) {
      setMessage(graphError);
      return;
    }
    const id = activePipelineId;
    try {
      const pipeline = id
        ? await api.updatePipeline(id, { name: draftName, graph: draftGraph })
        : await savePipeline();
      const status = await api.startPipeline(pipeline.id);
      await refresh();
      setActivePipelineId(pipeline.id);
      if (status.status === "error") {
        setPipelines((current) => markPipelineStatus(current, pipeline.id, "error"));
      }
      setMessage(status.message);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to start pipeline";
      if (id) {
        setPipelines((current) => markPipelineStatus(current, id, "error"));
      }
      setMessage(message);
    }
  }

  async function stopPipeline() {
    if (!activePipelineId) {
      return;
    }
    const status = await api.stopPipeline(activePipelineId);
    await refresh();
    setMessage(status.message);
  }

  async function deletePipeline() {
    if (!activePipelineId) {
      return;
    }
    const deletedId = activePipelineId;
    const deletedPipeline = pipelines.find((pipeline) => pipeline.id === deletedId);
    const confirmed = window.confirm(`Delete pipeline "${deletedPipeline?.name ?? deletedId}"? This cannot be undone.`);
    if (!confirmed) {
      return;
    }
    const deletedIndex = pipelines.findIndex((pipeline) => pipeline.id === deletedId);
    await api.deletePipeline(deletedId);
    const remaining = pipelines.filter((pipeline) => pipeline.id !== deletedId);
    setPipelines(remaining);
    const nextPipeline = remaining[Math.min(Math.max(deletedIndex, 0), remaining.length - 1)] ?? null;
    if (nextPipeline) {
      setActivePipelineId(nextPipeline.id);
      setDraftName(nextPipeline.name);
      setDraftGraph(nextPipeline.graph);
    } else {
      setActivePipelineId(null);
      setDraftName(DEFAULT_PIPELINE_NAME);
      setDraftGraph(EMPTY_GRAPH);
    }
    setSelectedNodeId(null);
    setMessage("Deleted pipeline");
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
    if (graphError) {
      setMessage(graphError);
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
        <nav className="top-nav" aria-label="Workspace">
          <button
            className={activeView === "builder" ? "active" : ""}
            onClick={() => setActiveView("builder")}
            type="button"
          >
            Builder
          </button>
          <button
            className={activeView === "credentials" ? "active" : ""}
            onClick={() => {
              setActiveView("credentials");
              setIsLogsOpen(false);
            }}
            type="button"
          >
            Credentials
          </button>
        </nav>
        {activeView === "builder" ? (
          <>
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
                <button
                  className="primary-button"
                  disabled={!canRunPipeline}
                  onClick={startPipeline}
                  title={graphError ?? undefined}
                  type="button"
                >
                  Start
                </button>
              )}
              <button
                className={canExportPipeline ? "button-link-export" : "button-link-export disabled"}
                disabled={!canExportPipeline}
                onClick={exportPipeline}
                title={graphError ?? undefined}
                type="button"
              >
                Export
              </button>
              <button
                className="danger-button"
                disabled={!activePipelineId}
                onClick={deletePipeline}
                type="button"
              >
                Delete
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="view-title">
              <span>Workspace</span>
              <strong>Credentials</strong>
            </div>
            <div className="status-line compact">{message || "Credentials ready"}</div>
          </>
        )}
      </header>

      {activeView === "builder" ? (
        <>
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
                  setDraftName(DEFAULT_PIPELINE_NAME);
                  setDraftGraph(EMPTY_GRAPH);
                  setSelectedNodeId(null);
                }}
                type="button"
              >
                <strong>New Pipeline</strong>
                <span>draft</span>
              </button>
              {PIPELINE_TEMPLATES.map((template) => (
                <button
                  className="template-tab"
                  key={template.id}
                  onClick={() => loadTemplate(template)}
                  type="button"
                >
                  <strong>{template.name}</strong>
                  <span>template</span>
                </button>
              ))}
            </div>
            <div className="status-line status-actions">
              <div className="status-message">
                <span>{message || (graphIssues.length ? `${graphIssues.length} validation issues` : "Ready")}</span>
                {graphIssues.length ? (
                  <details className="validation-summary">
                    <summary>Show details</summary>
                    <ul>
                      {graphIssues.slice(0, 6).map((issue) => (
                        <li key={issue.message}>{issue.message}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
              <button disabled={!activePipelineId} onClick={() => setIsLogsOpen(true)} type="button">
                Logs
              </button>
            </div>
          </section>

          <PipelineEditor
            connectors={connectors}
            credentials={credentials}
            graph={draftGraph}
            onGraphChange={setDraftGraph}
            onSelectedNodeChange={setSelectedNodeId}
            selectedNodeId={selectedNodeId}
            validationIssues={graphIssues}
          />

          {isLogsOpen ? (
            <div className="logs-drawer-backdrop" onMouseDown={() => setIsLogsOpen(false)}>
              <aside
                aria-label="Pipeline runtime logs"
                aria-modal="true"
                className="logs-drawer"
                onMouseDown={(event) => event.stopPropagation()}
                role="dialog"
              >
                <div className="logs-drawer-titlebar">
                  <div>
                    <span>Runtime Stream</span>
                    <strong>Pipeline logs</strong>
                  </div>
                  <button onClick={() => setIsLogsOpen(false)} type="button">
                    Close
                  </button>
                </div>
                <LogsPanel pipelineId={activePipelineId} showHeading={false} />
              </aside>
            </div>
          ) : null}
        </>
      ) : (
        <main className="credentials-page">
          <CredentialManager
            credentials={credentials}
            onCreate={createCredential}
            onDelete={deleteCredential}
            onUpdate={updateCredential}
          />
        </main>
      )}
    </div>
  );
}

function markPipelineStatus(
  pipelines: Pipeline[],
  pipelineId: string,
  status: Pipeline["status"]
): Pipeline[] {
  return pipelines.map((pipeline) => (
    pipeline.id === pipelineId ? { ...pipeline, status } : pipeline
  ));
}

function cloneGraph(graph: PipelineGraph): PipelineGraph {
  return JSON.parse(JSON.stringify(graph)) as PipelineGraph;
}
