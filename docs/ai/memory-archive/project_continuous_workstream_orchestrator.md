<!-- ARCHIVED AI WORKING NOTES — NOT AUTHORITY -->
> **Historical AI working notes**, moved out of Claude's private memory on 2026-08-16 so they are
> visible and auditable in the repository. **This file is not authoritative.** The authoritative
> record for this workstream is the linked `docs/` specification, DECISIONS entry, or PR history.
> Retained verbatim so nothing is lost; do not cite it as a decision of record.

---
name: project_continuous_workstream_orchestrator
description: "Continuous Workstream Backlog & Orchestrator — durable schedulability backlog + state machine + selection rule closing the 'completed work doesn't auto-trigger next execution' gap; MERGED #703; two Owner decisions returned"
metadata: 
  node_type: memory
  type: project
  originSessionId: c981623b-0554-459a-9918-1dca1eec1135
  modified: 2026-08-10T01:10:28.430Z
---

**Evidence-driven platform capability (Owner-directed 2026-08-09):** after a worker reports "next item
starting now" and yields the turn, no next invocation starts — prompt text "continue automatically" can't fix
a yielded turn. This is a **continuation-trigger** gap, NOT a state-tracking gap.

**MERGED — PR #703 (origin/main 969b483), docs-only Tier-1, no capability/grant/collection/Rule.**
- `docs/orchestration/continuous-workstream-orchestrator.md` — Taylor **adapter** for the Keystone
  `frameworks/continuous-workstream-orchestration/` methodology (authored liftable; Keystone push is a
  separate-repo follow-up). Contains: the observed failure, a **reuse map** (roadmap register /
  ACTIVE_WORKSTREAMS / AI Engineering Operating Model §1a/§2/§4/§5/§8 / Delegation Charter §8.3 / quality
  adapter §G Run Control Board), the **10-state work-item state machine** (READY/RUNNING/BLOCKED_DEPENDENCY/
  OWNER_DECISION/PROTECTED_ACTION/TOOL_PERMISSION_BLOCKED/SAFE_CHECKPOINT/BUDGET_LIMIT/DONE/ROADMAP_COMPLETE),
  the deterministic **next-eligible selection rule** (§4), the **non-gating checkpoint policy** (§6; fixed
  content shape), the **tool-permission two-class policy** (VERIFICATION pre-authorize vs PROTECTED
  gate+deny), and the anti-over-engineering boundary (NO db/bus/scheduler/dashboard/BPM engine).
- `docs/orchestration/execution-backlog.md` — seeded Taylor **instance** (the live READY/BLOCKED/
  OWNER_DECISION/PROTECTED_ACTION/DONE ledger). Sources win over the table; worker updates it on each DONE.

**BOTH returned Owner decisions RATIFIED 2026-08-09 + implemented:**
1. **Continuation trigger → Option A** (in-session `/loop`). Driver MERGED PR #710: pure zero-dep tested
   selector `docs/orchestration/lib/selectNextWork.mjs` (RUN/PREREQUISITE_AVAILABLE/CHECKPOINT/
   ROADMAP_COMPLETE; resumes in-flight before new READY; TOOL_PERMISSION_BLOCKED stays actionable; unknown
   state fail-closed) + 11 node:test + own zero-dep CI lane + `loop-continuation-driver.md` contract +
   §4.3b **blocker-decomposition correction**. **Option B (unattended self-scheduling) NOT built** — deferred,
   needs explicit design for budget cap/cadence/max-window/retry-backoff/failure-containment/checkpoint-
   interval/unattended-spend before activation; validate A first.
2. **Tool-permission policy → ratified.** MERGED PR #712: `.claude/settings.json` two-class — VERIFICATION
   allow (git status/log/diff/show/rev-parse/worktree list; npm build/test; node --test; gh pr view/checks/
   list/diff, gh run view/list) + PROTECTED `deny` (firebase deploy/firestore:delete/functions:delete; gh
   secret; rm -rf/-r; git push --force/-f; git reset --hard; git clean -f). NO `Bash(*)`. Doc
   `.claude/permission-policy.md`. Tool permission ≠ EOS business authority.

