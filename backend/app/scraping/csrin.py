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
import re
import time
from datetime import datetime, timezone

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
CSRIN_POST_SCAN_LIMIT = 12
CSRIN_POST_SCAN_CONCURRENCY = 3
# Game Releases subforum; scanned for the home-page "recent uploads" feed.
CSRIN_RECENT_FORUM_ID = os.environ.get("CSRIN_RECENT_FORUM_ID", "10")
CSRIN_RECENT_TTL_MS = 15 * 60 * 1000


# ── Trusted / untrusted uploaders ──────────────────────────────────────────
def _seed(env_var: str) -> set[str]:
    return {n.strip().lower() for n in (os.environ.get(env_var) or "").split(",") if n.strip()}


_reliable: set[str] = _seed("CSRIN_RELIABLE_POSTERS")
_untrusted: set[str] = _seed("CSRIN_UNTRUSTED_POSTERS")


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


# ── Session state ───────────────────────────────────────────────────────────
class _Session:
    cookies: str = ""       # "name=value; name=value" Cookie header
    logged_in_at: float = 0
    login_failed_at: float = 0


_session = _Session()
_login_lock = asyncio.Lock()


# Recent feed cache: the home page hits this on every load, so the scan (a
# forum page fetch + per-thread scans) is cached and reused for its TTL. Serves
# stale on failure rather than emptying the feed.
class _RecentCache:
    results: list[dict] = []
    timestamp: float = 0


_recent_cache = _RecentCache()


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


# ── Login ────────────────────────────────────────────────────────────────────
async def _perform_login(client: httpx.AsyncClient) -> bool:
    username = os.environ.get("CSRIN_USERNAME")
    password = os.environ.get("CSRIN_PASSWORD")
    if not username or not password:
        return False

    try:
        form = await _csrin_fetch(client, f"{CSRIN_BASE}/ucp.php?mode=login")
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

        user_id = re.search(r"phpbb3\w*_u=(\d+)", _session.cookies, re.I)
        is_anonymous = not user_id or user_id.group(1) == "1"
        is_redirect = 300 <= login.status_code < 400

        if is_anonymous and not is_redirect:
            print(f"cs.rin.ru login appears rejected (status {login.status_code}, user id {user_id.group(1) if user_id else 'none'})")
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


def _extract_download_links(post_html: str) -> list[dict]:
    """Real download links only, scoped to the post body.

    Uses the same classifier as the WordPress sites: recognised file hosts and
    magnet/.torrent links count; forum links, changelogs, sha256 pages, store
    pages, screenshots and rutracker threads do not. This is what drops the
    linkless showcase/[Info] posts (their only links are Steam/YouTube/etc) and
    ignores the non-download noise in busy posts like the Factorio one.
    """
    content = _get_post_content(post_html)
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


# CSF = "Clean Steam Files": the clean, desirable uploads. Any mention (and its
# variations) boosts the post in ranking.
_CSF_RE = re.compile(r"\bcsfs?\b|clean\s+steam\s+files?|clean\s+files?|clean\s+steam\b", re.I)


_RELEASE_LABEL_PATTERNS = [
    re.compile(r"\b(?:version|ver\.?|v)\s*[:#-]?\s*(\d+(?:[._-]\d+){1,5}(?:[a-z]\d*)?\b)", re.I),
    re.compile(r"\b(?:build|buildid)\s*[:#-]?\s*(\d{4,})\b", re.I),
    re.compile(r"\b(\d{4}[._-]\d{2}[._-]\d{2})\b"),
]


def _extract_release_label(text: str) -> str:
    for pat in _RELEASE_LABEL_PATTERNS:
        m = pat.search(text)
        if m:
            return re.sub(r"\s+", " ", m.group(0)).strip()
    return ""


def _extract_author(post_html: str) -> str:
    # rinDark uses <b class="postauthor">Name</b> (sometimes an <a>); phpBB3 uses
    # a username/username-coloured anchor. Match the class on any element.
    m = re.search(
        r'class="[^"]*\b(?:postauthor|username(?:-coloured)?)\b[^"]*"[^>]*>([^<]+)<',
        post_html, re.I,
    )
    return decode_entities(m.group(1)).strip() if m else ""


