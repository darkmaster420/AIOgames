r"""Port of cleanGameTitle from src/utils/steamApi.ts.

Strips piracy/release tags, editions, platforms, version/build noise, scene
groups and normalises the result so titles from different sources match. Order
of operations is preserved from the JS.

Python's re cannot compile the two variable-width lookbehinds the JS uses
(`(?<=\s|^)` mixes widths; `(?<=\d\s+)` is variable), so those are rewritten as
capture-and-restore substitutions with identical effect.
"""

from __future__ import annotations

import re

from .text_utils import decode_basic_html_entities as _decode

TRAILING_ROMAN_TO_ARABIC = {
    "i": "1", "ii": "2", "iii": "3", "iv": "4", "v": "5", "vi": "6", "vii": "7",
    "viii": "8", "ix": "9", "x": "10", "xi": "11", "xii": "12", "xiii": "13",
    "xiv": "14", "xv": "15",
}

_I = re.IGNORECASE


def _sub(pattern: str, repl: str, text: str, flags: int = _I) -> str:
    return re.sub(pattern, repl, text, flags=flags)


def clean_game_title(title: str) -> str:
    s = _decode(title or "").lower()

    s = _sub(r"^\d+[-–—]\s*", "", s, 0)

    # Scene groups / crack types
    s = _sub(r"\b(denuvoless|cracked|repack|fitgirl|dodi|empress|codex|skidrow|plaza|rune|tenoke|p2p)\b", "", s)
    s = _sub(r"\b(cpy|steampunks|ali213|3dm|reloaded|razor1911|prophet|hoodlum|fairlight)\b", "", s)
    s = _sub(r"\b(darksiders|masquerade|goldberg|ova\sgames|simplex|darkzer0)\b", "", s)
    s = _sub(r"\b(chronos|flt|unleashed|deviance|vitality|outlaws|tinyiso)\b", "", s)
    s = _sub(r"\b(hypervisor)\b", "", s)

    # Release format indicators
    s = _sub(r"\b(free download|full version|complete edition|full game)\b", "", s)
    s = _sub(r"\b(portable|standalone|multilanguage|multi\slang|english only)\b", "", s)
    s = _sub(r"\b(gog\sversion|steam\sversion|epic\sversion|origin\sversion)\b", "", s)
    s = _sub(r"\b(drm\sfree|no\sdrm|steam\srip|gog\srip)\b", "", s)

    # Edition suffixes
    s = _sub(r"\b(game of the year|goty)\s+edition\b", "", s)
    s = _sub(r"\b\w+\s+edition\b", "", s)

    # Platforms + download
    s = _sub(r"\b(pc|mac|linux|windows|macos|android|ios)\b", "", s)
    s = _sub(r"\bdownload\b", "", s)

    # DLC / content
    s = _sub(r"\b(all dlc|with dlc|dlc included|\+\s*all\s*dlc|\+\s*dlc|dlc pack)\b", "", s)
    s = _sub(r"\b(season pass|deluxe content|bonus content|soundtrack included)\b", "", s)
    s = _sub(r"\b(psn\s*bonus|playstation\s*bonus|steam\s*bonus|epic\s*bonus|gog\s*bonus)\b", "", s)
    s = _sub(r"\b(pre-?order\s*bonus|preorder\s*bonus|pre-?purchase\s*bonus)\b", "", s)
    s = _sub(r"\bdlcs?\b", "", s)
    s = _sub(r"\b(expansion pack|expansion|add-on content|add-on|addon|content pack|character pack)\b", "", s)

    # Install / format
    s = _sub(r"\b(pre-installed|preinstalled|pre\sinstalled)\b", "", s)
    s = _sub(r"\b(setup|installer|direct\splay|ready\sto\splay)\b", "", s)
    s = _sub(r"\b(compressed|highly compressed|small size)\b", "", s)
    s = _sub(r"\b(update \d+|hotfix|patch|day\s?\d+\s?patch)\b", "", s)

    # Quality / source
    s = _sub(r"\b(hd|4k|uhd|full\shd|1080p|720p|480p)\b", "", s)
    s = _sub(r"\b(bluray|blu\sray|dvd\srip|web\srip|cam\srip)\b", "", s)

    # Size / archive
    s = _sub(r"\b\d+(\.\d+)?\s?(gb|mb|tb)\b", "", s)
    s = _sub(r"\b(iso|rar|zip|7z|part\d+)\b", "", s)

    # Dev stage
    s = _sub(r"\b(early access|early-access)\b", "", s)
    s = _sub(r"\b(beta|alpha|preview|demo|prototype)\b", "", s)
    s = _sub(r"\b(early release|early version)\b", "", s)
    s = _sub(r"\b(closed beta|open beta|public beta)\b", "", s)
    s = _sub(r"\b(test build|test version|testing)\b", "", s)
    s = _sub(r"\b(pre-alpha|pre-beta|pre-release)\b", "", s)
    s = _sub(r"\b(developer build|dev build|internal)\b", "", s)
    s = _sub(r"\b(work in progress|wip)\b", "", s)
    s = _sub(r"\b(coming soon|unreleased)\b", "", s)
    s = _sub(r"\b(steam deck verified|deck verified)\b", "", s)

    # Version patterns
    s = _sub(r"v\d+(\.\d+){3,}(-[A-Z0-9]+)?", "", s)
    s = _sub(r"v\d+(?:\.\d+)*(?:\.[a-z]\d*|[a-z]\d*)?(?:-[A-Z0-9]+)?", "", s)
    s = _sub(r"\bversion\s*\d+(?:\.\d+)*(?:\.[a-z]\d*|[a-z]\d*)?", "", s)
    s = _sub(r"\bver\.?\s*\d+(?:\.\d+)*(?:\.[a-z]\d*|[a-z]\d*)?", "", s)
    s = _sub(r"\bbuild[-\s]*#?\d+", "", s)
    s = _sub(r"\bb\d{4,}", "", s)
    s = _sub(r"\bupdate\s*\d+(\.\d+)*", "", s)
    s = _sub(r"\brev\s*\d+", "", s)
    s = _sub(r"\brelease\s*\d+", "", s)
    s = _sub(r"\br\d+", "", s)
    s = _sub(r"\b20\d{2}[-\.]\d{1,2}[-\.]\d{1,2}", "", s)
    s = _sub(r"\b\d{8}", "", s)

    # Year tags
    s = _sub(r"\(20\d{2}\)", "", s, 0)
    s = _sub(r"\[20\d{2}\]", "", s, 0)

    # Bracketed / parenthetical
    s = _sub(r"\[[^\]]*\]", "", s, 0)
    s = _sub(r"\([^)]*\)", "", s, 0)

    # Plus content
    s = _sub(r"\s*\+\s*[^+]*$", "", s)
    s = _sub(r"\s*\+\s*", " ", s, 0)

    # Scene groups
    s = _sub(r"-[A-Z0-9]{3,}$", "", s)
    s = _sub(r"-[A-Z0-9]{3,}\s", " ", s)
    s = _sub(r"\b[A-Z0-9]{3,}-$", "", s)
    s = _sub(r"\[(CODEX|PLAZA|SKIDROW|EMPRESS|FITGIRL|DODI|RUNE|TENOKE|CPY|ALI213|3DM|RELOADED|RAZOR1911|PROPHET|HOODLUM|FAIRLIGHT|SIMPLEX|DARKZER0|CHRONOS|FLT|UNLEASHED|DEVIANCE|VITALITY|OUTLAWS|TINYISO)\]", "", s)
    s = _sub(r"\([A-Z0-9]{3,}\)", "", s)

    # Trademark
    s = _sub(r"[®™©]", "", s, 0)

    # Orphaned version letters/digits. The last two JS rules use variable-width
    # lookbehind; rewritten as capture-and-restore.
    s = _sub(r"\s+v?\d+(\.\d+)*[a-z]\d*(?=\s|$)", "", s)
    s = _sub(r"(^|\s)v[a-h]\d*(?=\s|$)", r"\1", s)          # was (?<=\s|^)v[a-h]\d*
    s = _sub(r"(\d\s+)[a-h]\d*(?=\s|$)", r"\1", s)          # was (?<=\d\s+)[a-h]\d*

    # Dragon Ball special case
    s = _sub(r"\b(dragon\s+ball\s+sparking)\s+0\b", r"\1 zero", s)

    # Number words -> digits
    for word, digit in (("one", "1"), ("two", "2"), ("three", "3"), ("four", "4"),
                         ("five", "5"), ("six", "6"), ("seven", "7"), ("eight", "8"), ("nine", "9")):
        s = _sub(rf"\b{word}\b", digit, s)

    # Common variations
    s = _sub(r"\band\b", "&", s)
    s = _sub(r"\bvs\.?\b", "vs", s)
    s = _sub(r"\bof the\b", "of", s)

    # Apostrophes/quotes and dashes
    s = _sub(r"[‘’′'\"`]", "", s, 0)
    s = _sub(r"[-:]", " ", s, 0)

    # Special chars + collapse
    s = _sub(r"[^\w\s&]", " ", s, 0)
    s = _sub(r"\s+", " ", s, 0).strip()

    # Trailing roman numeral -> arabic
    def _roman(m: re.Match) -> str:
        return TRAILING_ROMAN_TO_ARABIC.get(m.group(0).lower(), m.group(0))

    s = re.sub(r"\b(xv|xiv|xiii|xii|xi|x|ix|viii|vii|vi|v|iv|iii|ii|i)\b(?=\s*$)", _roman, s, flags=_I)
    return s
