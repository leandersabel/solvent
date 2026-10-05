# Solvent

Spec-first. `spec/requirements.md` says what the client requires, and
the rest of the spec and the code are derived from it.

## The pipeline

The client writes vague. The `advance` run (The loop) narrows it to
requirements, a feature page and code, doing the work itself.

| Stage | Who | Owns |
|---|---|---|
| Requirements | the `advance` run, for the client | `spec/requirements.md` |
| Spec and code | the `advance` run | `spec/features/*.md`, `spec/design-system.md`, `spec/architecture.md`, application code and its tests |
| Review | `reviewer` | its own tests, and findings against the feature page and the security rules |
| Release | `release` | `Dockerfile`, a running instance |
| Nightly | `qa` | findings against the client's intent, filed as `qa` issues |

`spec/architecture.md` bounds the screens: it sets what a screen may
use at all, such as which assets a page can load.

The client approves changes to `spec/requirements.md` and nothing else
(The loop, Requirements). From there the pipeline runs to a nightly
version on its own.

## Who asks the client

Only the `advance` run on an issue, only in the client's terms, and
only in a comment on that issue. A subagent never asks. The run asks
the client the questions that turn on the client's risk tolerance,
money or taste, and decides the rest, technical ones included, stating
the result in the spec.

The client's answer becomes a statement in `spec/requirements.md`. No
file keeps questions or a list of decisions: a decision is the
statement it produced, in the file that owns the subject, with its
reason where the statement would otherwise get undone. Who decided, and
when, is in the issues and the history.

## The spec layers

- `spec/requirements.md` holds what the client requires: one plain
  statement each, from what the client wrote and the answers they
  gave, with a reason only where the requirement would otherwise look
  arbitrary. No mechanics, screens or numbers the client never gave. It
  changes only with the client's approval.
- `spec/architecture.md` holds what is true system-wide: the security
  and threat model, key management, the data model, storage rules,
  status codes and hardening. Nothing that belongs to one feature.
  `spec/design-system.md` holds the shared visual rules: tokens,
  palettes, type, spacing, components, states and accessibility.
- `spec/features/<feature>.md` holds everything about one feature, each
  fact once, in these sections:
  - **What the client gets**: the product that meets the requirements,
    observable from outside by someone who cannot read code. No status
    codes, no columns, no libraries.
  - **Screens**: each screen the feature owns under its own `###`
    heading. Its layout, every state it must handle, the exact copy and
    what each control does, from the design system's tokens and
    components. The heading names the screen. In lowercase, with a
    hyphen for each run of spaces and punctuation, it is the screen's
    id, which names its browser parts in `tests/browser/parts/`. A
    screen several features use belongs to the one that owns most of
    it, and the others link to it.
  - **How it works**: row shapes, endpoints, byte encodings, crypto,
    errors.
  - **Edge cases**.
  - **Acceptance criteria**: a numbered list, each item a single
    checkable statement followed by the test that asserts it, or "no
    test". An item a passing test could fake is marked "(blind)", so a
    reviewer writes their own test for it rather than trusting the one
    beside it.

  A feature the client cannot see has no What the client gets: the
  record store, the record of prices and the nightly harness. Nightly QA
  walks every page that has one. The nightly harness is pipeline
  tooling, never in the image (The loop, Nightly and stable). A feature
  with no screen of its own can still be one the client sees: the app
  shell's chrome is where "looks like a private bank" is cashed out.

`spec/design/` holds a copy of the Claude Design canvas at
https://claude.ai/artifact/NFxzA1ngFuYB53FHnMizn3. It is outside the
pipeline. No agent reads or edits it, so a drawing the app has moved
past never overrules a screen.

## Naming and voice

**The thing somebody owns money in is a "holding" in anything a person
reads, and `account` in every identifier.** "Account" means a login
identity, because an administrator account and a user account are
different kinds of account. Using the same word for a bank account is an
ambiguity, and the product is client-facing, so the client-facing
word gives way. The record type stays `account`, the column stays
`account_id`, the AAD's first field stays `account_id`, and endpoint
paths stay as they are. Where prose names the record type, "the
`account` record" is right. A screen keeps the name it has, even where
that name and its subject differ.

`spec/requirements.md` and each feature page's What the client gets
address the client as **you**. Everything else is written for a builder
and stays third person.

## Economy

Every agent loads the `skald:prose` skill before writing prose (spec,
comments on GitHub, commit messages, pull requests) and the
`skald:code` skill before writing code, and follows it at level full.

## Code standards

