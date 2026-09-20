"""The authenticated chrome (spec/ui/design-system.md, App shell;
spec/features/app-shell.md, The chrome).

It differs by kind, and it differs by omission rather than by
rearrangement.
"""
from __future__ import annotations

import base64
import hashlib
import json
import re
from pathlib import Path

from solvent.config import DEFAULT_KDF_ENVELOPE
from solvent.crypto import ARGON2ID_SRI, ZXCVBN_SRI
from solvent.shell import ALPINE_SRI, nav_entries
from tests.helpers import register

VENDOR = Path(__file__).resolve().parent.parent / "solvent" / "static" / "vendor"


def nav_labels(body):
    nav = body[body.index("<nav") : body.index("</nav>")]
    return re.findall(r'<a href="[^"]*">([^<]+)</a>', nav)


def topbar(body):
    return body[body.index('class="topbar"') : body.index("</header>")]


def test_nav_is_dashboard_and_settings_for_a_vault_owner():
    assert [e["label"] for e in nav_entries({"kind": "vault_owner"})] == [
        "Dashboard",
        "Settings",
    ]


def test_an_administrator_has_no_nav_entries_at_all():
    assert nav_entries({"kind": "administrator"}) == []
    assert nav_entries(None) == []


def test_there_is_no_holdings_entry_and_no_admin_entry_in_either_bar(app):
    owner, _ = register(app, "owner")
    admin, _ = register(app, "root", kind="administrator")
    for body in (
        owner.get("/dashboard").get_data(as_text=True),
        admin.get("/admin").get_data(as_text=True),
    ):
        labels = nav_labels(body)
        assert "Holdings" not in labels
        assert "Admin" not in labels


def test_a_vault_owners_bar_carries_update_values_and_lock(app):
    owner, _ = register(app, "owner")
    bar = topbar(owner.get("/dashboard").get_data(as_text=True))
    assert "Update values" in bar
    assert "Lock" in bar
    assert "Sign out" not in bar
    assert nav_labels(owner.get("/dashboard").get_data(as_text=True)) == [
        "Dashboard",
        "Settings",
    ]


def test_an_administrators_bar_carries_the_wordmark_and_sign_out_and_nothing_else(app):
    admin, _ = register(app, "root", kind="administrator")
    body = admin.get("/admin").get_data(as_text=True)
    bar = topbar(body)
    assert "Solvent" in bar
    assert "Sign out" in bar
    assert "Update values" not in bar
    assert "Lock" not in bar
    assert nav_labels(body) == []


def test_both_kinds_embed_the_current_default_kdf_envelope(app):
    owner, _ = register(app, "owner")
    admin, _ = register(app, "root", kind="administrator")
    for body in (
        owner.get("/dashboard").get_data(as_text=True),
        admin.get("/admin").get_data(as_text=True),
    ):
        start = body.index('id="kdf-envelope"')
        opened = body.index(">", start) + 1
        assert json.loads(body[opened : body.index("</script>", opened)]) == (
            DEFAULT_KDF_ENVELOPE
        )


def test_the_embedded_envelope_is_the_pinned_one():
    assert DEFAULT_KDF_ENVELOPE == {
        "alg": "argon2id",
        "v": 19,
        "m": 65536,
        "t": 3,
        "p": 1,
    }


def test_an_administrator_loads_the_worker_and_not_the_record_layer(app):
    """The Argon2id worker still ships, because changing their
    password derives at current parameters like any other account."""
    admin, _ = register(app, "root", kind="administrator")
    owner, _ = register(app, "owner")

    admin_page = admin.get("/admin").get_data(as_text=True)
    owner_page = owner.get("/dashboard").get_data(as_text=True)

    assert "page-admin.js" in admin_page
    assert "js/app.js" not in admin_page
    assert "js/app.js" in owner_page

    from pathlib import Path

    admin_js = (
        Path(__file__).resolve().parent.parent / "solvent" / "static" / "js" / "page-admin.js"
    ).read_text()
    # It reaches the worker through session.js, which owns the
    # derivation, and never through the model or the write paths.
    assert "./session.js" in admin_js
    assert "./model.js" not in admin_js
    assert "./writes.js" not in admin_js


def test_the_lock_button_makes_no_request_and_has_no_route(app):
    owner, _ = register(app, "owner")
    body = owner.get("/dashboard").get_data(as_text=True)
    lock_at = body.index("$store.shell.lock()")
    element = body[body.rindex("<button", 0, lock_at) : body.index("</button>", lock_at)]
    for wiring in ("hx-post", "hx-get", "formaction", "href"):
        assert wiring not in element

    assert [
        rule.rule for rule in app.url_map.iter_rules() if "lock" in rule.rule.lower()
    ] == []


