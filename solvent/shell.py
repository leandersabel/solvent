"""Template context for the authenticated chrome
(spec/ui/design-system.md, App shell).

No routes of its own. Every authenticated screen is another feature's
blueprint whose templates extend `templates/shell/base.html`. What is
here is shared by all of them: the nav entries by role, and the current
default KDF envelope every server-rendered page embeds
(spec/architecture.md, Key management).
"""
from __future__ import annotations

import flask

from .config import DEFAULT_KDF_ENVELOPE

# The CSP-safe Alpine build, self-hosted with a pinned version and SRI
# (spec/architecture.md, Supply chain). See
# static/vendor/alpinejs-csp/<version>/SOURCE.txt for provenance.
ALPINE_VERSION = "3.15.12"
ALPINE_SRI = "sha384-MKLWq9B+VC0W3U8kDIBEsSu8uCnQ1B0UQpRaB+F7uR5ocXFbymMUKuLRntu5LLdu"

# There is deliberately no "Accounts" entry: the dashboard's own table
# *is* the account list (spec/ui/design-system.md, App shell).
NAV_ENTRIES: "tuple[dict, ...]" = (
    {"label": "Dashboard", "href": "/dashboard"},
    {"label": "Settings", "href": "/settings"},
)
ADMIN_NAV_ENTRY = {"label": "Admin", "href": "/admin"}


def nav_entries(user: "dict | None") -> "list[dict]":
    """Dashboard and Settings always; Admin as a third entry only for an
    admin (app-shell.md, Acceptance criteria)."""
    entries = list(NAV_ENTRIES)
    if user and user.get("is_admin"):
        entries.append(ADMIN_NAV_ENTRY)
    return entries


def init_app(app: flask.Flask) -> None:
    app.jinja_env.globals["nav_entries"] = nav_entries
    app.jinja_env.globals["kdf_envelope"] = DEFAULT_KDF_ENVELOPE
    app.jinja_env.globals["alpine_version"] = ALPINE_VERSION
    app.jinja_env.globals["alpine_sri"] = ALPINE_SRI
