---
name: nightly-qa
description: Plan tonight's QA walk, walk one shard of it against the client's acceptance lists, or merge what the shards recorded for the workflow to file. Run by .github/workflows/nightly.yml.
---

# Nightly QA

The first argument names the part to run: `plan`, `walk` or `merge`.
`CLAUDE.md`, The loop, Nightly and stable, is the contract this keeps.
GitHub is read with `gh`, and you write nothing to it: the workflow
splits the walk into shards from your plan, and files what the shards
record after they all finish.

## Plan

The arguments are `plan <last tag>`. A feature is a file in
`spec/product/`, named without `.md`. It is walked in full when its
`spec/product/` or `spec/features/` file changed since the last tag, or
when an issue closed since then names it. Read the closed issues'
titles and bodies for that, and nothing else about them. Write the
features to walk in full to `qa-full.txt`, one name per line, and
nothing else.

## Walk

The arguments are `walk <url> <invite path> full=<features>
smoke=<features> [<manifest>]`, each list comma-separated and possibly
empty, where `<manifest>` is the path of the prepared data's manifest.
This shard's app is its own, and no other shard reaches it.

1. **Read what is already reported.** Read the titles and bodies of the
   open issues labeled `qa`, so you recognise a repeat.
2. **Run `qa`** in the foreground, and wait for its report. Hand it the address, the invite path (opening it
   creates the first administrator, from whom it invites whatever
   accounts it needs), the features to walk in full, the features whose
   main path it walks once, and the manifest. Each harness check below
   belongs to the feature it tests, and is walked only by the shard
   that has that feature. A check that stops the app or makes a source
   fail runs last in its shard.

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
3. **Record each finding** in `qa-unfiled/<n>.json`, numbered from 1,
   as `{"title": ..., "body": ..., "labels": [...], "repeats": null}`.
   It is in English: the title says what is wrong for a user, ending in
   ` (seen once)` when `qa` could not reproduce it, and the body gives
   the steps, what the product spec expects with a pointer to the
   criterion, and what happened. The labels are `bug`, `qa`, `accepted`
   and the finding's rating (`CLAUDE.md`, The loop, Severity). When an
   open `qa` issue reports the same thing, `repeats` is its number and
   `comment` is `Still failing in the <date> build.`
4. **Record what could not be checked.** Each feature with criteria
   `qa` could not check gets a record the same way, titled
   `QA could not check <feature>`, labeled `bug`, `qa` and `accepted`
   without a rating, whose body lists each criterion and why. When one
   is open, `repeats` is its number and `comment` is
   `Still not checkable in the <date> build.` with the criteria that
   changed since.
5. **Finish.** Write `qa-done.txt` in the working directory last. Its
   absence tells the workflow this shard did not finish.

A record that repeats an issue keeps the title, body and labels a new
one would have, so it is filed as new if that issue has closed by then.

## Merge

The argument is `merge <directory>`, holding each shard's
`qa-unfiled/` in a directory of its own. Read every record, and write
them to `qa-unfiled/<n>.json` in the working directory, numbered from
1. Records from different shards that report the same thing become
one, with the highest rating, the steps from each, and the `repeats` of
any. Change nothing else in a record. Read nothing but the records.

Never fix anything, and never touch a pull request.
