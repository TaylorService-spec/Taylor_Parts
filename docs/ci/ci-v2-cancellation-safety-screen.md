# CI-V2 — the cancellation-safety screen

The eight signals a workflow must clear before `cancel-in-progress` may be applied to it, and
the result for the first batch. Recorded so the remaining 110 workflows are screened by the
same method rather than by a fresh judgement each time.

## Why a screen exists at all

Cancelling a superseded run is only free if the run has no effect worth keeping. A run that
writes, deploys, publishes, feeds a downstream workflow, or leaves state on a persistent runner
is not free to cancel — and none of that is visible from the trigger block, which is where the
temptation to apply a default pattern lives.

The one mistake this class of change can make is worth stating plainly: **a cost fix that
cancels a `main` run creates a coverage hole while appearing to save money.** That is why the
policy carries `event_name` in the group *and* a conditional `cancel-in-progress`, rather than
relying on either alone.

## The eight signals

| # | Signal | What disqualifies |
|---|---|---|
| S1 | Secrets | consumes a real secret; a cancelled run may leave a partial external effect |
| S2 | Writes / deploys | pushes, commits, deploys, publishes, opens PRs |
| S3 | Self-hosted runner | state survives the run, so cancellation can leave residue |
| S4 | Declared permissions | anything beyond `contents: read` |
| S5 | Known side effect | documented stateful behaviour |
| S6 | **Effective** token authority | omitted permissions are NOT read-only by assumption — the repository default decides |
| S7 | Downstream dependency | `workflow_run` / `workflow_call` consumers, consumed artifacts, check-name assumptions |
| S8 | Command / action mutation | mutation hidden in a `run:` step or an invoked script, not visible in permissions |

S6–S8 exist because S1–S5 can all pass on a workflow that still mutates something. Permissions
describe what a token *may* do; they say nothing about what a script actually does.

## How each is established

    S1  grep for ${{ secrets.X }} — NOT bare "secrets.", which matches prose in comments
    S2  grep for git push/commit, peter-evans, create-pull-request, firebase deploy,
        deploy-pages, upload-pages, gcloud
    S3  grep runs-on for self-hosted
    S4  read workflow-level and job-level permissions blocks
    S5  read the workflow's own header comments
    S6  gh api repos/{owner}/{repo}/actions/permissions/workflow
    S7  grep the whole estate for workflow_run/workflow_call naming the workflow;
        grep the workflow for upload-artifact/download-artifact and check for consumers
    S8  enumerate every `uses:` and every `run:`, expand multiline blocks, and sweep for
        gh api|pr|issue|release, github-script, curl/wget writes, firebase deploy, gcloud,
        npm publish, git push|commit|tag, repository_dispatch

## Estate-wide facts established by the first screen

* **Exactly one real secret exists** in 127 workflows: `OPENAI_API_KEY`, in
  `reciprocal-gpt-review.yml`. Forty-five other `secrets.` matches are prose in comments,
  where the repository documents its own no-secret posture. A naive grep would have
  disqualified 46 workflows on a false signal.
* **The repository token default is read-only** —
  `{"default_workflow_permissions":"read","can_approve_pull_request_reviews":false}` — so a
  workflow that declares no `permissions:` block still inherits read-only. This must be
  re-checked if the repository setting ever changes; it is a repository-level fact, not a
  per-workflow one.
* **The estate has exactly one `workflow_run` consumer**: `eos-intake-execute.yml`, listening
  to `"EOS Issue Intake — adapt, govern, and dispatch"`. Nothing else in CI depends on another
  workflow completing.
* **Seven workflows carry side effects** and are `MUST_NOT_CANCEL`: `deploy-field-ops`,
  `eos-intake-execute`, `eos-intake-ingest`, `eos-intake-writeback`, `eos-issue-intake`,
  `eos-patch-integrate`, `reciprocal-gpt-review`. Five already carried deliberate
  `concurrency` written by their authors; `eos-intake-ingest` and `reciprocal-gpt-review` do
  not, and were deliberately left alone — they are exactly the class needing individual
  reasoning rather than a default.

## First batch — ten workflows, all clear on all eight

    equipment-compatibility-ui-tests    composition-conformance-tests
    vite-build-check                    client-suite-manifest-tests
    scan-workspace-tests                ai-repository-provider-tests
    dispatch-north-star-tests           operational-provider-tests
    equipment-install-ui-tests          assistant-security-tests

Two findings worth carrying forward:

**`operational-provider-tests.yml` is the file behind the name "EOS Operational AI Provider".**
The batch was originally proposed as `eos-operational-ai-provider-tests.yml`, which does not
exist — a workflow NAME read out of run history and mistaken for a filename. Screen by file,
verify against `name:`.

**One artifact exists in the batch and nothing consumes it.** `equipment-install-ui-tests`
uploads emulator debug logs with `if: always()` and `if-no-files-found: ignore`. Cancelling an
obsolete run therefore loses diagnostics for a superseded commit, not required evidence. Had
anything consumed that artifact, the workflow would have been `NEEDS_REVIEW`.

## The policy applied

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.event_name }}-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

`event_name` in the group keeps PR and main runs in separate groups. The conditional then makes
main non-cancellable even if they ever shared one. Belt and braces on the only failure mode
that would trade coverage for cost.

## What the screen does NOT establish

The first batch clearing all eight signals says nothing about the other 110. S6–S8 must be run
across each later batch — S6 in particular, because a workflow with no `permissions:` block is
safe only for as long as the repository default stays read-only.
