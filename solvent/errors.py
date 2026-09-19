"""The unhandled-failure path (spec/architecture.md, Status codes).

Registering a handler for the base `Exception` means Flask finds it
before consulting `PROPAGATE_EXCEPTIONS`/`TESTING`/`DEBUG`, so a 500
always goes through the normal response path and carries CSP/HSTS
whatever those are set to.
"""
from __future__ import annotations

import flask
from werkzeug.exceptions import HTTPException


def init_app(app: flask.Flask) -> None:
    @app.errorhandler(Exception)
    def handle_unhandled_error(error: Exception):
        # A handler for `Exception` also catches HTTPException, so a
        # deliberate abort(403)/abort(401)/abort(404) would otherwise
        # answer 500. Hand those back for Flask's own rendering, which
        # still runs after_request and so still carries the headers.
        if isinstance(error, HTTPException):
            return error

        # No secret reaches a log line or an error page (app-shell.md,
        # Configuration): the operator gets the traceback, the caller
        # gets none of it.
        app.logger.exception("unhandled error")
        return "Internal Server Error", 500
