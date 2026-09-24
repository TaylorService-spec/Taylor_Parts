# Governance Guard Enforcement — required status check activation

Status: **PREPARED, NOT CONFIGURED.** Branch protection on `main` is unchanged.

This runbook exists because the enforcement value of
`.github/workflows/governance-guard-enforcement.yml` is zero until the check it produces is a
**required** status check on the protected branch. Until then it is one more advisory workflow, and
a head sha can still merge with it red or absent.

The owner ruling that governs this file:

> The new `Governance Guard Enforcement` workflow should ultimately be a REQUIRED branch-protection
> check. Do not configure remote branch protection until the workflow exists on the remote
> default/protected branch. When that point arrives, one deliberate GitHub configuration action is
> authorized. No repeated GitHub polling.

---

## 1. The exact strings

Three different strings exist and only one of them is the one branch protection matches.

| Thing | Exact value | Where it comes from |
| --- | --- | --- |
| Workflow file | `.github/workflows/governance-guard-enforcement.yml` | path on disk |
| Workflow `name:` | `Governance Guard Enforcement` | line 1 of the YAML |
| Job id | `governance-guard-enforcement` | `jobs.<id>` key, line 81 |
| **Check-run name — THE ONE THAT MATTERS** | `Protected governance surfaces cannot merge ungated` | `jobs.governance-guard-enforcement.name`, line 82 |

Branch protection's `contexts` / `checks[].context` matches the **check-run name**, not the
workflow name and not the file name. GitHub Actions derives the check-run name as:

* the job's `name:` when one is present — it is, so it wins over the job id;
* plus a ` (<matrix values>)` suffix when the job declares `strategy.matrix` — **it does not**.
  The job has `runs-on: ubuntu-latest`, `timeout-minutes: 20` and no `strategy:` block, so there is
  no matrix expansion and no suffix;
* with no reusable-workflow prefix, because the job runs steps directly and has no job-level `uses:`.

So the required context string is exactly, with no prefix and no suffix:

```
Protected governance surfaces cannot merge ungated
```

---

## 2. Why this workflow can be required and the others cannot

A `paths:`-filtered workflow produces **no check run at all** on a pull request that does not touch
its filter. A required check that produces no run sits Pending forever and blocks the merge
permanently. That is why every path-filtered governance guard in this repository is advisory by
construction.

Measured across all 148 workflow files at `37098a27`:

* 148 workflows total; **7** have no `paths:`/`paths-ignore:` filter on any trigger;
* of those, **4** are triggered by `pull_request`:

| Workflow | Check-run name | Required-check eligible? |
| --- | --- | --- |
| `governance-guard-enforcement.yml` | `Protected governance surfaces cannot merge ungated` | **Yes — the subject of this runbook** |
| `operational-payload-guard.yml` | `No committed operational record snapshots` | Yes — structurally eligible today |
| `gitleaks.yml` | `gitleaks` | Yes — structurally eligible today |
| `vite-build-check.yml` | `build` | Structurally yes, **but the name `build` collides** with the `build` job in `inventory-analytics-tests.yml`. Two check runs can carry that name on one PR. Rename the job before requiring it. |

`governance-guard-enforcement.yml` `on:` block (lines 62–66) is:

```yaml
on:
  pull_request:
  push:
    branches: [main]
  workflow_dispatch:
```

`pull_request` carries no `branches:`, no `paths:`, no `paths-ignore:` and no `types:` narrowing.
It therefore fires on the default activity types (`opened`, `synchronize`, `reopened`) for every
pull request, including drafts, and always emits a check run.

---

## 3. Skipped vs successful — the distinction that decides this

These two are not the same to branch protection:

* **Workflow skipped** (path filter, branch filter, `[skip ci]`): no check run is created. A
  required check stays Pending and the PR can never merge. This is the failure mode to avoid.
* **Job skipped** by a job-level `if:`: a check run *is* created, with conclusion `skipped`.
  Whether that satisfies a required check is a behaviour this repository should not be depending on.

This job depends on **neither**. It has **no job-level `if:`** — verified: across all 174
PR-triggered jobs in the repository, zero carry a job-level `if:`. Every conditional in this
workflow is **step-level**. The job therefore always executes and always concludes `success` or
`failure`; it can never be reported as `skipped`.

On a PR touching none of the guarded paths:

| Runs unconditionally (6 steps) | Gated on the computed diff (5 steps) |
| --- | --- |
| `actions/checkout@v4` (`fetch-depth: 0`) | `D2 deployment handoff static guard` — `if: steps.surfaces.outputs.d2_handoff == 'true'` |
| `actions/setup-node@v4` (Node 22, npm cache) | `Capability graph drift guard` — `if: ... capability_graph == 'true'` |
| `Workflow self-push fence contract tests` | `Install functions dependencies (reproducible)` — `if: ... legacy_surface == 'true'` |
| `Workflow self-push fence` | `Build functions (compiles the corpus to lib/)` — same gate |
| `Determine previous accepted commit` (shell) | `Legacy authorization surface drift gate` — same gate |
| `Classify the protected surfaces this change touches` (shell) | |

