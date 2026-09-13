# EMP-PERFORMANCE — role-appropriate outcomes and metrics

**Lane:** EMP-PERFORMANCE · **Mode:** EVIDENCE_WRITE
**Baseline:** `64008d5ae0bdd9532909671b15a91122400accf1` (= `ATLAS-BASE-2026-09-12-A`)
**Every derived fact below carries OBSERVED AT: 64008d5a.** Evidence outside this worktree is cited
with its own lane worktree and commit.

---

## 0 · The ruling this lane exists to hold

Two sentences bound the lane, and they are load-bearing rather than decorative:

> **Do NOT turn EOS into a simplistic employee-scoring system.**
> **Do NOT infer compensation or performance policies that Taylor has not stated.**

They are not this lane's invention. The repository already holds the same position in three places,
and this lane's job was to check whether the existing position survives contact with the evidence.
It does, and the evidence strengthens it.

| Where the position is already recorded | Verbatim | OBSERVED AT |
| --- | --- | --- |
| `field-ops-app-vite/src/modules/technicianDashboard/TechnicianPerformance.jsx:6-7` | *"The Owner's direction is explicit: 'Do not reward throughput alone. Visually balance PRODUCTIVITY, ON-TIME EXECUTION and QUALITY.'"* | 64008d5a |
| `functions/src/performance/performanceGoalAuthority.ts:52` | *"The Owner: 'Employees do NOT automatically manage their own targets.'"* | 64008d5a |
| `docs/north-star/my-dashboard/DESIGN-HANDOFF-MY-DASHBOARD-P1v2.md:746` | *"**Do not reward throughput alone.** The direction is explicit that productivity, on-time execution and quality must be visually balanced."* | 64008d5a |

**These three are the ONLY Owner-stated performance direction reachable at this baseline.** All three
are about the SHAPE of a performance surface (balance three axes; do not let one number stand for the
job; the measured person does not set their own target). **Not one of them states a consequence** —
no pay, no review, no ranking, no threshold. That absence is the strongest single finding in this
lane and it is recorded as MISSING INPUT §9, not filled in.

`TechnicianPerformance.jsx:10-12` states the failure mode in the platform's own words, and this lane
adopts it as its test for every proposed metric:

> *"a screen that showed a completion count and stopped would read as though throughput IS the job —
> not because anyone claimed it, but because it would be the only number on the page, **and the only
> number on a page is the score.**"*

---

## 1 · The eight axes, and why collapsing them is the failure mode

Every metric in §4–§7 carries an **AXIS** and an **ATTRIBUTION**. Attribution answers a question the
axis does not: *is this number about the business, the process, or the person?*

| Axis | What it measures | Fair to attribute to a person? |
| --- | --- | --- |
| BUSINESS OUTCOME | money or volume the firm achieved | Only where a governed credit dimension exists |
| PROCESS HEALTH | whether the system of work is functioning | **No** — a queue depth is nobody's score |
| WORKLOAD | how much work is in front of someone | **No** — assigned ≠ chosen |
| CAPACITY | how much work a resource could absorb | **No** — a denominator, not a verdict |
| QUALITY | whether the work held up | Only with a revisit/defect linkage |
| TIMELINESS | whether a commitment was met | Only where a commitment is recorded |
| EXCEPTION RATE | how often the path deviated | Usually process, occasionally person |
| EMPLOYEE PERFORMANCE | a judgement about a person | Requires ALL of: governed attribution, a stated standard, and a contest path |

**The collapse this lane refuses.** "Technician utilisation" is **CAPACITY**, not employee
performance. "First-time completion" is **QUALITY**. "Overdue unassigned work" is **PROCESS HEALTH**.
The repository already gets this right in one place and it is worth naming: the four active service
queue metrics are all registered at `FIRM` scope only —
`functions/src/performance/performanceMetricRegistry.ts:211, :226, :240, :255` — so a past-due count
**cannot be pointed at a person even if someone wanted to**. That is the eight-axis discipline
enforced in code rather than asserted in prose.

**EMPLOYEE PERFORMANCE is the smallest of the eight axes at this baseline, and this lane proposes
exactly two metrics on it** (§4.2, OD-EMP-004), both of which fail their contest test today.

---

## 2 · Reconciliation against existing authority

### 2.1 `docs/north-star/financials/pages/15-employee-performance.md` (63 lines) + `North Star - Financials 15 Employee Performance.dc.html`

Both exist at this baseline. Read in full. **This lane extends them and contradicts them nowhere.**

| # | What the North Star already assumes or measures | This lane's finding | Verdict |
| --- | --- | --- | --- |
| R1 | §4/§10: *"view seg (Salesperson credit / Service responsibility — **never merged**)"* | Correct and stronger than it knows: `creditedSalespersonId` and `responsibleEmployeeId` are two separate NULLABLE dimensions on one frozen snapshot — `functions/src/finance/financialAttribution.ts:161-171` | **AGREE**, reinforced |
| R2 | §10: *"Attribution: creditedSalespersonId ≠ ownerEmployeeId ≠ createdBy ≠ responsibleEmployeeId — labelled per row"* | Verified in code. `creditedSalespersonId` is resolved through `resolveCreditedSalesperson(...)` distinctly from `ownerEmployeeId` — `functions/src/salesOrder/salesOrderCommands.ts:291-292`, `functions/src/opportunity/opportunityCommands.ts:178` | **AGREE** |
| R3 | §9: *"DENIED = named withheld panel (never zeros, never silent absence)"* | The server already implements exactly three distinct absences and forbids collapsing them — `functions/src/performance/performanceGoalReadService.ts:44-54`: *"Collapsing these into one empty state is how 'you may not see this' becomes 'there isn't one'."* | **AGREE**, and the read layer is ahead of the design |
| R4 | §10 (line 31): *"All values are **Certification World specimen fixtures** showing the shape of the read, not live claims."* | **STALE — the surface shipped wired.** `field-ops-app-vite/src/modules/financials/FinancialsEmployeePerformance.jsx` (181 lines) reads the **real** callable `listFinancialFacts` via `useFinancialFacts` → `financeReadCallableClient.js`, served by `functions/src/finance/financialReportingRead.ts` whose server-side rollup `byCreditedSalesperson` is at `:367`. **No fixture or mock import exists in the component.** Its own header: *"WIRED — AND HONESTLY PARTIAL … the credit view reads the governed reporting seam's per-salesperson rollup, which the SERVER computes from each invoice's frozen `attribution.creditedSalespersonId`."* Columns rendered per person: **Person · Basis · Billed · Collected · Outstanding · Goal**. The conclusion the North Star drew is nonetheless right for the wrong reason: the page holds no live number **in production** because `finance.read` is `active: false` and sandbox-only (`permissionCatalog.ts:313-319`; `config/environments.json:104`) | **CONFLICT — OD-EMP-016** |
| R4b | §10 implies the four attribution axes are each usable | **`responsibleEmployeeId` is declared and NEVER POPULATED.** It exists only in `functions/src/finance/financialAttribution.ts:164, :176, :229, :304`; `grep -rn "responsibleEmployeeId" functions/src --include=*.ts \| grep -v financialAttribution.ts` returns **no output** — nothing outside the builder ever supplies it. The shipped component says so itself (`FinancialsEmployeePerformance.jsx:47-48`): *"Service responsibility is a different attribution from salesperson credit and is never merged with it. **No governed financial read exposes a responsible-employee dimension, so this view has no rows to show** — and credit rows are not relabelled to fill it."* So the North Star's "Service responsibility" view is **structurally empty**, not merely unactivated | **EXTEND — OD-EMP-017** |
| R5 | §11: *"billed reads pending activation"* | **NOW STALE in one direction.** `sales.billed.amount` and `sales.collected.amount` were **ACTIVATED** by Decision #163 — `performanceMetricRegistry.ts:455-464, :477-481`. The metric is measurable in principle; the *principal's* finance reach is the surviving blocker | **EXTEND** — OD-EMP-009 |
| R6 | §12: FIN-004 named as primary dependency (OPEN) | Sharpened by EXECUTED evidence: `finance.visibility.self`, `.team`, `.businessUnit`, `.company` are **dead in every environment** — 4 of the 17 in `p3b3-act-sales @ c193866f · docs/activities/p3b3-evidence/matrix-run.txt`. Only `.consolidated` is activated anywhere. **So the SELF and TEAM views the North Star draws are precisely the two that can resolve nothing.** | **EXTEND** — OD-EMP-010 |
| R7 | §13-14: *"Capabilities (CONCEPTUAL — exact governed IDs TBD; Design does not declare permission vocabulary)"* | The governed ids now exist and are enumerable: `performance.goal.{read,create,approve,supersede,retire}` — `functions/src/access/permissionCatalog.ts:1533-1571` | **EXTEND** — the TBD is closeable |
| R8 | §15: *"DESIGN GAPS — None."* | **This lane disputes the completeness of that claim, on scope rather than on design.** The page has no **contest affordance**: no way for a measured person to dispute a number attributed to them. Evidence: P3B1-S28-A07 (§3.4). The North Star is a *financial* surface and may reasonably say credit disputes are out of its scope — but then the gap belongs to somebody, and today it belongs to nobody | **CONFLICT (narrow)** — OD-EMP-006 |
| R9 | §17: `FIN-PQ-15a` margin visibility by person | Confirmed unanswerable and correctly so: `WF-FIN-008` *"Margin is STRUCTURALLY unknown — not missing data, but an unruled authority"* (`p3d-workflow-registry @ 131baa2f`) | **AGREE** |
| R10 | Title: *"Salesperson & Employee Performance"* | The title merges what R1 separates. Sales credit and employee performance are different axes (BUSINESS OUTCOME vs EMPLOYEE PERFORMANCE), and §6 of this lane declines to produce one "Sales" metric set | **NOTE**, not a conflict — the body already separates them |

### 2.2 `functions/src/performance/performanceMetricRegistry.ts` (839 lines)

**A metric registry already exists and this lane proposes no second one.** Verified counts, OBSERVED
AT 64008d5a, each by command:

| Fact | Value | How verified |
| --- | --- | --- |
| Registered metrics | **37** | `grep -c 'metricId: "'` |
| `activeForGoals: true` | **12** | `grep -c '^    \.\.\.ACTIVE,'` |
| `activeForGoals: false` (blocked) | **25** | `grep -c '^    \.\.\.blocked('` |
| Both counts PINNED by test | yes | `functions/test/performanceGoal.test.mjs:146-147` asserts 37 and 12 |
| The file's own header comment claiming "TWENTY-FIVE of the thirty-seven ... are inactive" | **accurate** | 37 − 12 = 25 |

The 12 active metric ids: `service.workOrder.pastDue.count` · `service.workOrder.readyToSchedule.count`
· `service.workOrder.schedulingConflict.count` · `service.workOrder.partsBlocked.count` ·
`technician.workOrder.completed.cumulative.count` · `technician.workOrder.open.count` ·
`sales.billed.amount` · `sales.collected.amount` · `crm.account.active.count` ·
`parts.reorderRequest.open.count` · `receiving.purchaseOrder.receivable.count` ·
`purchasing.purchaseOrder.open.count`.

**The registry's design is correct and this lane adopts its vocabulary wholesale** rather than
inventing parallel terms. Three of its devices do work this lane would otherwise have had to invent:

