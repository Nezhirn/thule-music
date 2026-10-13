from dataclasses import dataclass

import httpx
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import Settings


@dataclass
class JobContext:
    settings: Settings
    sessionmaker: async_sessionmaker[AsyncSession]
    http: httpx.AsyncClient
