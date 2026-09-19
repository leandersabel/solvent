"""The bootstrap command (spec/features/admin-invites.md, Bootstrap).

Registration needs an invite and invites need an administrator, so the
first account on a fresh instance is created out of band. The command
creates an invite and never an account, which is what keeps every
credential in the product derived in a browser: there is no path by
which an account exists whose Argon2id ran server-side.
"""
from __future__ import annotations

import sys

import click
import flask

from .admin import BOOTSTRAP_CREATOR, mint_invite
from .db import write_transaction


def init_app(app: flask.Flask) -> None:
    app.cli.add_command(create_invite)


@click.command("create-invite")
@click.option(
    "--kind",
    type=click.Choice(["administrator", "vault-owner"]),
    required=True,
    help="The kind of account this invite creates.",
)
@click.option("--expires-days", type=click.IntRange(1, 30), default=1)
@click.option("--label", default="")
@click.option(
    "--force",
    is_flag=True,
    help="Proceed although an administrator account already exists.",
)
def create_invite(kind: str, expires_days: int, label: str, force: bool) -> None:
    """Print an invite URL and exit.

    `--force` is required whenever an administrator already exists,
    because an instance with one has the admin area for this and the
    CLI is bypassing it, while an instance with vault owners and no
    administrator is exactly the state this command exists to repair.

    It does not refuse outright. The only actor who can run it already
    holds the SQLite file, the SECRET_KEY, and the ability to modify
    the served JavaScript, which the threat model states outright is
    not defended against. A hard block would stop someone who has
    already won, at the cost of the only recovery path in the product.
    """
    stored_kind = "administrator" if kind == "administrator" else "vault_owner"

    with write_transaction() as conn:
        counts = {
            row["kind"]: row["n"]
            for row in conn.execute(
                "SELECT kind, COUNT(*) AS n FROM principals GROUP BY kind"
            ).fetchall()
        }
        if counts.get("administrator", 0) and not force:
            click.echo(
                "An administrator account already exists on this instance.\n"
                f"  administrators: {counts.get('administrator', 0)}\n"
                f"  vault owners:   {counts.get('vault_owner', 0)}\n"
                f"About to create: an invite for a {stored_kind} account.\n"
                "Re-run with --force to proceed.",
                err=True,
            )
            sys.exit(1)

        invite = mint_invite(conn, stored_kind, expires_days, label, BOOTSTRAP_CREATOR)

    click.echo(f"/register?invite={invite['token']}")
