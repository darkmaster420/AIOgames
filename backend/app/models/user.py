from datetime import datetime

from beanie import Document
from pydantic import ConfigDict


class User(Document):
    """Mirror of the mongoose User. Auth still happens in NextAuth; the backend
    only reads users (e.g. to resolve the owner for library ops) and never
    handles passwords."""

    model_config = ConfigDict(extra="allow")

    email: str | None = None
    username: str | None = None
    name: str | None = None
    role: str = "user"
    banned: bool = False
    createdAt: datetime | None = None

    class Settings:
        name = "users"
