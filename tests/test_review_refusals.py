"""Reviewer's independent tests for issue #14, written from
spec/features/app-shell.md and admin-invites.md, blind to the gate.

The gate is modelled here from the spec alone (the request gate's
order, the refusal table, the Public routes and the surface groups) and
every request the model says is refused is sent and fingerprinted.
"""
from __future__ import annotations

import uuid
from collections import defaultdict

import pytest

from tests.helpers import CSRF, connect, register

PUBLIC = {
    ("GET", "/login"), ("GET", "/register"), ("POST", "/api/register"),
    ("POST", "/api/auth/salt"), ("POST", "/api/auth/login"),
    ("POST", "/api/auth/logout"), ("GET", "/"),
}
SHARED = {"/api/auth/upgrade-kdf", "/api/auth/change-password"}
ARGS = {"account_id": str(uuid.uuid4()), "record_id": str(uuid.uuid4()),
        "username": "nobody", "invite_id": uuid.uuid4().hex, "symbol": "XYZ",
        "filename": "icon.png"}


def concrete(rule):
    path = rule.rule
    for name in rule.arguments:
        path = path.replace(f"<{name}>", ARGS[name]).replace(f"<path:{name}>", ARGS[name])
    return path


def group(rule):
    if rule.endpoint == "static":
        return "public"
    if rule.rule == "/admin" or rule.rule.startswith("/api/admin/"):
        return "admin"
    if rule.rule in SHARED:
        return "shared"
    return "vault"


def is_public(method, rule):
    m = "GET" if method == "HEAD" else method
    return rule.endpoint == "static" or (m, rule.rule) in PUBLIC


def expected(method, path, rule, header, kind):
    """The status the contract's gate gives, or None if it is served.
    kind is None for no valid session (absent or expired)."""
    api = path.startswith("/api/")
    if api and not header:
        return 403
    if api and kind is None and not (rule and is_public(method, rule)):
        return 401
    if rule is None or method not in rule.methods:
        return 404
    if kind is None and not api:
        if is_public(method, rule):
            return None
        return None if group(rule) == "vault" else 404
    g = "public" if is_public(method, rule) else group(rule)
    if g in ("public", "shared"):
        return None
    if (g == "admin") != (kind == "administrator"):
        return 404
    return None


@pytest.fixture
def sessions(app):
    owner, _ = register(app, "owner")
    admin, _ = register(app, "root", kind="administrator")
    stale, _ = register(app, "stale")
    conn = connect(app)
    conn.execute(
        "UPDATE sessions SET issued_at = '2000-01-01T00:00:00+00:00' WHERE principal_id = "
        "(SELECT id FROM principals WHERE username = 'stale')"
    )
    conn.commit()
    conn.close()
    return {"absent": (app.test_client(), None), "expired": (stale, None),
            "vault_owner": (owner, "vault_owner"), "administrator": (admin, "administrator")}


METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]


def probes(app):
    """Every route under every method, answered or not, plus the fixed
    probes. The third item is the rule answering that method, or None."""
    rules = list(app.url_map.iter_rules())
    out = []
    for path in sorted({concrete(r) for r in rules}):
        siblings = [r for r in rules if concrete(r) == path]
        for m in METHODS:
            out.append((m, path, next((r for r in siblings if m in r.methods), None)))
    for path in ["/invented", "//admin", "/api/invented", "/api/admin/invented",
                 "/favicon.ico", "//api/records", "/admin/", "/settings/",
                 "/static/missing.png"]:
        for m in METHODS:
            out.append((m, path, None))
    return out


def fingerprint(resp):
    headers = tuple(sorted((k, v) for k, v in resp.headers.items() if k != "Date"))
    return headers, resp.get_data()


