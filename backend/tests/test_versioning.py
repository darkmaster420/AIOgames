"""Regression test for the version engine (app/versioning.py + app/clean_title.py).

Pure-logic, stdlib only. Run from backend/:  python -m tests.test_versioning
Mirrors the Node test-version-detection.js so both implementations stay aligned.
"""

import sys

from app.versioning import extract_version_info as ev, compare_versions as cmp
from app.clean_title import clean_game_title as ct

_failures = 0


def check(label, actual, expected):
    global _failures
    ok = actual == expected
    if not ok:
        _failures += 1
    print(f"{'PASS' if ok else 'FAIL'}  {label}" + ("" if ok else f"  (expected {expected!r}, got {actual!r})"))


def main() -> int:
    print("--- version / build extraction ---")
    for title, version, build in [
        ("Cyberpunk 2077 v2.1.2", "2.1.2", ""),
        ("Elden Ring v1.12.3 Build 19029387", "1.12.3", "19029387"),
        ("Schedule I v0.4.6f12", "0.4.6f12", ""),
        ("Baldurs Gate 3 v4.1.1.4667800-GOG", "4.1.1.4667800", ""),
        ("God of War Ragnarok Build 15736875-RUNE", "", "15736875"),
        ("Stardew Valley 1.6.15 FitGirl Repack", "1.6.15", ""),
    ]:
        info = ev(title)
        check(f"extract {title!r} version", info.version, version)
        check(f"extract {title!r} build", info.build, build)

    print("--- date-version detection ---")
    for title, is_date in [("Dead Cells v20260616-P2P", True), ("Winter Burrow v1.2.1", False)]:
        check(f"isDateVersion {title!r}", ev(title).isDateVersion, is_date)

    print("--- ordering ---")
    c = lambda a, b: cmp(ev(a), ev(b))
    check("v1.2.1 -> v1.2.2 newer", c("Game v1.2.1", "Game v1.2.2")["isNewer"], True)
    check("v1.2.2 -> v1.2.1 not newer", c("Game v1.2.2", "Game v1.2.1")["isNewer"], False)
    check("same not newer", c("Game v1.2.2", "Game v1.2.2")["isNewer"], False)
    check("build 100k -> 200k newer", c("Game Build 100000", "Game Build 200000")["isNewer"], True)
    check("v0.4.6 -> v0.4.6f12 newer (suffix patch)", c("Game v0.4.6", "Game v0.4.6f12")["isNewer"], True)

    print("--- release hierarchy ---")
    check("versioned -> unversioned rejected", c("Game v1.2.3", "Game REPACK")["changeType"], "rejected_hierarchy")

    print("--- clean_game_title ---")
    check("strips group/version", ct("Elden Ring v1.12.3 Build 19029387-RUNE"), "elden ring")

    print(f"\n{'All checks passed.' if _failures == 0 else str(_failures) + ' check(s) failed.'}")
    return 1 if _failures else 0


if __name__ == "__main__":
    sys.exit(main())
