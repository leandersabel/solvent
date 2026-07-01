# Solvent

A net worth tracker, built spec-first.

## How this repo works

- `spec/` is human-edited. This is where the application is designed — architecture, features, UI, agent roles. Edit these files directly.
- `spec/.compiled/` is agent-generated. The `product-owner` agent reads `spec/` and compiles it into strict per-feature task contracts that worker agents implement against. Never hand-edit files in here — edit the source in `spec/` and recompile.
- `spec/status.md` tracks what's been compiled and implemented vs. what the spec currently says.
- `spec/questions.md` holds open questions the product-owner agent couldn't resolve from the spec alone — answer these by editing the relevant spec file, then recompile.
- `.claude/agents/` defines the agents themselves (product-owner plus implementation roles), in Claude Code's native subagent format.

## Workflow

1. Edit `spec/architecture.md`, `spec/features/*.md`, or `spec/ui/*.md`.
2. Run the product-owner agent to recompile the spec into `spec/.compiled/`.
3. Resolve anything logged in `spec/questions.md`.
4. Dispatch implementation agents against the compiled contracts.
