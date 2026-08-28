"""cs.rin.ru forum scraper.

Faithful port of the csrin block in src/lib/gameapi/helpers.js (main branch).
Logs in once per process with a bot account, caches phpBB session cookies,
solves the JS anti-bot "security check" in plain HTTP, searches the forum, then
scans each matching thread's latest page for posts that carry external links.
Posts are ranked with trusted uploaders first and untrusted last.

The app only ever links users to the forum post; hoster URLs are never exposed
as automatic-download inputs.
"""

from __future__ import annotations

import asyncio
import os
import random
import re
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

import httpx

from .cf import SITE_FETCH_TIMEOUT_MS
from .wordpress import classify_torrent_link, extract_service_name, is_valid_download_url

CSRIN_BASE = "https://cs.rin.ru/forum"
CSRIN_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
CSRIN_SESSION_TTL = 60 * 60 * 1000
CSRIN_LOGIN_FAIL_COOLDOWN = 5 * 60 * 1000


def _env_int(var: str, default: int) -> int:
    try:
        return max(1, int(os.environ.get(var, "") or default))
    except (TypeError, ValueError):
        return default


# How many threads to scan per request. Search stays modest (it runs on every
# query); the recent feed scans deeper because the forum is very active — a game
# thread bumps to the top of viewforum whenever it gets an update, so if more
# threads bump between refreshes than we scan we'd miss valid updates. All
# env-tunable so they can be raised on the VPS without a rebuild.
CSRIN_POST_SCAN_LIMIT = _env_int("CSRIN_POST_SCAN_LIMIT", 12)
# Scan the newest updated threads from the regular Topics section. The ten-post
# candidate window below handles discussion bumps without making the page wait
# on an unbounded forum crawl.
CSRIN_RECENT_SCAN_LIMIT = _env_int("CSRIN_RECENT_SCAN_LIMIT", 20)
CSRIN_POST_SCAN_CONCURRENCY = _env_int("CSRIN_POST_SCAN_CONCURRENCY", 5)
# A release thread is often bumped by discussion replies. Inspect the newest
# ten posts on its latest page so the linked release remains a candidate.
CSRIN_RECENT_POSTS_PER_THREAD = _env_int("CSRIN_RECENT_POSTS_PER_THREAD", 10)
# Steam Content Sharing is the purpose-built source for clean Steam files;
# Main Forum mixes in repacks, cracks, and general discussion.
CSRIN_RECENT_FORUM_ID = os.environ.get("CSRIN_RECENT_FORUM_ID", "22")
# The background warmer uses this same cadence. Keep the forum scan quiet by
# default; callers can still request an explicit manual refresh.
CSRIN_RECENT_TTL_MS = _env_int("CSRIN_RECENT_TTL_MINUTES", 180) * 60 * 1000
CSRIN_CSF_AUTHOR_IDS = tuple(
    value.strip() for value in os.environ.get("CSRIN_CSF_AUTHOR_IDS", "1883392").split(",") if value.strip()
)
# These uploaders are useful discovery sources but do not exclusively post clean
# Steam files, so their posts still need an explicit CSF marker to be admitted.
CSRIN_CSF_CANDIDATE_AUTHOR_IDS = tuple(
    value.strip() for value in os.environ.get("CSRIN_CSF_CANDIDATE_AUTHOR_IDS", "625155,1068689,1014019").split(",") if value.strip()
)
CSRIN_CSF_AUTHOR_POST_LIMIT = _env_int("CSRIN_CSF_AUTHOR_POST_LIMIT", 8)
CSRIN_REQUEST_MIN_DELAY_SECONDS = _env_int("CSRIN_REQUEST_MIN_DELAY_SECONDS", 1)
CSRIN_REQUEST_MAX_DELAY_SECONDS = max(
    CSRIN_REQUEST_MIN_DELAY_SECONDS,
    _env_int("CSRIN_REQUEST_MAX_DELAY_SECONDS", 10),
)


# ── Trusted / untrusted uploaders ──────────────────────────────────────────
def _seed(env_var: str) -> set[str]:
    return {n.strip().lower() for n in (os.environ.get(env_var) or "").split(",") if n.strip()}


_reliable: set[str] = _seed("CSRIN_RELIABLE_POSTERS")
_untrusted: set[str] = _seed("CSRIN_UNTRUSTED_POSTERS")
# A small, explicit allowlist for uploaders who publish a current build notice
# that points to their own maintained CSF post. Add names through the env var
# instead of treating arbitrary forum links as downloads.
_maintained_link_users: set[str] = _seed("CSRIN_MAINTAINED_LINK_USERS") or {"titeuf"}


def set_reliable_posters(names) -> None:
    global _reliable
    _reliable = {str(n).strip().lower() for n in (names or []) if str(n).strip()}


def set_untrusted_posters(names) -> None:
    global _untrusted
    _untrusted = {str(n).strip().lower() for n in (names or []) if str(n).strip()}


def _is_reliable(author: str) -> bool:
    return bool(author) and author.lower() in _reliable


def _is_untrusted(author: str) -> bool:
    if not author:
        return False
    key = author.lower()
    return key in _untrusted and key not in _reliable


def _uses_maintained_links(author: str) -> bool:
    return bool(author) and author.lower() in _maintained_link_users


# ── Session state ───────────────────────────────────────────────────────────
class _Session:
    cookies: str = ""       # "name=value; name=value" Cookie header
    logged_in_at: float = 0
    login_failed_at: float = 0


_session = _Session()
_request_rate_lock = asyncio.Lock()
_last_request_started_at = 0.0


async def _wait_for_request_slot() -> None:
    """Serialize forum traffic with a human-like randomized pause."""
    global _last_request_started_at
    async with _request_rate_lock:
        interval = random.uniform(CSRIN_REQUEST_MIN_DELAY_SECONDS, CSRIN_REQUEST_MAX_DELAY_SECONDS)
        wait_for = _last_request_started_at + interval - time.monotonic()
        if wait_for > 0:
            await asyncio.sleep(wait_for)
        _last_request_started_at = time.monotonic()
_login_lock = asyncio.Lock()


# Recent feed cache: the home page hits this on every load, so the scan (a
# forum page fetch + per-thread scans) is cached and reused for its TTL. Serves
# stale on failure rather than emptying the feed.
class _RecentCache:
    results: list[dict] = []
    timestamp: float = 0


_recent_cache = _RecentCache()
_recent_refresh_lock = asyncio.Lock()


def _now_ms() -> float:
    return time.time() * 1000


def _parse_set_cookies(resp: httpx.Response) -> list[str]:
    return [c.split(";", 1)[0].strip() for c in resp.headers.get_list("set-cookie") if c.split(";", 1)[0].strip()]


def _merge_cookie_string(existing: str, additions: list[str]) -> str:
    jar: dict[str, str] = {}
    if existing:
        for pair in existing.split(";"):
            p = pair.strip()
            eq = p.find("=")
            if eq > 0:
                jar[p[:eq]] = p[eq + 1:]
    for pair in additions:
        eq = pair.find("=")
        if eq > 0:
            jar[pair[:eq]] = pair[eq + 1:]
    return "; ".join(f"{k}={v}" for k, v in jar.items())


