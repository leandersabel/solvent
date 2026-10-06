"""Record a value (spec/features/record-snapshot.md)."""

from __future__ import annotations

import re
from pathlib import Path

SOLVENT = Path(__file__).resolve().parent.parent / "solvent"

WORD = re.compile(r"\bsnapshots?\b", re.IGNORECASE)
COMMENT = re.compile(r"^\s*(//|/?\*)")
STRING = re.compile(r"""(['"`])((?:\\.|(?!\1)[^\\])*)\1""", re.DOTALL)
INTERPOLATION = re.compile(r"\$\{[^}]*\}")
MARKUP = re.compile(r"<[^>]*>|\{[{%#].*?[%}#]\}", re.DOTALL)


def _js_copy(path: Path) -> list[str]:
    """String literals with a space in them, interpolations removed:
    identifiers, ids and record types never hold a space, copy does."""
    code = "\n".join(line for line in path.read_text().splitlines() if not COMMENT.match(line))
    texts = (INTERPOLATION.sub("", m.group(2)) for m in STRING.finditer(code))
    return [text for text in texts if " " in text.strip()]


def test_no_copy_says_snapshot():
    """Snapshot is the record type's name, never a word on screen."""
    copy = [(path.name, text) for path in (SOLVENT / "static" / "js").glob("*.js") for text in _js_copy(path)]
    copy += [(path.name, MARKUP.sub(" ", path.read_text())) for path in (SOLVENT / "templates").rglob("*.html")]
    assert [(name, text) for name, text in copy if WORD.search(text)] == []
