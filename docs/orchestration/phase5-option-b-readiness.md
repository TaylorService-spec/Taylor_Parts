# Option-B Readiness Assessment (Phase 5, §7)

**Status: assessment for Owner ratification. Option B is OFF.** Per §7, this is the explicit readiness readout
that precedes any activation of unattended self-scheduling. The Owner ratifies activation separately; nothing
here turns Option B on, and ceilings remain `2/1/1`.

## Proven prerequisites (evidence in-repo)

| Prerequisite | Evidence |
|---|---|
| Durable, no-relay request/result routing (Design + UX) | Phase 3 #719/#720 + Phase 4 #722 — `agent-requests/` ledger; Owner relay count **0** |
| Global resource ceiling enforced, not exceeded | #719 + #722 — `DR-003` held `READY_BUT_WAITING_RESOURCE` at `REMOTE_AI 2/2`, dispatched on slot-free |
| Read-only network telemetry mapped into governor states | #721 — `networkHealthAdapter` (obvious-facts-only, latency not thresholded), 11 tests |
| Telemetry survives the logger's 12h self-exit at **zero token cost** | #723 — machine-local supervisor (relaunch-if-dead, idempotent, no duplicate); verified live |
| 1 and 2 concurrent remote-AI workers stable | #722 — network `NORMAL` before/during/after 2 concurrent; **no failures** *(one healthy window)* |
| Bounded autonomy policy defined + tested | #724 — work window / budget / retries+backoff / failure containment / checkpoint cadence / recovery, 9 tests |
| Network unavailable/recovery semantics | #721/#724 — `NETWORK_UNAVAILABLE` preserves + local-continues + no retry storm; `RECOVERY` one-worker-first then full |
| Resumability across stop conditions | Phases 3–5 — durable backlog + ledger survive session exit, budget exhaustion, network loss |

## Unproven assumptions (must be proven under supervision before full unattended)

1. **Browser / network-heavy correlation** — Phases 4–5 exercised only read-only, no-browser remote workers.
   The `BROWSER_REMOTE` + `NETWORK_HEAVY` dimensions vs network health are **not yet measured**. Registered as
   the durable proof [`agent-requests/UX-2.request.json`](./agent-requests/UX-2.request.json) (UX-2, a real
   READY item), deferred here under token-budget discipline — it needs a dedicated app+emulator+browser run.
2. **Behavior under a real pressure/outage window** — no `NETWORK_PRESSURE`/`NETWORK_UNAVAILABLE` window
   occurred during the proofs, so the stop-new-remote / preserve / recover path is proven **in code + tests**
   but not **in the wild**.
3. **Autonomy-policy parameters under real unattended load** — the 90-min window, 20-dispatch / 1M-token
   budget proxies, 60s recovery window, and 3-failure containment are conservative *proposals*, not yet
   observed regulating a live unattended run.
4. **Main-loop token budget** — the runtime exposes subagent tokens but **not** main-loop tokens, so the
   budget ceiling relies on countable proxies (dispatch count + exposed-subagent-token sum). Enforcement of a
   true total-token cap is therefore approximate by construction (honest limitation, not a defect).
5. **Cross-session unattended auto-wake** — the runtime boundary from Phase 3 §10 stands: waking an
   independent session with no human present is the essence of Option B and remains unproven here.

## Proposed contract (conservative initial — from #724, pending ratification)

- **Work window:** 90 min/run → `WORK_WINDOW_ELAPSED` (resumable).
- **Concurrency:** unchanged `REMOTE_AI 2 · BROWSER_REMOTE 1 · NETWORK_HEAVY 1`.
- **Budget cap:** ≤ 20 remote dispatches AND ≤ 1,000,000 exposed subagent tokens/window; warn at 75%; hit →
  `BUDGET_LIMIT` (a checkpoint, **not** a Product failure).
- **Checkpoint cadence:** earliest of 30 min · 3 increments/merges · domain transition · budget warn · network
  event · significant finding · context pressure. **Checkpoint ≠ approval gate.**
- **Retry/backoff:** max 1 retry; 30s×2 → cap 300s; **HOLD (no retry)** while network is not `NORMAL`.
- **Network recovery:** `UNAVAILABLE` → stop new remote, preserve, local-continue, no retry storm (hard stop
  if > 30 min); `RECOVERY` → **one remote worker first**, full `2` only after **60s (12 samples) sustained
  health**.
- **Hard stops (the only genuine autonomous stops):** protected action · owner decision · budget limit ·
  failure containment (3 consecutive) · network-unavailable-too-long · work-window-elapsed.

## Remaining risks

- The 2-concurrent stability result is a **single healthy window** → correlation, not causation; a larger
  sample (incl. browser/network-heavy) is needed before trusting it unattended.
- Approximate total-token budget (proxy-based) could under-count real spend if a run leans on main-loop work
  over subagents.
- Unattended action with no human present is inherently higher-consequence; the conservative window + hard
  stops mitigate but do not eliminate this.

## Recommendation

**READY FOR CONTROLLED PILOT — not for full unattended Option B.**

A **supervised, tightly-bounded pilot** (Owner present, Option B still off) is the correct next step because
the remaining unknowns (browser/network-heavy correlation, real pressure behavior, live policy regulation) are
exactly what a controlled pilot proves — under supervision, not unattended. Proposed pilot scope:

1. Run the registered **UX-2 browser/network-heavy proof** (BROWSER_REMOTE + REMOTE_AI concurrent), correlating
   telemetry — closing unproven assumption #1.
2. Exercise the autonomy policy live for **one 90-min supervised window** with the proposed budget cap, watching
   checkpoint cadence + hard stops actually fire — assumption #3.
3. If any `NETWORK_PRESSURE`/`UNAVAILABLE` occurs, observe the preserve/recover path in the wild — assumption #2.

**Full unattended Option B remains NOT READY** until the pilot passes and the Owner ratifies the (possibly
tuned) parameters. Option A stays current throughout.