def decode_entities(s: str) -> str:
    return (
        s.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
        .replace("&quot;", '"').replace("&#039;", "'").replace("&nbsp;", " ")
    )


# ── Low-level fetch with security-check solving ─────────────────────────────
async def _raw_get(client: httpx.AsyncClient, url: str, headers: dict, follow_redirects: bool = False) -> httpx.Response:
    return await client.get(url, headers=headers, follow_redirects=follow_redirects)


def _looks_like_security_check(html: str) -> bool:
    return bool(html) and ("CS RIN - Security check" in html or re.search(r"securitytoken=[\w-]+", html) is not None)


def _looks_like_login_page(html: str) -> bool:
    if not html:
        return False
    return bool(re.search(r'name="username"', html, re.I)
                and re.search(r'name="password"', html, re.I)
                and re.search(r"mode=login", html, re.I))


def _is_login_redirect(resp: httpx.Response | None) -> bool:
    """Whether phpBB redirected this request to its login form.

    Requests deliberately use manual redirects so that an expired forum session
    cannot silently turn into an HTML login page which the parser treats as an
    empty search. phpBB uses both absolute and relative Location values.
    """
    if resp is None or not 300 <= resp.status_code < 400:
        return False
    location = resp.headers.get("location", "")
    if not location:
        return False
    parsed = urlparse(location)
    query = parse_qs(parsed.query)
    return parsed.path.rstrip("/").rsplit("/", 1)[-1] == "ucp.php" and query.get("mode", [""])[0].lower() == "login"


def _requires_reauthentication(resp: httpx.Response | None) -> bool:
    return _is_login_redirect(resp) or bool(resp and _looks_like_login_page(resp.text))


def _invalidate_session() -> None:
    _session.cookies = ""
    _session.logged_in_at = 0


def _has_authenticated_session_cookie() -> bool:
    user_id = re.search(r"phpbb3\w*_u=(\d+)", _session.cookies, re.I)
    return bool(user_id and user_id.group(1) != "1")


async def _solve_security_check(client: httpx.AsyncClient, original_url: str, html: str) -> bool:
    tok = re.search(r"securitytoken=([\w-]+)", html)
    exp = re.search(r"securitytoken_expiration=(\d+)", html)
    if not tok or not exp:
        print("cs.rin.ru: 401 received but security tokens not parseable")
        return False
    _session.cookies = _merge_cookie_string(_session.cookies, [
        f"securitytoken={tok.group(1)}",
        f"securitytoken_expiration={exp.group(1)}",
    ])
    parsed = httpx.URL(original_url)
    check_url = f"{parsed.scheme}://{parsed.host}/securitycheck{parsed.path}"
    if parsed.query:
        check_url += f"?{parsed.query.decode() if isinstance(parsed.query, bytes) else parsed.query}"
    resp = await client.get(
        check_url,
        headers={"User-Agent": CSRIN_USER_AGENT, "Cookie": _session.cookies, "Referer": original_url},
        follow_redirects=False,
    )
    new_cookies = _parse_set_cookies(resp)
    if new_cookies:
        _session.cookies = _merge_cookie_string(_session.cookies, new_cookies)
    return True


async def _csrin_fetch(
    client: httpx.AsyncClient,
    url: str,
    method: str = "GET",
    headers: dict | None = None,
    body: str | None = None,
) -> httpx.Response | None:
    def build_headers() -> dict:
        return {"User-Agent": CSRIN_USER_AGENT, **(headers or {}), "Cookie": _session.cookies}

    try:
        await _wait_for_request_slot()
        if method == "POST":
            resp = await client.post(url, headers=build_headers(), content=body, follow_redirects=False)
        else:
            resp = await client.get(url, headers=build_headers(), follow_redirects=False)
    except Exception as error:  # noqa: BLE001
        print(f"cs.rin.ru fetch failed for {url}: {error}")
        return None

    # Accumulate any session cookies the server hands back.
    sc = _parse_set_cookies(resp)
    if sc:
        _session.cookies = _merge_cookie_string(_session.cookies, sc)

    if resp.status_code == 401:
        body_text = resp.text
        if _looks_like_security_check(body_text):
            print("cs.rin.ru: solving security check")
            if await _solve_security_check(client, url, body_text):
                if method == "POST":
                    resp = await client.post(url, headers=build_headers(), content=body, follow_redirects=False)
                else:
                    resp = await client.get(url, headers=build_headers(), follow_redirects=False)
                sc = _parse_set_cookies(resp)
                if sc:
                    _session.cookies = _merge_cookie_string(_session.cookies, sc)
    return resp


async def _authenticated_fetch(
    client: httpx.AsyncClient,
    url: str,
    headers: dict | None = None,
) -> httpx.Response | None:
    """Fetch a protected forum page, re-authenticating once on session expiry."""
    resp = await _csrin_fetch(client, url, headers=headers)
    if not _requires_reauthentication(resp):
        return resp

    status = resp.status_code if resp else "no response"
    print(f"cs.rin.ru session expired for {url} (status {status}); logging in again")
    _invalidate_session()
    if not await _ensure_session(client):
        return None

    resp = await _csrin_fetch(client, url, headers=headers)
    if _requires_reauthentication(resp):
        print(f"cs.rin.ru still redirected to login after retry for {url}")
        _invalidate_session()
        return None
    return resp


# ── Login ────────────────────────────────────────────────────────────────────
async def _perform_login(client: httpx.AsyncClient) -> bool:
    username = os.environ.get("CSRIN_USERNAME")
    password = os.environ.get("CSRIN_PASSWORD")
    if not username or not password:
        return False

    try:
        form = await _csrin_fetch(client, f"{CSRIN_BASE}/ucp.php?mode=login")
        # phpBB redirects an already logged-in user away from the login form.
        # That is a valid session refresh, not a failed login. Without this,
        # the hourly session TTL turns every later scheduled scan into a stale
        # cache response until the container is restarted.
        if form and 300 <= form.status_code < 400 and _has_authenticated_session_cookie():
            _session.logged_in_at = _now_ms()
            _session.login_failed_at = 0
            print("cs.rin.ru session remains authenticated")
            return True
        if not form or not form.is_success:
            print(f"cs.rin.ru login form fetch failed: {form.status_code if form else 'no response'}")
            return False
        form_html = form.text

        from urllib.parse import urlencode
        fields = {"username": username, "password": password, "redirect": "index.php", "login": "Login"}
        for name in ("sid", "form_token", "creation_time"):
            m = re.search(rf'name="{name}"\s+value="([^"]+)"', form_html)
            if m:
                fields[name] = m.group(1)

        login = await _csrin_fetch(
            client,
            f"{CSRIN_BASE}/ucp.php?mode=login",
            method="POST",
            headers={"Content-Type": "application/x-www-form-urlencoded", "Referer": f"{CSRIN_BASE}/ucp.php?mode=login"},
            body=urlencode(fields),
        )
        if login is None:
            return False

        if not _has_authenticated_session_cookie() or _is_login_redirect(login):
            print(f"cs.rin.ru login appears rejected (status {login.status_code})")
            return False

        _session.logged_in_at = _now_ms()
        _session.login_failed_at = 0
        print("cs.rin.ru login successful")
        return True
    except Exception as err:  # noqa: BLE001
        print(f"cs.rin.ru login error: {err}")
        return False


