from __future__ import annotations

from fastapi.staticfiles import StaticFiles

from onestep_web.api import create_api
from onestep_web.db import Database


def create_app(db: Database | None = None):
    app = create_api(db)
    settings = (db.settings if db is not None else Database().settings)
    if settings.frontend_dist.exists():
        app.mount("/", StaticFiles(directory=settings.frontend_dist, html=True), name="frontend")
    return app


app = create_app()

