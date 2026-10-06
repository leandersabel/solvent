"""gunicorn's config for the image (`--config python:solvent.server`):
Solvent's own answer to a request gunicorn cannot read or fails on
before Flask sees it (spec/features/app-shell.md, Error pages).

gunicorn answers those with its own page, which names the failure and
carries none of the app's headers, and no setting changes it. Each
worker's error handler is replaced once the app has loaded, so the
worker class stays gunicorn's `gthread` (architecture.md, WSGI server).
"""
from __future__ import annotations

from gunicorn import util
from gunicorn.http.errors import ParseException

from .errors import page_bytes
from .headers import security_headers


def _answer(app, status: str, code: int) -> bytes:
    body = page_bytes(app, code)
    head = {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": str(len(body)),
        "Connection": "close",
        **security_headers(app.config),
    }
    lines = [f"HTTP/1.1 {status}", *(f"{name}: {value}" for name, value in head.items())]
    return ("\r\n".join(lines) + "\r\n\r\n").encode("latin-1") + body


def post_worker_init(worker) -> None:
    unreadable = _answer(worker.wsgi, "400 Bad Request", 404)
    failure = _answer(worker.wsgi, "500 Internal Server Error", 500)

    def handle_error(req, client, addr, exc) -> None:
        # gunicorn's handler logs the peer's address and the full URI,
        # which can hold an invite token (architecture.md, Storage &
        # data handling). A request it cannot read is the caller's
        # fault and logs nothing, and anything else only its class.
        if isinstance(exc, ParseException):
            answer = unreadable
        else:
            worker.log.error("Error handling request: %s", type(exc).__name__)
            answer = failure
        try:
            util.write_nonblock(client, answer)
        except OSError:
            pass

    worker.handle_error = handle_error