async def _ensure_session(client: httpx.AsyncClient) -> bool:
    if _session.cookies and (_now_ms() - _session.logged_in_at < CSRIN_SESSION_TTL):
        return True
    if _session.login_failed_at and (_now_ms() - _session.login_failed_at < CSRIN_LOGIN_FAIL_COOLDOWN):
        return False
    async with _login_lock:
        # Re-check after acquiring the lock (another caller may have logged in).
        if _session.cookies and (_now_ms() - _session.logged_in_at < CSRIN_SESSION_TTL):
            return True
        ok = await _perform_login(client)
        if not ok:
            _session.login_failed_at = _now_ms()
        return ok


# ── Post parsing ─────────────────────────────────────────────────────────────
def _build_csrin_post(thread_id: str, title: str, link: str) -> dict:
    return {
        "id": f"csrin-{thread_id}",
        "originalId": thread_id,
        "title": title,
        "excerpt": "",
        "link": link,
        "date": datetime.now(timezone.utc).isoformat(),
        "slug": "",
        "description": "Forum thread on cs.rin.ru - click to view the latest post",
        "categories": [],
        "tags": [],
        "downloadLinks": [],
        "source": "CS.RIN.RU",
        "siteType": "csrin",
        "image": None,
    }


def _strip_csrin_html(value: str) -> str:
    return decode_entities(
        re.sub(r"\s+", " ",
               re.sub(r"<[^>]+>", " ",
                      re.sub(r"</p>", "\n",
                             re.sub(r"<br\s*/?>", "\n", value, flags=re.I), flags=re.I)))
    ).strip()


def _clean_csrin_title(raw: str) -> str:
    """Drop the leading forum status tags ([Info], [Update], [Request], [Full],
    etc.) so the remainder is the plain game name IGDB/Steam can match on. Only
    leading bracket groups are removed; brackets/parens inside the name (e.g.
    "Sam & Max ... (Season 1)") are kept. The frontend cleanGameTitle still runs
    on top for version/build/scene-group stripping."""
    s = (raw or "").strip()
    prev = None
    while prev != s:
        prev = s
        s = re.sub(r"^\[[^\]]*\]\s*", "", s).strip()
    return re.sub(r"\s+", " ", s).strip()


# Threads that are perpetually near the top of the subforum but never carry a new
# release — dedicated modding threads, request/support threads. Skipped entirely.
_NOISE_THREAD_RE = re.compile(
    r"\b(?:modding|mods?)\s+thread\b|\bdedicated\s+modding\b"
    r"|\brequests?\s+thread\b|\bsupport\s+thread\b",
    re.I,
)

_QUOTE_OPEN_RE = re.compile(r'<div\b[^>]*class="[^"]*\bquotecontent\b[^"]*"[^>]*>', re.I)
_DIV_TOKEN_RE = re.compile(r"<div\b[^>]*>|</div\s*>", re.I)


def _strip_quote_blocks(html: str) -> str:
    """Remove rinDark quote bodies (`<div class="quotecontent"> … </div>`, which
    nest) from post HTML.

    Links that live inside a quote are quoted from someone else's post — request
    fulfilments, mod/DLC file-shares, "your file is here" replies — not this
    post's own release. Dropping quoted content means such posts contribute no
    download links and fall out of the feed, while a normal release post (whose
    links sit in the body, outside any quote) is untouched."""
    out: list[str] = []
    i = 0
    while True:
        m = _QUOTE_OPEN_RE.search(html, i)
        if not m:
            out.append(html[i:])
            break
        out.append(html[i:m.start()])
        # Walk div tokens from just after the opening tag to its matching close.
        depth = 1
        j = m.end()
        while depth > 0:
            tok = _DIV_TOKEN_RE.search(html, j)
            if not tok:
                j = len(html)
                break
            j = tok.end()
            depth += -1 if tok.group(0).lower().startswith("</div") else 1
        i = j  # skip the whole quotecontent span
    return "".join(out)


# cs.rin.ru's rinDark theme is old phpBB2: each post is anchored by
# `<a name="pNNNN">` (not `<div id="pNNNN">`), the body is `<span class="postbody">`
# (not `<div class="content">`), the author is `<b class="postauthor">`, and
# signatures are separated by a run of underscores. Both themes are matched so
# the parser also works on the phpBB3 markup the original code assumed.
def _get_post_blocks(html: str) -> list[dict]:
    starts = list(re.finditer(r'<(?:div|a)\b[^>]*\b(?:id|name)="p(\d+)"[^>]*>', html, re.I))
    blocks = []
    for i, m in enumerate(starts):
        start = m.start()
        end = starts[i + 1].start() if i + 1 < len(starts) else len(html)
        blocks.append({"postId": m.group(1), "html": html[start:end]})
    return blocks


def _get_post_content(post_html: str) -> str:
    # rinDark: message is the first <span class="postbody">; the signature is the
    # same class after a "____" separator, so cut there.
    m = re.search(r'class="postbody"', post_html, re.I)
    if m:
        seg = post_html[m.start():]
        sig = re.search(r"_{5,}", seg)
        return seg[:sig.start()] if sig else seg
    # phpBB3: <div class="content"> ... up to <div class="signature">.
    m = re.search(r'<div\b[^>]*\bclass="[^"]*\bcontent\b[^"]*"[^>]*>', post_html, re.I)
    if m:
        after = post_html[m.start():]
        sig = re.search(r'<div\b[^>]*\bclass="[^"]*\bsignature\b[^"]*"[^>]*>', after, re.I)
        return after[:sig.start()] if sig else after
    return re.sub(r'<div\b[^>]*\bclass="[^"]*\bsignature\b[^"]*"[^>]*>[\s\S]*', "", post_html, flags=re.I)


def _post_timestamp(post_html: str) -> datetime | None:
    """Parse phpBB's relative and absolute post dates as UTC.

    The forum supplies `Today` / `Yesterday` for current activity and a dated
    weekday form for older posts. Unknown formats are deliberately rejected by
    the recent feed rather than letting an undated old release through.
    """
    text = _strip_csrin_html(post_html)
    now = datetime.now(timezone.utc)
    elapsed = re.search(
        r"\bPosted:\s*(?:(\d+)\s+minutes?\s+ago|(\d+)\s+hours?\s+ago|an?\s+hour\s+ago|"
        r"(\d+)\s+days?\s+ago|just\s+now)",
        text,
        re.I,
    )
    if elapsed:
        minutes = int(elapsed.group(1) or 0)
        hours = int(elapsed.group(2) or (1 if "hour ago" in elapsed.group(0).lower() else 0))
        days = int(elapsed.group(3) or 0)
        return now - timedelta(days=days, hours=hours, minutes=minutes)
    relative = re.search(r"\bPosted:\s*(Today|Yesterday),\s*(\d{1,2}:\d{2})", text, re.I)
    if relative:
        hour, minute = (int(part) for part in relative.group(2).split(":"))
        day = now.date() - timedelta(days=1 if relative.group(1).lower() == "yesterday" else 0)
        return datetime(day.year, day.month, day.day, hour, minute, tzinfo=timezone.utc)

    absolute = re.search(
        r"\bPosted:\s*(?:[A-Za-z]+,\s+)?(\d{1,2}\s+[A-Za-z]{3}\s+\d{4}),\s*(\d{1,2}:\d{2})",
        text,
        re.I,
    )
    if not absolute:
        return None
    try:
        return datetime.strptime(
            f"{absolute.group(1)} {absolute.group(2)}", "%d %b %Y %H:%M"
        ).replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _is_recent_post(posted_at: datetime | None) -> bool:
    if posted_at is None:
        return False
    age = datetime.now(timezone.utc) - posted_at
    return timedelta(hours=-2) <= age <= timedelta(days=1)


