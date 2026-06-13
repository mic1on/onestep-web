import Editor from "@monaco-editor/react";
import type { ConnectorDescriptor, Credential, GraphNode } from "./types";

type PropertyPanelProps = {
  node: GraphNode | null;
  connector: ConnectorDescriptor | null;
  credentials: Credential[];
  onChange: (node: GraphNode) => void;
};

export function PropertyPanel({ node, connector, credentials, onChange }: PropertyPanelProps) {
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

  function setConfig(name: string, value: string) {
    patch({ config: { ...activeNode.config, [name]: value } });
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
                onChange={(event) => setConfig(field.name, event.target.value)}
                required={field.required}
                type={field.type === "number" ? "number" : "text"}
                value={String(activeNode.config[field.name] ?? "")}
              />
            </label>
          ))}
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
        </section>
      )}
    </aside>
  );
}
