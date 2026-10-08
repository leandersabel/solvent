# Solvent

A self-hosted net worth tracker with an end-to-end encrypted vault. The
server stores only ciphertext. Balances are decrypted in the browser
with a key derived from your password.

## Install

Solvent is one container, `ghcr.io/leandersabel/solvent:stable`. Serve
it over HTTPS, because the browser only runs the vault's encryption on
a secure page.

### TrueNAS

1. Datasets > Add Dataset, with the preset **Apps**.
2. Apps > Discover Apps > Custom App:
   - Image: repository `ghcr.io/leandersabel/solvent`, tag `stable`.
   - Environment Variables: `SECRET_KEY`, a long random string that
     never changes.
   - Security Context: Custom User, user and group `568`.
   - Ports: container port `8000`.
   - Storage: Host Path, the dataset, mount path `/data`.
3. Once it runs, open its Shell under Workloads and create the first
   administrator:
   ```
   flask --app app create-invite --kind administrator
   ```
   Open the path it prints. From there, the administrator invites
   everybody else.

### Docker

```
docker run -d --name solvent -p 8000:8000 \
  -e SECRET_KEY=<a long random string that never changes> \
  -v solvent-data:/data \
  --read-only --cap-drop ALL --security-opt no-new-privileges \
  ghcr.io/leandersabel/solvent:stable
docker exec solvent flask --app app create-invite --kind administrator
```

The image protects itself without `--read-only`, `--cap-drop` and
`--security-opt`, which add a layer on top. It runs as user
`10001:10001` and refuses root. Any other user works when `/data` is
writable for it.

Behind a reverse proxy, also set `TRUSTED_PROXY_HOPS` to the number of
proxies in front of Solvent.

## Develop

Flask + Jinja2 + htmx for the app shell, vanilla JS / Alpine.js for the
client-side crypto and rendering, SQLite for storage.

```
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
export SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
.venv/bin/python -m flask --app app run
.venv/bin/python -m flask --app app create-invite --kind administrator
```

The database is `instance/solvent.db`, created on first start.

Tests: `.venv/bin/python -m pytest`, which runs on every core. The
suite covers the server, the client-side rules that two implementations
would drift on, and the workflows end to end in a real browser. The last
two need Node, and the browser tests also need Chrome. Each is skipped
where what it needs is absent.

The browser tests are one part per screen under `tests/browser/parts/`,
each on a server of its own. One part alone, serially:

```
.venv/bin/python -m pytest -n 0 "tests/test_browser.py::test_the_workflows_hold_in_a_browser[unlock]"
```

The image: `docker build -t solvent .`

## Layout and workflow

`CLAUDE.md` holds the spec layers, the agent pipeline in
`.claude/agents/`, and the loop that turns an issue into a release.

---

Built with [Claude Code](https://claude.com/claude-code).