def _extract_download_links_from_content(content: str) -> list[dict]:
    """Real download links only from one already-isolated post section.

    Uses the same classifier as the WordPress sites: recognised file hosts and
    magnet/.torrent links count; forum links, changelogs, sha256 pages, store
    pages, screenshots and rutracker threads do not. This is what drops the
    linkless showcase/[Info] posts (their only links are Steam/YouTube/etc) and
    ignores the non-download noise in busy posts like the Factorio one.
    """
    links: list[dict] = []
    seen: set[str] = set()
    for m in re.finditer(r'<a\b[^>]*\bhref="([^"]+)"[^>]*>', content, re.I):
        url = decode_entities(m.group(1)).strip()
        if not re.match(r"^(https?://|magnet:)", url, re.I):
            continue
        key = url.lower()
        if key in seen:
            continue
        torrent = classify_torrent_link(url)
        if torrent:
            seen.add(key)
            links.append(torrent)
            continue
        if is_valid_download_url(url):
            seen.add(key)
            service = extract_service_name(url)
            links.append({"type": "hosting", "service": service, "url": url, "text": service})
    return links


def _extract_download_links(post_html: str) -> list[dict]:
    """Real download links only, scoped to the post body."""
    return _extract_download_links_from_content(_get_post_content(post_html))


_STEAM_APP_LINK_RE = re.compile(
    r'<a\b[^>]*\bhref="([^"]*store\.steampowered\.com/app/(\d+)[^"]*)"[^>]*>([\s\S]*?)</a>',
    re.I,
)
_SECTION_NOISE_RE = re.compile(
    r"^(?:official\s+(?:site|steam)|steam(?:\s+store)?|download\s+links?|"
    r"mirrors?|uploaded\s+version|depots?(?:\s*&\s*manifests?)?|"
    r"version|build|https?://|[-_=* ]+)$",
    re.I,
)


def _html_lines(value: str) -> list[str]:
    """Return visible post lines while preserving enough structure for headings."""
    text = re.sub(r"<(?:br|/p|/div|/tr|/li)\b[^>]*>", "\n", value, flags=re.I)
    text = decode_entities(re.sub(r"<[^>]+>", " ", text))
    return [re.sub(r"\s+", " ", line).strip() for line in text.splitlines() if line.strip()]


def _section_title(prefix: str, anchor_text: str, fallback: str) -> str:
    """Use the Steam-link text or a nearby visible heading as a section name."""
    for value in (anchor_text, *reversed(_html_lines(prefix)[-8:])):
        candidate = re.sub(r"\s*\[(?:win(?:dows)?(?:\s*\d+)?|win64|mac(?:os)?|os\s*x)\]\s*", " ", value, flags=re.I)
        candidate = re.sub(r"\s+", " ", candidate).strip(" -:|")
        if candidate and len(candidate) <= 160 and not _SECTION_NOISE_RE.search(candidate):
            return candidate
    return fallback


def _section_platform(value: str) -> str:
    text = _strip_csrin_html(value)
    return "macOS" if re.search(r"\b(?:macos|mac\s*os|os\s*x|apple\s+silicon)\b", text, re.I) else "Windows"


def _content_sharing_sections(content: str, fallback_title: str) -> list[dict]:
    """Split a Forum 22 megapost only at explicit Steam AppID boundaries.

    A normal release has one Steam link (or none), and remains a single
    candidate. A multi-game post has at least two distinct AppID anchors; its
    direct links are then scoped to their own section so one game's mirrors do
    not leak onto another card.
    """
    matches = list(_STEAM_APP_LINK_RE.finditer(content))
    if len({match.group(2) for match in matches}) < 2:
        return []

    sections: list[dict] = []
    for index, match in enumerate(matches):
        next_start = matches[index + 1].start() if index + 1 < len(matches) else len(content)
        section_html = content[match.start():next_start]
        # Platform is normally stated in the game heading immediately before
        # its Steam link. Do not scan forward here: the next game's macOS
        # heading belongs to the next section, not this one.
        platform_text = content[max(0, match.start() - 300):match.end()]
        sections.append({
            "html": section_html,
            "title": _section_title(content[max(0, match.start() - 900):match.start()],
                                    _strip_csrin_html(match.group(3)), fallback_title),
            "appid": match.group(2),
            "platform": _section_platform(platform_text),
        })
    return sections


def _post_link_for_candidate(thread_link: str, post_id: str) -> str:
    """Point directly at the candidate post, not the later bump in the listing."""
    base = thread_link.split("#", 1)[0]
    replaced = re.sub(r"([?&])p=\d+", rf"\1p={post_id}", base, count=1)
    if replaced == base:
        replaced += "&" if "?" in base else "?"
        replaced += f"p={post_id}"
    return f"{replaced}#p{post_id}"


# CSF = "Clean Steam Files": the clean, desirable uploads. Any mention (and its
# variations) boosts the post in ranking.
_CSF_RE = re.compile(r"\bcsfs?\b|clean\s+steam\s+files?|clean\s+files?|clean\s+steam\b", re.I)

# Some uploaders market a release as "based on CSF" while packaging a crack or
# emulator with it. Those are not clean Steam files and must lose to the
# CSF-only policy even when the post includes the CSF abbreviation.
_NON_CSF_RELEASE_RE = re.compile(
    r"\b(?:pre[\s-]?cracked|pre[\s-]?installed|portable|repack(?:ed)?|"
    r"gamebounty|anker\s*games|elamigos|fitgirl|dodi)\b|"
    r"\b(?:crack|emulator)\s*(?:by|included|bundled|is\s+included)\b",
    re.I,
)

# Online-Fix / OFME (Online-Fix.Me) / 0xdeadcode releases bundle multiplayer
# crack patches. CS.RIN is restricted to untouched clean Steam files, so these
# are exclusions even when the post also says it began from a CSF dump.
_ONLINE_FIX_RE = re.compile(
    r"\bof[\s._-]?me\b|\bonline[\s._-]?fix\b|\b0xdeadcode\b",
    re.I,
)


