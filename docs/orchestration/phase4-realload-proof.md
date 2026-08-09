# Phase 4A — real-load orchestration proof (evidence summary)

**Status: evidence record (Tier-1, read-only).** Summarizes the controlled real-load exercise of the
[Agent Manager](./agent-manager.md) with live [network telemetry](./network-telemetry.md). Contains
**summarized/derived** results only — no raw machine-local telemetry (§13). No causation is asserted.

## What was exercised (real work, not manufactured)

Three genuine bounded requests through the durable ledger ([`agent-requests/`](./agent-requests/)), zero Owner
relay:

| Request | Workstream · mode | Result | Real tokens |
|---|---|---|---|
| `DR-002` | Design · VERIFICATION | **PASS** — network adapter/loader strictly read-only, no latency thresholding, machine-local overridable path | 37,822 |
| `UX-EX-002` | UX · PERSONA (read-only) | Evidence for UX-1 — 1 **OVERCLAIM** ("Operational History" over derived/approximate data) + 3 HONEST surfaces + questionsRaised | 36,287 |
| `DR-003` | Design · VERIFICATION | **PASS** — Phase-4 CI path filter complete. *Held `READY_BUT_WAITING_RESOURCE` while `REMOTE_AI` was 2/2, dispatched after a slot freed* | 29,406 |

## Resource ceiling — enforced, not exceeded

`DR-002` and `UX-EX-002` ran concurrently → `REMOTE_AI` at **2/2** (the conservative global ceiling). At that
moment the governor decided `DR-003 → READY_BUT_WAITING_RESOURCE (waitingOn: REMOTE_AI)` — the ceiling was
**enforced**, the request **waited** rather than the limit being exceeded, and it dispatched only after a slot
freed. Limits were **not** raised (`REMOTE_AI=2 · BROWSER_REMOTE=1 · NETWORK_HEAVY_REMOTE=1`, global).

## Network correlation (observation, NOT causation)

Live telemetry (netwatch, 5s interval) across the window:

| Phase | Network state | Sample age | Gateway | WAN | DNS | TCP conns |
|---|---|---|---|---|---|---|
| Before dispatch | NORMAL | 5s | 1ms | ~12/22ms | ok | 46 |
| During (2 remote workers in flight) | NORMAL | 3s | 1ms | ~12/22ms | ok | 43 |
| After completion | NORMAL | 3s | 1ms | ~13/21ms | ok | 47 |

**Network remained NORMAL before, during, and after** two concurrent remote workers, with no reachability/DNS
failures and stable latency/connection counts. **No failures occurred.**

## Envelope questions (§9) — answered on the evidence available

- **Is 1 remote AI worker stable?** Yes — trivially (each single worker ran healthy; network NORMAL).
- **Is 2 concurrent remote AI workers stable?** **Yes in this window** — the network stayed NORMAL throughout
  the 2/2 concurrent run with no deterioration. *(One controlled window; correlation, not proof of causation.)*
- **Does browser / network-heavy work correlate with deterioration?** **Not yet measured** — this proof used
  read-only, no-browser workers (`BROWSER_REMOTE`/`NETWORK_HEAVY` unused). Deferred to a later controlled run.
- **Do failures occur while the network is otherwise quiet?** **No failure observed** in this window.
- **Does reducing remote concurrency improve stability?** **Not determinable** — there was no deterioration to
  improve upon here. Requires a window that actually exhibits pressure.

We did **not** intentionally overload the network to find a breaking point (§9), and we do **not** claim agent
traffic caused prior Cox/gateway failures.

## Efficiency (§10)

Requests 5 · executed 5 · deduped/reused 0 · retries 0 · accepted findings 19 · results with real token
metrics 5 · **Owner relay count for routine handoffs: 0.** Real tokens are recorded because the runtime
exposed them; none are fabricated.

## What this proves for Option B (§14)

The **prerequisites** now exist and behaved correctly under real load: the resource governor enforced the
global ceiling; telemetry mapped into the existing network states read-only; `NETWORK_UNAVAILABLE` semantics
(preserve + local-continue, no aggressive retry) are defined and tested; results routed back durably with zero
relay. Still **undefined/undemonstrated** before unattended Option B: browser/network-heavy correlation, a
pressure/outage window (none occurred here), and the budget cap / max work window / checkpoint cadence /
retry-backoff / failure-containment / unattended-spend controls. **Option B remains deferred.**
