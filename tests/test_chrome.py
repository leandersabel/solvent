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
from html.parser import HTMLParser
from pathlib import Path

import pytest

from solvent.config import DEFAULT_KDF_ENVELOPE
from solvent.crypto import ARGON2ID_SRI, ZXCVBN_SRI, ZXCVBN_VERSION
from solvent.guard import navigation
from solvent.shell import ALPINE_SRI, nav_entries
from tests.helpers import mint_invite, register

STATIC = Path(__file__).resolve().parent.parent / "solvent" / "static"
VENDOR = STATIC / "vendor"


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

    admin_js = (STATIC / "js" / "page-admin.js").read_text()
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


def test_an_administrators_sign_out_is_the_button_the_admin_script_listens_on(app):
    admin, _ = register(app, "root", kind="administrator")
    bar = topbar(admin.get("/admin").get_data(as_text=True))
    button = bar[bar.rindex("<button", 0, bar.index("Sign out")) : bar.index("</button>")]
    assert 'id="chrome-signout"' in button
    # The admin page loads no vault store, so a store call would do nothing.
    assert "$store" not in button
    assert "getElementById('chrome-signout')" in (STATIC / "js" / "page-admin.js").read_text()


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
    for path in ("/dashboard", "/settings", "/settings/dimensions", "/settings/export-import"):
        # Followed, because the rest are views of the first and
        # answer with a redirect to it.
        body = owner.get(path, follow_redirects=True).get_data(as_text=True)
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


def test_the_gauge_names_the_pinned_zxcvbn_and_the_vault_page_names_none(app):
    """strength.js holds the path and the hash itself, since a source
    read from markup could be planted. The planting is exercised in
    test_register_browser.py."""
    owner, _ = register(app, "owner")
    assert "zxcvbn-source" not in owner.get("/dashboard").get_data(as_text=True)

    script = (STATIC / "js" / "strength.js").read_text()
    path = re.search(r"new URL\('\.\./vendor/(zxcvbn/[^/']+)/zxcvbn\.js', import\.meta\.url\)", script)
    assert path.group(1) == f"zxcvbn/{ZXCVBN_VERSION}"
    assert re.search(r"const ZXCVBN_SRI = '([^']+)'", script).group(1) == ZXCVBN_SRI


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
    css = (STATIC / "css" / "tokens.css").read_text()
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
    body = client.get(f"/register?invite={mint_invite(app)}").get_data(as_text=True)
    attribute = re.search(r"data-currencies='([^']*)'", body)
    assert attribute, body[body.index("data-currencies") - 80 : body.index("data-currencies") + 200]
    parsed = json.loads(attribute.group(1))
    assert {"symbol": "CHF", "label": "Swiss Franc"} in parsed


# ---- One document from the derivation to the vault ---------------------
#
# The keys live in the memory of the document that derived them, so a
# vault owner's sign-in and registration are served the vault shell
# page, and what follows is drawn in that same document
# (spec/features/app-shell.md, Rules; login.md; register.md, Flow).


def scripts(body):
    return re.findall(r'<script[^>]*type="module"[^>]*src="[^"]*/js/([^"]+)"', body)


def test_the_sign_in_address_serves_the_vault_page_in_the_outside_frame(client):
    response = client.get("/login")
    body = response.get_data(as_text=True)
    assert response.status_code == 200
    assert scripts(body) == ["app.js"]
    assert 'class="outside-body"' in body
    assert 'class="outside-wordmark"' in body
    # No kind to draw a bar for, and none shown until a password has
    # been proved: the wordmark alone, hidden.
    assert "<nav" not in body
    assert re.search(r'<header class="topbar"[^>]* hidden', body)
    # Nothing in it names who is signed in, because nobody is.
    assert "data-username" not in body


def test_a_vault_owner_invite_serves_the_vault_page_carrying_the_form_data(app, client):
    token = mint_invite(app)
    response = client.get(f"/register?invite={token}")
    body = response.get_data(as_text=True)
    assert response.status_code == 200
    assert scripts(body) == ["app.js"]
    assert 'class="outside-body"' in body
    assert "<nav" not in body
    assert re.search(r'<header class="topbar"[^>]* hidden', body)
    assert 'data-kind="vault_owner"' in body
    assert f'data-token="{token}"' in body
    assert 'name="referrer" content="no-referrer"' in body
    # zxcvbn is loaded by the strength gauge, never named by the page.
    assert "zxcvbn" not in body


def test_an_administrator_invite_keeps_its_own_page(app, client):
    body = client.get(f"/register?invite={mint_invite(app, 'administrator')}").get_data(as_text=True)
    assert scripts(body) == ["page-register.js"]
    assert 'data-kind="administrator"' in body
    assert "topbar" not in body


def test_an_invalid_invite_keeps_its_error_page(client):
    response = client.get("/register?invite=nonsense")
    body = response.get_data(as_text=True)
    assert response.status_code == 400
    assert "This invite link is not valid" in body
    assert scripts(body) == []


