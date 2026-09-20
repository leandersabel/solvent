"""The server-rendered shell pages (spec/features/app-shell.md).

Each one is an empty content region the client-side data layer fills
after it has a key: the server has no plaintext to render, so a
screen's content is never server-rendered from vault data.
"""
from __future__ import annotations

from flask import Blueprint, g, redirect, render_template

from .guard import navigation, public

bp = Blueprint("pages", __name__)


@bp.get("/")
@navigation
@public
def root():
    """The only route that resolves to different content per kind, and
    it does so because a bookmark of the bare host has to work for
    both.

    With no session there is no kind to resolve by, so it hands the
    visitor to the dashboard, which carries the sign-in card and sends
    an administrator on once it knows which they are.
    """
    if not g.get("principal"):
        return redirect("/dashboard")
    if g.principal["kind"] == "administrator":
        return redirect("/admin")
    return redirect("/dashboard")


@bp.get("/login")
@navigation
@public
def login_page():
    """One sign-in screen at one address, for both kinds. There is no
    administrator login page and no kind selector: the screen looks and
    behaves identically until a correct password has been supplied."""
    if g.get("principal"):
        return redirect("/")
    return render_template("login.html")


@bp.get("/dashboard")
@navigation
def dashboard():
    return render_template("dashboard.html")


@bp.get("/settings")
@navigation
def settings():
    return render_template("settings.html")


@bp.get("/settings/dimensions")
@navigation
def dimensions():
    return render_template("dimensions.html")


@bp.get("/admin")
@navigation
def admin():
    return render_template("admin.html")
