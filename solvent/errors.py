"""The unhandled-failure path (spec/architecture.md, Status codes).

Registering a handler for the base `Exception` means Flask finds it
before consulting `PROPAGATE_EXCEPTIONS`/`TESTING`/`DEBUG`, so a 500
always goes through the normal response path and carries CSP/HSTS
whatever those are set to.
"""
from __future__ import annotations

import flask
from flask import render_template
from werkzeug.exceptions import HTTPException

# The page is rendered from the variant alone, so it is the same for
# every path and every session, and a refused address is
# indistinguishable from a missing one (spec/features/app-shell.md,
# Error pages).
_VARIANTS = {403: "missing", 404: "missing", 500: "failure"}


def _page(code: int):
    return render_template("error.html", variant=_VARIANTS[code]), code


def init_app(app: flask.Flask) -> None:
    @app.errorhandler(Exception)
    def handle_unhandled_error(error: Exception):
        # A handler for `Exception` also catches HTTPException, so a
        # deliberate abort(403)/abort(401)/abort(404) would otherwise
        # answer 500. Hand those back for Flask's own rendering, which
        # still runs after_request and so still carries the headers.
        if isinstance(error, HTTPException):
            if error.code in (403, 404) and error.response is None:
                return _page(error.code)
            return error

        # No secret reaches a log line or an error page (app-shell.md,
        # Configuration): the operator gets the traceback, the caller
        # gets none of it.
        app.logger.exception("unhandled error")
        return _page(500)