All code in the repository, tests, fixtures and scripts included, meets
the bar of the code that ships. Coding practice is the `skald:code`
skill. Security practice is the Security section of
`spec/architecture.md` and every rule code scanning runs. "Only a test"
or "nothing ships" is never a reason to keep a weakness. A value
reaches code as data, never written into its text.

## Writing the spec

**Document the target state, never the route to it.**

- Record a change by rewriting the statement it changes, not by
  appending what it replaced. An idea that was never built appears
  nowhere.
- Rationale stays, history goes. "X, because Y" belongs. "X, which
  replaced W" does not.
- Keep rejected *external* options, providers and libraries, with the
  reason they fail. They constrain future choices. Our own discarded
  drafts are not the same thing.
- Negative rules are target state and belong: "there is no separate
  rate-symbol field, because two fields could disagree."
- One fact, one home. A rule true system-wide lives in
  `spec/architecture.md` or `spec/design-system.md`, a rule of one
  feature in its page, and a screen in the page of the feature that
  owns it. Anywhere else it is a pointer, written as "(`<feature>.md`,
  <Section>)".
- An acceptance criterion names a test that exists, by
  `tests/<file>.py::<test>` or `tests/browser/parts/<part>.mjs`, or says
  "no test". A change that adds or removes the test changes the line.
- No counts in prose. A number of rows, screens or providers is true
  for one edit and wrong by the next.
- No dates, no "owner's call", no "resolved".

## The loop

Bugs and change requests are GitHub issues on `leandersabel/solvent`.
The client is `leandersabel`. No agent edits an issue body.

### Who acts, and where state lives

- Every decision of the client's is a GitHub action by
  `leandersabel`: opening an issue, commenting, adding `accepted`,
  reviewing a requirements pull request, starting a candidate or a
  release. Agents write as `claude[bot]`, through the Claude GitHub
  App. Workflow steps, and the run that files QA's findings, write as
  `github-actions[bot]`.
- State is read off GitHub: issues, labels, pull requests, reviews,
  checks and releases. No file tracks it, and no comment is read as an
  approval.
- `.github/workflows/agent.yml` runs the `advance` skill once per
  event, with the issue number. The run reads the issue's state, takes
  the one next step and does the work itself, so no agent rebuilds
  context the run already holds. Repeating a run does no harm.
  `reviewer` is its only subagent. `qa` walks the nightly and the
  candidate, and `release` starts an instance outside them.
- Changes reach `master` only as pull requests from `claude[bot]` or
  Dependabot. The client changes the pipeline through an issue like any
  other change, except a workflow file, which the Claude GitHub App
  cannot write: the client changes it in a pull request of their own. A
  security fix is made by the client in its advisory's private fork,
  because a loop pull request is public before it merges
  (`SECURITY.md`).
- Model calls draw on the client's subscription through
  `CLAUDE_CODE_OAUTH_TOKEN`, made with `claude setup-token`, which can
  only make model requests. It lives in the `agent` environment, which
  hands it only to workflows running on `master`. An Anthropic API key
  is not used, because it bills per token beside the subscription.
  Claude Code routines are not used, because they write under the
  client's account and a comment cannot start one.

### Intake

- Issues are filed through the Bug and Change request forms, which set
  `bug` or `change`, in any language. Everything the loop writes on an
  issue is in the issue's language.
- An issue starts the loop when `accepted` is added, or at once when
  `github-actions[bot]` opened it. Adding a label takes triage access,
  and no form sets `accepted`. An agent adds it only to an issue it
  opens: a finding or a request split off another issue.
- The loop reads an issue's body, the comments by `leandersabel` and
  its own comments, and for a request split off another issue, the
  client's comments there. Nothing else is read, whatever it says. It
  reads the body as it stood when `accepted` was added, and asks the
  client when it has been edited since.

### Clarify

A client's issue gets one run, which reads it and the feature pages it
touches once and ends in one of:

- Unclear: questions, `needs-answer` and an @mention. The client's
  reply starts the next run.
- `bug`, Solvent falls short of a requirement or a feature page, or
  `maintenance`, nothing the client sees changes: one short comment
  saying what is wrong or what changes, and the issue waits in line.
- `change`, the requirements change: the run opens the requirements
  pull request.
- Already met or a duplicate: the reasoning, naming the change or the
  issue that holds it, and the issue closed. An issue is closed once
  fixed, whatever fixed it.
- Doubtful: the reasoning, and a question.

Questions follow Who asks the client. A `bug` where a requirement is
what is wrong becomes a `change`, and the reverse, with a comment
saying so. A decision the client never made is asked, never settled on
their behalf. No agent closes an issue. A merged pull request or the
client does, and the workflow reopens, with a comment, an accepted
issue anyone else closes.

