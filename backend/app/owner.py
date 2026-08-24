"""Resolve the single owner profile the app scopes data to.

The Node app's getCurrentUser returns getLocalProfile() — a single NAS-wide
owner identity — for its data routes, so tracked games are owned by that owner's
_id regardless of which NextAuth user is signed in. To keep the backend's reads
identical we resolve the same owner here.

This is read-only: unlike the Node version it never creates or promotes a user
(seeding stays in the Node startup path). It just finds the id, cached for the
process lifetime.
"""

from __future__ import annotations

import os

from bson import ObjectId

from .models import User

_owner_id: str | None = None


async def _resolve_owner_id() -> str:
    configured = (os.environ.get("LOCAL_PROFILE_EMAIL") or "").strip().lower()

    user = None
    if configured:
        user = await User.find_one(User.email == configured)
    if user is None:
        user = await User.find({"role": "owner", "banned": {"$ne": True}}).sort("+createdAt").first_or_none()
    if user is None:
        user = await User.find({"role": "admin", "banned": {"$ne": True}}).sort("+createdAt").first_or_none()
    if user is None:
        user = await User.find({"banned": {"$ne": True}}).sort("+createdAt").first_or_none()

    if user is None:
        raise RuntimeError("No owner/admin user found to scope data to")

    return str(user.id)


async def get_owner_id() -> str:
    global _owner_id
    if _owner_id is None:
        _owner_id = await _resolve_owner_id()
    return _owner_id


def id_query_values(id_str: str) -> list:
    """Both ObjectId and string forms of an id, so a userId stored either way
    (mongoose ObjectId vs a stringified id) matches in a `$in` query."""
    values: list = [id_str]
    if ObjectId.is_valid(id_str):
        values.append(ObjectId(id_str))
    return values


# Backwards-compatible alias — the owner id is just one id fed through the same
# variant expansion.
def owner_id_query_values(owner_id: str) -> list:
    return id_query_values(owner_id)
