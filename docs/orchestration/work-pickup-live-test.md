# Work-pickup lifecycle + LIVE PROCESS TEST evidence

Durable record of the Owner-mandated **work pickup / responsibility visibility** requirement
and the live orchestration acceptance test. Evidence, not authority.

## The lifecycle (worker-agnostic)

`workLifecycle.mjs` — a durable, worker-agnostic (Claude / ChatGPT / Design / UX / Codex /
human) lifecycle that ANNOTATES existing assignments; **not a new queue, not a new Agent
Manager**:

`ASSIGNED → ACKNOWLEDGED → ACTIVE → COMPLETED → CONSUMED`, with the hard invariants
`ASSIGNED ≠ ACKNOWLEDGED ≠ ACTIVE ≠ COMPLETED ≠ CONSUMED`. Four distinct concepts:
**ROUTE** (write the assignment) · **TRIGGER** (attempt to wake — may be impossible today) ·
**ACKNOWLEDGE** (worker confirms) · **EXECUTE** (worker works). A successful ROUTE is never a
successful TRIGGER or ACTIVE. Escalation is advisory **visibility** from EXPLICIT expectations —
`WAITING_FOR_PICKUP` (assigned, not picked up) / `POSSIBLY_STALLED` (active, activity stale) —
**never a failure verdict from elapsed time alone**. `triggerOutcome` records `WOKEN` /
`NO_WAKE_MECHANISM` (the honest FUTURE_SEAM) / `FAILED` / `NOT_ATTEMPTED`. Timestamps are set
only from durable evidence — never fabricated. Projected into the cockpit as **Who's Doing What**.

## LIVE PROCESS TEST — routed UX cockpit acceptance via the Agent Manager (0 Owner relay)

**Run 1 (`UX-COCKPIT-ACCEPT-001`) — CONTAMINATED.** Routed → the subagent was spawned (TRIGGER
= WOKEN) → ACKNOWLEDGED → ACTIVE → COMPLETED. So **the subagent routing path works end-to-end**
with no Owner relay. But the result was **CONTAMINATED**: the worker read the Owner's LOCAL
`project-keystone` + `Taylor_Parts` checkouts, which are **behind origin/main**, and reviewed
the pre-cockpit v1.1 board — producing a false REJECT. Dispositioned `CONTAMINATED`; a
COMPLETED run is **not** CONSUMED.

**Finding (real, distinct from the wake seam):** dispatched review agents read the Owner's
LOCAL filesystem, which drifts behind merged main. A "route a review" can verdict against stale
code unless the target is a known-fresh checkout or the reviewed commit is recorded.

**Run 2 (`UX-COCKPIT-ACCEPT-002`) — the corrective re-route.** Re-routed at FRESH origin/main
worktrees. Full lifecycle → CONSUMED; verdict **ACCEPT_WITH_FINDINGS** against the real merged
cockpit (every §12 section, honesty, and accessibility rule met). Findings: F1 (wrap the
machinery sections in collapsed `<details>`) — actioned; F2 (extend needsYou chip mapping when
a real triageClass ledger arrives) — deferred; F3 (local freshness has no NOT_AUTHORIZED — correct
scoping) — no action.

## What the test proved

- The **subagent** routing path acknowledges + executes with no Owner relay (TRIGGER = WOKEN).
- The genuine limitation surfaced is **not** the wake seam (subagents are spawnable) but
  **review-agent source freshness**: agents read the Owner's drifting local checkout. Recorded
  honestly, not concealed with Owner relay.
- The corrective loop works: **contaminated evidence → durable disposition → re-route with
  corrected input → valid result.** `COMPLETED ≠ CONSUMED`; silence/stale never implies done.
- The standing-session `NO_WAKE_MECHANISM` seam (a Claude/ChatGPT session that cannot be
  externally woken) remains a **FUTURE_SEAM** — not exercised here, and never faked.

**Owner action (not autonomous):** update the LOCAL `project-keystone` + `Taylor_Parts` checkouts
(`git pull` on main) before any local-source review or hosted publish. The launcher detects and
reports stale source; it never auto-pulls.