1. `actualAuthority` NAMES the source of the actual and never reproduces it (`:14-22`). A metric that
   re-derived its own actual would be a second implementation of a domain derivation.
2. `blockedBy` names the blocker **by its governed id**, so "registered" and "measurable" cannot be
   confused (`:23-37`).
3. `GOAL_SCOPE_BINDINGS` records the **proof** that a scope can be bound, or its absence (`:96-128`).

### 2.3 The brief's claim about `technician.utilization.rate` — **VERIFIED, but the framing is wrong**

The brief reports *"a prior measurement found `technician.utilization.rate` referencing `blocked(...)`
with **no computation behind it**."*

**The observation is literally true and the inference is backwards.** Verified at
`performanceMetricRegistry.ts:374-389`:

```
metricId: "technician.utilization.rate"
actualAuthority: "NONE."
...blocked(
  "F-04 / ND-21 -- a utilisation percentage would be computed over estimatedDurationMinutes, which is
   OPTIONAL and whose ABSENCE IS THE NORMAL CASE and must never be read as zero, divided by recorded
   working hours that may themselves be unrecorded. Both halves are optional, so the quotient is
   undefined far more often than it is defined. Whether such a figure may exist at all is the open
   question, not merely how to compute it."
)
```

There is no computation behind it **because the file computes nothing at all, by design and by its own
stated contract** — `:12` *"It computes NOTHING. There is not one measurement in this module and there
must never be one."* `blocked(...)` is not a stub; it is the registry recording a named refusal.

**This matters to the lane's purpose.** The blocker's last sentence — *"Whether such a figure may
exist at all is the open question, not merely how to compute it"* — is a metric-registry entry
declining to become an employee score. That is the constraint at the top of this file, already
enforced in code, on the single most-requested "employee performance" number in field service.
**OD-EMP-002** upholds it.

**And the refusal is not only the registry's — it is ratified design authority.** The sales/reporting
archaeology (`p3a3-arch-sales @ 0a1a6d49`,
`docs/design/archaeology/sales-crm-financials-reporting-administration.md:702`) records a
**DO-NOT-BUILD list**, verbatim:

> ***"The DO-NOT-BUILD list is design authority too"*** — reserved as *"named absences so a later
> session does not re-derive them"*: AOV (S-12), pipeline value (S-4), first-time fix, SLA/response,
> callbacks, parts-delay impact, **technician utilisation**, work-order aging buckets,
> jobs-per-workday, stockout rate, inventory aging, inventory value / turns / carrying cost, waste
> avoided.

**Every item this lane declines in §6, and most of the gaps in §4 and §7, appears on that list by
name.** This lane therefore adds no new refusals to the utilisation question — it **upholds an
existing one**, and records that re-proposing any of them would be re-deriving a named absence.

### 2.4 There are TWO goal authorities and they must not be conflated

A synthesiser reading only one of these will contradict itself. Both statements are true:

| Authority | What it is | State |
| --- | --- | --- |
| **`performance_goals`** — `performance.goal.*` | The **governed performance-goal object**: draft → approve → supersede → retire, five capabilities, six callables (`functions/src/index.ts:563-570`), a metric registry, a subject Role | **Machinery COMPLETE, capabilities `active:false`, collection has no `firestore.rules` match block.** *"Unlike budgets, goals **do** have authority"* — p3a3 `:562` |
| **FIN-003 plan records (GOAL mode)** — `planVsActual.ts` | The **financial plan** a Sales-to-Goal surface would compare against | **AUTHORITY GAP `FIN-AG-PLAN`: *"goal records have no collection, no command, no read callable"*** (`BUILT_DORMANT` + `DATA SUPPLY MISSING`) — p3a3 `:557` |

The shipped Employee Performance page is blocked on the **second**, and says so:
`FinancialsEmployeePerformance.jsx:124` — *"No goal records exist: FIN-005 goal authority is merged and
dormant with no persisted goals, so attainment cannot be computed truthfully and **is never
estimated**."* **OD-EMP-018:** a target set through `performance.goal.create` does **not** populate the
financial Goal column, and vice versa. Do not report "goals exist" or "goals do not exist" without
naming which authority.

### 2.5 Attribution fields — which metrics can name a person at all

This table decides every ATTRIBUTION column in §4–§7. Verified field by field at 64008d5a.

| Field | Object | Verdict | Evidence |
| --- | --- | --- | --- |
| **`creditedSalespersonId`** | Opportunity, Sales Agreement, Sales Order, Invoice | **(a) GOVERNED, server-stamped, frozen.** Caller may *propose*; server resolves explicit → inherited → commercial owner → `null`. Clearing is **refused**: *"creditedSalespersonId cannot be cleared, only reassigned"* | `financialAttribution.ts:164, :321-330`; `salesOrderCommands.ts:229` *"FIN-002: sales credit, frozen at creation. Distinct from ownerEmployeeId; **never the actor**"*; `salesAgreementCommands.ts:536` |
| **`assignedTechId`** | Work Order (`fieldops_wos`) | **(a) GOVERNED, server-stamped** — set only by `transitionWorkOrder` (Dispatch), with a double-booking guard. `firestore.rules:506-510`: client `create, update, delete: if false`; a technician may read only their own. **But MUTABLE after completion and carrying no per-transition actor** (§3.4a) | `functions/src/transitionWorkOrder.ts:81`; `firestore.rules:506-510` |
| **`ownerEmployeeId`** | Opportunity, Sales Order | **(a) GOVERNED**, resolved by `resolveCreationOwner(explicit, inherited, source)` which **refuses rather than defaulting**. Explicitly **not** credit: *"OWNERSHIP != SALES CREDIT"*; *"Moving the OWNER does not move credit (test-pinned)"* | `opportunityCommands.ts:138`; `functions/src/ownership/creationOwnerResolution.ts`; `docs/financials/FIN-002_REPORTING_ATTRIBUTION_MODEL.md` |
| **`createdByUid`** | Sales Order, CRM Activity, performance goals | **(a) GOVERNED** — `ctx.actorUid`, never from the payload | `salesOrderCommands.ts:244, :303`; `crmActivityCommands.ts:79, :121` |
| **`responsibleEmployeeId`** | intended for Service/operational facts | **(c) DECLARED, NEVER POPULATED.** Nothing outside the snapshot builder supplies it | §2.1 R4b |
| **`accountOwner`** | Account | **(b) CLIENT-WRITABLE, and unpopulated.** `firestore.rules:1319-1338` allows any admin/dispatcher to create/update, and `accountOwner` is **not** among `accountGovernedFieldsValid`'s governed fields. The rules comment flags it as interim. Sandbox population rate **0 / 103** | `functions/src/ownership/typedOwner.ts:91-103`; `functions/src/ownership/ownershipMatrix.ts:116` |
| **`createdBy` on Work Orders** | Work Order | **(c) ABSENT.** `functions/src/createWorkOrder.ts:78-99` writes no creator field at all. The actor survives **only** as an Audit Event (`stageAuditEvent`, `:194, :203`) — and the audit collections are deny-all | §3.4b |
| **`createdBy` on Accounts** | Account | **(c) ABSENT.** `grep -n "createdBy" firestore.rules` → no output | — |
| `technicianId` (legacy `fieldops_jobs`) | legacy Job domain | **(b) CLIENT-WRITABLE by admin/dispatcher through Rules.** A **distinct legacy domain**, not a parent of `fieldops_wos` | `firestore.rules:353-395`; `docs/architecture/SYSTEM_AUTHORITIES.md:115` |

**OD-EMP-017.** **A metric can be attributed to a person through exactly TWO governed facts:**
`creditedSalespersonId` on issued invoices (Sales) and `assignedTechId` on `fieldops_wos` (Service).
Everything else is absent, unpopulated, or client-writable. And ownership non-collapse is ratified
while being **inert** — `docs/architecture/SYSTEM_AUTHORITIES.md:116`: *"`currentOwner` …
`explicitTitleHolder` … `assignedTo`, and `createdBy` are **presumed distinct** and are not ownership.
**Inert:** no Rules enforce ownership, no writer stamps it, no backfill has run."*

---

## 3 · Measured constraints that decide measurability

Every verdict in §4–§7 is downstream of these. Each was re-measured at this baseline.

### 3.1 The target side is DENY in production — the decisive constraint

| Fact | Evidence | OBSERVED AT |
| --- | --- | --- |
| All five `performance.goal.*` capabilities are `active: false` | `functions/src/access/permissionCatalog.ts:1538, :1546, :1554, :1562, :1570` | 64008d5a |
| They ARE eligible for per-environment activation | `functions/src/access/environmentCapabilityOverrides.ts:248-252` (`SPINE_OVERRIDE_ELIGIBLE_IDS`) | 64008d5a |
| They are activated in **`platform-sandbox` only** | `config/environments.json:131-135`; parsed: `platform-sandbox` (role sandbox) carries 92 overrides incl. all 5; `local-emulator` 0, `platform-certification` 3, `platform-integration` 0, `taylor-parts-production` 0 | 64008d5a |
| They are **absent** from `PRODUCTION_ACTIVATION_ELIGIBLE_IDS` (25 ids, all `report.*`) | `environmentCapabilityOverrides.ts:66-90`; counted 25 | 64008d5a |
| Production is triple-hard-blocked from override activation regardless | `environmentCapabilityOverrides.ts:17-26` | 64008d5a |
| `performance_goals` has **no `firestore.rules` match block at all** | `p3d-workflow-registry @ 131baa2f`, `WF-RPT-004.authority_path` | 131baa2f |

**Consequence — OD-EMP-001.** A **target** can exist in `platform-sandbox` and nowhere else. In
production, no principal can read, author, approve, supersede or retire a performance goal. Therefore
**no metric in this document is production-measurable *as a goal* today, including the 12 the registry
marks active.** The registry's `activeForGoals` flag says the metric is measurable *in principle*; it
deliberately says nothing about any principal's reach (`performanceMetricRegistry.ts:459-464`).

`WF-RPT-004` (EXECUTED) states the shape of this precisely and it is the most useful single sentence
in the evidence corpus for this lane:

> *"The goal machinery is genuinely complete — five capabilities, six callables, a metric registry, a
> subject role — and it is the clearest counter-example to 'nothing is built': **what is missing is an
> activation decision, not code.** One live gap survives activation: a technician still cannot read an
> approved EMPLOYEE-scope goal set for their own governed employee (P3-A1 §2.13)."*

### 3.2 Constraints carried in from the brief — verification results

