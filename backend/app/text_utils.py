"""Dependency-free text helpers shared across scraping and title cleaning.

Kept import-light (stdlib only) so pure-logic modules like clean_title/versioning
can be used and tested without pulling in httpx.
"""

from __future__ import annotations

import re


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
