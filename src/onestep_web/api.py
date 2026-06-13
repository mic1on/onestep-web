from __future__ import annotations

import asyncio
from collections import defaultdict
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import APIRouter, Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import Response
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from onestep_web.compiler import PipelineCompileError
from onestep_web.connectors import CONNECTORS
from onestep_web.credentials import CredentialCipher, load_or_create_cipher, mask_env_vars
from onestep_web.db import Database, database
from onestep_web.exporter import WorkerExporter
from onestep_web.models import Credential, Pipeline, PipelineLog, utcnow
from onestep_web.runtime import PipelineRuntimePool
from onestep_web.schemas import (
    ConnectorList,
    CredentialCreate,
    CredentialList,
    CredentialRead,
    CredentialUpdate,
    PipelineCreate,
    PipelineGraph,
    PipelineList,
    PipelineLogRead,
    PipelineRead,
    PipelineUpdate,
    RuntimeStatus,
)


class AppState:
    def __init__(self, db: Database) -> None:
        self.db = db
        self.cipher: CredentialCipher = load_or_create_cipher(db.settings)
        self.runtime = PipelineRuntimePool()
        self.exporter = WorkerExporter()
        self.log_subscribers: dict[str, set[asyncio.Queue[PipelineLogRead]]] = defaultdict(set)


