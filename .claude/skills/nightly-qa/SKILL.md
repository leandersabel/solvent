---
name: nightly-qa
description: Test tonight's build against the client's acceptance lists and file what fails. Run by .github/workflows/nightly.yml with the app's address, a first-administrator invite path and the last version's tag.
---

# Nightly QA

The arguments are `<url> <invite path> <last tag>`. `CLAUDE.md`, The
loop, Nightly and stable, is the contract this keeps. GitHub is reached
with `gh`, and you write as `claude[bot]`.

1. **Choose what to walk in full.** A feature is walked in full when
   its `spec/product/` or `spec/features/` file changed since the last
   tag, or when an issue closed since then names it. Read the closed
   issues' titles and bodies for that, and nothing else about them.
   With no last tag, walk every feature in full.
2. **Run `qa`.** Hand it the address, the invite path (opening it
   creates the first administrator, from whom it invites whatever
   accounts it needs), and the features to walk in full. It walks every
   other feature's main path once.
3. **File each finding.** Look for an open issue labeled `qa` that
   reports the same thing. If there is one, comment
   `Still failing in the <date> build.` on it. Otherwise open an issue
   labeled `bug` and `qa`, in English: the title says what is wrong for
   a user, and the body gives the steps, what the product spec expects
   with a pointer to the criterion, and what happened.
4. **Record the verdict.** Write `PASS` or `FAIL` to `qa-verdict.txt`
   in the working directory. `FAIL` when any finding was filed or
   commented, `PASS` otherwise.

Never fix anything, never add `accepted`, and never touch a pull
request.
