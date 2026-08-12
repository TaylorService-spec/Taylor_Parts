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

## 10b. Verifier Agent (EOS-ISSUE-819)

A bounded, evidence-driven check on agent-produced work — layered on the existing contracts, **not a
second orchestrator, queue, scheduler, or authority layer.** Implementation:
[`lib/verifierAgent.mjs`](./lib/verifierAgent.mjs) /
[`lib/verifierAgent.test.mjs`](./lib/verifierAgent.test.mjs).

**Contract reuse, not a parallel system.** A verification is an ordinary `AgentRequest` with the
existing `mode: "VERIFICATION"` (§1). Two placements share the same primitives — only what's being
inspected differs:

1. **Pre-dispatch (semantic).** `createPreDispatchVerificationRequest()` — AFTER deterministic
   contract/preflight validation has already passed but BEFORE a request is dispatched to a worker at
   all. For judgment calls a pure validator cannot make (does this request's purpose/scope actually
   cohere with governing docs?) — never for syntax a deterministic check already proves.
2. **Post-worker (evidence).** `createVerificationRequest()` — built from the worker's request +
   result, before the result is accepted/consumed/consolidated.

Both copy `scope` verbatim from the thing being checked (never wider) and go through the **same**
`decideDispatch()` (§2), the **same** resource governor (§3), the **same** network-aware gating (§4) —
no new dispatch path exists for either placement.

**Evidence-driven, not summary-trusting.** The Verifier is dispatched as a bounded worker against the
`allowedSurfaces` above — it independently inspects those repository/context surfaces itself; it is
never handed only the worker's prose summary to grade.

**What it must detect**, as a typed `CLAIM_FAILURE_CATEGORIES` vocabulary: `UNSUPPORTED_CLAIM`,
`INVENTED_ARTIFACT` (nonexistent file/function/commit/issue/test/capability), `CONTRADICTS_REPO_STATE`,
`SCOPE_DRIFT`, `MISSED_CONSTRAINT`, `STALE_EVIDENCE`, `INTERNAL_CONTRADICTION`, `SHOULD_BE_UNVERIFIED`.
Each finding (`createVerifierFinding`) carries the exact failed claim, the evidence gap, and a
corrective instruction.

**Verdict.** `deriveVerdict()` reads the Verifier's own `AgentResult` (never the worker's) and returns
`PASS` / `RETURN_FOR_CORRECTION` / `ESCALATE`. Ambiguity (`NOT_APPLICABLE`, or an unresolved verdict)
resolves to `ESCALATE`, never a silent `PASS` — the same "downgrade to UNVERIFIED rather than assert as
fact" principle applies to the Verifier's own output.

**Bounded correction loop.** Worker → Verifier → `PASS` or `RETURN_FOR_CORRECTION` → the **same** Worker
corrects → Verifier rechecks. `createVerificationSession()` / `advanceVerificationSession()` track this
as a pure state machine with a conservative default cap, `DEFAULT_MAX_CORRECTION_LOOPS = 2` (no standing
policy justifies a smaller number). Once the cap is reached without a `PASS`, the session status becomes
`ESCALATE` — routed to the existing orchestrator/Owner boundary (§9/§10), never an indefinite ping-pong.

**Cannot broaden scope.** `guardVerifierScope()` partitions findings into `inBounds` and `outOfBounds`:
any finding marked `proposesScopeExpansion` (the Verifier arguing for doing *more* than the original
request, rather than reporting a defect in what was claimed) is routed to `outOfBounds` and is **never**
surfaced as an actionable corrective instruction or allowed to affect the verdict. The Verifier reports;
it does not become product/architecture authority. **AGENT OUTPUT ≠ PRODUCT AUTHORITY** (§1) applies
twice over here — neither the worker's result nor the Verifier's result is itself product authority.

**Spend/value tracking.** `verificationSpendSummary()` records correction count, pass/fail/escalation,
verifier and worker token/runtime totals *only where the runtime exposed them* (§6 — never fabricated),
and whether a correction pass actually changed/retracted material claims (`claimsChanged`) — the signal
that verification earned its spend, not just added overhead.

**Deterministic preflight is a separate, cheaper mechanism — not the Verifier Agent.**
`checkRequiredHeadings()` is plain string matching with no agent call, no independent-inspection worker,
and no `VERIFIER_VERDICTS` output. Example (Issue #818): an intake artifact missing its required literal
`## Scope` / `## Required work` headings is caught by this deterministic check *before* any
`AgentRequest` is ever created — a Verifier Agent call is never spent on a defect a string match already
catches.

## 11. Anti-over-engineering

Smallest local/repo-native mechanism consistent with #703/#710/#715/#716: pure libs + durable files + the
existing harness + the existing projection. **No** distributed queue, message broker, cloud scheduler,
orchestration database, web dashboard, or BPM engine.

## 12. Integration backlog projection

[`integration-backlog.json`](./integration-backlog.json) is the single durable Agent Manager record for
completed, verified work awaiting governed integration or deployment. It is orchestration state, not a
second scheduler: `planIntegrationBacklog()` in the existing `agentManager.mjs` only derives ordering and
the next item per `repo#branch`; it never dispatches, approves, verifies, applies, commits, or deploys.

Each item records `requestId`, target repo/branch, the approved hash-bound patch or result, numeric priority,
dependencies, changed paths plus detected `overlappingPaths`, verification and approval state, integration
readiness, explicit scope/hash gate state, and any blocker. READY items are topologically ordered first, then security/integrity priority,
path conflicts, and ordinary priority/declaration order. Mutations sharing a repo+branch expose one next item
and remain serialized by the governed integration workflow. Missing dependencies, blocked verification or
approval, invalid records, and dependency cycles fail closed. With no integration item, ordinary Agent
Manager request selection is byte-for-byte the existing behavior.

Lifecycle: verified output is recorded `BLOCKED` until its exact artifact is approved and its verification,
scope, and hash states are all `PASS`; it may then become `READY`. The projection identifies one next item
per target lane, but the existing governed integration path re-verifies every gate before mutation. Success
retains the item as `INTEGRATED` so dependents can become eligible and replay evidence remains durable;
failure returns it to `BLOCKED` with the exact blocker. Integrated records are not deleted while referenced.
