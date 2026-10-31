# EOS operational readiness: continuous integration

**This file was created by lane CIP (2026-10-21).** A search of `docs/` on `main` and on `uat/phase2-owner-decisions` found no existing EOS operational-readiness report, so the permanent CI section lives here. When a business-delivery readiness report is created, link to this file from it; keep the two separate. This file reports the health and speed of the delivery pipeline. It says nothing about which business capabilities are delivered.

## CI

Measured from the GitHub Actions history of the workflow "EOS Admin Policy & Workflow Tests", whose required check is **"Admin policy engine -- authorization, workflow, tenancy, schema, seed"**. Values are as of **2026-10-21** and are refreshed by the recipe below. The mechanics and the evidence behind them are in [`ci-performance.md`](ci-performance.md).

| Item | Value (2026-10-21) | Source |
| --- | --- | --- |
| Latest required CI status | `main` push run 39625686373 at `203fcc0e`: **success** (old single-job workflow, before the optimization merges) | `gh run list --workflow eos-admin-policy-tests.yml --branch main --limit 1` |
| Median completion time | Before Phase 1: **26m19s** (17 successful full-lane runs, range 14m00s to 28m20s). After Phase 1 (validation run, one sample): **6m33s** | `ci-performance.md` section 1 |
| PostgreSQL duration | Before: **24m39s** (one serialized step). After: **5m16s** longest of 5 parallel steps | same |
| Total executed tests | Offline **1957**, PostgreSQL **2904** (4861 in total) at `371733f1`. Before: 1946 and 2904 | The gate's job summary prints this every run |
| Unexplained skips | **0.** Three skips occur, each named in the partition map (`expectedSkips`): two offline (no database) and one PostgreSQL (no Firestore emulator). Any other skip fails the required check | Gate job summary; `functions/scripts/adminPolicyPartitions.mjs` |
| Delivery-blocking failures | **0 open.** In the last 40 runs, 6 failed and 10 were cancelled by a newer push. Every failed run was followed by a green run on the same branch. Causes were not classified here | `gh run list` |
| Runner minutes and cost per run | Before: 30 billed minutes, about **$0.18**. After: 36 billed minutes, about **$0.22**. Rate assumed $0.006 per Linux 2-core minute; not from an invoice | `ci-performance.md` section 1 |
| Optimization phase and status | **Phase 1 (parallel PostgreSQL partitions): built, validated, PR open, not merged.** Phase 2 (template database reuse): designed and measured, not recommended yet. Phase 3 (affected-area PR selection): design only, not activated, needs an Owner decision. Firebase-exit CI checks: design only | `ci-performance.md` |

### How to refresh this section

```
gh run list --workflow eos-admin-policy-tests.yml --limit 40 --json databaseId,conclusion,event,headBranch,startedAt,updatedAt
gh run view <run-id> --json jobs      # per-job and per-step timing
```

* Median completion time: the middle value of (run `updatedAt` minus `startedAt`) over the successful runs that ran the full lane. Runs shorter than about three minutes are the lane-irrelevant skip and are excluded.
* PostgreSQL duration: the longest "real PostgreSQL" step among the five partition jobs.
* Total tests, skips: the gate job's summary ("TOTAL: N tests executed, S skipped").
* Runner minutes: the sum of every job's duration, each rounded up to a whole minute for the billed figure.
* Queue wait: a job's `startedAt` minus the time its `needs` finished.
* Delivery-blocking failure: a failed required check on a pull request or on `main` that has not been followed by a green run of the same branch. A cancellation by a newer push is not a failure.

### Standing watch items

* **Concurrency.** The five partitions run in parallel. If the organization's concurrent-job limit binds when three lanes push at once, partitions queue and the wall-clock gain shrinks. Watch queue wait.
* **Adding a PostgreSQL suite** needs one more line (a partition in `.github/ci/eos-admin-policy-postgres-partitions.json`). Forgetting it fails the offline group and names the file and the lightest partition.
* **Balance.** The map was balanced on durations from run 39623688103. Re-balance if one partition regularly exceeds the others by more than a minute; the guard refuses a measured imbalance above 1.25 times the mean.
* **Cancelled runs** (10 of 40) are superseded pushes. A shorter gate shrinks the window; serialized merges and fewer exploratory pushes shrink the count.
