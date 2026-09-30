"""Solvent's Flask application factory.

One app wraps every feature (spec/features/app-shell.md): the response
headers on every response, the request gate that checks the CSRF header
before authentication and the surface before any handler, the SQLite
bootstrap, and the authenticated chrome every screen sits inside.
"""
from __future__ import annotations

import dataclasses

import flask

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


def create_app(config_overrides: dict | None = None) -> flask.Flask:
    app = flask.Flask(__name__, instance_relative_config=True)

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

    headers.init_app(app)
    guard.init_app(app)
    errors.init_app(app)
    shell.init_app(app)
    cli.init_app(app)

    for blueprint in BLUEPRINTS:
        app.register_blueprint(blueprint)

    return app
