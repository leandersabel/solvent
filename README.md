# Solvent

A net worth tracker, built spec-first.

## How this repo works

- `spec/` is human-edited. This is where the application is designed — architecture, features, UI, agent roles. Edit these files directly.
- `spec/.compiled/` is agent-generated. The `product-owner` agent reads `spec/` and compiles it into strict per-feature task contracts that worker agents implement against. Never hand-edit files in here — edit the source in `spec/` and recompile.
- `spec/status.md` tracks what's been compiled and implemented vs. what the spec currently says.
- `spec/questions.md` holds open questions the product-owner agent couldn't resolve from the spec alone — answer these by editing the relevant spec file, then recompile.
- `.claude/agents/` defines the agents themselves, in Claude Code's native subagent format: `architect` (system design and security review), `product-owner` (compiles spec into contracts), `engineer` (implements a contract), `reviewer` (checks an implementation against its contract and the security spec).

## Workflow

1. Edit `spec/architecture.md`, `spec/features/*.md`, or `spec/ui/*.md`.
2. Run the product-owner agent to recompile the spec into `spec/.compiled/`.
3. Resolve anything logged in `spec/questions.md`.
4. Run the engineer agent against a compiled contract.
5. Run the reviewer agent on the result; resolve its findings.