def test_a_signed_in_caller_at_the_sign_in_address_is_still_sent_on(app):
    owner, _ = register(app, "owner")
    admin, _ = register(app, "root", kind="administrator")
    for client in (owner, admin):
        response = client.get("/login")
        assert response.status_code == 302
        assert response.headers["Location"] == "/"
    assert owner.get("/").headers["Location"] == "/dashboard"
    assert admin.get("/").headers["Location"] == "/admin"


def test_a_vault_owner_invite_opened_while_signed_in_draws_no_chrome(app):
    """The form sits in the outside frame whoever opens the link, so a
    session that happens to exist does not put a bar around it."""
    owner, _ = register(app, "owner")
    body = owner.get(f"/register?invite={mint_invite(app)}").get_data(as_text=True)
    assert "<nav" not in body
    assert "data-username" not in body


# The password screen is the vault page while it is locked, and it has
# no top bar and no navigation (product/app-shell.md, What must be
# true). The bar is in the markup for the moment the keys exist, and
# hidden until then.


def test_the_vault_page_is_served_in_the_outside_frame_with_the_bar_hidden(app):
    owner, _ = register(app, "owner")
    body = owner.get("/dashboard").get_data(as_text=True)
    assert 'class="outside-body"' in body
    assert 'class="outside-wordmark"' in body
    assert re.search(r'<header class="topbar"[^>]* hidden', body)
    # Ready for the unlock, which reveals what is already there.
    assert nav_labels(body) == ["Dashboard", "Settings"]
    assert "Update values" in topbar(body)


def test_a_visitor_with_no_session_gets_the_vault_page_in_the_outside_frame(client):
    body = client.get("/dashboard").get_data(as_text=True)
    assert 'class="outside-body"' in body
    assert 'class="outside-wordmark"' in body
    assert re.search(r'<header class="topbar"[^>]* hidden', body)
    assert "<nav" not in body
    assert "Update values" not in body
    assert client.get("/").headers["Location"] == "/dashboard"


def test_the_client_returns_to_the_outside_frame_on_every_lock():
    app_js = (STATIC / "js" / "app.js").read_text()
    start = app_js.index("function draw()")
    draw = app_js[start : app_js.index("const vault = currentVault();", start)]
    assert "enterOutsideFrame()" in draw
    # Nothing in the store acts on a vault that is locked.
    store = app_js[app_js.index("function registerVaultStore()") :]
    assert store.count("isUnlocked()") >= 3


# ---- Error pages (spec/features/app-shell.md, Error pages) -----------------

MISSING = "There is no page at this address."
FAILURE = "Something went wrong and this page could not be shown."


class Elements(HTMLParser):
    def __init__(self, body):
        super().__init__()
        self.found = []
        self.feed(body)

    def handle_starttag(self, tag, attrs):
        self.found.append((tag, dict(attrs)))

    def tags(self, name):
        return [attrs for tag, attrs in self.found if tag == name]


@pytest.fixture
def visitors(app):
    """One client per session state, and a route that raises."""

    # Under a prefix both kinds reach, so every visitor gets the failure.
    @app.route("/static/__boom")
    @navigation
    def boom():
        raise RuntimeError("stubbed failure")

    owner, _ = register(app, "owner")
    admin, _ = register(app, "root", kind="administrator")
    return [app.test_client(), owner, admin]


def test_forbidden_and_not_found_are_one_body_for_every_visitor(visitors):
    bodies = {
        visitor.get(path).get_data()
        for visitor in visitors
        for path in ("/a/b/c/", "/api/export")
    }
    assert len(bodies) == 1
    assert MISSING in bodies.pop().decode()


def test_a_server_error_is_one_body_for_every_visitor(visitors):
    responses = [visitor.get("/static/__boom") for visitor in visitors]
    assert {r.status_code for r in responses} == {500}
    assert len({r.get_data() for r in responses}) == 1
    body = responses[0].get_data(as_text=True)
    assert FAILURE in body
    assert MISSING not in body
    assert FAILURE not in visitors[0].get("/a/b/c/").get_data(as_text=True)


def test_both_error_bodies_carry_the_head_and_the_one_link_and_nothing_else(visitors):
    for path in ("/a/b/c/", "/static/__boom"):
        body = visitors[0].get(path).get_data(as_text=True)
        page = Elements(body)
        assert {"name": "viewport", "content": "width=device-width, initial-scale=1"} in page.tags("meta")
        assert [l["href"] for l in page.tags("link") if l.get("rel") == "stylesheet"] == [
            "/static/css/tokens.css"
        ]
        assert {"rel": "icon", "href": "/static/icon.png", "type": "image/png"} in page.tags("link")
        assert [a["href"] for a in page.tags("a")] == ["/"]
        assert "Go to Solvent" in body
        names = {tag for tag, _ in page.found}
        assert not names & {"script", "style", "form", "nav", "header"}
        assert not any("style" in attrs for _, attrs in page.found)
        assert "<title>Solvent</title>" in body
        assert page.tags("html") == [{"lang": "en"}]


def test_an_error_body_names_no_code_and_repeats_no_address(client):
    body = client.get("/a/b/c/?secret=1").get_data(as_text=True)
    assert "404" not in body
    assert "Not Found" not in body
    assert "secret" not in body
    assert "/a/b/c" not in body