_RELEASE_LABEL_PATTERNS = [
    re.compile(r"\b(?:version|ver\.?|v)\s*[:#-]?\s*(\d+(?:[._-]\d+){1,5}(?:[a-z]\d*)?\b)", re.I),
    re.compile(r"\b(?:build|buildid)\s*[:#-]?\s*(\d{4,})\b", re.I),
    re.compile(r"\b(\d{4}[._-]\d{2}[._-]\d{2})\b"),
]


def _extract_release_label(text: str) -> str:
    # Some CSF uploaders abbreviate Steam build IDs as `b24962804`. Normalize
    # that shorthand so the shared version tracking code receives `Build ...`.
    shorthand = re.search(r"\bb(\d{4,})\b", text, re.I)
    if shorthand:
        return f"Build {shorthand.group(1)}"
    for pat in _RELEASE_LABEL_PATTERNS:
        m = pat.search(text)
        if m:
            return re.sub(r"\s+", " ", m.group(0)).strip()
    return ""


def _content_sharing_updated_at(thread: dict) -> datetime | None:
    """Forum 22 refreshes its original-topic subject with `[DD.MM.YYYY]`."""
    if str(thread.get("forumId") or "") != "22":
        return None
    m = re.search(r"\[(\d{2}\.\d{2}\.\d{4})\]", str(thread.get("rawTitle") or ""))
    if not m:
        return None
    try:
        return datetime.strptime(m.group(1), "%d.%m.%Y").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _content_sharing_release_update(blocks: list[dict]) -> tuple[str, datetime | None]:
    """Read Forum 22's Upload-Crew bot build from its companion reply.

    The topic opener owns the links and is edited in place, while the forum's
    bot posts an ``Uploaded version`` reply containing the authoritative build.
    Restrict this to that explicit marker so regular discussion replies cannot
    supply release metadata for a container post.
    """
    for block in blocks[1:]:
        text = _strip_csrin_html(_get_post_content(_strip_quote_blocks(block["html"])))
        if not re.search(r"\buploaded\s+version\b", text, re.I):
            continue
        label = _extract_release_label(text)
        if label:
            return label, _post_timestamp(block["html"])
    return "", None


def _extract_author(post_html: str) -> str:
    # rinDark uses <b class="postauthor">Name</b> (sometimes an <a>); phpBB3 uses
    # a username/username-coloured anchor. Match the class on any element.
    m = re.search(
        r'class="[^"]*\b(?:postauthor|username(?:-coloured)?)\b[^"]*"[^>]*>(?:\s*<a[^>]*>)?\s*([^<]+)<',
        post_html, re.I,
    )
    return decode_entities(m.group(1)).strip() if m else ""


def _extract_topic_author(html: str, from_pos: int) -> str:
    """The thread's original poster, read from the forum/search listing row.

    Each row renders `<p class="topicauthor"><a ...>Name</a>` shortly after its
    topictitle link; scan a bounded window forward from the title so we pick up
    that row's author and not a later one."""
    window = html[from_pos:from_pos + 2000]
    m = re.search(r'class="topicauthor"[^>]*>\s*(?:<a[^>]*>\s*)?([^<]+?)\s*<', window, re.I)
    return decode_entities(m.group(1)).strip() if m else ""


def parse_linked_posts(
    html: str,
    thread: dict,
    recent_post_limit: int | None = None,
    only_post_id: str = "",
    require_recent: bool = True,
    trusted_csf_source: bool = False,
) -> list[dict]:
    results = []
    seen: set[str] = set()
    thread_link = str(thread["link"]).split("#", 1)[0]
    blocks = _get_post_blocks(html)
    content_sharing_updated_at = _content_sharing_updated_at(thread)
    content_sharing_label, content_sharing_posted_at = (
        _content_sharing_release_update(blocks) if content_sharing_updated_at else ("", None)
    )
    if only_post_id:
        blocks = [block for block in blocks if block["postId"] == only_post_id]
    elif content_sharing_updated_at:
        # Steam Content Sharing updates its original container post in place;
        # later replies are unrelated discussion, not a newer release.
        blocks = blocks[:1]
    elif recent_post_limit is not None:
        blocks = blocks[-max(1, recent_post_limit):]
    for block in blocks:
        # Forum 22 subjects record only the calendar date. Prefer the
        # Upload-Crew bot's real post time for the 24-hour eligibility window,
        # otherwise an update can expire shortly after midnight.
        posted_at = content_sharing_posted_at or content_sharing_updated_at or _post_timestamp(block["html"])
        if require_recent and not _is_recent_post(posted_at):
            continue
        # Drop quoted content first so links/text/CSF/version all reflect the
        # poster's own release, not a quoted request or mod/DLC file-share.
        block_html = _strip_quote_blocks(block["html"])
        # Do not inspect the surrounding author panel or signature. Common
        # signatures explain what CSF means, which used to falsely classify
        # unrelated portable/pre-cracked releases as clean Steam files.
        content = _get_post_content(block_html)
        author = _extract_author(block["html"])
        reliable = _is_reliable(author)
        untrusted = _is_untrusted(author)
        clean_thread_title = thread["title"]
        raw_thread_title = thread.get("rawTitle") or clean_thread_title
        if content_sharing_updated_at:
            raw_thread_title = re.sub(r"\s*\[\d{2}\.\d{2}\.\d{4}\]\s*", " ", raw_thread_title).strip()
            clean_thread_title = re.sub(r"\s*\[\d{2}\.\d{2}\.\d{4}\]\s*", " ", clean_thread_title).strip()

        sections = _content_sharing_sections(content, clean_thread_title) if content_sharing_updated_at else []
        if not sections:
            sections = [{
                "html": content,
                "title": clean_thread_title,
                "appid": "",
                "platform": _section_platform(content) if content_sharing_updated_at else "",
            }]

        for section in sections:
            section_html = section["html"]
            links = _extract_download_links_from_content(section_html)
            if not links:
                continue  # only surface posts with at least one real download link
            text = _strip_csrin_html(section_html)
            # The Forum 22 bot's build is valid fallback metadata for a regular
            # single-title opener, never for a multi-title container.
            label = _extract_release_label(text) or (content_sharing_label if len(sections) == 1 else "")
            if not label and not content_sharing_updated_at:
                continue
            link_blob = " ".join((l.get("url", "") + " " + l.get("text", "")) for l in links)
            csf = bool(trusted_csf_source or content_sharing_updated_at or _CSF_RE.search(text) or _CSF_RE.search(link_blob))
            if not csf:
                continue
            if (
                _NON_CSF_RELEASE_RE.search(text)
                or _NON_CSF_RELEASE_RE.search(link_blob)
                or _ONLINE_FIX_RE.search(text)
                or _ONLINE_FIX_RE.search(link_blob)
            ):
                continue

            appid = str(section["appid"] or "")
            post_link = _post_link_for_candidate(thread_link, block["postId"])
            release_key = f"{thread['threadId']}:{appid}" if appid else str(thread["threadId"])
            if release_key in seen:
                continue
            seen.add(release_key)

            clean_title = str(section["title"] or clean_thread_title)
            raw_title = clean_title if appid else raw_thread_title
            original_poster = thread.get("originalPoster") or author
            full_title = f"{raw_title} - {label}" if label else raw_title
            platform = str(section["platform"] or "")

            post = _build_csrin_post(thread["threadId"], clean_title, post_link)
            post.update({
                "date": posted_at.isoformat() if posted_at else datetime.now(timezone.utc).isoformat(),
                "downloadLinks": links,
                "excerpt": text[:360],
                "id": f"csrin-{thread['threadId']}-{block['postId']}-{appid or 'default'}",
                "description": (
                    f"{len(links)} download link{'' if len(links) == 1 else 's'}"
                    + (f" by {author}" if author else "")
                    + (" (trusted uploader)" if reliable else "")
                    + (" (untrusted uploader)" if untrusted else "")
                    + (" (CSF)" if csf else "")
                    + (f" ({platform})" if platform else "")
                    + (f" ({label})" if label else "")
                ),
                "csrinPostId": block["postId"],
                "csrinReleaseKey": release_key,
                "csrinLinkCount": len(links),
                "csrinHasReleaseMetadata": bool(label),
                "csrinAuthor": author,
                "csrinOriginalPoster": original_poster,
                "csrinFullTitle": full_title,
                "csrinReleaseLabel": label,
                "csrinPlatform": platform or None,
                "csrinReliablePoster": reliable,
                "csrinUntrustedPoster": untrusted,
                "csrinCsf": csf,
                "csrinOnlineFix": False,
            })
            if appid:
                post["appid"] = appid
            results.append(post)
    return results


