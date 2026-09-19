"""The authenticated chrome (spec/ui/design-system.md, App shell;
spec/features/app-shell.md, Acceptance criteria).
"""
from __future__ import annotations

import base64
import hashlib
import json
import re
from pathlib import Path

import flask

from solvent.config import DEFAULT_KDF_ENVELOPE
from solvent.csrf import csrf_exempt
from solvent.shell import ALPINE_SRI, nav_entries
from tests.helpers import seed_session, seed_user


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


def test_rendered_nav_for_an_admin_adds_admin_third(app):
    user_id = seed_user(app, "root", is_admin=True)
    body = _render_shell_page(app, seed_session(app, user_id)).get_data(
        as_text=True
    )
    assert _rendered_nav_labels(body) == ["Dashboard", "Settings", "Admin"]


def test_rendered_nav_for_a_non_admin_omits_admin(app):
    user_id = seed_user(app, "alice")
    body = _render_shell_page(app, seed_session(app, user_id)).get_data(
        as_text=True
    )
    assert _rendered_nav_labels(body) == ["Dashboard", "Settings"]


def test_rendered_nav_without_a_session_matches_non_admin(app):
    body = _render_shell_page(app).get_data(as_text=True)
    assert _rendered_nav_labels(body) == ["Dashboard", "Settings"]


def _render_shell_page(app, cookie=None):
    @app.route("/__test/chrome")
    @csrf_exempt
    def chrome_page():
        return flask.render_template_string(
            "{% extends 'shell/base.html' %}"
            "{% block content %}<p>content</p>{% endblock %}"
        )

    client = app.test_client()
    if cookie is not None:
        client.set_cookie("solvent_session", cookie)
    return client.get("/__test/chrome")


def _rendered_nav_labels(body):
    nav = body[body.index("<nav") : body.index("</nav>")]
    return re.findall(r'<a href="[^"]*">([^<]+)</a>', nav)


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

    # The CSP build ships its own parser and says so. These strings
    # exist only in that build, where the plain build compiles
    # expressions through the Function constructor instead.
    source = vendor_path.read_text(errors="ignore")
    assert "prohibited in the CSP build" in source
    assert "CSP Parser Error" in source


def test_shell_js_is_loaded_before_the_alpine_bundle(app):
    """The bundle calls `Alpine.start()` from a microtask, and the
    microtask queue drains between two deferred scripts. A listener
    registered after it would never see `alpine:init`, so `x-data` and
    `$store.shell` would resolve to undefined and the lock button would
    throw."""
    body = _render_shell_page(app).get_data(as_text=True)
    assert body.index("js/shell.js") < body.index("alpinejs-csp")


def test_shell_page_references_the_vendored_alpine_with_integrity(app):
    resp = _render_shell_page(app)
    body = resp.get_data(as_text=True)
    assert "vendor/alpinejs-csp/3.15.12/cdn.min.js" in body
    assert ALPINE_SRI in body
    assert "cdn.jsdelivr.net" not in body
    assert "unpkg.com" not in body


def _contrast(first: str, second: str) -> float:
    """WCAG relative-luminance contrast ratio for two `#rrggbb` colors."""

    def luminance(color: str) -> float:
        channels = [int(color[i : i + 2], 16) / 255 for i in (1, 3, 5)]
        channels = [
            c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
            for c in channels
        ]
        return (
            0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
        )

    lighter, darker = sorted(
        (luminance(first), luminance(second)), reverse=True
    )
    return (lighter + 0.05) / (darker + 0.05)


def _css_token(name: str) -> str:
    css = (
        Path(__file__).resolve().parent.parent
        / "solvent"
        / "static"
        / "css"
        / "tokens.css"
    ).read_text()
    return re.search(rf"--{name}:\s*(#[0-9a-f]{{6}})", css).group(1)


def test_top_bar_controls_clear_their_contrast_floors():
    """The chrome button exists because the secondary one does not
    clear these on petrol-800 (design-system.md, Components,
    Accessibility): body text 4.5:1, non-text 3:1."""
    bar = _css_token("petrol-800")

    assert _contrast("#ffffff", bar) >= 4.5  # chrome button label, and nav
    assert _contrast(_css_token("petrol-400"), bar) >= 3.0  # its border
    assert _contrast("#ffffff", bar) >= 3.0  # its focus ring


def test_top_bar_uses_the_chrome_button_not_the_secondary_one(app):
    body = _render_shell_page(app).get_data(as_text=True)
    topbar = body[body.index('class="topbar"') : body.index("</header>")]
    assert "btn-chrome" in topbar
    assert "btn-secondary" not in topbar
