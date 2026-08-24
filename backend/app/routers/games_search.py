"""GET /api/games/search — csrin-only for now.

The public frontend already ships a cs.rin.ru site chip that calls
/api/games/search?site=csrin. The Next middleware routes ONLY that variant here;
every other search (all the multi-site sources) stays on the Next route, so this
adds csrin with no regression. When more sites are ported this endpoint grows to
cover them and the middleware routing widens.

Returns the same shape the frontend reads: `{ results: [...] }`.
"""

from fastapi import APIRouter, Depends, Query

from ..auth import require_internal_key
from ..csrin_posters import refresh_csrin_posters
from ..scraping import csrin

router = APIRouter()


@router.get("/api/games/search")
async def games_search(
    search: str = Query(default=""),
    site: str = Query(default=""),
    _key: None = Depends(require_internal_key),
) -> dict:
    query = (search or "").strip()
    sites = {s.strip().lower() for s in site.split(",") if s.strip()}

    # Only the csrin-only variant is served here; anything else means the
    # middleware routed a request it should have left on Next.
    if sites != {"csrin"} or not query:
        return {"results": []}

    # Pull the current admin-managed trusted/untrusted lists before ranking.
    await refresh_csrin_posters()
    results = await csrin.fetch_csrin_search(query)
    return {"results": results, "count": len(results)}


@router.get("/api/games/csrin-recent")
async def csrin_recent(
    _key: None = Depends(require_internal_key),
) -> dict:
    """Recent cs.rin.ru Game Releases for the home feed. Called server-to-server
    by the Next recent route (which merges these into the multi-site grid), so
    it is gated on the internal key alone. Same trusted/untrusted ranking as
    search; the scraper caches for 15 min so repeat loads don't re-hit the forum.
    """
    await refresh_csrin_posters()
    results = await csrin.fetch_csrin_recent()
    return {"results": results, "count": len(results)}
