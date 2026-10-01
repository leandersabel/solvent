"""The request gate: the CSRF header check, authentication, and the
surface split, in that order and in one place
(spec/features/app-shell.md, The request gate).

The order is the design. A refusal's status depends only on the
namespace, the header and the session (architecture.md, Refusals), so
nothing here asks whether a path exists, which surface it is on or what
method it answers until the header and the session have been settled.
The surface check runs once, so no individual endpoint repeats it.
"""
from __future__ import annotations

import flask
from flask import abort, g, request

from . import session as sessions

HEADER_NAME = "X-Solvent-Request"
REQUIRED_VALUE = "1"

SHARED = "shared"
VAULT = "vault"
ADMINISTRATION = "administration"
UNPLACED = "unplaced"

# Every route is in exactly one group, and the group together with the
# session's kind decides whether it answers at all. Checked in order,
# most specific first, so `/api/auth/logout-all` is not caught by
# `/api/auth/logout`.
#
# The administration group is a prefix, because the role is expected to
# grow and a rule edited per new task would eventually be edited wrong.
# A rule matching nothing here is UNPLACED and answers Not Found to
# everyone, which is the safe direction to fail.
_GROUPS: "tuple[tuple[str, str, str], ...]" = (
    ("prefix", "/api/admin/", ADMINISTRATION),
    ("prefix", "/admin", ADMINISTRATION),
    ("exact", "/login", SHARED),
    ("exact", "/register", SHARED),
    ("exact", "/api/register", SHARED),
    ("exact", "/api/auth/salt", SHARED),
    ("exact", "/api/auth/login", SHARED),
    ("exact", "/api/auth/logout", SHARED),
    ("exact", "/api/auth/upgrade-kdf", SHARED),
    ("exact", "/api/auth/change-password", SHARED),
    ("exact", "/", SHARED),
    ("prefix", "/static/", SHARED),
    ("prefix", "/api/records", VAULT),
    ("prefix", "/api/accounts", VAULT),
    ("prefix", "/api/rates", VAULT),
    ("prefix", "/api/export", VAULT),
    ("prefix", "/api/import", VAULT),
    ("prefix", "/api/sessions", VAULT),
    ("prefix", "/api/auth/logout-all", VAULT),
    ("prefix", "/api/auth/account", VAULT),
    ("prefix", "/dashboard", VAULT),
    ("prefix", "/settings", VAULT),
)

_REACHES = {
    SHARED: ("vault_owner", "administrator"),
    VAULT: ("vault_owner",),
    ADMINISTRATION: ("administrator",),
    UNPLACED: (),
}


def surface_of(rule: str) -> str:
    """Which surface a URL rule belongs to. Total over any string, so
    the enumeration test can call it on every registered route."""
    for match, pattern, surface in _GROUPS:
        hit = rule == pattern if match == "exact" else rule.startswith(pattern)
        if hit:
            return surface
    return UNPLACED


def navigation(view_func):
    """Mark a view as a shell page reached by navigation.

    Served without a session, so a vault page can render its own
    sign-in card. Applied to each such view by name, never by path
    pattern, so a page added later is refused until it is marked.
    """
    view_func.navigation = True
    return view_func


def public(view_func):
    """Mark a view as reachable without a session.

    Only the routes that exist to *get* a session, plus the two pages
    that carry them. Everything else is Unauthorized without one.
    """
    view_func.public = True
    return view_func


# Flask registers this endpoint itself, so it cannot carry the
# decorator above. Every signed-out page loads its files.
_FRAMEWORK_PUBLIC = frozenset({"static"})


def _flag(app: flask.Flask, endpoint: str, name: str) -> bool:
    if name == "public" and endpoint in _FRAMEWORK_PUBLIC:
        return True
    return bool(getattr(app.view_functions.get(endpoint), name, False))


def init_app(app: flask.Flask) -> None:
    @app.before_request
    def gate() -> None:
        path = request.environ["PATH_INFO"]
        api = path.startswith("/api/")

        # 1. No API route is exempt, so this needs no routing: an
        # unmatched path gets the same Forbidden as a real one.
        if api and request.headers.get(HEADER_NAME) != REQUIRED_VALUE:
            abort(403)

        # 2.
        signed_in = sessions.load_into_g()

        # The router strips a leading run of slashes and matches what is
        # left, so `//admin` resolves. It is an invented address.
        endpoint = None if path.startswith("//") else request.endpoint
        public_route = endpoint is not None and _flag(app, endpoint, "public")

        # 3.
        if api and not signed_in and not public_route:
            abort(401)

        # 4. No route, a method it does not answer, or an address the
        # router would redirect.
        if endpoint is None:
            abort(404)

        # 5. A vault page renders its own sign-in card, so the one
        # derivation that buys a session also buys the keys. The admin
        # area is not one: it answers a caller with no session as an
        # unknown path does.
        if not signed_in:
            if public_route:
                return
            if _flag(app, endpoint, "navigation") and surface_of(str(request.url_rule)) != ADMINISTRATION:
                return
            abort(404)

        sessions.touch()

        # 6.
        if g.principal["kind"] not in _REACHES[surface_of(str(request.url_rule))]:
            abort(404)
