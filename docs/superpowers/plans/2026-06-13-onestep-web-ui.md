# OneStep Web UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first standalone `onestep-web` application from `docs/superpowers/specs/2026-06-12-onestep-web-ui-design.md`.

**Architecture:** Create an independent Python package with a FastAPI backend, async SQLAlchemy persistence, encrypted credential storage, a graph compiler, an in-process runtime pool, and an embedded Vite React SPA. The frontend uses ReactFlow for DAG editing, Monaco for Python handler editing, and REST/WebSocket APIs for persistence, control, export, and live logs.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy async, SQLite, cryptography Fernet, onestep, Vite, React 18, TypeScript, ReactFlow, Monaco Editor, Vitest, Pytest.

---

## Source Of Truth

- Spec: `docs/superpowers/specs/2026-06-12-onestep-web-ui-design.md`
- Product scope: implement the original spec as written. Do not narrow the first version to a linear pipeline.
- Local repo: `/Users/miclon/development/onestep/onestep-web`
- Remote repo: `git@github.com:mic1on/onestep-web.git`

## File Map

- Create: `pyproject.toml` — Python package metadata, backend dependencies, console script.
- Create: `README.md` — local development and run instructions.
- Create: `.gitignore` — Python, Node, SQLite, build artifacts.
- Create: `src/onestep_web/main.py` — FastAPI app factory and static frontend serving.
- Create: `src/onestep_web/settings.py` — data directory, DB URL, Fernet key, frontend path.
- Create: `src/onestep_web/db.py` — async SQLAlchemy engine/session lifecycle.
- Create: `src/onestep_web/models.py` — `Pipeline`, `Credential`, `PipelineLog`.
- Create: `src/onestep_web/schemas.py` — API request/response models and graph contracts.
- Create: `src/onestep_web/credentials.py` — Fernet encryption/decryption and `${ENV_VAR}` interpolation.
- Create: `src/onestep_web/connectors.py` — connector type registry returned by `GET /api/connectors`.
- Create: `src/onestep_web/compiler.py` — DAG validation, topological sort, handler compilation, export metadata.
- Create: `src/onestep_web/runtime.py` — `PipelineRuntimePool` start/stop/restart/status.
- Create: `src/onestep_web/exporter.py` — worker project zip generation.
- Create: `src/onestep_web/api.py` — pipeline, credential, connector, control, export, WebSocket routes.
- Create: `src/onestep_web/cli.py` — `onestep-web serve`.
- Create: `tests/test_api.py` — backend API coverage.
- Create: `tests/test_compiler.py` — DAG and handler compiler coverage.
- Create: `tests/test_credentials.py` — encryption and env interpolation coverage.
- Create: `tests/test_exporter.py` — zip export coverage.
- Create: `frontend/package.json` — frontend dependencies and scripts.
- Create: `frontend/vite.config.ts` — Vite config with API proxy.
- Create: `frontend/index.html` — SPA entrypoint.
- Create: `frontend/src/main.tsx` — React bootstrap.
- Create: `frontend/src/api.ts` — REST/WebSocket client.
- Create: `frontend/src/types.ts` — frontend graph/API types.
- Create: `frontend/src/App.tsx` — shell, toolbar, and page routing.
- Create: `frontend/src/PipelineEditor.tsx` — ReactFlow canvas and node/edge state.
- Create: `frontend/src/NodePalette.tsx` — draggable/source buttons for all spec connector nodes.
- Create: `frontend/src/PropertyPanel.tsx` — connector, credential, mapping, and code config UI.
- Create: `frontend/src/CredentialManager.tsx` — global credential CRUD panel.
- Create: `frontend/src/LogsPanel.tsx` — pipeline log WebSocket viewer.
- Create: `frontend/src/styles.css` — full layout and visual styling.
- Create: `frontend/src/App.test.tsx` — smoke and interaction tests.

---

### Task 1: Repository Skeleton

**Files:**
- Create: `.gitignore`
- Create: `README.md`
- Create: `pyproject.toml`
- Create: `src/onestep_web/__init__.py`
- Create: `src/onestep_web/settings.py`
- Test: `tests/test_imports.py`

- [ ] **Step 1: Create backend package metadata**

Create `pyproject.toml`:

