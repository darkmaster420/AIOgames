"""WordPress post transform + download-link extraction.

Port of transformPostForV2 / extractDownloadLinksForV2 and their helpers from
src/lib/gameapi/helpers.js, scoped to the Skidrow path (the only WordPress site
in M2). Other site branches (steamrip, gamedrive, fitgirl, …) are intentionally
not ported yet; extract_download_links returns [] for them.
"""

from __future__ import annotations

import re
from typing import Any

import httpx

from .skidrow import fetch_skidrow

# ── Text / entity helpers ────────────────────────────────────────────────────
def strip_html(html: Any) -> str:
    if isinstance(html, dict):
        html = html.get("rendered") or ""
    if not isinstance(html, str):
        return ""
    return re.sub(r"<[^>]*>?", "", html)


def _decode_pass(s: str) -> str:
    s = s.replace("&amp;", "&")
    s = re.sub(r"&#(\d+);", lambda m: chr(int(m.group(1))) if int(m.group(1)) <= 0x10FFFF else m.group(0), s)
    s = re.sub(r"&#x([0-9a-fA-F]+);", lambda m: chr(int(m.group(1), 16)) if int(m.group(1), 16) <= 0x10FFFF else m.group(0), s)
    return (s.replace("&quot;", '"').replace("&apos;", "'")
            .replace("&lt;", "<").replace("&gt;", ">").replace("&nbsp;", " "))


def decode_basic_html_entities(text: str = "") -> str:
    if not text:
        return text
    prev = text
    for _ in range(3):
        nxt = _decode_pass(prev)
        if nxt == prev:
            break
        prev = nxt
    return prev


# ── Link classification ──────────────────────────────────────────────────────
_SERVICE_MAP = [
    ("torrent.cybar.xyz", "CybarTorrent"), ("freegogpcgames.com", "FreeGOG"),
    ("gdl.freegogpcgames.xyz", "FreeGOG"), ("mediafire", "Mediafire"),
    ("megadb", "MegaDB"), ("mega", "MEGA"), ("1fichier", "1Fichier"),
    ("rapidgator", "Rapidgator"), ("uploaded", "Uploaded"), ("turbobit", "Turbobit"),
    ("nitroflare", "Nitroflare"), ("katfile", "Katfile"), ("pixeldrain", "Pixeldrain"),
    ("gofile", "Gofile"), ("mixdrop", "Mixdrop"), ("krakenfiles", "KrakenFiles"),
    ("filefactory", "FileFactory"), ("dailyuploads", "DailyUploads"), ("multiup", "MultiUp"),
    ("zippyshare", "Zippyshare"), ("drive.google", "Google Drive"), ("dropbox", "Dropbox"),
    ("onedrive", "OneDrive"), ("buzzheavier", "BuzzHeavier"), ("datanodes", "DataNodes"),
    ("datavaults", "DataVaults"), ("vikingfile", "VikingFile"), ("akirabox", "AkiraBox"),
    ("filecrypt", "FileCrypt"), ("hitfile", "HitFile"), ("ufile", "UFile"),
    ("clicknupload", "ClicknUpload"), ("dayuploads", "DayUploads"), ("dlupload", "DLUpload"),
    ("file-upload", "File-Upload"), ("filespayouts", "FilesPayouts"), ("swiftuploads", "SwiftUploads"),
    ("linkmix", "LinkMix"), ("file-me", "FileMe"),
]


def extract_service_name(url: str) -> str:
    test = ("https:" + url) if url.startswith("//") else url
    try:
        host = (httpx.URL(test).host or "").lower()
    except Exception:
        return "Unknown"
    if host.endswith((".up-4ever.net", "up4ever")) or "up-4ever" in host or "up4ever" in host:
        return "Up-4ever"
    if "pasteform" in host or "paste-form" in host:
        return "PasteForm"
    if "loot-link" in host or "lootdest" in host or "loot-links" in host:
        return "LootLink"
    for needle, name in _SERVICE_MAP:
        if needle in host:
            return name
    if "torrent" in host:
        return "Torrent"
    return host or "Unknown"


def classify_torrent_link(url: str) -> dict | None:
    if url.startswith("magnet:"):
        return {"type": "magnet", "service": "Magnet Link", "url": url, "isTorrent": True}
    low = url.lower()
    if low.endswith(".torrent") or "/torrent/" in low or "torrent." in low:
        return {"type": "torrent-file", "service": extract_service_name(url), "url": url, "isTorrent": True}
    return None


_VALID_DOWNLOAD_DOMAINS = [
    "mega.nz", "mediafire.com", "1fichier.com", "rapidgator.net", "uploaded.net",
    "turbobit.net", "nitroflare.com", "katfile.com", "pixeldrain.com", "gofile.io",
    "mixdrop.to", "krakenfiles.com", "filefactory.com", "dailyuploads.net", "multiup.io",
    "drive.google.com", "dropbox.com", "onedrive.live.com", "hitfile.net", "ufile.io",
    "clicknupload.site", "clicknupload.click", "1337x.to", "uploadhaven.com",
    "datanodes.to", "datavaults.co", "vikingfile.com", "akirabox.com",
    "buzzheavier.com", "filecrypt.co", "filecrypt.cc", "up-4ever.net", "dayuploads.com",
    "dlupload.com", "file-upload.org", "filespayouts.com", "swiftuploads.com",
    "linkmix.co", "pasteform.com", "paste-form.com", "file-me.top", "loot-link.com",
    "lootdest.org", "workupload.com", "send.cm", "send.now", "megadb.net", "qiwi.gg",
    "upload.ee", "uploadnow.io", "fuckingfast.net",
]


