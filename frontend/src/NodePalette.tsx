import { useMemo, useState, type DragEvent } from "react";
import type { ConnectorDescriptor } from "./types";

export const NODE_PALETTE_CONNECTOR_MIME = "application/x-onestep-connector";

type NodePaletteProps = {
  connectors: ConnectorDescriptor[];
  recentConnectorTypes: string[];
  onAddNode: (connector: ConnectorDescriptor) => void;
};

const CATEGORY_LABELS = {
  source: "Source",
  handler: "Handler",
  sink: "Sink"
};

const COMMON_CONNECTOR_TYPES = ["handler", "webhook_source", "interval_source", "mysql_source", "http_sink", "mysql_sink"];

export function NodePalette({ connectors, recentConnectorTypes, onAddNode }: NodePaletteProps) {
  const [query, setQuery] = useState("");
  const recentConnectors = useMemo(
    () => recentConnectorTypes
      .map((type) => connectors.find((connector) => connector.type === type))
      .filter((connector): connector is ConnectorDescriptor => Boolean(connector)),
    [connectors, recentConnectorTypes]
  );
  const commonConnectors = useMemo(
    () => COMMON_CONNECTOR_TYPES
      .map((type) => connectors.find((connector) => connector.type === type))
      .filter((connector): connector is ConnectorDescriptor => Boolean(connector)),
    [connectors]
  );
  const liftedTypes = new Set([...recentConnectors, ...commonConnectors].map((connector) => connector.type));
  const matchingConnectors = useMemo(
    () => connectors.filter((connector) => matchesConnectorQuery(connector, query)),
    [connectors, query]
  );

  function startConnectorDrag(event: DragEvent<HTMLButtonElement>, connector: ConnectorDescriptor) {
    event.dataTransfer.setData(NODE_PALETTE_CONNECTOR_MIME, connector.type);
    event.dataTransfer.setData("text/plain", connector.type);
    event.dataTransfer.effectAllowed = "copy";
  }

  return (
    <aside className="node-palette" aria-label="Node library">
      <label className="palette-search">
        <span>Search</span>
        <input
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Node name, type, or description"
          value={query}
        />
      </label>
      {query.trim() ? (
        <PaletteGroup
          connectors={matchingConnectors}
          emptyLabel="No matching nodes."
          onAddNode={onAddNode}
          onDragStart={startConnectorDrag}
          title="Results"
        />
      ) : (
        <>
          {recentConnectors.length ? (
            <PaletteGroup
              connectors={recentConnectors}
              onAddNode={onAddNode}
              onDragStart={startConnectorDrag}
              title="Recent"
            />
          ) : null}
          <PaletteGroup
            connectors={commonConnectors}
            onAddNode={onAddNode}
            onDragStart={startConnectorDrag}
            title="Common"
          />
          {(["source", "handler", "sink"] as const).map((category) => (
            <PaletteGroup
              connectors={connectors.filter((connector) =>
                connector.category === category && !liftedTypes.has(connector.type)
              )}
              key={category}
              onAddNode={onAddNode}
              onDragStart={startConnectorDrag}
              title={CATEGORY_LABELS[category]}
            />
          ))}
        </>
      )}
    </aside>
  );
}

function PaletteGroup({
  connectors,
  emptyLabel,
  onAddNode,
  onDragStart,
  title
}: {
  connectors: ConnectorDescriptor[];
  emptyLabel?: string;
  onAddNode: (connector: ConnectorDescriptor) => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>, connector: ConnectorDescriptor) => void;
  title: string;
}) {
  if (!connectors.length && !emptyLabel) {
    return null;
  }
  return (
    <section className="palette-group">
      <h2>{title}</h2>
      {connectors.length ? (
        <div className="palette-stack">
          {connectors.map((connector) => (
            <button
              className="palette-node"
              draggable
              key={connector.type}
              onDragStart={(event) => onDragStart(event, connector)}
              onClick={() => onAddNode(connector)}
              type="button"
            >
              <span>{connector.label}</span>
              <small>{connector.description}</small>
            </button>
          ))}
        </div>
      ) : (
        <p className="palette-empty">{emptyLabel}</p>
      )}
    </section>
  );
}

function matchesConnectorQuery(connector: ConnectorDescriptor, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }
  return [connector.label, connector.type, connector.description, connector.category]
    .some((value) => value.toLowerCase().includes(normalizedQuery));
}
