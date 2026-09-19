# Solvent

Spec-first: `spec/` is the design, everything else compiles from it.

## The pipeline

The client writes vague. Each agent narrows it, and only one of them
talks to the client.

| Agent | Owns | Hands to |
|---|---|---|
| `product-owner` | `spec/product/*.md` | architect |
| `architect` | `spec/architecture.md`, `spec/features/*.md`, `security/` | designer |
| `designer` | `spec/ui/*.md`, the design system | compiler |
| `compiler` | `spec/.compiled/*.json`, `spec/status.md` | engineer |
| `engineer` | application code and its tests | reviewer |
| `reviewer` | findings against the contract | release |
| `release` | `Dockerfile`, a running instance | qa |
| `qa` | findings against the client's intent | product-owner |

The gate is after the spec. The client approves `spec/product/` and the
architecture; from the compiler onward the pipeline runs to a deployed
URL and a findings report.

## Who asks the client

Only `product-owner`, and only in the client's terms. Every other agent
writes its question to `spec/questions.md` tagged with its own name.
The product owner translates the ones that turn on the client's risk
tolerance, money or taste, and decides the rest are not the client's to
answer.

A question that cannot be put without technical vocabulary belongs to
the architect, who decides it and writes the reason into the spec.

## The spec layers

- `spec/product/*.md` holds what the client asked for, in their words.
  Screens as a person sees them, and a "What must be true" list
  observable from outside by someone who cannot read code. No status
  codes, no columns, no libraries.
- `spec/features/*.md` holds the technical derivation. Row shapes,
  endpoints, byte encodings, and a technical acceptance list a test can
  assert.
- `spec/ui/*.md` holds one file per screen, plus the design system:
  what is on the screen, in what arrangement, and every state it must
  handle.

`spec/architecture.md` sits above all three and holds what is true
system-wide. The same subject at two altitudes is the design, not
duplication.

Some features have no product file, because the client never asked for
them and nothing about them is visible from outside: the record store
and the client-side crypto layer. The architect creates those and names
which product features need them.

A feature the client cannot see is not the same as a feature with no
screen. The app shell has no screen of its own, but the chrome it
renders is where "looks like a private bank" is cashed out, so it has a
product file like any other.

## Writing the spec

**Document the target state, never the route to it.**

- Record a change by rewriting the statement it changes, not by
  appending what it replaced. An idea that was never built appears
  nowhere.
- Rationale stays, history goes. "X, because Y" belongs; "X, which
  replaced W" does not.
- Keep rejected *external* options, providers and libraries, with the
  reason they fail. They constrain future choices. Our own discarded
  drafts are not the same thing.
- Negative rules are target state and belong: "there is no separate
  rate-symbol field, because two fields could disagree."
- One fact, one home. If a rule appears twice, the second is a pointer.
- No counts in prose. A number of rows, screens or providers is true
  for one edit and wrong by the next.
- No dates, no "owner's call", no "resolved".

## Tracking files

- `spec/status.md` — state only: compiled, implemented, verified.
- `spec/questions.md` — open questions only, each tagged with the agent
  that asked. A decision is found in the file that states it.
