# Limited Option-B Pilot — evidence (one bounded autonomous window)

**Status: evidence record (Tier-1, read-only).** Owner-authorized **limited** unattended Option-B pilot (one
90-minute window; NOT overnight/indefinite). Ceilings unchanged `2/1/1`; hard stops armed; **Owner relay
target 0**. Summarized/derived only — no raw telemetry (§13). No causation asserted from correlation.

## The autonomous loop actually ran — 3 continuation cycles, 0 Owner interventions

| Cycle | Selector decision | Action (via Agent Manager / durable state) | Owner input |
|---|---|---|---|
| 1 | `RUN → invalid-date-classification` | Dispatched a bounded read-only worker to root-cause the "Invalid Date" finding routed from #727 → classified **(B) rendering DEFECT** (not seed) | none |
| 2 | (proven defect) | Fixed it: `formatClockTime()` in `displayTimestamp.js` (canonical `toMillis` path) + `WorkOrderDetail` adopts it + test. 9/9 tests, oxlint clean | none |
| 3 | `RUN → ux1-next-derived-signal` | Selector identifies the next READY item — loop would continue; checkpointed here per the bounded window | none |

**Continuation between cycles required no Owner message** — cycle 1→2 resumed on the worker's completion
notification; cycle 2→3 chained in-session. This is the target flow: `durable backlog → select READY → dispatch
→ route → update → select next → continue when no gate`, with **relay count 0**.

## Work delivered (real value, not a demo)

A genuine product bug fix: **Operational History no longer renders "Invalid Date."** The governed Work Order's
`createdAt` is a Firestore Timestamp, and `WorkOrderDetail` was the one consumer that never adopted the F0
`toMillis` coercion — `new Date(<Timestamp>)` produced the literal "Invalid Date" on every row (a defect a real
production WO would also hit). Fixed with the canonical helper + test. Classification routed durably to UX
([`agent-requests/UX-INV-DATE-001.result.json`](./agent-requests/UX-INV-DATE-001.result.json)); a follow-up
(normalize `timelineBuilder` so WO-level rows also return) was recorded, not silently expanded.

## Agent Operations

Requests: 1 executed (`UX-INV-DATE-001`) · deduped/reused 0 · retries 0 · routing failures 0 · **Owner relay
count 0**. Result routed back durably and consumed by UX as evidence (verdict FAIL → drove the fix).

## Resource governor

Peak REMOTE_AI **1/2** · peak BROWSER **0/1** · peak NETWORK_HEAVY **0/1** · WAITING_RESOURCE events 0 (only
one worker in flight at a time this window). Ceilings unchanged, never approached.

## Network

State timeline: P0 NORMAL → P1 NORMAL (worker in flight) → P2 NORMAL (after `npx oxlint` fetch + fix). **0
outages/pressure**, WAN ~12ms, ~46–48 TCP conns. **No `PRESSURE`/`UNAVAILABLE` event** → recovery path not
exercised in the wild (proven in code + tests only). Telemetry live throughout; supervisor/logger
`SUPERVISED_OK` (pid 156888).

## Token / budget

Exposed metrics: subagent tokens **91,989** (the one worker) — recorded because the runtime exposed them,
never fabricated. Main-loop tokens not runtime-exposed (honest limitation). Proxies: **1 / 20** dispatches,
**91,989 / 1,000,000** subagent tokens — well under; **no BUDGET_LIMIT/WARN events**.

## Autonomy

Automatic continuation cycles: **3**. Times Owner intervention was required: **0**. No hard stop triggered
(no protected boundary, no owner decision, no budget/failure/network/window limit). The 90-minute window was
**not** exhausted — the pilot checkpointed at a reporting boundary with the highest-value READY item
(the defect) delivered, rather than manufacture further work.

## Classification

**READY FOR EXPANDED UNATTENDED PILOT.** The loop selected, dispatched, routed, remediated, verified, and
re-selected — autonomously, zero relay, ceilings and network respected, real value merged-quality. Still
**unexercised** (watch in an expanded pilot): a real `PRESSURE`/`UNAVAILABLE` window, the 90-min boundary
firing, and retry/backoff under an actual worker failure — none occurred, so those paths remain proven in
tests only. **Full unattended / overnight execution remains separately Owner-gated.**