| Brief claim | Verdict | Evidence |
| --- | --- | --- |
| 0 of 86 workflows proven end-to-end | **CONFIRMED** | `eos-workflow-registry.json` `counts.by_state` = `WORKS_WITH_GAPS 27 / CANNOT_START 23 / BROKEN_MIDWAY 31 / NO_IMPLEMENTATION 5`. The state vocabulary contains **no** "works" value; 27+23+31+5 = 86 |
| 34 EXECUTED / 52 TRACED / 0 INFERRED | **CONFIRMED** | `counts.by_evidence_status` = `{TRACED: 52, EXECUTED: 34}`; no INFERRED tier exists in the file |
| Browser reachability of Postgres authorities is zero; no `VITE_EOS_API_BASE_URL` committed anywhere | **CONFIRMED in substance, IMPRECISE as worded** | The **identifier** is committed in 2 files (`field-ops-app-vite/src/services/adminPolicyApiClient.js:26, :75, :116`; `docs/architecture/eos-policy-nonprod-activation.md:275, :283`). No **value** is set in any environment: `adminPolicyApiClient.js:26` — *"is absent in every environment today, because no EOS API is deployed."* The reachability conclusion stands |
| 62 of 147 capabilities resolve ALLOW in production | **NOT REPRODUCED — the EXECUTED transcript says 37** | `matrix-run.txt` line 1 `ROLES 48 CAPS 147`, final line **`ALLOWED ANYWHERE IN PRODUCTION: 37`**. At this baseline the catalog holds 147 ids of which **109 are explicitly `active: false`**, leaving 38 active-by-omission (`active?: boolean` — `functions/src/types/access.ts:93`; only `=== false` denies — `resolveEffectivePermission.ts:264`). 37 ≤ 38 is coherent; **62 is not reproducible from this baseline.** See §10 |
| …and not one is commercial → no commercial outcome measurable from production EOS | **CONFIRMED, and it is the stronger half of the claim** | The 17 dead-in-every-environment ids include all four `finance.visibility.*` reach scopes and both `coverage.*` ids (`matrix-run.txt:24-41`). `WF-FIN-006` (EXECUTED): *"a Salesperson and a Sales Manager can see NO financial fact anywhere"* |
| Reporting is the only production-activated family (25 `report.*` ids) | **CONFIRMED** | `PRODUCTION_ACTIVATION_ELIGIBLE_IDS` = exactly 25, all `report.*` (5 entity reads + 20 ordinary field reads). The 14 deferred (4 `report.definition` mutations + 10 sensitive field reads) are absent **on purpose**: *"There is NO prefix matching and no `report.*` wildcard"* — `environmentCapabilityOverrides.ts:43-47` |
| `report.definition.read` is the only capability in that family with working row scope (per `ownerUid`) | **CONFIRMED** | `functions/src/reporting/savedDefinitionCommands.ts:404` — `.where("ownerUid", "==", params.actorUid)`; `ownerUid` is always the trusted `request.auth.uid`, never client-supplied (`:31-32`) |
| A company-scoped number over Accounts/Contacts/Locations cannot be produced correctly today; an Account may span both operating companies (R-14/R-15) | **CONFIRMED** | See §3.3 |
| Labor capabilities are dead in every environment; `work_order_labor_entries` + `JobLabor.jsx` ship | **CONFIRMED by EXECUTED evidence** | See §3.5 |
| Occupancy of all 45 governed business Roles is unknown | **CONFIRMED as to occupancy; the ROLE COUNT needs the EMP-ROLE correction** | See §3.6 |

### 3.3 Operational attribution: the constraint that kills every company-scoped operational metric

The **one duplicated activity in the entire 1,010-record corpus** is this one, and it is this lane's
constraint:

> **"Attribute an operational record to the company that performed the work"** — `P3B3-FIN-056` and
> `P3B3-MGMT-018`, byte-identical title, same actor (Operations Manager), same status **BLOCKED**,
> same blocker. `p3b3-act-sales @ c193866f`.

Blocking mechanism, verbatim: *"OWNER_DECISION_PENDING — the ownership model that would supply
operational company provenance is authored but inert: `config/ownership/operating-company-roots.sandbox.json`
records that its assignments are **'configuration only, NOT applied to any record'**."*

The asymmetry is exact and both halves matter:

| Axis | Status | Evidence |
| --- | --- | --- |
| **Financial** attribution to an operating company | **CLOSED.** `operatingCompanyId` is **NOT NULLABLE** on any reportable financial event; absence is a refusal (`COMPANY_REQUIRED`), never a null to backfill | `functions/src/finance/financialAttribution.ts:151-158` |
| **Operational** attribution to an operating company | **AUTHORITY GAP.** `NO_GOVERNED_COMPANY_SOURCE`; `DECISIONS #143` **forbids inferring it** from technician, dispatcher, creator, customer or location | `performanceMetricRegistry.ts:120`; `WF-SVC-016.break_point` |

**Consequence — OD-EMP-003.** Any per-company or per-business-unit **operational** metric (jobs
completed by company, service volume by company, technician throughput by company) is a **GAP, not a
requirement**. `WF-SVC-016` reaches the same conclusion independently: *"Step 3 is impossible: no Work
Order carries an operating company."* And the registry's `OPERATING_COMPANY` scope binding already
warns that such a goal *"would be measured against a population nothing can attribute"*
(`performanceMetricRegistry.ts:120`).

### 3.4 The contest gap — a person-attributed number nobody can dispute

Three separate pieces of evidence converge, and together they are the strongest reason this lane
proposes only two EMPLOYEE PERFORMANCE metrics.

**(a) The attribution follows a mutable field, not the person who did the work.**
`technician.workOrder.completed.cumulative.count` is ACTIVE. Its `actualAuthority` is
`getTechnicianExecutionStats()`, which queries
`where("assignedTechId", "==", technicianId)` —
`field-ops-app-vite/src/analytics/executionAnalyticsService.ts:136`. `assignedTechId` is written by
the **Dispatch** action (`functions/src/transitionEngine.ts:89-91`) and `ACTION_TIMESTAMP_FIELD`
records **no per-transition actor** on the Work Order (`:91-102`). The service's own comment:
*"a WO that's since been CLOSED by a dispatcher still counts as completed by this technician"*
(`:129-131`). The corpus states the consequence: *"completion counts that include handoffs completed
by the wrong technician and jobs completed with nothing recorded"* — `P3B1-S28-A04`,
`p3b1-act-service @ f7b3d0a9`.

**(b) There is no path to dispute it.** `P3B1-S28-A07` *"Dispute a productivity figure that counts a
job he did not do"* · `expectedUiResult: "No dispute affordance."` · defect recorded verbatim:

> *"**No annotation or correction path exists for a misattributed completion, so immutable execution
> data becomes uncontestable performance data.**"*

The actor who performed each transition IS written to the audit trail
(`functions/src/access/auditEventWriter.ts`), `audit.event.read` is **ACTIVE** — but the audit
collections are **deny-all in `firestore.rules:1692-1694`** and no read path is deployed
(`P3B3-MGMT-039`; `OQ-ADM-08`). **The evidence that would settle a dispute exists and is unreadable.**

**(c) A person-attributed derived number has already shipped wrong once.** This is not hypothetical.
`field-ops-app-vite/src/analytics/executionAnalyticsService.ts:151-161`:

> *"This pushed the difference unconditionally, so a Work Order whose `completedAt` precedes its
> `workStartedAt` contributed a NEGATIVE number to the mean — and **the technician screen reported
> '-1686m' as a performance fact about a person.**"*

The fix is the right one and worth recording as precedent: **not** `Math.abs()`, **not**
`Math.max(0, …)`, **not** a silent timestamp swap — *"Each of those turns evidence the platform cannot
explain into a plausible number, which is worse than showing nothing: it is unfalsifiable."* One
contradictory record withdraws the whole average (`:180-186`), and the three-way
`completionEvidence: {valid, inverted, missing}` counter makes the withdrawal explicable (`:113-122`).
`WF-RPT-003` records the same event as post-acceptance corrective **#1796**.

**Consequence — OD-EMP-006.** No metric may be presented as EMPLOYEE PERFORMANCE unless a contest
path exists. Today none does, so §4.2's two metrics ship as WORKLOAD/CUMULATIVE VOLUME with the
person named as the *subject of the record*, not as the *holder of a score*.

### 3.5 Labour: storage ships, authority is dead everywhere

| Fact | Evidence | Tier |
| --- | --- | --- |
| `workOrder.labor.record` and `workOrder.labor.correct` are `active: false` | `functions/src/access/permissionCatalog.ts:130, :138` | 64008d5a |
| Both are **absent from every** `capabilityActivationOverrides` array, `platform-sandbox` included | `matrix-run.txt:24-26` — *"ACTIVE:FALSE AND NOT SANDBOX-ACTIVATED (dead in every environment): 17 — the list begins `workOrder.labor.record`, `workOrder.labor.correct`"* | **EXECUTED** |
| Both resolve DENY/`inactivePermission` for all 48 roles under BOTH the production and the sandbox activation sets | `WF-SVC-009.break_point`, evidence_status **EXECUTED** | **EXECUTED** |
| Storage ships: `work_order_labor_entries`, `functions/src/workOrderLabor/{laborCallables,workOrderLaborCommand}.ts`, callables exported at `functions/src/index.ts:483-484` | verified present | 64008d5a |
| `work_order_labor_entries` has **no `firestore.rules` match block** → deny-all to every client | `permissionCatalog.ts:122-123` | 64008d5a |
| Two governed Roles declare the capabilities and grant nothing: `technicianLaborRecorder`, `workOrderLaborCorrector` | `functions/src/access/governedBusinessRoles.ts:1595-1610` | 64008d5a |
| `JobLabor.jsx` ships | `field-ops-app-vite/src/modules/mobile/JobLabor.jsx` | 64008d5a |
| Open Owner question | `OQ-ACT-02`: *"Seventeen capabilities can run in no environment at all — labour recording … For each: awaiting security review, awaiting design, or abandoned?"* | 131baa2f |

**Consequence — OD-EMP-002.** The brief's instruction to *"verify"* is discharged: **every**
labour-derived metric — utilisation, billable ratio, labour efficiency, hours-per-job, cost per hour —
is a **GAP, not a requirement**, and the blocker is an activation/authority decision, not measurement
design. `WF-XD-002` shows the business cost: *"Labour cannot be recorded in ANY environment the
repository declares (EXECUTED) … so the most common revenue even[t]"* in a field-service business is
broken.

### 3.6 Role occupancy, the role count, and the sales-channel correction

**The security-Role set is 48, not 45.** 45 governed business Roles
(`functions/src/access/governedBusinessRoles.ts:1683-1729`, counted 45) **plus** `admin`, `dispatcher`
and `technician` in `functions/src/access/compatibilityRoles.ts`. Independently corroborated by the
EXECUTED transcript's own header: `ROLES 48 CAPS 147` (`matrix-run.txt:1`). **The brief's "45
governed business Roles" is right about the governed set and wrong as a count of the roles a metric
can be scoped to.** Correction supplied by lane EMP-ROLE and adopted — OD-EMP-011.

**Occupancy by REAL employees is not measured anywhere in this repository, and the one occupancy
table that exists is over a SYNTHETIC roster.** This is sharper than "unknown" and it changes what a
per-role metric can claim.

`docs/governance/capacity-report.json` is the only occupancy data at this baseline:

| Field | Value | Consequence |
| --- | --- | --- |
| `basis` | *"OPERABLE authority = granted capability INTERSECT permission-catalog active flag. **Granted-but-inactive is ZERO operational capacity.**"* | The correct basis, and it is the same basis this lane uses |
| `environment` | `{ projectId: "eos-platform-sandbox", activationOverrides: 92 }` | **One environment, and it is the sandbox.** It says nothing about production |
| `employeesEvaluated` | `47` | **All 47 are synthetic** — see below |
| `catalog` | `{ total: 147, globallyActive: 38, activeInThisEnvironment: 130, inactiveInThisEnvironment: 17 }` | **Independently corroborates 38 globally active, and the 17 dead-everywhere set** |
| `capacity` | 18 **workstream** rows (not roles): 17 `ADEQUATE`, 1 `THIN` | The one `THIN`: `ACCESS_ADMINISTRATION`, `assignedWorkers: 1`, `operableGovernedOnly: 0`, `borrowsLegacyAuthority: true`, *"single point of failure -- no backup"* |
| `authoritySource.employeesWithZeroOperableGovernedAuthority` | `12` | 12 of 47 synthetic employees hold no operable governed authority at all |
| `inertFunctionalRoles` | exactly **3**, each `bothInactiveAndUnassigned: true` | `equipmentCatalogAdministrator`, **`technicianLaborRecorder`**, **`workOrderLaborCorrector`** |

**The roster is synthetic and says so.** The generator
`functions/scripts/governance/capacityReport.mjs` imports `buildWorkforce()` from
`functions/scripts/certificationWorld/data/workforce.mjs`, whose header reads:

> *"WORKFORCE - synthetic employees on the EXISTING Employee model. **ALL IDENTITIES ARE SYNTHETIC.**
> No real Taylor, Ventana, Phoenix-business or public-directory PII. Names are drawn from fixed lists
> by index so the workforce is deterministic."*

Employee ids confirm it (`"employeeId": "cw-emp-000"`). `docs/governance/activation-readiness.md:199`
names the roster as fixtures in terms: *"**This is sandbox fixture staffing, not hiring advice.**
Roster grows 43 → 47."* And that document opens: *"**Nothing in this document has been executed.**"*

**Synthetic occupancy of the 45 governed Roles: 30 occupied, 15 unoccupied.** The unoccupied 15 include
four that matter to this lane directly:

| Unoccupied Role | Why it matters here |
| --- | --- |
| **`performanceGoalSubject`** — **0 holders** | Its entire purpose is to let a measured person read their own target. **Nobody holds it, even in the sandbox.** This is the occupancy half of `WF-RPT-004`'s surviving gap (*"a technician still cannot read an approved EMPLOYEE-scope goal set for their own governed employee"*) |
| **`technicianLaborRecorder`** | Unoccupied **and** inert (§3.5) |
| **`workOrderLaborCorrector`** | Unoccupied **and** inert — so even the correction path for labour has no holder |
| **`controller`** | Named as an actor on `WF-SVC-016` (the technician scorecard workflow) and on 20 workflows overall |

Also unoccupied: `generalEmployee`, `marketingManager`, `shopManager`, `shopAssociate`,
`inventoryCreateExecutor`, `workOrderPartsPlanner`, `inventoryStockRelocationOperator`,
`inventoryTransferReceiver`, `equipmentCatalogAdministrator`, `emailIntakeAdministrator`,
**`serviceInboundWorkReviewer`**.

**Two role-naming facts that break naive per-role metrics.** (1) **There is no governed business Role
named `technician`** — it is a *compatibility* Role (`functions/src/access/compatibilityRoles.ts`); in
this roster the `securityRole` counts are `dispatcher: 35`, `technician: 11`, `admin: 1`. And the
technician surface **routes on `role === "technician"` — a role string, not a capability**
(`p3a1-arch-service @ 79d21d7d`, §2.13). (2) **There is no governed Role named `dispatcher` or
`serviceCoordinator`** either; the nearest governed Role is `officeManager` (2 holders), described as
*"Office/customer/service coordination"*. **OD-EMP-019.**

**One stale claim to not carry forward.** `docs/governance/effective-authority.md:97-101` heads a
section *"### 1. Reporting — 39 capabilities, nobody holds them (LARGEST OPEN GAP)"* and states
*"No business Role has ever been assigned Reporting, so **Reporting is unreachable for every
persona**."* That document is dated **2026-08-21** and tabulates only **20** Roles — stale against the
current 45. At this baseline `reportViewer` (7), `reportFinanceViewer` (3) and `reportAuthor` (4) all
have holders in the synthetic roster. **The claim is stale; do not cite it.**

Compounding evidence from EMP-ROLE: **26 of 45 governed Roles have no corpus activity at all**, and
proficiency is wholly unmodelled.

**Three ratified sales channels, not two.** Verified in code:

```
functions/src/salesOrder/salesOrderLifecycle.ts:18   export const SALES_CHANNELS = ["NATIONAL_ACCOUNTS", "RETAIL", "STRATEGIC_ACCOUNTS"]
functions/src/opportunity/opportunityLifecycle.ts:27 export const SALES_CHANNELS = ["NATIONAL_ACCOUNTS", "RETAIL", "STRATEGIC_ACCOUNTS"]
```

Both are tagged *"Commercial Coverage (#15) ratified minimum channels — STRATEGIC_ACCOUNTS added."*
**The Owner's binding ruling names only Retail and National Accounts and is SILENT on the third.**
Recorded as MISSING INPUT §9, not resolved.

**The ruling is about JOB roles; the repository's Role model is about SECURITY Roles, and they
deliberately disagree.** This distinction is the whole reconciliation and a synthesiser must not
collapse it. The binding ruling text is **not committed in this worktree at 64008d5a** —
`git ls-tree -r HEAD --name-only | grep -i "operating-model/lanes"` returns nothing; it exists on the
sibling branch `emp/role-map @ 01023fc0` as `docs/operating-model/lanes/EMP-ROLE.md:105` (a lane-brief
restatement). The **authoritative in-repo statement says the opposite about Roles** —
`functions/src/access/roleHierarchy.ts:135-139`, verbatim:

> *"The chart's National Accounts and Retail Sales columns are **CHANNELS**, each with its own
> salespeople. **They are not modelled as separate Roles here** — see PLACEMENT_GAPS. `salesperson` is
> the single Role today, and which channel a person sells into is a property of the **DEAL**
> (SALES_CHANNELS on Opportunity and Sales Order: NATIONAL_ACCOUNTS | RETAIL | STRATEGIC_ACCOUNTS),
> **not of the Role**."*

`roleHierarchy.ts:284` — `PLACEMENT_GAPS`, and it is the array's **only** entry:

> *"National Accounts vs Retail Sales — shown as separate columns under Sales Manager. **Deliberately
> NOT modelled as Roles**: which market a deal belongs to is a property of the DEAL, not of the person.
> A Role per channel multiplies every time a channel is added, and **there are already three**. If a
> national-accounts salesperson must be unable to see retail deals, that is channel-scoped visibility
> — **the deferred coverage model**, not this hierarchy."*

**Both are right, about different things.** Retail and National Accounts are distinct **job roles**
(what a person does, org-chart columns under Sales Manager — corroborated). They are **not** distinct
**security Roles** (`salesperson` is the single one), and the channel lives on the **deal**.
**OD-EMP-020:** a per-channel metric is therefore a **record-level** grouping, not a per-person Role
grouping — and it is still a gap, for the two reasons below.

`salesChannel` is required and validated at creation (`salesOrderCommands.ts:265, :286`;
`opportunityCommands.ts:163, :174`) and is a tracked change field (`opportunityCommands.ts:249`). So
per-channel sales metrics are blocked by **two independent activation blockers, neither of them a
definitional gap**:

1. **Record-level channel is unreachable in production.** `salesOrder.read` and `opportunity.read` are
   `active: false`, sandbox-only. `sales.opportunity.open.count` is blocked on exactly this —
   `performanceMetricRegistry.ts:511-514` (AB-3): *"production remains blocked by design."*
2. **Person-to-channel mapping is dead in every environment.** `coverage.read` and `coverage.write`
   are `active: false` AND among the 17 dead-in-every-environment ids (`matrix-run.txt:30-31`), with
   storage deny-all. `firestore.rules:1828-1831` states the coverage objects hold *"Records only (no
   precedence / credit / commission)."*

EMP-ROLE's corpus measurement corroborates: across all 1,010 activities `retail` appears 0 times and
`national account` 0 times, and *"the evidence distinguishes Retail from National Accounts on **ZERO
of the eleven dimensions**"* — including ACCOUNTABILITIES (*"`creditedSalespersonId` carries no
channel. No per-channel goal, quota or target exists — `quota` = 0 occurrences corpus-wide"*).
**OD-EMP-005** therefore declines to propose any per-channel sales metric, and names the blocker as a
**deferred model** — the Owner's *"record and preserve the seams, do NOT build during the runway."*

**The need is nonetheless real and observed, not authored.** `docs/quality/pilots/sales-001-discovery.md:33, :43`
is a pilot finding, not a scenario: *"No channel/book scoping: **a National Accounts rep's
opportunities are interleaved with Retail**, and the attention-sorted top row was a Retail
opportunity, not theirs."* → `Q-SALES-001-1`. And
`docs/roadmaps/business-capability-register.md:154` records the register entry at maturity
`IDENTIFIED`: *"National Accounts vs Retail attribution, commission eligibility … **Do NOT assume
Opportunity owner = commission recipient.**"* That last clause is an independent corroboration of
OD-EMP-013.

**Service Coordinator and Dispatcher are two roles, not one.** The brief's "Service coordination"
bullet merges them. Corpus `counts.byRole` (`p3b1-act-service @ f7b3d0a9`) distinguishes them:
`service_coordinator` **68** activities, `dispatcher` **61**, disjoint personas. **Coordination
throughput is not dispatch throughput** and §7 splits them. Correction supplied by EMP-ROLE — adopted,
OD-EMP-012.

### 3.7 Completeness: a zero must be provably complete or labelled incomplete

The brief's rule — *"EOS must never present unproven absence as proven emptiness"* — is already
enforced in three places this lane relies on, and violated in one place this lane must flag.

**Enforced.** `crm.account.active.count`'s authority is *"a complete server-side `count()` over the
authorized scope; **never a page, never a sample**. Unknown status values surface as `unclassified`
rather than vanishing"* (`performanceMetricRegistry.ts:557-560`). The goal read service refuses an
over-cap request rather than trimming it: `MAX_TARGETS_PER_READ = 40`, *"A request above it is
REFUSED, not trimmed — trimming would answer a different question than the one asked and say nothing
about having done so"* (`performanceGoalReadService.ts:32-34, :125-126`). And the read service is
**bounded by construction** — *"This service answers 'what is the target for THESE named things', never
'show me the goals'"* (`:3-14`).

**Flagged — UNPROVEN-1.** `getTechnicianExecutionStats()` is the `actualAuthority` for **two of the 12
active metrics**, and it is a **client-side Firestore query with no `limit()`**
(`executionAnalyticsService.ts:136-138`). Two consequences the registry does not record: its row scope
is whatever `firestore.rules` permits rather than a governed server scope, and its completeness at
scale is unverified. This sits awkwardly against the registry's own stated principle that **"DOMAIN
AUTHORITY OWNS THE ACTUAL"** (`:14-16`) — a browser-side read is not a server authority.
**OD-EMP-008.**

---

## 4 · Technician — per-role metrics, axis, attribution, verdict

**Governed Roles in scope:** `technicianLaborRecorder`, `workOrderLaborCorrector` (both declare dead
capabilities, §3.5), plus the compatibility Role `technician`. Corpus personas: `field_technician`
(104 activities), `apprentice_technician` (9).

### 4.1 The three-axis frame is already the Owner's, and it holds