```toml
[project]
name = "onestep-web"
version = "0.1.0"
description = "Visual pipeline builder for OneStep"
readme = "README.md"
requires-python = ">=3.12"
dependencies = [
  "aiosqlite>=0.20.0",
  "cryptography>=42.0.0",
  "fastapi>=0.115.0",
  "onestep>=1.0.0",
  "pydantic>=2.8.0",
  "python-multipart>=0.0.9",
  "sqlalchemy>=2.0.30",
  "uvicorn[standard]>=0.30.0",
]

[project.optional-dependencies]
dev = [
  "httpx>=0.27.0",
  "pytest>=8.2.0",
  "pytest-asyncio>=0.23.0",
  "ruff>=0.6.0",
]

[project.scripts]
onestep-web = "onestep_web.cli:main"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]

[tool.ruff]
line-length = 100
target-version = "py312"
```

- [ ] **Step 2: Add project docs and ignores**

Create `.gitignore`:

```gitignore
.DS_Store
.env
.venv/
__pycache__/
*.py[cod]
.pytest_cache/
.ruff_cache/
.coverage
htmlcov/
dist/
build/
*.egg-info/
node_modules/
frontend/dist/
*.sqlite3
*.db
.onestep-web/
```

Create `README.md`:

```markdown
# OneStep Web

Visual pipeline builder for OneStep.

## Local Development

```bash
uv sync --extra dev
uv run onestep-web serve --reload
```

The backend serves `http://localhost:8000`. During frontend development, run:

```bash
cd frontend
pnpm install
pnpm dev
```
```

- [ ] **Step 3: Add settings and import smoke test**

Create `src/onestep_web/__init__.py`:

```python
__all__ = ["__version__"]

__version__ = "0.1.0"
```

Create `src/onestep_web/settings.py`:

```python
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    database_url: str
    fernet_key: str
    frontend_dist: Path


def load_settings() -> Settings:
    data_dir = Path(os.getenv("ONESTEP_WEB_DATA_DIR", ".onestep-web")).expanduser()
    database_url = os.getenv("ONESTEP_WEB_DATABASE_URL", f"sqlite+aiosqlite:///{data_dir / 'onestep-web.db'}")
    fernet_key = os.getenv("ONESTEP_WEB_FERNET_KEY", "")
    frontend_dist = Path(os.getenv("ONESTEP_WEB_FRONTEND_DIST", "frontend/dist")).expanduser()
    return Settings(
        data_dir=data_dir,
        database_url=database_url,
        fernet_key=fernet_key,
        frontend_dist=frontend_dist,
    )
```

Create `tests/test_imports.py`:

```python
from onestep_web import __version__


def test_package_imports() -> None:
    assert __version__ == "0.1.0"
```

- [ ] **Step 4: Run smoke test**

Run:

```bash
uv run pytest tests/test_imports.py -q
```

Expected: one passing test.

- [ ] **Step 5: Commit**

```bash
git add .gitignore README.md pyproject.toml src/onestep_web/__init__.py src/onestep_web/settings.py tests/test_imports.py
git commit -m "chore: scaffold onestep web package"
```

---

### Task 2: Database, Models, And Schemas

**Files:**
- Create: `src/onestep_web/db.py`
- Create: `src/onestep_web/models.py`
- Create: `src/onestep_web/schemas.py`
- Test: `tests/test_api.py`

- [ ] **Step 1: Add persistence models**

Create models for the spec fields: pipeline graph JSON, encrypted credential config/env vars, and pipeline logs.

- [ ] **Step 2: Add Pydantic schemas**

Define graph nodes and edges with the spec fields: `id`, `type`, `credential_ref`, `config`, `mode`, `mapping`, `code`, and `edges[{from,to}]`.

- [ ] **Step 3: Add database lifecycle helpers**

Implement async engine/session creation, `init_db()`, and dependency injection.

- [ ] **Step 4: Test model creation**

Run:

```bash
uv run pytest tests/test_api.py -q
```

Expected: database tables are created in a temporary SQLite database.

- [ ] **Step 5: Commit**

```bash
git add src/onestep_web/db.py src/onestep_web/models.py src/onestep_web/schemas.py tests/test_api.py
git commit -m "feat: add persistence models"
```

---

### Task 3: Credential Store

**Files:**
- Create: `src/onestep_web/credentials.py`
- Modify: `src/onestep_web/schemas.py`
- Test: `tests/test_credentials.py`

- [ ] **Step 1: Write credential tests**

Cover Fernet encryption/decryption, generated development key fallback, and `${PASSWORD}` interpolation inside DSNs.

- [ ] **Step 2: Implement encryption**

Implement `CredentialCipher` with `encrypt_json()` and `decrypt_json()`.

- [ ] **Step 3: Implement env interpolation**

Implement `interpolate_env_vars(value: str, env_vars: dict[str, str]) -> str`.

- [ ] **Step 4: Run tests**

```bash
uv run pytest tests/test_credentials.py -q
```

Expected: all credential tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/onestep_web/credentials.py src/onestep_web/schemas.py tests/test_credentials.py
git commit -m "feat: add encrypted credential store"
```

