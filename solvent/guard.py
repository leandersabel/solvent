"""The request gate: the CSRF header check, authentication, and the
surface split, in that order and in one place
(spec/features/app-shell.md, CSRF and The two surfaces).

The order is the design. The header check runs before authentication
*and before routing*, so a caller without it gets the same Forbidden
whether the session is valid, expired or absent and whether or not the
path exists. The surface check runs immediately after authentication,
once, so no individual endpoint repeats it.
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
    """Mark a view as a shell page reached by navigation, exempt from
    the CSRF header.

    An exemption is a named route, never a path pattern: apply this
    directly to each exempt view, so an endpoint added later under the
    same prefix inherits nothing.
    """
    view_func.csrf_exempt = True
    return view_func


def public(view_func):
    """Mark a view as reachable without a session.

    Only the routes that exist to *get* a session, plus the two pages
    that carry them. Everything else is Unauthorized without one.
    """
    view_func.public = True
    return view_func


# Flask registers this endpoint itself, so it cannot carry the
# decorators above. It is still one named endpoint rather than a path
# pattern, and it must be exempt because no browser attaches a custom
# header to a subresource request.
_FRAMEWORK_EXEMPT = frozenset({"static"})


def _flag(app: flask.Flask, endpoint: "str | None", name: str) -> bool:
    if endpoint is None:
        return False
    if endpoint in _FRAMEWORK_EXEMPT:
        return True
    return bool(getattr(app.view_functions.get(endpoint), name, False))


def init_app(app: flask.Flask) -> None:
    @app.before_request
    def gate() -> None:
        endpoint = request.endpoint

        # Before routing: an unmatched path is not exempt, so a
        # header-less probe cannot map the route table by comparing
        # Forbidden against Not Found.
        if not _flag(app, endpoint, "csrf_exempt"):
            if request.headers.get(HEADER_NAME) != REQUIRED_VALUE:
                abort(403)

        # Past the header, an unmatched path is an ordinary Not
        # Found rather than an Unauthorized, so it reads the same to a
        # caller with a session and one without.
        if endpoint is None:
            abort(404)

        if not sessions.load_into_g():
            if _flag(app, endpoint, "public"):
                return
            abort(401)

        sessions.touch()

        if g.principal["kind"] not in _REACHES[surface_of(str(request.url_rule))]:
            abort(404)