def parse_linked_posts(html: str, thread: dict) -> list[dict]:
    results = []
    seen: set[str] = set()
    for block in _get_post_blocks(html):
        links = _extract_download_links(block["html"])
        if not links:
            continue  # only surface posts with at least one real download link
        text = _strip_csrin_html(block["html"])
        label = _extract_release_label(text)
        author = _extract_author(block["html"])
        reliable = _is_reliable(author)
        untrusted = _is_untrusted(author)
        csf = bool(_CSF_RE.search(text))
        post_link = f"{thread['link']}#p{block['postId']}"
        if post_link in seen:
            continue
        seen.add(post_link)

        post = _build_csrin_post(
            thread["threadId"],
            f"{thread['title']} - {label}" if label else thread["title"],
            post_link,
        )
        post.update({
            "downloadLinks": links,
            "excerpt": text[:360],
            "id": f"csrin-{thread['threadId']}-{block['postId']}",
            "description": (
                f"{len(links)} download link{'' if len(links) == 1 else 's'}"
                + (f" by {author}" if author else "")
                + (" (trusted uploader)" if reliable else "")
                + (" (untrusted uploader)" if untrusted else "")
                + (" (CSF)" if csf else "")
                + (f" ({label})" if label else "")
            ),
            "csrinPostId": block["postId"],
            "csrinLinkCount": len(links),
            "csrinHasReleaseMetadata": bool(label),
            "csrinAuthor": author,
            "csrinReliablePoster": reliable,
            "csrinUntrustedPoster": untrusted,
            "csrinCsf": csf,
        })
        results.append(post)
    return results


def parse_search_results(html: str) -> list[dict]:
    last_start: dict[str, int] = {}
    last_forum: dict[str, str] = {}
    for m in re.finditer(r'href="([^"]*viewtopic\.php\?[^"]*start=\d+[^"]*)"', html, re.I):
        href = decode_entities(m.group(1))
        t = re.search(r"[?&]t=(\d+)", href)
        s = re.search(r"[?&]start=(\d+)", href)
        f = re.search(r"[?&]f=(\d+)", href)
        if not t or not s:
            continue
        tid, sval = t.group(1), int(s.group(1))
        if tid not in last_start or sval > last_start[tid]:
            last_start[tid] = sval
            if f:
                last_forum[tid] = f.group(1)

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
            title = re.sub(r"\s+", " ", decode_entities(re.sub(r"<[^>]+>", "", cleaned))).strip()
            if not title:
                continue

            f = last_forum.get(thread_id) or (re.search(r"[?&]f=(\d+)", href).group(1) if re.search(r"[?&]f=(\d+)", href) else "")
            params = []
            if f:
                params.append(f"f={f}")
            params.append(f"t={thread_id}")
            start = last_start.get(thread_id)
            if start is not None:
                params.append(f"start={start}")
            link = f"{CSRIN_BASE}/viewtopic.php?{'&'.join(params)}"
            post = _build_csrin_post(thread_id, title, link)
            post.update({"threadId": thread_id, "forumId": f or "", "start": start or 0})
            results.append(post)
    return results


# ── Thread scan + search ─────────────────────────────────────────────────────
async def _fetch_thread_linked_posts(client: httpx.AsyncClient, thread: dict) -> list[dict]:
    resp = await _csrin_fetch(client, thread["link"], headers={"Referer": f"{CSRIN_BASE}/search.php"})
    if not resp or not resp.is_success:
        print(f"cs.rin.ru thread {thread['threadId']} returned {resp.status_code if resp else 'no response'}")
        return []
    html = resp.text
    if _looks_like_login_page(html):
        _session.cookies = ""
        _session.logged_in_at = 0
        if not await _ensure_session(client):
            return []
        resp = await _csrin_fetch(client, thread["link"], headers={"Referer": f"{CSRIN_BASE}/search.php"})
        if not resp or not resp.is_success:
            return []
        html = resp.text
        if _looks_like_login_page(html):
            return []
    return parse_linked_posts(html, thread)