**Also MERGED this session:** authority-map currency #706 (Finance/Coverage rows) + #707 (Sales Opportunity/
Order/Fulfillment rows) in SYSTEM_AUTHORITIES.md; backlog reconcile #713.

**8-HR DAYTIME ENDURANCE PILOT (control-plane proof; ceilings 2/1/1 unchanged) — cycle 1: MERGED #734.** Genuine
READY follow-up from #729's routed result: timelineBuilder.js still handed a raw Firestore Timestamp through —
fixed by coercing createdAt via canonical toMillis() (pure) in jobEvents + workOrderEvents filter, so WO-level
Operational History rows RETURN (were dropped by typeof===number) + all events carry numeric millis. Test
`test/workOrderTimeline.test.jsx` (vitest — timelineBuilder uses EXTENSIONLESS imports so node --test can't run
it; only test/**/*.test.jsx under vitest resolves them). SELF-CAUGHT CI-coverage gap: timelineBuilder change
triggered NO vitest lane (only generic build) → added timelineBuilder.js + the test to inventory-parts-ui-tests.yml
path filter (that lane runs test:components=all vitest once triggered). Caught+fixed pre-merge = NOT rework.
Network NORMAL throughout; 0 automation-caused defects; 0 rework; 0 relay. Invalid-Date family now FULLY resolved
(#729 display + #734 builder). LESSON: field-ops domain modules use extensionless imports (vitest-only); a new
domain test must be .test.jsx + its file added to a vitest lane's path filter or it's CI-uncovered.

**OWNER CONTROL CENTER PROJECTION COMPLETION — MERGED Taylor #732 + keystone PR #9 (browser-verified).** The
Control Center adapter/envelope (`docs/orchestration/lib/controlCenterAdapter.mjs` + `controlCenterContract.mjs`,
built by ANOTHER session; placement doc `owner-control-center-placement.md`) is the ONLY thing keystone depends
on; keystone renders, Taylor owns truth. Filled the 4 Taylor projection gaps by EXTENDING the existing adapter
(schema 1.0.0→1.1.0 additive): (1) uxBoard NOW populated — added `UX / Experience` domain to the ONE roadmapModel
(UX-1 #714/#717, Invalid-Date #729, UX-2 #727/#731, UX-3 grain=OWNER_DECISION); projectUxBoard already filtered
owner==UX. (2) agentOperations from the durable ledger via projectAgentOperations. (3) networkHealth = sanitized
telemetry summary only. (4) recentProgress = new projectRecentProgress (DONE+PR-evidence, PR-number-ordered, NOT
a git dump). Adapter AUTO-LOADS the project's own agent-requests/*.json + telemetry-summary.json (relative to its
module) so keystone's unmodified import-envelope carries real data; fail-closed UNKNOWN when absent; autoLoad:false
for tests. keystone repo (cloned TaylorService-spec/project-keystone; NOT a remote here) apps/control-center/
views.js updated to RENDER the 3 sections from project.payload.* (were hardcoded PROJECTION GAPs) — no reach-around.
VERIFIED: keystone real renderProject shows Agent Ops(slots+relay 0)/Network(NORMAL)/Recent(PRs)/UX board(Coord
Visits) from real data; keystone test 10/10; 12 adapter+17 projection tests; new CI lane orchestration-control-
center-tests.yml. Ran under expanded Option-B pilot (3hr/2/1/1); network NORMAL throughout; 0 automation-caused
defects; 0 Owner relay. keystone browser cache is SPA-one-time-load (no-cache headers) — verify via node
renderProject, not stale browser. LESSON: to browser-render a NEW envelope section, keystone views.js needs a
renderer (adapter data ≠ auto-rendered); that's renderer work, not reach-around.

**LIMITED OPTION-B PILOT — MERGED #729 (Owner-authorized ONE 90-min unattended window; ceilings 2/1/1; hard
stops armed; relay target 0).** The autonomous loop ran: cycle1 selector→RUN invalid-date-classification→
dispatched worker (classified rendering DEFECT, 91989 tok)→ cycle2 FIXED it→ cycle3 selector→RUN next READY
(checkpointed)→ cycle4 (bonus) CI-failure→root-caused→converged. 0 Owner interventions. DELIVERED: (1) real fix
"Operational History never renders Invalid Date" — added formatClockTime() to displayTimestamp.js (canonical
toMillis path) + WorkOrderDetail adopts it + test; WorkOrderDetail was the one consumer that never adopted the
F0 toMillis coercion (governed WO createdAt = Firestore Timestamp; new Date(Timestamp)=Invalid Date). (2)
CONVERGENCE: fixed pre-existing main-red lane (notificationPanelNames.test.jsx asserted bare getByText("HIGH")
but #696 changed render to "Request urgency: HIGH"; Inventory Parts UI lane red on main since 2026-08-08,
blocking ALL field-ops PRs) → now green. Network NORMAL throughout (P0..P3, 0 outages); governor peak REMOTE_AI
1/2; logger SUPERVISED_OK + survived. Budget proxies 1/20 dispatches, 91989/1M tokens, no BUDGET events. NO
pressure/unavailable window occurred → recovery/90-min-boundary/retry-under-failure STILL unexercised.
CLASSIFICATION: **READY FOR EXPANDED UNATTENDED PILOT** (full/overnight still separately Owner-gated).
`phase5-limited-pilot-evidence.md`. LESSON: shared working tree D:/Taylor_Parts STALE on docs/issue-100 (a652f61)
— serve app from a fresh worktree, do NOT reset the shared tree (Owner directive).

