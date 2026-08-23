"""Library title normalisation.

Exact port of `normalizeLibraryTitle` in src/lib/libraryTitle.ts. This MUST match
byte-for-byte: the Node scanner already wrote `normalizedTitle` into the
librarygames collection using the JS version, and the matcher compares computed
keys against those stored values. Any divergence silently breaks matching.

The JS is, in order:
  toLowerCase
  & -> " and "
  strip ['`]          (straight apostrophe 0x27 and backtick 0x60 only)
  [^a-z0-9]+ -> " "
  drop stop-words the/edition/deluxe/ultimate/complete/definitive/remastered/remaster
  collapse whitespace, trim
"""

import re

_APOSTROPHE_OR_BACKTICK = re.compile(r"['`]")
_NON_ALNUM = re.compile(r"[^a-z0-9]+")
_STOPWORDS = re.compile(
    r"\b(?:the|edition|deluxe|ultimate|complete|definitive|remastered|remaster)\b"
)
_WHITESPACE = re.compile(r"\s+")


def normalize_library_title(title: str) -> str:
    s = (title or "").lower()
    s = s.replace("&", " and ")
    s = _APOSTROPHE_OR_BACKTICK.sub("", s)
    s = _NON_ALNUM.sub(" ", s)
    s = _STOPWORDS.sub(" ", s)
    s = _WHITESPACE.sub(" ", s)
    return s.strip()
