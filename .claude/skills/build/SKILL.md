---
name: build
description: Build one planned issue into a pull request through the pipeline from the low-level spec onward. Followed by triage once an issue is ready to build.
---

# Build

Builds the issue triage just planned, from the technical plan in its
latest comment. Each stage is the agent `CLAUDE.md`, The pipeline,
names for it, handed what the stage before produced.

1. Branch `claude/issue-<number>` from `master`, and
   `pip install -r requirements-dev.txt`.
2. For an `enhancement`, the spec changes first. `product-owner`
   rewrites `spec/product/`, `architect` rewrites
   `spec/architecture.md` and `spec/features/`, `designer` rewrites
   `spec/ui/`, each to the target state `CLAUDE.md`, Writing the spec,
   asks for. The canvas is how the product looks and cannot be reached
   from here. When the plan changes how anything looks, stop and
   comment on the issue which artboards need the change.
3. `compiler` recompiles the contracts the change touches.
4. `engineer` implements the contract. For a `bug`, it first writes a
   test that fails on the reported behavior, then the fix.
5. `python -m pytest -q` is green before review. The browser tests
   skip where Chrome is absent, and the pull request's checks run them.
6. `reviewer` reviews the diff against the contract. Its findings go
   back to `engineer`, for at most three rounds.
7. Commit in the voice of `git log`, push, and open a pull request
   against `master`. The title says what changes for the client. The
   body starts with `Closes #<number>`, says what the client will see
   differently in the client's terms, and puts everything technical in
   a `<details>` block. It is a draft when reviewer findings remain,
   and those findings are listed in it. Otherwise turn on auto-merge
   with squash.
8. Subscribe to the pull request's activity, so a failing check brings
   the work back.

The client does not review the pull request. The client's say is the
plan on the issue, and the required checks decide the merge. Nothing
here merges directly, and a branch from here never changes `.github/`,
`.claude/` or `CLAUDE.md`, because the checks refuse it.

Comments follow triage's Writing section.