`TechnicianPerformance.jsx` ships with **one populated slot and two reserved-and-visibly-empty slots**,
each naming what is missing. This lane endorses the shape and adds only the axis labels:

| Slot | Axis | Status | Blocker named in the shipped code |
| --- | --- | --- | --- |
| PRODUCTIVITY | WORKLOAD / CUMULATIVE VOLUME | populated | — |
| ON-TIME EXECUTION | TIMELINESS | reserved, `NOT_ENABLED` | *"nothing defines it. `scheduledStart` is the only date authority, and a Work Order records no promise, commitment or SLA to be on time AGAINST"* |
| QUALITY | QUALITY | reserved, `NOT_ENABLED` | *"no revisit linkage exists in the model at all … so the denominator cannot be formed"* |

The `NOT_ENABLED` (rather than `UNAVAILABLE`) choice is deliberate and assistive, not cosmetic —
`UNAVAILABLE` carries `role="alert"`, and *"announcing it as an alert would train a technician to
ignore alerts"* (`TechnicianPerformance.jsx`, comment above the `HonestState`). Recorded because a
synthesiser must not "simplify" it.

### 4.2 Candidate metrics

| Metric | Axis | Attribution | Measurable at 64008d5a? | Authoritative fact / blocker |
| --- | --- | --- | --- | --- |
| `technician.workOrder.completed.cumulative.count` — jobs completed, all time | **WORKLOAD / CUMULATIVE VOLUME** — *not* employee performance | **PERSON**, but via mutable `assignedTechId` | **PARTIAL.** Metric ACTIVE; goal DENY in production (§3.1); attribution contestable (§3.4); client-side unbounded read (§3.7) | `performanceMetricRegistry.ts:327-340`. Rollup **refused**: *"summing two technicians' all-time counts answers no question a manager asked, and the sum grows with tenure rather than with performance"* |
| `technician.workOrder.open.count` — my open assigned work | **WORKLOAD** | **PERSON as subject, not as score** — assigned ≠ chosen | **PARTIAL**, same three caveats | `performanceMetricRegistry.ts:342-355`. Rollup **refused**: *"Summing open assignments across technicians … measures backlog, not performance"* |
| On-time completion / on-time arrival | **TIMELINESS** | would be PERSON+PROCESS jointly | **GAP** | `service.onTimeCompletion.rate` blocked G-14: *"'on time' has no governed definition … Both the predicate and the eligible population are undecided"*. **Refinement:** `arrivedAt` IS a real execution timestamp (`transitionEngine.ts:95`), so `P3B1-S28-A03` is right that *"the raw ingredients exist … the gap is that nothing computes it"* — but **Reschedule overwrites the scheduled window in place, so the original customer promise is lost** and the measure has no anchor |
| First-time completion / first-time fix | **QUALITY** | PERSON only with revisit linkage | **GAP — structural** | `service.firstTimeFix.rate` blocked: *"no revisit, callback or repeat-visit LINKAGE exists in the model. Two Work Orders at one Account for one machine are two independent records; nothing relates them, so **the denominator of a first-time-fix rate cannot be formed at all**"* |
| Throughput / jobs per workday | **WORKLOAD normalised by CAPACITY** | PERSON | **GAP** | `technician.workOrder.completedPerWorkday.ratio` blocked: *"'workday' would have to be derived from `technician_working_availability`, whose governing rule is **ABSENT IS NOT EMPTY**"* |
| **Utilisation** | **CAPACITY — never employee performance** | **RESOURCE, not person** | **GAP, and the existence question is open** | `technician.utilization.rate` blocked F-04/ND-21 (§2.3). `P3B1-S24-A05`: *"Available minutes returns null where availability is unrecorded, and must render as **'no working schedule recorded' rather than 0%**"* |
| Job cycle time | TIMELINESS | PROCESS | **GAP** | `technician.jobCycleTime.days` blocked F-03: *"which timestamp starts the clock is undecided … the comparison POPULATION is undefined as well as the window"* |
| Same-day documentation | PROCESS HEALTH | PERSON | **GAP** | Blocked: *"the offline submission queue that would supply the timing is **CLIENT-LOCAL per device** — it is not a server-side fact and cannot be measured for anyone but the person holding the device"* |
| Unresolved exceptions attributable to a technician | EXCEPTION RATE | **PROCESS, not person** | **GAP** | `WF-SVC-007` (WORKS_WITH_GAPS): *"there is no governed NON-completion outcome: the state machine models forward edges plus CA[NCEL]"*. With no governed "could not complete, and why", an exception cannot be separated from a refusal |
| Average job duration | TIMELINESS | PERSON | **PARTIAL and self-withdrawing** | `executionAnalyticsService.ts:180-186` — one contradictory record withdraws the whole figure. Additional distortion recorded at `P3B1-S28-A02`: *"Average completion time is silently distorted by offline-synced work, because queued transitions carry the sync timestamp rather than the time the technician acted"* |

### 4.3 Capacity is measurable, and it is the honest home for "utilisation"

The one thing the scheduling model supports well (`P3B1-S28-A09`): per-technician **percent booked**,
with available minutes as the denominator and blocked minutes subtracted as a per-minute union —
`functions/src/scheduling/availabilityModel.ts:259-311`.

**OD-EMP-007.** This is a **CAPACITY / planning input** attributed to a **RESOURCE**, and it must never
be relabelled utilisation and pointed at a person. Two guards are mandatory: unrecorded availability
renders *"no working schedule recorded"*, never 0% (`P3B1-S24-A05`); and a **data-coverage worklist**
of technicians with no recorded working hours is a prerequisite, because *"Every capacity number is
wrong until this list is empty"* (`P3B1-S28-A10`). Whether such a list exists is **UNPROVEN-2** — the
corpus says so in terms: *"UNPROVEN whether any surface lists technicians missing availability. The
board draws a lane for them and warns only at placement time."*

---

## 5 · Sales — and the binding two-role ruling, now three channels

**The ruling is honoured by producing NO single "Sales" metric set.** Retail Sales and National
Accounts Sales are distinct job roles; `STRATEGIC_ACCOUNTS` is a third ratified channel the ruling
does not address (§3.6).

| Metric | Axis | Attribution | Measurable at 64008d5a? | Authoritative fact / blocker |
| --- | --- | --- | --- | --- |
| Individual dollars vs goal (booked) | **BUSINESS OUTCOME** with person credit | **PERSON** via `creditedSalespersonId` | **GAP — two independent blockers** | `sales.booked.amount` blocked **AB-2**: *"no bounded read for booked facts exists at all: `listFinancialFacts` serves persisted fact types only and **excludes booked BY CONSTRUCTION, test-guarded**. This blocker is independent of reach and of the period — even a principal with CONSOLIDATED reach has nothing to read"* |
| Individual dollars vs goal (billed) | **BUSINESS OUTCOME** | **PERSON** via `creditedSalespersonId` | **PARTIAL — the best-placed commercial metric in the document** | `sales.billed.amount` is **ACTIVE** (`:464`): real read, governed `eventAtMillis`, governed window. **But** the principal's reach is dead: `finance.visibility.self`/`.team` are among the 17 dead-in-every-environment ids, so *"a Salesperson and a Sales Manager can see NO financial fact anywhere"* (`WF-FIN-006`, EXECUTED) |
| Individual dollars vs goal (collected) | **BUSINESS OUTCOME** | **PERSON** | **PARTIAL**, same reach blocker | `sales.collected.amount` ACTIVE (`:481`) — payment applications at `recordedAtMillis` |
| Company dollars | **BUSINESS OUTCOME** | **BUSINESS**, never a person | **GAP at consolidated scope** | `sales.consolidatedBilled.amount` blocked FIN-BLOCK-004, typed `UNELIMINATED_SUM` and *"must render with that caveat rather than as a company total"*. `WF-FIN-009` (EXECUTED) calls it *"the registry's clearest example of a workflow that is blocked correctly: FIN-BLOCK-004 is a recorded refusal to guess, not a gap"* |
| Pipeline health — open opportunity count | PROCESS HEALTH | PERSON or TEAM | **GAP (activation)** | `sales.opportunity.open.count` blocked AB-3: `opportunity.read` sandbox-lifted only, *"production remains blocked by design"* |
| Pipeline health — pipeline value | BUSINESS OUTCOME (forecast) | PERSON | **GAP — unit-less** | `sales.pipeline.value` blocked G-18: *"an Opportunity's `expectedValue` is a **CURRENCY-LESS** forecast-flavoured number that flows nowhere … **Summing it would produce a figure in no unit at all**"* |
| Average order value | BUSINESS OUTCOME | PERSON | **GAP — definitional** | `sales.averageOrderValue.amount` blocked G-08: *"FIN-003 invariant A forbids blending bases, so WHICH basis forms the numerator (booked, billed, collected) is a required decision before the metric has meaning"* |
| Customer follow-up | PROCESS HEALTH | **PERSON as owner of an obligation** | **GAP** | `crm.activity.{create,read}` are sandbox-eligible only. No governed follow-up-due / next-action-overdue fact exists; `obligationAttention.js` *"states by name that it does not invent SLA, risk score, customer promise, severity or ETA"* (quoted at `performanceMetricRegistry.ts:273`) |
| Active accounts in portfolio | **BUSINESS OUTCOME** | **BUSINESS** — registered `FIRM` scope only | **MEASURABLE** (the one clean commercial-adjacent number) | `crm.account.active.count` ACTIVE — *"a complete server-side `count()` … never a page, never a sample"*. **But `FIRM` only:** it cannot be attributed to a person, and `WF-RPT-003` records it as *"the section's only live figure"* for the Salesperson persona |
| **Per-channel split of any of the above** | any | PERSON×CHANNEL | **GAP — deferred model** | §3.6 — record-level channel unreachable in production; person↔channel coverage dead in every environment; **OD-EMP-005** |
| **Commission / sales credit split** | — | — | **DECLINED, not a gap** | §6, **OD-EMP-013** |

**A design note the North Star already gets right and a synthesiser must not "fix".** For the
Salesperson, the goal half of "% attainment" IS governed and the actual half is not — so the tile
shows *"a real target and an unavailable actual — which is the honest shape of 'we know what you
should do and cannot yet tell you how you did'"*
(`docs/north-star/my-dashboard/DESIGN-HANDOFF-MY-DASHBOARD-P1v2.md`). And **a gated module holds its
place**: *"Re-ranking a dashboard around what happens to be available today teaches the reader that
availability is importance."*

---

## 6 · Metrics this lane DECLINED to propose, and why

