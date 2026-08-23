from typing import Any

from beanie import Document
from pydantic import ConfigDict, Field


class AppSetting(Document):
    """Generic key/value store, shared with the Node app's AppSetting model.

    Used for runtime-editable settings such as the trusted/untrusted cs.rin.ru
    poster lists.
    """

    model_config = ConfigDict(extra="allow")

    key: str
    value: Any = None

    class Settings:
        name = "appsettings"
