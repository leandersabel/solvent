# Solvent

Spec-first: `spec/` is the design, everything else compiles from it.

## Writing the spec

**Document the target state, never the route to it.**

- Record a change by rewriting the statement it changes, not by
  appending what it replaced. An idea that was never built appears
  nowhere.
- Rationale stays, history goes. "X, because Y" belongs; "X, which
  replaced W" does not.
- Keep rejected *external* options — providers, libraries — with the
  reason they fail; they constrain future choices. Our own discarded
  drafts are not the same thing.
- Negative rules are target state and belong: "there is no separate
  rate-symbol field, because two fields could disagree."
- One fact, one home. If a rule appears twice, the second is a pointer.
- No dates, no "owner's call", no "resolved".

## Tracking files

- `spec/status.md` — state only: compiled, implemented, verified.
- `spec/questions.md` — open questions, plus a one-line index of
  decisions and the file stating each. Reasoning lives in that file.
