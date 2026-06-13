import type { ConnectorDescriptor } from "./types";

type NodePaletteProps = {
  connectors: ConnectorDescriptor[];
  onAddNode: (connector: ConnectorDescriptor) => void;
};

const CATEGORY_LABELS = {
  source: "Source",
  handler: "Handler",
  sink: "Sink"
};

export function NodePalette({ connectors, onAddNode }: NodePaletteProps) {
  return (
    <aside className="node-palette" aria-label="Node library">
      {(["source", "handler", "sink"] as const).map((category) => (
        <section className="palette-group" key={category}>
          <h2>{CATEGORY_LABELS[category]}</h2>
          <div className="palette-stack">
            {connectors
              .filter((connector) => connector.category === category)
              .map((connector) => (
                <button
                  className="palette-node"
                  key={connector.type}
                  onClick={() => onAddNode(connector)}
                  type="button"
                >
                  <span>{connector.label}</span>
                  <small>{connector.description}</small>
                </button>
              ))}
          </div>
        </section>
      ))}
    </aside>
  );
}

