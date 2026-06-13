#!/usr/bin/env bash
set -euo pipefail

compose_file="docker-compose.connectors.yml"

cleanup() {
  if [[ "${ONESTEP_WEB_KEEP_CONNECTORS:-0}" != "1" ]]; then
    docker compose -f "${compose_file}" down -v
  fi
}

trap cleanup EXIT

docker compose -f "${compose_file}" up -d --wait
ONESTEP_WEB_CONNECTOR_INTEGRATION=1 uv run pytest tests/test_connector_integration.py -m integration
