# OneStep Web

Visual pipeline builder for OneStep.

This repository is intentionally separate from `onestep` and `onestep-control-plane`.
The implementation follows `docs/superpowers/specs/2026-06-12-onestep-web-ui-design.md`.

## Local Development

```bash
uv sync --extra dev
uv run onestep-web serve --reload
```

The backend serves `http://localhost:8000`.

For frontend development:

```bash
cd frontend
pnpm install
pnpm dev
```

