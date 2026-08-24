"""Release version detection + comparison.

Port of the pure functions in src/lib/updateVersioning.ts: extract_version_info,
compare_versions and their helpers. This is the engine that decides whether a
found release is newer than a tracked one. SteamDB enrichment
(enrichVersionInfoWithSteamDb) and the scraper-bound fetch are not here.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from datetime import datetime

from .clean_title import clean_game_title

_I = re.IGNORECASE


@dataclass
class VersionInfo:
    version: str = ""
    build: str = ""
    releaseType: str = ""
    updateType: str = ""
    baseTitle: str = ""
    fullVersionString: str = ""
    confidence: float = 0.0
    needsUserConfirmation: bool = False
    isDateVersion: bool = False
    versionDate: datetime | None = None
    hasRegularVersion: bool = False


_SUFFIX = r"(?:\.[a-z]\d*|[a-z]\d*)?(?:[-_]?(?:alpha|beta|rc|pre|preview|dev|final|release|hotfix|patch)(?:\d+)?)?"

_VERSION_PATTERNS = [re.compile(p, _I) for p in [
    rf"v(\d+\.\d+\.\d+\.\d+{_SUFFIX})",
    rf"v(\d{{4}}[-.]?\d{{2}}[-.]?\d{{2}}{_SUFFIX})",
    rf"v(\d{{2}}\.\d{{2}}\.\d{{2}}\b{_SUFFIX})",
    rf"v(\d{{8}}{_SUFFIX})",
    rf"v(\d+(?:\.\d+)+{_SUFFIX})",
    rf"version\s*(\d+(?:\.\d+)+{_SUFFIX})",
    rf"ver\.?\s*(\d+(?:\.\d+)+{_SUFFIX})",
    rf"(\d+\.\d+(?:\.\d+)*{_SUFFIX})",
    rf"\[(\d+\.\d+(?:\.\d+)*{_SUFFIX})\]",
    rf"\-(\d+\.\d+(?:\.\d+)*{_SUFFIX})\-",
    rf"update\s*(\d+(?:\.\d+)*{_SUFFIX})",
    rf"patch\s*(\d+(?:\.\d+)*{_SUFFIX})",
    rf"hotfix\s*(\d+(?:\.\d+)*{_SUFFIX})",
    rf"rev\s*(\d+(?:\.\d+)*{_SUFFIX})",
    rf"r(\d+(?:\.\d+)*{_SUFFIX})",
]]

_BUILD_PATTERNS = [re.compile(p, _I) for p in [
    r"build\s*#?(\d+)", r"b(\d{4,})", r"#(\d{4,})", r"rev\s*(\d+)", r"r(\d{3,})",
    r"release\s*(\d+)", r"\.(\d{8})\.", r"\-(\d{6,})\-", r"\[(\d{5,})\]",
]]

_RELEASE_TYPES = [
    "REPACK", "PROPER", "REAL PROPER", "UNCUT", "EXTENDED", "DIRECTORS CUT", "COMPLETE",
    "GOTY", "DEFINITIVE", "ENHANCED", "DELUXE", "ULTIMATE", "PREMIUM", "COLLECTORS",
    "SPECIAL EDITION", "LIMITED EDITION", "ANNIVERSARY", "CRACKED", "DENUVOLESS",
    "DRM FREE", "UNLOCKED", "ACTIVATED", "FULL UNLOCKED", "ALL DLC", "COMPLETE PACK",
    "SEASON PASS", "GOLD EDITION", "GAME OF THE YEAR", "MULTI LANG", "ENGLISH",
    "MULTILANGUAGE", "RUS ENG", "MULTI13", "MULTI12", "STEAM RIP", "GOG RIP", "EPIC RIP",
    "ORIGIN RIP", "PORTABLE", "STANDALONE", "PREINSTALLED", "PRE INSTALLED", "READY TO PLAY",
]
_UPDATE_TYPES = [
    "UPDATE", "HOTFIX", "PATCH", "DLC", "EXPANSION", "BUGFIX", "CRITICAL UPDATE",
    "SECURITY UPDATE", "CONTENT UPDATE", "DAY ONE PATCH", "POST LAUNCH", "ANNIVERSARY UPDATE",
]
_SCENE_GROUPS = [
    "CODEX", "PLAZA", "SKIDROW", "EMPRESS", "FITGIRL", "DODI", "RUNE", "TENOKE", "CPY",
    "ALI213", "3DM", "RELOADED", "RAZOR1911", "PROPHET", "HOODLUM", "FAIRLIGHT", "SIMPLEX",
    "DARKZER0", "CHRONOS", "FLT", "UNLEASHED", "DEVIANCE", "VITALITY", "OUTLAWS", "TINYISO",
    "STEAMPUNKS", "DARKSIDERS", "MASQUERADE", "GOLDBERG", "OVA GAMES",
]
_PIRACY_INDICATORS = ["cracked", "repack", "denuvoless", "drm free", "pre installed"]


def extract_version_info(title: str) -> VersionInfo:
    original = title
    clean = clean_game_title(title)

    version = ""
    build = ""
    release_type = ""
    update_type = ""
    confidence = 1.0

    upper = original.upper()
    if any(g in upper for g in _SCENE_GROUPS):
        confidence *= 0.95

    for pat in _VERSION_PATTERNS:
        m = pat.search(original)
        if m:
            version = m.group(1)
            confidence *= 0.9
            break
    if not version:
        for pat in _VERSION_PATTERNS:
            m = pat.search(clean)
            if m:
                version = m.group(1)
                confidence *= 0.8
                break

    for pat in _BUILD_PATTERNS:
        m = pat.search(original)
        if m:
            build = m.group(1)
            confidence *= 0.85
            break

    for t in _RELEASE_TYPES:
        if t in clean:
            release_type = t
            confidence *= 0.95
            break
    for t in _UPDATE_TYPES:
        if t in clean:
            update_type = t
            confidence *= 0.9
            break

    if any(ind in original.lower() for ind in _PIRACY_INDICATORS):
        confidence *= 0.9
    if version and build:
        confidence *= 1.1
    elif version or build:
        confidence *= 1.05

    is_date_version = bool(re.search(r"v?\d{4}[-.]?\d{2}[-.]?\d{2}|v?\d{8}", version))
    version_date: datetime | None = None
    has_regular = False

    if is_date_version and version:
        dm = re.search(r"(\d{4})[-.]?(\d{2})[-.]?(\d{2})", version)
        if dm:
            try:
                version_date = datetime(int(dm.group(1)), int(dm.group(2)), int(dm.group(3)))
            except ValueError:
                version_date = None
    elif version:
        ddmm = re.match(r"^(\d{2})\.(\d{2})\.(\d{2})$", version)
        if ddmm:
            day, month = int(ddmm.group(1)), int(ddmm.group(2))
            if 1 <= day <= 31 and 1 <= month <= 12:
                year = int(ddmm.group(3))
                year += 2000 if year < 50 else 1900
                try:
                    version_date = datetime(year, month, day)
                except ValueError:
                    version_date = None
                has_regular = False
            else:
                has_regular = True
        elif re.match(r"^\d+\.\d+", version):
            has_regular = True

    return VersionInfo(
        version=version,
        build=build,
        releaseType=release_type,
        updateType=update_type,
        baseTitle=clean,
        fullVersionString=f"{version}{f' Build {build}' if build else ''}{f' {release_type}' if release_type else ''}",
        confidence=min(confidence, 1.0),
        needsUserConfirmation=confidence < 0.7,
        isDateVersion=is_date_version or version_date is not None,
        versionDate=version_date,
        hasRegularVersion=has_regular,
    )


def detect_suspicious_version(old: str, new: str) -> dict:
    old_parts = [p for p in old.split(".") if p]
    new_parts = [p for p in new.split(".") if p]
    if len(new_parts) > len(old_parts) + 1:
        return {"isSuspicious": True, "reason": f"Version structure changed significantly ({len(old_parts)} parts -> {len(new_parts)} parts)"}

    def has_zero_padding(v: str) -> bool:
        return any(p.startswith("0") and len(p) > 1 for p in v.split("."))

    if has_zero_padding(old) != has_zero_padding(new):
        return {"isSuspicious": True, "reason": f"Version format inconsistency (padding changed: {old} -> {new})"}

    def to_int(x: str):
        try:
            return int(x)
        except ValueError:
            return None

    old_ft = [to_int(p) for p in old_parts[:2]]
    new_ft = [to_int(p) for p in new_parts[:2]]
    if old_ft and new_ft and old_ft[0] is not None and new_ft[0] is not None:
        if new_ft[0] - old_ft[0] > 2:
            return {"isSuspicious": True, "reason": f"Large major version jump ({old_ft[0]} -> {new_ft[0]})"}
    if (len(old_ft) > 1 and len(new_ft) > 1 and None not in old_ft[:2] and None not in new_ft[:2]
            and old_ft[0] == new_ft[0] and new_ft[1] - old_ft[1] > 20):
        return {"isSuspicious": True, "reason": f"Large minor version jump ({old} -> {new})"}
    return {"isSuspicious": False}


def _parse_parts(version: str) -> list[dict]:
    out = []
    for part in re.sub(r"^v\s*", "", str(version or "").strip(), flags=_I).split("."):
        if not part:
            continue
        normalized = part.lower().strip()
        m = re.match(r"^(\d+)(?:[-_]?([a-z][a-z0-9-]*))?$", normalized, _I)
        if m:
            out.append({"number": int(m.group(1)), "suffix": (m.group(2) or "").lower()})
            continue
        np = re.match(r"^(\d+)", normalized)
        if np:
            out.append({"number": int(np.group(1)), "suffix": re.sub(r"^[-_]+", "", normalized[len(np.group(1)):])})
        else:
            out.append({"number": 0, "suffix": normalized})
    return out


def _suffix_weight(suffix: str) -> int:
    n = (suffix or "").lower()
    if not n:
        return 100
    if n.startswith(("final", "release")):
        return 95
    if n.startswith("rc"):
        return 85
    if n.startswith("beta"):
        return 75
    if n.startswith(("alpha", "pre", "preview")):
        return 65
    m = re.match(r"^([a-z])(\d*)$", n)
    if m:
        return 101 + (ord(m.group(1)) - 97) * 1000 + int(m.group(2) or "0")
    return 70


def _compare_suffix(a: str, b: str) -> int:
    aw, bw = _suffix_weight(a), _suffix_weight(b)
    if aw != bw:
        return 1 if aw > bw else -1
    if a != b:
        return 1 if a > b else -1
    return 0


def compare_semantic_versions(a: str, b: str) -> int:
    ap, bp = _parse_parts(a), _parse_parts(b)
    for i in range(max(len(ap), len(bp))):
        x = ap[i] if i < len(ap) else {"number": 0, "suffix": ""}
        y = bp[i] if i < len(bp) else {"number": 0, "suffix": ""}
        if x["number"] != y["number"]:
            return 1 if x["number"] > y["number"] else -1
        sc = _compare_suffix(x["suffix"], y["suffix"])
        if sc != 0:
            return sc
    return 0


def detect_version_scheme(info: VersionInfo) -> str:
    v = re.sub(r"^v\s*", "", str(info.version or "").strip(), flags=_I)
    if info.isDateVersion or re.match(r"^\d{8}$", v) or re.match(r"^\d{4}[-.]\d{2}[-.]\d{2}$", v):
        return "date"
    if re.match(r"^\d+\.\d+(?:\.\d+){0,2}(?:[-_.]?(?:[a-z][a-z0-9-]*))?$", v, _I):
        return "semver"
    if info.build and re.match(r"^\d+$", str(info.build).strip()):
        return "build"
    return "unknown"


def compare_versions(old: VersionInfo, new: VersionInfo) -> dict:
    result = {"isNewer": False, "changeType": "unknown", "significance": 0,
              "shouldWaitForRegular": False, "skipDueToHierarchy": False}

    old_versioned = bool(old.version and not old.isDateVersion)
    new_versioned = bool(new.version and not new.isDateVersion)
    old_proper = "PROPER" in (old.releaseType or "").upper()
    new_proper = "PROPER" in (new.releaseType or "").upper()

    if old_versioned and not new_versioned:
        return {**result, "changeType": "rejected_hierarchy", "skipDueToHierarchy": True}
    if old_proper and not old_versioned and not new_versioned and not new_proper:
        return {**result, "changeType": "rejected_hierarchy_proper", "skipDueToHierarchy": True}
    if not old_versioned and not old_proper and (new_proper or new_versioned):
        return {**result, "isNewer": True,
                "changeType": "upgrade_to_versioned" if new_versioned else "upgrade_to_proper",
                "significance": 10 if new_versioned else 7}
    if old_proper and not old_versioned and new_versioned:
        return {**result, "isNewer": True, "changeType": "proper_to_versioned", "significance": 10}

    if old.hasRegularVersion and new.isDateVersion and not new.hasRegularVersion and new.versionDate:
        days = (datetime.now() - new.versionDate).days
        if days < 2:
            return {**result, "changeType": "date_version_recent", "significance": 1, "shouldWaitForRegular": True}

    if old.isDateVersion and new.isDateVersion and old.versionDate and new.versionDate:
        if new.versionDate > old.versionDate:
            days = (new.versionDate - old.versionDate).days
            return {**result, "isNewer": True, "changeType": "date_update", "significance": min(5, max(1, days))}
        return result

    if old.isDateVersion and new.hasRegularVersion:
        return {**result, "changeType": "date_to_regular_needs_verification", "significance": 8}

    is_newer = False
    change_type = "unknown"
    significance = 0

    if old.version and new.version and not old.isDateVersion and not new.isDateVersion:
        op, npp = _parse_parts(old.version), _parse_parts(new.version)
        for i in range(max(len(op), len(npp))):
            o = op[i] if i < len(op) else {"number": 0, "suffix": ""}
            n = npp[i] if i < len(npp) else {"number": 0, "suffix": ""}
            if n["number"] > o["number"]:
                is_newer = True
                change_type, significance = (
                    ("major", 10) if i == 0 else ("minor", 5) if i == 1 else ("patch", 3) if i == 2 else ("build", 2))
                break
            if n["number"] == o["number"]:
                sc = _compare_suffix(n["suffix"], o["suffix"])
                if sc > 0:
                    is_newer = True
                    change_type = "patch" if i >= 2 else ("minor" if i == 1 else "major")
                    significance = 10 if i == 0 else 5 if i == 1 else 3
                    break
                if sc < 0:
                    break
            else:
                break

    if old.build and new.build:
        try:
            ob, nb = int(old.build), int(new.build)
            if nb > ob and (not is_newer or (nb - ob) > 100):
                is_newer = True
                change_type = "build"
                significance = min(10, max(2, int(math.log10(nb - ob)) if nb - ob > 0 else 2))
        except ValueError:
            pass

    suspicious = None
    if is_newer and old.version and new.version and not old.isDateVersion and not new.isDateVersion:
        suspicious = detect_suspicious_version(old.version, new.version)

    out = {**result, "isNewer": is_newer, "changeType": change_type, "significance": significance}
    if suspicious is not None:
        out["suspiciousVersion"] = suspicious
    return out
