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
    solve_via_flaresolverr,
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

    solved = await solve_via_flaresolverr(url, SKIDROW_SESSION)
    if solved is not None and solved.ok:
        return solved

    # Search paths expect an empty JSON array rather than null on total failure.
    if is_page_request:
        return None
    return FetchResult(status=200, text="[]", content_type="application/json", ok=True)
