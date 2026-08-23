from datetime import datetime
from typing import Any

from beanie import Document
from pydantic import ConfigDict, Field


class TrackedGame(Document):
    """Mirror of the mongoose TrackedGame.

    Only the fields the backend reads or ranks on are typed; everything the Node
    app writes (verification metadata, update history entries, download-link
    sub-arrays, …) is preserved via `extra = "allow"` so a Python write never
    drops columns it did not model.
    """

    model_config = ConfigDict(extra="allow")

    userId: Any = None
    gameId: str | None = None
    title: str | None = None
    originalTitle: str | None = None
    cleanedTitle: str | None = None
    source: str | None = None
    image: str | None = None
    gameLink: str | None = None
    lastKnownVersion: str | None = None
    steamAppId: int | None = None
    steamName: str | None = None
    steamVerified: bool = False
    gogVerified: bool = False
    isActive: bool = True
    dateAdded: datetime | None = None
    lastChecked: datetime | None = None
    updateHistory: list[dict[str, Any]] = Field(default_factory=list)
    latestApprovedUpdate: dict[str, Any] | None = None
    rssCachedDownloadLinks: list[dict[str, Any]] = Field(default_factory=list)

    class Settings:
        name = "trackedgames"
