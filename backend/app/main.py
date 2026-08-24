"""FastAPI application entrypoint.

Endpoints are added under `/api/*` and adopted by the frontend one at a time:
the Next middleware only proxies paths on its ported-prefix allowlist here, so
the rest of the app keeps hitting the existing Next routes until each is moved.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI

from .db import init_db, close_db
from .routers import health, tracking, games_search


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    try:
        yield
    finally:
        await close_db()


app = FastAPI(title="AIOgames Backend", lifespan=lifespan)
app.include_router(health.router)
app.include_router(tracking.router)
app.include_router(games_search.router)
