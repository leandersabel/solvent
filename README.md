# Solvent

A self-hosted net worth tracker with an end-to-end encrypted vault. The
server only ever stores ciphertext; balances are decrypted in the browser
with a key derived from your password.

**Status: specified, not yet implemented.**

## Stack

Flask + Jinja2 + htmx for the app shell, vanilla JS / Alpine.js for the
client-side crypto and rendering, SQLite for storage. Deployed as a
container.

## Layout

- `spec/` — the design: architecture, features, screens. Human-edited.
- `spec/.compiled/` — per-feature implementation contracts, agent-generated.
- `.claude/agents/` — the agents that compile, implement, and review.

## Workflow

1. Edit `spec/architecture.md`, `spec/features/*.md`, or `spec/ui/*.md`.
2. Run the product-owner agent to recompile into `spec/.compiled/`.
3. Resolve anything logged in `spec/questions.md`.
4. Run the engineer agent against a compiled contract.
5. Run the reviewer agent on the result and resolve its findings.

---

Built with [Claude Code](https://claude.com/claude-code).
