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
  const [sampleResult, setSampleResult] = useState<DebugResult | null>(null);
  const [handlerResult, setHandlerResult] = useState<DebugResult | null>(null);
  const [handlerPayload, setHandlerPayload] = useState("{}");
  const [debugBusy, setDebugBusy] = useState<string | null>(null);
  const [selectedMappingKey, setSelectedMappingKey] = useState<string | null>(null);

  const payloadSeed = useMemo(() => samplePayload(upstreamSample), [upstreamSample]);
  const upstreamFields = useMemo(() => collectFieldEntries(payloadSeed), [payloadSeed]);
  const mappingKeySignature = Object.keys(node?.mapping ?? {}).join("\u0000");

  useEffect(() => {
    setSampleResult(null);
    setHandlerResult(null);
    setDebugBusy(null);
    setHandlerPayload(JSON.stringify(payloadSeed ?? defaultPayload(), null, 2));
  }, [node?.id, payloadSeed]);

  useEffect(() => {
    const keys = Object.keys(node?.mapping ?? {});
    setSelectedMappingKey((current) => (current && keys.includes(current) ? current : (keys[0] ?? null)));
  }, [node?.id, mappingKeySignature]);

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

  function addMapping() {
    const mapping = activeNode.mapping ?? {};
    let index = 1;
    let key = `field_${index}`;
    while (Object.prototype.hasOwnProperty.call(mapping, key)) {
      index += 1;
      key = `field_${index}`;
    }
    setSelectedMappingKey(key);
    patch({ mapping: { ...mapping, [key]: "" } });
  }

  function removeMapping(key: string) {
    const mapping = { ...(activeNode.mapping ?? {}) };
    delete mapping[key];
    setSelectedMappingKey(Object.keys(mapping)[0] ?? null);
    patch({ mapping });
  }

  function renameMappingKey(currentKey: string, nextKey: string) {
    const trimmed = nextKey.trim();
    const mapping = activeNode.mapping ?? {};
    if (!trimmed || trimmed === currentKey || Object.prototype.hasOwnProperty.call(mapping, trimmed)) {
      return;
    }

    const nextMapping: Record<string, string> = {};
    for (const [key, value] of Object.entries(mapping)) {
      nextMapping[key === currentKey ? trimmed : key] = value;
    }
    setSelectedMappingKey(trimmed);
    patch({ mapping: nextMapping });
  }

  function updateMappingExpression(key: string, expression: string) {
    patch({ mapping: { ...(activeNode.mapping ?? {}), [key]: expression } });
  }

  function insertFieldExpression(expression: string) {
    const mapping = activeNode.mapping ?? {};
    const fallbackKey = Object.keys(mapping)[0] ?? "field_1";
    const key = selectedMappingKey && Object.prototype.hasOwnProperty.call(mapping, selectedMappingKey)
      ? selectedMappingKey
      : fallbackKey;
    setSelectedMappingKey(key);
    patch({ mapping: { ...mapping, [key]: expression } });
  }

  const matchingCredentials = credentials.filter((credential) =>
    activeConnector.credential_type ? credential.connector_type === activeConnector.credential_type : true
  );

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
            onFetchSample={fetchSample}
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
            <VisualMappingEditor
              fields={upstreamFields}
              mapping={activeNode.mapping ?? {}}
              onAddMapping={addMapping}
              onInsertField={insertFieldExpression}
              onRemoveMapping={removeMapping}
              onRenameMapping={renameMappingKey}
              onSelectMapping={setSelectedMappingKey}
              onUpdateExpression={updateMappingExpression}
              selectedMappingKey={selectedMappingKey}
            />
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

type FieldEntry = {
  key: string;
  label: string;
  type: string;
  preview: string;
  expression: string | null;
  depth: number;
};

