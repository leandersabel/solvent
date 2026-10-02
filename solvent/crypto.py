"""What the server does with key material, which is: hash an Auth Key
and compare hashes (spec/features/login.md, Rules).

No plaintext, no password, no DEK, and nothing that could derive one.
The expensive derivation happens in the browser; the Argon2id here is
defense in depth over an already-high-entropy Auth Key, and it is what
makes an offline attack on `verifier` pay the same price for an
administrator as for a vault owner.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import threading
from contextlib import contextmanager

from argon2 import PasswordHasher, Type
from argon2.exceptions import VerificationError, VerifyMismatchError
from flask import abort, current_app

from .config import SERVER_VERIFY_PARAMS

# The vendored browser bundle's pinned hash, which the test suite
# recomputes from the file. tools/vendor-argon2id.py prints this value;
# see static/vendor/argon2id/1.0.1/SOURCE.txt.
ARGON2ID_SRI = "sha384-STUmJDURIwAiKH+yqPUtZ/E6HZmrEvZoQG7X51r+FjJl1vinyhEyrqHLVkofdrh1"

ZXCVBN_VERSION = "4.4.2"
ZXCVBN_SRI = "sha384-LXuP8lknSGBOLVn4fwVOl+rWR+zOEtZx6CF9ZLaN6gKBgLByU4D79VWWjV4/gefq"

_hasher = PasswordHasher(
    memory_cost=SERVER_VERIFY_PARAMS["m"],
    time_cost=SERVER_VERIFY_PARAMS["t"],
    parallelism=SERVER_VERIFY_PARAMS["p"],
    type=Type.ID,
)

# architecture.md, Concurrency cap: N parallel verifications allocate
# N x 64 MiB before the rate limiter's verdict matters, which is a
# memory-exhaustion lever on a small host. A request over the cap waits
# for a slot, and a wait past the bound answers Too Many Requests, the same
# answer any other limit gives. One gate per app, sized by its config.
_gate_lock = threading.Lock()


@contextmanager
def _slot():
    app = current_app._get_current_object()
    with _gate_lock:
        gate = app.extensions.get("solvent.verify_gate")
        if gate is None:
            gate = threading.Semaphore(app.config["VERIFY_CONCURRENCY"])
            app.extensions["solvent.verify_gate"] = gate
    if not gate.acquire(timeout=app.config["VERIFY_WAIT_SECONDS"]):
        abort(429)
    try:
        yield
    finally:
        gate.release()


def hash_auth_key(auth_key: str) -> str:
    with _slot():
        return _hasher.hash(auth_key)


def verify_auth_key(verifier: str, auth_key: str) -> bool:
    """Constant-time in the sense that matters: Argon2id's own compare,
    and the same wall-clock work whether or not it matches."""
    with _slot():
        try:
            return _hasher.verify(verifier, auth_key)
        except (VerifyMismatchError, VerificationError):
            return False


# A login against an unknown username still runs a full verification
# against this and discards the result. Without it the endpoint answers
# in microseconds for accounts that do not exist and in tens of
# milliseconds for ones that do, which reveals existence by timing.
_DECOY_VERIFIER: "str | None" = None


def decoy_verifier() -> str:
    global _DECOY_VERIFIER
    if _DECOY_VERIFIER is None:
        _DECOY_VERIFIER = _hasher.hash(secrets.token_urlsafe(32))
    return _DECOY_VERIFIER


def decoy_salt(normalized_username: str) -> str:
    """`HMAC(server_secret, normalized_username)` truncated to 16
    bytes: deterministic, so the same unknown username answers with the
    same salt every time, and unguessable without the key."""
    digest = hmac.new(
        current_app.config["SECRET_KEY"].encode("utf-8"),
        normalized_username.encode("utf-8"),
        hashlib.sha256,
    ).digest()[:16]
    return base64.b64encode(digest).decode("ascii")


def hash_invite_token(token: str) -> str:
    """SHA-256. The token is 256 bits of `secrets.token_urlsafe`, so a
    slow KDF buys nothing, and lookup is by hash in constant time."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