def is_valid_download_url(url: str) -> bool:
    try:
        host = (httpx.URL(url).host or "").lower()
    except Exception:
        return False
    return any(d in host for d in _VALID_DOWNLOAD_DOMAINS)


# ── Image / description helpers ──────────────────────────────────────────────
_INVALID_IMAGE_PATTERNS = [
    re.compile(r"wordpress\.com/s2/images/smile/"),
    re.compile(r"gravatar\.com"),
    re.compile(r"s\.w\.org/images/core/emoji/"),
    re.compile(r"tracking", re.I),
    re.compile(r"beacon", re.I),
    re.compile(r"pixel", re.I),
]


def is_valid_image_url(url: str | None) -> bool:
    if not url or not isinstance(url, str):
        return False
    if any(p.search(url) for p in _INVALID_IMAGE_PATTERNS):
        return False
    try:
        path = (httpx.URL(url).path or "").lower()
    except Exception:
        return False
    if re.search(r"\.(jpg|jpeg|png|gif|webp|svg|bmp|ico|avif)(\?.*)?$", path, re.I):
        return True
    return any(k in path for k in ("image", "photo", "picture", "upload", "wp-content", "media"))


def extract_image_from_content(content: str | None) -> str | None:
    if not content:
        return None
    for m in re.finditer(r'<img[^>]+(?:src|data-src|data-lazy-src)=["\']([^"\']+)["\']', content, re.I):
        img = decode_basic_html_entities(m.group(1) or "").strip()
        if is_valid_image_url(img):
            return img
    return None


def pick_first_valid_image(*candidates) -> str | None:
    for c in candidates:
        img = decode_basic_html_entities(c).strip() if isinstance(c, str) else ""
        if is_valid_image_url(img):
            return img
    return None


def extract_description(content: str | None) -> str:
    if not content:
        return ""
    stripped = strip_html(content)
    return stripped[:300] + "..." if len(stripped) > 300 else stripped


# ── Download-link extraction (Skidrow) ───────────────────────────────────────
_HREF_RE = re.compile(r'<a[^>]+href=["\']([^"\']+)["\']', re.I)


async def extract_download_links(post_url: str, site_type: str = "skidrow", wp_content: str | None = None) -> list[dict]:
    if site_type not in ("skidrow", "freegog"):
        return []  # other sites not ported in M2

    try:
        resp = await fetch_skidrow(post_url, is_page_request=True)
        html = resp.text if (resp and resp.ok) else (wp_content or "")
        if not html:
            return []

        links: list[dict] = []
        seen: set[str] = set()
        for m in _HREF_RE.finditer(html):
            url = m.group(1).strip()
            if url.startswith("//"):
                url = "https:" + url
            if url in seen:
                continue

            if is_valid_download_url(url):
                seen.add(url)
                links.append({"type": "hosting", "service": extract_service_name(url), "url": url, "text": extract_service_name(url)})

            if url.startswith("magnet:") or ".torrent" in url:
                if url.startswith("magnet:"):
                    url = url.replace("&#038;", "&").replace("&amp;", "&").replace("&#39;", "'").replace("&quot;", '"')
                if url not in seen:
                    torrent = classify_torrent_link(url)
                    if torrent:
                        seen.add(url)
                        links.append(torrent)
        return links
    except Exception as error:  # noqa: BLE001
        print(f"Error extracting download links from {post_url}: {error}")
        return []


def _wp(value: Any, *keys) -> Any:
    """Safe nested lookup for WordPress dict shapes."""
    cur = value
    for k in keys:
        if isinstance(cur, list):
            cur = cur[k] if isinstance(k, int) and 0 <= k < len(cur) else None
        elif isinstance(cur, dict):
            cur = cur.get(k)
        else:
            return None
    return cur


async def transform_post(post: dict, site_type: str, site_name: str, fetch_links: bool = False) -> dict:
    download_links = await extract_download_links(post.get("link"), site_type, _wp(post, "content", "rendered")) if fetch_links else []

    image = None
    if site_type in ("steamrip", "reloadedsteam", "steamunderground", "skidrow"):
        image = pick_first_valid_image(
            post.get("featured_image_src"),
            post.get("jetpack_featured_media_url"),
            _wp(post, "yoast_head_json", "og_image", 0, "url"),
            _wp(post, "_embedded", "wp:featuredmedia", 0, "source_url"),
            _wp(post, "_embedded", "wp:featuredmedia", 0, "media_details", "sizes", "large", "source_url"),
            _wp(post, "_embedded", "wp:featuredmedia", 0, "media_details", "sizes", "medium_large", "source_url"),
            _wp(post, "_embedded", "wp:featuredmedia", 0, "media_details", "sizes", "full", "source_url"),
        )
    if not image:
        image = extract_image_from_content(_wp(post, "content", "rendered")) or extract_image_from_content(_wp(post, "excerpt", "rendered"))

    return {
        "id": f"{site_type}_{post.get('id')}",
        "originalId": post.get("id"),
        "title": decode_basic_html_entities(_wp(post, "title", "rendered") or "No title"),
        "excerpt": strip_html(_wp(post, "excerpt", "rendered") or ""),
        "link": post.get("link"),
        "date": post.get("date"),
        "slug": post.get("slug"),
        "description": extract_description(_wp(post, "content", "rendered")),
        "categories": post.get("categories"),
        "tags": post.get("tags"),
        "downloadLinks": download_links,
        "source": site_name,
        "siteType": site_type,
        "image": image,
    }
