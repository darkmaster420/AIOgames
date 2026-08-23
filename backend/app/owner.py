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


def owner_id_query_values(owner_id: str) -> list:
    """Both ObjectId and string forms, so a userId stored either way matches."""
    values: list = [owner_id]
    if ObjectId.is_valid(owner_id):
        values.append(ObjectId(owner_id))
    return values
