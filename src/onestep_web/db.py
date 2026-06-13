from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from onestep_web.models import Base
from onestep_web.settings import Settings, load_settings


class Database:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or load_settings()
        self.settings.data_dir.mkdir(parents=True, exist_ok=True)
        self.engine: AsyncEngine = create_async_engine(self.settings.database_url)
        self.sessionmaker = async_sessionmaker(self.engine, expire_on_commit=False)

    async def init(self) -> None:
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    async def dispose(self) -> None:
        await self.engine.dispose()

    async def session(self) -> AsyncIterator[AsyncSession]:
        async with self.sessionmaker() as session:
            yield session


database = Database()


async def get_session() -> AsyncIterator[AsyncSession]:
    async for session in database.session():
        yield session

