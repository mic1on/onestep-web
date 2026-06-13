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
    database_url = os.getenv(
        "ONESTEP_WEB_DATABASE_URL",
        f"sqlite+aiosqlite:///{data_dir / 'onestep-web.db'}",
    )
    return Settings(
        data_dir=data_dir,
        database_url=database_url,
        fernet_key=os.getenv("ONESTEP_WEB_FERNET_KEY", ""),
        frontend_dist=Path(os.getenv("ONESTEP_WEB_FRONTEND_DIST", "frontend/dist")).expanduser(),
    )

