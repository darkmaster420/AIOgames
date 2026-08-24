"""Cloudflare-bypass fetch layer.

Port of the CF/clearance logic in src/lib/gameapi/helpers.js (siteFetch,
fetchViaFlaresolverr, hasCloudflareProtection, fetchSkidrow and the in-memory
cookie jars). Behaviour is kept faithful so the ported scrapers behave like the
Node ones against the same live sites.

Solver: the request goes to a FlareSolverr-compatible endpoint. Byparr is a
drop-in for that API and listens on the same port, so CF_SOLVER_URL /
BYPARR_URL / FLARESOLVERR_URL are accepted interchangeably. The exact Byparr
`/v1` contract is verified against a live instance when this is wired up.
"""

from __future__ import annotations

import os
import re
import time
from dataclasses import dataclass, field

import httpx

SITE_FETCH_TIMEOUT_MS = int(os.environ.get("SITE_FETCH_TIMEOUT_MS", "60000"))
FLARE_TIMEOUT_MS = int(os.environ.get("FLARE_TIMEOUT_MS", "60000"))

# `<pre>...</pre>` wrapper FlareSolverr puts around JSON API responses.
_PRE_RE = re.compile(r"<pre[^>]*>([\s\S]*?)</pre>", re.IGNORECASE)


def solver_url() -> str:
    return (
        os.environ.get("CF_SOLVER_URL")
        or os.environ.get("BYPARR_URL")
        or os.environ.get("FLARESOLVERR_URL")
        or ""
    ).strip()


def flaresolverr_url() -> str:
    """The FlareSolverr endpoint specifically (CF_SOLVER_URL is treated as the
    generic/primary solver)."""
    return (os.environ.get("CF_SOLVER_URL") or os.environ.get("FLARESOLVERR_URL") or "").strip()


def byparr_url() -> str:
    """The Byparr endpoint, if configured — used as a fallback when FlareSolverr
    can't get past a site (e.g. SteamDB)."""
    return (os.environ.get("BYPARR_URL") or "").strip()


@dataclass
class CookieJar:
    cf_clearance: str | None = None
    cookies: list[str] = field(default_factory=list)  # "name=value" strings
    user_agent: str | None = None
    expires_at: float = 0.0  # epoch ms, matching the JS jar


# In-memory clearance jars, keyed by solver session name. Same lifetime as the
# Node process's module-level jars.
_JARS: dict[str, CookieJar] = {}


def _jar(session: str) -> CookieJar:
    return _JARS.setdefault(session, CookieJar())


def has_fresh_clearance(jar: CookieJar) -> bool:
    return bool(jar.cookies) and (time.time() * 1000) < (jar.expires_at - 60_000)


def protected_site_headers(user_agent: str, jar: CookieJar | None, referer: str, origin: str) -> dict[str, str]:
    headers = {
        "User-Agent": (jar.user_agent if jar and jar.user_agent else user_agent),
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
    }
    if jar and jar.cookies:
        headers["Cookie"] = "; ".join(jar.cookies)
        headers["Referer"] = referer
        headers["Origin"] = origin
    return headers


@dataclass
class FetchResult:
    status: int
    text: str
    content_type: str
    ok: bool

    def json(self):
        import json
        return json.loads(self.text)


async def site_fetch(url: str, headers: dict[str, str] | None = None) -> FetchResult:
    timeout = httpx.Timeout(SITE_FETCH_TIMEOUT_MS / 1000)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        resp = await client.get(url, headers=headers or {})
        return FetchResult(
            status=resp.status_code,
            text=resp.text,
            content_type=resp.headers.get("content-type", ""),
            ok=resp.is_success,
        )


def has_cloudflare_protection(status: int, content_type: str, html: str | None = None) -> bool:
    if status in (403, 503):
        return True
    if "text/html" in (content_type or "") and html:
        needles = (
            "cf-browser-verification", "Cloudflare", "Attention Required",
            "cf-challenge", "Just a moment...", "Enable JavaScript and cookies",
        )
        if any(n in html for n in needles):
            return True
    return False


# Sessions whose solved cookies we persist (the Node code's allowlist).
_PERSIST_COOKIE_SESSIONS = {
    "skidrowreloaded", "steamrip", "dodirepacks", "dodirepacks-fallback", "freegog",
}


async def solve_with_fallback(url: str, session: str = "default") -> FetchResult | None:
    """Try each configured solver until one returns a usable (non-challenge)
    response. FlareSolverr is tried first (it handles our API/RSS endpoints, e.g.
    SteamDB, that the browser-based Byparr times out on); Byparr is the fallback
    for sites FlareSolverr can't get past. Returns the last attempt if all fail."""
    bases: list[str] = []
    for candidate in (flaresolverr_url(), byparr_url(), solver_url()):
        candidate = (candidate or "").strip()
        if candidate and candidate not in bases:
            bases.append(candidate)
    last: FetchResult | None = None
    for base in bases:
        resp = await solve_via_flaresolverr(url, session=session, base_url=base)
        if (
            resp is not None
            and resp.ok
            and not has_cloudflare_protection(resp.status, resp.content_type, resp.text)
        ):
            return resp
        last = resp
    return last


async def solve_via_flaresolverr(url: str, session: str = "default", base_url: str | None = None) -> FetchResult | None:
    base = (base_url or solver_url()).strip()
    if not base:
        return None

    timeout = httpx.Timeout((FLARE_TIMEOUT_MS + 5000) / 1000)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(
                base,
                headers={"Content-Type": "application/json"},
                json={"cmd": "request.get", "url": url, "session": session, "maxTimeout": FLARE_TIMEOUT_MS},
            )
        if not resp.is_success:
            return None
        data = resp.json()
    except Exception as error:  # noqa: BLE001 - solver failures are non-fatal
        print(f"CF solver fetch failed for {url}: {error}")
        return None

    solution = data.get("solution") or {}
    if data.get("status") != "ok" or not solution.get("response"):
        msg = str(data.get("message") or "").lower()
        # "No challenge detected" is not a failure — fall back to a direct fetch.
        if "no challenge detected" in msg:
            try:
                direct = await site_fetch(url, {
                    "User-Agent": "GameSearch-API-v2/2.0",
                    "Accept": "application/json, text/plain, */*",
                    "Accept-Language": "en-US,en;q=0.9",
                })
                if direct.ok:
                    return direct
            except Exception:
                pass
        return None

    body = solution["response"]
    status = solution.get("status") or 200

    pre = _PRE_RE.search(body)
    if pre:
        body = pre.group(1)

    trimmed = body.lstrip()
    content_type = "application/json" if (pre or trimmed.startswith(("{", "["))) else "text/html"

    cookies = solution.get("cookies") or []
    if cookies and session in _PERSIST_COOKIE_SESSIONS:
        all_cookies = [f"{c['name']}={c['value']}" for c in cookies]
        cf = None
        exp = (time.time() * 1000) + 4 * 60 * 60 * 1000
        for c in cookies:
            if c.get("name") == "cf_clearance":
                cf = c.get("value")
                if c.get("expires"):
                    exp = float(c["expires"]) * 1000
        jar = _jar(session)
        jar.cf_clearance = cf or "none"
        jar.cookies = all_cookies
        jar.user_agent = solution.get("userAgent")
        jar.expires_at = exp

    return FetchResult(status=status, text=body, content_type=content_type, ok=200 <= status < 300)
