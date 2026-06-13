from __future__ import annotations

import pytest

from onestep_web.compiler import PipelineCompileError, PipelineCompiler
from onestep_web.schemas import PipelineGraph
from helpers import sample_graph


def test_compiler_orders_valid_dag() -> None:
    graph = PipelineGraph.model_validate(sample_graph())
    compiled = PipelineCompiler().compile(
        graph,
        credentials={"PROD_RABBITMQ": {}, "PROD_MYSQL": {}},
    )

    assert compiled.order == ["n1", "n2", "n3"]
    assert "payload['amount'] * 1.1" in compiled.generated_handlers["n2"]


def test_compiler_rejects_cycles() -> None:
    raw = sample_graph()
    raw["edges"].append({"from": "n3", "to": "n1"})
    graph = PipelineGraph.model_validate(raw)

    with pytest.raises(PipelineCompileError, match="source node n1"):
        PipelineCompiler().compile(graph, credentials={"PROD_RABBITMQ": {}, "PROD_MYSQL": {}})


def test_compiler_rejects_missing_credentials() -> None:
    graph = PipelineGraph.model_validate(sample_graph())

    with pytest.raises(PipelineCompileError, match="PROD_MYSQL"):
        PipelineCompiler().compile(graph, credentials={"PROD_RABBITMQ": {}})


def test_compiler_rejects_invalid_handler_code() -> None:
    raw = sample_graph()
    raw["nodes"][1]["mode"] = "code"
    raw["nodes"][1]["code"] = "async def handler(ctx, payload):\n    return {"
    graph = PipelineGraph.model_validate(raw)

    with pytest.raises(SyntaxError):
        PipelineCompiler().compile(graph, credentials={"PROD_RABBITMQ": {}, "PROD_MYSQL": {}})
