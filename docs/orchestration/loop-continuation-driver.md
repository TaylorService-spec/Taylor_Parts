# Option A — In-session `/loop` continuation driver

**Status: adopted (Owner-ratified 2026-08-09).** This is the **minimum** continuation mechanism from the
[orchestrator design §5](./continuous-workstream-orchestrator.md): the thing that makes a completed/yielded
worker actually **begin the next eligible item** without an Owner response at an ordinary checkpoint. It uses
the existing harness `/loop` (dynamic) + `ScheduleWakeup` primitives — **no scheduler service, no database, no
unattended self-invocation.** Option B (unattended self-scheduling) is **not** built (see §4).

## 1. What the driver is

A driver *iteration* is one worker turn. Each iteration:

1. **Reads durable state** — the [`execution-backlog.md`](./execution-backlog.md) ledger, reconciled against
   its sources (roadmap register, `ACTIVE_WORKSTREAMS.md`, `DECISIONS.md`, Delegation Charter §8.3).
2. **Runs the selection rule** — maps the backlog to work items and calls the pure
   [`lib/selectNextWork.mjs`](./lib/selectNextWork.mjs) `selectNextWork()`, which returns one decision:
   `RUN` · `PREREQUISITE_AVAILABLE` · `CHECKPOINT` · `ROADMAP_COMPLETE`.
3. **Acts on the decision** (table below).
4. **Updates the backlog** — records the item's new state (design §3 transitions) as part of the item's
   `DONE`/blocked transition.
5. **Re-triggers** — while a session is live, `ScheduleWakeup` fires the next iteration. The loop pauses
   **only** on a genuine gate.

The selector is pure and CI-tested ([`lib/selectNextWork.test.mjs`](./lib/selectNextWork.test.mjs)); "the
selection rule runs" is therefore deterministic, not judgment.

## 2. Decision → action

| `selectNextWork()` decision | Driver action |
|---|---|
| `RUN` | Begin (or resume) `item`. Declare it in `ACTIVE_WORKSTREAMS.md`, do the work to capability-completion (Operating Model §6), update the backlog, continue the loop. |
| `PREREQUISITE_AVAILABLE` | A blocked item exposes repo-safe **prerequisite** work (assessment / authority tracing / design / evidence / tests / docs-reconciliation / readiness planning). Begin the prerequisite — the *implementation* stays blocked, its *discovery* is not. |
| `CHECKPOINT` | No actionable work; only genuine gates remain (`OWNER_DECISION` / `PROTECTED_ACTION` / `BUDGET_LIMIT` / passively-blocked). Emit the compact Owner checkpoint (design §6) and **stop**. This is a legitimate terminal state — do **not** manufacture low-value work to stay busy, and do **not** ask the Owner what to work on next; the rule already answered. |
| `ROADMAP_COMPLETE` | Nothing in any non-`DONE` state. Emit a terminal checkpoint and stop. |

## 3. What the loop does and does not gate on

**Continues automatically through** (never an Owner gate): ordinary implementation decisions; a completed
PR/report; a `SAFE_CHECKPOINT` (resume via fresh context); a `TOOL_PERMISSION_BLOCKED` (resolve via the
permission policy §7, then continue); a `BLOCKED_DEPENDENCY` when another actionable item or a repo-safe
prerequisite exists.

**Stops only on** (design §3 genuine stops): `OWNER_DECISION` (material business semantics / canonical
architecture / policy), `PROTECTED_ACTION` (grant / deploy / Rules deploy / prod / destructive — an
authorized operator, not the loop), `BUDGET_LIMIT`, `ROADMAP_COMPLETE`.

## 4. Option B is deliberately deferred

Unattended self-scheduling (cron / `ScheduleWakeup` with no session open) is the **next** maturity stage and
must not be activated until Option A is operationally validated. Per Owner direction, activating B requires an
explicit design for **all** of: budget cap · cadence · maximum autonomous work window · retry/backoff ·
failure containment · Owner checkpoint interval · unattended-spend controls. Until then the driver runs
**only in-session**, and every genuine gate returns control to the Owner.

## 5. Anti-over-engineering

The driver is: a durable backlog table + a pure tested selector + the existing `/loop`/`ScheduleWakeup`
harness + the existing checkpoint presentation. It adds **no** orchestration database, event bus, distributed
scheduler, dashboard, token-billing engine, or workflow engine (design §8).
