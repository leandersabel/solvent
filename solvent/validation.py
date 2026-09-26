"""Shapes every endpoint validates against, and the small checks more
than one of them needs.

Every model forbids unknown fields. That is what makes `principalId` or
`aad` in a body a Bad Request rather than a key quietly dropped
(record-api.md, Rules): a handler that ignores what it does not
recognise passes a behaviour test and fails the rule.
"""
from __future__ import annotations

import base64
import binascii
import re
import uuid

from flask import abort
from pydantic import BaseModel, ConfigDict, ValidationError

from .config import DEFAULT_KDF_ENVELOPE, MIN_KDF_ENVELOPE

USERNAME_PATTERN = re.compile(r"^[a-z0-9._-]{3,32}$")

# admin-invites.md: the origin of a CLI-minted invite. Refused as a
# username, so it can never name a real account of either kind.
BOOTSTRAP_PRINCIPAL = "system:bootstrap"


class Payload(BaseModel):
    model_config = ConfigDict(extra="forbid")


def parse(model: "type[Payload]", body: object) -> Payload:
    """Validate a request body, answering Bad Request on any failure.

    The failure detail stays out of the response: a caller learns that
    the body was wrong, not which field of which shape it missed.
    """
    if not isinstance(body, dict):
        abort(400)
    try:
        return model.model_validate(body)
    except ValidationError:
        abort(400)


def normalize_username(raw: object) -> "str | None":
    """Trimmed and lowercased before storage and comparison. One
    namespace across both kinds (architecture.md, Accounts on this
    instance)."""
    if not isinstance(raw, str):
        return None
    candidate = raw.strip().lower()
    if candidate == BOOTSTRAP_PRINCIPAL or not USERNAME_PATTERN.match(candidate):
        return None
    return candidate


def decode_b64(value: object, *, exact_bytes: "int | None" = None) -> "bytes | None":
    """Decode strict base64, returning None on anything malformed."""
    if not isinstance(value, str) or not value:
        return None
    try:
        raw = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError):
        return None
    if exact_bytes is not None and len(raw) != exact_bytes:
        return None
    return raw


def is_uuid4(value: str) -> bool:
    """A record id is client-generated, so it is validated as a shape
    rather than trusted as an identity."""
    try:
        parsed = uuid.UUID(value)
    except ValueError:
        return False
    return parsed.version == 4 and str(parsed) == value.lower()


def kdf_envelope_ok(envelope: object) -> bool:
    """At or above the server's configured minimum, and shaped exactly
    like it. A client must not be able to register itself a weak KDF,
    and an envelope with a field the server does not know is one the
    login client would derive from differently."""
    if not isinstance(envelope, dict) or set(envelope) != set(MIN_KDF_ENVELOPE):
        return False
    if envelope["alg"] != MIN_KDF_ENVELOPE["alg"]:
        return False
    if envelope["v"] != MIN_KDF_ENVELOPE["v"]:
        return False
    return all(
        isinstance(envelope[field], int) and envelope[field] >= MIN_KDF_ENVELOPE[field]
        for field in ("m", "t", "p")
    )


def envelope_is_stale(stored: object) -> bool:
    """Whether a login should trigger the upgrade (login.md,
    Stale-KDF upgrade): weaker than the server's current default in any
    parameter, or shaped like an envelope from before a field existed."""
    if not isinstance(stored, dict) or set(stored) != set(DEFAULT_KDF_ENVELOPE):
        return True
    return any(stored[field] < DEFAULT_KDF_ENVELOPE[field] for field in ("m", "t", "p"))
