# Solvent

Spec-first. A high-level spec says what the product is, a design
shows it, and the low-level spec and the code are derived from both.

## The pipeline

The client writes vague. Each stage narrows it, and only one agent
talks to the client.

| Stage | Agent | Owns |
|---|---|---|
| High-level spec | `product-owner` | `spec/product/*.md` |
| | `architect` | `spec/architecture.md`, `security/` |
| Design | `designer` | the design canvas, `spec/design/` |
| Low-level spec | `architect` | `spec/features/*.md` |
| | `designer` | `spec/ui/*.md`, the design system |
| | `compiler` | `spec/.compiled/*.json`, `spec/status.md` |
| Code | `engineer` | application code and its tests |
| | `reviewer` | findings against the contract |
| | `release` | `Dockerfile`, a running instance |
| | `qa` | findings against the client's intent, back to `product-owner` |

The architecture comes before the design because it sets what a screen
may use at all, such as which assets a page can load.

The gate is after the design. The client approves `spec/product/`, the
architecture and the canvas. From the low-level spec onward the
pipeline runs to a deployed URL and a findings report.

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
- `spec/design/` holds the design canvas: one artboard per screen,
  drawn in Claude Design at
  https://claude.ai/artifact/NFxzA1ngFuYB53FHnMizn3 and mirrored here
  file for file, with `canvas.json` naming each artboard. **The canvas
  is how the product looks.** A change to how anything looks is made on
  the canvas first, and the low-level spec and the code follow it.
  Edits made on the live canvas are copied back here before anything
  is derived from them.
- `spec/ui/*.md` holds one file per screen, plus the design system:
  what a drawing cannot carry. Every state a screen must handle, the
  exact copy, what each control does, and the tokens and contrast
  floors. Layout and styling are read off the canvas, not restated.

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

## Naming and voice

**The thing somebody owns money in is a "holding" in anything a person
reads, and `account` in every identifier.** "Account" now means a login
identity, because an administrator account and a user account are
different kinds of account. Using the same word for a bank account is a
real ambiguity, and the product is client-facing, so the client-facing
word gives way. The record type stays `account`, the column stays
`account_id`, the AAD's first field stays `account_id`, and endpoint
paths stay as they are. Where prose names the record type, "the
`account` record" is right. A screen keeps the name it has, even where
that name and its subject now differ.

`spec/product/*.md` addresses the client as **you**. `spec/features/`
and `spec/ui/` are written for a builder and stay third person.

A product file's **"Decisions taken on your behalf"** section holds what
the client never said and may overrule. That is what the heading means,
so no file restates it in a preamble.

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
