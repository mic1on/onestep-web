import type { DragEvent } from "react";
import type { ConnectorDescriptor } from "./types";

export const NODE_PALETTE_CONNECTOR_MIME = "application/x-onestep-connector";

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
  function startConnectorDrag(event: DragEvent<HTMLButtonElement>, connector: ConnectorDescriptor) {
    event.dataTransfer.setData(NODE_PALETTE_CONNECTOR_MIME, connector.type);
    event.dataTransfer.setData("text/plain", connector.type);
    event.dataTransfer.effectAllowed = "copy";
  }

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
                  draggable
                  key={connector.type}
                  onDragStart={(event) => startConnectorDrag(event, connector)}
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
