"""Response headers carried by every response, including error responses
(spec/features/app-shell.md, Response headers; spec/architecture.md,
Application hardening, Network & transport).

Set in exactly one place -- an `after_request` hook runs for the normal
response path, for Flask's own HTTPException handling (404, 403, 401,
...), and for the generic-error path in errors.py, since all three
still go through `finalize_request` -- so a route can never opt into a
looser policy.
"""
from __future__ import annotations

import flask

# Byte-identical to spec/architecture.md, Application hardening. A
# route needing a looser policy is a design change, not a local
# override (app-shell.md, Response headers).
CSP = (
    "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; "
    "connect-src 'self'; img-src 'self'; style-src 'self'; "
    "frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
)


def init_app(app: flask.Flask) -> None:
    @app.after_request
    def set_security_headers(response: flask.Response) -> flask.Response:
        response.headers["Content-Security-Policy"] = CSP

        # No separate X-Frame-Options: frame-ancestors 'none' above is
        # the only framing control (app-shell.md, Response headers).
        hsts = f"max-age={app.config['HSTS_MAX_AGE']}; includeSubDomains"
        if app.config["HSTS_PRELOAD"]:
            # Off by default: valid only once a fixed public domain
            # has served the header stably through its probation
            # period (architecture.md, Network & transport).
            hsts += "; preload"
        response.headers["Strict-Transport-Security"] = hsts

        return response
