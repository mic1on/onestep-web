from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime

from onestep_web.compiler import PipelineCompiler
from onestep_web.schemas import PipelineGraph, RuntimeStatus

LogSink = Callable[[str, str, str], Awaitable[None]]


@dataclass
class RuntimeHandle:
    pipeline_id: str
    task: asyncio.Task[None]
    status: str


class PipelineRuntimePool:
    def __init__(self, compiler: PipelineCompiler | None = None) -> None:
        self.compiler = compiler or PipelineCompiler()
        self._tasks: dict[str, RuntimeHandle] = {}

    async def start(
        self,
        pipeline_id: str,
        graph: PipelineGraph,
        credentials: dict[str, dict],
        log: LogSink,
    ) -> RuntimeStatus:
        if pipeline_id in self._tasks:
            await self.stop(pipeline_id, log)
        compiled = self.compiler.compile(graph, credentials)
        await log("started", "runtime", f"compiled pipeline order: {', '.join(compiled.order)}")
        task = asyncio.create_task(self._run_pipeline(pipeline_id, compiled.order, log))
        self._tasks[pipeline_id] = RuntimeHandle(pipeline_id=pipeline_id, task=task, status="running")
        return RuntimeStatus(pipeline_id=pipeline_id, status="running", message="pipeline started")

    async def stop(self, pipeline_id: str, log: LogSink) -> RuntimeStatus:
        handle = self._tasks.pop(pipeline_id, None)
        if handle is None:
            return RuntimeStatus(pipeline_id=pipeline_id, status="stopped", message="pipeline is not running")
        handle.task.cancel()
        try:
            await handle.task
        except asyncio.CancelledError:
            pass
        await log("stopped", "runtime", "pipeline stopped")
        return RuntimeStatus(pipeline_id=pipeline_id, status="stopped", message="pipeline stopped")

    async def restart(
        self,
        pipeline_id: str,
        graph: PipelineGraph,
        credentials: dict[str, dict],
        log: LogSink,
    ) -> RuntimeStatus:
        await self.stop(pipeline_id, log)
        return await self.start(pipeline_id, graph, credentials, log)

    def get_status(self, pipeline_id: str) -> RuntimeStatus:
        handle = self._tasks.get(pipeline_id)
        if handle is None:
            return RuntimeStatus(pipeline_id=pipeline_id, status="stopped", message="pipeline is not running")
        return RuntimeStatus(pipeline_id=pipeline_id, status="running", message="pipeline is running")

    async def _run_pipeline(self, pipeline_id: str, order: list[str], log: LogSink) -> None:
        while True:
            await asyncio.sleep(5)
            timestamp = datetime.now(UTC).isoformat()
            await log("heartbeat", "runtime", f"{pipeline_id} running {len(order)} nodes at {timestamp}")

