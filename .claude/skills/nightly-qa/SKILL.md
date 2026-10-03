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
2. **Run `qa`** in the foreground, and wait for its report. Hand it the address, the invite path (opening it
   creates the first administrator, from whom it invites whatever
   accounts it needs), and the features to walk in full. It walks every
   other feature's main path once.
3. **File each finding.** Look for an open issue labeled `qa` that
   reports the same thing. If there is one, comment
   `Still failing in the <date> build.` on it. Otherwise open an issue
   labeled `bug`, `qa`, `accepted` and the finding's rating
   (`CLAUDE.md`, The loop, Severity), creating the label with
   `gh label create` if the repository lacks it. It is in English: the
   title says what is wrong for a user, ending in ` (seen once)` when
   `qa` could not reproduce it, and the body gives the steps, what the
   product spec expects with a pointer to the criterion, and what
   happened.
4. **File what could not be checked.** Only a criterion on the
   feature's "What must be true" list in `spec/product/<feature>.md`
   counts, and nothing else `qa` names is filed. For each one `qa`
   could not check, look in `tests/` yourself for a test that asserts
   it. The suite passed on this commit before `qa` ran, so a criterion
   such a test asserts counts as checked. Each feature with criteria
   left gets an issue titled `QA could not check <feature>`, labeled
   `bug`, `qa` and `accepted` without a rating, whose body lists each
   criterion, why `qa` could not check it, and that no test asserts it.
   If one is open, comment `Still not checkable in the <date> build.`
   with the criteria that changed since.
5. **Keep what could not be filed.** When filing fails, write the issue
   to `qa-unfiled/<n>.json` as `{"title": ..., "body": ..., "labels":
   [...]}`, and go on. The workflow files it.
6. **Finish.** Write `qa-done.txt` in the working directory last. Its
   absence tells the workflow QA did not finish.

Never fix anything, and never touch a pull request.