def test_the_top_bar_uses_the_chrome_button_not_the_secondary_one(app):
    owner, _ = register(app, "owner")
    bar = topbar(owner.get("/dashboard").get_data(as_text=True))
    assert "btn-chrome" in bar
    assert "btn-secondary" not in bar


def test_no_shell_response_contains_vault_plaintext(app):
    """The shell never holds plaintext to begin with, so what this
    asserts is that no route wired to it receives decrypted content:
    every page's content region is an empty mount point."""
    owner, _ = register(app, "owner")
    for path in ("/dashboard", "/settings", "/settings/dimensions"):
        body = owner.get(path).get_data(as_text=True)
        region = body[body.index("<main") : body.index("</main>")]
        assert re.sub(r"<[^>]+>|\s", "", region) == ""


# ---- The vendored dependencies ----------------------------------------


def sri_of(path):
    return "sha384-" + base64.b64encode(hashlib.sha384(path.read_bytes()).digest()).decode()


def test_the_alpine_build_served_is_the_csp_safe_one_at_its_pinned_hash():
    path = VENDOR / "alpinejs-csp" / "3.15.12" / "cdn.min.js"
    assert sri_of(path) == ALPINE_SRI
    source = path.read_text(errors="ignore")
    # These strings exist only in the CSP build, where the plain build
    # compiles expressions through the Function constructor instead.
    assert "prohibited in the CSP build" in source
    assert "CSP Parser Error" in source


def test_the_argon2id_bundle_matches_its_pinned_hash():
    assert sri_of(VENDOR / "argon2id" / "1.0.1" / "argon2id.js") == ARGON2ID_SRI


def test_the_zxcvbn_bundle_matches_its_pinned_hash():
    assert sri_of(VENDOR / "zxcvbn" / "4.4.2" / "zxcvbn.js") == ZXCVBN_SRI


def test_no_third_party_cdn_is_referenced_anywhere(app):
    owner, _ = register(app, "owner")
    admin, _ = register(app, "root", kind="administrator")
    pages = [
        owner.get(path).get_data(as_text=True)
        for path in ("/dashboard", "/settings", "/login")
    ]
    pages.append(admin.get("/admin").get_data(as_text=True))
    for body in pages:
        for host in ("cdn.jsdelivr.net", "unpkg.com", "cdnjs.cloudflare.com", "fonts.googleapis.com"):
            assert host not in body


def test_the_supply_chain_list_is_exactly_what_is_vendored():
    """architecture.md names it in full and means it to stay short."""
    assert {path.name for path in VENDOR.iterdir()} == {
        "alpinejs-csp",
        "argon2id",
        "zxcvbn",
    }


# ---- Contrast floors ---------------------------------------------------


def contrast(first, second):
    def luminance(color):
        channels = [int(color[i : i + 2], 16) / 255 for i in (1, 3, 5)]
        channels = [
            c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in channels
        ]
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]

    lighter, darker = sorted((luminance(first), luminance(second)), reverse=True)
    return (lighter + 0.05) / (darker + 0.05)


def token(name):
    css = (
        Path(__file__).resolve().parent.parent
        / "solvent" / "static" / "css" / "tokens.css"
    ).read_text()
    return re.search(rf"--{name}:\s*(#[0-9a-f]{{6}})", css).group(1)


def test_the_top_bar_controls_clear_their_contrast_floors():
    bar = token("petrol-800")
    assert contrast("#ffffff", bar) >= 4.5
    assert contrast(token("petrol-400"), bar) >= 3.0


def test_every_body_text_token_clears_its_stated_floor():
    ground = token("ground")
    for name in ("ink-primary", "ink-secondary", "brass-600", "plum-600",
                 "status-good", "status-critical"):
        assert contrast(token(name), ground) >= 4.5, name
    # Marked sub-4.5 in the spec and restricted to non-text use.
    for name in ("ink-muted", "brass-500", "status-warning"):
        assert 3.0 <= contrast(token(name), ground) < 4.5, name


def test_the_register_page_hands_the_currency_list_to_the_browser_intact(app, client):
    """`tojson` marks its output safe, so autoescaping does not run on
    it: a double-quoted attribute would be closed by the first quote
    the list carries and the page would parse nothing."""
    from tests.helpers import mint_invite

    body = client.get(f"/register?invite={mint_invite(app)}").get_data(as_text=True)
    attribute = re.search(r"data-currencies='([^']*)'", body)
    assert attribute, body[body.index("data-currencies") - 80 : body.index("data-currencies") + 200]
    parsed = json.loads(attribute.group(1))
    assert {"symbol": "CHF", "label": "Swiss Franc"} in parsed
