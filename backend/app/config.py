"""Runtime configuration, read from the environment.

Shares the same variables as the Node app where they overlap (MONGODB_URI, the
JD2/qBittorrent/library settings) so a single stack.env drives both during the
migration.
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Same connection string the Node app uses; the data is shared, not copied.
    mongodb_uri: str = ""
    # Mongo database name. Empty means "use the db encoded in the URI".
    mongodb_db: str = ""

    # Shared secret the Next middleware sends with every proxied request. FastAPI
    # rejects any request without it, so the trusted x-aio-user-* headers cannot
    # be spoofed by anything that reaches the backend directly. Must match the
    # value given to the Next container, and the backend port must stay
    # unpublished.
    internal_api_secret: str = ""

    # Bind host/port for uvicorn. Kept off the published port list in compose.
    host: str = "0.0.0.0"
    port: int = 8000

    # Loosen only for local dev where the Next proxy/secret is not in front.
    allow_unauthenticated: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
