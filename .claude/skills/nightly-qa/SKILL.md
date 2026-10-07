---
name: nightly-qa
description: Hunt an image for defects against the client's acceptance lists, recording each finding for the workflow to file. Run by .github/workflows/hunt.yml, for the nightly and the candidate.
---

# QA hunt

`CLAUDE.md`, The loop, Nightly and stable, is the contract this keeps.
GitHub is read with `gh`, and you write nothing to it: the workflow
chooses the features, ends the hunt when its time is up, and files what
was recorded by then.

The arguments are `<url> <invite path> <features> [<manifest>]`, the
features comma-separated, each named after its page in
`spec/features/`, and `<manifest>` the path of the prepared data's
manifest. The app is the hunt's own.

1. **Read what is already reported**, once, before the first run. Read
   the titles and bodies of the open `bug` and `qa` issues by
   `leandersabel`, `claude[bot]` and `github-actions[bot]`, so you
   recognize a repeat (`CLAUDE.md`, The loop, Findings).
2. **Run `qa`** in the foreground, once for each feature, in the order
   given. Hand every run the address, its feature, the manifest, and
   `qa-unfiled/` with the record format of step 3, so it records each
   finding as it confirms it. The first run gets the invite path,
   which creates `qa`'s administrator, from whom it invites whatever
   accounts it needs. Every later run gets the username and password
   the first report starts with instead. With a manifest, the first run
   opens the dashboard before anything else, because the browser starts
   holding the aged session the manifest's `browserSession` names, and
   the hunt's first sign-in replaces it.

   Every run leaves the price sources up and the app running. Within a
   run, a check that stops the app or makes a source fail runs last.
   Each harness check below belongs to the feature it tests, and is
   made only in a hunt of that feature.

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

   Without a manifest, `qa` builds its data by hand.
3. **The record format.** Each finding is `qa-unfiled/<n>.json`, at the
   next free number from 1, as `{"title": ..., "body": ...,
   "steps": [...], "labels": [...], "repeats": null}`. It is in
   English: the title says what is wrong for a user, the body what the
   feature page expects with a pointer to the criterion and what
   happened, and `steps` each step that reproduces it, in order. A
   finding without steps is not filed. The labels are `bug` and the
   finding's rating (`CLAUDE.md`, The loop, Severity). A finding an
   open issue reports gets a record only when its rating is higher than
   that issue's, with `repeats` its number and `comment` saying the new
   rating and why.

A record that repeats an issue keeps everything a new one would have,
so it is filed as new if that issue has closed by then.

Never fix anything, and never touch a pull request.