The five gated steps are skipped, the six unconditional steps run, and the **job concludes
`success`**. An unrelated PR is not blocked.

Unconditional cost, measured locally at `37098a27`:

```
node --test scripts/workflowSelfPushFence.test.mjs   6/6 pass   0.085s
node scripts/workflowSelfPushFence.mjs              exit 0     0.031s
  -> "Workflow self-push fence OK: 148 workflows scanned,
      3 allowlisted self-pushing workflows, 0 new ones."
```

The only step in the whole job that installs dependencies (`npm ci`) is gated on the legacy
authorization surface. No emulator, no Java, no secrets, `permissions: contents: read`.

**One caveat, by design:** the always-on fence is a real gate. A PR that adds a workflow which
pushes repository content, or that leaves a stale entry in the self-push allowlist, will fail this
check even though it touches none of the three protected surfaces. That is the point of the fence
and is not a false positive.

**Concurrency is not a hazard:** `cancel-in-progress` is true only for `pull_request`, and the
group is `${{ github.workflow }}-${{ github.event_name }}-${{ github.ref }}`. For a PR
`github.ref` is `refs/pull/<n>/merge`, so a cancellation can only ever discard a run for a sha that
is no longer the PR head, and the required check is evaluated against the new head.

---

## 4. Remote prerequisite — do not skip this

At the time of writing, `.github/workflows/governance-guard-enforcement.yml` **does not exist on
`origin/main`** (`origin/main` = `aa033dad`; `git cat-file -e origin/main:<path>` → absent). The
repository default branch is `main` (`refs/remotes/origin/HEAD` → `refs/remotes/origin/main`).

Requiring the check before the workflow is on `main` would block **every** open pull request,
because a `pull_request` run resolves the workflow file from the PR's merge commit: with the file
absent from `main`, PR branches that do not themselves carry it produce no check run, and the
required check hangs Pending with no way to clear it.

Both conditions must hold before the configuration action:

1. `.github/workflows/governance-guard-enforcement.yml` is merged and present on `main`.
2. The workflow has produced **at least one completed run on `main`**. The REST API will accept an
   arbitrary context string without this, but the branch-protection **UI** only offers check names
   that have been reported to the repository in the last seven days, and a run on `main` is also
   the proof that the check-run name on the wire matches the string in section 1 exactly.

Confirm both from the merge commit and that single run. Do not poll.

---

## 5. The one-time configuration action — NOT YET EXECUTED

Repository: `TaylorService-spec/Taylor_Parts`. Branch: `main`.

**Preferred — additive, single call, does not disturb any other required check:**

```
POST /repos/TaylorService-spec/Taylor_Parts/branches/main/protection/required_status_checks/contexts
```

```bash
gh api \
  --method POST \
  -H "Accept: application/vnd.github+json" \
  /repos/TaylorService-spec/Taylor_Parts/branches/main/protection/required_status_checks/contexts \
  -f 'contexts[]=Protected governance surfaces cannot merge ungated'
```

This appends one context to the existing required-status-check list. It reads nothing and replaces
nothing, which is what makes it safe as a single action.

**Modern equivalent — replaces the whole check list, so it needs the current list first:**

```
PATCH /repos/TaylorService-spec/Taylor_Parts/branches/main/protection/required_status_checks
{
  "strict": <current value>,
  "checks": [ <every existing check>, { "context": "Protected governance surfaces cannot merge ungated" } ]
}
```

Because `checks` is a full replacement, this form silently drops any existing required check that
is omitted. Use the additive POST unless the current list has already been read.

**Do not** use `PUT /repos/.../branches/main/protection`: it replaces the entire protection object
and will clear review requirements, admin enforcement and restrictions that are not restated.

If the repository has moved to rulesets rather than classic branch protection, the equivalent is
one `required_status_checks` rule whose `required_status_checks[].context` is the same string, with
`integration_id` set to the GitHub Actions app so the context cannot be spoofed by another
reporter.

**Verification after the single call** (one read, not a poll): re-read
`/repos/TaylorService-spec/Taylor_Parts/branches/main/protection/required_status_checks` and confirm
the string appears once, exactly as written.

**Rollback:** `DELETE` the same `/contexts` endpoint with the identical body.

---

## 6. Optional follow-on, not authorized here

`operational-payload-guard.yml` (`No committed operational record snapshots`) and `gitleaks.yml`
(`gitleaks`) are already structurally eligible and could be added in the same single call by
extending the `contexts[]` array. `vite-build-check.yml` should not be required until its job is
renamed away from the ambiguous `build`. None of that is authorized by the ruling above; it is
recorded so the next decision starts from evidence.
