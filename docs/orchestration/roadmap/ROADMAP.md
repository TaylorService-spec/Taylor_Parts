# EOS — Owner Roadmap (generated snapshot)

> **Read-only projection** of the durable roadmap model (`lib/roadmapModel.mjs`), rendered by
> `lib/generateRoadmapViews.mjs`. Do not hand-edit — change the model and regenerate. Contract:
> [`roadmap-projection.md`](../roadmap-projection.md).

**Last verified repository state:** `origin/main + Phase-5 pilot (2026-08-09)`

**Distinctions preserved** (each is a separate field, never one number): IMPLEMENTED ≠ ACTIVATED · MERGED ≠ DEPLOYED · BACKEND COMPLETE ≠ USER-OPERABLE · UX COMPLETE ≠ BACKEND ACTIVE · PERSONA FINDING ≠ PRODUCT DECISION. No invented percentages — the only number is a milestone count.

## 1. Executive Roadmap

### Platform & Orchestration _(program)_

| Capability | Owner | Status | Impl | Activation | Backend | UserOp | UX | Deploy | Milestones |
|---|---|---|---|---|---|---|---|---|---|
| Continuous Workstream Backlog & Orchestrator | Product/Design | DONE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | 4/5 |
| Owner Roadmap Projection | Product/Design | DONE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | 1/1 |
| Shared Agent Manager + Resource Governor | Product/Design | DONE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | 2/2 |
| Network Telemetry Integration + Real-Load Proof | Product/Design | DONE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | 2/3 |
| Unattended-Readiness Proof + Bounded Autonomy Policy (Phase 5) | Product/Design | OWNER_DECISION | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | 4/4 |

### Commercial & Sales _(domain)_

