"""GET /api/tracking — the user's tracked games with library matches.

Port of the GET handler in src/app/api/tracking/route.ts. POST/DELETE stay on
the Next route for now; the middleware only proxies GET here (method-aware
allowlist), so adding/removing games is untouched until those are ported.
"""

from fastapi import APIRouter, Depends

from ..auth import CurrentUser, get_current_user
from ..models import TrackedGame
from ..owner import id_query_values
from ..library_matching import build_library_match_map
from ..serialization import to_jsonable

router = APIRouter()

# Same field set the Node route selected — kept in lockstep with the TrackedGame
# interface in src/app/tracking/page.tsx.
_PROJECTION = {
    field: 1
    for field in (
        "gameId", "title", "originalTitle", "cleanedTitle", "priority", "source",
        "image", "description", "gameLink", "lastKnownVersion", "steamAppId",
        "steamName", "steamVerified", "gogVerified", "gogProductId", "gogName",
        "gogVersion", "gogBuildId", "gogLastChecked", "buildNumberVerified",
        "currentBuildNumber", "buildNumberSource", "versionNumberVerified",
        "currentVersionNumber", "versionNumberSource", "lastVersionDate",
        "dateAdded", "lastChecked", "notificationsEnabled", "checkFrequency",
        "updateHistory", "latestApprovedUpdate", "hasNewUpdate", "newUpdateSeen",
        "isActive",
    )
}


@router.get("/api/tracking")
async def list_tracking(user: CurrentUser = Depends(get_current_user)) -> dict:
    # Scoped to the signed-in user, matching the public Next route
    # (src/app/api/tracking/route.ts GET: `userId: user.id`). The backend was
    # first written against the NAS build, whose getCurrentUser returns a single
    # shared owner profile; the public build is per-user, so an owner-scoped read
    # here hid every non-owner account's own tracked games.
    rows = (
        await TrackedGame.get_motor_collection()
        .find(
            {"userId": {"$in": id_query_values(user.id)}, "isActive": True},
            _PROJECTION,
        )
        .sort("dateAdded", -1)
        .to_list(length=None)
    )

    matches = await build_library_match_map(rows)

    games = []
    for row in rows:
        game = to_jsonable(row)
        game["libraryMatch"] = matches.get(str(row.get("_id"))) or None
        games.append(game)

    return {"games": games}
