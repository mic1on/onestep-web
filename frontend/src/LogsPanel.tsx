import { useEffect, useMemo, useState } from "react";
import { api, openPipelineLogSocket } from "./api";
import type { PipelineLog } from "./types";

type LogsPanelProps = {
  pipelineId: string | null;
  showHeading?: boolean;
};

type LogSeverity = "all" | "error" | "warn" | "info";

export function LogsPanel({ pipelineId, showHeading = true }: LogsPanelProps) {
  const [logs, setLogs] = useState<PipelineLog[]>([]);
  const [severityFilter, setSeverityFilter] = useState<LogSeverity>("all");
  const [nodeFilter, setNodeFilter] = useState("all");

  useEffect(() => {
    if (!pipelineId) {
      setLogs([]);
      return;
    }
    let cancelled = false;
    api.listLogs(pipelineId).then((items) => {
      if (!cancelled) {
        setLogs(items);
      }
    });
    const socket = openPipelineLogSocket(pipelineId);
    socket.onmessage = (event) => {
      setLogs((current) => [...current.slice(-199), JSON.parse(event.data) as PipelineLog]);
    };
    return () => {
      cancelled = true;
      socket.close();
    };
  }, [pipelineId]);

  const taskNames = useMemo(
    () => Array.from(new Set(logs.map((log) => log.task_name).filter(Boolean))).sort(),
    [logs]
  );
  const visibleLogs = useMemo(
    () => logs
      .filter((log) => severityFilter === "all" || severityForLog(log) === severityFilter)
      .filter((log) => nodeFilter === "all" || log.task_name === nodeFilter)
      .sort(compareLogs),
    [logs, nodeFilter, severityFilter]
  );

  useEffect(() => {
    if (nodeFilter !== "all" && !taskNames.includes(nodeFilter)) {
      setNodeFilter("all");
    }
  }, [nodeFilter, taskNames]);

  return (
    <section className="logs-panel">
      {showHeading ? (
        <div className="section-heading">
          <span>Runtime Stream</span>
          <h2>Pipeline logs</h2>
        </div>
      ) : null}
      <div className="logs-toolbar">
        <label>
          <span>Severity</span>
          <select onChange={(event) => setSeverityFilter(event.target.value as LogSeverity)} value={severityFilter}>
            <option value="all">All</option>
            <option value="error">Errors</option>
            <option value="warn">Warnings</option>
            <option value="info">Info</option>
          </select>
        </label>
        <label>
          <span>Node</span>
          <select onChange={(event) => setNodeFilter(event.target.value)} value={nodeFilter}>
            <option value="all">All nodes</option>
            {taskNames.map((taskName) => (
              <option key={taskName} value={taskName}>
                {taskName}
              </option>
            ))}
          </select>
        </label>
        <button disabled={logs.length === 0} onClick={() => setLogs([])} type="button">
          Clear
        </button>
      </div>
      <div className="log-list">
        {logs.length === 0 ? (
          <p className="muted">No runtime events yet.</p>
        ) : visibleLogs.length === 0 ? (
          <p className="muted">No logs match the current filters.</p>
        ) : (
          visibleLogs.map((log) => (
            <article className={`log-row ${severityForLog(log)}`} key={log.id}>
              <time>{new Date(log.timestamp).toLocaleTimeString()}</time>
              <strong>{log.event_kind}</strong>
              <span>{log.task_name}</span>
              <p>{log.message}</p>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function severityForLog(log: PipelineLog): Exclude<LogSeverity, "all"> {
  const text = `${log.event_kind} ${log.message}`.toLowerCase();
  if (text.includes("error") || text.includes("failed") || text.includes("exception")) {
    return "error";
  }
  if (text.includes("warn") || text.includes("retry")) {
    return "warn";
  }
  return "info";
}

function compareLogs(a: PipelineLog, b: PipelineLog): number {
  const severityDelta = severityRank(severityForLog(b)) - severityRank(severityForLog(a));
  if (severityDelta !== 0) {
    return severityDelta;
  }
  return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
}

function severityRank(severity: Exclude<LogSeverity, "all">): number {
  if (severity === "error") {
    return 3;
  }
  if (severity === "warn") {
    return 2;
  }
  return 1;
}
