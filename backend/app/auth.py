"""Request authentication.

Auth itself lives in NextAuth on the frontend. The Next middleware validates the
session and, when it proxies a request here, attaches:

    x-aio-internal-key : the shared INTERNAL_API_SECRET
    x-aio-user-id      : the authenticated user's id
    x-aio-user-role    : their role
    x-aio-user-email   : their email (optional)

We trust the user headers only when the internal key matches, so a client that
reaches the backend directly (it should not — the port is unpublished) cannot
forge a user. This keeps a single source of auth truth without reimplementing
NextAuth's encrypted-JWT handling in Python.
"""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException, status

from .config import Settings, get_settings


@dataclass(frozen=True)
class CurrentUser:
    id: str
    role: str
    email: str | None = None

    @property
    def is_admin(self) -> bool:
        return self.role in ("admin", "owner")


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)


async def get_current_user(
    x_aio_internal_key: str | None = Header(default=None),
    x_aio_user_id: str | None = Header(default=None),
    x_aio_user_role: str | None = Header(default=None),
    x_aio_user_email: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> CurrentUser:
    # Dev escape hatch: only when explicitly enabled and no secret is configured.
    if settings.allow_unauthenticated and not settings.internal_api_secret:
        return CurrentUser(id=x_aio_user_id or "dev", role=x_aio_user_role or "owner", email=x_aio_user_email)

    if not settings.internal_api_secret:
        # Fail closed: a missing secret must not silently allow everything.
        raise _unauthorized("Backend auth is not configured (INTERNAL_API_SECRET unset).")

    if x_aio_internal_key != settings.internal_api_secret:
        raise _unauthorized("Missing or invalid internal key.")

    if not x_aio_user_id:
        raise _unauthorized("No authenticated user.")

    return CurrentUser(id=x_aio_user_id, role=x_aio_user_role or "user", email=x_aio_user_email)


async def require_internal_key(
    x_aio_internal_key: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> None:
    """Gate for endpoints that mirror public (anon-allowed) routes: they still
    must arrive through the Next proxy (valid internal key) but do not need a
    signed-in user. Used by /api/games/search (csrin)."""
    if settings.allow_unauthenticated and not settings.internal_api_secret:
        return
    if not settings.internal_api_secret:
        raise _unauthorized("Backend auth is not configured (INTERNAL_API_SECRET unset).")
    if x_aio_internal_key != settings.internal_api_secret:
        raise _unauthorized("Missing or invalid internal key.")