def create_api(db: Database | None = None) -> FastAPI:
    app_db = db or database
    state = AppState(app_db)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.onestep_web = state
        await app_db.init()
        yield
        await app_db.dispose()

    app = FastAPI(title="OneStep Web", lifespan=lifespan)
    router = APIRouter()

    async def session_dep() -> AsyncIterator[AsyncSession]:
        async for session in app_db.session():
            yield session

    def app_state() -> AppState:
        return state

    @router.get("/connectors", response_model=ConnectorList)
    async def list_connectors() -> ConnectorList:
        return ConnectorList(items=CONNECTORS)

    @router.get("/pipelines", response_model=PipelineList)
    async def list_pipelines(session: AsyncSession = Depends(session_dep)) -> PipelineList:
        rows = (await session.scalars(select(Pipeline).order_by(Pipeline.updated_at.desc()))).all()
        return PipelineList(items=[_pipeline_read(row) for row in rows])

    @router.post("/pipelines", response_model=PipelineRead)
    async def create_pipeline(
        request: PipelineCreate,
        session: AsyncSession = Depends(session_dep),
    ) -> PipelineRead:
        pipeline = Pipeline(
            name=request.name,
            description=request.description,
            graph_json=request.graph.model_dump(by_alias=True),
            status="draft",
        )
        session.add(pipeline)
        await session.commit()
        await session.refresh(pipeline)
        return _pipeline_read(pipeline)

    @router.get("/pipelines/{pipeline_id}", response_model=PipelineRead)
    async def get_pipeline(
        pipeline_id: str,
        session: AsyncSession = Depends(session_dep),
    ) -> PipelineRead:
        return _pipeline_read(await _get_pipeline(session, pipeline_id))

    @router.put("/pipelines/{pipeline_id}", response_model=PipelineRead)
    async def update_pipeline(
        pipeline_id: str,
        request: PipelineUpdate,
        session: AsyncSession = Depends(session_dep),
    ) -> PipelineRead:
        pipeline = await _get_pipeline(session, pipeline_id)
        if request.name is not None:
            pipeline.name = request.name
        if request.description is not None:
            pipeline.description = request.description
        if request.graph is not None:
            pipeline.graph_json = request.graph.model_dump(by_alias=True)
            if pipeline.status == "running":
                pipeline.status = "stopped"
        pipeline.updated_at = utcnow()
        await session.commit()
        await session.refresh(pipeline)
        return _pipeline_read(pipeline)

    @router.delete("/pipelines/{pipeline_id}", status_code=204)
    async def delete_pipeline(
        pipeline_id: str,
        session: AsyncSession = Depends(session_dep),
        state: AppState = Depends(app_state),
    ) -> Response:
        pipeline = await _get_pipeline(session, pipeline_id)
        await state.runtime.stop(pipeline.id, _log_writer(session, state, pipeline.id))
        await session.delete(pipeline)
        await session.commit()
        return Response(status_code=204)

    @router.post("/pipelines/{pipeline_id}/start", response_model=RuntimeStatus)
    async def start_pipeline(
        pipeline_id: str,
        session: AsyncSession = Depends(session_dep),
        state: AppState = Depends(app_state),
    ) -> RuntimeStatus:
        pipeline = await _get_pipeline(session, pipeline_id)
        graph = PipelineGraph.model_validate(pipeline.graph_json)
        try:
            result = await state.runtime.start(
                pipeline.id,
                graph,
                await _credential_map(session, state),
                _runtime_log_writer(state, pipeline.id),
            )
        except PipelineCompileError as exc:
            pipeline.status = "error"
            await _append_log(session, state, pipeline.id, "failed", "compiler", str(exc))
            await session.commit()
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        pipeline.status = result.status
        pipeline.updated_at = utcnow()
        await session.commit()
        return result

    @router.post("/pipelines/{pipeline_id}/stop", response_model=RuntimeStatus)
    async def stop_pipeline(
        pipeline_id: str,
        session: AsyncSession = Depends(session_dep),
        state: AppState = Depends(app_state),
    ) -> RuntimeStatus:
        pipeline = await _get_pipeline(session, pipeline_id)
        result = await state.runtime.stop(pipeline.id, _runtime_log_writer(state, pipeline.id))
        pipeline.status = result.status
        pipeline.updated_at = utcnow()
        await session.commit()
        return result

    @router.post("/pipelines/{pipeline_id}/export")
    async def export_pipeline(
        pipeline_id: str,
        session: AsyncSession = Depends(session_dep),
        state: AppState = Depends(app_state),
    ) -> Response:
        pipeline = await _get_pipeline(session, pipeline_id)
        graph = PipelineGraph.model_validate(pipeline.graph_json)
        try:
            exported = state.exporter.export(
                pipeline.id,
                pipeline.name,
                graph,
                credentials=await _credential_map(session, state),
            )
        except PipelineCompileError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return Response(
            content=exported.content,
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{exported.filename}"'},
        )

    @router.get("/credentials", response_model=CredentialList)
    async def list_credentials(
        session: AsyncSession = Depends(session_dep),
        state: AppState = Depends(app_state),
    ) -> CredentialList:
        rows = (await session.scalars(select(Credential).order_by(Credential.name.asc()))).all()
        return CredentialList(items=[_credential_read(row, state.cipher, masked=True) for row in rows])

    @router.post("/credentials", response_model=CredentialRead)
    async def create_credential(
        request: CredentialCreate,
        session: AsyncSession = Depends(session_dep),
        state: AppState = Depends(app_state),
    ) -> CredentialRead:
        credential = Credential(
            name=request.name,
            connector_type=request.connector_type,
            config_encrypted=state.cipher.encrypt_json(request.config),
            env_vars_encrypted=state.cipher.encrypt_json(request.env_vars),
        )
        session.add(credential)
        await session.commit()
        await session.refresh(credential)
        return _credential_read(credential, state.cipher, masked=True)

    @router.put("/credentials/{credential_id}", response_model=CredentialRead)
    async def update_credential(
        credential_id: str,
        request: CredentialUpdate,
        session: AsyncSession = Depends(session_dep),
        state: AppState = Depends(app_state),
    ) -> CredentialRead:
        credential = await _get_credential(session, credential_id)
        if request.name is not None:
            credential.name = request.name
        if request.connector_type is not None:
            credential.connector_type = request.connector_type
        if request.config is not None:
            credential.config_encrypted = state.cipher.encrypt_json(request.config)
        if request.env_vars is not None:
            credential.env_vars_encrypted = state.cipher.encrypt_json(request.env_vars)
        credential.updated_at = utcnow()
        await session.commit()
        await session.refresh(credential)
        return _credential_read(credential, state.cipher, masked=True)

    @router.delete("/credentials/{credential_id}", status_code=204)
    async def delete_credential(
        credential_id: str,
        session: AsyncSession = Depends(session_dep),
    ) -> Response:
        await _get_credential(session, credential_id)
        await session.execute(delete(Credential).where(Credential.id == credential_id))
        await session.commit()
        return Response(status_code=204)

    @router.get("/pipelines/{pipeline_id}/logs", response_model=list[PipelineLogRead])
    async def list_logs(
        pipeline_id: str,
        session: AsyncSession = Depends(session_dep),
    ) -> list[PipelineLogRead]:
        await _get_pipeline(session, pipeline_id)
        rows = (
            await session.scalars(
                select(PipelineLog)
                .where(PipelineLog.pipeline_id == pipeline_id)
                .order_by(PipelineLog.timestamp.desc(), PipelineLog.id.desc())
                .limit(200)
            )
        ).all()
        return [_log_read(row) for row in reversed(rows)]

    app.include_router(router, prefix="/api")

    @app.websocket("/ws/pipelines/{pipeline_id}")
    async def pipeline_logs(websocket: WebSocket, pipeline_id: str) -> None:
        await websocket.accept()
        queue: asyncio.Queue[PipelineLogRead] = asyncio.Queue()
        state.log_subscribers[pipeline_id].add(queue)
        try:
            while True:
                event = await queue.get()
                await websocket.send_json(event.model_dump(mode="json"))
        except WebSocketDisconnect:
            pass
        finally:
            state.log_subscribers[pipeline_id].discard(queue)

    return app


