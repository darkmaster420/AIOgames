from datetime import datetime
from typing import Any

from beanie import Document
from pydantic import ConfigDict


class LibraryGame(Document):
    """Mirror of the mongoose LibraryGame (NAS/library scan index).

    `normalizedTitle` is written by the Node scanner's normalizeLibraryTitle;
    the Python matcher must compute the same value to look games up here, so the
    normalisation is ported byte-for-byte in app/library_title.py.
    """

    model_config = ConfigDict(extra="allow")

    filePath: str | None = None
    fileName: str | None = None
    relativePath: str | None = None
    title: str | None = None
    normalizedTitle: str | None = None
    fileSizeBytes: int | None = None
    mtimeMs: float | None = None
    isActive: bool = True
    updatedAt: datetime | None = None

    class Settings:
        name = "librarygames"
