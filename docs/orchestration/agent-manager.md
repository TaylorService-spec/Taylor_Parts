# Shared Agent Manager + Resource-Aware Orchestration (Phase 3)

**Status: repo-native control-plane extension (Tier-1).** Extends the existing durable orchestrator
([#703](./continuous-workstream-orchestrator.md) / [driver](./loop-continuation-driver.md) /
[roadmap projection](./roadmap-projection.md)) — **not a second orchestrator, scheduler, queue, broker, or
database.** Primary goal: **remove the Owner from routine agent handoffs.** Design and UX must not need Rudy
to copy/paste prompts, assignments, context, results, or next-work between sessions.

Target flow: `Design / UX → durable Agent Request → Agent Manager → bounded worker → durable Agent Result →
requesting workstream resumes/consumes.` The Owner is involved only for a genuine `OWNER_DECISION`,
`PROTECTED_ACTION`, or policy/architecture gate.

## 1. Durable Agent Request / Result (no chat as the record)

Requests and results are **files** in [`agent-requests/`](./agent-requests/), governed by pure contracts:

- [`lib/agentRequest.mjs`](./lib/agentRequest.mjs) — `requestId · requestedByWorkstream · parentWorkItemId ·
  purpose · mode (DISCOVERY/VERIFICATION/REVIEW/PERSONA/GENERAL) · modelTier · priority · blocking ·
  contextPacket · allowedSurfaces (smallest sufficient set) · requiresBrowser · mutating · execution
  (REMOTE/LOCAL) · outputContract · budgetClass · retryAllowance · status · evidence`, plus a stable
  `fingerprint` for dedupe.
- [`lib/agentResult.mjs`](./lib/agentResult.mjs) — `resultId · requestId · routedBackTo · status
  (COMPLETE/FAILED) · verdict (PASS/FAIL/NOT_APPLICABLE) · findings · evidence · questionsRaised ·
  scenariosDiscovered · metrics (where available) · retries · contextExpanded · contaminated · retracted`.

**AGENT OUTPUT ≠ PRODUCT AUTHORITY.** A result carries evidence; the requesting Design/UX workstream
interprets it. Nothing here sets product status, roadmap state, or an Owner decision.

## 2. Agent Manager — minimum dispatcher ([`lib/agentManager.mjs`](./lib/agentManager.mjs))

Pure and stateless. `decideDispatch()` returns exactly one action for a request against current state:
`REJECT_INVALID` · `DEDUPE_REUSE` (an equivalent, reusable, current result exists) · `WAIT_NETWORK` ·
`READY_BUT_WAITING_RESOURCE` · `DISPATCH`. Also `selectNextQueuedRequest()` (blocking → priority → order) and
`efficiencyMetrics()`. It is an **execution service under the orchestrator** — never a product/architecture/UX
authority, never a competing scheduler or roadmap. The session driver holds in-flight allocations, runs the
bounded worker (via the harness), writes the durable result, routes it back, releases the slot, repeats.

## 3. Global Resource Governor ([`lib/resourceGovernor.mjs`](./lib/resourceGovernor.mjs)) — required before Option B

Remote network/AI capacity is a **finite shared resource across all of EOS.** Conservative global limits (not
per-workstream): **`REMOTE_AI = 2`**, **`BROWSER_REMOTE = 1`**, **`NETWORK_HEAVY_REMOTE = 1`**, and mutating
remote agents run **sequentially** (`MUTATING_REMOTE = 1`, §7). Design and UX do **not** independently spawn
beyond these. **Local work** — source inspection, git/worktrees, tests, lint, typecheck, builds, emulators,
local browser, roadmap rendering — is `execution: "LOCAL"` and **consumes no `REMOTE_AI` slot.** A request
with no free slot is **`READY_BUT_WAITING_RESOURCE`** — a *transient* wait, kept **separate from**
`BLOCKED_DEPENDENCY`; the selector returns `WAIT_RESOURCE` (retry when a slot frees), never an Owner gate.

## 4. Network-aware state ([`lib/networkState.mjs`](./lib/networkState.mjs))

The household network has shown instability **correlated** with high concurrent remote-agent activity — **not
proven causation**, but designed around defensively with the smallest measurable policy. States: `NORMAL ·
NETWORK_PRESSURE · NETWORK_UNAVAILABLE · RECOVERY`. **`NETWORK_UNAVAILABLE` is not `WORK_FAILED`, not
`OWNER_DECISION`, not a product blocker.** On pressure/unavailability: preserve assignments/checkpoints, stop
launching **new** remote work, **continue local READY work**, and resume remote only after a **stability
window** — never aggressive retry against a failing connection. No adaptive networking beyond this until it is
measured useful.

## 5. Token-efficiency policy (§6)

The Manager acquires the **minimum sufficient independent evidence**, not maximum agent utilization: smallest
context packet, bounded initial surface set, expansion logged, no reviewer stacking, no recursive spawning,
reuse valid existing evidence, dedupe equivalent requests (by `fingerprint`), avoid reruns when materially
relevant state is unchanged (`freshnessAnchor`), bounded retries, compact results. `efficiencyMetrics()`
tracks requests created / executed / deduped / rejected / waiting / retries / accepted findings, and
token/runtime **only where the runtime exposed them** — never fabricated. The efficiency target is
**tokens per useful verified increment**, not total tokens.

## 6. Global registration invariant (§8)

**Any workstream that participates in orchestration MUST register its actionable work in durable state** — the
[execution backlog](./execution-backlog.md) and/or an Agent Request. This includes Design, UX, Agent Manager
requests, results requiring follow-up, and future workstreams. Before the selector may declare **no authorized
READY work**, it must reason over **every registered workstream**. Absent registration is **not** evidence of
completeness. (This closes the real failure the UX integration exposed: the selector reached "no READY work"
while UX work existed only in session state — an integration gap, not a terminal state.)

## 7. Design / UX contract (§7)

Design and UX **request** agents; they do **not** manage global concurrency. Design: create request → continue
non-blocking local work → consume the routed result. UX: create a Persona request → the Manager enforces
read-only / mutating / browser constraints → result routes back. **Mutating personas remain sequential**
(`MUTATING_REMOTE = 1`) unless a future ratified policy changes it. **Persona evidence is evidence, not
product authority.**

## 8. The honest runtime boundary (§10) — no human message bus, and what is genuinely automatable

The durable ledger removes copy/paste **within a session**: a request is a committed file, the Manager decides
and dispatches a bounded worker via the harness Agent tool, the result is written back as a file, and the
requesting workstream's next iteration consumes it — **no Owner relay.**

**Known boundary:** the current Claude runtime cannot, on its own, *wake an independent session* unattended.
So cross-session, no-human-present auto-dispatch is **exactly Option B** and remains deferred (§11). We do not
pretend it is solved. What is implemented is the **maximum local durable handoff**: state, requests, and
results all live in the repo, so any session (Owner-opened or a future Option-B driver) resumes deterministically
without a chat relay. We do **not** move the copy/paste burden to another chat.

## 9. Owner Roadmap extension (§9)

The [#715 roadmap projection](./roadmap-projection.md) gains an **Agent Operations** view (remote/browser
slots, queued requests, running agents + requesting workstream, deduped/skipped, retries, network state,
budget/context health, recent results) — read-only, repo-backed, preserving the existing views and
distinctions. No polished control-center UI yet.

## 10. Option B remains deferred (§11)

Unattended Option B is **not** activated here. It stays gated until at minimum: resource governor proven,
network behavior proven, budget cap + max work window + Owner checkpoint cadence + retry/backoff + failure
containment defined, and Agent-Manager result routing proven. **Option A (in-session `/loop`) remains
current.**

## 10a. Result consumption lifecycle (§23 continuation correction)

A completed agent run is **not** completed parent work. `agentResult.mjs` now carries a
`disposition` (`AWAITING_INTERPRETATION` → `CONSUMED`/`REJECTED`/`STALE`/`CONTAMINATED`).
A COMPLETE result routed to a registered workstream and still `AWAITING_INTERPRETATION` is
actionable continuation work: `resultConsumption.mjs` projects it into an ordinary `READY`
item and feeds it to the **same** `selectNextWork` (no second queue). So a valid unconsumed
result **prevents a false terminal checkpoint**; disposing of it clears the actionable
state; an honest checkpoint remains reachable once nothing is awaiting. Results predating
the lifecycle (no `disposition` field) are historical and never resurrected. A result routed
to an *unregistered* workstream is surfaced as `unroutable` (an ORCHESTRATOR_INTEGRATION_GAP),
not silently dropped. Drivers MUST call `selectNextWorkIncludingResults(...)` (or concat
`interpretationWorkItems(...)`) before concluding a terminal state.

## 11. Anti-over-engineering

Smallest local/repo-native mechanism consistent with #703/#710/#715/#716: pure libs + durable files + the
existing harness + the existing projection. **No** distributed queue, message broker, cloud scheduler,
orchestration database, web dashboard, or BPM engine.
