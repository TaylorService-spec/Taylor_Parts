# Design: Transaction Safety for `updateJobStatus()`

Branch: `sprint-3.1-transactional-completion`
Related: [jobActions.js](../../field-ops-app-vite/src/domain/jobActions.js)

## Current workflow

### What documents does `updateJobStatus()` modify?

`updateJobStatus(job, nextStatus)` ([jobActions.js:29-48](../../field-ops-app-vite/src/domain/jobActions.js#L29-L48)) can touch up to two documents per call, via two independent, non-atomic writes:

1. `jobsStore.update(job.id, { status: nextStatus })` — always.
2. `techniciansStore.update(job.technicianId, { status: TECH_STATUS.AVAILABLE })` — only when `nextStatus === JOB_STATUS.COMPLETE` and `job.technicianId` is set.

There is no `runTransaction` or `writeBatch` wrapping these two calls — they are sequential `await`s against separate documents.

### Which transitions does it handle?

Per `canTransitionJob()` ([jobWorkflow.js](../../field-ops-app-vite/src/domain/jobWorkflow.js)), the legal transitions are:

| From | To | Docs written by `updateJobStatus` |
|---|---|---|
| `ASSIGNED` | `IN_PROGRESS` | job only |
| `IN_PROGRESS` | `COMPLETE` | job + technician |

### Which transitions are already handled by `assignJob()`?

`assignJob()` ([jobActions.js:50-87](../../field-ops-app-vite/src/domain/jobActions.js#L50-L87)) owns the `OPEN → ASSIGNED` transition. It is already transactional: a single `runTransaction` reads the technician doc, verifies `status === AVAILABLE`, and atomically writes `job.status = ASSIGNED` + `technician.status = ON_JOB`, throwing `AssignmentConflictError` if the technician was claimed concurrently.

So of the three job-status-changing entry points, one (`assignJob`) is atomic and contention-safe; the other (`updateJobStatus`) is neither, for the one transition where it writes two documents.

## Failure analysis

### The partial-write scenario

On `IN_PROGRESS → COMPLETE`, `updateJobStatus` does:

```js
await jobsStore.update(job.id, { status: nextStatus });               // write 1
if (nextStatus === JOB_STATUS.COMPLETE && job.technicianId) {
  await techniciansStore.update(job.technicianId, { status: TECH_STATUS.AVAILABLE }); // write 2
}
```

If write 1 succeeds and write 2 never completes, the job document reads `COMPLETE` while the technician document is left at `ON_JOB` indefinitely.

### How it can happen

- **Network interruption**: the client's connection drops between the two `await`s (e.g., a field technician's phone loses signal walking out of a building right after tapping "Complete").
- **Browser/tab/app close**: the user closes the tab, kills the app, or the OS suspends it between the two writes — nothing resumes the second write.
- **Transient Firestore error**: write 2 hits a retryable error (quota, backend blip) and the client doesn't retry it (the `catch` in `updateJobStatus` logs and rethrows, but write 1 has already committed by then — there's no compensating rollback).

None of these require concurrent access or contention; a single actor, acting alone, on a flaky connection, can trigger this.

### Operational impact

- The technician's `status` field is stuck at `ON_JOB` with no job pointing at them (their last job is `COMPLETE`).
- Nothing else in the codebase ever transitions a technician back to `AVAILABLE` except this code path, so the technician silently disappears from the assignable pool.
- `assignJob()`'s transactional check (`techSnap.data().status !== TECH_STATUS.AVAILABLE`) will correctly refuse to assign this technician new work — but for the wrong reason (stale state, not an actual conflict), and with no error message pointing at the root cause.
- Recovery today requires manual intervention (dispatcher inspects Firestore directly, or an admin action) — there is no self-healing path and no monitoring/alerting mentioned in the codebase that would surface this automatically. In a small crew, a single stuck technician is a meaningful fraction of available capacity.

## Implementation options

### 1. Keep current implementation

- **Pros**: no change, no risk of introducing a regression right now.
- **Cons**: leaves the partial-write bug in place; ships known-bad state-consistency behavior into a live dispatch tool.

### 2. Use `writeBatch`

- Wraps both writes so they commit atomically (all-or-nothing), fixing the partial-failure case.
- Cheaper than a transaction: no read phase, no server-side contention handling, single round trip commit.
- **Limitation**: a batch cannot read-and-validate before writing. It would blindly write `status: COMPLETE` even if another actor had concurrently changed the job's state in a way that makes the transition invalid (e.g., a stale client re-completing a job, or reassignment races). Since `canTransitionJob` is currently only checked client-side against a potentially stale `job` object, a batch doesn't close that gap — it only fixes atomicity, not staleness.

### 3. Use `runTransaction`

- Mirrors `assignJob()`'s existing pattern: `tx.get()` both documents, re-validate `canTransitionJob(freshJob.status, nextStatus)` inside the transaction, then `tx.update()` both documents.
- Fixes both the atomicity problem (no partial writes) and the staleness problem (re-check against the server's current state, not the client's cached copy), at the cost of one extra read and Firestore's standard optimistic-retry behavior under contention (irrelevant here since this transition has no real multi-actor contention, but it's minimal overhead either way).
- Matches the pattern already established and reviewed for `assignJob()`, so it's a one-file, low-novelty change — no new abstractions introduced.

### 4. Move technician availability to a derived state (future architecture)

- Stop storing `technician.status` as an independently-written field at all. Instead, derive "available" vs "on job" by querying whether any job with `technicianId == tech.id` has `status` in `{ASSIGNED, IN_PROGRESS}`.
- This eliminates the dual-write problem structurally — there would be nothing to keep in sync, because there'd be only one source of truth (the job documents) instead of two documents that must agree.
- **Cons**: larger change. Requires either a composite query/index or maintaining the derived value via a Cloud Function trigger (which reintroduces an async consistency window, just moved server-side). Touches `Dispatch.jsx`'s technician-availability list and any other reader of `technician.status`. Out of scope for a bug fix; worth tracking as a follow-up architectural item, not this sprint.

## Recommendation

**Option 3 — wrap `updateJobStatus()` in `runTransaction`, mirroring `assignJob()`.**

Rationale:
- It's the only option that fixes both identified failure modes (partial write *and* stale-read transition validation) rather than just one.
- It reuses a pattern that already exists and is already trusted in this codebase (`assignJob()`), so it doesn't introduce a new atomicity primitive to review or maintain — reviewers already know how to reason about it.
- The overhead versus `writeBatch` (one extra document read) is negligible at this write frequency (a technician completing a job is a low-frequency, human-paced action, not a hot path).
- Option 4 is the architecturally cleaner long-term fix (eliminates the dual-write class of bug entirely) but is a larger, riskier change that reaches into UI call sites and would need its own design/migration pass — not appropriate to bundle into a bug fix. Worth filing as a future sprint candidate.
- Option 1 (do nothing) leaves a real, reachable, single-actor bug live in a production dispatch tool with no auto-recovery.

### Trade-offs of the recommendation

| Dimension | Impact |
|---|---|
| Complexity | Low — same shape as `assignJob()`; one function rewritten, no new files or abstractions. |
| Performance | Negligible — one additional `tx.get()` per completion, on a low-frequency action. |
| Correctness | High improvement — closes both the partial-write and stale-transition gaps; matches the atomicity guarantee already given to `assignJob()`. |
