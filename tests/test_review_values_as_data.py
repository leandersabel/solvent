"""No browser check writes a value into code the test browser runs.

CLAUDE.md, Code standards: "A value reaches code as data, never written
into its text." Every string handed to a helper that runs it in the
page is either fixed text or built only from the source of a function
or a fixed code fragment. Values go in `args`.
"""
from __future__ import annotations

import re

from tests.helpers import REPO_ROOT

BROWSER = REPO_ROOT / "tests" / "browser"

# Where a string becomes code in the page: the waits, and every other
# helper that runs a string, with the protocol fields they fill and the
# recorder's `ev`, which forwards its string to `eval`.
WAITS = re.compile(r"\.(?:waitUntil|holds)\(\s*")
OTHERS = re.compile(r"\.(?:eval|call)\(\s*|\bev\(\s*|\b(?:expression|functionDeclaration):\s*")

# What may be written into such a string: the source of a function the
# helper was handed, or `HANDS`, a fixed code fragment from harness.mjs.
CODE = {"source", "read", "find", "act", "HANDS"}


def _skip_quoted(text: str, i: int) -> int:
    quote = text[i]
    i += 1
    while text[i] != quote:
        i += 2 if text[i] == "\\" else 1
    return i + 1


def _template(text: str, i: int) -> tuple[int, list[str]]:
    """The end of the template literal starting at `text[i]`, and what
    each of its `${...}` holds."""
    i += 1
    held = []
    while text[i] != "`":
        if text[i] == "\\":
            i += 2
        elif text.startswith("${", i):
            depth, j = 1, i + 2
            while depth:
                c = text[j]
                if c == "`":
                    j, _ = _template(text, j)
                    continue
                if c in "'\"":
                    j = _skip_quoted(text, j)
                    continue
                depth += {"{": 1, "}": -1}.get(c, 0)
                j += 1
            held.append(text[i + 2 : j - 1].strip())
            i = j
        else:
            i += 1
    return i + 1, held


def written_values(sinks: re.Pattern) -> list[str]:
    found = []
    for path in sorted(BROWSER.rglob("*.mjs")):
        text = path.read_text()
        for sink in sinks.finditer(text):
            start = sink.end()
            where = f"{path.relative_to(REPO_ROOT)}:{text.count(chr(10), 0, start) + 1}"
            if text[start] == "`":
                end, held = _template(text, start)
                found += [f"{where}: ${{{h}}}" for h in held if h not in CODE]
            elif text[start] in "'\"":
                end = _skip_quoted(text, start)
            else:
                continue
            if text[end:].lstrip().startswith("+"):
                found.append(f"{where}: a string joined to a value")
    return found


def test_no_wait_condition_has_a_value_written_into_it():
    assert not written_values(WAITS)


def test_no_other_page_code_has_a_value_written_into_it():
    assert not written_values(OTHERS)