def _same_thread_post_references(content: str, thread_id: str) -> list[str]:
    """Return explicit phpBB post references that stay inside this thread."""
    refs: list[str] = []
    for match in re.finditer(r'<a\b[^>]*\bhref="([^"]+)"[^>]*>', content, re.I):
        parsed = urlparse(decode_entities(match.group(1)).strip())
        if parsed.netloc and parsed.netloc.lower() not in {"cs.rin.ru", "www.cs.rin.ru"}:
            continue
        if not parsed.path.lower().endswith("viewtopic.php"):
            continue
        query = parse_qs(parsed.query)
        post_id = (query.get("p") or [""])[0]
        target_thread = (query.get("t") or [""])[0]
        if post_id and (not target_thread or target_thread == thread_id) and post_id not in refs:
            refs.append(post_id)
    return refs


def _maintained_link_notices(html: str, thread: dict, recent_post_limit: int | None) -> list[dict]:
    """Current build notices from allowlisted uploaders that link to a prior post."""
    blocks = _get_post_blocks(html)
    if recent_post_limit is not None:
        blocks = blocks[-max(1, recent_post_limit):]
    notices: list[dict] = []
    for block in blocks:
        posted_at = _post_timestamp(block["html"])
        if not _is_recent_post(posted_at):
            continue
        block_html = _strip_quote_blocks(block["html"])
        content = _get_post_content(block_html)
        author = _extract_author(block["html"])
        label = _extract_release_label(_strip_csrin_html(content))
        refs = _same_thread_post_references(content, str(thread["threadId"]))
        if _uses_maintained_links(author) and label and refs:
            notices.append({
                "postId": block["postId"],
                "postedAt": posted_at,
                "author": author,
                "label": label,
                "text": _strip_csrin_html(content),
                "references": refs[:3],
            })
    return notices


def parse_search_results(html: str) -> list[dict]:
    last_start: dict[str, int] = {}
    last_forum: dict[str, str] = {}
    # The forum's "View the latest post" anchor carries the exact phpBB post
    # ID (`...&p=3576259#p3576259`). Prefer it over a page offset: a topic's
    # pagination links only tell us its last *page*, whereas this points at the
    # precise newest post that caused the thread to rise in the listing.
    last_post: dict[str, str] = {}
    for m in re.finditer(r'href="([^"]*viewtopic\.php\?[^"]*)"', html, re.I):
        href = decode_entities(m.group(1))
        t = re.search(r"[?&]t=(\d+)", href)
        p = re.search(r"[?&]p=(\d+)", href)
        s = re.search(r"[?&]start=(\d+)", href)
        f = re.search(r"[?&]f=(\d+)", href)
        if not t:
            continue
        tid = t.group(1)
        if p:
            last_post[tid] = p.group(1)
        if f:
            last_forum[tid] = f.group(1)
        if s:
            sval = int(s.group(1))
            if tid not in last_start or sval > last_start[tid]:
                last_start[tid] = sval

    results = []
    seen: set[str] = set()
    patterns = [
        re.compile(r'<a\s+[^>]*class="topictitle"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)</a>', re.I),
        re.compile(r'<a\s+[^>]*href="([^"]+)"[^>]*class="topictitle"[^>]*>([\s\S]*?)</a>', re.I),
    ]
    for re_pat in patterns:
        for m in re_pat.finditer(html):
            href = decode_entities(m.group(1))
            title_html = m.group(2)
            tm = re.search(r"[?&]t=(\d+)", href)
            if not tm:
                continue
            thread_id = tm.group(1)
            if thread_id in seen:
                continue
            seen.add(thread_id)

            cleaned = re.sub(
                r'<([a-z]+)[^>]*style="[^"]*(?:display\s*:\s*none|visibility\s*:\s*hidden)[^"]*"[^>]*>[\s\S]*?</\1>',
                "", title_html, flags=re.I)
            raw_title = re.sub(r"\s+", " ", decode_entities(re.sub(r"<[^>]+>", "", cleaned))).strip()
            if not raw_title:
                continue
            if _NOISE_THREAD_RE.search(raw_title):
                continue  # modding / request / support megathreads aren't releases
            title = _clean_csrin_title(raw_title)
            original_poster = _extract_topic_author(html, m.end())

            f = last_forum.get(thread_id) or (re.search(r"[?&]f=(\d+)", href).group(1) if re.search(r"[?&]f=(\d+)", href) else "")
            params = []
            if f:
                params.append(f"f={f}")
            params.append(f"t={thread_id}")
            latest_post = last_post.get(thread_id)
            start = last_start.get(thread_id)
            if latest_post:
                params.append(f"p={latest_post}")
                link = f"{CSRIN_BASE}/viewtopic.php?{'&'.join(params)}#p{latest_post}"
            else:
                if start is not None:
                    params.append(f"start={start}")
                link = f"{CSRIN_BASE}/viewtopic.php?{'&'.join(params)}"
            post = _build_csrin_post(thread_id, title or raw_title, link)
            post.update({
                "threadId": thread_id,
                "forumId": f or "",
                "start": start or 0,
                "latestPostId": latest_post or "",
                "rawTitle": raw_title,
                "originalPoster": original_poster,
            })
            results.append(post)
    return results


