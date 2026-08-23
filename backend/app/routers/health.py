"""Health and auth-handoff diagnostics.

`/api/health` is public so the container healthcheck and the Next proxy can
probe it without the internal key. `/api/backend/whoami` is protected and exists
to prove the middleware -> FastAPI auth handoff end to end before any real
endpoint is ported.
"""

from fastapi import APIRouter, Depends

from ..auth import CurrentUser, get_current_user
from ..models import AppSetting

router = APIRouter()


@router.get("/api/health")
async def health() -> dict:
    # A cheap DB round-trip confirms Beanie is initialised and Mongo is reachable.
    ok = True
    try:
        await AppSetting.find_one({})
    except Exception:
        ok = False
    return {"status": "ok" if ok else "degraded", "service": "aiogames-backend"}


@router.get("/api/backend/whoami")
async def whoami(user: CurrentUser = Depends(get_current_user)) -> dict:
    return {"id": user.id, "role": user.role, "email": user.email, "isAdmin": user.is_admin}
