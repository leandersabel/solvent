---
name: nightly-qa
description: Test tonight's build against the client's acceptance lists and record what fails for the workflow to file. Run by .github/workflows/nightly.yml with the app's address, a first-administrator invite path, the last version's tag and the prepared data's manifest.
---

# Nightly QA

The arguments are `<url> <invite path> <last tag> [<manifest>]`, where
`<manifest>` is the path of the prepared data's manifest. `CLAUDE.md`,
The loop, Nightly and stable, is the contract this keeps. GitHub is
read with `gh`, and you write nothing to it: you record what fails in
`qa-unfiled/`, and the workflow files it after the walk.

1. **Choose what to walk in full.** A feature is walked in full when
   its `spec/product/` or `spec/features/` file changed since the last
   tag, or when an issue closed since then names it. Read the closed
   issues' titles and bodies for that, and nothing else about them.
   With no last tag, walk every feature in full.
2. **Read what is already reported.** Read the titles and bodies of the
   open issues labeled `qa`, so you recognise a repeat.
3. **Run `qa`** in the foreground, and wait for its report. Hand it the address, the invite path (opening it
   creates the first administrator, from whom it invites whatever
   accounts it needs), the features to walk in full, and the manifest.
   It walks every other feature's main path once.

   With a manifest, `qa` starts from the prepared data instead of
   building its own. It may read the manifest and the data files in
   `tools/nightly/fixtures/`, never the code beside them. With the
   harness tools it checks, among the rest:

   - that no amount is ever in a lookup the stand-in receives;
   - that asking for the same price twice reaches the source once;
   - the hourly ceiling, sending many lookups from the page with
     `browser_evaluate`;
   - the wording for a source that is down against one that has no
     such price, with `price_source` set to fail and then to recover.
     After a recovery the app keeps skipping the source for five
     minutes, unless `qa` restarts it with `app_stop` and `app_start`;
   - that archiving a holding stops its refresh, and unarchiving
     resumes it;
   - that reopening a recording asks about no unit that already has a
     rate;
   - totals under "rates as of each figure", against `known_prices`
     and the manifest's expected totals;
   - that an invite link never appears in the server log;
   - how the app reads while Solvent is stopped.

   Without a manifest, `qa` builds its data by hand and lists what that
   leaves it unable to check.
4. **Record each finding** in `qa-unfiled/<n>.json`, numbered from 1,
   as `{"title": ..., "body": ..., "labels": [...], "repeats": null}`.
   It is in English: the title says what is wrong for a user, ending in
   ` (seen once)` when `qa` could not reproduce it, and the body gives
   the steps, what the product spec expects with a pointer to the
   criterion, and what happened. The labels are `bug`, `qa`, `accepted`
   and the finding's rating (`CLAUDE.md`, The loop, Severity). When an
   open `qa` issue reports the same thing, `repeats` is its number and
   `comment` is `Still failing in the <date> build.`
5. **Record what could not be checked.** Each feature with criteria
   `qa` could not check gets a record the same way, titled
   `QA could not check <feature>`, labeled `bug`, `qa` and `accepted`
   without a rating, whose body lists each criterion and why. When one
   is open, `repeats` is its number and `comment` is
   `Still not checkable in the <date> build.` with the criteria that
   changed since.
6. **Finish.** Write `qa-done.txt` in the working directory last. Its
   absence tells the workflow QA did not finish.

A record that repeats an issue keeps the title, body and labels a new
one would have, so it is filed as new if that issue has closed by then.

Never fix anything, and never touch a pull request.
