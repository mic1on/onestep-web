from __future__ import annotations

import asyncio
import sys
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from onestep_web.compiler import PipelineCompiler
from onestep_web.onestep_adapter import build_runtime_app
from onestep_web.schemas import PipelineGraph, RuntimeStatus

LogSink = Callable[[str, str, str], Awaitable[None]]


@dataclass
class RuntimeHandle:
    pipeline_id: str
    task: asyncio.Task[None]
    status: str
    app: Any
    app_module: str
    shutdown_timeout_s: float


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
        compiled = self.compiler.compile(graph, credentials)
        app, module_name = build_runtime_app(
            pipeline_id,
            pipeline_id,
            graph,
            credentials=credentials,
            log=log,
        )
        if pipeline_id in self._tasks:
            await self.stop(pipeline_id, log)
        await log("started", "runtime", f"compiled pipeline order: {', '.join(compiled.order)}")
        task = asyncio.create_task(app.serve())
        task.add_done_callback(
            lambda completed: asyncio.create_task(self._record_completion(pipeline_id, completed, log))
        )
        self._tasks[pipeline_id] = RuntimeHandle(
            pipeline_id=pipeline_id,
            task=task,
            status="running",
            app=app,
            app_module=module_name,
            shutdown_timeout_s=app.shutdown_timeout_s or 30.0,
        )
        return RuntimeStatus(pipeline_id=pipeline_id, status="running", message="pipeline started")

    async def stop(self, pipeline_id: str, log: LogSink) -> RuntimeStatus:
        handle = self._tasks.pop(pipeline_id, None)
        if handle is None:
            return RuntimeStatus(pipeline_id=pipeline_id, status="stopped", message="pipeline is not running")
        handle.app.request_shutdown()
        try:
            await asyncio.wait_for(handle.task, timeout=handle.shutdown_timeout_s)
        except TimeoutError:
            handle.task.cancel()
            try:
                await handle.task
            except asyncio.CancelledError:
                pass
        except asyncio.CancelledError:
            pass
        sys.modules.pop(handle.app_module, None)
        await log("stopped", "runtime", "pipeline stopped")
        return RuntimeStatus(pipeline_id=pipeline_id, status="stopped", message="pipeline stopped")

    async def restart(
        self,
        pipeline_id: str,
        graph: PipelineGraph,
        credentials: dict[str, dict],
        log: LogSink,
    ) -> RuntimeStatus:
        return await self.start(pipeline_id, graph, credentials, log)

    def running_ids(self) -> list[str]:
        return list(self._tasks)

    def get_status(self, pipeline_id: str) -> RuntimeStatus:
        handle = self._tasks.get(pipeline_id)
        if handle is None:
            return RuntimeStatus(pipeline_id=pipeline_id, status="stopped", message="pipeline is not running")
        return RuntimeStatus(pipeline_id=pipeline_id, status="running", message="pipeline is running")

    async def _record_completion(
        self,
        pipeline_id: str,
        task: asyncio.Task[None],
        log: LogSink,
    ) -> None:
        if task.cancelled():
            return
        error = task.exception()
        if error is None:
            return
        handle = self._tasks.pop(pipeline_id, None)
        if handle is not None:
            sys.modules.pop(handle.app_module, None)
        await log("failed", "runtime", f"pipeline failed: {error}")
