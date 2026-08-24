"""GET /api/games/search — skidrow + csrin.

The Next search route (src/app/api/games/search/route.ts) calls this
server-to-server for the actual scrape, then keeps its own post-processing
(Steam AppID enrichment, term filter, cache). `site` is a comma list; empty /
"all" defaults to skidrow only (csrin is opt-in, matching the Node
DEFAULT_EXCLUDED_FROM_ALL). Both ported sources run concurrently and their
results are concatenated.

Returns the same shape the frontend reads: `{ results: [...] }`.
"""

import asyncio

from fastapi import APIRouter, Depends, Query

from ..auth import require_internal_key
from ..csrin_posters import refresh_csrin_posters
from ..scraping import csrin, skidrow, steamdb

router = APIRouter()

_KNOWN_SITES = {"skidrow", "csrin"}


@router.get("/api/games/search")
async def games_search(
    search: str = Query(default=""),
    site: str = Query(default=""),
    _key: None = Depends(require_internal_key),
) -> dict:
    query = (search or "").strip()
    if not query:
        return {"results": [], "count": 0}

    sites = {s.strip().lower() for s in site.split(",") if s.strip()}
    if not sites or sites == {"all"}:
        # Default set excludes csrin, matching the Node DEFAULT_EXCLUDED_FROM_ALL.
        sites = {"skidrow"}
    sites &= _KNOWN_SITES
    if not sites:
        return {"results": [], "count": 0}

    tasks = []
    if "csrin" in sites:
        # Pull the current admin-managed trusted/untrusted lists before ranking.
        await refresh_csrin_posters()
        tasks.append(csrin.fetch_csrin_search(query))
    if "skidrow" in sites:
        tasks.append(skidrow.search_skidrow(query))

    groups = await asyncio.gather(*tasks, return_exceptions=True)
    results: list = []
    for group in groups:
        if isinstance(group, list):
            results.extend(group)
        else:  # a source failing shouldn't take down the whole search
            print(f"games_search source error: {group}")

    return {"results": results, "count": len(results)}


@router.get("/api/games/csrin-recent")
async def csrin_recent(
    refresh: bool = Query(default=False),
    _key: None = Depends(require_internal_key),
) -> dict:
    """Recent cs.rin.ru Game Releases for the home feed. Called server-to-server
    by the Next recent route (which merges these into the multi-site grid), so
    it is gated on the internal key alone. Same trusted/untrusted ranking as
    search; the scraper caches for a short TTL so repeat loads don't re-hit the
    forum, and `?refresh=true` forces a fresh scan (the home Refresh button).
    """
    await refresh_csrin_posters()
    results = await csrin.fetch_csrin_recent(force=refresh)
    return {"results": results, "count": len(results)}


@router.get("/api/games/post-details")
async def post_details(
    site: str = Query(default=""),
    post_id: str = Query(default=""),
    _key: None = Depends(require_internal_key),
) -> dict:
    """A single post WITH its download links, for the Next /api/games/links route.
    Mirrors the Node getPostDetails `{success, post}` shape. csrin isn't handled
    here — its links are embedded in the search/recent results and the Next route
    serves them via its follow-post path."""
    pid = post_id.strip()
    site_l = site.strip().lower()
    if not pid:
        return {"success": False, "error": "post_id required"}
    if site_l == "skidrow":
        post = await skidrow.get_skidrow_post_details(pid)
        if post is None:
            return {"success": False, "error": "post not found"}
        return {"success": True, "post": post}
    return {"success": False, "error": f"unsupported site: {site_l or '(none)'}"}


@router.get("/api/steamdb/builds")
async def steamdb_builds(
    appid: str = Query(default=""),
    refresh: bool = Query(default=False),
    _key: None = Depends(require_internal_key),
) -> dict:
    """SteamDB build history (from PatchnotesRSS via the CF solver) for build<->
    semver comparison in the update-check. Newest build first; each item carries
    a build_id + pub_timestamp (and a best-effort version)."""
    aid = appid.strip()
    if not aid:
        return {"builds": [], "latest_build": None}
    builds = await steamdb.fetch_steamdb_builds(aid, force=refresh)
    return {"builds": builds, "latest_build": builds[0] if builds else None, "count": len(builds)}