| Declined metric | Why declined |
| --- | --- |
| **Any composite "employee score", index, rating or ranking** | It is the failure mode the lane exists to prevent, and it has no authority: no Owner-stated standard exists (§9), and the only aggregation rules in the registry are `SUM` and `RATIO_OF_SUMS` over one metric — **nothing in the repository permits combining metrics into one figure.** Adding a weighting would be minting policy |
| **Leaderboards / peer ranking / stack ranking** | `P3B1-S28-A04` establishes that comparison *"inherits every attribution defect … with no indication of which numbers are sound"*. A ranking amplifies each defect and hides its provenance |
| **Technician utilisation as an employee metric** | §2.3 / §4.2. It is CAPACITY; both halves of the quotient are optional; and the registry records that *whether the figure may exist at all* is the open question. **OD-EMP-002** |
| **Commission, sales credit split, or any pay-linked metric** | `P3B3-SALES-046` status **NOT_SUPPORTED**: *"Coverage explicitly records no precedence, credit or commission, and **nothing else in EOS does either**"*; *"No commission module exists in `functions/src/`"*. `OQ-SLS-11` is an OPEN Owner question. Proposing one would be inferring a compensation policy Taylor has not stated — **directly prohibited. OD-EMP-013** |
| **Any metric carrying a threshold, band, target value or pass/fail line** | A threshold IS a policy. The repository refuses invented values consistently and by name: *"adopting an industry-standard percentage is expressly refused: the number would be invented, not measured"* (`inventory.carryingCost.amount`); *"Inventing an expected date is expressly refused"* (`purchasing.supplierOnTime.rate`); *"A manually-entered `wasteSaved` figure is expressly refused"*. **Targets are the Owner's to set through `performance.goal.create`, not this lane's to embed** |
| **Any metric derived from job title, seniority, certification or proficiency** | Title comparison is *"expressly forbidden"* (`performanceGoalAuthority.ts:93`). Proficiency is **wholly unmodelled**, and a job requiring an unheld certification completes with *"Nothing warns"* (`P3B1-S17-A06`). **OD-EMP-023** |
| **Anything on the ratified DO-NOT-BUILD list** | It is **design authority**, reserved as *"named absences so a later session does not re-derive them"* — and it names technician utilisation, first-time fix, jobs-per-workday, SLA/response, callbacks, AOV, pipeline value, aging buckets, stockout rate, inventory value/turns/carrying cost and waste avoided (§2.3). Re-proposing any of them is re-deriving a named absence |
| **A corpus-derived exception rate for any commercial role** | `P3-B3`'s 350 rows carry no friction, coverage, device or company tags. Such a rate would report **missing instrumentation as good performance** (OD-EMP-021) |
| **Any BUSINESS OUTCOME metric for General Manager or Service Billing Admin** | 0 of 9 and 0 of 5 finishable workflows respectively (OD-EMP-022) |
| **Cross-domain "what did this employee do" rollup** | `P3B3-MGMT-039` **PARTIAL**: `Employee` is a wave-4 reportable object with `fieldsPopulated: false` (`functions/src/reporting/reportCatalog.ts:96`); the audit trail that would answer it is deny-all (§3.4b). The workflow registry additionally records a cross-domain activity roll-up as **Owner-retired (X-4)** |
| **A TEAM-scoped metric of any kind** | `GOAL_SCOPE_BINDINGS.TEAM.bindable = false`: *"**NO TEAM ENTITY EXISTS.** There is no `teams` collection and no `reportsTo` edge on the employee record … with role-only hierarchy EVERY `salesManager` sees EVERY `salesperson`"*. A manager may still VIEW a rollup over their visibility set — *"it is not a team, and it cannot be the durable target of a stored goal"* |
| **Any operational metric scoped to an operating company or business unit** | §3.3. `DECISIONS #143` forbids inferring it; the ownership config is *"NOT applied to any record"*. **OD-EMP-003** |
| **Any per-channel sales metric** | §3.6. **OD-EMP-005** |
| **"Responsibility gaps" as a per-person metric** | §7 — it is genuinely measurable as a **PROCESS HEALTH** signal and genuinely not attributable to a person. Recorded on the process axis only |

---

## 7 · Inventory / Parts · Service coordination · Dispatch

**Service Coordinator and Dispatcher are separate roles throughout** (§3.6).

| Metric | Role | Axis | Attribution | Verdict | Authoritative fact / blocker |
| --- | --- | --- | --- | --- | --- |
| Open reorder requests | Parts / Warehouse | PROCESS HEALTH | **LOCATION**, not person | **MEASURABLE** (`LOCATION`, `FIRM`) | `parts.reorderRequest.open.count` ACTIVE — *"the picker filters by the same authority the create enforces (offered == accepted)"* |
| POs awaiting receipt | Receiving | PROCESS HEALTH | **LOCATION** | **MEASURABLE** | `receiving.purchaseOrder.receivable.count` ACTIVE — `inventory.stock.receive` is active and *"needs no override"* |
| Open purchase orders | Purchasing | PROCESS HEALTH | **BUSINESS** (`FIRM` only) | **MEASURABLE** | `purchasing.purchaseOrder.open.count` ACTIVE |
| **Inventory accuracy** | Inventory | QUALITY | **LOCATION / PROCESS** — never a counter's score | **GAP — two blockers** | `inventory.accuracy.rate` blocked AB-4 (`inventory.cycleCount.*` catalog-inactive, sandbox-overridden) **AND** undefined rate: *"whether accuracy is counted by line, by part, by unit or by value is a decision"*, and the value option needs the valuation policy FIN-BLOCK-003A left open. `WF-INV-010` BROKEN_MIDWAY / EXECUTED: *"Step 5 names a capability that does not exist"* |
| **Unexplained loss or waste** | Inventory | BUSINESS OUTCOME | **LOCATION** | **GAP — three missing things, one closed** | `inventory.wasteAvoided.amount`: a governed **PREVENTION event** is *"STILL MISSING, and it is the binding constraint"*; a cost basis is *now partly available*; a stated **COUNTERFACTUAL** is *"an Owner decision, not an implementation detail. STILL MISSING"* |
| **Obsolete / slow-moving inventory** | Inventory | BUSINESS OUTCOME | **LOCATION** | **GAP** | `inventory.slowMoving.count` blocked G-09: *"no aging implementation exists; the thresholds AND the clock-start event are both undecided"* |
| **Service-impact shortage** | Parts | PROCESS HEALTH | **PROCESS** | **PARTIAL — count yes, rate no** | `service.workOrder.partsBlocked.count` is **ACTIVE** at `FIRM` and is the honest form of this metric: *"NO_PLAN is never surfaced … and UNKNOWN readiness is never escalated"*. The **rate** version is a GAP: `inventory.partsAvailability.rate` blocked AB-1 + G-10, and *"**UNKNOWN is INFECTIOUS** in the ATP computation … a rate over a population containing one unknown part is itself unknown, not merely smaller"* |
| **Purchasing follow-through** | Purchasing | TIMELINESS | **PROCESS**, not the buyer | **GAP** | `purchasing.poCycleTime.days` blocked G-12: *"`procurementService.ts`'s create/approve/send remain UNEXPORTED … There are **no governed stage timestamps** between which a cycle time could be measured"* |
| Supplier on-time supply | Purchasing | TIMELINESS | **SUPPLIER**, never an employee | **GAP** | Blocked G-12: *"no expected receipt date, promise date or supplier SLA exists … so 'on time' has nothing to be on time AGAINST"* |
| Emergency purchase rate | Purchasing | EXCEPTION RATE | PROCESS | **GAP** | Blocked: *"urgency is a requester's **assertion at creation time**, not a governed property of the resulting purchase — reading one as the other would relabel a field to mean something nobody entered"* |
| Receipt discrepancy rate | Receiving | QUALITY / EXCEPTION | **PROCESS** | **GAP — numerator only** | *"The numerator exists; the **DENOMINATOR does not.** Whether the rate is per receipt, per PO, per line or per unit is undecided"* |
| **Overdue work** | Service Coordinator | **PROCESS HEALTH** | **PROCESS — `FIRM` scope only, cannot be pointed at a person** | **MEASURABLE** | `service.workOrder.pastDue.count` ACTIVE, *"applied GLOBALLY (not week-bound). `scheduledStart` is the only date authority and exists only once scheduled"* |
| **Unassigned / ready-to-schedule work** | Dispatcher | **PROCESS HEALTH** | **PROCESS**, `FIRM` only | **MEASURABLE** | `service.workOrder.readyToSchedule.count` ACTIVE over `SCHEDULABLE_STATUS`, *"derived from the transition table rather than listed"* |
| **Scheduling exceptions** | Dispatcher | **EXCEPTION RATE** | **PROCESS**, `FIRM` only | **MEASURABLE** | `service.workOrder.schedulingConflict.count` ACTIVE via `detectDayOverlaps()` — *"the same primitives the scheduling workspace uses"* |
| Time-in-backlog (READY_TO_DISPATCH → SCHEDULED) | Dispatcher | TIMELINESS | PROCESS | **GAP** | `P3B1-S28-A08`: *"Neither MarkReady nor Schedule records when it happened, so time-in-backlog — the measure of whether dispatch is coping — has no anchor on the Work Order record."* Confirmed: `ACTION_TIMESTAMP_FIELD` (`transitionEngine.ts:91-102`) omits MarkReady, Schedule and Unschedule |
| **Responsibility gaps** | Service Coordinator | **PROCESS HEALTH** | **PROCESS — explicitly NOT a person** | **MEASURABLE as a corpus/design signal; NOT as a production metric** | See below |

### 7.1 Responsibility gaps — measurable, and measurably not about a person

The brief asks for *"responsibility gaps."* They **are** measured at this baseline, and the measurement
is a **design/UX signal over the corpus**, not a production read.

#### ⚠ The denominator is 660, not 1,010 — state it or the metric lies

**`P3-B3` contributes 350 rows (34.7% of the corpus) and carries NO `scores`/`frictionScore` field, no
coverage tags, no device tag and no operating company.** Verified: the friction field is present on
330/330 in `p3b2-act-inventory` and 330/330 in `p3b1-act-service` (as `frictionScore`), and on **0 of
350** in `p3b3-act-sales` — whose record keys are
`{actor_role, authority_path, id, narrative, objects_touched, status, title, trigger}` plus
per-block extras, with no score object anywhere.

**Consequence — OD-EMP-021.** Any exception-rate, friction, ownership-clarity or device-derived figure
computed over this corpus has a denominator of **660**, and **Sales, CRM, Finance and Administration
contribute zero rows to those axes.** A metric reading *"commercial roles show fewer exceptions"*
would be **an artefact of missing instrumentation, not a finding.** **The silence is a measurement
gap, not a low exception rate**, and any such number must carry its denominator on its face. Correction
supplied by lane EMP-WORK and adopted.

#### The figures, with their denominator attached

Inventory corpus only — `p3b2-act-inventory @ 96427a07`,
`docs/scenarios/day-in-the-life/inventory-warehouse-purchasing.json`, `scores` present on **330 of
330**, keys declared in `vocabulary.score_keys`. Three are exactly the responsibility question:

| `scores` key | true **/ 330 inventory activities** | What it flags |
| --- | --- | --- |
| `ownership_unclear` | **91** | who owns this record/step is not evident |
| `role_handoff_unclear` | **34** | the handoff between two roles is not evident |
| `operating_company_attribution_unclear` | **52** | which company this belongs to is not evident |

*(For completeness, same denominator: `no_obvious_what_next_location` 119, `recovery_unclear` 115,
`no_obvious_why_location` 99, `had_to_hunt_for_information` 93, `help_missing_when_needed` 67,
`ai_could_materially_shorten` 9, `ai_would_be_noise` 5, `unnecessary_explanation_occupying_page` 3.)*

### 7.2 The `scores` field — inspected, and it does NOT score a person

The brief asked this lane to inspect the corpus `scores` field. **Verdict, and it is unambiguous:**

