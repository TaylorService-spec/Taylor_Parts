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

## The concurrent-write RUNNER that consumes these (built, pure — activation still gated)

The manager can *plan* concurrent sectors and *adapt* to throttling; the runner is what *drains* them. It is
built as pure, injected, tested orchestration — the same discipline as `runIntakeExecution`/`executeWake` — so
the logic is verifiable in CI while the real spawn is a wiring step, not a rewrite. It does **not** run on its
own and does **not** merge anything; the existing single-worker EOS flow is untouched.

1. **Per-request atomic claim** — `makeRequestClaim(requestId, {lockRoot, fs, ...})` in `wakeLease.mjs`. Reuses
   the proven atomic-mkdir lease verbatim, keyed by `lock/<requestId>`: two workers targeting the same item
   collide and exactly one wins; different requests take different dirs and run concurrently. This is the safety
   primitive that had to land first. *(tested — `wakeLease.test.mjs`)*
2. **Concurrent runner** — `runConcurrentWrites(...)` in `concurrentWriteRunner.mjs`. Drains
   `planConcurrentWriteSectors(items)` **wave by wave** (waves serialized; disjoint items within a wave run in
   batches of the current adaptive concurrency), each item going claim → **revalidate** (rebase on latest `main`
   + re-check the finding, injected) → write → release. `adaptConcurrency` reads `detectThrottle` across each
   batch and self-tunes the fire rate. The worker (real Claude spawn in an isolated worktree), the claim, and
   the revalidate step are all **injected** — fakes in tests, the real spawn in production. A failed worker
   becomes a recorded outcome so a wave keeps draining. *(tested — `concurrentWriteRunner.test.mjs`, incl. the
   `#826/#827` shared-`auditEventWriter.ts` case landing in different waves)*

3. **Concurrent EOS driver** — `runAuthorizedWritesConcurrently(...)` in `context/intake-concurrent-runtime.mjs`.
   The wiring that turns (1)+(2) into EOS-safe parallelism. **It never authorizes anything**: it only decides
   *which* already-EOS-authorized items co-run (disjoint sectors) and *how many* (throttle-adaptive), and carries
   every item through the EXISTING per-item path — `executeIntakeItem` — so the authorization gate, capability/
   protected-boundary checks, completion-semantic gate, and `status://`/`result://`/`REVIEW_READY` write-back are
   identical to the serial path. An EOS-BLOCKED item stays BLOCKED (the runner cannot promote it). The runner
   owns the per-request claim; the wrapped `executeIntakeItem` gets a **no-op lease** so exclusivity is contended
   in exactly one place. Attempt persistence is included: a failed run increments `attempts`/`lastAttemptAt`
   (injected store → the durable status field in production) and `decideRetry` gates the NEXT wake — holding
   during backoff and escalating to the Owner after the bounded budget, instead of re-spawning a paid worker.
   *(tested — `context/intake-concurrent-runtime.test.mjs`: disjoint-concurrent/serialize, authorization-not-
   bypassed, no-op-lease, backoff hold, owner-escalation, attempt persistence, claim-held skip)*

Remaining to actually flip it ON (touches the Owner-gated execution workflow — needs live verification, NOT in
this repo-only change and gated behind a new default-off variable):

4. **Live workflow flip** — enumerate the eligible EXECUTION_AUTHORIZED items (with their declared write scope as
   `paths`), call `runAuthorizedWritesConcurrently` behind a new `EOS_CONCURRENT_WRITES_ENABLED` variable
   (default OFF ⇒ single-worker path unchanged), provide the real worktree-isolated `runWorker` (each worker in
   its own worktree, rebasing on latest `main` + revalidating before write), and feed `adaptConcurrency` into the
   readiness governor instead of the constant `remoteAiMax:1`.

Order still matters: the claim (1) is the safety primitive, in place before (2) writes in parallel, and (3)
guarantees every parallel worker is still an owner-approved-through-EOS execution before (4) turns it live.

## Activation preconditions (narrow assumptions to satisfy before turning live)

The runner is SAFE as an unactivated concurrency primitive; two narrow assumptions must be satisfied (or
explicitly constrained) before live parallel execution — they are *preconditions*, not redesigns:

1. **Shared/durable lock storage for multi-host.** `makeRequestClaim`'s mutual exclusion is `mkdirSync`'s
   atomicity on ONE `lockRoot` filesystem. It excludes duplicate pickup among workers sharing that volume — the
   current single self-hosted runtime, or a shared durable volume. It is **not** distributed locking: two hosts
   on independent local disks do not exclude each other. **Precondition:** run the concurrent runner under a
   single lock-owning host until the lock store is genuinely shared/durable (a real distributed lock).
2. **Concrete, normalized paths in.** `planConcurrentWriteSectors` proves disjointness structurally over
   concrete paths — exact equality **and** directory containment (`src/foo` ∋ `src/foo/bar.js`), with any
   glob/wildcard scope treated as unprovable → its own wave (fail-safe). What it cannot see from a path alone —
   **rename source/target pairs, generated or shared output files, case-insensitive-fs collisions** — must be
   declared or normalized by the caller. **Precondition:** the item feed supplies concrete, normalized write
   paths (globs pre-expanded; both rename ends and any shared/generated outputs declared) before waves are used
   to drive real parallel writes. Un-normalized or glob-bearing items still run safely — just serialized alone.