**PHASE 5 CONTROLLED SUPERVISED PILOT — MERGED #727 (Owner ratified pilot; Option B stayed OFF; ceilings 2/1/1
unchanged).** Ran UX-2 browser/network-heavy proof end-to-end. GOTCHA: shared working tree D:/Taylor_Parts is on
STALE branch docs/issue-100 (a652f61) missing #674/#683 coordinated-visits surfaces — served main's app from
the pilot WORKTREE instead (npm install warm=10s; did NOT disrupt shared tree / other sessions). Brought up
Firestore/Auth emulator + seed (run-field-ops-app-vite skill; chromium already installed) + vite; drove via mcp
browser to /service/coordinated-visits as seeded admin. UX-2 finding (evidence-not-authority): SAMPLE treatment
present at BANNER + per-row inline markers (#683) → ACCEPTABLE; incidental UX-1 find = "Invalid Date" Operational
History timestamps. NETWORK stayed NORMAL T0..T4 (baseline→npm install→emulator+dev→browser-active→teardown, 0
outages) — browser/network-heavy load did NOT degrade network (correlation not causation; NO pressure window
occurred). GOVERNOR: UX-2 footprint {remoteAi:1,browser:1}; 2nd browser→READY_BUT_WAITING_RESOURCE (browser
ceiling=1 enforced); concurrent non-browser REMOTE_AI→DISPATCH. Logger SURVIVED app teardown (independence).
Zero Owner relay. `phase5-pilot-evidence.md`. READINESS AFTER PILOT: **READY FOR LIMITED (short/budget-capped/
still-supervised) UNATTENDED PILOT; FULL unattended Option B STILL NOT READY** until a real pressure window +
live 90-min/checkpoint/retry machinery observed. Owner ratifies activation separately. Telemetry Scheduled-Task
registration STILL Owner-run (not installed). netwatch logger home %LOCALAPPDATA%\EOS\netwatch (pid may need
supervisor relaunch after 12h until the task is registered).

**PHASE 5 — Unattended-Readiness Proof + Bounded Autonomy Policy MERGED #723 (supervisor) + #724 (autonomy
contract) + #725 (readiness assessment).** Persistent telemetry SUPERVISOR `docs/orchestration/telemetry/
netwatch-supervisor.ps1` (machine-local, relaunch-if-dead, idempotent NO-duplicate, writes sanitized
netwatch-health.json; verified live: relaunched after kill, no dup on re-run). Kept alive by a per-user
Scheduled Task = ZERO Claude tokens — but REGISTERING that task is standing OS config = OWNER-RUN (classifier
correctly blocked auto-install; README has the one-time command). `summarizeLoggerHealth` (SUPERVISED_OK/
LOGGER_DOWN/TELEMETRY_STALE/SUPERVISOR_SILENT/NO_SUPERVISOR_HEALTH). BOUNDED AUTONOMY POLICY (DESIGN ONLY, pure
tested `autonomyPolicy.mjs`): window 90m · concurrency UNCHANGED 2/1/1 · budget = countable dispatch(20)+
exposed-subagent-token(1M) proxies (main-loop tokens NOT runtime-exposed, never fabricated) · retries 1 +
network-aware backoff (HOLD in pressure/unavailable=no retry storm) · failure-containment 3 · checkpoint cadence
· recovery ONE-worker-first then full after 60s=12-sample stability window · hard-stops. Budget exhaustion/
context/network-loss ≠ Product failure → BUDGET_LIMIT/SAFE_CHECKPOINT resumable. OPTION-B READINESS ASSESSMENT
`phase5-option-b-readiness.md`: **RECOMMENDATION = READY FOR CONTROLLED PILOT (supervised, Option B still OFF)**;
full unattended NOT READY until pilot proves browser/network-heavy correlation + a real pressure window + live
policy regulation. UX-2 browser/network-heavy proof REGISTERED durably as BROWSER_REMOTE request (deferred from
Phase-5 close under token discipline — did NOT force the ~150MB chromium+emulator+driver stack at session tail).
Ceilings UNCHANGED. Option B still OFF; Owner ratifies pilot/activation separately.

**PHASE 4 — Network Telemetry Integration + Real-Load Proof MERGED #721 (adapter) + #722 (proof + Agent-Ops
network view).** Discovered the EXISTING standalone `netwatch.ps1` logger (contract `ts,gw_ms,wan1_ms,wan2_ms,
dns,tcp_conns`; 5s; gateway 192.168.0.1 + WAN 1.1.1.1/8.8.8.8; DNS; FAIL markers; 12h self-exit), gave it a
DURABLE machine-local home `%LOCALAPPDATA%\EOS\netwatch\` (script copied UNCHANGED, runs independently; pid
tracked; **12h self-exit = known limitation, re-launch is a local action — NOT modified per "don't recreate"**).
`docs/orchestration/lib/networkHealthAdapter.mjs` (PURE, READ-ONLY) deriveNetworkHealth(csv,nowMs)→ maps into
EXISTING networkState (NORMAL/PRESSURE/UNAVAILABLE/RECOVERY reused, no new machine); OBVIOUS-FACTS-ONLY
(reachability/DNS/staleness); latency REPORTED not thresholded (Phase 4A); stale/absent telemetry THROTTLES
(PRESSURE) never HALTS. `networkHealthLoader.mjs` fs wrapper + sanitizedTelemetrySummary. Telemetry NEVER in
git (.gitignore + sanitized summaries only). REAL-LOAD PROOF: DR-002 (Design VERIFICATION→PASS read-only
invariant, 37822 tok) + UX-EX-002 (UX PERSONA→UX-1 evidence: "Operational History" OVERCLAIM over derived data
+ 3 HONEST, 36287 tok) + DR-003 (held READY_BUT_WAITING_RESOURCE at REMOTE_AI 2/2, dispatched on slot-free→PASS,
29406 tok). Network NORMAL before/during/after 2 concurrent; no failures; ceiling ENFORCED not exceeded; OWNER
RELAY=0. Correlation NOT causation. Roadmap Agent-Ops §9 shows network state/latency/slots/relay/proof. Limits
UNCHANGED (2/1/1). `phase4-realload-proof.md`. **Option B STILL deferred** (browser/network-heavy correlation +
a real pressure window + budget/window/cadence/backoff/containment/unattended-spend still undefined). 14/14
acceptance criteria met.

**PHASE 3 — Shared Agent Manager + Resource-Aware Orchestration MERGED #719 (core) + #720 (Agent Ops view +
operational exercise).** Extends the control plane (NOT a 2nd orchestrator) so Design/UX request bounded workers
via durable FILES, not Owner copy/paste. `docs/orchestration/lib/`: agentRequest/agentResult (durable contracts;
AGENT OUTPUT≠PRODUCT AUTHORITY), resourceGovernor (GLOBAL caps REMOTE_AI=2/BROWSER=1/NETWORK_HEAVY=1/mutating
sequential; LOCAL work=no slot; no slot→READY_BUT_WAITING_RESOURCE transient≠blocker), networkState (NORMAL/
PRESSURE/UNAVAILABLE/RECOVERY; UNAVAILABLE≠fail/owner/blocked→preserve+local-continue+stability-window, no
aggressive retry; correlation NOT proven causation), agentManager (dispatcher REJECT_INVALID/DEDUPE_REUSE/
WAIT_NETWORK/READY_BUT_WAITING_RESOURCE/DISPATCH + queue + efficiencyMetrics tokens-only-where-exposed).
selectNextWork +READY_BUT_WAITING_RESOURCE state +WAIT_RESOURCE decision. Global registration invariant (§8):
every workstream MUST register durable work; absent registration≠complete. `agent-manager.md` §8 HONEST RUNTIME
BOUNDARY: cross-session unattended auto-wake IS Option B (deferred); max local durable handoff implemented, no
human message bus. Roadmap Agent Ops view (§9) over the ledger. OPERATIONAL EXERCISE proven: DR-001 (Design
VERIFICATION→PASS, requester acted on nuance→locked vocab test) + UX-EX-001 (UX PERSONA read-only→durable
evidence for UX-3: 5 Activity surfaces/grains+questionsRaised, routed to UX). Real exposed tokens recorded
(44196/61118). Ledger `docs/orchestration/agent-requests/`. CI orchestration-agent-manager-tests.yml. Option B
STILL deferred (needs governor+network proven+budget/window/cadence/backoff/containment+routing proven).
UX-2 (live browser recheck) + UX-3 (evidence DONE; residual grain = product OWNER_DECISION) are registered READY.

**PHASE 2 — Owner Roadmap Projection MERGED #715 (+ self-close #718).** Read-only projection over the durable
backlog so Owner inspects EOS progress from repo state, not chat. `docs/orchestration/lib/roadmapModel.mjs` =
SINGLE structured durable roadmap state (EOS→Domain/Program→Capability→Milestone→WorkItem→Evidence; orthogonal
dimension fields impl/activation/backend/userOperable/ux/deploy; validateRoadmapModel; honest UNKNOWN where
not re-verified). `roadmapProjection.mjs` = pure 8 views (Executive/Detailed/Active/Blocked/OwnerDecisions/
Protected/Design-board/UX-board); `generateRoadmapViews.mjs` deterministic renderer → committed snapshot
`docs/orchestration/roadmap/ROADMAP.md`; contract `roadmap-projection.md`. 14 node:test (one per distinction
IMPLEMENTED≠ACTIVATED/MERGED≠DEPLOYED/BACKEND≠USER-OPERABLE/UX≠BACKEND-ACTIVE/PERSONA-FINDING≠PRODUCT-DECISION
+ no-fabricated-% guard) + drift-guarded CI (`orchestration-roadmap-tests.yml`: regenerate + git diff). NO %
except milestone count. Projections not a 2nd roadmap. NO UI/DB — polished UI is a later increment if useful.

**Selection rule run post-merge → TERMINAL CHECKPOINT (legitimate, not manufactured).** After decomposing the
top blocked chain (R-1 catalog-read → read surfaces), its repo-safe R1-A prerequisite (parity corpus + shadow
gate) ALREADY EXISTS + CI-enforced: `functions/src/access/legacyAuthorizationSurface.ts` (47 legacy sites/22
collections, grouped by cutover row 23-26, w/ post-cutover permission IDs) + `legacyAuthorizationSurface.test.mjs`.
Impactful R-1 remainder (criterion-6 PROD evidence, Row 19 authorization, R1-C cutovers) all PROTECTED/Owner-
gated. Remaining OWNER_DECISIONs: R-1 catalog-read model, coverage precedence/credit/commission, rev-rec,
cycle-counts/back-orders. "NO AUTHORIZED READY WORK is a legitimate terminal state" (Owner). Do NOT ask what's
next — use the selection rule. See [[project_sales_to_cash_runway]], [[project_commercial_coverage_territory]],
[[project_f_rules_1_legacy_read_scoping]], [[feedback_execution_governance_section_model]],
[[project_agent_orchestration_quality_system]], [[feedback_execution_governance_section_model]].
