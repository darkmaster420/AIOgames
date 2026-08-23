"""Convert raw Mongo documents to JSON-safe structures.

Mirrors what the Node routes returned via NextResponse.json on `.lean()`
documents: ObjectIds become strings (including the subdocument _ids mongoose
stamps inside updateHistory / downloadLinks arrays) and datetimes become ISO
strings. Applied recursively so nested arrays/objects are handled too.
"""

from datetime import datetime, date
from typing import Any

from bson import ObjectId


def to_jsonable(value: Any) -> Any:
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: to_jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_jsonable(v) for v in value]
    return value