| Capability | Owner | Status | Impl | Activation | Backend | UserOp | UX | Deploy | Milestones |
|---|---|---|---|---|---|---|---|---|---|
| Sales Opportunity lifecycle (Cycles 2–3) | Product/Design | PROTECTED_ACTION | IMPLEMENTED | INERT | COMPLETE | false | NONE | NOT_DEPLOYED | 1/1 |
| Sales Order lifecycle (Cycle 4) + Service lineage (Cycle 7) | Product/Design | PROTECTED_ACTION | IMPLEMENTED | INERT | COMPLETE | false | NONE | NOT_DEPLOYED | 1/1 |
| Fulfillment allocation & availability (Cycle 5) | Product/Design | PROTECTED_ACTION | IMPLEMENTED | INERT | PARTIAL | false | NONE | NOT_DEPLOYED | 1/1 |
| Commercial Coverage & Territory (register #15) | Product/Design | PROTECTED_ACTION | IMPLEMENTED | INERT | COMPLETE | false | NONE | NOT_DEPLOYED | 1/1 |
| Coordinated operations projections | Product/Design | DONE | IMPLEMENTED | NOT_APPLICABLE | COMPLETE | UNKNOWN | UNKNOWN | NOT_APPLICABLE | 1/1 |

### Finance / Billing & AR _(domain)_

| Capability | Owner | Status | Impl | Activation | Backend | UserOp | UX | Deploy | Milestones |
|---|---|---|---|---|---|---|---|---|---|
| Money model (exact minor units) | Product/Design | DONE | IMPLEMENTED | NOT_APPLICABLE | COMPLETE | NOT_APPLICABLE | NONE | NOT_APPLICABLE | 1/1 |
| Invoice issuance (per-company sequence) | Product/Design | PROTECTED_ACTION | IMPLEMENTED | INERT | COMPLETE | false | NONE | NOT_DEPLOYED | 1/1 |
| Payment / AR (receipt ≠ application) | Product/Design | PROTECTED_ACTION | IMPLEMENTED | INERT | COMPLETE | false | NONE | NOT_DEPLOYED | 1/1 |
| Adjustments (credit / charge / write-off) | Product/Design | PROTECTED_ACTION | IMPLEMENTED | INERT | COMPLETE | false | NONE | NOT_DEPLOYED | 1/1 |
| Refund (reverses applied payment) | Product/Design | PROTECTED_ACTION | IMPLEMENTED | INERT | COMPLETE | false | NONE | NOT_DEPLOYED | 1/1 |
| Trusted AR read projection | Product/Design | PROTECTED_ACTION | IMPLEMENTED | INERT | COMPLETE | false | NONE | NOT_DEPLOYED | 1/1 |

### Inventory & Catalog _(domain)_

| Capability | Owner | Status | Impl | Activation | Backend | UserOp | UX | Deploy | Milestones |
|---|---|---|---|---|---|---|---|---|---|
| Part Master in-app governed write | Product/Design | AT_REST | IMPLEMENTED | INERT | COMPLETE | false | COMPLETE | NOT_DEPLOYED | 1/1 |
| Manufacturer governed write | Product/Design | BLOCKED_DEPENDENCY | IMPLEMENTED | INERT | COMPLETE | false | PARTIAL | NOT_DEPLOYED | 1/1 |
| Part↔Supplier procurement terms | Product/Design | BLOCKED_DEPENDENCY | PARTIAL | INERT | PARTIAL | false | NONE | NOT_DEPLOYED | 1/1 |
| Supplier Master adoption (Tier-2 program) | Product/Design | AT_REST | IMPLEMENTED | INERT | COMPLETE | false | COMPLETE | NOT_DEPLOYED | 1/1 |
| Governed Receiving (against Purchase Order) | Product/Design | PROTECTED_ACTION | IMPLEMENTED | INERT | COMPLETE | false | COMPLETE | DEPLOYED | 1/1 |

### Access & Authorization _(program)_

| Capability | Owner | Status | Impl | Activation | Backend | UserOp | UX | Deploy | Milestones |
|---|---|---|---|---|---|---|---|---|---|
| R-1 Authorization Convergence (Issue #226) | EAO | PROTECTED_ACTION | PARTIAL | UNKNOWN | PARTIAL | NOT_APPLICABLE | NOT_APPLICABLE | NOT_DEPLOYED | 1/3 |
| Catalog-read authority model | Access | OWNER_DECISION | NONE | NOT_APPLICABLE | NONE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | 1/1 |

### Service & Work Orders _(domain)_

| Capability | Owner | Status | Impl | Activation | Backend | UserOp | UX | Deploy | Milestones |
|---|---|---|---|---|---|---|---|---|---|
| Work Order lifecycle | Product/Design | DELIVERED | IMPLEMENTED | ACTIVATED | COMPLETE | UNKNOWN | UNKNOWN | UNKNOWN | 1/1 |
| Weekly Scheduling workspace | Product/Design | DONE | IMPLEMENTED | UNKNOWN | COMPLETE | UNKNOWN | COMPLETE | UNKNOWN | 1/1 |
| WO Parts Planning | Product/Design | PROTECTED_ACTION | IMPLEMENTED | INERT | COMPLETE | false | UNKNOWN | NOT_DEPLOYED | 1/1 |

### Roadmap Register (identified future capabilities) _(program)_

| Capability | Owner | Status | Impl | Activation | Backend | UserOp | UX | Deploy | Milestones |
|---|---|---|---|---|---|---|---|---|---|
| Service Contracts / Preventive Maintenance | Product/Design | IDENTIFIED | NONE | NOT_APPLICABLE | NONE | NOT_APPLICABLE | NONE | NOT_APPLICABLE | — |
| Warranty / Service Entitlement | Product/Design | IDENTIFIED | NONE | NOT_APPLICABLE | NONE | NOT_APPLICABLE | NONE | NOT_APPLICABLE | — |
| Installed Base / Customer Equipment Lifecycle | Product/Design | IDENTIFIED | NONE | NOT_APPLICABLE | NONE | NOT_APPLICABLE | NONE | NOT_APPLICABLE | — |
| Returns / RMA / Credits / Reverse Commerce | Product/Design | IDENTIFIED | NONE | NOT_APPLICABLE | NONE | NOT_APPLICABLE | NONE | NOT_APPLICABLE | — |
| Temporary Equipment / Placement (#12) | Product/Design | IDENTIFIED | NONE | NOT_APPLICABLE | NONE | NOT_APPLICABLE | NONE | NOT_APPLICABLE | — |
| Technician Labor / Cost Accounting (#13) | Product/Design | IDENTIFIED | NONE | NOT_APPLICABLE | NONE | NOT_APPLICABLE | NONE | NOT_APPLICABLE | — |

## 2. Active Work (RUNNING / READY)

_None._

## 3. Blocked / Dependencies

| Capability | Blocked reason | Dependencies | Routed to |
|---|---|---|---|
| Manufacturer governed write | READ authority waits on R-1 (inventory.catalog.read); manufacturers stays read:if false | authorization-convergence-r1 | authorization-convergence-r1 |
| Part↔Supplier procurement terms | READ service + Purchasing UI gated on R-1 (inventory.catalog.read + .cost.read) | authorization-convergence-r1 | authorization-convergence-r1 |

## 4. Owner Decisions

| Capability | Decision | Blocking? |
|---|---|---|
| Unattended-Readiness Proof + Bounded Autonomy Policy (Phase 5) | Supervised pilot PASSED (UX-2 browser proof: network NORMAL throughout, ceilings enforced, zero relay). Recommendation now READY FOR LIMITED UNATTENDED PILOT (short, budget-capped, still supervised); FULL unattended Option B remains NOT READY until a real pressure window + the 90-min/checkpoint/retry machinery are observed live. Owner ratifies any unattended activation separately. | **yes** |
| Commercial Coverage & Territory (register #15) | Precedence/override/inheritance + sales credit + commission are deferred policy (do not manufacture) | recorded/deferred |
| Trusted AR read projection | Revenue recognition remains a separate future accounting-policy seam (not an EOS engine) | recorded/deferred |
| Catalog-read authority model | Adopt durable inventory.catalog.read (+ separate inventory.catalog.cost.read)? Unblocks Manufacturer + part_supplier_items read surfaces | **yes** |

## 5. Protected / Awaiting Operator

| Capability | Protected boundary |
|---|---|
| Sales Opportunity lifecycle (Cycles 2–3) | Grant opportunity.* + deploy callables |
| Sales Order lifecycle (Cycle 4) + Service lineage (Cycle 7) | Grant salesOrder.* + deploy callables |
| Fulfillment allocation & availability (Cycle 5) | Grant salesOrder.fulfill + deploy |
| Commercial Coverage & Territory (register #15) | Grant coverage.* + deploy |
| Invoice issuance (per-company sequence) | Grant finance.invoice.issue + deploy + Rules deploy |
| Payment / AR (receipt ≠ application) | Grant finance.payment.apply + deploy |
| Adjustments (credit / charge / write-off) | Grant finance.adjustment.record + deploy |
| Refund (reverses applied payment) | Grant finance.refund.record + deploy |
| Trusted AR read projection | Grant finance.read + deploy |
| Governed Receiving (against Purchase Order) | Readiness flip + authorized Hosting release |
| R-1 Authorization Convergence (Issue #226) | R1-B production deployment (Rows 19/20/22) + criterion-6 production evidence + Owner Row 19 authorization |
| WO Parts Planning | Rules deploy |

## 6. Design execution board

Legend: `[x]` done · `[>]` in progress · `[ ]` planned/ready · `[!]` owner decision · `[P]` protected · `[B]` blocked · `[R]` routed · `[-]` at rest.

- [x] Continuous Workstream Backlog & Orchestrator _(Platform & Orchestration)_
- [x] Owner Roadmap Projection _(Platform & Orchestration)_
- [x] Shared Agent Manager + Resource Governor _(Platform & Orchestration)_
- [x] Network Telemetry Integration + Real-Load Proof _(Platform & Orchestration)_
- [!] Unattended-Readiness Proof + Bounded Autonomy Policy (Phase 5) _(Platform & Orchestration)_ — Supervised pilot PASSED (UX-2 browser proof: network NORMAL throughout, ceilings enforced, zero relay). Recommendation now READY FOR LIMITED UNATTENDED PILOT (short, budget-capped, still supervised); FULL unattended Option B remains NOT READY until a real pressure window + the 90-min/checkpoint/retry machinery are observed live. Owner ratifies any unattended activation separately.
- [P] Sales Opportunity lifecycle (Cycles 2–3) _(Commercial & Sales)_ — Grant opportunity.* + deploy callables
- [P] Sales Order lifecycle (Cycle 4) + Service lineage (Cycle 7) _(Commercial & Sales)_ — Grant salesOrder.* + deploy callables
- [P] Fulfillment allocation & availability (Cycle 5) _(Commercial & Sales)_ — Equipment availability fails closed = UNKNOWN pending P1a serialized-asset signal + #12
- [P] Commercial Coverage & Territory (register #15) _(Commercial & Sales)_ — Precedence/override/inheritance + sales credit + commission are deferred policy (do not manufacture)
- [x] Coordinated operations projections _(Commercial & Sales)_
- [x] Money model (exact minor units) _(Finance / Billing & AR)_
- [P] Invoice issuance (per-company sequence) _(Finance / Billing & AR)_ — Grant finance.invoice.issue + deploy + Rules deploy
- [P] Payment / AR (receipt ≠ application) _(Finance / Billing & AR)_ — Grant finance.payment.apply + deploy
- [P] Adjustments (credit / charge / write-off) _(Finance / Billing & AR)_ — Grant finance.adjustment.record + deploy
- [P] Refund (reverses applied payment) _(Finance / Billing & AR)_ — Grant finance.refund.record + deploy
- [P] Trusted AR read projection _(Finance / Billing & AR)_ — Revenue recognition remains a separate future accounting-policy seam (not an EOS engine)
- [-] Part Master in-app governed write _(Inventory & Catalog)_ — Awaits EAO integrated-sandbox experience review; PART_MASTER_WRITE_READY=false
- [R] Manufacturer governed write _(Inventory & Catalog)_ — READ authority waits on R-1 (inventory.catalog.read); manufacturers stays read:if false
- [R] Part↔Supplier procurement terms _(Inventory & Catalog)_ — READ service + Purchasing UI gated on R-1 (inventory.catalog.read + .cost.read)
- [-] Supplier Master adoption (Tier-2 program) _(Inventory & Catalog)_ — Repo-complete + fully planned; awaits integrated sandbox → Owner experience → protected promotion
- [P] Governed Receiving (against Purchase Order) _(Inventory & Catalog)_ — receiveInventoryStock callable DEPLOYED live (2026-08-06) BUT RECEIVING_TRANSPORT_READY=false → not user-operable
- [x] Work Order lifecycle _(Service & Work Orders)_ — Live/deploy + user-operable state not re-verified this session — marked UNKNOWN rather than assumed
- [x] Weekly Scheduling workspace _(Service & Work Orders)_
- [P] WO Parts Planning _(Service & Work Orders)_ — Ph3 Rules deploy operator-queued
- [ ] Service Contracts / Preventive Maintenance _(Roadmap Register (identified future capabilities))_
- [ ] Warranty / Service Entitlement _(Roadmap Register (identified future capabilities))_
- [ ] Installed Base / Customer Equipment Lifecycle _(Roadmap Register (identified future capabilities))_
- [ ] Returns / RMA / Credits / Reverse Commerce _(Roadmap Register (identified future capabilities))_
- [ ] Temporary Equipment / Placement (#12) _(Roadmap Register (identified future capabilities))_ — Assess only after F2 + sandbox; custody persistence shape unresolved
- [ ] Technician Labor / Cost Accounting (#13) _(Roadmap Register (identified future capabilities))_ — Assess after Service Ops convergence + F2 + sandbox

## 7. UX execution board

_None modeled yet._

## 8. Detailed Roadmap

### Platform & Orchestration _(program)_

#### Continuous Workstream Backlog & Orchestrator — `DONE`

- Owner: Product/Design · Milestones: 4/5 · Last verified: `da89558`
- Dimensions — Impl: NOT_APPLICABLE · Activation: NOT_APPLICABLE · Backend: NOT_APPLICABLE · UserOperable: NOT_APPLICABLE · UX: NOT_APPLICABLE · Deploy: NOT_APPLICABLE
  - ☑ **Design + seeded backlog + state machine + selection rule + checkpoint policy** — criteria: design doc merged; seeded backlog merged
    - Orchestrator foundation — `DONE` · PRs: #703 · evidence: PR:#703
  - ☑ **Option A /loop continuation driver (pure tested selector + CI + blocker-decomposition)** — criteria: selector implemented; 11 node:test pass; own CI lane; driver contract doc
    - selectNextWork.mjs + tests + orchestration-selector CI — `DONE` · PRs: #710 · tests: 11 node:test (orchestration-selector-tests.yml) · evidence: PR:#710, CI:orchestration-selector-tests.yml, TEST:selectNextWork.test.mjs(11 cases)
  - ☑ **Bounded two-class tool-permission policy** — criteria: VERIFICATION allow + PROTECTED deny; no Bash(*)
    - .claude/settings.json two-class + permission-policy.md — `DONE` · PRs: #712 · evidence: PR:#712
  - ☑ **Reconciled backlog + closed RUNNING assignment** — criteria: backlog marks completions; selection rule run recorded
    - backlog reconcile — `DONE` · PRs: #713 · evidence: PR:#713
  - ☐ **Option B unattended self-scheduling** — criteria: design: budget cap; cadence; max work window; retry/backoff; failure containment; checkpoint interval; unattended-spend controls
    - Option B design (deferred — validate A first) — `PLANNED`

#### Owner Roadmap Projection — `DONE`

- Owner: Product/Design · Milestones: 1/1 · Last verified: `85a9549`
- Dimensions — Impl: NOT_APPLICABLE · Activation: NOT_APPLICABLE · Backend: NOT_APPLICABLE · UserOperable: NOT_APPLICABLE · UX: NOT_APPLICABLE · Deploy: NOT_APPLICABLE
- Dependencies: continuous-workstream-orchestrator
  - ☑ **Projection contract + model + pure views + tests + snapshots** — criteria: contract doc; structured model; 8 pure views; tests + CI; committed snapshots
    - Contract + model + 8 pure views + 14 tests + drift-guarded CI + snapshot — `DONE` · PRs: #715 · tests: 14 node:test (orchestration-roadmap-tests.yml) · evidence: PR:#715, CI:orchestration-roadmap-tests.yml

#### Shared Agent Manager + Resource Governor — `DONE`

- Owner: Product/Design · Milestones: 2/2 · Last verified: `5639894`
- Dimensions — Impl: NOT_APPLICABLE · Activation: NOT_APPLICABLE · Backend: NOT_APPLICABLE · UserOperable: NOT_APPLICABLE · UX: NOT_APPLICABLE · Deploy: NOT_APPLICABLE
- Dependencies: continuous-workstream-orchestrator
  - ☑ **Durable Request/Result contracts + governor + network state + dispatcher + registration invariant** — criteria: files not chat; global caps REMOTE_AI=2/BROWSER=1/NETWORK_HEAVY=1; READY_BUT_WAITING_RESOURCE; registration invariant
    - agentRequest/Result/resourceGovernor/networkState/agentManager + selector — `DONE` · PRs: #719 · tests: 17+14 node:test · evidence: PR:#719
  - ☑ **Agent Operations roadmap view + Design/UX operational exercise** — criteria: Agent Ops projection; durable Design + UX exercise; no Owner relay
    - projectAgentOperations + DR-001/UX-EX-001 — `DONE` · PRs: #720 · evidence: PR:#720

#### Network Telemetry Integration + Real-Load Proof — `DONE`

- Owner: Product/Design · Milestones: 2/3 · Last verified: `5639894`
- Dimensions — Impl: NOT_APPLICABLE · Activation: NOT_APPLICABLE · Backend: NOT_APPLICABLE · UserOperable: NOT_APPLICABLE · UX: NOT_APPLICABLE · Deploy: NOT_APPLICABLE
- Dependencies: shared-agent-manager
  - ☑ **Read-only netwatch Network Health Adapter mapped into existing governor states** — criteria: reuse logger (durable local home); obvious-fact states only; no latency thresholds (Phase 4A); telemetry never in git
    - networkHealthAdapter/Loader + tests + CI + doc — `DONE` · PRs: #721 · tests: 11 node:test · evidence: PR:#721
  - ☑ **Real-load proof: 2 concurrent stable, ceiling enforced, zero relay, telemetry correlated** — criteria: Design+UX real requests; READY_BUT_WAITING_RESOURCE demonstrated; network NORMAL throughout; owner relay = 0
    - Agent-Ops network view + DR-002/UX-EX-002/DR-003 proof — `DONE` · evidence: DOC:phase4-realload-proof.md
  - ☐ **Option B unattended (still gated: browser/network-heavy correlation, pressure window, budget/cadence/backoff/containment)** — criteria: browser/network-heavy correlation measured; a pressure/outage window observed; budget cap + max window + cadence + backoff + containment + unattended-spend defined
    - Option B design (deferred) — `PLANNED`

#### Unattended-Readiness Proof + Bounded Autonomy Policy (Phase 5) — `OWNER_DECISION`

- Owner: Product/Design · Milestones: 4/4 · Last verified: `37995c2`
- Dimensions — Impl: NOT_APPLICABLE · Activation: NOT_APPLICABLE · Backend: NOT_APPLICABLE · UserOperable: NOT_APPLICABLE · UX: NOT_APPLICABLE · Deploy: NOT_APPLICABLE
- Dependencies: network-telemetry-integration
- Owner decision: Supervised pilot PASSED (UX-2 browser proof: network NORMAL throughout, ceilings enforced, zero relay). Recommendation now READY FOR LIMITED UNATTENDED PILOT (short, budget-capped, still supervised); FULL unattended Option B remains NOT READY until a real pressure window + the 90-min/checkpoint/retry machinery are observed live. Owner ratifies any unattended activation separately.
  - ☑ **Persistent telemetry supervisor (token-free) + logger-health adapter** — criteria: relaunch-if-dead; no duplicate; idempotent; logger health exposed
    - netwatch-supervisor + summarizeLoggerHealth — `DONE` · PRs: #723 · tests: 15 node:test · evidence: PR:#723
  - ☑ **Bounded autonomy contract + checkpoint + recovery policy (DESIGN ONLY)** — criteria: work window/budget/retries/backoff/containment/cadence/recovery; Option B NOT activated
    - autonomyPolicy + contract doc — `DONE` · PRs: #724 · tests: 9 node:test · evidence: PR:#724
  - ☑ **Option-B readiness assessment + registered browser/network-heavy proof (UX-2)** — criteria: proven/unproven/proposed/risks; READY-FOR-PILOT recommendation; UX-2 registered durably
    - phase5-option-b-readiness.md + UX-2 request — `OWNER_DECISION` · evidence: DOC:phase5-option-b-readiness.md
  - ☑ **Browser/network-heavy real-work proof (UX-2, supervised pilot)** — criteria: run app+emulator+browser; measure BROWSER_REMOTE + REMOTE_AI concurrent telemetry; close or correct UX-2
    - UX-2 browser proof — executed in the supervised pilot; network NORMAL throughout, ceilings enforced, zero relay — `DONE` · evidence: DOC:phase5-pilot-evidence.md, BROWSER_RUN:UX-2 coordinated-visits

### Commercial & Sales _(domain)_

#### Sales Opportunity lifecycle (Cycles 2–3) — `PROTECTED_ACTION`

- Owner: Product/Design · Milestones: 1/1 · Last verified: `da89558`
- Dimensions — Impl: IMPLEMENTED · Activation: INERT · Backend: COMPLETE · UserOperable: false · UX: NONE · Deploy: NOT_DEPLOYED
- Protected boundary: Grant opportunity.* + deploy callables
  - ☑ **Governed write + trusted read projection** — criteria: opportunity.write inert; opportunity.read inert; opportunities deny-all
    - opportunityCommands/Callables/ReadService — `DONE` · PRs: #651 #654 · evidence: PR:#651, PR:#654, CAPABILITY_FLAG:opportunity.write(active:false)

#### Sales Order lifecycle (Cycle 4) + Service lineage (Cycle 7) — `PROTECTED_ACTION`

- Owner: Product/Design · Milestones: 1/1 · Last verified: `da89558`
- Dimensions — Impl: IMPLEMENTED · Activation: INERT · Backend: COMPLETE · UserOperable: false · UX: NONE · Deploy: NOT_DEPLOYED
- Dependencies: opportunity-lifecycle
- Protected boundary: Grant salesOrder.* + deploy callables
  - ☑ **Committed commercial order + Service lineage** — criteria: salesOrder.write inert; salesOrder.service inert; sales_orders deny-all; assigns no WO/inventory
    - salesOrderCommands/Callables + createServiceForSalesOrder — `DONE` · PRs: #659 #663 · evidence: PR:#659, PR:#663

#### Fulfillment allocation & availability (Cycle 5) — `PROTECTED_ACTION`

- Owner: Product/Design · Milestones: 1/1 · Last verified: `da89558`
- Dimensions — Impl: IMPLEMENTED · Activation: INERT · Backend: PARTIAL · UserOperable: false · UX: NONE · Deploy: NOT_DEPLOYED
- Dependencies: sales-order-lifecycle
- Blocked: Equipment availability fails closed = UNKNOWN pending P1a serialized-asset signal + #12
- Protected boundary: Grant salesOrder.fulfill + deploy
  - ☑ **allocateSalesOrder (parts availability computed; equipment UNKNOWN-fail-closed)** — criteria: allocation only on sales_orders (non-forking); parts availability computed; equipment fails closed
    - allocateSalesOrder + availability contracts — `DONE` · PRs: #661 · evidence: PR:#661

#### Commercial Coverage & Territory (register #15) — `PROTECTED_ACTION`

- Owner: Product/Design · Milestones: 1/1 · Last verified: `da89558`
- Dimensions — Impl: IMPLEMENTED · Activation: INERT · Backend: COMPLETE · UserOperable: false · UX: NONE · Deploy: NOT_DEPLOYED
- Owner decision: Precedence/override/inheritance + sales credit + commission are deferred policy (do not manufacture)
- Protected boundary: Grant coverage.* + deploy
  - ☑ **Governed inert persistence + multi-assignment resolution** — criteria: territories + assignments deny-all inert; resolveCommercialCoverage returns coverageAssignments[] (no winner)
    - coverageCommands/Callables/Resolution — `DONE` · PRs: #695 #697 · evidence: PR:#695, PR:#697

#### Coordinated operations projections — `DONE`

- Owner: Product/Design · Milestones: 1/1 · Last verified: `da89558`
- Dimensions — Impl: IMPLEMENTED · Activation: NOT_APPLICABLE · Backend: COMPLETE · UserOperable: UNKNOWN · UX: UNKNOWN · Deploy: NOT_APPLICABLE
- Dependencies: fulfillment-allocation
  - ☑ **coordinatedVisit + coordinatedFieldMission (projection-only)** — criteria: projection-only; assigns no work; no independent WO authority
    - coordinatedVisit/coordinatedFieldMission — `DONE`

### Finance / Billing & AR _(domain)_

#### Money model (exact minor units) — `DONE`

- Owner: Product/Design · Milestones: 1/1 · Last verified: `da89558`
- Dimensions — Impl: IMPLEMENTED · Activation: NOT_APPLICABLE · Backend: COMPLETE · UserOperable: NOT_APPLICABLE · UX: NONE · Deploy: NOT_APPLICABLE
  - ☑ **Integer minor units + deterministic rounding + allocation** — criteria: never float; deterministic rounding; largest-remainder allocation
    - money.js + financeInvoiceAmounts + financeBillingPolicy — `DONE` · PRs: #690 · evidence: PR:#690

#### Invoice issuance (per-company sequence) — `PROTECTED_ACTION`

- Owner: Product/Design · Milestones: 1/1 · Last verified: `da89558`
- Dimensions — Impl: IMPLEMENTED · Activation: INERT · Backend: COMPLETE · UserOperable: false · UX: NONE · Deploy: NOT_DEPLOYED
- Dependencies: money-model
- Protected boundary: Grant finance.invoice.issue + deploy + Rules deploy
  - ☑ **Trusted invoice command + numbering; immutable history** — criteria: finance.invoice.issue active:false; invoices deny-all; issued history immutable
    - invoiceCommands/Numbering/Callables — `DONE` · PRs: #691 · evidence: PR:#691, CAPABILITY_FLAG:finance.invoice.issue(active:false)

#### Payment / AR (receipt ≠ application) — `PROTECTED_ACTION`

- Owner: Product/Design · Milestones: 1/1 · Last verified: `da89558`
- Dimensions — Impl: IMPLEMENTED · Activation: INERT · Backend: COMPLETE · UserOperable: false · UX: NONE · Deploy: NOT_DEPLOYED
- Dependencies: invoice-issuance
- Protected boundary: Grant finance.payment.apply + deploy
  - ☑ **applyPayment; outstanding = derived projection** — criteria: cash receipt separate from application; over-application rejected; one-payment→many-invoices preserved
    - paymentCommands/Callables — `DONE` · PRs: #692 · evidence: PR:#692

#### Adjustments (credit / charge / write-off) — `PROTECTED_ACTION`

- Owner: Product/Design · Milestones: 1/1 · Last verified: `da89558`
- Dimensions — Impl: IMPLEMENTED · Activation: INERT · Backend: COMPLETE · UserOperable: false · UX: NONE · Deploy: NOT_DEPLOYED
- Dependencies: invoice-issuance
- Protected boundary: Grant finance.adjustment.record + deploy
  - ☑ **Linked adjustment records; issued invoice never rewritten** — criteria: CREDIT_MEMO/DEBIT_CHARGE/WRITE_OFF; invoice_adjustments deny-all
    - adjustmentCommands/Callables — `DONE` · PRs: #693 · evidence: PR:#693

#### Refund (reverses applied payment) — `PROTECTED_ACTION`

- Owner: Product/Design · Milestones: 1/1 · Last verified: `da89558`
- Dimensions — Impl: IMPLEMENTED · Activation: INERT · Backend: COMPLETE · UserOperable: false · UX: NONE · Deploy: NOT_DEPLOYED
- Dependencies: payment-ar
- Protected boundary: Grant finance.refund.record + deploy
  - ☑ **Refund reopens AR; distinct from credit/write-off** — criteria: refunds deny-all; amount ≤ applied
    - refundCommands/Callables — `DONE` · PRs: #701 · evidence: PR:#701

#### Trusted AR read projection — `PROTECTED_ACTION`

- Owner: Product/Design · Milestones: 1/1 · Last verified: `da89558`
- Dimensions — Impl: IMPLEMENTED · Activation: INERT · Backend: COMPLETE · UserOperable: false · UX: NONE · Deploy: NOT_DEPLOYED
- Dependencies: invoice-issuance
- Owner decision: Revenue recognition remains a separate future accounting-policy seam (not an EOS engine)
- Protected boundary: Grant finance.read + deploy
  - ☑ **projectInvoiceAr + summarizeAccountAr** — criteria: finance.read active:false; AR position derived (CURRENT/OVERDUE/SETTLED/VOID/UNKNOWN)
    - financeReadProjection/Callables — `DONE` · PRs: #694 · evidence: PR:#694

### Inventory & Catalog _(domain)_

#### Part Master in-app governed write — `AT_REST`

- Owner: Product/Design · Milestones: 1/1 · Last verified: `da89558`
- Dimensions — Impl: IMPLEMENTED · Activation: INERT · Backend: COMPLETE · UserOperable: false · UX: COMPLETE · Deploy: NOT_DEPLOYED
- Blocked: Awaits EAO integrated-sandbox experience review; PART_MASTER_WRITE_READY=false
  - ☑ **Callables + write workspace (fail-closed readiness)** — criteria: createPart/updatePart/changePartStatus inert; workspace fail-closed
    - partMaster callables + PartMasterList write — `DONE` · PRs: #617 #619 · evidence: PR:#617, PR:#619

#### Manufacturer governed write — `BLOCKED_DEPENDENCY`

- Owner: Product/Design · Milestones: 1/1 · Last verified: `da89558`
- Dimensions — Impl: IMPLEMENTED · Activation: INERT · Backend: COMPLETE · UserOperable: false · UX: PARTIAL · Deploy: NOT_DEPLOYED
- Dependencies: authorization-convergence-r1
- Blocked: READ authority waits on R-1 (inventory.catalog.read); manufacturers stays read:if false
- Routed to: authorization-convergence-r1
  - ☑ **Callables + workspace** — criteria: create/update/changeStatus inert
    - manufacturer callables + Manufacturers.jsx — `DONE` · PRs: #625 #626 · evidence: PR:#625, PR:#626

#### Part↔Supplier procurement terms — `BLOCKED_DEPENDENCY`

- Owner: Product/Design · Milestones: 1/1 · Last verified: `da89558`
- Dimensions — Impl: PARTIAL · Activation: INERT · Backend: PARTIAL · UserOperable: false · UX: NONE · Deploy: NOT_DEPLOYED
- Dependencies: authorization-convergence-r1
- Blocked: READ service + Purchasing UI gated on R-1 (inventory.catalog.read + .cost.read)
- Routed to: authorization-convergence-r1
  - ☑ **Write layer + cost/relationship projection contract** — criteria: 4 callable adapters inert; cost never leaks (separate tier)
    - part_supplier_items write + projection — `DONE` · PRs: #629 · evidence: PR:#629

#### Supplier Master adoption (Tier-2 program) — `AT_REST`

- Owner: Product/Design · Milestones: 1/1 · Last verified: `da89558`
- Dimensions — Impl: IMPLEMENTED · Activation: INERT · Backend: COMPLETE · UserOperable: false · UX: COMPLETE · Deploy: NOT_DEPLOYED
- Blocked: Repo-complete + fully planned; awaits integrated sandbox → Owner experience → protected promotion
  - ☑ **S1–S5 (identity, validator, commands, workspace, migration tooling, RC)** — criteria: governed Supplier identity; trusted write + Rules(prepared); migration dry-run/rollback; RC package
    - supplierMaster S1–S5 — `DONE` · PRs: #596 #598 #600 #602 #604 #605 #608 #610 #612 · evidence: PR:#605(RC-1)

#### Governed Receiving (against Purchase Order) — `PROTECTED_ACTION`

- Owner: Product/Design · Milestones: 1/1 · Last verified: `da89558`
- Dimensions — Impl: IMPLEMENTED · Activation: INERT · Backend: COMPLETE · UserOperable: false · UX: COMPLETE · Deploy: DEPLOYED
- Blocked: receiveInventoryStock callable DEPLOYED live (2026-08-06) BUT RECEIVING_TRANSPORT_READY=false → not user-operable
- Protected boundary: Readiness flip + authorized Hosting release
  - ☑ **Trusted receive command + scanner-in-FieldMode + workspaces** — criteria: receiveInventoryStock sole writer; receiving_orders deny-all; capability granted {admin,dispatcher,owner}
    - inventoryReceiving + FieldMode + Inventory workspaces — `DONE` · PRs: #581 · evidence: PR:#581, DOC:DECISIONS #68/#69/#71/#74/#76

### Access & Authorization _(program)_

#### R-1 Authorization Convergence (Issue #226) — `PROTECTED_ACTION`

- Owner: EAO · Milestones: 1/3 · Last verified: `da89558`
- Dimensions — Impl: PARTIAL · Activation: UNKNOWN · Backend: PARTIAL · UserOperable: NOT_APPLICABLE · UX: NOT_APPLICABLE · Deploy: NOT_DEPLOYED
- Blocked: R1-A readiness prerequisite (parity corpus + shadow gate) EXISTS + CI-enforced; R1-B (Rows 19/20/22 production deployment) is the critical-path protected boundary and is unauthorized
- Protected boundary: R1-B production deployment (Rows 19/20/22) + criterion-6 production evidence + Owner Row 19 authorization
  - ☑ **R1-A readiness (repo-only): domain parity corpus + shadow-parity gate** — criteria: 47 legacy sites/22 collections enumerated + grouped by cutover row; CI-enforced (fails on new unassigned site)
    - legacyAuthorizationSurface.ts + test — `DONE` · evidence: DOC:functions/src/access/legacyAuthorizationSurface.ts, CI:legacyAuthorizationSurface.test.mjs
  - ☐ **R1-B backend activation (Rows 19/20/22)** — criteria: Owner Row 19 authorization; trusted backend deployed; admin mutations enabled
    - Protected production deployment — `PROTECTED_ACTION`
  - ☐ **R1-C domain cutovers (Rows 23–26)** — criteria: each domain moved onto permission engine; each Rules change Tier-2
    - Domain cutovers (blocked behind R1-B) — `BLOCKED_DEPENDENCY`

#### Catalog-read authority model — `OWNER_DECISION`

- Owner: Access · Milestones: 1/1 · Last verified: `da89558`
- Dimensions — Impl: NONE · Activation: NOT_APPLICABLE · Backend: NONE · UserOperable: NOT_APPLICABLE · UX: NOT_APPLICABLE · Deploy: NOT_APPLICABLE
- Dependencies: authorization-convergence-r1
- Owner decision: Adopt durable inventory.catalog.read (+ separate inventory.catalog.cost.read)? Unblocks Manufacturer + part_supplier_items read surfaces
  - ☑ **Requirement recorded (design proposal)** — criteria: requirement doc; ratified personas + separate cost capability
    - r1-catalog-read-authority-requirement.md — `OWNER_DECISION` · evidence: DOC:docs/assessments/r1-catalog-read-authority-requirement.md

### Service & Work Orders _(domain)_

#### Work Order lifecycle — `DELIVERED`

- Owner: Product/Design · Milestones: 1/1 · Last verified: `not re-verified 2026-08-09`
- Dimensions — Impl: IMPLEMENTED · Activation: ACTIVATED · Backend: COMPLETE · UserOperable: UNKNOWN · UX: UNKNOWN · Deploy: UNKNOWN
- Blocked: Live/deploy + user-operable state not re-verified this session — marked UNKNOWN rather than assumed
  - ☑ **Transition engine + governed writes** — criteria: transitionEngine canonical; client-direct writes denied
    - transitionEngine + workOrderService — `DELIVERED`

#### Weekly Scheduling workspace — `DONE`

- Owner: Product/Design · Milestones: 1/1 · Last verified: `not re-verified 2026-08-09`
- Dimensions — Impl: IMPLEMENTED · Activation: UNKNOWN · Backend: COMPLETE · UserOperable: UNKNOWN · UX: COMPLETE · Deploy: UNKNOWN
- Dependencies: work-order-lifecycle
  - ☑ **Scheduling domain + workspace** — criteria: scheduling spine; weekly workspace
    - Scheduling — `DONE` · PRs: #635 · evidence: PR:#635

#### WO Parts Planning — `PROTECTED_ACTION`

- Owner: Product/Design · Milestones: 1/1 · Last verified: `da89558`
- Dimensions — Impl: IMPLEMENTED · Activation: INERT · Backend: COMPLETE · UserOperable: false · UX: UNKNOWN · Deploy: NOT_DEPLOYED
- Dependencies: work-order-lifecycle
- Blocked: Ph3 Rules deploy operator-queued
- Protected boundary: Rules deploy
  - ☑ **Phase 1–3 governed PLANNED producer + back-link** — criteria: setWorkOrderPartsPlan governed; Ph3 back-link
    - WO Parts Planning Ph1–3 — `DONE` · PRs: #638 #639 #643 · evidence: PR:#639

### Roadmap Register (identified future capabilities) _(program)_

#### Service Contracts / Preventive Maintenance — `IDENTIFIED`

- Owner: Product/Design · Milestones: — · Last verified: `da89558`
- Dimensions — Impl: NONE · Activation: NOT_APPLICABLE · Backend: NONE · UserOperable: NOT_APPLICABLE · UX: NONE · Deploy: NOT_APPLICABLE
- Roadmap trigger: Before recurring/contract Service implementation

#### Warranty / Service Entitlement — `IDENTIFIED`

- Owner: Product/Design · Milestones: — · Last verified: `da89558`
- Dimensions — Impl: NONE · Activation: NOT_APPLICABLE · Backend: NONE · UserOperable: NOT_APPLICABLE · UX: NONE · Deploy: NOT_APPLICABLE
- Roadmap trigger: Before Service billing / WO financial completion

#### Installed Base / Customer Equipment Lifecycle — `IDENTIFIED`

- Owner: Product/Design · Milestones: — · Last verified: `da89558`
- Dimensions — Impl: NONE · Activation: NOT_APPLICABLE · Backend: NONE · UserOperable: NOT_APPLICABLE · UX: NONE · Deploy: NOT_APPLICABLE
- Roadmap trigger: As Sales Order → Equipment fulfillment/installation is designed

#### Returns / RMA / Credits / Reverse Commerce — `IDENTIFIED`

- Owner: Product/Design · Milestones: — · Last verified: `da89558`
- Dimensions — Impl: NONE · Activation: NOT_APPLICABLE · Backend: NONE · UserOperable: NOT_APPLICABLE · UX: NONE · Deploy: NOT_APPLICABLE
- Roadmap trigger: After Sales Order / fulfillment authority is established

#### Temporary Equipment / Placement (#12) — `IDENTIFIED`

- Owner: Product/Design · Milestones: — · Last verified: `da89558`
- Dimensions — Impl: NONE · Activation: NOT_APPLICABLE · Backend: NONE · UserOperable: NOT_APPLICABLE · UX: NONE · Deploy: NOT_APPLICABLE
- Blocked: Assess only after F2 + sandbox; custody persistence shape unresolved
- Roadmap trigger: Assess after F2 + integrated sandbox mature

#### Technician Labor / Cost Accounting (#13) — `IDENTIFIED`

- Owner: Product/Design · Milestones: — · Last verified: `da89558`
- Dimensions — Impl: NONE · Activation: NOT_APPLICABLE · Backend: NONE · UserOperable: NOT_APPLICABLE · UX: NONE · Deploy: NOT_APPLICABLE
- Blocked: Assess after Service Ops convergence + F2 + sandbox
- Roadmap trigger: Assess after Service Ops convergence + F2 + sandbox

## 9. Agent Operations

Read-only over the durable [Agent Request/Result ledger](../agent-requests/) + governor/network telemetry. See [`agent-manager.md`](../agent-manager.md) / [`network-telemetry.md`](../network-telemetry.md). AGENT OUTPUT ≠ PRODUCT AUTHORITY.

- **Network state:** NORMAL (HIGH confidence · ALL_HEALTHY) — telemetry as of 2026-08-09 (pilot window), sample age 2s
- **Recent latency (reported, not thresholded):** gateway 1ms · WAN1 13.7ms · WAN2 22.4ms · TCP conns 54
- **Remote slots:** REMOTE_AI 0/2 · BROWSER 0/1 · NETWORK_HEAVY 0/1 · MUTATING 0/1
- **Efficiency:** requests 6 · executed 6 · deduped/reused 0 · waiting(resource/net) 0/0 · retries 0 · accepted findings 23 · results-with-token-metrics 5
- **Owner relay count (routine handoffs):** 0
- **Proof status:** Phase-4A real-load proof COMPLETE: 2 concurrent remote workers stable (network NORMAL throughout), ceiling enforced (READY_BUT_WAITING_RESOURCE), zero Owner relay.

**Queued requests:** _none_

**Running agents:** _none_

**Recent results:** 
| Result | Request | Routed to | Status | Verdict | Findings | Retries |
|---|---|---|---|---|---|---|
| DR-001-R1 | DR-001 | Design | COMPLETE | PASS | 3 | 0 |
| DR-002-R1 | DR-002 | Design | COMPLETE | PASS | 4 | 0 |
| DR-003-R1 | DR-003 | Design | COMPLETE | PASS | 1 | 0 |
| UX-2-R1 | UX-2 | UX | COMPLETE | NOT_APPLICABLE | 4 | 0 |
| UX-EX-001-R1 | UX-EX-001 | UX | COMPLETE | NOT_APPLICABLE | 7 | 0 |
| UX-EX-002-R1 | UX-EX-002 | UX | COMPLETE | NOT_APPLICABLE | 4 | 0 |

