"""Template context for the authenticated chrome
(spec/ui/design-system.md, App shell; spec/features/app-shell.md, The
chrome).

No routes of its own. Every authenticated screen is another feature's
blueprint whose templates extend `templates/shell/base.html`.

The chrome differs by kind, and it differs by omission rather than by
rearrangement: an administrator's bar carries a wordmark and Sign out
and nothing else, because with one destination there is nothing for a
nav to navigate between and every other entry would answer Not Found.
"""
from __future__ import annotations

import flask

from .config import DEFAULT_KDF_ENVELOPE
from .crypto import ARGON2ID_SRI, ARGON2ID_VERSION, ZXCVBN_SRI, ZXCVBN_VERSION

# The CSP-safe Alpine build, self-hosted with a pinned version and SRI
# (spec/architecture.md, Supply chain). See
# static/vendor/alpinejs-csp/<version>/SOURCE.txt for provenance.
ALPINE_VERSION = "3.15.12"
ALPINE_SRI = "sha384-MKLWq9B+VC0W3U8kDIBEsSu8uCnQ1B0UQpRaB+F7uR5ocXFbymMUKuLRntu5LLdu"

# There is deliberately no Holdings entry: the dashboard's own table
# *is* the list of holdings. And no Admin entry in any state, because
# administering the instance is done from a separate account with no
# vault, so a vault owner has nowhere administrative to go.
# In-page addresses, because the vault surface is one page: the keys
# live in its memory and a page load would charge the Argon2id
# derivation again (ui/unlock.md). Both are real addresses on the
# server too, and either one typed or bookmarked lands here.
NAV_ENTRIES: "tuple[dict, ...]" = (
    {"label": "Dashboard", "href": "#/"},
    {"label": "Settings", "href": "#/settings"},
)


def nav_entries(principal: "dict | None") -> "list[dict]":
    if principal and principal.get("kind") == "vault_owner":
        return list(NAV_ENTRIES)
    return []


def init_app(app: flask.Flask) -> None:
    app.jinja_env.globals.update(
        nav_entries=nav_entries,
        kdf_envelope=DEFAULT_KDF_ENVELOPE,
        alpine_version=ALPINE_VERSION,
        alpine_sri=ALPINE_SRI,
        argon2id_version=ARGON2ID_VERSION,
        argon2id_sri=ARGON2ID_SRI,
        zxcvbn_version=ZXCVBN_VERSION,
        zxcvbn_sri=ZXCVBN_SRI,
    )