---

### Task 4: Connector Registry

**Files:**
- Create: `src/onestep_web/connectors.py`
- Test: `tests/test_api.py`

- [ ] **Step 1: Add registry data**

Return the connector list from the design: MySQL, RabbitMQ, Redis Stream, SQS, Cron, Interval, Webhook, Feishu Bitable, Python Handler, HTTP Sink.

- [ ] **Step 2: Add API test expectation**

Verify `GET /api/connectors` includes source/handler/sink categories and config field metadata for right-panel rendering.

- [ ] **Step 3: Commit**

```bash
git add src/onestep_web/connectors.py tests/test_api.py
git commit -m "feat: add connector registry"
```

---

### Task 5: Pipeline CRUD API

**Files:**
- Create: `src/onestep_web/api.py`
- Create: `src/onestep_web/main.py`
- Create: `src/onestep_web/cli.py`
- Modify: `src/onestep_web/db.py`
- Test: `tests/test_api.py`

- [ ] **Step 1: Add failing API tests**

Cover `POST /api/pipelines`, `GET /api/pipelines`, `GET /api/pipelines/{id}`, `PUT /api/pipelines/{id}`, `DELETE /api/pipelines/{id}`.

- [ ] **Step 2: Implement FastAPI app**

Mount API routes under `/api`, initialize DB on startup, and serve `frontend/dist` when present.

- [ ] **Step 3: Implement CLI**

Expose `onestep-web serve --host 127.0.0.1 --port 8000 --reload`.

- [ ] **Step 4: Run tests**

```bash
uv run pytest tests/test_api.py -q
```

Expected: pipeline CRUD tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/onestep_web/api.py src/onestep_web/main.py src/onestep_web/cli.py src/onestep_web/db.py tests/test_api.py
git commit -m "feat: add pipeline CRUD API"
```

---

### Task 6: Graph Compiler

**Files:**
- Create: `src/onestep_web/compiler.py`
- Test: `tests/test_compiler.py`

- [ ] **Step 1: Add graph validation tests**

Cover source no incoming edges, sink no outgoing edges, connected graph requirement, cycle detection, missing credentials, and Python syntax validation.

- [ ] **Step 2: Implement DAG validation and topological sort**

Implement `PipelineCompiler.validate_graph()` and `PipelineCompiler.topological_order()`.

- [ ] **Step 3: Implement handler generation**

Support visual mapping handlers and code-mode handlers. Visual mappings generate equivalent Python function bodies.

- [ ] **Step 4: Run compiler tests**

```bash
uv run pytest tests/test_compiler.py -q
```

Expected: graph compiler tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/onestep_web/compiler.py tests/test_compiler.py
git commit -m "feat: add pipeline graph compiler"
```

---

### Task 7: Runtime Pool And Logs

**Files:**
- Create: `src/onestep_web/runtime.py`
- Modify: `src/onestep_web/api.py`
- Modify: `src/onestep_web/models.py`
- Test: `tests/test_api.py`

- [ ] **Step 1: Add runtime tests**

Cover `POST /api/pipelines/{id}/start`, `POST /api/pipelines/{id}/stop`, status transitions, and log records.

- [ ] **Step 2: Implement runtime pool**

Maintain `_apps: dict[str, OneStepApp]` and `_tasks: dict[str, asyncio.Task]` as in the design.

- [ ] **Step 3: Add WebSocket log stream**

Implement `/ws/pipelines/{id}` to replay recent logs and push new events.

- [ ] **Step 4: Run tests**

```bash
uv run pytest tests/test_api.py -q
```

Expected: runtime control and log stream tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/onestep_web/runtime.py src/onestep_web/api.py src/onestep_web/models.py tests/test_api.py
git commit -m "feat: add pipeline runtime pool"
```

---

### Task 8: Worker Export

**Files:**
- Create: `src/onestep_web/exporter.py`
- Modify: `src/onestep_web/api.py`
- Test: `tests/test_exporter.py`

- [ ] **Step 1: Add export tests**

Verify the zip includes `pyproject.toml`, `worker.yaml`, `.env.example`, `requirements.txt`, and `src/<package>/handlers.py`.

- [ ] **Step 2: Implement export generator**

Generate YAML `resources` and `tasks` from the graph; write code-mode handlers verbatim and visual mappings as generated Python functions.

- [ ] **Step 3: Add API route**

Implement `POST /api/pipelines/{id}/export` with a zip download response.

- [ ] **Step 4: Run tests**

```bash
uv run pytest tests/test_exporter.py -q
```

Expected: export tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/onestep_web/exporter.py src/onestep_web/api.py tests/test_exporter.py
git commit -m "feat: add worker project export"
```

