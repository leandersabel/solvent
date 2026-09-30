# Solvent

A self-hosted net worth tracker with an end-to-end encrypted vault. The
server stores only ciphertext. Balances are decrypted in the browser
with a key derived from your password.

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

The first account is created out of band, because registration needs
an invite and invites need an administrator:

```
.venv/bin/python -m flask --app app create-invite --kind administrator
```

It prints a path to open in the browser. From there an administrator
invites everybody else.

Tests: `.venv/bin/python -m pytest`. The suite covers the server, the
client-side rules that two implementations would drift on, and the
workflows end to end in a real browser. The last two need Node, and
the browser tests also need Chrome. Each is skipped where what it needs
is absent.

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

## Layout and workflow

`CLAUDE.md` holds the spec layers, the agent pipeline in
`.claude/agents/`, and the loop that turns an issue into a release.

---

Built with [Claude Code](https://claude.com/claude-code).
