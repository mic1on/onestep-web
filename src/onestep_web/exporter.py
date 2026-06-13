from __future__ import annotations

import io
import re
import zipfile
from dataclasses import dataclass

from onestep_web.compiler import PipelineCompiler
from onestep_web.schemas import PipelineGraph


@dataclass(frozen=True)
class ExportedWorker:
    filename: str
    content: bytes


class WorkerExporter:
    def __init__(self, compiler: PipelineCompiler | None = None) -> None:
        self.compiler = compiler or PipelineCompiler()

    def export(self, pipeline_id: str, pipeline_name: str, graph: PipelineGraph) -> ExportedWorker:
        compiled = self.compiler.compile(graph, credentials=self._credential_refs(graph))
        package_name = _slugify(pipeline_name)
        memory_resources = _memory_resources(graph)
        worker_yaml = self._build_worker_yaml(pipeline_name, graph, memory_resources)
        handlers_py = self._build_handlers(package_name, compiled.generated_handlers)
        env_example = self._build_env_example(graph)

        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            root = f"{package_name}/"
            archive.writestr(root + "pyproject.toml", _worker_pyproject(package_name))
            archive.writestr(root + "worker.yaml", worker_yaml)
            archive.writestr(root + ".env.example", env_example)
            archive.writestr(root + "requirements.txt", "onestep\n")
            archive.writestr(root + f"src/{package_name}/__init__.py", "")
            archive.writestr(root + f"src/{package_name}/handlers.py", handlers_py)
        return ExportedWorker(filename=f"{pipeline_id}.zip", content=buffer.getvalue())

    def _build_worker_yaml(
        self,
        pipeline_name: str,
        graph: PipelineGraph,
        memory_resources: dict[tuple[str, str], str],
    ) -> str:
        lines = [
            "apiVersion: onestep/v1alpha1",
            "kind: App",
            "",
            "app:",
            f"  name: {_yaml_quote(_slugify(pipeline_name))}",
            "",
            "resources:",
        ]
        if not memory_resources:
            lines.append("  {}")
        for resource_name in memory_resources.values():
            lines.extend([f"  {resource_name}:", "    type: memory"])
        lines.extend(["", "tasks:"])
        for node in graph.nodes:
            if node.type == "handler":
                lines.extend(
                    [
                        f"  - name: {_yaml_quote(node.id)}",
                        f"    source: {_yaml_quote(_incoming_source(node.id, graph, memory_resources))}",
                        "    handler:",
                        f"      ref: {_slugify(pipeline_name)}.handlers:{_handler_name(node.id)}",
                    ]
                )
                emits = _outgoing_sinks(node.id, graph, memory_resources)
                if emits:
                    lines.append("    emit:")
                    for emit in emits:
                        lines.append(f"      - {_yaml_quote(emit)}")
            else:
                lines.extend(
                    [
                        f"  - name: {_yaml_quote(node.id)}",
                        "    config:",
                        f"      node_type: {_yaml_quote(node.type)}",
                    ]
                )
        return "\n".join(lines) + "\n"

    def _build_handlers(self, package_name: str, handlers: dict[str, str]) -> str:
        lines = ["from __future__ import annotations", ""]
        for node_id, code in handlers.items():
            handler_name = _handler_name(node_id)
            code = re.sub(r"async def\s+handler\s*\(", f"async def {handler_name}(", code, count=1)
            lines.append(code.rstrip())
            lines.append("")
        return "\n".join(lines)

    @staticmethod
    def _build_env_example(graph: PipelineGraph) -> str:
        refs = sorted({node.credential_ref for node in graph.nodes if node.credential_ref})
        return "\n".join(f"# {ref}_PASSWORD=" for ref in refs) + ("\n" if refs else "")

    @staticmethod
    def _credential_refs(graph: PipelineGraph) -> dict[str, dict]:
        return {node.credential_ref: {} for node in graph.nodes if node.credential_ref}


def _memory_resources(graph: PipelineGraph) -> dict[tuple[str, str], str]:
    return {(edge.from_, edge.to): f"q_{edge.from_}_{edge.to}" for edge in graph.edges}


def _incoming_source(
    node_id: str,
    graph: PipelineGraph,
    memory_resources: dict[tuple[str, str], str],
) -> str:
    for edge in graph.edges:
        if edge.to == node_id:
            return memory_resources[(edge.from_, edge.to)]
    return ""


def _outgoing_sinks(
    node_id: str,
    graph: PipelineGraph,
    memory_resources: dict[tuple[str, str], str],
) -> list[str]:
    return [
        memory_resources[(edge.from_, edge.to)]
        for edge in graph.edges
        if edge.from_ == node_id
    ]


def _handler_name(node_id: str) -> str:
    return f"handler_{re.sub(r'[^0-9A-Za-z_]', '_', node_id)}"


def _slugify(value: str) -> str:
    slug = re.sub(r"[^0-9A-Za-z_]+", "_", value.strip().lower()).strip("_")
    return slug or "onestep_worker"


def _yaml_quote(value: str) -> str:
    return '"' + value.replace('"', '\\"') + '"'


def _worker_pyproject(package_name: str) -> str:
    return f"""[project]
name = "{package_name}"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = ["onestep"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
"""

