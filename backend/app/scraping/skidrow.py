"""SkidrowReloaded fetch — WordPress REST behind Cloudflare.

Port of fetchSkidrow in src/lib/gameapi/helpers.js: try a cached clearance
cookie, then a direct fetch, and fall back to the CF solver when Cloudflare
blocks (even on a 200 HTML challenge). The circuit breaker from the Node version
is intentionally omitted for now; it is an optimisation, not correctness, and
can be added once the endpoint is wired.
"""

from __future__ import annotations

from .cf import (
    CookieJar,
    FetchResult,
    has_cloudflare_protection,
    has_fresh_clearance,
    protected_site_headers,
    site_fetch,
    solve_with_fallback,
    _jar,
)

SKIDROW_SESSION = "skidrowreloaded"
_REFERER = "https://www.skidrowreloaded.com/"
_ORIGIN = "https://www.skidrowreloaded.com"


async def fetch_skidrow(url: str, is_page_request: bool = False) -> FetchResult | None:
    jar: CookieJar = _jar(SKIDROW_SESSION)
    user_agent = "GameSearch-API-v2-PageFetch/2.0" if is_page_request else "GameSearch-API-v2/2.0"

    cached = jar if has_fresh_clearance(jar) else None

    try:
        resp = await site_fetch(url, protected_site_headers(user_agent, cached, _REFERER, _ORIGIN))
    except Exception as error:  # noqa: BLE001
        print(f"Skidrow direct fetch failed for {url}: {error}")
        resp = None

    if resp is not None:
        is_cf = has_cloudflare_protection(resp.status, resp.content_type)
        if not is_cf and resp.ok and "text/html" in resp.content_type:
            # A 200 HTML body can still be a CF challenge — inspect it.
            is_cf = has_cloudflare_protection(resp.status, resp.content_type, resp.text)
        if not is_cf and resp.ok:
            return resp
        if is_cf and cached:
            jar.expires_at = 0  # cached clearance rejected; force a re-solve

    solved = await solve_with_fallback(url, SKIDROW_SESSION)
    if solved is not None and solved.ok:
        return solved

    # Search paths expect an empty JSON array rather than null on total failure.
    if is_page_request:
        return None
    return FetchResult(status=200, text="[]", content_type="application/json", ok=True)


SKIDROW_WP_POSTS = "https://www.skidrowreloaded.com/wp-json/wp/v2/posts"
SKIDROW_NAME = "SkidrowReloaded"


async def search_skidrow(query: str, per_page: int = 50) -> list[dict]:
    """Skidrow WP REST search -> transformed result cards (no per-post link fetch,
    matching the Node search path). Single page for now; pagination can follow."""
    from urllib.parse import urlencode
    from .wordpress import transform_post

    params = urlencode({"search": query, "orderby": "date", "order": "desc", "per_page": per_page})
    resp = await fetch_skidrow(f"{SKIDROW_WP_POSTS}?{params}", is_page_request=False)
    if resp is None or not resp.ok:
        return []
    try:
        posts = resp.json()
    except Exception:
        return []
    if not isinstance(posts, list):
        return []
    out = []
    for post in posts:
        if isinstance(post, dict):
            out.append(await transform_post(post, "skidrow", SKIDROW_NAME, fetch_links=False))
    return out


async def fetch_skidrow_recent(per_page: int = 40) -> list[dict]:
    """Recent Skidrow releases (newest first) for the home feed — WP REST ordered
    by date, no search query, links not fetched per-post (fetched on demand).
    Mirrors the Node fetchRecentFromSite(skidrow) path; the Next recent pipeline
    still does the cleanTitle + IGDB/Steam enrichment on top of these."""
    from urllib.parse import urlencode
    from .wordpress import transform_post

    params = urlencode({"orderby": "date", "order": "desc", "per_page": per_page, "page": 1})
    resp = await fetch_skidrow(f"{SKIDROW_WP_POSTS}?{params}", is_page_request=False)
    if resp is None or not resp.ok:
        return []
    try:
        posts = resp.json()
    except Exception:
        return []
    if not isinstance(posts, list):
        return []
    out = []
    for post in posts:
        if isinstance(post, dict):
            out.append(await transform_post(post, "skidrow", SKIDROW_NAME, fetch_links=False))
    return out


async def get_skidrow_post_details(post_id: str) -> dict | None:
    """Single Skidrow post WITH download links (the getPostDetails path)."""
    from .wordpress import transform_post

    resp = await fetch_skidrow(f"{SKIDROW_WP_POSTS}/{post_id}", is_page_request=True)
    if resp is None or not resp.ok:
        return None
    try:
        post = resp.json()
    except Exception:
        return None
    if not isinstance(post, dict):
        return None
    return await transform_post(post, "skidrow", SKIDROW_NAME, fetch_links=True)