**`scores` scores the PRODUCT SURFACE, never a person.** All 11 keys are boolean assertions about the
screen and the flow — *did the user have to hunt for information, was help missing, is ownership
unclear, is recovery unclear.* Not one names an employee, a persona's competence, an outcome, a
quantity or a standard. The same structure appears in the service corpus under the singular name
`frictionScore` with the same 11 semantics in camelCase
(`p3b1-act-service @ f7b3d0a9`), and it is listed there among the fields the correcting lane
guaranteed it did **not** re-author.

**OD-EMP-014.** `scores` / `frictionScore` is a **PROCESS HEALTH and product-design** signal, is
**authored rather than observed**, and may **never** be read as employee performance, a quality
measure, or an input to one. **The only thing in the 1,010-record evidence corpus called a "score" is
a score of EOS, not of a person.** A synthesiser must not promote it.

### 7.3 Three roles for which NO business-outcome metric is measurable today

Supplied by lane EMP-WORK from the workflow registry, and consistent with this lane's own reading of
`WF-SVC-016`, `WF-FIN-002` and `WF-XD-002`:

| Role | Finishable workflows | Why it matters to this lane |
| --- | --- | --- |
| **General Manager** | **0 of 9** | The person **accountable for the numbers** has no finishable workflow. `WF-RPT-004` and `P3B3-MGMT-016` both name General Manager as the goal *approver* — and approval is capability-inactive |
| **Service Billing Admin** | **0 of 5** | The person who **turns work into money**. Blocked at both ends: labour cannot be recorded (`WF-SVC-009`, EXECUTED) and a break-fix Work Order has no route into the billing spine (`WF-FIN-002`) |
| **Controller** | **20 workflows, 15% finishable** | Carries the most workflows of any role and is an actor on `WF-SVC-016` — and the governed `controller` Role has **zero holders** even in the synthetic roster (§3.6) |

**OD-EMP-022.** **No BUSINESS OUTCOME metric is proposed for General Manager or Service Billing Admin.**
Not because the outcome is undefined, but because no workflow that would produce it can complete. This
is a **GAP, not a requirement.**

### 7.4 Quality conditioned on certification has no backing fact

`P3B1-S17-A06` (`p3b1-act-service @ f7b3d0a9`) completes a job requiring a certification the technician
does not hold, and the expected result is recorded as **"Nothing warns."** Combined with EMP-ROLE's
finding that **proficiency is wholly unmodelled**, **OD-EMP-023:** any QUALITY or eligibility metric
conditioned on certification, licence, skill or proficiency is a **GAP with no backing fact** — and
this lane declines to propose one. A competence metric over an unmodelled competence would be pure
invention about a person, which is the prohibited direction.

### 7.5 Provenance caution — authored narrative is a hypothesis, not measured behaviour

**968 of 1,010 corpus records were never executed**, and the service library states it flatly:
*"NOTHING IN THIS LIBRARY HAS BEEN EXECUTED. No activity was run against any real or production
system. Every `executionResult` is NOT_RUN. **No activity is labelled PASS, and an unexecuted activity
may never be.**"*

**OD-EMP-024.** Corpus activities — including every one cited in this document — are **authored
scenarios**, evidence of what a designer expected, not of what a person did. They are legitimate
evidence *that a metric's authority is missing* (a code reference either exists or does not) and
illegitimate evidence *of how often anything happens.* **No metric in this document may take its
numerator, denominator, rate or baseline from an authored activity.** The same caution applies to
EMP-WORK's outside-EOS and lost-in-handoff sections, which rest entirely on authored narrative.

Where this lane relies on **EXECUTED** evidence it says so: the labour-dead-everywhere finding (§3.5),
the production capability count (§3.2), `WF-SVC-009`, `WF-RPT-004`, `WF-FIN-006`, `WF-FIN-008`,
`WF-FIN-009`, `WF-INV-010`, `WF-XD-002` — **34 of 86 workflows**, and those are the only load-bearing
claims here.

---

## 8 · Numbered decisions

| # | Decision | Anchor |
| --- | --- | --- |
| **OD-EMP-001** | **No metric in this document is production-measurable as a goal today.** All five `performance.goal.*` capabilities resolve DENY outside `platform-sandbox`; `performance_goals` has no `firestore.rules` match block. What is missing is an **activation decision, not code**. The registry's `activeForGoals` flag means "measurable in principle", never "any principal may see it" | §3.1 |
| **OD-EMP-002** | **Utilisation, and every labour-derived metric, is a GAP — not a requirement.** Labour capabilities are dead in every environment (EXECUTED). Utilisation's blocker states that *whether the figure may exist at all* is the open question. **Uphold the refusal; do not activate the metric to fill a slot** | §2.3, §3.5 |
| **OD-EMP-003** | **No operational metric may be scoped to an operating company or business unit.** `DECISIONS #143` forbids inferring it; the ownership config is *"NOT applied to any record"*. Financial attribution is closed; operational is an authority gap | §3.3 |
| **OD-EMP-004** | **EMPLOYEE PERFORMANCE carries exactly two metrics, and both are labelled WORKLOAD/CUMULATIVE VOLUME rather than performance** until OD-EMP-006 is satisfied. Everything else on the person axis is a gap | §4.2 |
| **OD-EMP-005** | **No per-channel sales metric is proposed.** Three ratified channels exist in code; the Owner's ruling names two; the record-level channel is production-unreachable and the person↔channel mapping (coverage) is dead everywhere. **A deferred model, not a measurement-design gap** | §3.6 |
| **OD-EMP-006** | **A metric may not be presented as EMPLOYEE PERFORMANCE without a contest path.** None exists: *"immutable execution data becomes uncontestable performance data"*, and the audit trail that would settle a dispute is deny-all. **Contestability is a precondition, not a later feature** | §3.4 |
| **OD-EMP-007** | **Per-technician percent-booked is CAPACITY attributed to a RESOURCE.** It may never be relabelled utilisation or pointed at a person. Unrecorded availability renders *"no working schedule recorded"*, never 0%; a data-coverage worklist is a prerequisite | §4.3 |
| **OD-EMP-008** | **Two of the 12 active metrics rest on a client-side unbounded Firestore query**, not a governed server authority — in tension with the registry's own *"DOMAIN AUTHORITY OWNS THE ACTUAL"*. Any production use needs a server-side authority with a provable scope, or the number must be labelled incomplete | §3.7 |
| **OD-EMP-009** | **North Star §11 "billed reads pending activation" is now stale in one direction.** `sales.billed.amount` and `sales.collected.amount` were ACTIVATED by Decision #163. The surviving blocker moved from the metric to the principal's finance reach | §2.1 R5 |
| **OD-EMP-010** | **The SELF and TEAM views the North Star draws are precisely the two that can resolve nothing.** `finance.visibility.self`/`.team` are dead in every environment; only `.consolidated` is activated anywhere. The page's DENIED withheld panel is therefore the *normal* state for a salesperson, not the exception | §2.1 R6 |
| **OD-EMP-011** | **The scopeable security-Role set is 48, not 45** (45 governed + 3 compatibility), corroborated by the EXECUTED transcript's `ROLES 48`. Occupancy of all of them remains unknown | §3.6 |
| **OD-EMP-012** | **Service Coordinator and Dispatcher are two roles with different metrics.** Coordination throughput is not dispatch throughput; the corpus separates them 68/61 with disjoint personas | §3.6, §7 |
| **OD-EMP-013** | **Commission and sales-credit split are DECLINED, not deferred.** `NOT_SUPPORTED`; no commission module exists anywhere; `OQ-SLS-11` is open. Proposing one would infer a compensation policy Taylor has not stated | §6 |
| **OD-EMP-014** | **The corpus `scores` / `frictionScore` field scores the PRODUCT, not the person**, and is authored rather than observed. It may never be read as employee performance or as an input to it | §7.2 |
| **OD-EMP-015** | **Only 1 of the 8 axes is about a person, and the useful metrics cluster on PROCESS HEALTH.** Of the 12 registry-active metrics: 7 PROCESS HEALTH / EXCEPTION, 2 WORKLOAD, 2 BUSINESS OUTCOME, 1 BUSINESS OUTCOME at FIRM. **Zero are EMPLOYEE PERFORMANCE as measured.** Only **4 of 37** registered metrics are both `EMPLOYEE`-scoped **and** active. This is the lane's answer to its purpose, and it is a finding rather than a shortfall | §1, §2.2 |
| **OD-EMP-016** | **The Employee Performance surface is WIRED to a real server rollup, not to fixtures.** North Star §10's "specimen fixtures" is stale. It renders Person · Basis · Billed · Collected · Outstanding · Goal from `listFinancialFacts`' `byCreditedSalesperson`. Its emptiness in production is a **capability** fact (`finance.read` inactive), not a design placeholder | §2.1 R4 |
| **OD-EMP-017** | **A metric can name a person through exactly TWO governed facts:** `creditedSalespersonId` on issued invoices, and `assignedTechId` on `fieldops_wos`. `responsibleEmployeeId` is declared and never populated; `accountOwner` is client-writable and 0/103 populated; Work Orders record no creator. **So the North Star's "Service responsibility" view is structurally empty, not merely unactivated** | §2.1 R4b, §2.5 |
| **OD-EMP-018** | **There are TWO goal authorities.** `performance_goals` (machinery complete, capabilities inactive) and FIN-003 plan records (`FIN-AG-PLAN`: no collection, no command, no read callable). A target in one does not populate the other. **Never say "goals exist" without naming which** | §2.4 |
| **OD-EMP-019** | **`technician`, `dispatcher` and `serviceCoordinator` are not governed business Roles.** `technician` and `dispatcher` are compatibility Roles; the technician surface routes on the **role string**, not a capability. A per-role metric keyed on a governed Role id cannot reach a technician at all today | §3.6 |
| **OD-EMP-020** | **Retail / National Accounts are distinct JOB roles and NOT distinct SECURITY Roles, deliberately.** `salesperson` is the single Role; the channel lives on the **deal** (`SALES_CHANNELS`). A per-channel metric is a record-level grouping, not a per-person Role grouping — and still a gap (OD-EMP-005) | §3.6 |
| **OD-EMP-021** | **Every corpus-derived friction / exception / ownership-clarity figure has a denominator of 660, not 1,010**, and Sales/CRM/Finance/Administration contribute **zero** rows. **The silence is a measurement gap, not a low exception rate.** State the denominator on the face of any such number | §7.1 |
| **OD-EMP-022** | **No BUSINESS OUTCOME metric is measurable for General Manager (0 of 9 finishable workflows) or Service Billing Admin (0 of 5)** — the person accountable for the numbers and the person who turns work into money. A GAP, not a requirement | §7.3 |
| **OD-EMP-023** | **Any QUALITY or eligibility metric conditioned on certification, licence, skill or proficiency is a GAP with no backing fact.** Proficiency is wholly unmodelled, and a job requiring an unheld certification completes with *"Nothing warns."* | §7.4 |
| **OD-EMP-024** | **No metric may take its numerator, denominator, rate or baseline from an authored corpus activity.** 968 of 1,010 were never executed; *"an unexecuted activity may never be [labelled PASS]."* Corpus activities are legitimate evidence that an authority is missing, never evidence of how often something happens | §7.5 |
| **OD-EMP-025** | **The only occupancy data in the repository is over a SYNTHETIC sandbox roster of 47 deterministic fixtures**, in one environment, and `performanceGoalSubject` — the Role whose entire purpose is letting a measured person read their own target — has **zero holders even there**. Occupancy by real employees is measured nowhere | §3.6 |

