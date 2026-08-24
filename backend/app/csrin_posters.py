"""Runtime csrin trusted/untrusted lists, backed by AppSetting.

Mirrors src/lib/trustedPosters.ts: the effective list is the env baseline
(CSRIN_RELIABLE_POSTERS / CSRIN_UNTRUSTED_POSTERS) plus the admin-managed lists
stored in the AppSetting collection under the same keys the Node admin UI writes
(csrinReliablePosters / csrinUntrustedPosters). Both apps share the DB, so the
backend picks up edits made from the admin tab without a restart.

The scraper (scraping/csrin.py) stays database-free and only exposes setters;
this module owns the DB read and pushes the merged lists in, refreshed at most
once per TTL.
"""

from __future__ import annotations

import os
import time

from .models import AppSetting
from .scraping import csrin

TRUSTED_KEY = "csrinReliablePosters"
UNTRUSTED_KEY = "csrinUntrustedPosters"
_TTL_MS = 60 * 1000

_last_refreshed = 0.0


def _env_list(var: str) -> list[str]:
    return [n.strip() for n in (os.environ.get(var) or "").split(",") if n.strip()]


async def _stored_list(key: str) -> list[str]:
    doc = await AppSetting.find_one(AppSetting.key == key)
    value = doc.value if doc else None
    return [str(x) for x in value if str(x).strip()] if isinstance(value, list) else []


async def refresh_csrin_posters(force: bool = False) -> None:
    """Merge env + stored lists into the scraper, at most once per TTL. A DB
    failure leaves whatever lists are already loaded in place."""
    global _last_refreshed
    if not force and (time.time() * 1000 - _last_refreshed) < _TTL_MS:
        return
    try:
        trusted = _env_list("CSRIN_RELIABLE_POSTERS") + await _stored_list(TRUSTED_KEY)
        untrusted = _env_list("CSRIN_UNTRUSTED_POSTERS") + await _stored_list(UNTRUSTED_KEY)
        csrin.set_reliable_posters(trusted)
        csrin.set_untrusted_posters(untrusted)
        _last_refreshed = time.time() * 1000
    except Exception as error:  # noqa: BLE001
        print(f"Could not refresh csrin poster lists: {error}")