# ── Thread scan + search ─────────────────────────────────────────────────────
def parse_csf_author_posts(html: str) -> list[dict]:
    """Parse allowlisted author search results as trusted CSF post candidates."""
    posts: list[dict] = []
    for block in _get_post_blocks(html):
        topic = re.search(
            r"Topic:\s*<a[^>]*href=\"([^\"]*viewtopic\.php\?[^\"]*)\"[^>]*>([\s\S]*?)</a>",
            block["html"], re.I,
        )
        subject = re.search(
            r"Post subject:</b>\s*<a[^>]*href=\"([^\"]*viewtopic\.php\?[^\"]*)\"",
            block["html"], re.I,
        )
        if not topic or not subject:
            continue
        topic_href = decode_entities(topic.group(1))
        thread_match = re.search(r"[?&]t=(\d+)", topic_href)
        forum_match = re.search(r"[?&]f=(\d+)", topic_href)
        if not thread_match:
            continue
        raw_title = re.sub(r"\s+", " ", decode_entities(re.sub(r"<[^>]+>", "", topic.group(2)))).strip()
        if not raw_title or _NOISE_THREAD_RE.search(raw_title):
            continue
        post_href = decode_entities(subject.group(1))
        if post_href.startswith("./"):
            post_href = f"{CSRIN_BASE}/{post_href[2:]}"
        thread = {
            "threadId": thread_match.group(1),
            "forumId": forum_match.group(1) if forum_match else "",
            "title": _clean_csrin_title(raw_title) or raw_title,
            "rawTitle": raw_title,
            "link": post_href,
        }
        posts.extend(parse_linked_posts(
            block["html"], thread, only_post_id=block["postId"], trusted_csf_source=True,
        ))
    return posts


async def _fetch_csf_author_posts(
    client: httpx.AsyncClient,
    search_query: str = "",
) -> list[dict]:
    results: list[dict] = []
    author_sources = [
        *( (author_id, True) for author_id in CSRIN_CSF_AUTHOR_IDS ),
        *( (author_id, False) for author_id in CSRIN_CSF_CANDIDATE_AUTHOR_IDS ),
    ]
    for author_id, trusted_csf_source in author_sources:
        from urllib.parse import urlencode
        params = {"author_id": author_id, "sr": "posts"}
        if search_query:
            params.update({
                "keywords": search_query,
                "st": "0", "sk": "t", "sd": "d", "sf": "msgonly",
            })
        url = f"{CSRIN_BASE}/search.php?{urlencode(params)}"
        resp = await _authenticated_fetch(client, url, headers={"Referer": f"{CSRIN_BASE}/search.php"})
        if not resp or not resp.is_success:
            continue
        for block in _get_post_blocks(resp.text)[:CSRIN_CSF_AUTHOR_POST_LIMIT]:
            topic = re.search(
                r"Topic:\s*<a[^>]*href=\"([^\"]*viewtopic\.php\?[^\"]*)\"[^>]*>([\s\S]*?)</a>",
                block["html"], re.I,
            )
            subject = re.search(
                r"Post subject:</b>\s*<a[^>]*href=\"([^\"]*viewtopic\.php\?[^\"]*)\"",
                block["html"], re.I,
            )
            if not topic or not subject:
                continue
            topic_href = decode_entities(topic.group(1))
            thread_match = re.search(r"[?&]t=(\d+)", topic_href)
            forum_match = re.search(r"[?&]f=(\d+)", topic_href)
            if not thread_match:
                continue
            post_href = decode_entities(subject.group(1))
            if post_href.startswith("./"):
                post_href = f"{CSRIN_BASE}/{post_href[2:]}"
            raw_title = re.sub(r"\s+", " ", decode_entities(re.sub(r"<[^>]+>", "", topic.group(2)))).strip()
            if not raw_title or _NOISE_THREAD_RE.search(raw_title):
                continue
            thread = {
                "threadId": thread_match.group(1),
                "forumId": forum_match.group(1) if forum_match else "",
                "title": _clean_csrin_title(raw_title) or raw_title,
                "rawTitle": raw_title,
                "link": post_href,
            }
            post_resp = await _authenticated_fetch(client, post_href, headers={"Referer": url})
            if post_resp and post_resp.is_success:
                results.extend(parse_linked_posts(
                    post_resp.text,
                    thread,
                    only_post_id=block["postId"],
                    trusted_csf_source=trusted_csf_source,
                ))
    return results


async def _resolve_maintained_link_notices(
    client: httpx.AsyncClient,
    thread: dict,
    html: str,
    recent_post_limit: int | None,
) -> list[dict]:
    resolved: list[dict] = []
    for notice in _maintained_link_notices(html, thread, recent_post_limit):
        pending = list(notice["references"])
        visited: set[str] = set()
        # Titeuf sometimes updates a maintained post which itself points at the
        # original CSF post. Keep this deliberately short and same-author only.
        while pending and len(visited) < 3:
            reference_id = pending.pop(0)
            if reference_id in visited:
                continue
            visited.add(reference_id)
            reference_link = f"{CSRIN_BASE}/viewtopic.php?p={reference_id}#p{reference_id}"
            resp = await _authenticated_fetch(
                client, reference_link, headers={"Referer": thread["link"]}
            )
            if not resp or not resp.is_success:
                continue
            source_thread = {**thread, "link": reference_link}
            source_posts = parse_linked_posts(
                resp.text,
                source_thread,
                only_post_id=reference_id,
                require_recent=False,
            )
            source = next(
                (post for post in source_posts
                 if post.get("csrinAuthor", "").lower() == notice["author"].lower()),
                None,
            )
            if not source:
                target_block = next(
                    (block for block in _get_post_blocks(resp.text)
                     if block["postId"] == reference_id),
                    None,
                )
                if target_block and _extract_author(target_block["html"]).lower() == notice["author"].lower():
                    content = _get_post_content(_strip_quote_blocks(target_block["html"]))
                    pending.extend(
                        post_id for post_id in _same_thread_post_references(content, str(thread["threadId"]))
                        if post_id not in visited and post_id not in pending
                    )
                continue

            # The current notice supplies the freshness/build; the older,
            # verified CSF post supplies its maintained host links.
            raw_title = thread.get("rawTitle") or thread["title"]
            source.update({
                "id": f"csrin-{thread['threadId']}-{notice['postId']}",
                "link": _post_link_for_candidate(thread["link"], notice["postId"]),
                "date": notice["postedAt"].isoformat(),
                "excerpt": notice["text"][:360],
                "csrinPostId": notice["postId"],
                "csrinReferencePostId": reference_id,
                "csrinReleaseLabel": notice["label"],
                "csrinFullTitle": f"{raw_title} - {notice['label']}",
                "csrinMaintainedLink": True,
            })
            source["description"] += " (maintained CSF link)"
            resolved.append(source)
            break
    return resolved


async def _fetch_thread_linked_posts(
    client: httpx.AsyncClient,
    thread: dict,
    recent_post_limit: int | None = None,
) -> list[dict]:
    source_thread = thread
    fetch_link = thread["link"]
    if str(thread.get("forumId") or "") == "22":
        # Content Sharing maintains the actual container in the topic opener.
        # Do not follow the listing's latest-reply link.
        fetch_link = f"{CSRIN_BASE}/viewtopic.php?f=22&t={thread['threadId']}"
        source_thread = {**thread, "link": fetch_link}
    resp = await _authenticated_fetch(client, fetch_link, headers={"Referer": f"{CSRIN_BASE}/search.php"})
    if not resp or not resp.is_success:
        print(f"cs.rin.ru thread {thread['threadId']} returned {resp.status_code if resp else 'no response'}")
        return []
    direct = parse_linked_posts(resp.text, source_thread, recent_post_limit)
    maintained = await _resolve_maintained_link_notices(client, source_thread, resp.text, recent_post_limit)
    return direct + maintained


