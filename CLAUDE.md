# Solvent

Spec-first. A high-level spec says what the product is, and the
low-level spec and the code are derived from it.

## The pipeline

The client writes vague. Each stage narrows it, and only one agent
talks to the client.

| Stage | Agent | Owns |
|---|---|---|
| High-level spec | `product-owner` | `spec/product/*.md` |
| | `architect` | `spec/architecture.md`, `security/` |
| Low-level spec | `architect` | `spec/features/*.md` |
| | `designer` | `spec/ui/*.md`, the design system |
| | `compiler` | `spec/.compiled/*.json`, `spec/status.md` |
| Code | `engineer` | application code and its tests |
| | `reviewer` | findings against the contract |
| | `release` | `Dockerfile`, a running instance |
| | `qa` | findings against the client's intent, filed as `qa` issues |

The architecture comes before the screens because it sets what a
screen may use at all, such as which assets a page can load.

The client approves the high-level spec, in each change's spec pull
request (The loop, Spec). From the low-level spec onward the pipeline
runs to a nightly version on its own.

## Who asks the client

Only `product-owner`, only in the client's terms, and only in a comment
on the issue. Every other agent
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
- `spec/ui/*.md` holds one file per screen, plus the design system.
  A screen's layout, every state it must handle, the exact copy, what
  each control does, and the tokens and contrast floors. A change to
  how anything looks is written here, from the design system's tokens
  and components, and is judged on a nightly version.

`spec/design/` holds a copy of the Claude Design canvas at
https://claude.ai/artifact/NFxzA1ngFuYB53FHnMizn3. It is outside the
pipeline. No agent reads or edits it, so a drawing the app has moved
past never overrules a screen file.

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
reads, and `account` in every identifier.** "Account" means a login
identity, because an administrator account and a user account are
different kinds of account. Using the same word for a bank account is an
ambiguity, and the product is client-facing, so the client-facing
word gives way. The record type stays `account`, the column stays
`account_id`, the AAD's first field stays `account_id`, and endpoint
paths stay as they are. Where prose names the record type, "the
`account` record" is right. A screen keeps the name it has, even where
that name and its subject differ.

`spec/product/*.md` addresses the client as **you**. `spec/features/`
and `spec/ui/` are written for a builder and stay third person.

A product file's **"Decisions taken on your behalf"** section holds what
the client never said and may overrule. That is what the heading means,
so no file restates it in a preamble.

## Economy

Every agent loads the `skald:prose` skill before writing prose (spec,
comments on GitHub, commit messages, pull requests) and the
`skald:code` skill before writing code, and follows it at level full.

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

## The loop

Bugs and change requests are GitHub issues on `leandersabel/solvent`.
The client is `leandersabel`. No agent edits an issue body.

### Who acts, and where state lives

- Every decision of the client's is a GitHub action by
  `leandersabel`: opening an issue, commenting, adding `accepted`,
  reviewing a spec pull request, promoting a release. That is how an
  outside reader tells the client's work from the agents'.
- Agents write as `claude[bot]`, through the Claude GitHub App, and
  never under the client's account. Workflow steps without a model
  write as `github-actions[bot]`.
- State is read off GitHub: issues, labels, pull requests, reviews,
  checks and releases. No file tracks it, and no comment is read as an
  approval.
- Agents run in GitHub Actions, one short run per event.
  `.github/workflows/agent.yml` runs the `advance` skill with the
  issue number, and the skill reads the issue's state and takes the one
  next step. Repeating or restarting a run does no harm.
- Changes reach `master` only as pull requests from `claude[bot]` or
  Dependabot. The client changes the pipeline through an issue like any
  other change, and a Claude session on the client's machine does not
  push. Workflow files are the exception: the Claude GitHub App cannot
  write them, so the client changes them in a pull request of their
  own, which merges on green. A security fix is made by the client in
  its advisory's private fork, because a loop pull request is public
  before it merges (`SECURITY.md`).
- Model calls draw on the client's subscription through
  `CLAUDE_CODE_OAUTH_TOKEN`, made with `claude setup-token`. The token
  can only make model requests, so it reaches no claude.ai chats or
  connectors. It lives in the `agent` environment, which hands it only
  to workflows running on `master`.
- An Anthropic API key is not used, because it bills per token beside
  the subscription. Claude Code routines are not used, because they
  write under the client's account and a comment cannot start one.

### Intake

- Issues are filed through the Bug and Change request forms, which set
  `bug` or `change`, in any language. Everything the loop writes on an
  issue is in the issue's language, following the `advance` skill's
  Writing section.
- An issue by `leandersabel` starts the loop when it is opened. Anyone
  else's issue starts it when `accepted` is added. An issue by
  `github-actions[bot]` starts at once: only this repository's
  workflows can write one, for a red `master`, and its text is
  theirs. Adding a label takes
  triage access to the repository, no form sets `accepted`, and no
  agent adds it.
- The loop reads an issue's body, the comments by `leandersabel` and
  its own comments. Nothing else on the issue is read, whatever it
  says. On an accepted issue it reads the body as it stood when
  `accepted` was added, and asks the client when it has been edited
  since.

### Clarify

Each run on a new issue, or on a reply from the client, ends in one of:

- Unclear: questions to the client, the `needs-answer` label and an
  @mention. The client's reply starts the next run.
- `bug`, the app contradicts the spec: the comment says what the spec
  says and what the app does, and implementation starts.
- `change`, the spec changes: the comment says what changes for the
  client, screen by screen, and the spec pull request opens.