---

## 9 · MISSING INPUT

Marked, never inferred.

| # | Missing input | Why only the Owner can supply it |
| --- | --- | --- |
| MI-1 | **The Owner's separate employee-design conversation** | Not available to this run, and it is the **only legitimate source for what Taylor actually rewards or reviews.** The three directions reachable at this baseline (§0) all describe the *shape* of a performance surface and **none states a consequence** |
| MI-2 | **Design r1 artifacts** | Unavailable to this run |
| MI-3 | **Whether any metric here has a pay or review consequence at all** | Nothing in the repository states one. Every threshold, band and weighting is therefore out of scope (§6) |
| MI-4 | **What `STRATEGIC_ACCOUNTS` is entitled to** | Three channels are ratified in code; the binding ruling names Retail and National Accounts and is silent on the third |
| MI-5 | **`OQ-SLS-11` — how sales credit is split when more than one person contributed** | *"Coverage explicitly records no precedence, credit or commission, and nothing else does either"* |
| MI-6 | **`OQ-ACT-02` — for each of the 17 dead capabilities (labour recording included): awaiting security review, awaiting design, or abandoned?** | Decides whether labour-derived metrics are a roadmap item or permanently out of scope |
| MI-7 | **`OQ-ACT-01` — the sequence and gating for production activation**, and whether sandbox's 92-id array is the intended production target or a superset needing trimming | Decides when OD-EMP-001 lifts |
| MI-8 | **`OQ-COMP-02` / `OQ-COMP-03` — does a Work Order carry its own operating company, and what do the four inventory record families inherit from now?** | Gates every per-company operational metric (OD-EMP-003) |
| MI-9 | **`OQ-ADM-08` — should the audit authority be readable from the product?** | The audit trail is the only record of who performed each transition; it gates the contest path (OD-EMP-006) |
| MI-10 | **The definition of "on time"** — what a Work Order promises, and whether a reschedule preserves the original promise | Both the predicate and the eligible population are undecided; Reschedule currently overwrites the window in place |
| MI-11 | **Whether a utilisation figure may exist at all** | The registry poses this as the open question, ahead of how to compute it — and the archaeology's DO-NOT-BUILD list already answers "not yet" |
| MI-12 | **Who owns repairing the impossible-lifecycle records, rather than the display?** | The archaeology's own open question. The surface was made honest; the data was not repaired. Any future duration metric inherits the bad rows |
| MI-13 | **`FIN-PQ-TEAM-GOAL` — what happens to a goal when the roster changes mid-period?** | Unanswered (`p3a3 :562`). Gates any period-based target |
| MI-14 | **Should `performanceGoalSubject` be assigned to anyone?** | The Role exists precisely so a measured person can read their own target, and holds zero holders even in the sandbox. Nobody has decided whether it is intended for use |

---

## 10 · UNPROVEN, and what in the brief I found wrong

### UNPROVEN

| # | Claim | Why unproven |
| --- | --- | --- |
| UNPROVEN-1 | That `getTechnicianExecutionStats()` returns a **complete** population | Client-side Firestore query with **no `limit()`**. Completeness at scale is unverified and its row scope is `firestore.rules`, not a governed server scope. A zero from it is not provably complete |
| UNPROVEN-2 | That any surface lists technicians with no recorded working availability | Corpus states it verbatim as UNPROVEN: *"The board draws a lane for them and warns only at placement time."* Prerequisite for OD-EMP-007 |
| UNPROVEN-3 | Occupancy of any governed Role | A per-role metric over an unoccupied Role is empty. EMP-ROLE adds that 26 of 45 governed Roles have no corpus activity |
| UNPROVEN-4 | That any metric in this document has ever produced a correct number **in production** | 0 of 86 workflows proven end-to-end; the four performance-relevant workflows are `CANNOT_START` ×2, `BROKEN_MIDWAY` ×1, `WORKS_WITH_GAPS` ×1 |
| UNPROVEN-5 | That the 12 registry-active metrics are reachable by any real principal | Reach was measured per Role, not per real employee; occupancy is unknown (UNPROVEN-3) |
| UNPROVEN-6 | That `arrivedAt` is populated often enough for an on-time-arrival measure | The field exists (`transitionEngine.ts:95`); population rates are unmeasured |
| UNPROVEN-7 | The corpus is **authored, not observed** — 968 of 1,010 records were never run | Stated by the corpus itself: *"NOTHING IN THIS LIBRARY HAS BEEN EXECUTED … an unexecuted activity may never be [labelled PASS]"* |
| UNPROVEN-8 | That **any real employee** holds any governed Role | The only occupancy table is over 47 **synthetic** deterministic fixtures in `eos-platform-sandbox` (`cw-emp-000`, *"ALL IDENTITIES ARE SYNTHETIC"*). Every per-role statement in this document inherits that limit |
| UNPROVEN-9 | That `creditedSalespersonId` is populated densely enough for a per-salesperson number to be meaningful | The field is governed and frozen, but its **population rate is unmeasured**. The shipped component already handles the gap honestly: *"Invoices issued by a command build that predates attribution stamping carry no credited salesperson at all. They are real, they are visible, and they are NOT placed on this axis… **No person gets a zero row for work the record cannot attribute to them.**"* That is the correct behaviour **and** it means the axis is silently partial |
| UNPROVEN-10 | That the negative-duration records are gone | They are not. `p3a1-arch-service @ 79d21d7d` §2.13: *"**the underlying records were NOT repaired**"* — the sandbox still holds them; the **surface** was made honest instead. The archaeology's own open question: *"a technician's average duration is computed over records the lifecycle says are impossible. **Who owns repairing the data rather than the display?**"* |

### Things in this brief I found wrong or imprecise

| Brief statement | Finding |
| --- | --- |
| *"62 of 147 capabilities resolve ALLOW in production"* | **NOT REPRODUCIBLE — three independent measurements agree on 37/38, none on 62.** (1) The EXECUTED transcript: **`ALLOWED ANYWHERE IN PRODUCTION: 37`**. (2) The catalog: 147 ids, **109 explicitly `active: false`** → 38 active-by-omission (`active?: boolean`, only `=== false` denies). (3) `docs/governance/capacity-report.json.catalog` independently reports **`globallyActive: 38`** (and `inactiveInThisEnvironment: 17`, matching the dead-everywhere set). **62 is not derivable from this baseline by any counting I could construct.** *The conclusion the brief draws from it — no commercial outcome is measurable from production EOS — is nonetheless CONFIRMED, and by stronger evidence than the count* (§3.2) |
| *"1,010 records / **1,009 distinct**"* | **Correct, but not about ids.** All **1,010 activity ids are unique** (verified by set comparison). The 1,009 figure counts distinct **activities**: `P3B3-FIN-056` and `P3B3-MGMT-018` are the same activity under two ids, each retained because it is cited elsewhere, with instructions to *"count this activity ONCE."* **The duplicate is *"Attribute an operational record to the company that performed the work"* — the single most load-bearing blocker in this lane** (§3.3) |
| *"no `VITE_EOS_API_BASE_URL` committed anywhere"* | **Imprecise.** The identifier is committed in 2 files; no **value** is set in any environment. The reachability conclusion stands |
| *"`technician.utilization.rate` referencing `blocked(...)` with no computation behind it"* | **True and the framing inverts the meaning.** The file computes nothing **by design and by explicit contract**; `blocked(...)` is a named refusal, not a stub. Reported as a defect it would invite someone to "fix" it by computing a number the registry deliberately refuses (§2.3) |
| *"45 governed business Roles"* — used as the scopeable role set | **Right about the governed set, wrong as the scopeable set: it is 48** (45 governed + `admin`/`dispatcher`/`technician`), corroborated by `ROLES 48` in the EXECUTED transcript (§3.6, OD-EMP-011) |
| *"Service coordination"* as one role | **Two roles** — Service Coordinator (68 corpus activities) and Dispatcher (61), disjoint personas, only Dispatcher holding a governed Role (§3.6, OD-EMP-012) |
| *"Retail Sales and National Accounts Sales are distinct job roles"* — stated as the whole of the channel model | **True and incomplete: there are three ratified channels.** `SALES_CHANNELS = ["NATIONAL_ACCOUNTS", "RETAIL", "STRATEGIC_ACCOUNTS"]`. The ruling is silent on the third (§3.6, MI-4) |
| Candidate list implies a *rate* form for service-impact shortage | The **count** form is ACTIVE and honest (`service.workOrder.partsBlocked.count`); the **rate** form is blocked partly because **UNKNOWN is infectious** in the ATP computation. The count is not a weaker version of the rate — it is the form that can be right (§7) |
| Candidate list treats *"technician: jobs completed"* and *"on-time completion"* as comparable | One is ACTIVE-with-caveats, the other is **structurally impossible today** (no promise recorded; no revisit linkage). Grouping them invites a surface that shows both and lets the reader assume both are sound — the exact defect `P3B1-S28-A04` records (§4.2) |

---

## 11 · Handoff summary for EMP-OWN-SYNTHESIZER

1. **Do not adopt any metric from §4–§7 as a requirement without its axis and attribution label.** The
   labels are the deliverable; the metric names alone reproduce the failure mode.
2. **Nothing here is production-measurable as a goal** (OD-EMP-001). If the synthesiser needs one true
   production sentence, it is: *the goal machinery is complete and unactivated.*
3. **Zero of the 12 registry-active metrics are EMPLOYEE PERFORMANCE as measured** (OD-EMP-015). Seven
   are PROCESS HEALTH or EXCEPTION RATE. That is the answer to the lane's purpose.
4. **Do not create a second metric registry.** `performanceMetricRegistry.ts` exists, is test-pinned at
   37/12, and carries every blocker by governed id. Extend it; do not mirror it.
5. **Eleven MISSING INPUTs gate the employee axis, MI-1 above all.** No axis, threshold, weighting or
   consequence may be filled in from this lane's output.
6. **Carry OD-EMP-006 forward as a hard precondition.** A person-attributed number without a contest
   path has already shipped wrong once, as `-1686m`, on a real technician's screen — and **the bad
   records were never repaired**, only the display.
7. **Only two governed facts can name a person** (OD-EMP-017). Any metric attributed to anyone else is
   resting on a field that is unpopulated, client-writable, or absent.
8. **Attach the denominator to every corpus-derived figure** (OD-EMP-021: 660, not 1,010), and never
   take a rate or baseline from an authored activity (OD-EMP-024).
9. **Do not "fix" the things this document records as deliberate refusals** — `blocked(...)` entries,
   the DO-NOT-BUILD list, `NOT_ENABLED` rather than `UNAVAILABLE`, `FIRM`-only scopes on the service
   queue metrics, the withheld panel, the refused rollups, `MAX_TARGETS_PER_READ` refusing rather than
   trimming. Each is a guard, and each was written after something went wrong.
10. **Three claims in the controlling brief did not survive measurement** and should not be propagated:
    the "62 of 147" production ALLOW count (it is 37/38 by three independent measurements), the "1,009
    distinct" framing (all 1,010 ids are unique; the duplication is semantic), and the reading of
    `technician.utilization.rate`'s `blocked(...)` as a defect.
