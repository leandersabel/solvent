"""Response timing of the pre-authentication endpoints
(spec/features/login.md, Acceptance criteria).

Whether a username exists, and which kind of account it names, must not
be readable off a stopwatch. Each case is sampled many times through
the test client, interleaved and shuffled round by round so drift in
the machine hits every case equally, and every pair of cases is then
held to an equivalence margin: their medians may differ by no more than
the interquartile range of a single request. A difference inside the
noise of one request passes, and a code path that skips real work for
one case lands many spreads away and fails.

The sign-in wait before the Auth Key leaves the browser is a
client-side channel and is not asserted here: no server-side
measurement can see it.
"""
from __future__ import annotations

import itertools
import random
import statistics
import time

import pytest

from solvent.config import SERVER_VERIFY_PARAMS
from tests.helpers import CSRF, b64, register

# One interquartile range of a single request. The sample counts below
# keep the standard error of a median difference at most a fifth of it,
# so noise alone does not reach the margin.
MARGIN_IN_SPREADS = 1.0


@pytest.fixture
def unthrottled(app):
    """The limiter still runs, records and counts on every request, so
    its cost stays in the measurement. Only its verdict is lifted,
    because a lockout mid-sample would time a 429 instead."""
    ceiling = 10**9
    app.config.update(
        LOGIN_FAILURES_PER_ADDRESS=ceiling,
        LOGIN_ATTEMPTS_PER_ACCOUNT=ceiling,
        LOGIN_LOCKOUT_THRESHOLD=ceiling,
    )
    return app


@pytest.fixture
def server_argon2(cheap_argon2, monkeypatch):
    """Server-side Argon2id at the cost production runs, because the
    regression the login test exists for is skipping a verification
    that takes tens of milliseconds there. Accounts registered after
    this carry the same parameters as the decoy hash."""
    from argon2 import PasswordHasher, Type

    import solvent.crypto as crypto

    monkeypatch.setattr(
        crypto,
        "_hasher",
        PasswordHasher(
            memory_cost=SERVER_VERIFY_PARAMS["m"],
            time_cost=SERVER_VERIFY_PARAMS["t"],
            parallelism=SERVER_VERIFY_PARAMS["p"],
            type=Type.ID,
        ),
    )
    monkeypatch.setattr(crypto, "_DECOY_VERIFIER", None)


def sample(client, path, bodies, rounds, status):
    """Seconds per request for each named case, one request per case per
    round in a fresh random order. The first round is discarded: it
    pays one-time costs such as building the decoy hash."""
    times = {name: [] for name in bodies}
    names = list(bodies)
    for round_number in range(rounds + 1):
        random.shuffle(names)
        for name in names:
            started = time.perf_counter()
            response = client.post(path, json=bodies[name](), headers=CSRF)
            elapsed = time.perf_counter() - started
            # A different status is a different code path, and timing it
            # would compare the wrong thing.
            assert response.status_code == status, (name, response.status_code)
            if round_number:
                times[name].append(elapsed)
    return times


def iqr(values):
    quartiles = statistics.quantiles(values, n=4)
    return quartiles[2] - quartiles[0]


def assert_indistinguishable(times):
    for a, b in itertools.combinations(times, 2):
        gap = abs(statistics.median(times[a]) - statistics.median(times[b]))
        spread = (iqr(times[a]) + iqr(times[b])) / 2
        assert gap <= MARGIN_IN_SPREADS * spread, (
            f"{a} and {b} differ by {gap * 1e3:.3f} ms in median, "
            f"against a per-request spread of {spread * 1e3:.3f} ms"
        )


def test_the_salt_takes_the_same_time_for_either_kind_and_a_stranger(unthrottled):
    """login.md: the salt response is statistically indistinguishable in
    timing for a known and an unknown username, and for an
    administrator, a vault owner and an unknown username as a three-way
    comparison, all at current KDF parameters."""
    register(unthrottled, "owner")
    register(unthrottled, "root", kind="administrator")
    times = sample(
        unthrottled.test_client(),
        "/api/auth/salt",
        {
            "vault owner": lambda: {"username": "owner"},
            "administrator": lambda: {"username": "root"},
            "unknown": lambda: {"username": "nobody-at-all"},
        },
        rounds=200,
        status=200,
    )
    assert_indistinguishable(times)


def test_a_wrong_login_takes_the_same_time_for_either_kind_and_a_stranger(
    unthrottled, server_argon2
):
    """login.md: a wrong Auth Key against an administrator, a vault owner
    and an unknown username is statistically indistinguishable in
    timing, and so an unknown username takes the same time as a known
    one with a wrong Auth Key, with the decoy verification in place."""
    register(unthrottled, "owner")
    register(unthrottled, "root", kind="administrator")
    times = sample(
        unthrottled.test_client(),
        "/api/auth/login",
        {
            "vault owner": lambda: {"username": "owner", "authKey": b64()},
            "administrator": lambda: {"username": "root", "authKey": b64()},
            "unknown": lambda: {"username": "nobody-at-all", "authKey": b64()},
        },
        rounds=40,
        status=401,
    )
    assert_indistinguishable(times)
