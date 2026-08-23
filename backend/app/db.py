"""MongoDB connection and Beanie initialisation.

The models deliberately point at the collections the mongoose app already
created (`users`, `trackedgames`, `appsettings`, …), so the Python backend reads
and writes the same documents with no migration.
"""

from __future__ import annotations

from motor.motor_asyncio import AsyncIOMotorClient
from beanie import init_beanie

from .config import get_settings
from .models import DOCUMENT_MODELS

_client: AsyncIOMotorClient | None = None


async def init_db() -> None:
    global _client
    settings = get_settings()
    if not settings.mongodb_uri:
        raise RuntimeError("MONGODB_URI is not set")

    _client = AsyncIOMotorClient(settings.mongodb_uri)
    # Prefer an explicit db name, else the one embedded in the URI.
    database = _client[settings.mongodb_db] if settings.mongodb_db else _client.get_default_database()
    if database is None:
        raise RuntimeError("No database in MONGODB_URI and MONGODB_DB is unset")

    await init_beanie(database=database, document_models=DOCUMENT_MODELS)


async def close_db() -> None:
    global _client
    if _client is not None:
        _client.close()
        _client = None
