"""Solvent's Flask application factory.

One app wraps every feature (spec/features/app-shell.md): response
headers on every response, the CSRF header check ahead of
authentication, the SQLite bootstrap, and the authenticated chrome
(spec/ui/design-system.md, App shell) every screen sits inside.
"""
from __future__ import annotations

import flask

from . import csrf, db, errors, headers, shell
from .config import load_config


def create_app(config_overrides: dict | None = None) -> flask.Flask:
    app = flask.Flask(__name__, instance_relative_config=True)

    # Let this raise straight out of create_app so a misconfigured
    # deployment never serves a request (app-shell.md, Configuration).
    config = load_config()
    app.config["SECRET_KEY"] = config.secret_key
    app.config["DATABASE_PATH"] = config.database_path
    app.config["HSTS_PRELOAD"] = config.hsts_preload
    app.config["HSTS_MAX_AGE"] = config.hsts_max_age

    if config_overrides:
        app.config.update(config_overrides)

    db.init_app(app)
    db.init_db(app)

    headers.init_app(app)
    csrf.init_app(app)
    errors.init_app(app)
    shell.init_app(app)

    return app