An issue holding several requests keeps the first. The loop files each
of the rest as an issue of its own, in the client's words with a link
to where they asked, labeled `bug` or `change` and `accepted`.

### Requirements

- A `change` becomes a pull request from `claude/spec-<issue>` that
  touches only `spec/requirements.md`, or for a pipeline change only
  the pipeline. Its description lists the requirements it adds,
  changes or removes. It closes the issue only when it is a pipeline
  change that leaves nothing to implement and no workflow file to
  change.
- The client's approval at its head commit merges it, and what is left
  to implement waits in line. Requesting changes gets a revision.
  Closing it leaves the issue to the client.

### Implementation

- A ready issue waits in line with `queued`: a `bug` or `maintenance`
  issue clarified with nothing to ask, the issue of a merged
  requirements pull request, or a finding. One implementation runs at a
  time, and its issue carries `implementing`.
- Only the workflow hands out the slot, in a step without a model that
  runs one at a time. When no issue carries `implementing`, the
  first in line gets it and its run starts: critical problems first,
  then high ones, then the rest, each lowest number first. An issue
  that waits on the client holds neither a place in line nor the slot.
- Closing an issue stops its implementation. No pull request opens for
  it, and one already open loses auto-merge at once, then closes
  without merging, with its branch. The closed issue keeps
  `implementing` until the run on it has ended, so two implementations
  never run at once. A step without a model frees the slot, because a
  run can crash, time out or hit the usage limit. The client reopening
  the issue puts it back in line, to start over from `master`.
- No run starts from the line while the last run's usage of the
  subscription stands at 90 percent of its five-hour window or 80
  percent of its weekly one, until that window resets. The run's page
  in Actions says which window holds it and until when, and an hourly
  run of the workflow retries.
- One run implements one issue, on `claude/issue-<issue>`. It
  reproduces the report, updates the issue's feature page where
  behavior or acceptance criteria change (`spec/design-system.md` when
  the fix needs it, and `spec/architecture.md` only where a
  cross-cutting rule changes), writes a test that fails on
  the reported behavior, fixes it, and runs only the tests the change
  touches. A report that does not reproduce goes to the client as a
  question.
- `reviewer` writes its own tests from the feature page's acceptance
  criteria and the security rules in `spec/architecture.md` before it
  reads the implementation: one for every criterion marked "(blind)"
  and every criterion the change touches. They are committed with the
  change. At most two rounds of fixes follow. A finding on the change
  still open after that blocks it: its failing test is committed, the
  pull request stays a draft without auto-merge, and the issue is
  `stuck`. Findings outside the change are filed.
- The pull request's title is English and says what changes for users.
  Its body starts with `Closes #<issue>` and says the same in the
  issue's language. Auto-merge is on from the start unless a finding
  blocks it, and the full suite runs once, in its `test` check.
- An implementation never changes `spec/requirements.md` or the
  pipeline. When a requirement has to change, the issue goes back to
  clarifying.

### Merge gate

- One ruleset on `master`: pull requests only, squash merges only, no
  force push or deletion. The `test`, `image`, `workflows` and
  `dependencies` checks are required. `workflows` lints the workflows
  with actionlint and zizmor. No approval is required except the code
  owner's, and a push dismisses an earlier approval.
- `CODEOWNERS` makes `@leandersabel` the reviewer of
  `spec/requirements.md`, `spec/design/`, `.claude/`, `CLAUDE.md`,
  `SECURITY.md` and `.github/` outside `.github/workflows/`. So the
  client approves every requirement, and no agent changes the pipeline
  that gates it.
- Only the client bypasses the ruleset, and only on a pull request,
  because nobody can approve a pull request of their own.
- A pull request need not be up to date with `master`, because one
  implementation runs at a time and a requirements pull request touches
  no code. A version is made only of a commit whose push check passed,
  which tests `master` as a whole.
- Dependabot's updates pass the same gate and merge when green, except
  one touching a file the client owns, which waits for their approval. A
  release is proposed only once it has aged: a week for a major or
  minor release and for an action, a few days for a patch or a base
  image. A compromised release is usually caught and pulled within
  days, which a review of its release notes would not reveal. Security
  updates skip the wait.

### Severity

Every problem issue, a `bug` or a `code-scanning` one, carries one
rating:

- `severity: critical`: records are lost, changed or seen by someone
  who should not see them, or someone gets in who should not.
- `severity: high`: something the client requires cannot be done, or a
  figure is shown wrong.
- `severity: medium`: something works wrongly, but there is a way
  around it.
- `severity: low`: something looks or reads wrong, but nothing is lost
  or blocked.