async def _get_pipeline(session: AsyncSession, pipeline_id: str) -> Pipeline:
    pipeline = await session.get(Pipeline, pipeline_id)
    if pipeline is None:
        raise HTTPException(status_code=404, detail=f"pipeline {pipeline_id} was not found")
    return pipeline


async def _get_credential(session: AsyncSession, credential_id: str) -> Credential:
    credential = await session.get(Credential, credential_id)
    if credential is None:
        raise HTTPException(status_code=404, detail=f"credential {credential_id} was not found")
    return credential


def _pipeline_read(pipeline: Pipeline) -> PipelineRead:
    return PipelineRead(
        id=pipeline.id,
        name=pipeline.name,
        description=pipeline.description,
        graph=PipelineGraph.model_validate(pipeline.graph_json),
        status=pipeline.status,  # type: ignore[arg-type]
        created_at=pipeline.created_at,
        updated_at=pipeline.updated_at,
    )


def _credential_read(
    credential: Credential,
    cipher: CredentialCipher,
    *,
    masked: bool,
) -> CredentialRead:
    env_vars = cipher.decrypt_json(credential.env_vars_encrypted)
    return CredentialRead(
        id=credential.id,
        name=credential.name,
        connector_type=credential.connector_type,
        config=cipher.decrypt_json(credential.config_encrypted),
        env_vars=mask_env_vars(env_vars) if masked else {str(k): str(v) for k, v in env_vars.items()},
        created_at=credential.created_at,
        updated_at=credential.updated_at,
    )


async def _credential_map(session: AsyncSession, state: AppState) -> dict[str, dict[str, Any]]:
    rows = (await session.scalars(select(Credential))).all()
    return {
        row.name: {
            "connector_type": row.connector_type,
            "config": state.cipher.decrypt_json(row.config_encrypted),
            "env_vars": state.cipher.decrypt_json(row.env_vars_encrypted),
        }
        for row in rows
    }


def _log_writer(session: AsyncSession, state: AppState, pipeline_id: str):
    async def write(event_kind: str, task_name: str, message: str) -> None:
        await _append_log(session, state, pipeline_id, event_kind, task_name, message)
        await session.commit()

    return write


def _runtime_log_writer(state: AppState, pipeline_id: str):
    async def write(event_kind: str, task_name: str, message: str) -> None:
        async for session in state.db.session():
            await _append_log(session, state, pipeline_id, event_kind, task_name, message)
            await session.commit()
            return

    return write


async def _append_log(
    session: AsyncSession,
    state: AppState,
    pipeline_id: str,
    event_kind: str,
    task_name: str,
    message: str,
) -> PipelineLogRead:
    log = PipelineLog(
        pipeline_id=pipeline_id,
        event_kind=event_kind,
        task_name=task_name,
        message=message,
    )
    session.add(log)
    await session.flush()
    event = _log_read(log)
    for queue in list(state.log_subscribers[pipeline_id]):
        queue.put_nowait(event)
    return event


def _log_read(log: PipelineLog) -> PipelineLogRead:
    return PipelineLogRead(
        id=log.id,
        pipeline_id=log.pipeline_id,
        event_kind=log.event_kind,
        task_name=log.task_name,
        message=log.message,
        timestamp=log.timestamp,
    )


app = create_api()
