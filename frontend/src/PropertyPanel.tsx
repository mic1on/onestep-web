import Editor from "@monaco-editor/react";
import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type { ConnectorDescriptor, Credential, DebugResult, GraphNode } from "./types";

type PropertyPanelProps = {
  node: GraphNode | null;
  connector: ConnectorDescriptor | null;
  credentials: Credential[];
  upstreamSample: unknown;
  onChange: (node: GraphNode) => void;
  onDebugSample: (nodeId: string, sample: unknown) => void;
};

export function PropertyPanel({
  node,
  connector,
  credentials,
  upstreamSample,
  onChange,
  onDebugSample
}: PropertyPanelProps) {
  const [connectionResult, setConnectionResult] = useState<DebugResult | null>(null);
  const [sampleResult, setSampleResult] = useState<DebugResult | null>(null);
  const [handlerResult, setHandlerResult] = useState<DebugResult | null>(null);
  const [handlerPayload, setHandlerPayload] = useState("{}");
  const [debugBusy, setDebugBusy] = useState<string | null>(null);

  const payloadSeed = useMemo(() => samplePayload(upstreamSample), [upstreamSample]);

  useEffect(() => {
    setConnectionResult(null);
    setSampleResult(null);
    setHandlerResult(null);
    setDebugBusy(null);
    setHandlerPayload(JSON.stringify(payloadSeed ?? defaultPayload(), null, 2));
  }, [node?.id, payloadSeed]);

  if (!node || !connector) {
    return (
      <aside className="property-panel empty-panel">
        <h2>Properties</h2>
        <p>Select a node to configure connector details, credentials, mappings, or Python code.</p>
      </aside>
    );
  }

  const activeNode = node;
  const activeConnector = connector;

  function patch(partial: Partial<GraphNode>) {
    onChange({ ...activeNode, ...partial });
  }

  function setConfig(field: ConnectorDescriptor["fields"][number], value: string) {
    const config = { ...activeNode.config };
    if (!value.trim()) {
      delete config[field.name];
    } else if (field.type === "number") {
      config[field.name] = Number(value);
    } else {
      config[field.name] = value;
    }
    patch({ config });
  }

  function updateMapping(raw: string) {
    const mapping: Record<string, string> = {};
    raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        const [key, ...rest] = line.split("=");
        if (key?.trim()) {
          mapping[key.trim()] = rest.join("=").trim();
        }
      });
    patch({ mapping });
  }

  const mappingText = Object.entries(activeNode.mapping ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const matchingCredentials = credentials.filter((credential) =>
    activeConnector.credential_type ? credential.connector_type === activeConnector.credential_type : true
  );

  async function testConnection() {
    setDebugBusy("connection");
    try {
      setConnectionResult(await api.testConnection(activeNode));
    } catch (error) {
      setConnectionResult(errorResult(error));
    } finally {
      setDebugBusy(null);
    }
  }

  async function fetchSample() {
    setDebugBusy("sample");
    try {
      const result = await api.fetchSample(activeNode, 5);
      setSampleResult(result);
      if (result.status === "ok") {
        onDebugSample(activeNode.id, result.data);
      }
    } catch (error) {
      setSampleResult(errorResult(error));
    } finally {
      setDebugBusy(null);
    }
  }

  async function runHandler() {
    setDebugBusy("handler");
    try {
      const parsed = JSON.parse(handlerPayload);
      const result = await api.runHandler(activeNode, parsed);
      setHandlerResult(result);
      if (result.status === "ok") {
        onDebugSample(activeNode.id, result.data);
      }
    } catch (error) {
      setHandlerResult(errorResult(error));
    } finally {
      setDebugBusy(null);
    }
  }

  return (
    <aside className="property-panel">
      <div className="panel-heading">
        <span>{activeConnector.category}</span>
        <h2>{activeConnector.label}</h2>
        <p>{activeNode.id}</p>
      </div>

      {activeConnector.category !== "handler" ? (
        <section className="property-section">
          <h3>Connection</h3>
          <label className="field">
            <span>Credential</span>
            <select
              onChange={(event) => patch({ credential_ref: event.target.value || null })}
              value={activeNode.credential_ref ?? ""}
            >
              <option value="">Direct input</option>
              {matchingCredentials.map((credential) => (
                <option key={credential.id} value={credential.name}>
                  {credential.name}
                </option>
              ))}
            </select>
          </label>
          {activeConnector.fields.map((field) => (
            <label className="field" key={field.name}>
              <span>{field.label}</span>
              <input
                onChange={(event) => setConfig(field, event.target.value)}
                required={field.required}
                type={field.type === "number" ? "number" : "text"}
                value={String(activeNode.config[field.name] ?? "")}
              />
            </label>
          ))}
          <DebugActions
            busy={debugBusy}
            connectionResult={connectionResult}
            onFetchSample={fetchSample}
            onTestConnection={testConnection}
            sampleResult={sampleResult}
          />
        </section>
      ) : (
        <section className="property-section">
          <h3>Handler</h3>
          <div className="segmented">
            <button
              className={activeNode.mode !== "code" ? "active" : ""}
              onClick={() => patch({ mode: "visual" })}
              type="button"
            >
              Mapping
            </button>
            <button
              className={activeNode.mode === "code" ? "active" : ""}
              onClick={() => patch({ mode: "code" })}
              type="button"
            >
              Python
            </button>
          </div>
          {activeNode.mode === "code" ? (
            <div className="code-editor-shell">
              <Editor
                defaultLanguage="python"
                height="260px"
                onChange={(value) => patch({ code: value ?? "" })}
                options={{ minimap: { enabled: false }, fontSize: 13, wordWrap: "on" }}
                value={
                  activeNode.code ??
                  'async def handler(ctx, payload):\n    """Transform upstream payload."""\n    return payload\n'
                }
              />
            </div>
          ) : (
            <label className="field">
              <span>Mappings</span>
              <textarea
                onChange={(event) => updateMapping(event.target.value)}
                placeholder={"id={{order_id}}\nprice={{amount * 1.1}}"}
                rows={8}
                value={mappingText}
              />
            </label>
          )}
          <div className="debug-panel">
            <div className="debug-heading">
              <h3>Handler Debug</h3>
              <button disabled={debugBusy === "handler"} onClick={runHandler} type="button">
                {debugBusy === "handler" ? "Running" : "Run Handler"}
              </button>
            </div>
            <label className="field">
              <span>Input Payload</span>
              <textarea
                onChange={(event) => setHandlerPayload(event.target.value)}
                rows={8}
                value={handlerPayload}
              />
            </label>
            <DebugResultView result={handlerResult} />
          </div>
        </section>
      )}
    </aside>
  );
}