An agent rates its own findings. A code scanning issue takes its
alert's security rating, or medium for an error and low otherwise. The
loop rates every other problem the next time it runs on it. A rating
the client set stands, and the client can change any. Only a rating
label set by `leandersabel`, `claude[bot]` or `github-actions[bot]`
counts, and the highest that counts wins. The workflow removes one
anyone else adds.

A problem rated high or critical holds back a version, however it was
found.

### Findings

- Every problem an agent or a workflow finds is an issue of its own,
  never only a remark in a comment or a pull request.
- A problem the work in hand causes, or its issue covers, is part of
  that work. Any other is filed by `claude[bot]`, or by QA's
  filing run as `github-actions[bot]`, as a rated `bug`, or as
  `maintenance` when nothing the client sees changes, with `accepted`,
  `queued`, where it was found, and its reproduction: the steps, or a
  failing test. Without one it is not filed. An agent never files a
  `change`, because a requirement is only ever the client's request.
- A finding waits in line as filed, with no clarify run, because
  whoever found it already said what is wrong. An issue the workflow
  opens gets no clarify run either: its first run rates it and puts it
  in line.
- What an open issue by `leandersabel`, `claude[bot]` or
  `github-actions[bot]` already reports is filed nowhere. When the
  finding rates it higher, that issue takes the higher rating instead.
  What should stop being reported is taken out of the spec or made
  checkable, never suppressed.
- A run files a bounded number of findings. Past that, the issue is
  `stuck`, because a flood of findings more likely means the run
  misread something than that Solvent broke that widely.

### Nightly and stable

- One image is built per version and moves through every stage by its
  digest on `ghcr.io/leandersabel/solvent`. No stage rebuilds it. Each
  stage records what it proved as a signed attestation on that digest
  and moves a tag, so nothing a later stage relies on lives in workflow
  artifacts. Every job checks out its own commit and no other.
- No model in these stages runs in a job whose token can push an image,
  move a tag, publish a release or write the repository. A model that
  walks holds a token that only reads. The model that files findings holds one that
  writes issues and nothing else, so findings are filed as
  `github-actions[bot]`.
- The stages:

  | Stage | Started by | QA walks | A pass publishes | Image tags |
  |---|---|---|---|---|
  | Check | each pull request | nothing | nothing, the pull request merges | none |
  | Nightly | the schedule, on a night code changed | the features that changed | a pre-release `YYYY.MM.N-dev.YYYYMMDD` | that version, `:nightly` |
  | Candidate | the client | every feature | a pre-release `YYYY.MM.N-rc.N` | that version, `:rc` |
  | Release | the client | nothing | the release `YYYY.MM.N` | that version, `:stable`, `:latest` |

- Versions are CalVer by month. A release is `YYYY.MM.N`, numbered from
  0 within the month. A nightly is a dev build of the next release,
  `YYYY.MM.N-dev.YYYYMMDD`. A candidate keeps that version as `-rc.N`,
  counting candidates of it from 1. So a dev build sorts before a
  candidate, and a candidate before the release. Immutable releases and
  a tag ruleset keep every version tag where it was made. Only
  `:nightly`, `:rc`, `:stable` and `:latest` move.
- **Build.** A reusable workflow, `.github/workflows/build.yml`, builds
  the calling workflow's own commit in a job without a model or
  secrets, pushes it by digest, tagged with its commit, and attests its
  provenance. An image that already exists for that commit is verified
  against its provenance and reused.
- **Nightly.** Every night that code on `master` changed since the last
  nightly, `.github/workflows/nightly.yml` builds, walks, files and
  publishes. `qa` walks the acceptance list of each feature whose page
  changed since the last nightly's commit, each one a changed file of
  the image or the harness names by its page's path, and the one walked
  longest ago. What each walk covered is read from the last nightly's
  attestation. A changed file naming none, or no nightly yet, walks
  every feature. A night that fails leaves its image in the registry,
  where the next night on the same commit reuses it.
- **Candidate.** The client runs `gh workflow run candidate.yml`. It
  fixes the digest under `:nightly` as it starts, or the one the client
  passes, and walks every feature of it. A pass moves `:rc` to it and
  publishes a pre-release. A failure files its findings and leaves
  `:rc` where it was. The client's UAT server follows `:rc`.
- **Release.** The client runs `gh workflow run release.yml`. It takes
  the digest under `:rc`, verifies that `build.yml` built it on
  `master` and that a candidate walked every feature of it, runs the
  release check, moves `:stable` and `:latest`, and publishes the
  release. It never rebuilds and never walks, and refuses to run for
  anyone but the client.
