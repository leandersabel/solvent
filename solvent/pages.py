"""The server-rendered shell pages (spec/features/app-shell.md).

Each one is an empty content region the client-side data layer fills
after it has a key: the server has no plaintext to render, so a
screen's content is never server-rendered from vault data.
"""
from __future__ import annotations

from flask import Blueprint, g, make_response, redirect, render_template

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
    if g.get("principal") and g.principal["kind"] == "administrator":
        return redirect("/admin")
    return redirect("/dashboard")


def vault_page(**context):
    """The vault shell page, served `no-store`.

    A browser must not keep it for Back once the person has left it
    (architecture.md, Application hardening). The client also locks on
    `pagehide`, which holds whatever the browser decides to keep.
    """
    response = make_response(render_template("dashboard.html", **context))
    response.headers["Cache-Control"] = "no-store"
    return response


@bp.get("/login")
@navigation
@public
def login_page():
    """One sign-in screen at one address, for both kinds. There is no
    administrator login page and no kind selector: the screen looks and
    behaves identically until a correct password has been supplied.

    It is the vault shell page in the outside frame. The Master Key and
    the DEK live in the memory of the document that derived them, so a
    sign-in that then loaded `/dashboard` would arrive with no keys and
    ask for the password a second time. The same document draws the
    vault instead, and an administrator, who has no keys to keep, is
    sent on to `/admin` once the kind is known.
    """
    if g.get("principal"):
        return redirect("/")
    return vault_page(outside=True, title="Sign in to Solvent")


@bp.get("/dashboard")
@navigation
def dashboard():
    """The vault shell page, where the keys live once it is unlocked."""
    return vault_page()


@bp.get("/settings")
@navigation
def settings():
    """A redirect rather than a page of its own.

    The vault surface is one page, because the keys live in that
    page's memory and a second page would mean deriving them again
    (ui/unlock.md). The address stays real so that a bookmark of it
    lands on the screen it names.
    """
    return redirect("/dashboard#/settings")


@bp.get("/settings/dimensions")
@navigation
def dimensions():
    return redirect("/dashboard#/settings/dimensions")


@bp.get("/settings/export-import")
@navigation
def export_import():
    return redirect("/dashboard#/settings/export-import")


@bp.get("/admin")
@navigation
def admin():
    return render_template("admin.html")
