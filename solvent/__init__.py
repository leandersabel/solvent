"""Solvent's Flask application factory.

One app wraps every feature (spec/features/app-shell.md): the response
headers on every response, the request gate that checks the CSRF header
before authentication and the surface before any handler, the SQLite
bootstrap, and the authenticated chrome every screen sits inside.
"""
from __future__ import annotations

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
        SECRET_KEY=config.secret_key,
        DATABASE_PATH=config.database_path,
        HSTS_PRELOAD=config.hsts_preload,
        HSTS_MAX_AGE=config.hsts_max_age,
        LOGIN_ATTEMPTS_PER_ACCOUNT=config.login_attempts_per_account,
        LOGIN_ACCOUNT_WINDOW_MINUTES=config.login_account_window_minutes,
        LOGIN_LOCKOUT_THRESHOLD=config.login_lockout_threshold,
        LOGIN_LOCKOUT_WINDOW_MINUTES=config.login_lockout_window_minutes,
        LOGIN_LOCKOUT_MINUTES=config.login_lockout_minutes,
        LOGIN_REQUESTS_PER_IP_HOUR=config.login_requests_per_ip_hour,
        VERIFY_CONCURRENCY=config.verify_concurrency,
        RATE_REQUESTS_PER_HOUR=config.rate_requests_per_hour,
        RATE_BREAKER_FAILURES=config.rate_breaker_failures,
        RATE_BREAKER_COOLOFF_MINUTES=config.rate_breaker_cooloff_minutes,
        EXPORTS_PER_USER_HOUR=config.exports_per_user_hour,
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
