#> **SUPERSEDED IN PART (2026-08-16).** The Owner has since ratified
> [`eos-operational-authorization.md`](./eos-operational-authorization.md), which grants bounded unattended
> execution and sets the canonical ceilings (90-min segment, 10-child fail-safe, 20-spawn checkpoint) plus a
> 25% Owner capacity reserve. Operating concurrency remains `REMOTE_AI = 2` as designed here. Read that
> document first; this one remains the design rationale behind the parameters.

 Option-B bounded autonomy contract (Phase 5) — DESIGN ONLY, NOT ACTIVATED

**Status: design (Tier-1). Option B is OFF.** This defines the bounded unattended policy **without activating
it**. Option A (in-session `/loop`) remains current; ceilings stay `2/1/1`; the Owner ratifies activation
separately ([readiness assessment](./phase5-option-b-readiness.md), §7). The parameters live as tested data in
[`lib/autonomyPolicy.mjs`](./lib/autonomyPolicy.mjs) (+ `.test.mjs`) — **conservative initial proposals**,
evidence-informed and easy to tune, not hard-coded behavior.

## 1. Bounded work window & concurrency (§4)

- **Max autonomous work window:** `90 min` per unattended run → `WORK_WINDOW_ELAPSED` hard stop (resumable).
- **Concurrency (UNCHANGED — not raised):** `REMOTE_AI = 2 · BROWSER_REMOTE = 1 · NETWORK_HEAVY = 1`, global.

## 2. Budget ceiling (§4) — measurable, never fabricated

Exact main-loop tokens are **not exposed** by this runtime, so the budget uses **countable proxies + the
exposed subagent-token sum** (the only real token signal): `maxRemoteDispatchesPerWindow = 20`,
`maxExposedSubagentTokensPerWindow = 1,000,000`. `classifyBudget()` → `OK → BUDGET_WARN (≥75%) → BUDGET_LIMIT`.
**Budget exhaustion is NOT a Product failure** — it maps to `BUDGET_LIMIT` / `SAFE_CHECKPOINT` and preserves
resumable durable state (the backlog + the [agent-requests ledger](./agent-requests/)).

## 3. Retries / backoff (§4) — no retry storm

`maxRetriesPerRequest = 1`; exponential backoff `30s → ×2 → cap 300s`. **Network-aware:** in
`NETWORK_PRESSURE`/`NETWORK_UNAVAILABLE`, `retryDecision → HOLD` — never retry against a degraded link.

## 4. Failure containment (§4)

`maxConsecutiveWorkerFailures = 3` → `HARD_STOP (FAILURE_CONTAINMENT)`. A repeatedly-failing request is
quarantined rather than retried into the ground.

## 5. Network unavailable & recovery (§3) — sufficient for unattended operation

- **`NETWORK_UNAVAILABLE`** → stop new remote dispatch (`remoteAllowed = 0`), **preserve** assignments/results,
  **continue LOCAL READY work**, **no retry storm**. Beyond `networkUnavailableMaxMinutes = 30`, checkpoint and
  stop launching new remote work (`NETWORK_UNAVAILABLE_TOO_LONG`). `NETWORK_UNAVAILABLE` ≠ `WORK_FAILED` ≠
  `PRODUCT_BLOCKED` ≠ `OWNER_DECISION`.
- **`RECOVERY`** → require a **stability window** before restoring capacity: **permit ONE remote worker first**
  (`recoveryFirstRemoteConcurrency = 1`), and restore full `2` only after **sustained health** =
  `recoveryStabilityWindowSeconds = 60` (**= 12 samples at the 5s telemetry interval** — evidence-derived from
  the logger's cadence). This reuses the Phase-3/4 `reconcileNetworkState` RECOVERY transition; no new machine.

*This 60s / one-worker-first policy is the conservative initial recommendation. A materially different window
is legitimate (e.g. 5 min) — flagged for Owner ratification in the readiness assessment rather than blocking.*

## 6. Owner checkpoint policy (§5) — checkpoint ≠ approval gate

`shouldCheckpoint()` fires on the **earliest** of: elapsed `30 min` · `3` completed increments/merges · a major
domain transition · a budget threshold (`BUDGET_WARN`/`LIMIT`) · any network event (PRESSURE/UNAVAILABLE/
RECOVERY transition) · a significant finding · context pressure. **A checkpoint reports and continues** — it
only *stops* if it contains a genuine gate (§7). Checkpoint content (same shape the session already emits):
completed · in progress · agents used · tokens where exposed · resource utilization · network health · retries
· blocked/routed · protected actions · genuine Owner decisions · next selected work.

## 7. Hard-stop conditions (§4) — the only genuine autonomous stops

`hardStopReason()` returns non-null only for: `PROTECTED_ACTION` (a protected boundary reached) ·
`OWNER_DECISION` (a genuine material decision) · `BUDGET_LIMIT` · `FAILURE_CONTAINMENT` ·
`NETWORK_UNAVAILABLE_TOO_LONG` · `WORK_WINDOW_ELAPSED`. Everything else continues autonomously. `SAFE_CHECKPOINT`
(context/token pressure) persists state and resumes via a fresh context — it is **not** a stop.

## 8. Resumability

Every stop is resumable: the durable backlog (schedulability state) and the agent-requests ledger (requests +
results) survive session exit, budget exhaustion, and network loss. A future Option-B driver resumes
deterministically from that state — the same repository-backed handoff proven in Phases 3–4.

## 9. Still design-only

Nothing here schedules, dispatches, or spends unattended. Activation requires the separate Owner-ratified
[Option-B readiness assessment](./phase5-option-b-readiness.md).
