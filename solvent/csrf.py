"""CSRF header enforcement, ahead of authentication
(spec/features/app-shell.md, CSRF; spec/architecture.md,
Application hardening).

A request to a route that is not named exempt must carry
`X-Solvent-Request: 1` or it is rejected with Forbidden. The check runs
before the session is looked up and before routing, so the response is
identical whether the session is valid, expired or absent, and whether
or not the path exists.
"""
from __future__ import annotations

import flask
from flask import abort, request

from . import session as shell_session

HEADER_NAME = "X-Solvent-Request"
REQUIRED_VALUE = "1"

# Flask registers this endpoint itself, so it cannot carry the decorator
# below. It is still one named endpoint rather than a path pattern, and
# it must be exempt because no browser attaches a custom header to a
# subresource request (app-shell.md, CSRF).
_FRAMEWORK_EXEMPT_ENDPOINTS = frozenset({"static"})


def csrf_exempt(view_func):
    """Mark a view as one of the named, navigation-reached shell pages.

    An exemption is a named route, never a path pattern (app-shell.md,
    CSRF): apply this decorator directly to each exempt view. A new
    endpoint registered under an existing prefix -- even the same
    blueprint -- inherits nothing from it.
    """
    view_func.csrf_exempt = True
    return view_func


def _endpoint_is_exempt(app: flask.Flask, endpoint: "str | None") -> bool:
    if endpoint is None:
        # An unmatched path is not exempt. The check runs before routing
        # (app-shell.md, CSRF), so a header-less probe gets the same
        # Forbidden whether or not the route exists and cannot map the
        # route table by comparing it against Not Found.
        return False
    if endpoint in _FRAMEWORK_EXEMPT_ENDPOINTS:
        return True
    view = app.view_functions.get(endpoint)
    return bool(getattr(view, "csrf_exempt", False))


def init_app(app: flask.Flask) -> None:
    @app.before_request
    def enforce_csrf_before_auth() -> None:
        if _endpoint_is_exempt(app, request.endpoint):
            # Still resolve a session if one is present, so the chrome
            # can render nav-by-role for a logged-in visitor -- but
            # nothing is *required* of an exempt route.
            shell_session.load_into_g()
            return

        # The header check runs before authentication is even
        # attempted, so a request missing it gets the same Forbidden
        # regardless of whether a session exists, is valid, or is
        # expired (app-shell.md, CSRF).
        if request.headers.get(HEADER_NAME) != REQUIRED_VALUE:
            abort(403)

        if not shell_session.load_into_g():
            abort(401)
