import { useEffect, useState } from "react";
import { api, openPipelineLogSocket } from "./api";
import type { PipelineLog } from "./types";

type LogsPanelProps = {
  pipelineId: string | null;
};

export function LogsPanel({ pipelineId }: LogsPanelProps) {
  const [logs, setLogs] = useState<PipelineLog[]>([]);

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

  return (
    <section className="logs-panel">
      <div className="section-heading">
        <span>Runtime Stream</span>
        <h2>Pipeline logs</h2>
      </div>
      <div className="log-list">
        {logs.length === 0 ? (
          <p className="muted">No runtime events yet.</p>
        ) : (
          logs.map((log) => (
            <article className="log-row" key={log.id}>
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

