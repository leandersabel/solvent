"""The app's icon (spec/features/app-shell.md, CSRF).

A page that declares no icon makes the browser ask for /favicon.ico,
which the gate refuses like any other headerless path, and the refusal
is a console error. So every page declares the icon, from the static
endpoint, and there is no /favicon.ico route to quiet it instead.

The criterion has three halves that each fake easily, and each is
asserted on its own: the declaration on every shell page *and* every
error page, the icon fetchable with no header and no session, and
/favicon.ico refused exactly as an invented page path is.
"""
from __future__ import annotations

import re

import pytest

from solvent.headers import CSP
from solvent.guard import navigation
from tests.helpers import CSRF, mint_invite, register

DECLARATION = re.compile(
    r'<link rel="icon" href="/static/icon\.png" type="image/png">'
)


@pytest.fixture
def boom(app):
    @app.route("/dashboard/__boom")
    @navigation
    def boom():
        raise RuntimeError("stubbed failure")


def test_every_shell_page_declares_the_icon(app, client):
    owner, _ = register(app, "owner")
    admin, _ = register(app, "root", kind="administrator")
    pages = {
        # shell/base.html, signed out, a vault owner, an administrator
        "dashboard, no session": client.get("/dashboard"),
        "login": client.get("/login"),
        "dashboard": owner.get("/dashboard"),
        "admin": admin.get("/admin"),
        # shell/outside.html
        "register": client.get(f"/register?invite={mint_invite(app)}"),
        "register, invalid invite": client.get("/register?invite=not-an-invite"),
    }
    for name, response in pages.items():
        assert response.status_code in (200, 400), name
        assert DECLARATION.search(response.get_data(as_text=True)), name


def test_both_shell_templates_are_covered_by_the_pages_above(app, client):
    owner, _ = register(app, "owner")
    admin, _ = register(app, "root", kind="administrator")
    # A valid vault invite is served as the vault shell page; only a
    # refused one renders the outside frame.
    body = client.get("/register?invite=not-an-invite").get_data(as_text=True)
    assert 'x-data="shell"' not in body and 'class="outside-body"' in body  # outside.html
    assert 'x-data="shell"' in owner.get("/dashboard").get_data(as_text=True)  # base.html
    assert 'x-data="shell"' in admin.get("/admin").get_data(as_text=True)  # base.html


def test_every_error_page_declares_the_icon(app, client, boom):
    owner, _ = register(app, "owner")
    answers = {
        "Forbidden": client.get("/api/records?type=account"),
        "Not Found": owner.get("/api/no-such-route", headers=CSRF),
        "Not Found, admin area with no session": client.get("/admin"),
        "Server Error": owner.get("/dashboard/__boom"),
    }
    assert [r.status_code for r in answers.values()] == [403, 404, 404, 500]
    for name, response in answers.items():
        assert DECLARATION.search(response.get_data(as_text=True)), name


def test_an_error_body_depends_only_on_the_status_code(app, client, boom):
    """Forbidden whether the session is valid or absent, and whichever
    path was asked for: a body that varied would be a probe."""
    owner, _ = register(app, "owner")
    forbidden = {
        client.get(path).get_data()
        for path in ("/api/records", "/api/no-such-route")
    } | {owner.get("/api/records").get_data()}
    assert len(forbidden) == 1
    not_found = {
        owner.get("/api/no-such-route", headers=CSRF).get_data(),
        client.get("/nope", headers=CSRF).get_data(),
        client.get("/admin").get_data(),
    }
    assert len(not_found) == 1
    assert forbidden != not_found


def test_the_icon_loads_with_no_header_and_no_session(client):
    response = client.get("/static/icon.png")
    assert response.status_code == 200
    assert response.mimetype == "image/png"
    data = response.get_data()
    assert data.startswith(b"\x89PNG\r\n\x1a\n")


def test_the_icon_is_a_one_pixel_transparent_png(client):
    import struct
    import zlib

    data = client.get("/static/icon.png").get_data()
    chunks = {}
    at = 8
    while at < len(data):
        (length,) = struct.unpack(">I", data[at : at + 4])
        kind = data[at + 4 : at + 8]
        chunks.setdefault(kind, data[at + 8 : at + 8 + length])
        at += 12 + length
    width, height, depth, colour = struct.unpack(">IIBB", chunks[b"IHDR"][:10])
    assert (width, height, depth, colour) == (1, 1, 8, 6)  # RGBA
    assert zlib.decompress(chunks[b"IDAT"])[-1] == 0  # alpha of the pixel


def test_the_icon_carries_the_same_security_headers_as_other_responses(client):
    icon = client.get("/static/icon.png")
    other = client.get("/login")
    assert icon.headers["Content-Security-Policy"] == CSP
    assert "max-age=" in icon.headers["Strict-Transport-Security"]
    for name in ("Content-Security-Policy", "Strict-Transport-Security"):
        assert icon.headers[name] == other.headers[name]


def test_there_is_no_favicon_route(app):
    assert not [r for r in app.url_map.iter_rules() if "favicon" in r.rule]


def test_favicon_is_refused_exactly_as_an_invented_page_path(app, client):
    owner, _ = register(app, "owner")
    for session in (client, owner):
        refused = session.get("/favicon.ico")
        invented = session.get("/no-such-path")
        assert refused.status_code >= 400
        assert refused.status_code == invented.status_code
        assert refused.get_data() == invented.get_data()


def test_the_icon_is_not_a_data_url(app, client):
    """img-src 'self' blocks a data: URL, so declaring one would be a
    console error of its own."""
    assert "data:" not in CSP.split("img-src")[1].split(";")[0]
    assert "data:image" not in client.get("/login").get_data(as_text=True)