- The walk is split into shards that run at once, on the digest, with
  the harness from the workflow's own checkout. Each shard starts its
  own instance of the image, hardened on a network with no route out,
  beside a stand-in that answers as the price sources through a
  certificate authority made for the run, on prepared data. `qa` drives
  it in headless Chrome through the Playwright MCP server, and reaches
  the server only through the harness tools
  (`spec/features/nightly-harness.md`).
- The image a stage publishes is the one it walked. Nothing of the
  harness is in it, and Solvent has no setting naming a price source or
  a certificate authority.
- QA records what it finds during the walk. Once every shard has
  finished, a short run merges the records and another files them, and
  the workflow files what that run could not. A finding becomes a `bug`
  labeled `qa` as Findings says, and one without the steps that
  reproduce it is dropped. Each feature with criteria QA could not
  check gets a `maintenance` issue in line saying which and why.
- A walk passes when every shard finishes. A nightly is published only
  when its walk passed, the push check of its commit passed, and the
  release check passes. A candidate is taken only from a published
  nightly, and is published only when its walk and the release check
  pass. The release check holds back a
  version for an open problem rated high or critical, such an issue
  closed by anyone but the client without its fix in the version, or a
  runtime Dependabot alert rated high or critical. When it cannot read
  one of those, it fails and says which. That check is the workflow's,
  never a model's.
- A failed nightly or candidate always leaves an issue the loop takes
  up: the open problems that held it back, or else a `bug` by
  `github-actions[bot]` titled `The <stage> failed: <cause>`, or a
  comment on the open one with that title.
- Every day, `.github/workflows/sources.yml` sends one real lookup to
  each price source. A source that answers in a changed shape gets a
  `bug` rated high by `github-actions[bot]`, or a comment on the open
  one. One that does not answer is noted in the run's summary and is no
  finding, because the outage is the source's.
- Release notes are GitHub's generated notes since the last release,
  grouped by the labels of the merged pull requests
  (`.github/release.yml`).
- Every week, `.github/workflows/cleanup.yml` deletes the images older
  than 30 days that no release, and no moving tag, points to.
- Deploying is the client's. Watching the repository's releases
  notifies the client of every version.

### When something fails

- `needs-answer` means a decision waits on the client. `stuck` means
  the loop gave up, and its comment says why. Both @mention the client.
- A run's GitHub token lasts an hour. Past 35 minutes the run starts no
  new step, pushes what exists to its branch with what is left in the
  commit message, and stops, and the workflow starts one fresh run that
  continues from it. A pull request opens only on finished work, and
  unfinished work on a branch with an open pull request is never
  pushed: the issue is `stuck` instead.
- A pull request that closes an issue holds all the work the issue
  asked for. A workflow file is the exception: the pull request and its
  comment carry the exact change for the client's own pull request.
- The loop never stops in silence. A run that leaves its issue open, in
  none of the states under Issue state other than New, and hands no
  work to a fresh run, labels the issue `stuck`, in a step that runs
  even when the agent crashes, times out or hits the usage limit. Any
  comment by the client starts the next run.
- The exception is a run the subscription refused for its usage limit
  on an issue in line or being implemented without a pull request: the
  issue goes back in line, without `stuck` or a comment, and nothing
  more starts until there is headroom (Implementation).
- A failing check on an implementation pull request starts a run that
  fixes it on the same branch. After a bounded number of attempts, the
  pull request becomes a draft without auto-merge and the issue is
  `stuck`.
- Every merge to `master` rebases the loop's conflicting pull requests.
- A failing check on `master` opens a `bug` issue as
  `github-actions[bot]`, which starts at once and skips the line, and
  no version is made of that commit.
- A code scanning alert on `master` opens a `code-scanning` issue as
  `github-actions[bot]` in line. Its fix is public, unlike a report
  under `SECURITY.md`, because anyone can scan the public code. An
  alert still open after its fix merged puts the issue back in line
  once, and after a second fix the issue is `stuck`.
- Disabling `agent.yml`, or removing the token from the `agent`
  environment, stops the loop.

### Issue state

| State | On GitHub |
|---|---|
| Not started | without `accepted`, unless `github-actions[bot]` opened it |
| New | started, no comment from `claude[bot]` yet |
| Waiting on the client | `needs-answer` or `stuck` |
| Requirements in review | an open requirements pull request links it |
| Left to the client | its requirements pull request closed without a merge, and the client has not commented since |
| Queued | `queued` |
| Being implemented | `implementing`, and an open pull request closes it |
| Stopping | closed by anything but its merge, still `implementing` until the run on it ends |
| Done | closed by the merged pull request, shipped in the next nightly |
| Not doing | closed as not planned by the client |
