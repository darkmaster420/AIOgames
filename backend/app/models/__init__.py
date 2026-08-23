"""Beanie document models mirroring the existing mongoose collections.

Collection names are pinned to what mongoose generated (model name lower-cased
and pluralised: User -> "users", TrackedGame -> "trackedgames", AppSetting ->
"appsettings"), so both apps operate on the same documents during the migration.

Models are intentionally lenient (extra = "allow") because the live documents
carry many fields the Node app wrote; we type the ones the backend needs and
leave the rest untouched rather than risk dropping data on write.
"""

from .user import User
from .tracked_game import TrackedGame
from .app_setting import AppSetting
from .library_game import LibraryGame

# Registered with Beanie at startup.
DOCUMENT_MODELS = [User, TrackedGame, AppSetting, LibraryGame]

__all__ = ["User", "TrackedGame", "AppSetting", "LibraryGame", "DOCUMENT_MODELS"]
