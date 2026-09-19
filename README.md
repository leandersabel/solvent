# Solvent

A self-hosted net worth tracker with an end-to-end encrypted vault. The
server only ever stores ciphertext; balances are decrypted in the browser
with a key derived from your password.

**Status: the app shell is built and the container runs it. No screen
exists yet, so every path answers Forbidden without the
`X-Solvent-Request` header and Unauthorized with it. See
`spec/status.md` for what is next.**

## Stack

Flask + Jinja2 + htmx for the app shell, vanilla JS / Alpine.js for the
client-side crypto and rendering, SQLite for storage. Deployed as a
container.

## Run it

```
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
export SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
.venv/bin/python -m flask --app app run
```

The app refuses to start without `SECRET_KEY` (spec/features/app-shell.md,
Configuration). `DATABASE_PATH` defaults to `instance/solvent.db`, which
is created on first start.

Tests: `.venv/bin/python -m pytest`.

## Build it

The image is what deploys (spec/architecture.md, Tech stack). It runs as
a non-root user on a read-only root filesystem, with `/data` as the only
writable path.

```
docker build -t solvent .
docker run --rm -p 8000:8000 \
  -e SECRET_KEY="$SECRET_KEY" \
  -v solvent-data:/data \
  --read-only --tmpfs /dev/shm:size=64m \
  --cap-drop ALL --security-opt no-new-privileges:true \
  solvent
```

## Layout

- `spec/product/` — what the client asked for, in their words.
- `spec/` — the technical design: architecture, features, screens.
- `spec/.compiled/` — per-feature implementation contracts.
- `security/` — design-review reports.
- `.claude/agents/` — the pipeline that specifies, builds, reviews,
  deploys and tests.

## Workflow

A chain of agents turns what the client asks for into a deployed URL:
product spec, architecture, screens, contracts, code, review, image,
and a test pass against the client's own acceptance list. The client
approves the product spec and the architecture, and the rest runs on
its own.

See `CLAUDE.md` for who owns each step and how questions reach the
client.

---

Built with [Claude Code](https://claude.com/claude-code).
