# Agent Manager — smarter, throttle-aware, multi-sector scaling

Encodes the intelligence a human manager was performing by hand (decompose into non-overlapping scopes,
dedup, read throttling, bound retries) into the Agent Manager, so it can coordinate more workers without a
person in the seat — **additive**: the existing EOS intake → execute → write-back → auto-trigger flow is
unchanged, and nothing here spawns concurrency on its own.

## What the manager can now do (pure, tested — `agentManager.mjs`)

- **`planConcurrentWriteSectors(items)`** — partitions approved WRITE items into **waves** where every item in a
  wave has a **pairwise-disjoint file-set** (different sectors → safe to write concurrently); items that share
  any path serialize into a later wave. `waves[0]` is the max set of concurrently-writable sectors. Fail-safe:
  an item with no declared paths can't be proven disjoint, so it takes a wave alone. This is the "manage
  multiple non-overlapping areas of write" capability — and it structurally prevents the `#826/#827` fratricide
  (two "different" fixes that shared `access.ts`/`auditEventWriter.ts` land in *different* waves).
- **`detectThrottle(outcome)`** — reads a worker/provider outcome for a system-throttling signal (429 /
  rate-limit / overloaded / retry-after), returning `{throttled, retryAfterSec}`. Wired additively into
  `intake-runtime.executeIntakeItem` so the manager *reads* throttling in operation (surfaced on the result;
  no control-flow change).
- **`adaptConcurrency({current, min, max, throttle, clearStreak})`** — AIMD (additive-increase /
  multiplicative-decrease): halve concurrency on a throttle signal, grow by one after a sustained clear streak,
  bounded `[min,max]`. This is how the manager **learns to read for throttling and self-tunes** how many
  sectors it fires at once — replacing the hardcoded `remoteAiMax:1` stub the design review flagged.
- **`decideRetry({state, attempts, maxAttempts, sinceLastAttemptSec, backoffSec})`** — bounded retry with
  backoff, then `ESCALATE_OWNER`, so a permanently-failing item stops re-spawning paid workers on every wake
  (the cost-bleed the review found). Complements the existing `decideIntakeDispatch` COMPLETE-skip.

## EOS safety (why this doesn't break autonomy)

Every function is PURE and additive; the sequential single-worker runtime (`runIntakeExecution` → `executeWake`
under one lease) is untouched, and the only runtime edit surfaces a `throttled` field on the result — control
flow is unchanged. Full orchestration suite stays green (the only failures are the pre-existing
credential-environment tests, unrelated). `Register ≠ grant · Export ≠ deploy · Merge ≠ live.`

## Follow-on (the concurrent-write RUNNER that consumes these — separate, gated)

The manager is now smart enough to *plan* concurrent sectors and *adapt* to throttling. Actually *running*
multiple writers in parallel is the next step and is deliberately NOT in this change, because it touches the
Owner-gated execution workflow and needs live verification:

1. **Per-request atomic claim** — generalize `wakeLease` from the one dir-global lock to `lock/<requestId>` so
   concurrent workers can't grab the same item.
2. **Concurrent runner** — drain `planConcurrentWriteSectors(approvedItems)` wave by wave, running up to
   `adaptConcurrency(...)` workers per wave in **isolated worktrees**, each rebasing on latest `main` and
   re-validating its finding before it writes (the serial-model freshness guard, applied per wave).
3. **Attempt persistence** — record `attempts`/`lastAttemptAt` in the status so `decideRetry` is enforced live.
4. **Adaptive governor** — feed `adaptConcurrency`'s output into the readiness governor instead of the constant.

Order matters: the per-request claim (1) is the safety primitive that must land before real parallel writes.
