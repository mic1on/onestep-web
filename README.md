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

## Connector Integration Tests

The default test suite uses mocks and does not need external services. To run real local
connector checks for MySQL, RabbitMQ, Redis, and SQS via LocalStack:

```bash
scripts/run-connector-integration.sh
```

By default the script removes the containers and volumes after the test run. To keep
the services running for manual debugging:

```bash
ONESTEP_WEB_KEEP_CONNECTORS=1 scripts/run-connector-integration.sh
```

The script starts `docker-compose.connectors.yml` and runs:

```bash
ONESTEP_WEB_CONNECTOR_INTEGRATION=1 uv run pytest tests/test_connector_integration.py -m integration
```