async def _scan_threads(client: httpx.AsyncClient, threads: list[dict]) -> list[dict]:
    """Scan each thread's latest page for link-bearing posts, concurrently but
    bounded, then rank the flattened result. Shared by search and recent."""
    if not threads:
        return []
    sem = asyncio.Semaphore(CSRIN_POST_SCAN_CONCURRENCY)

    async def scan(thread: dict) -> list[dict]:
        async with sem:
            try:
                return await _fetch_thread_linked_posts(client, thread)
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


async def fetch_csrin_search(search_query: str) -> list[dict]:
    timeout = httpx.Timeout(SITE_FETCH_TIMEOUT_MS / 1000)
    async with httpx.AsyncClient(timeout=timeout) as client:
        if not await _ensure_session(client):
            return []

        from urllib.parse import urlencode
        params = urlencode({
            "keywords": search_query, "terms": "all", "author": "", "sc": "1",
            "sf": "titleonly", "sk": "t", "sd": "d", "sr": "topics", "st": "0",
            "ch": "300", "t": "0", "submit": "Search",
        })
        url = f"{CSRIN_BASE}/search.php?{params}"

        resp = await _csrin_fetch(client, url, headers={"Referer": f"{CSRIN_BASE}/index.php"})
        if not resp or not resp.is_success:
            print(f"cs.rin.ru search returned {resp.status_code if resp else 'no response'}")
            return []
        html = resp.text
        if _looks_like_login_page(html):
            _session.cookies = ""
            _session.logged_in_at = 0
            if not await _ensure_session(client):
                return []
            resp = await _csrin_fetch(client, url, headers={"Referer": f"{CSRIN_BASE}/index.php"})
            if not resp or not resp.is_success:
                return []
            html = resp.text
            if _looks_like_login_page(html):
                return []

        threads = parse_search_results(html)[:CSRIN_POST_SCAN_LIMIT]
        posts = await _scan_threads(client, threads)
        print(f"cs.rin.ru scanned {len(threads)} thread(s), found {len(posts)} linked post(s)")
        return posts


async def fetch_csrin_recent() -> list[dict]:
    """Recent uploads from the Game Releases subforum for the home feed.

    Fetches the first page of viewforum.php, skips the pinned announcements /
    stickies (everything above the "Topics" header), then scans the newest
    threads for link-bearing posts exactly like search — so the home grid shows
    the same actionable, trusted-ranked csrin cards. Cached for the TTL; on any
    failure the last good results are served rather than emptying the feed.
    """
    if _recent_cache.timestamp and (_now_ms() - _recent_cache.timestamp) < CSRIN_RECENT_TTL_MS:
        return _recent_cache.results

    timeout = httpx.Timeout(SITE_FETCH_TIMEOUT_MS / 1000)
    async with httpx.AsyncClient(timeout=timeout) as client:
        if not await _ensure_session(client):
            return _recent_cache.results

        url = f"{CSRIN_BASE}/viewforum.php?f={CSRIN_RECENT_FORUM_ID}"
        resp = await _csrin_fetch(client, url, headers={"Referer": f"{CSRIN_BASE}/index.php"})
        if not resp or not resp.is_success:
            print(f"cs.rin.ru viewforum returned {resp.status_code if resp else 'no response'}")
            return _recent_cache.results
        html = resp.text
        if _looks_like_login_page(html):
            _session.cookies = ""
            _session.logged_in_at = 0
            if not await _ensure_session(client):
                return _recent_cache.results
            resp = await _csrin_fetch(client, url, headers={"Referer": f"{CSRIN_BASE}/index.php"})
            if not resp or not resp.is_success:
                return _recent_cache.results
            html = resp.text
            if _looks_like_login_page(html):
                return _recent_cache.results

        # Announcements + stickies (rules, privacy policy, etc.) are grouped
        # above the real topic list under a "Topics" header — slice from there so
        # pinned meta-threads aren't returned as releases.
        header = re.search(r">\s*Topics\s*</b>", html, re.I)
        body = html[header.start():] if header else html
        threads = parse_search_results(body)[:CSRIN_POST_SCAN_LIMIT]
        posts = await _scan_threads(client, threads)
        print(f"cs.rin.ru recent: scanned {len(threads)} thread(s), found {len(posts)} linked post(s)")
        if posts:
            _recent_cache.results = posts
            _recent_cache.timestamp = _now_ms()
        return posts
