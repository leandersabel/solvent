---
name: nightly-qa
description: Walk one shard of tonight's QA walk against the client's acceptance lists, or merge what the shards recorded for the workflow to file. Run by .github/workflows/nightly.yml.
---

# Nightly QA

The first argument names the part to run: `walk` or `merge`.
`CLAUDE.md`, The loop, Nightly and stable, is the contract this keeps.
GitHub is read with `gh`, and you write nothing to it: the workflow
chooses the features and splits them into shards, and files what the
shards record after they all finish.

## Walk

The arguments are `walk <url> <invite path> <features> [<manifest>]`,
the features comma-separated, each named after its page in
`spec/features/`, and `<manifest>` the path of the prepared data's
manifest.
This shard's app is its own, and no other shard reaches it.

1. **Read what is already reported**, once, before the first run. Read
   the titles and bodies of the open `bug` and `qa` issues by
   `leandersabel`, `claude[bot]` and `github-actions[bot]`, so you
   recognize a repeat (`CLAUDE.md`, The loop, Findings).
2. **Run `qa`** in the foreground: once for each feature, then, when
   the shard has any, once for the wrong-password and lockout checks of
   the whole shard. After each report, record its findings and what it could not
   check (steps 3 and 4) before starting the next run, so a timeout
   loses at most the feature in hand.

   Hand every run the address, what it walks and the manifest. The
   first run gets the invite path, which creates `qa`'s administrator,
   from whom it invites whatever accounts it needs. Every later run gets
   the username and password the first report starts with instead. With a
   manifest, the first run opens the dashboard before anything else,
   because the browser starts holding the aged session the manifest's
   `browserSession` names, and the shard's first sign-in replaces it.

   Every run leaves the price sources up and the app running. Within a
   run, a check that stops the app or makes a source fail runs last.
   The wrong-password and lockout run is the shard's last, because an
   address lock blocks every later sign-in for a quarter of an hour.
   Each harness check below belongs to the feature it tests, and is
   walked only by the shard that has that feature.

   With a manifest, `qa` starts from the prepared data instead of
   building its own. It may read the manifest and the data files in
   `tools/nightly/fixtures/`, never the code beside them. With the
   harness tools it checks, among the rest:

   - that no amount is ever in a lookup the stand-in receives
   - that asking for the same price twice reaches the source once
   - the hourly ceiling, sending many lookups from the page with
     `browser_evaluate`
   - the wording for a source that is down against one that has no
     such price, with `price_source` set to fail and then to recover.
     After a recovery the app keeps skipping the source for five
     minutes, unless `qa` restarts it with `app_stop` and `app_start`
   - that archiving a holding stops its refresh, and unarchiving
     resumes it
   - that reopening a recording asks about no unit that already has a
     rate
   - totals under "rates as of each figure", against `known_prices`
     and the manifest's expected totals
   - that an invite link never appears in the server log
   - how the app reads while Solvent is stopped
   - the idle lock, in one wait, for `login` and `account-settings`. In
     a shard walking both, the run for whichever comes first checks it
     for both
   - for `account-settings`, that a password change brings a weakly
     protected vault up to current strength. On the older vault the
     manifest reserves for it, used for nothing else, `qa` signs in with
     the upgrade held back by a route on `/api/auth/upgrade-kdf`,
     removes the route, reads the stored strength from
     `POST /api/auth/salt` with `browser_evaluate`, changes the
     password, reads it again, and signs in fresh with the new password
   - for `account-settings`, that signing out, signing out everywhere
     and deleting the vault end the right sessions, with one session in
     each browser
   - for `account-settings`, that open sessions lists only your own,
     signed in as a prepared owner while the other prepared owners still
     hold the live sessions the manifest's `live-sessions` coverage
     names.

   A check whose data the manifest lacks is a criterion `qa` could not
   check. Without a manifest, `qa` builds its data by hand and lists what that
   leaves it unable to check.
3. **Record each finding** in `qa-unfiled/<n>.json`, numbered from 1
   and continuing across runs, as `{"title": ..., "body": ...,
   "steps": [...], "labels": [...], "repeats": null}`. It is in
   English: the title says what is wrong for a user, the body what the
   feature page expects with a pointer to the criterion and what
   happened, and `steps` each step that reproduces it, in order. A
   finding without steps is not filed. The labels are `bug` and the
   finding's rating (`CLAUDE.md`, The loop, Severity). A finding an
   open issue reports gets a record only when its rating is higher than
   that issue's, with `repeats` its number and `comment` saying the new
   rating and why.
4. **Record what could not be checked.** Each feature with criteria
   `qa` could not check gets a record the same way, titled
   `QA could not check <feature>`, labeled `maintenance` without a
   rating or steps, whose body lists each criterion and why. When an
   open one for the feature lists the same criteria, there is no
   record. When it lists others, `repeats` is its number and `comment`
   names the criteria that joined or left. A later run's criteria for a
   feature already recorded join that record.
5. **Finish.** Write `qa-done.txt` in the working directory, after the
   last run's records and as the last thing written. Its absence tells
   the workflow this shard did not finish.

A record that repeats an issue keeps everything a new one would have,
so it is filed as new if that issue has closed by then.

## Merge

The argument is `merge <directory>`, holding each shard's
`qa-unfiled/` in a directory of its own. Read every record, and write
them to `qa-unfiled/<n>.json` in the working directory, numbered from
1. Records from different shards that report the same thing become
one, with the highest rating, the `steps` of one and the `repeats` of
any. Change nothing else in a record. Read nothing but the records.

Never fix anything, and never touch a pull request.