async def _scan_threads(
    client: httpx.AsyncClient,
    threads: list[dict],
    recent_post_limit: int | None = None,
) -> list[dict]:
    """Scan each thread's latest page for link-bearing posts, concurrently but
    bounded, then rank the flattened result. Shared by search and recent."""
    if not threads:
        return []
    sem = asyncio.Semaphore(CSRIN_POST_SCAN_CONCURRENCY)

    async def scan(thread: dict) -> list[dict]:
        async with sem:
            try:
                return await _fetch_thread_linked_posts(client, thread, recent_post_limit)
            except Exception as error:  # noqa: BLE001
                print(f"cs.rin.ru post scan failed for thread {thread['threadId']}: {error}")
                return []

    groups = await asyncio.gather(*(scan(t) for t in threads))
    return _rank([p for g in groups for p in g])


def _rank(posts: list[dict]) -> list[dict]:
    # Priority: trusted uploaders first, then untrusted sink, then CSF (Clean
    # Steam Files) boost, then documented releases. Link count is only a final
    # tiebreaker so a post spamming many links (e.g. multi-spoiler dumps) can't
    # outrank a clean CSF/trusted one.
    return sorted(posts, key=lambda p: (
        0 if p.get("csrinReliablePoster") else 1,
        1 if p.get("csrinUntrustedPoster") else 0,
        0 if p.get("csrinCsf") else 1,
        0 if p.get("csrinHasReleaseMetadata") else 1,
        -int(p.get("csrinLinkCount") or 0),
        (p.get("title") or "").lower(),
    ))


def _dedupe_recent_posts(posts: list[dict]) -> list[dict]:
    """Keep the newest release post for each game section and Online-Fix variant.

    A thread's last forum page can contain several older release posts. Ranking
    those first lets a trusted older upload outrank a newer update, which makes
    the home feed look stale. phpBB post IDs increase monotonically, so retain
    the highest ID before applying the display ranking across different games.
    """
    newest: dict[tuple[str, bool], dict] = {}
    for post in posts:
        key = (
            str(post.get("csrinReleaseKey") or post.get("originalId") or ""),
            bool(post.get("csrinOnlineFix")),
        )
        previous = newest.get(key)
        if previous is None:
            newest[key] = post
            continue
        try:
            post_id = int(post.get("csrinPostId") or 0)
            previous_id = int(previous.get("csrinPostId") or 0)
        except (TypeError, ValueError):
            post_id = previous_id = 0
        if post_id > previous_id:
            newest[key] = post
    return _rank(list(newest.values()))


async def fetch_csrin_search(search_query: str) -> list[dict]:
    timeout = httpx.Timeout(SITE_FETCH_TIMEOUT_MS / 1000)
    async with httpx.AsyncClient(timeout=timeout) as client:
        if not await _ensure_session(client):
            return []

        from urllib.parse import urlencode
        params = urlencode({
            "keywords": search_query, "terms": "all", "sf": "titleonly",
            "sk": "t", "sd": "d", "sr": "topics", "st": "0", "fid[]": "22",
        })
        url = f"{CSRIN_BASE}/search.php?{params}"

        resp = await _authenticated_fetch(client, url, headers={"Referer": f"{CSRIN_BASE}/index.php"})
        if not resp or not resp.is_success:
            print(f"cs.rin.ru search returned {resp.status_code if resp else 'no response'}")
            return []
        html = resp.text

        threads = parse_search_results(html)[:CSRIN_POST_SCAN_LIMIT]
        for thread in threads:
            thread["forumId"] = "22"
        posts = await _scan_threads(client, threads)
        author_posts = await _fetch_csf_author_posts(client, search_query)
        posts.extend(author_posts)
        deduped = _dedupe_recent_posts(posts)
        print(
            f"cs.rin.ru search: scanned {len(threads)} Forum 22 thread(s), "
            f"{len(author_posts)} author candidate(s), {len(deduped)} result(s)"
        )
        return deduped


async def _fetch_csrin_recent_uncached(force: bool = False) -> list[dict]:
    """Recent uploads from the Game Releases subforum for the home feed.

    Fetches the first page of viewforum.php, skips the pinned announcements /
    stickies (everything above the "Topics" header), then scans the newest
    threads for link-bearing posts exactly like search — so the home grid shows
    the same actionable, trusted-ranked csrin cards. Cached for the TTL; on any
    failure the last good results are served rather than emptying the feed.
    `force` bypasses the cache (the home page's Refresh button re-scans).
    """
    if not force and _recent_cache.timestamp and (_now_ms() - _recent_cache.timestamp) < CSRIN_RECENT_TTL_MS:
        return _recent_cache.results

    timeout = httpx.Timeout(SITE_FETCH_TIMEOUT_MS / 1000)
    async with httpx.AsyncClient(timeout=timeout) as client:
        if not await _ensure_session(client):
            return _recent_cache.results

        url = f"{CSRIN_BASE}/viewforum.php?f={CSRIN_RECENT_FORUM_ID}"
        resp = await _authenticated_fetch(client, url, headers={"Referer": f"{CSRIN_BASE}/index.php"})
        if not resp or not resp.is_success:
            print(f"cs.rin.ru viewforum returned {resp.status_code if resp else 'no response'}")
            return _recent_cache.results
        html = resp.text

        # Announcements + stickies are grouped above the regular `Topics`
        # header. Start after that header so the feed follows the actual live
        # topic ordering visible in viewforum.php?f=10.
        header = re.search(r'<b\b[^>]*>\s*Topics\s*</b>', html, re.I)
        body = html[header.end():] if header else html
        threads = parse_search_results(body)[:CSRIN_RECENT_SCAN_LIMIT]
        # Some phpBB listing links omit `f`, particularly in Forum 22. The
        # scanner must retain the source forum so it fetches the container
        # opener and pairs it with Upload-Crew's metadata reply.
        for thread in threads:
            thread["forumId"] = CSRIN_RECENT_FORUM_ID
        posts = await _scan_threads(client, threads, CSRIN_RECENT_POSTS_PER_THREAD)
        author_posts = await _fetch_csf_author_posts(client)
        posts.extend(author_posts)

        deduped = _dedupe_recent_posts(posts)

        print(
            f"cs.rin.ru recent: scanned {len(threads)} thread(s), "
            f"{len(posts) - len(author_posts)} Forum {CSRIN_RECENT_FORUM_ID} candidate(s), "
            f"{len(author_posts)} allowlisted-author candidate(s), "
            f"{len(deduped)} game(s) after dedupe"
        )
        if deduped:
            _recent_cache.results = deduped
            _recent_cache.timestamp = _now_ms()
        return deduped


async def fetch_csrin_recent(force: bool = False) -> list[dict]:
    """Serve the existing feed while a single rate-limited refresh is running."""
    if _recent_refresh_lock.locked():
        return _recent_cache.results
    async with _recent_refresh_lock:
        return await _fetch_csrin_recent_uncached(force)