---

### Task 9: Frontend Scaffold

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/tsconfig.json`
- Create: `frontend/index.html`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/types.ts`
- Create: `frontend/src/api.ts`
- Create: `frontend/src/App.tsx`
- Create: `frontend/src/styles.css`
- Test: `frontend/src/App.test.tsx`

- [ ] **Step 1: Create Vite React app files**

Use React 18, ReactFlow, Monaco, and Vitest.

- [ ] **Step 2: Add API client**

Implement pipeline, connector, credential, start/stop, export, and log WebSocket calls.

- [ ] **Step 3: Add shell**

Render Header: Logo, pipeline name, Save, Start/Stop, Export.

- [ ] **Step 4: Run frontend tests**

```bash
cd frontend
pnpm install
pnpm test -- --run
```

Expected: frontend smoke test passes.

- [ ] **Step 5: Commit**

```bash
git add frontend
git commit -m "feat: scaffold frontend app"
```

---

### Task 10: ReactFlow Pipeline Editor

**Files:**
- Create: `frontend/src/PipelineEditor.tsx`
- Create: `frontend/src/NodePalette.tsx`
- Create: `frontend/src/PropertyPanel.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/styles.css`
- Test: `frontend/src/App.test.tsx`

- [ ] **Step 1: Add editor tests**

Verify node palette renders source, handler, and sink groups; verify selecting a node opens the property panel.

- [ ] **Step 2: Implement node palette**

Include all connector nodes listed in the spec.

- [ ] **Step 3: Implement canvas**

Use ReactFlow nodes/edges, DAG-oriented connection direction, and graph state serialization.

- [ ] **Step 4: Implement property panel**

Render connector fields, credential reference/direct input toggle, mapping mode, and code mode.

- [ ] **Step 5: Run frontend tests**

```bash
cd frontend
pnpm test -- --run
```

Expected: editor tests pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/PipelineEditor.tsx frontend/src/NodePalette.tsx frontend/src/PropertyPanel.tsx frontend/src/App.tsx frontend/src/styles.css frontend/src/App.test.tsx
git commit -m "feat: add visual pipeline editor"
```

---

### Task 11: Credential Manager And Logs

**Files:**
- Create: `frontend/src/CredentialManager.tsx`
- Create: `frontend/src/LogsPanel.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/styles.css`
- Test: `frontend/src/App.test.tsx`

- [ ] **Step 1: Add credential manager tests**

Verify credential list, create form, masked env values, and connector type selector.

- [ ] **Step 2: Implement credential manager**

Support CRUD through `/api/credentials`, encrypted server-side storage, and `${ENV_VAR}` style entry.

- [ ] **Step 3: Implement logs panel**

Connect to `/ws/pipelines/{id}` and render pipeline event stream.

- [ ] **Step 4: Run frontend tests**

```bash
cd frontend
pnpm test -- --run
```

Expected: credential/log UI tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/CredentialManager.tsx frontend/src/LogsPanel.tsx frontend/src/App.tsx frontend/src/styles.css frontend/src/App.test.tsx
git commit -m "feat: add credentials and logs UI"
```

---

### Task 12: End-To-End Verification And Publish

**Files:**
- Modify: `README.md`
- Modify: `pyproject.toml`
- Modify: `frontend/package.json`

- [ ] **Step 1: Run backend checks**

```bash
uv run pytest -q
uv run ruff check .
```

Expected: all backend tests pass and lint is clean.

- [ ] **Step 2: Run frontend checks**

```bash
cd frontend
pnpm test -- --run
pnpm build
```

Expected: tests pass and `frontend/dist` builds.

- [ ] **Step 3: Run app locally**

```bash
uv run onestep-web serve --host 127.0.0.1 --port 8000
```

Expected: backend starts and serves the frontend at `http://127.0.0.1:8000`.

- [ ] **Step 4: Push repository**

```bash
git push -u origin main
```

Expected: `main` is available at `https://github.com/mic1on/onestep-web`.

---

## Self-Review

- Spec coverage: plan covers visual DAG editing, connector registry, credential management, visual/code handlers, FastAPI/SQLite backend, graph JSON storage, compiler, runtime pool, worker export, REST API, WebSocket logs, local/Docker-ready packaging.
- Intentional fidelity: the plan implements the original design scope. It does not replace the design with a linear-only MVP.
- Known implementation risk: exact connector runtime construction depends on installed OneStep connector packages. The connector registry and export format should be implemented first; runtime start can report unsupported connector errors until the matching plugin is installed.
