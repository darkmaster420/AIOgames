"""Port of src/lib/libraryMatching.ts buildLibraryMatchMap.

Maps each tracked game to a matching NAS library file, keyed on the normalised
title. Preserves the Node behaviour: candidate keys are steamName, originalTitle
and title (in that order); library rows are taken newest-first (mtime desc) so
the first row per normalised title wins; the first candidate key that resolves
is the match.
"""

from __future__ import annotations

from typing import Any

from .library_title import normalize_library_title
from .models import LibraryGame
from .serialization import to_jsonable


async def build_library_match_map(games: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    title_keys: set[str] = set()
    game_keys: dict[str, list[str]] = {}

    for game in games:
        game_id = str(game.get("_id") or "")
        if not game_id:
            continue

        keys: list[str] = []
        for source in (game.get("steamName"), game.get("originalTitle"), game.get("title")):
            key = normalize_library_title(str(source or ""))
            if key:
                keys.append(key)

        # Preserve order while de-duplicating.
        unique_keys = list(dict.fromkeys(keys))
        if not unique_keys:
            continue
        game_keys[game_id] = unique_keys
        title_keys.update(unique_keys)

    if not title_keys:
        return {}

    rows = (
        await LibraryGame.get_motor_collection()
        .find(
            {"isActive": True, "normalizedTitle": {"$in": list(title_keys)}},
            {
                "_id": 1,
                "title": 1,
                "fileName": 1,
                "relativePath": 1,
                "fileSizeBytes": 1,
                "updatedAt": 1,
                "normalizedTitle": 1,
            },
        )
        .sort("mtimeMs", -1)
        .to_list(length=None)
    )

    by_title: dict[str, dict[str, Any]] = {}
    for row in rows:
        nt = row.get("normalizedTitle")
        if nt and nt not in by_title:
            by_title[nt] = row

    matches: dict[str, dict[str, Any]] = {}
    for game_id, keys in game_keys.items():
        match = next((by_title[k] for k in keys if k in by_title), None)
        if not match:
            continue
        matches[game_id] = {
            "id": str(match.get("_id")),
            "title": match.get("title"),
            "fileName": match.get("fileName"),
            "relativePath": match.get("relativePath"),
            "fileSizeBytes": match.get("fileSizeBytes"),
            "updatedAt": to_jsonable(match.get("updatedAt")),
        }

    return matches