function DebugActions({
  busy,
  connectionResult,
  sampleResult,
  onTestConnection,
  onFetchSample
}: {
  busy: string | null;
  connectionResult: DebugResult | null;
  sampleResult: DebugResult | null;
  onTestConnection: () => void;
  onFetchSample: () => void;
}) {
  return (
    <div className="debug-panel">
      <div className="debug-heading">
        <h3>Debug</h3>
        <div className="debug-actions">
          <button disabled={busy === "connection"} onClick={onTestConnection} type="button">
            {busy === "connection" ? "Testing" : "Test Connection"}
          </button>
          <button disabled={busy === "sample"} onClick={onFetchSample} type="button">
            {busy === "sample" ? "Fetching" : "Fetch Sample"}
          </button>
        </div>
      </div>
      <DebugResultView result={connectionResult} />
      <DebugResultView result={sampleResult} />
    </div>
  );
}

function DebugResultView({ result }: { result: DebugResult | null }) {
  if (!result) {
    return null;
  }
  return (
    <div className={`debug-result ${result.status}`}>
      <div className="debug-result-meta">
        <strong>{result.status}</strong>
        <span>{result.duration_ms} ms</span>
      </div>
      <p>{result.message}</p>
      {result.stdout ? (
        <details open>
          <summary>stdout</summary>
          <pre>{result.stdout}</pre>
        </details>
      ) : null}
      {result.stderr ? (
        <details open>
          <summary>stderr</summary>
          <pre>{result.stderr}</pre>
        </details>
      ) : null}
      {result.data !== null && result.data !== undefined ? (
        <details open>
          <summary>data</summary>
          <pre>{stringify(result.data)}</pre>
        </details>
      ) : null}
      {result.schema !== null && result.schema !== undefined ? (
        <details open>
          <summary>schema</summary>
          <pre>{stringify(result.schema)}</pre>
        </details>
      ) : null}
    </div>
  );
}

function samplePayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

function defaultPayload(): Record<string, unknown> {
  return { order_id: "A001", amount: 99.5, status: "new" };
}

function errorResult(error: unknown): DebugResult {
  return {
    status: "error",
    message: error instanceof Error ? error.message : String(error),
    data: null,
    schema: null,
    stdout: "",
    stderr: "",
    duration_ms: 0
  };
}

function stringify(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
