from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from onestep_web.api import create_api
from onestep_web.db import Database
from onestep_web.settings import Settings


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    db = Database(
        Settings(
            data_dir=tmp_path,
            database_url=f"sqlite+aiosqlite:///{tmp_path / 'test.db'}",
            fernet_key="",
            frontend_dist=tmp_path / "dist",
        )
    )
    with TestClient(create_api(db)) as test_client:
        yield test_client
