from __future__ import annotations

import io
import zipfile

from onestep_web.exporter import WorkerExporter
from onestep_web.schemas import PipelineGraph
from helpers import sample_graph


def test_exporter_builds_worker_zip() -> None:
    exported = WorkerExporter().export(
        "pipe_123",
        "订单同步管道",
        PipelineGraph.model_validate(sample_graph()),
    )

    with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
        names = set(archive.namelist())
        assert "onestep_worker/worker.yaml" in names
        assert "onestep_worker/.env.example" in names
        assert "onestep_worker/requirements.txt" in names
        assert "onestep_worker/src/onestep_worker/handlers.py" in names
        handlers = archive.read("onestep_worker/src/onestep_worker/handlers.py").decode()
        assert "async def handler_n2" in handlers