function VisualMappingEditor({
  fields,
  mapping,
  selectedMappingKey,
  onAddMapping,
  onInsertField,
  onRemoveMapping,
  onRenameMapping,
  onSelectMapping,
  onUpdateExpression
}: {
  fields: FieldEntry[];
  mapping: Record<string, string>;
  selectedMappingKey: string | null;
  onAddMapping: () => void;
  onInsertField: (expression: string) => void;
  onRemoveMapping: (key: string) => void;
  onRenameMapping: (currentKey: string, nextKey: string) => void;
  onSelectMapping: (key: string) => void;
  onUpdateExpression: (key: string, expression: string) => void;
}) {
  const rows = Object.entries(mapping);

  return (
    <div className="mapping-editor">
      <section className="mapping-pane" aria-label="Input fields">
        <div className="mapping-pane-heading">
          <h4>Input fields</h4>
          <span>{fields.length}</span>
        </div>
        {fields.length ? (
          <div className="mapping-field-list">
            {fields.map((field) => (
              <button
                aria-label={`Insert ${field.label}`}
                className="mapping-field-button"
                disabled={!field.expression}
                key={field.key}
                onClick={() => field.expression && onInsertField(field.expression)}
                type="button"
              >
                <span className="mapping-field-name" style={{ paddingLeft: field.depth * 12 }}>
                  {field.label}
                </span>
                <span className="mapping-field-type">{field.type}</span>
                <code>{field.preview}</code>
              </button>
            ))}
          </div>
        ) : (
          <p className="mapping-empty">No upstream sample yet.</p>
        )}
      </section>

      <section className="mapping-pane" aria-label="Output mappings">
        <div className="mapping-pane-heading">
          <h4>Output mappings</h4>
          <button onClick={onAddMapping} type="button">
            Add mapping
          </button>
        </div>
        <div className="mapping-row-list">
          {rows.length ? (
            rows.map(([key, expression]) => (
              <div
                className={`mapping-row ${selectedMappingKey === key ? "active" : ""}`}
                key={key}
                onClick={() => onSelectMapping(key)}
              >
                <label className="mapping-cell">
                  <span>Field</span>
                  <input
                    aria-label={`Output field ${key}`}
                    onBlur={(event) => onRenameMapping(key, event.target.value)}
                    onFocus={() => onSelectMapping(key)}
                    defaultValue={key}
                  />
                </label>
                <label className="mapping-cell">
                  <span>Expression</span>
                  <input
                    aria-label={`Expression for ${key}`}
                    onChange={(event) => onUpdateExpression(key, event.target.value)}
                    onFocus={() => onSelectMapping(key)}
                    value={expression}
                  />
                </label>
                <button
                  aria-label={`Remove mapping ${key}`}
                  className="mapping-remove"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemoveMapping(key);
                  }}
                  type="button"
                >
                  Remove
                </button>
              </div>
            ))
          ) : (
            <p className="mapping-empty">No output mappings.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function DebugActions({
  busy,
  sampleResult,
  onFetchSample
}: {
  busy: string | null;
  sampleResult: DebugResult | null;
  onFetchSample: () => void;
}) {
  return (
    <div className="debug-panel">
      <div className="debug-heading">
        <h3>Debug</h3>
        <div className="debug-actions">
          <button disabled={busy === "sample"} onClick={onFetchSample} type="button">
            {busy === "sample" ? "Fetching" : "Fetch Sample"}
          </button>
        </div>
      </div>
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

function collectFieldEntries(value: unknown): FieldEntry[] {
  const fields: FieldEntry[] = [];
  collectFields(value, [], fields, 0);
  return fields.slice(0, 80);
}

function collectFields(value: unknown, path: Array<string | number>, fields: FieldEntry[], depth: number) {
  if (path.length) {
    fields.push({
      key: path.join("."),
      label: formatPath(path),
      type: valueType(value),
      preview: previewValue(value),
      expression: expressionForPath(path),
      depth: Math.max(0, depth - 1)
    });
  }

  if (depth >= 4 || fields.length >= 80) {
    return;
  }

  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      collectFields(child, [...path, key], fields, depth + 1);
    }
    return;
  }

  if (Array.isArray(value) && value.length > 0) {
    collectFields(value[0], [...path, 0], fields, depth + 1);
  }
}

function formatPath(path: Array<string | number>): string {
  return path
    .map((part, index) => {
      if (typeof part === "number") {
        return `[${part}]`;
      }
      return index === 0 ? part : `.${part}`;
    })
    .join("");
}

function expressionForPath(path: Array<string | number>): string | null {
  const [first, ...rest] = path;
  if (typeof first !== "string" || !isPythonIdentifier(first)) {
    return null;
  }

  const expression = rest.reduce((current, part) => {
    if (typeof part === "number") {
      return `${current}[${part}]`;
    }
    return `${current}[${JSON.stringify(part)}]`;
  }, first);
  return `{{${expression}}}`;
}

function valueType(value: unknown): string {
  if (Array.isArray(value)) {
    return "array";
  }
  if (value === null) {
    return "null";
  }
  return typeof value;
}

function previewValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.length}]`;
  }
  if (isPlainObject(value)) {
    return `{${Object.keys(value).length}}`;
  }
  if (typeof value === "string") {
    return value.length > 18 ? `${value.slice(0, 18)}...` : value;
  }
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPythonIdentifier(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
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
