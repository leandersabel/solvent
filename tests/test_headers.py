"""Response headers, on every response shape (spec/features/
app-shell.md, Response headers).

The criterion is easy to fake by asserting CSP and HSTS on one
happy-path route, so this asserts them on a shell page, a JSON
endpoint, a Not Found and a Server Error.
"""
from __future__ import annotations

import pytest

from solvent.headers import CSP
from solvent.guard import navigation
from tests.helpers import CSRF, mint_invite, register


@pytest.fixture
def every_shape(app):
    @app.route("/dashboard/__boom")
    @navigation
    def boom():
        raise RuntimeError("stubbed failure")

    owner, _ = register(app, "owner")
    return [
        owner.get("/dashboard"),
        owner.get("/api/records?type=account", headers=CSRF),
        owner.get("/api/no-such-route", headers=CSRF),
        owner.get("/dashboard/__boom"),
    ]


def test_every_response_shape_carries_the_policy_byte_identically(every_shape):
    assert [r.status_code for r in every_shape] == [200, 200, 404, 500]
    for response in every_shape:
        assert response.headers["Content-Security-Policy"] == CSP


def test_every_response_shape_carries_hsts(every_shape):
    for response in every_shape:
        assert "max-age=" in response.headers["Strict-Transport-Security"]
        assert "includeSubDomains" in response.headers["Strict-Transport-Security"]


def test_the_policy_matches_the_architecture_byte_for_byte():
    from pathlib import Path
    import re

    architecture = (
        Path(__file__).resolve().parent.parent / "spec" / "architecture.md"
    ).read_text()
    block = architecture[architecture.index("- **CSP**:") :]
    quoted = re.search(r"`([^`]*default-src[^`]*)`", block, re.S).group(1)
    written = " ".join(quoted.split())
    assert written == CSP


def test_no_separate_x_frame_options_is_served(every_shape):
    """frame-ancestors 'none' in the CSP is the only framing control,
    and a second header stating the same thing is a second thing to
    keep in sync."""
    for response in every_shape:
        assert "X-Frame-Options" not in response.headers
    assert "frame-ancestors 'none'" in CSP


def test_hsts_preload_is_off_unless_the_deployment_opts_in(app, client):
    assert "preload" not in client.get("/login").headers["Strict-Transport-Security"]
    app.config["HSTS_PRELOAD"] = True
    assert "preload" in client.get("/login").headers["Strict-Transport-Security"]


def test_the_register_page_carries_no_referrer(app, client):
    """The token rides in this page's URL, so it is this page's
    outbound navigations that could carry it in a Referer header."""
    body = client.get(f"/register?invite={mint_invite(app)}").get_data(as_text=True)
    assert 'name="referrer" content="no-referrer"' in body


def test_the_vault_shell_page_is_not_kept_for_back(app):
    """architecture.md, Application hardening: a page left while
    unlocked keeps no keys, so the vault shell page is never stored."""
    owner, _ = register(app, "owner")
    assert owner.get("/dashboard").headers["Cache-Control"] == "no-store"
