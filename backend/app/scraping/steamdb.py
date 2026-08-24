"""SteamDB build history via the per-app PatchnotesRSS feed.

steamdb.info is Cloudflare-protected (a direct fetch 403s), so the RSS is
fetched through the CF solver — FlareSolverr first, Byparr as a fallback (SteamDB
sometimes slips past FlareSolverr). Each RSS item carries a Steam build id
(guid `build#NNNN`) and its publish date, which is exactly what's needed to
compare a build number against a semver release: map both to Steam dates and
compare. A best-effort version is pulled from the patch text when present.

Used by the update-check for cross-scheme (build vs semver) comparisons. Cached
per app for a short TTL; on a fetch failure the last good build list is served.
"""

from __future__ import annotations

import re
import time
from email.utils import parsedate_to_datetime

from .cf import FetchResult, solve_with_fallback

STEAMDB_RSS = "https://steamdb.info/api/PatchnotesRSS/?appid={appid}"
_TTL_MS = 30 * 60 * 1000  # builds change often; keep it short
_cache: dict[str, dict] = {}  # appid -> {"builds": [...], "ts": epoch_ms}

_ITEM_RE = re.compile(r"<item>([\s\S]*?)</item>", re.I)
_BUILD_GUID_RE = re.compile(r"build#(\d+)", re.I)
_BUILD_TEXT_RE = re.compile(r"\bbuild\s*#?\s*(\d{5,})\b", re.I)
# A version needs at least one dot so a build id / "Patch 2" can't match.
_VERSION_RE = re.compile(r"\bv?(\d+(?:\.\d+){1,3}(?:[a-z]\d*)?)\b", re.I)


def _decode(s: str) -> str:
    return (s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"')
             .replace("&#039;", "'").replace("&apos;", "'").replace("&amp;", "&"))


def _tag(item: str, tag: str) -> str:
    m = re.search(rf"<{tag}[^>]*>([\s\S]*?)</{tag}>", item, re.I)
    if not m:
        return ""
    val = m.group(1)
    cd = re.match(r"\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$", val)
    if cd:
        val = cd.group(1)
    return _decode(val).strip()


def _epoch_ms(pubdate: str) -> int | None:
    try:
        return int(parsedate_to_datetime(pubdate).timestamp() * 1000)
    except Exception:
        return None


async def _solve_rss(appid: str) -> FetchResult | None:
    # FlareSolverr handles the RSS/XML endpoint; Byparr (browser-based) times out
    # on it, so the shared fallback tries FlareSolverr first.
    return await solve_with_fallback(STEAMDB_RSS.format(appid=appid), session="steamdb")


def _parse_rss(text: str) -> list[dict]:
    # The solver often hands back the RSS entity-encoded (&lt;item&gt;...).
    if "<item>" not in text:
        text = _decode(text)
    builds: list[dict] = []
    for item in _ITEM_RE.findall(text):
        guid = _tag(item, "guid")
        title = _tag(item, "title")
        desc = _tag(item, "description")
        link = _tag(item, "link")
        pub = _tag(item, "pubDate")
        bm = _BUILD_GUID_RE.search(guid) or _BUILD_TEXT_RE.search(link) or _BUILD_TEXT_RE.search(desc)
        if not bm:
            continue
        vm = _VERSION_RE.search(desc) or _VERSION_RE.search(title)
        builds.append({
            "build_id": bm.group(1),
            "version": vm.group(1) if vm else "",
            "published_at": pub,
            "pub_timestamp": _epoch_ms(pub),
            "title": title,
            "description": desc,
        })
    return builds


async def fetch_steamdb_builds(appid: str | int, force: bool = False) -> list[dict]:
    """Build history for an app, newest first. Cached; serves stale on failure."""
    key = str(appid or "").strip()
    if not key:
        return []
    now = time.time() * 1000
    hit = _cache.get(key)
    if not force and hit and (now - hit["ts"]) < _TTL_MS:
        return hit["builds"]

    resp = await _solve_rss(key)
    if resp is None or not resp.ok:
        return hit["builds"] if hit else []
    builds = _parse_rss(resp.text)
    if builds:
        _cache[key] = {"builds": builds, "ts": now}
        return builds
    return hit["builds"] if hit else []


# ── Cross-scheme resolvers used by the update-check ─────────────────────────
async def resolve_pub_timestamp_from_build(appid, build_id) -> int | None:
    target = str(build_id).strip()
    if not target:
        return None
    for b in await fetch_steamdb_builds(appid):
        if str(b["build_id"]) == target:
            return b.get("pub_timestamp")
    return None


async def resolve_version_from_build(appid, build_id) -> str | None:
    target = str(build_id).strip()
    for b in await fetch_steamdb_builds(appid):
        if str(b["build_id"]) == target and b.get("version"):
            return b["version"]
    return None


async def resolve_build_from_version(appid, version) -> str | None:
    norm = re.sub(r"^v\s*", "", str(version or "").strip(), flags=re.I).lower()
    if not norm:
        return None
    for b in await fetch_steamdb_builds(appid):
        if (b.get("version") or "").lower() == norm:
            return b["build_id"]
    return None


async def latest_build(appid) -> dict | None:
    builds = await fetch_steamdb_builds(appid)
    return builds[0] if builds else None
