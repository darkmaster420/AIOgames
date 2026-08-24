"""FastAPI application entrypoint.

Endpoints are added under `/api/*` and adopted by the frontend one at a time:
the Next middleware only proxies paths on its ported-prefix allowlist here, so
the rest of the app keeps hitting the existing Next routes until each is moved.
"""

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .csrin_posters import refresh_csrin_posters
from .db import init_db, close_db
from .routers import health, tracking, games_search
from .scraping import csrin


async def _csrin_refresh_loop() -> None:
    """Proactively re-scan cs.rin.ru recent uploads on a fixed cadence so the
    feed stays fresh even when no one is loading the page, rather than only
    refreshing lazily on the first request after the cache expires. Runs at the
    CSRIN_RECENT_TTL_MINUTES cadence; each pass forces a fresh scan and logs the
    result, so a run of identical counts means no new releases (not a stuck
    cache) and any scan failure is visible in the logs."""
    interval = max(60.0, csrin.CSRIN_RECENT_TTL_MS / 1000)
    # Small startup delay so the first user request isn't racing the warm-up.
    await asyncio.sleep(10)
    while True:
        try:
            await refresh_csrin_posters()
            posts = await csrin.fetch_csrin_recent(force=True)
            print(f"[scheduler] csrin recent warmed: {len(posts)} game(s)")
        except asyncio.CancelledError:
            raise
        except Exception as error:  # noqa: BLE001
            print(f"[scheduler] csrin recent refresh failed: {error}")
        await asyncio.sleep(interval)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    refresh_task = asyncio.create_task(_csrin_refresh_loop())
    try:
        yield
    finally:
        refresh_task.cancel()
        try:
            await refresh_task
        except asyncio.CancelledError:
            pass
        await close_db()


app = FastAPI(title="AIOgames Backend", lifespan=lifespan)
app.include_router(health.router)
app.include_router(tracking.router)
app.include_router(games_search.router)