- `maintenance`, only the code changes and nothing the client sees:
  the comment says what changes and why, and implementation starts.
- Already met, a duplicate, or doubtful: the reasoning, and a question
  to the client.

A `bug` where the spec is what is wrong is relabeled `change`, and a
`change` the spec already asks for is relabeled `bug`, each with a
comment saying so. No agent closes an issue. A merged pull request or
the client does.

### Spec

- A `change` becomes a pull request from `claude/spec-<issue>` that
  touches only `spec/` and links the issue without closing it. Its
  description says what changes for the client in the issue's
  language, with the technical part collapsed.
- The client reviews `spec/product/` and `spec/architecture.md` in it.
  Approving merges it and starts implementation. Requesting changes
  gets a revision on the same pull request. Closing it stops the loop
  and leaves the issue to the client.
- Until the implementation merges, `master` holds a spec ahead of the
  code. No version ships in between, because QA holds the release.

### Implementation

- Starts when a spec pull request merges, or when clarifying finds a
  `bug` with nothing to ask. One implementation runs at a time: its
  issue carries `implementing`, an issue ready meanwhile waits with
  `queued`, and the lowest-numbered queued issue starts when the running
  one merges.
- On `claude/issue-<issue>`, `engineer` implements the contract, for a
  `bug` starting with a test that fails on the reported behavior. The
  suite passes, browser tests included. `reviewer` reviews the change
  against the contract, and its findings go back to `engineer` for a
  bounded number of rounds.
- The pull request's title is English and says what changes for users.
  Its body starts with `Closes #<issue>` and says the same in the
  issue's language, with the technical part collapsed. Auto-merge is on
  from the start.
- An implementation never changes `spec/product/`,
  `spec/architecture.md` or the pipeline. When the spec has to change,
  the issue goes back to clarifying.

### Merge gate

- One ruleset on `master`: pull requests only, squash merges only, no
  force push or deletion. The `test`, `image` and `dependencies` checks
  are required. No approval is required except the code owner's, and a
  push dismisses an earlier approval. Nobody bypasses it.
- `CODEOWNERS` makes `@leandersabel` the reviewer of `spec/product/`,
  `spec/architecture.md`, `spec/design/`, `.claude/`, `CLAUDE.md`,
  `SECURITY.md` and `.github/` outside `.github/workflows/`. So the
  client approves every spec change, and no agent changes the pipeline
  that gates it.
- A pull request need not be up to date with `master`, because one
  implementation runs at a time and a spec pull request touches no
  code. The nightly run tests `master` as a whole before any version.
- Dependabot's updates pass the same gate and merge when green, except
  one touching a file the client owns, which waits for their approval. A
  release is proposed only once it has aged: a week for a major or
  minor release and for an action, a few days for a patch or a base
  image. A compromised release is usually caught and pulled within
  days, which a review of its release notes would not reveal. Security
  updates skip the wait.

### Nightly and stable

- Every night that code on `master` changed since the last version,
  `.github/workflows/nightly.yml` builds the image, starts it hardened,
  runs the suite against that commit, and runs `qa` against the running
  app in headless Chrome through the Playwright MCP server. `qa` walks
  the full acceptance list of every feature touched by an issue closed
  since the last version, and a smoke path through the rest. The
  client can start the same run by hand. Claude in Chrome is not used
  here, because it needs a desktop browser.
- A finding that reproduces twice becomes a `bug` issue by
  `claude[bot]` labeled `qa`, or a comment on the open one it repeats.
  It waits for `accepted` like anyone else's issue, so nothing the loop
  writes starts the loop.
- A passing night is a pre-release named by its date, `YYYY-MM-DD`,
  with the image on `ghcr.io/leandersabel/solvent` tagged `:<date>` and
  `:nightly`. There is at most one version a day, and a run on a day
  that has one refuses.
- The client promotes a nightly by marking its release the latest
  instead of a pre-release. That tags the same image `:stable` without
  a rebuild, rewrites the notes to cover everything since the last
  stable, and deletes the nightlies before it.
- Release notes are assembled from the merged pull requests' titles,
  without a model, grouped into changes and fixes, fixes found by QA,
  and maintenance. Each line names who asked, who approved the spec
  and who implemented it.
- Deploying is the client's. Watching the repository's releases
  notifies the client of every version.

### When something fails

- `needs-answer` means a decision waits on the client. `stuck` means
  the loop gave up, and its comment says why. Both @mention the client.
- A run that crashes, times out or hits the usage limit labels its
  issue `stuck`, in a step that runs even when the agent does not
  finish. Any comment by the client starts the next run, which
  continues from what is on GitHub.
- A failing check on an implementation pull request starts a run that
  fixes it on the same branch. When it still fails after a bounded
  number of attempts, or reviewer findings remain, the pull request
  becomes a draft without auto-merge and the issue is `stuck`.
- Every merge to `master` rebases the loop's open pull requests.
- A failing check on `master` opens a `bug` issue as
  `github-actions[bot]`, which starts at once and skips the
  implementation queue, and that night has no QA.
- Disabling `agent.yml`, or removing the token from the `agent`
  environment, stops the loop.

### Issue state

| State | On GitHub |
|---|---|
| Not started | someone else's issue without `accepted` |
| New | started, no comment from `claude[bot]` yet |
| Waiting on the client | `needs-answer` or `stuck` |
| Spec in review | an open spec pull request links it |
| Queued | `queued` |
| Being implemented | `implementing`, and an open pull request closes it |
| Done | closed by the merged pull request, shipped in the next nightly |
| Not doing | closed as not planned by the client |