def test_refusal_fingerprint_matrix(app, sessions):
    by_status = defaultdict(lambda: defaultdict(list))
    bad = []
    for state, (client, kind) in sessions.items():
        for header in (False, True):
            for method, path, rule in probes(app):
                want = expected(method, path, rule, header, kind)
                if want is None:
                    continue
                resp = client.open(path, method=method, headers=CSRF if header else {})
                if resp.status_code != want:
                    bad.append((state, header, method, path, want, resp.status_code))
                    continue
                ns = "api" if path.startswith("/api/") else "page"
                by_status[(want, method == "HEAD")][fingerprint(resp)].append(
                    (state, header, method, path, ns))
    assert not bad, "\n".join(map(str, bad))
    # Report the distinct fingerprints per status, grouped by namespace
    detail = []
    for key, prints in by_status.items():
        if len(prints) > 1:
            for fp, who in prints.items():
                detail.append((key, sorted({w[4] for w in who}), who[:3], dict(fp[0]), fp[1][:80]))
    assert not detail, "\n".join(map(str, detail))


def test_refusals_carry_no_route_headers(app, sessions):
    forbidden = {"Set-Cookie", "Allow", "Location", "Cache-Control", "Referrer-Policy",
                 "Access-Control-Allow-Origin"}
    hits = []
    for state, (client, kind) in sessions.items():
        for header in (False, True):
            for path in ["/admin", "/register/", "//admin", "/api/admin/invites",
                         "/api/auth/logout", "/api/auth/login", "/favicon.ico", "/dashboard/"]:
                for m in METHODS:
                    resp = client.open(path, method=m, headers=CSRF if header else {})
                    if resp.status_code in (401, 403, 404, 405) or 300 <= resp.status_code < 400:
                        extra = forbidden & set(resp.headers.keys())
                        if extra or resp.status_code == 405:
                            hits.append((state, header, m, path, resp.status_code, extra))
    assert not hits, "\n".join(map(str, hits))


def test_namespace_invariant_over_route_map(app):
    for rule in app.url_map.iter_rules():
        assert "OPTIONS" not in rule.methods, rule
        if not rule.rule.startswith("/api/"):
            assert rule.methods <= {"GET", "HEAD"}, rule


def test_every_non_get_route_requires_header_and_changes_nothing(app, sessions):
    """csrfScope: every state-changing endpoint needs the header. With a
    valid session of the reaching kind and no header, it is Forbidden."""
    conn = connect(app)
    before = {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
              for t in ("principals", "sessions", "invites", "records")}
    conn.close()
    for client, kind in (sessions["vault_owner"], sessions["administrator"]):
        for rule in app.url_map.iter_rules():
            for m in rule.methods - {"GET", "HEAD"}:
                resp = client.open(concrete(rule), method=m, json={"kind": "vault_owner",
                                   "expiresInDays": 7, "label": "x", "confirmUsername": "nobody"})
                assert resp.status_code == 403, (kind, m, rule.rule, resp.status_code)
    conn = connect(app)
    after = {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in before}
    conn.close()
    assert before == after
    # sessions still alive
    assert sessions["vault_owner"][0].get("/api/sessions", headers=CSRF).status_code == 200


def test_get_api_export_without_header_is_forbidden(owner):
    assert owner.get("/api/export").status_code == 403


def test_navigation_pages_load_without_header(app, sessions):
    owner, _ = sessions["vault_owner"]
    admin, _ = sessions["administrator"]
    assert owner.get("/dashboard").status_code == 200
    assert admin.get("/admin").status_code == 200
    assert app.test_client().get("/login").status_code == 200
    assert app.test_client().get("/static/icon.png").status_code == 200


def test_unknown_username_delete_matches_invented_api_path(app, sessions):
    admin, _ = sessions["administrator"]
    a = admin.delete("/api/admin/accounts/nobody", json={"confirmUsername": "nobody"}, headers=CSRF)
    b = admin.open("/api/admin/invented", method="DELETE", json={"confirmUsername": "nobody"}, headers=CSRF)
    assert a.status_code == b.status_code == 404
    assert fingerprint(a) == fingerprint(b)
