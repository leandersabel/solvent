"""Solvent's Flask application factory.

One app wraps every feature (spec/features/app-shell.md): the response
headers on every response, the request gate that checks the CSRF header
before authentication and the surface before any handler, the SQLite
bootstrap, and the authenticated chrome every screen sits inside.
"""
from __future__ import annotations

import dataclasses

import flask
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.routing import Map

from . import (
    admin,
    auth,
    cli,
    db,
    errors,
    guard,
    headers,
    pages,
    rates,
    ratelimit,
    records,
    register,
    shell,
    vault,
)
from .config import load_config

BLUEPRINTS = (
    pages.bp,
    auth.bp,
    register.bp,
    records.bp,
    rates.bp,
    admin.bp,
    vault.bp,
)


class _Map(Map):
    """Slashes are never merged, so the router has no redirect of its
    own to answer (app-shell.md, The request gate)."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, merge_slashes=False, **kwargs)


class _Flask(flask.Flask):
    """No route answers OPTIONS: Flask would add the method to each one
    and answer it with an Allow header, which a refusal must not carry."""

    url_map_class = _Map

    def add_url_rule(self, rule, endpoint=None, view_func=None, provide_automatic_options=None, **options):
        super().add_url_rule(rule, endpoint, view_func, provide_automatic_options=False, **options)


def create_app(config_overrides: dict | None = None) -> flask.Flask:
    app = _Flask(__name__, instance_relative_config=True)

    # Let this raise straight out of create_app so a misconfigured
    # deployment never serves a request (app-shell.md, Configuration).
    config = load_config()
    app.config.update(
        {name.upper(): value for name, value in dataclasses.asdict(config).items()},
        # The vault ships as one JSON payload per record type, and an
        # import as one payload for the whole vault, so the framework
        # cap sits above the storage quota rather than below it.
        MAX_CONTENT_LENGTH=48 * 1024 * 1024,
    )

    if config_overrides:
        app.config.update(config_overrides)

    db.init_app(app)
    db.init_db(app)

    ratelimit.init_app(app)
    if app.config["TRUSTED_PROXY_HOPS"]:
        # Only the client address is read from a header: the cookie is
        # Secure and HSTS is sent whatever the scheme, so scheme, host,
        # port and prefix stay what the connection says.
        app.wsgi_app = ProxyFix(
            app.wsgi_app,
            x_for=app.config["TRUSTED_PROXY_HOPS"],
            x_proto=0,
            x_host=0,
            x_port=0,
            x_prefix=0,
        )
    headers.init_app(app)
    guard.init_app(app)
    errors.init_app(app)
    shell.init_app(app)
    cli.init_app(app)

    for blueprint in BLUEPRINTS:
        app.register_blueprint(blueprint)

    return app
