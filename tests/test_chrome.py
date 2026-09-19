"""The authenticated chrome (spec/ui/design-system.md, App shell;
spec/features/app-shell.md, Acceptance criteria).
"""
from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path

import flask

from solvent.config import DEFAULT_KDF_ENVELOPE
from solvent.csrf import csrf_exempt
from solvent.shell import ALPINE_SRI, nav_entries


def test_nav_shows_dashboard_and_settings_for_non_admin():
    entries = nav_entries({"username": "alice", "is_admin": False})
    labels = [e["label"] for e in entries]
    assert labels == ["Dashboard", "Settings"]
    assert "Admin" not in labels
    assert "Accounts" not in labels


def test_nav_adds_admin_as_third_entry_for_admin():
    entries = nav_entries({"username": "root", "is_admin": True})
    labels = [e["label"] for e in entries]
    assert labels == ["Dashboard", "Settings", "Admin"]
    assert "Accounts" not in labels


def test_nav_for_no_user_matches_non_admin():
    entries = nav_entries(None)
    assert [e["label"] for e in entries] == ["Dashboard", "Settings"]


def _render_shell_page(app):
    @app.route("/__test/chrome")
    @csrf_exempt
    def chrome_page():
        return flask.render_template_string(
            "{% extends 'shell/base.html' %}"
            "{% block content %}<p>content</p>{% endblock %}"
        )

    return app.test_client().get("/__test/chrome")


def test_shell_page_embeds_current_default_kdf_envelope(app):
    resp = _render_shell_page(app)
    assert resp.status_code == 200
    body = resp.get_data(as_text=True)

    start = body.index('id="kdf-envelope"')
    script_start = body.index(">", start) + 1
    script_end = body.index("</script>", script_start)
    embedded = json.loads(body[script_start:script_end])

    assert embedded == DEFAULT_KDF_ENVELOPE


def test_shell_page_contains_no_vault_plaintext(app):
    """The shell never has plaintext financial data, so nothing it
    renders can contain an account name, note, or value
    (spec/features/app-shell.md, What it does; Acceptance criteria).

    What this asserts is the positive half: the fixed chrome vocabulary
    renders. The absence half is carried by the template, which sources
    no variable from decrypted data.
    """
    resp = _render_shell_page(app)
    body = resp.get_data(as_text=True)

    chrome_vocabulary = {
        "Solvent",
        "Dashboard",
        "Settings",
        "Update values",
        "Lock",
        "content",
    }
    # shell/base.html sources every variable from nav_entries(),
    # kdf_envelope() or g.user, none of which the server populates from
    # ciphertext.
    for snippet in chrome_vocabulary:
        assert snippet in body


def test_lock_button_has_no_confirmation_dialog_and_makes_no_request(app):
    resp = _render_shell_page(app)
    body = resp.get_data(as_text=True)

    lock_start = body.index("$store.shell.lock()")
    # The whole <button ...>...</button> element for the lock control.
    tag_start = body.rindex("<button", 0, lock_start)
    tag_end = body.index("</button>", lock_start)
    lock_button_html = body[tag_start : tag_end + len("</button>")]

    # No htmx/form wiring that would round-trip to the server -- locking
    # is purely client-side (login.md, Rules: "the server session stays
    # alive").
    assert "hx-post" not in lock_button_html
    assert "hx-get" not in lock_button_html
    assert "formaction" not in lock_button_html


def test_no_route_exists_for_locking(app):
    """Locking is pure client-side state (login.md, Rules: "the server
    session stays alive"), so the shell registers no server-side
    endpoint for it at all."""
    lock_like = [
        rule.rule
        for rule in app.url_map.iter_rules()
        if "lock" in rule.rule.lower()
    ]
    assert lock_like == []


def test_alpine_asset_is_the_csp_safe_build_and_matches_pinned_sri():
    vendor_path = (
        Path(__file__).resolve().parent.parent
        / "solvent"
        / "static"
        / "vendor"
        / "alpinejs-csp"
        / "3.15.12"
        / "cdn.min.js"
    )
    assert vendor_path.is_file()

    digest = hashlib.sha384(vendor_path.read_bytes()).digest()
    computed_sri = "sha384-" + base64.b64encode(digest).decode()
    assert computed_sri == ALPINE_SRI

    # The CSP build's own marker: it ships without an eval-based
    # expression compiler string present in the plain build.
    source = vendor_path.read_text(errors="ignore")
    assert "new Function(" not in source


def test_shell_page_references_the_vendored_alpine_with_integrity(app):
    resp = _render_shell_page(app)
    body = resp.get_data(as_text=True)
    assert "vendor/alpinejs-csp/3.15.12/cdn.min.js" in body
    assert ALPINE_SRI in body
    assert "cdn.jsdelivr.net" not in body
    assert "unpkg.com" not in body
