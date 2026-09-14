# EMPLOYEE DESIGN v4.1 — AUTHORITY RECONCILIATION

**Lane:** `ATLAS-EMP-V41-RECONCILE` · **Mode:** EVIDENCE_WRITE · **NO IMPLEMENTATION.**
**What this document is:** a per-behaviour classification of the Owner-supplied Employee v4.1 design
package against the settled responsibility rulings. It is **not** a design review, not an approval, and
not implementation authority. Nothing here authorizes code, schema, migration, Rules or deployment.

## 0. Sources, baselines and citation discipline

| Source | Identity | Used for |
|---|---|---|
| Design input | `docs/atlas/inputs/employee-v4.1/` — 50 files, verbatim ingest of `North Star Employee New Pages v4.1 final.zip` (`sha256 b1b5e7ba…`), per-file digests in `INGEST-MANIFEST.md` | every design claim, cited **file:line** |
| EOS code baseline | `64008d5a` (`Merge pull request #1898 … integration/wave-1`). This worktree's HEAD `b24e507f` is `64008d5a` **plus one docs-only commit**, so the working tree source **is** the baseline | every EOS claim, marked `[OBSERVED AT: 64008d5a]` |
| Settled authority | `int/a-correctness-register` @ `ea3db970` — `docs/DECISIONS.md` **#180–#187** | every ruling quotation |
| Production census | commit `be1e5579` (2026-09-02), `docs/assessments/r32-production-exposure-census.{md,json}` | occupancy reality |

**Citation correction, recorded because it matters to every reader of this file.** `#180`–`#187` are **NOT
present at `64008d5a`**: baseline `docs/DECISIONS.md` ends at `#179` (`docs/DECISIONS.md:6410`
`[OBSERVED AT: 64008d5a]`), and `int/a-correctness-register` is **not an ancestor of `64008d5a`**
(verified with `git merge-base --is-ancestor`). The authority this reconciliation applies therefore lives
on an unmerged register branch. That is not a defect of the rulings — it is a fact a later lane must
carry, because the charter's own rule is that *"a correct code reading from the wrong branch is still a
false statement about the product"* (`docs/atlas/inputs/employee-v4.1/ATLAS-CHARTER-v3.1.md:31`), and the
symmetric statement about rulings holds too.

### 0.1 Which design surfaces are CURRENT

Per `CHANGELOG-EMP-v4.1.md:2` and `NS2 Index r1.dc.html:22-32`, the surfaces the package itself treats as
current are: **r2** for HOME · SVC · DSP · INV · CRM-SLS · WHS-EQP · ADM-RPT-PUR, plus **r1** for
`NS2-EMP Profile`, `NS2-LST Lists`, `NS2-FIN Financials` and the Index; `NS2-EMP Responsibility` is at
**r2**. The **r1 operating frames carry no responsibility assertions at all** — `grep -n -i accountab` over
`NS2-HOME-01 r1`, `NS2-DSP-01 r1`, `NS2-SVC r1`, `NS2-INV r1`, `NS2-CRM-SLS r1`, `NS2-WHS-EQP r1`,
`NS2-ADM-RPT-PUR r1` returns **zero hits** — so the entire employee-model propagation is the r2 pass.
`NS2-EMP Responsibility r1` is the one exception and is handled as row **X-1** below.

### 0.2 Classes used

| Class | Meaning |
|---|---|
| **SUPPORTED** | authority-correct **and** a governed backend capability exists at `64008d5a` |
| **SUPPORTED — IMPLEMENTATION MISSING** | authority-correct, **no backend**; the missing capability is named |
| **WORKFLOW-SPECIFIC HYPOTHESIS** | behaviour depends on a per-workflow rule that is not established |
| **OWNER DECISION REQUIRED** | only the Owner can settle it |
| **CONTRADICTED** | as written, contradicts a settled ruling; both readings quoted |

"Material" = asserts something about responsibility, authority, person state, or what a user may do.
Layout, spacing, colour and wording are out of scope unless the wording asserts a governed fact.

---

## 1. The load-bearing EOS facts this classification rests on

All `[OBSERVED AT: 64008d5a]`.

| # | Fact | Evidence |
|---|---|---|
| E-1 | **No accountability storage exists anywhere.** `accountablePerson` / `accountableEmployeeId` / `accountableId` appear in **zero** files — source, Rules, migrations, docs | repo-wide search; `firestore.rules` has zero `accountab*` hits |
| E-2 | The ownership matrix has **three** responsibility columns — `ownerFields`, `participatingFields`, `companyScopeField` — and **no second person axis** | `functions/src/ownership/ownershipMatrix.ts:69-102` |
| E-3 | Assignment is **deliberately** held apart from ownership in the matrix | `ownershipMatrix.ts:201` *"assignedTechId is deliberately NOT an ownerField"*; `:271` *"assignedTechId remains ASSIGNMENT"* |
| E-4 | A **PERSON** owner reference is a non-empty string and nothing more; the **COMPANY** arm is registry-checked | `functions/src/ownership/typedOwner.ts:67` vs `:68` |
| E-5 | No Employee existence lookup in ownership resolution — **by ruling O-1** | `typedOwner.ts:46-48` |
| E-6 | `resolveCreationOwner` is `EXPLICIT → INHERITED → throw`, **pure, reads no Employee document** | `functions/src/ownership/creationOwnerResolution.ts:25-26`, `:58-81` |
| E-7 | The ownership handoff builder supports the **ownership axis only**, is **not exported from `index.ts`**, and its sole non-test caller is one operator script | `functions/src/ownership/ownershipHandoffCommand.ts:7-14`, `:180-189`; `functions/scripts/assignWarehouseRootCompany.js:72`, `:234` |
| E-8 | `assertValid` is **synchronous, returns `void`** — the writer cannot perform an authority lookup | `functions/src/access/auditEventWriter.ts:460` |
| E-9 | Only an **ownership** census exists (five buckets, single axis). It cannot see accountability, cannot tell whether a person owner names a real Employee, and never reads `employmentStatus` | `functions/src/ownership/ownershipCensus.ts:43-49`, `:165-172`, `:218-242` |
| E-10 | `EMPLOYMENT_STATUS_VALUES` = six frozen values, mirror-guarded by test | `functions/src/access/employeeProfileCommands.ts:122-129` |
| E-11 | **All five non-`ACTIVE` statuses collapse to one boolean `false`** at the consumer — indistinguishable from "no employee", "broken link" or "read failed" | documented `operationalRoleContext.ts:51-52`, **implemented at `:123`**; fail-closed catches `:191-196`, `:216-218` |
| E-12 | **`AUTHORITY_UNAVAILABLE` does not exist**, and no resolver anywhere returns a semantic *person*-reference state. The only semantic-state resolvers are company-only | zero hits for `AUTHORITY_UNAVAILABLE` / `VALID_CURRENT` / `VALID_HISTORICAL` / `personReference*`; company-only at `functions/src/ownership/operatingCompanyAuthority.ts:54` and `typedOwner.ts:25-30` |
| E-13 | **No accountability transfer, assume, accept, decline or pending-transfer concept exists** | zero hits for `assume accountability` / `transfer accountability` / `acceptTransfer` / `pendingTransfer` / `PENDING_HANDOFF` |
| E-14 | `updateEmployeeProfile` is the **only** Employee command; 21 editable fields; per-field audit; it existence-checks the **manager** reference but no owner or accountable reference | `employeeProfileCommands.ts:198-220`, `:449`, `:534-541`, `:622-641` |
| E-15 | **A governed job-role vocabulary DOES exist**: `OPERATIONAL_ROLE_VALUES` — eight frozen values (`PARTS_MANAGER`, `PARTS_ASSOCIATE`, `TECHNICIAN`, `WAREHOUSE_MANAGER`, `WAREHOUSE_ASSOCIATE`, `SERVICE_MANAGER`, `SALES_MANAGER`, `SALES_ASSOCIATE`), stored multi-valued on `employees/{id}.operationalRoles`, written through the governed command, and used for authority gating | `employeeProfileCommands.ts:131-140`, `:219`, `:334-343`; consumer `operationalRoleContext.ts:123` |
| E-16 | EOS **already separates job role from security role at schema level**: `securityRole` is refused by name as *"a legacy compatibility mirror of `users/{uid}.role`, not governed access"*, as are `role`, `userId`, `employeeId` | `employeeProfileCommands.ts:225-242` |
| E-17 | A third vocabulary exists and is **inert**: 45 governed business **Roles** (permission grants named after jobs — `SALESPERSON_ROLE`, `PURCHASING_MANAGER_ROLE`, `FIELD_MANAGER_ROLE`, …) which *"grant nothing to anyone"* and are read by no Rule, Function or claim | `functions/src/access/governedBusinessRoles.ts:16-21`, `:89`–`:1506` |
| E-18 | The governed effective-access decision feed **exists and is callable**, but returns **ALLOW/DENY booleans only** and deliberately withholds `DenialReason`, `matchedRoleId`, `matchedAssignmentId`, Scope and Condition from any client | `functions/src/access/effectiveAccessFeed.ts:71-83`; callable exported at `functions/src/index.ts:214`; the withheld facts do exist internally at `functions/src/access/resolveEffectivePermission.ts:67-69` |
| E-19 | Work-order **reassignment already records exactly what `#187`'s `M-1` says it should**: prior technician, time, reason, actor — and touches neither ownership nor accountability | `functions/src/transitionWorkOrder.ts:302-391` (`reassignedFromTechId`, `reassignedAt`, `reassignedReason`, `reassignedByUid`) |
| E-20 | **Production occupancy** (2026-09-02): 6 employee records, 16 users, **2 role assignments, one principal holding any ACTIVE assignment (`admin@global`, `employeeId: null`)**, **zero** governed manager Roles, **zero** location scopes; the two production managers are `OPERATIONAL_ROLE_ONLY` | `docs/assessments/r32-production-exposure-census.json:7-12`, `:19-30`, `:31-65`, `:67-72`; `…census.md:70-80`, `:138-141` |
| E-21 | The **only** authoritative principal→employee join in production tooling is `users/{uid}.employeeId` — the mechanism `#185` forbids relying on permanently | `functions/scripts/r32ProductionExposureCensus.js:208` |
| E-22 | **There is no PostgreSQL Employee relation**, and the migration says so itself: *"THERE IS NO `employees` TABLE IN POSTGRESQL YET. The canonical Employee record still lives in Firestore's `employees` collection"* | `functions/migrations/1758412800000_employee-principal-linkage.sql:113-114` |
| E-23 | `employee_principal_links` exists with **one** FK — composite, onto `tenant_memberships` — and **none on `employee_id`**; `link_source` is closed to two values | `…1758412800000…sql:133-135`, `:140-141`, `:118-128` |
| E-24 | The whole `functions/src/employeeIdentity/*` planner and Postgres repository is **unreachable from any deployed callable** (zero importers outside the directory and tests) | `functions/src/employeeIdentity/employeePrincipalLinkPlan.ts` (mint site `:297`), `…Repository.ts:117`; `functions/src/index.ts:243-246` exports only `updateEmployeeProfile` / `listRecordChangeHistory` |
| E-25 | **No proficiency, certification/licence, specialization, or decision-authority threshold exists** anywhere — no field, no table, no vocabulary. Postgres excludes them by name: *"no `employment_status`, no `technician_id`, no `skills`"* | zero hits for `proficien*` / `competen*` / `skillLevel` / `approvalLimit` / `authorityThreshold` / `spendLimit`; `…1758412800000…sql:107-109`; untyped `skills[]` exists only on seeded **technician** fixtures, `functions/scripts/seedSandboxTransactional.js:191-203` |
| E-26 | **Availability EXISTS — but keyed to `technicianId`, never `employeeId`**: `technician_working_availability`, `technician_blocked_time`, seven `BLOCKED_TIME_KINDS` (`PTO`, `LUNCH`, `TRAINING`, `MEETING`, `TRUCK_SERVICE`, `UNAVAILABLE`, `COMPANY_CLOSURE`), with deployed callables | `functions/src/scheduling/types.ts:17-18`, `:61-69`, `:80-89`; `functions/src/scheduling/schedulingCallables.ts:56`, `:62`; exported `functions/src/index.ts:34`, `:37` |
| E-27 | `managerEmployeeId` is **stored, validated and UI-rendered but read by no server decision.** Hierarchy is derived from **Roles, not people**, and a person-level `reportsTo` is explicitly unmodelled — consequence stated in code: *"EVERY `salesManager` sees EVERY `salesperson`"* | `employeeProfileCommands.ts:214`, `:534-541`; `functions/src/access/roleHierarchy.ts:9-20` |
| E-28 | A **coverage** model exists but it is **commercial territory coverage, not employee responsibility coverage**: `COVERAGE_PRIORITIES = PRIMARY \| SECONDARY \| OVERLAY`, `responsibility` is free text or null, no precedence/winner/inheritance, and **no "backup" term anywhere**. Its own header: *"Coverage ≠ owner ≠ credit ≠ commission ≠ security ≠ Service Territory."* | `functions/src/coverage/coverageCommands.ts:1-10`, `:37`, `:127-140`; deployed at `functions/src/index.ts:113` |
| E-29 | `fieldops_technicians` carries **no `employeeId`**; correspondence is id coincidence only, counted as evidence and refused as a link rule. Governed statuses are `available \| on_job \| off_shift` | `functions/src/scheduling/schedulingRepository.ts:20-21`, `:31-36`; `functions/src/employeeIdentity/employeePrincipalLink.ts:43-46`; `functions/src/employeeIdentity/employeePrincipalLinkPlan.ts:38-41` |
| E-30 | Firestore **denies all client writes to `employees`**; the only creation path is an operator CLI that is *"NOT authorized by this script's existence, by this PR's merge, or by any code review alone"* and writes `employmentStatus` = `ACTIVE` only | `firestore.rules:499`; `functions/scripts/provisionEmployeeAccess.js:200-204`, `:480`, `:563`; the eight operational roles are mirrored there as *"eligibility markers for assignment, never security roles"* `:215-229` |
| E-31 | EOS **already states** the Job-Role-≠-Security-Role distinction in code: *"Those are operational QUALIFICATIONS … deliberately kept separate from security authorization … The Roles below are the SECURITY side of the same job title. **They are not the same object.**"* | `functions/src/access/governedBusinessRoles.ts:624-632` |

**One count deliberately not asserted.** The number of declared governed business Roles reads **45** by
`grep -c '^export const [A-Z_]*_ROLE: Role'` and **41** by enumeration of the ones carrying permission
content. Both readings are carried and neither is load-bearing: what matters is E-17's inertness, which is
unaffected. (Method per `#183`'s own withdrawn-enumeration lesson.)

---
### 1.1 Additional EOS facts (work surfaces)

| # | Fact | Evidence |
|---|---|---|
| E-32 | **A work order carries no owner, no `operatingCompanyId`, no `createdBy` and no escalation field.** The matrix measured it: *"ownerFields IS EMPTY, AND THAT IS THE MEASURED TRUTH… The Work Order carries no such field: not in its type, not in its create payload, not in any of its update writers"*. Creator identity exists only in the Audit Event | `functions/src/ownership/ownershipMatrix.ts:230-249`; `functions/src/createWorkOrder.ts:81-97`, `:186-202`; zero hits for `escalatedTo` / `escalationOwner` / `escalatedBy` repo-wide |
| E-33 | `getAllowedActions` returns a flat `string[]`: **illegal-edge, wrong-status, not-authorized and not-yours all collapse into one silent drop.** The reason-bearing pattern exists elsewhere and is the available precedent | `field-ops-app-vite/src/domain/workOrderWorkflow.js:80-94`; precedent `field-ops-app-vite/src/access/scanWorkflows.js:40`, `:107`, `:298`; `field-ops-app-vite/src/domain/scanActions.js:64`, `:121-132` |
| E-34 | The `#184` bypass is **live at the baseline**: `OwnerSelect.jsx` → `useOpportunitySectionSave` → `updateOpportunity` writes the owner and emits a generic `updateOpportunity` audit event carrying **changed field names only** — the schema *cannot* record before/after values — and **no `OWNERSHIP_HANDOFF`** | `field-ops-app-vite/src/modules/sales/OwnerSelect.jsx`; `field-ops-app-vite/src/hooks/useOpportunitySectionSave.js:72`; `functions/src/opportunity/opportunityCallables.ts:334`, `:336-350`, `:341-349` |
| E-35 | `technicianRecommendationEngine` exists, **client-side and pure**: workload 0.40, job-type frequency 0.25, `technician.status` 0.20, and **`territoryMatch` returns a flat constant 50** because no geo data exists. Its own comments: *"technician docs have NO comparable field at all… There is currently NO way to compute a real territory match"* | `field-ops-app-vite/src/domain/technicianRecommendationEngine.ts:85-90`, `:104-110`, `:120-143`, `:199`; caller `field-ops-app-vite/src/modules/dispatcherBoard/DispatcherBoard.jsx:210`; corroborated `field-ops-app-vite/src/domain/workOrderAttentionProjection.js:19` — *"technician skill/eligibility (no such model exists)"* |
| E-36 | A PO exists but **carries no buyer, requester or accountable person** — twelve columns, none of them a person. The person link lives on the *reorder request* (`assignedToUserId`, `assignedBy`, `orderedBy`, `receivedBy`) | `functions/src/eosOps/purchasingRepository.ts:207-224`, `:254`; `functions/src/reorderRequest/reorderCallables.ts:189`, `:193` |
| E-37 | **There is no filter-by-assignee anywhere, and it was refused on purpose** on the one list where it matters; the only declared Work Order filters are `status` and `customerId`. **There is no saved-view backend at all** — saved views are client metadata | `field-ops-app-vite/src/metadata/definitions/workOrder.js:150-154`, `:269-275`; `field-ops-app-vite/src/metadata/listViewDefinition.js`; zero hits for `savedView` in `functions/src` |
| E-38 | **No cross-object global search.** Three providers registered, two of them caller-less; contacts/locations/equipment/**employees** *"remain NOT registered, not stubbed, not scaffolded"* | `field-ops-app-vite/src/shared/search/searchProviders.js:11-13`, `:22-100`, `:44-58`; census `docs/assessments/eos-dashboard-reporting-authority-census.md:360`, `:362` |
| E-39 | The **billing queue projection is pure and unwired** (no callable, no importer); **no credit-memo approval command exists**; the approval-threshold engine exists but is wired only for performance goals, and its header states thresholds *"are Owner decisions supplied as explicit inputs — never defaulted"* | `functions/src/finance/billingQueue.ts:62`; `functions/src/finance/adjustmentCallables.ts:58`; `functions/src/finance/financialApprovals.ts:3-4`, `:13`, `:48`, `:112`; only live caller `functions/src/performance/performanceGoalCommands.ts:351` |
| E-40 | The dashboard authority census exists and governs this space: *"A dashboard COMPOSES existing authority. It does not invent authority. Where authority does not exist the correct dashboard result is **UNAVAILABLE / AUTHORITY REQUIRED**, not a fabricated value."* Totals: `REPORTABLE_NOW 45`, `AUTHORITY_GAP 14`, `BLOCKED_BY_DEPENDENCY 19`, `NOT_REPORTABLE 10` of 132 fact families; *"No cell was made visible by this census"*; **cross-domain activity roll-up is `NOT_VISIBLE` for all eleven personas** | `docs/assessments/eos-dashboard-reporting-authority-census.md:12-14`, `:72-82`, `:417`, `:419` |
| E-41 | The *"assignment answers **which**, capability answers **whether**"* rule is **enforced today, in code, with reason-bearing refusals** — `PERMISSION_DENIED`, `TECHNICIAN_IDENTITY_UNAVAILABLE`, `NO_TRUCK_ASSIGNMENT`, `TRUCK_ASSIGNMENT_AMBIGUOUS` (ambiguity refuses rather than picking first), and the read grants no standing access | `functions/src/cycleCount/cycleCountSheetCallables.ts:187-201`, `:212-227`; eligibility gate `functions/src/cycleCount/cycleCountLocationEligibility.ts:1-20` |
| E-42 | Account ownership requires an **explicit** person owner at creation — no silent default | `functions/src/crm/customerIdentity.ts:137`; `functions/src/crm/customerRepository.ts:156`; a reassign helper exists at `:187-189` but **no governed change-owner callable exists** |
| E-43 | Opportunity / Agreement / Sales Order each carry `ownerEmployeeId` **and** `creditedSalespersonId`, and the code states the separation: *"FIN-002: sales credit. Distinct from ownerEmployeeId (OWNERSHIP != SALES CREDIT)"*, with *"moving the OWNER above deliberately does NOT move credit"* | `functions/src/opportunity/opportunityCommands.ts:138-139`, `:173`, `:178`, `:312-329`; `functions/src/salesAgreement/salesAgreementCommands.ts:252-255`; `functions/src/salesOrder/salesOrderCommands.ts:229-230`, `:261` |
| E-44 | Work-order **notification delivery is unimplemented**; the reassignment audit event is marked as the intended future integration point | `functions/src/transitionWorkOrder.ts:594-607` |

---

## 2. CROSS-CUTTING BEHAVIOURS

Rows here span families. Family sections cite them rather than repeat them.

| Id | Design behaviour (file:line) | Class | Basis |
|---|---|---|---|
| **X-1** | `NS2-EMP Responsibility r1.dc.html:251` — *"Accepting the visit (scenario 4) **added the ACCOUNTABLE chip**"*, and `:70` — *"until you accept, T. Ruiz remains accountable"* stated as settled rather than hypothesis | **CONTRADICTED** (superseded by r2; full quotes in §5) | `#187` §5 `M-1`; the package's own correction at `CHANGELOG-EMP-v4.1.md:2-3` and `08-EMP-PROPAGATION-MATRIX.md:14` |
| **X-2** | Five relationship categories chip-coded product-wide — OWNED / ACCOUNTABLE / ASSIGNED / APPROVAL / ESCALATED, an item may carry several (`pages/NS2-EMP-responsibility.md:39`; `NS2-EMP Responsibility r2.dc.html:40`) | **SUPPORTED — IMPLEMENTATION MISSING** | Authority-correct: `#187` §1 names OWNERSHIP · ACCOUNTABILITY · ASSIGNMENT · APPROVAL · ESCALATION as distinct axes. Missing capability: accountability storage (E-1), an accountability axis in the integrity model (E-2), **any** approval-axis or escalation-axis storage (E-32, E-39) |
| **X-3** | Three distinct governed actions, never sharing a button — transfer accountability / reassign execution / transfer ownership (`pages/NS2-EMP-responsibility.md:42`; `NS2-EMP Responsibility r2.dc.html:162`, `:167`) | **SUPPORTED — IMPLEMENTATION MISSING** | Authority-correct: `#184` *"Assignment remains separate"*; `#187` §5. Reassign-execution **does** exist and already records prior/new/actor/time/reason (E-19); the other two do not (E-7 inert, E-13 absent) |
| **X-4** | Company-owned records never display an employee as owner (`pages/NS2-EMP-responsibility.md:39`; `NS2-LST Lists r1.dc.html:41`, `:70`) | **SUPPORTED** | The backend already agrees, in the same words: `ownershipMatrix.ts:201` *"assignedTechId is deliberately NOT an ownerField"*, `:271`; `#180` invariant 8 |
| **X-5** | *"Why is this in front of me?"* popover, identical from dashboard, queue, list and search, stating only true relationships (`NS2-LST Lists r1.dc.html:87-91`) | **SUPPORTED — IMPLEMENTATION MISSING** | Needs a per-axis relationship read for the viewer; no axis but ownership is stored (E-1), no assignee filter exists (E-37), and cross-domain roll-up is `NOT_VISIBLE` for every persona (E-40) |
| **X-6** | Responsibility defects as first-class attention — 12+ named classes (`08-EMP-PROPAGATION-MATRIX.md:22`; `pages/NS2-EMP-responsibility.md:27`, `:45`; `NS2-EMP Responsibility r2.dc.html:215`) | **SUPPORTED — IMPLEMENTATION MISSING** | Authority-correct and pointed at the right mechanism: `#187` §1 rules a **dedicated accountability census composed into the gate**, and `#186` §9 forbids making `ownershipMatrix.ownerFields` carry it. Missing: that census (E-9 is single-axis and cannot see a dangling or terminated owner) |
| **X-7** | *"OD-6 person states rendered distinctly: valid current / former-historical / invalid-unresolved / **current-but-unavailable (scheduling fact)**"* (`08-EMP-PROPAGATION-MATRIX.md:23`), and `NS2-DSP-01 Dispatch Board r2.dc.html:109` — *"Kellerman is CURRENT EMPLOYEE, UNAVAILABLE **(OD-6 state)**"* | **CONTRADICTED** (full quotes in §5) | `#182` §3's states are A–D and contain **no availability state**; `#187` §2 requires `AUTHORITY_UNAVAILABLE` to be **distinct and fail closed**. The package renders person-availability in that fourth slot and renders the ruled outcome **nowhere** |
| **X-8** | Former employee on closed history = healthy; the same person on an active accountability = `ACCOUNTABLE PERSON NOT CURRENTLY ELIGIBLE`; *"could not be resolved"* a third, distinct state (`NS2-LST Lists r1.dc.html:79`; `NS2-SVC Service r2.dc.html:217`) | **SUPPORTED — IMPLEMENTATION MISSING** | Exactly `#186` cases B/C/D, including the prohibition in case D. Missing: a person resolver with semantic states (E-12); today all five non-`ACTIVE` statuses **and** a read failure collapse to one boolean (E-11) |
| **X-9** | `INACTIVE` distinguishable from `TERMINATED` — required by `#186` §4 | **SUPPORTED — IMPLEMENTATION MISSING**, partially rendered | The **vocabulary** is already shipped and drift-guarded (E-10). The package renders only *"former employee"*; `ACCOUNTABLE INACTIVE` appears solely in vocabulary lists (`pages/NS2-EMP-responsibility.md:27`, `08-EMP-PROPAGATION-MATRIX.md:22`) and in **no frame**. See UNPROVEN U-2 |
| **X-10** | Notifications name what changed and what did not — *"assignment changed; Maria remains accountable"* (`pages/NS2-EMP-responsibility.md:48`; `NS2-EMP Responsibility r2.dc.html:162`) | **SUPPORTED — IMPLEMENTATION MISSING** | Authority-correct (`#187` §5). Notification delivery is unimplemented and the reassignment event is the marked integration point (E-44) |
| **X-11** | Lists/search gain Owner / Accountable To / Assigned To / Approval From / Escalated To / Operating Company columns **and filters**, family-scoped (`pages/NS2-EMP-responsibility.md:47`; `NS2-LST Lists r1.dc.html:65-70`) | **SUPPORTED — IMPLEMENTATION MISSING** | Missing: the fields (E-1, E-32), the filters — refused deliberately today (E-37) — and any saved-view backend (E-37). The family-applicability rule itself is `#187` §1 + `#180` invariant 9 compatible |
| **X-12** | Search results carry the same responsibility vocabulary; *"Search never widens authority"* (`NS2-LST Lists r1.dc.html:109-118`) | **SUPPORTED — IMPLEMENTATION MISSING** | Package already marks the capability gap (`05-GAP-REGISTER.md:26` P2-G1). Confirmed absent (E-38), and **employees are explicitly not a search corpus** |
| **X-13a** | Recommendation ≠ decision: explainable suggestion → human clicks → the **same** governed command; AI holds no parallel write path (`NS2-DSP-01 Dispatch Board r2.dc.html:74`; `pages/NS2-DSP-dispatch.md:16`) | **SUPPORTED** | The engine exists, is pure and client-side with no write path, and the Assign it feeds is the governed command (E-35, E-19) |
| **X-13b** | The recommendation's stated grounds — *"Required C723 proficiency P3 → Carlos P4 · refrigeration P3 → P4"*, *"C723-certified"* (`NS2-EMP Responsibility r2.dc.html:165`; `NS2-DSP-01 r2.dc.html:74`) | **SUPPORTED — IMPLEMENTATION MISSING** | No proficiency, certification or specialization data exists (E-25); the engine's own territory factor is a constant (E-35) |
| **X-14** | Action states rendered distinctly: AVAILABLE / UNAVAILABLE WITH REASON / NOT AUTHORIZED / NOT APPLICABLE — *"The four states never look identical"* (`NS2-SVC Service r2.dc.html:165`; `pages/NS2-SVC-service.md:37`; `NS2-Layout-Atlas.dc.html:103`) | **SUPPORTED — IMPLEMENTATION MISSING** | Authority-consistent with `#184` (refuse before mutation) and `#182` §4 (eligibility ≠ execution authority). For work orders the engine collapses all four (E-33); the reason-bearing precedent to extend is named there |
| **X-15** | Job Role ≠ Security Role; *"Role never equals permission — capabilities derive through governed grants"* (`NS2-EMP Profile r1.dc.html:88`; `NS2-ADM-RPT-PUR Admin r2.dc.html:42`) | **SUPPORTED** | EOS already holds this distinction in code and in prose: `operationalRoles` are *"eligibility markers for assignment, never security roles"* (E-30), `securityRole` is refused by name as a legacy mirror (E-16), and `governedBusinessRoles.ts:624-632` says *"They are not the same object"* (E-31) |
| **X-16** | The design's **job-role vocabulary**: *"Sales is TWO job roles: Retail Sales and National Accounts Sales… Never one generic Sales role"* (`pages/NS2-EMP-responsibility.md:24`), plus `Service Technician` PRIMARY + `Warranty Evidence Support` ADDITIONAL (`NS2-EMP Profile r1.dc.html:89`), plus personas Dispatcher / Service Coordinator / Purchasing / Finance / Administrator / Reporting (`02-PERSONAS.md:6-17`) | **OWNER DECISION REQUIRED** | A governed vocabulary exists (E-15) but is a **closed, frozen, literal-mirrored, drift-guarded set of eight** that contains none of these names and no PRIMARY/ADDITIONAL grain. Extending or replacing it is an Owner decision, not a design consequence — and `#186` §4's *"invent nothing"* applies to employment status, which is a different vocabulary |
| **X-17** | Proficiency P0–P4, REQUIRED vs ACTUAL with MEETS / EXCEEDS / GAP / NOT REQUIRED, governed level distinct from self-declared and from EOS-suggested evidence, manager validation the only act that moves it (`pages/NS2-EMP-responsibility.md:25`; `NS2-EMP Profile r1.dc.html:103-114`, `:178-196`) | **SUPPORTED — IMPLEMENTATION MISSING** | Authority-consistent: `#182` §4 (*"eligibility must not be defined as 'has the capability to perform the assigned command'"*) and `#185` (proficiency named as Employee **business** data). Missing entirely (E-25). The adjudication rule is separately **OWNER DECISION REQUIRED** — the package already returns it as `EMP-PQ1` (`pages/NS2-EMP-responsibility.md:31`) |
| **X-18** | Employee ≠ User Access — linked, never merged; an employee may exist with no login; a User Access with no employee (service account) is legitimate (`NS2-EMP Profile r1.dc.html:79`, `:270-273`) | **SUPPORTED** | EOS enforces the reciprocal two-directional link and fails closed on a one-directional pointer (`firestore.rules:44-58`, `:89-94`); `employees.userId` is refused by the profile command (E-16); `employees` has no client writer (E-30) |
| **X-19** | The concept chain **`USER IDENTITY → EMPLOYEE → JOB ROLE(S) → …`** (`pages/NS2-EMP-responsibility.md:23`) | **CONTRADICTED** (full quotes in §5) | `#185` rules the chain **`CREDENTIAL → PRINCIPAL → EMPLOYEE LINK → EMPLOYEE`** and *"Never Firebase user → therefore Employee."* The design's chain has no PRINCIPAL term |
| **X-20** | `08-EMP-PROPAGATION-MATRIX.md:18` — ADM People / User Access: *"Employee ≠ Principal ≠ Credential; bidirectional link only"*, authority dependency **"—"**, status **COMPLETE** | **CONTRADICTED** (full quotes in §5) | The row's own body names three concepts while claiming a *"bidirectional link"* — a two-party relation — and declares **no** authority dependency. At the baseline the only production join is `users/{uid}.employeeId` (E-21), which `#185` forbids relying on permanently and `#187` §4 retires as an authority; the governed alternative is unreachable (E-24) and has no FK on `employee_id` (E-23) |
| **X-21** | One *"User Access"* surface presenting *"identity, provider, security role, capabilities, access status"* as a single object (`NS2-ADM-RPT-PUR Admin r2.dc.html:266-273`) | **OWNER DECISION REQUIRED** | `#185` keeps **PRINCIPAL** (authorization) and **CREDENTIAL** (authentication) permanently separate concepts with different canonical targets. Whether one administrative surface may compose both is not ruled, and naming is withheld. Name the **distinction**, not the page |
| **X-22** | The OD-7 sequence recited on every current operating frame, with *"invalid targets refused before mutation"* as a settled platform guarantee (`NS2-HOME-01 r2:38`, `NS2-SVC r2:43`, `NS2-DSP-01 r2:39`, `NS2-CRM-SLS r2:42`, `NS2-INV r2:42`, `NS2-WHS-EQP r2:40`, `NS2-ADM-RPT-PUR r2:37`, `NS2-EMP Responsibility r2:40`) | **SUPPORTED — IMPLEMENTATION MISSING** | The recitation matches `#184` clause for clause. Missing: the orchestration boundary itself — the handoff builder is inert (E-7), and a live bypass exists (E-34) |
| **X-23** | No surface in the package draws an owner-transfer control; `NS2-EMP-04` ownership transfer is *"pending design"* (`pages/NS2-EMP-responsibility.md:10`, `:51`, `:54`) | **SUPPORTED** (as a deliberate omission) | Consistent with `#184`: the live bypass must be eliminated or refused **before** an owner-change control is drawn. Flagged in §7 so no later lane reads the empty slot as permission |
| **X-24** | Person-level manager/team responsibility view — *"Service team · 7 people"*, per-person Accountable / Assigned / Approvals / Pending-transfers columns (`NS2-EMP Responsibility r2.dc.html:208`, `:223-230`) | **SUPPORTED — IMPLEMENTATION MISSING** | Missing capability, named: a governed **person-level reporting relation**. `managerEmployeeId` is stored and validated but read by no server decision, and hierarchy is derived from Roles with the consequence stated in code — *"EVERY `salesManager` sees EVERY `salesperson`"* (E-27) |
| **X-25** | Responsibility Coverage — primary/backup per critical responsibility, single-person dependency as a defect, *"distinct from who is accountable for any active item"* (`NS2-EMP Profile r1.dc.html:211-250`; `pages/NS2-EMP-responsibility.md:18`) | **OWNER DECISION REQUIRED** | `#187` §1 enumerates the governed axes as OWNERSHIP · ACCOUNTABILITY · ASSIGNMENT · APPROVAL · ESCALATION; coverage is a **sixth** concept, and `#182` §6's eventual measurable axes also exclude it. `#180` invariant 9 reserves stewardship models to a separate decision. A coverage model exists in EOS but is commercial territory coverage with `PRIMARY \| SECONDARY \| OVERLAY` and **no backup term** (E-28) |
| **X-26** | Approval keeps accountability where it was; escalation does not transfer the item; *"Escalation does not make the manager accountable — only Assume accountability does"* (`pages/NS2-EMP-responsibility.md:43`; `NS2-EMP Responsibility r2.dc.html:98`, `:233`; `NS2-HOME-01 r2:77`) | **SUPPORTED — IMPLEMENTATION MISSING** | Exactly `#180` invariants 4 and 5. Missing: any approval or escalation axis storage (E-32), and any approval command for the case shown (E-39) |
| **X-27** | *"No other available technician meets C723 P3 → **the record raises** ESCALATED PROFICIENCY GAP to the service manager"* (`NS2-EMP Responsibility r2.dc.html:180`) | **OWNER DECISION REQUIRED** | `#186` §13 lists **automatic escalation** among the things *"not absorbed into `MI-S`"* and not decided. An automatic raise is a governed policy, not a rendering choice |
| **X-28** | Per-workflow handoff behaviour — recipient acceptance, immediacy, forcing rights, decline windows, post-rejection escalation (`06-DECISION-LOG.md:57` P2-D10; `08-EMP-PROPAGATION-MATRIX.md:4`; `NS2-EMP Responsibility r2.dc.html:40`, `:70`, `:220`) | **WORKFLOW-SPECIFIC HYPOTHESIS** | Already marked as such by the package — cited, not re-derived. `#186` §13 leaves handoff acceptance semantics undecided; `#184` settles only the boundary |
| **X-29** | Technician lanes render employment and eligibility facts for every technician on the board (`NS2-DSP-01 Dispatch Board r2.dc.html:106-109`) | **SUPPORTED — IMPLEMENTATION MISSING** | `#187` §3 rules technician linkage a **domain projection** and forbids `fieldops_technicians` as Employee authority. Missing capability, named: a governed EMPLOYEE ↔ TECHNICIAN projection. The technician document has **no `employeeId`** (E-29), and the DDL records that 11 of 13 ids coincide while **2 do not** — *"A rule inferred from the 11 is provably wrong for the 2"* |
| **X-30** | Availability as a rendered fact — *"Out · sick"*, *"Unavailable all day"*, blocked time, capacity (`NS2-DSP-01 r2:106-109`; `NS2-SVC Service r2.dc.html:108-111`) | **SUPPORTED** | A governed technician availability model exists with deployed callables and seven blocked-time kinds (E-26) |
| **X-31** | Employee-level availability — *"Available today · on-call Fri"*, *"Set unavailable…"* (`NS2-EMP Profile r1.dc.html:82`, `:284`) | **SUPPORTED — IMPLEMENTATION MISSING** | Authority-consistent (`#185` names availability as Employee business data). The existing model is keyed to `technicianId`, not `employeeId` (E-26), so a non-technician employee has no availability at all |
| **X-32** | *"assignment scopes what you see; capabilities decide what you may do"* / *"assignment answers **which**, capability answers **whether**"* (`NS2-HOME-01 r2:213`; `NS2-ADM-RPT-PUR Admin r2.dc.html:80`; `pages/NS2-TEC-01-technician-mobile.md:6`) | **SUPPORTED** | Enforced today with reason-bearing refusals, including a refusal on ambiguity rather than a silent first-match (E-41) |
| **X-33** | *"Why can this person count Truck 7?"* rendering the **full derivation chain** — role grant → policy condition → assignment scope → operating company → effective verdict, with a change-preview (`NS2-ADM-RPT-PUR Admin r2.dc.html:75-84`) | **SUPPORTED — IMPLEMENTATION MISSING** | Missing capability, named precisely: an **admin-scoped access-derivation read**. The governed decision feed is callable but returns ALLOW/DENY booleans only and *"Never the resolver's `DenialReason`, `matchedRoleId`, `matchedAssignmentId`, Scope, or Condition"* — the facts exist server-side but are deliberately withheld from clients (E-18). This is a new governed read, **not** a widening of the navigation feed |
| **X-34** | Decision-authority thresholds — *"Parts on WO ≤ $500"*, *"exceeds coordinator limit"*, *"exceeds technician limit"*, *"Manager approval needed only if parts exceed $500"* (`NS2-EMP Profile r1.dc.html:96-97`; `NS2-HOME-01 r2:77`; `NS2-EMP Responsibility r2.dc.html:98`, `:251`) | **SUPPORTED — IMPLEMENTATION MISSING** | A threshold engine exists but no threshold **values or storage** do, and its header states they *"are Owner decisions supplied as explicit inputs — never defaulted"* (E-39). Whether thresholds are per employee, per role, or both is separately **OWNER DECISION REQUIRED** — the package returns it as `EMP-PQ4` (`pages/NS2-EMP-responsibility.md:34`), and the EOS census carries the same gap as `G-06` (E-40) |
| **X-35** | Role-shaped navigation — *"Group visibility derives from effective capabilities, never persona names"*; *"Width never changes authority"* (`NS2-HOME-01 r2:61`, `:213`; `02-PERSONAS.md:2`) | **SUPPORTED** | The governed effective-access decision feed is callable (E-18) and is exactly the right shape for group visibility. Caveat carried in §7: with **zero governed manager Roles and zero location scopes in production** (E-20), the role-shaped variants cannot be demonstrated against real occupancy |
| **X-36** | The five My Work queues become HOME's WORK section at family open (`pages/NS2-EMP-responsibility.md:46`) | **SUPPORTED — IMPLEMENTATION MISSING** | Depends on X-2's missing axes. Persona dashboard modules exist for Owner/dispatcher/technician/parts/warehouse (E-40 supporting projections) but there is **no finance persona home**, and the census's governing rule is that absent authority must render `UNAVAILABLE / AUTHORITY REQUIRED` (E-40) |
| **X-37** | Can two people legitimately share accountability during a shift handover, or is MULTIPLE ACCOUNTABLE PEOPLE always a zero-tolerance defect? (`pages/NS2-EMP-responsibility.md:32` `EMP-PQ2`; vocabulary at `08-EMP-PROPAGATION-MATRIX.md:22`) | **OWNER DECISION REQUIRED** | `#180` requires *"exactly one accountable person at every point in time, **unless an explicit, separately Owner-approved exception** defines otherwise"* — so this is precisely an Owner exception question. Package-marked; cited, not re-derived |
| **X-38** | Does a pending accountability transfer expire, and to whom does it fall back? (`pages/NS2-EMP-responsibility.md:33` `EMP-PQ3`) | **OWNER DECISION REQUIRED** | `#180` invariants 1 and 7 forbid a NONE state and a responsibility gap, so a fallback rule is load-bearing; `#186` §13 leaves handoff acceptance semantics undecided. Package-marked |
| **X-39** | Territory / service area — operational fact on the profile, or an assignment-model concept? (`pages/NS2-EMP-responsibility.md:35` `EMP-PQ5`) | **OWNER DECISION REQUIRED** | Package-marked. EOS has commercial sales territory only, with an explicit *"Coverage ≠ … ≠ Service Territory"* boundary (E-28), and the recommendation engine's territory factor is a constant (E-35) |
| **X-40** | Which qualifications legally block assignment when expired, vs advisory? (`pages/NS2-EMP-responsibility.md:36` `EMP-PQ6`; `NS2-EMP Profile r1.dc.html:123-127`) | **OWNER DECISION REQUIRED** | Package-marked. Nothing exists to block with (E-25). Note the interaction with `#182` §4: a blocking qualification is **execution authority**, not accountability eligibility — the two must not be fused |
| **X-41** | `NO ACCOUNTABLE PERSON` rendered as a first-class defect on a new actionable record (`NS2-LST Lists r1.dc.html:80`; `NS2-EMP Responsibility r2.dc.html:215-217`); *"an unresolved responsibility never looks empty or healthy"* (`:83`) | **SUPPORTED — IMPLEMENTATION MISSING** | Exactly what `#182` §9 requires the gate to be able to detect, and the honest rendering of `#180` invariant 1 — which `#180` itself records as *"not currently detectable"* at `64008d5a`. Missing: the accountability census (E-9) |
| **X-42** | `NS2-EMP Responsibility r2.dc.html:217` — *"**NO ACCOUNTABLE PERSON** Customer escalation — Peoria Schools install delay · **orphaned when T. Ruiz went on leave**"* | **CONTRADICTED** (full quotes and both readings in §5) | `#186` §8 and `#180` invariants 1 and 6 |

---

## 3. BY PAGE CONTRACT

Rows are family-specific. Cross-cutting rows are cited by id, never repeated.

### 3.1 `NS2-HOME-01` — My Dashboard (`pages/NS2-HOME-01-my-dashboard.md`)

| Id | Design behaviour | Class | Basis |
|---|---|---|---|
| H-1 | `NS2-HOME-01 r2:151` — *"**ACCOUNTABLE** Conflict — M. Villanueva double-booked 9:00–10:30"* on the dispatcher's fix-before-dispatch band, **with no PROPOSED marker** | **WORKFLOW-SPECIFIC HYPOTHESIS** presented as settled | Every sibling frame marks dispatcher-lifecycle accountability as proposed — `NS2-DSP-01 r2:73` *"(proposed accountability — lifecycle rule unvalidated)"*, `NS2-SVC r2:81`, `:169`, `NS2-EMP Responsibility r2:154`, `:248`. This one row asserts the same ungoverned lifecycle rule without the marker. Internal inconsistency in the package, not a ruling conflict |
| H-2 | `:77` — approval row: *"your approval does not change the accountable person for the underlying work"* | **SUPPORTED — IMPLEMENTATION MISSING** | `#180` invariant 4. See X-26 |
| H-3 | `:153` — *"reassigning changes the executor only — accountability does not change through this action"* | **SUPPORTED** | `#187` §5; the backend already behaves this way (E-19, E-3). This is the v4.1 correction the changelog records (`CHANGELOG-EMP-v4.1.md:3`) |
| H-4 | `:104` — *"Rows here are company outcomes… attention alone never makes you accountable"* | **SUPPORTED** | `#180` invariants 2/4 in the negative; nothing in EOS creates accountability from a projection because nothing creates accountability at all (E-1) |
| H-5 | `:87-91` — four Owner figures, each drill-through, *"Every figure requires a governed read/projection — where absent it renders the honest unavailable posture, never an invented number"* | **SUPPORTED — IMPLEMENTATION MISSING** (per figure) | The rule is exactly the census's governing rule (E-40); the figures themselves fall across `REPORTABLE_NOW 45` / `AUTHORITY_GAP 14` / `BLOCKED_BY_DEPENDENCY 19`. Which figure sits in which bucket is per-figure work at family open — see UNPROVEN U-4 |
| H-6 | `:190-197` — technician next-job card with parts readiness against *"this truck's governed stock read"* | **SUPPORTED** | Parts readiness and attention projections exist (E-40 supporting list: `workOrderPartsReadiness.js`, `workOrderAttentionProjection.js`); truck-scoped stock reads exist (E-41 resolver) |
| H-7 | `:38`, page doc `:17`, `:19` — Finance variant renders DENIED honestly; states populated / quiet / gated / empty / stale | **SUPPORTED** | Capability gating and denial evidence exist (E-18 feed; denial audit events at `employeeProfileCommands.ts:479-487`). **But** there is no finance persona home module today — see X-36 |
| H-8 | `:38`, `:61` — role-shaped rail from effective capabilities | see **X-35** | |

### 3.2 `NS2-DSP-dispatch` — Dispatch Board (`pages/NS2-DSP-dispatch.md`)

| Id | Design behaviour | Class | Basis |
|---|---|---|---|
| D-1 | `NS2-DSP-01 r2:39`, `:73`, `:107` — *"dispatch-board assignment actions change the executor only — they do not themselves change accountability"*; *"reassign all… (executor change only — accountability for each outcome unchanged)"* | **SUPPORTED** | `#187` §5 `M-1`, verbatim in substance. Backend already conforms: E-19, E-3, and `#110`'s reassignment record list in which ownership and company do not appear |
| D-2 | `:73` — `ACCOUNTABLE R. Diaz` on a queue card, tagged *"proposed accountability — lifecycle rule unvalidated"* | **WORKFLOW-SPECIFIC HYPOTHESIS** | Package-marked (`08-EMP-PROPAGATION-MATRIX.md:9` — *"PARTIAL — BLOCKED on lifecycle accountability rules"*); `05-GAP-REGISTER.md:30` P2-G6. Cited, not re-derived |
| D-3 | `:109` — *"Kellerman is CURRENT EMPLOYEE, UNAVAILABLE (OD-6 state) — not a broken reference"* | **CONTRADICTED** — see **X-7** and §5 | The substance (*"not a broken reference"*) is right and matches `#186`; the **label** is wrong |
| D-4 | `:109` — *"his assignments show as ASSIGNEE UNAVAILABLE defects until moved"* | **SUPPORTED — IMPLEMENTATION MISSING** | Consistent with `#186` §8 (a person becoming unavailable makes the **current state** a defect requiring governed resolution, without automatic transfer). Missing: the defect measurement (E-9) — though the availability input itself exists (E-26) |
| D-5 | `:74` — *"Suggest: S. Naber 10:00 — has slot, 18 min away, **C723-certified**"* | see **X-13a** (shape: SUPPORTED) / **X-13b** (grounds: IMPLEMENTATION MISSING) | Travel time and certification are both absent (E-35) |
| D-6 | `:89` — *"The board cannot save an overlapping state; the command refuses it"* | **UNPROVEN** — see U-5 | Scheduling commands exist with mandatory reasons and dispatcher gating (E: `schedulingCommands.ts:179`, `:304`); whether an overlap is server-refused was not verified |
| D-7 | page doc `:6` — *"Technicians never schedule here"* | **SUPPORTED** | Dispatcher gating exists (`functions/src/scheduling/schedulingCommands.ts:179`; `functions/src/createWorkOrder.ts:139-142`) |

### 3.3 `NS2-SVC-service` — Service Operations + Work Order record (`pages/NS2-SVC-service.md`)

| Id | Design behaviour | Class | Basis |
|---|---|---|---|
| S-1 | `NS2-SVC r2:153`, `:169` — *"Owned by Taylor AZ — company record"* / *"no employee owns a work order"* | **SUPPORTED — IMPLEMENTATION MISSING** | Authority-correct twice over: `#180` invariant 8 and D-13/D-14/D-15's COMPANY classification. **But the work order carries no company field at all** — `ownershipMatrix.ts:230-249` measured `ownerFields: []` and *"the collection has no company storage at all"* (E-32), and the EOS census carries it as `G-13` *"Operational-record company provenance (WO `NO_GOVERNED_COMPANY_SOURCE`)"* (E-40). Missing capability: governed operating-company provenance on a work order |
| S-2 | `:169` — `ACCOUNTABLE K. Ames · next outcome: parts availability confirmed` + `PROPOSED ACCOUNTABILITY — WORKFLOW VALIDATION REQUIRED` | **WORKFLOW-SPECIFIC HYPOTHESIS** | Package-marked. `08-EMP-PROPAGATION-MATRIX.md:10` goes further and marks the Service row **"BLOCKED — OWNER DECISION on lifecycle rules"** for NEW/DISPATCHED/IN-PROGRESS/WAITING-PARTS/RETURN/BILLING/EXCEPTION — carried as S-7 |
| S-3 | `:169` — `ASSIGNED none — swap unscheduled until receipt`, and `:81` — *"no assigned technician yet — **assignment gap, not an accountability gap**"* | **SUPPORTED** | The exact distinction `#187` §5 requires, and the one the matrix's own `ASSIGNMENT WITHOUT ACCOUNTABILITY` defect inverts. `assignedTechId` genuinely can be absent (E: `types/workOrder.ts:107`) |
| S-4 | `:165` — UNAVAILABLE WITH REASON distinct from NOT AUTHORIZED and NOT APPLICABLE on the Schedule action | see **X-14** | Collapsed today (E-33) |
| S-5 | `:217` — *"2019 install — historically accountable: J. Barnes · former employee (history stays attributable; distinct from 'unresolved person')"* | **SUPPORTED — IMPLEMENTATION MISSING** | `#186` §7 and case C/D verbatim in substance; `#182` §2. See X-8 |
| S-6 | `:169` — *"Reassigning a technician never implies accountability transfer"* | **SUPPORTED** | As D-1 |
| S-7 | Service lifecycle accountable-person rules for seven states (`08-EMP-PROPAGATION-MATRIX.md:10`; `NS2-SVC r2:43`) | **OWNER DECISION REQUIRED** | The package itself classifies this row **BLOCKED — OWNER DECISION**. `#186` §8 rules reassignment/escalation behaviour *"workflow-specific"* and leaves the policy open; nothing in `#180`–`#187` sets a per-state accountable person for Service |
| S-8 | `:201` — *"The workflow strip renders the governed state machine's actual path… It never shows a hypothetical branch as if available"* | **SUPPORTED** | Two mirrored state machines exist (`functions/src/transitionEngine.ts:39`; `field-ops-app-vite/src/domain/workOrderWorkflow.js:22`) |

### 3.4 `NS2-SLS-sales` — Sales family (`pages/NS2-SLS-sales.md`)

| Id | Design behaviour | Class | Basis |
|---|---|---|---|
| L-1 | `NS2-CRM-SLS r2:167` — `OWNED J. Ruiz — Retail Sales` **and** `ACCOUNTABLE J. Ruiz (defaulted from ownership — separately transferable)`; frame intro `:42` — *"accountability may default from ownership but is separately transferable; changing one never visually implies changing the other"* | **SUPPORTED — IMPLEMENTATION MISSING** | This is `#181` almost word for word — derivation as **initialization**, not permanent identity, with `EXPLICIT VALID → GOVERNED DERIVATION → REFUSE`. Two same-name chips are not one field, so test 1 passes. Missing: the accountable field (E-1); and `#181`/`#182` §5 warn that the existing `resolveCreationOwner` precedent **cannot carry the rule** until person validity means something (E-4, E-5, E-6) |
| L-2 | `:197-198` — downstream Agreement/Order slots render *"link unavailable — G3"* rather than a working link; *"MISSING CAPABILITY is never drawn as a working link"* | **SUPPORTED** | Package-registered gaps (`05-GAP-REGISTER.md:13`). Agreement and Sales Order records genuinely exist with `ownerEmployeeId` and the `agreementToSalesOrder` path (E-43) |
| L-3 | `:181` — refused transitions name the refusing rule | **SUPPORTED** | Lifecycle + transition hooks exist (`functions/src/opportunity/*`) |
| L-4 | No owner-transfer control is drawn on `NS2-SLS-02` | see **X-23** | The live bypass is at exactly this surface (E-34) |
| L-5 | Sales split into **Retail Sales** and **National Accounts Sales** as independently assignable job roles (`:42`; `pages/NS2-EMP-responsibility.md:24`) | see **X-16** — **OWNER DECISION REQUIRED** | The governed set has `SALES_MANAGER` / `SALES_ASSOCIATE` only (E-15) |
| L-6 | Sales **credit** is never mentioned as moving with owner or accountable | **SUPPORTED** | Matches `#182` §7's *"existing `creditedSalespersonId` semantics must not be silently changed"*, and EOS already enforces the separation (E-43) |

### 3.5 `NS2-CRM-account` — Customers / Account record (`pages/NS2-CRM-account.md`)

| Id | Design behaviour | Class | Basis |
|---|---|---|---|
| A-1 | `NS2-CRM-SLS r2:76` — `OWNED record owner: J. Ruiz — Retail Sales (durable relationship stewardship)` — a **person** owner on a relationship-owned family | **SUPPORTED** | `#180`'s Account worked example and `#182` §8. The field exists, creation **requires an explicit owner** with no silent default (E-42), and the name can be rendered today. **Note, not a class change:** Layer-1 is absent — the owner id is a bare string (E-4, E-5), so *"is this a real, current employee?"* is unanswerable, which is **X-8**'s row, not this one |
| A-2 | `:85` — *"escalation is an Owner capability; this session can only prepare the case"* | **SUPPORTED — IMPLEMENTATION MISSING** | Capability gating exists (E-18); an escalation axis does not (E-32) |
| A-3 | `NS2-LST Lists r1.dc.html:70` — an Accounts list exposes **Owner**, a company-owned family does not | **SUPPORTED** | Family applicability matches the matrix's own per-family `ownerFields` (E-2: `account → ["accountOwner"]` vs `workOrder → []`) |
| A-4 | No account-owner **change** control is drawn | **SUPPORTED** (deliberate omission) | No governed change-owner callable exists (E-42); drawing one before `#184`'s boundary exists would author a second bypass |

### 3.6 `NS2-INV-inventory` — Inventory family (`pages/NS2-INV-inventory.md`)

| Id | Design behaviour | Class | Basis |
|---|---|---|---|
| I-1 | `NS2-INV r2:85` — `Owned by Taylor AZ · ACCOUNTABLE M. Osei (inventory control) — outcome: stock restored · execution: Purchasing`; `:42` — *"people carry accountability for outcomes and assignment for actions — never personal ownership of stock"* | **SUPPORTED — IMPLEMENTATION MISSING** | `#180`'s Purchase/Parts worked example and invariant 8. Inventory families genuinely carry `operatingCompanyId` (E-2), so the **company** half is real; the accountable half has no field (E-1) |
| I-2 | `NS2-EMP Responsibility r2:81` — *"Reorder 016132 — next outcome: PO placed · execution with Purchasing… The row never claims Ames 'owns' the part or the PO: Taylor owns those"* | **SUPPORTED — IMPLEMENTATION MISSING** | As I-1. Part/manufacturer families are REFERENCE with `ownerFields: []` (E-2), which is `#180` invariant 9 territory — and the design correctly gives them no personal accountability |
| I-3 | `NS2-INV r2:172` — *"The request then carries an accountable buyer; Taylor owns the part and the PO throughout"* | **SUPPORTED — IMPLEMENTATION MISSING** | The reorder request does carry person fields (`assignedToUserId`, `orderedBy`, `receivedBy`) but the **PO carries no person at all** (E-36). Missing capability: an accountable-person fact on the purchasing chain |
| I-4 | Cycle Counts: *"technician scope = assigned trucks — assignment answers which, capability answers whether"*; per-line review, no whole-sheet approve (`pages/NS2-INV-inventory.md:12`) | **SUPPORTED** | Enforced in code with four reason-bearing refusal codes and an ambiguity refusal (E-41). See X-32 |
| I-5 | Reorder rationale is explainable AI over governed usage reads; accepting creates a normal purchasing request (`NS2-INV r2:92`, `:172`) | **SUPPORTED** | Analytics + ledger reads exist (E: `inventoryAnalyticsService.ts:132-246`, `inventoryLedger/*`), bounded by the census's *"derived INFORMATION, explicitly not a governed stock position"* ruling |
| I-6 | `NS2-INV-05` Transfers & Trucks custody — PROPOSED-ONLY, unverified (`pages/NS2-INV-inventory.md:21`; `05-GAP-REGISTER.md:29` P2-G4) | **WORKFLOW-SPECIFIC HYPOTHESIS** | Package-marked; cited, not re-derived |

### 3.7 `NS2-WHS-warehouse` — Warehouse family (`pages/NS2-WHS-warehouse.md`)

| Id | Design behaviour | Class | Basis |
|---|---|---|---|
| W-1 | `NS2-WHS-EQP r2:73` — `ACCOUNTABLE Maria V. (buyer — open-PO outcome)` | **SUPPORTED — IMPLEMENTATION MISSING** | `#180` Purchase worked example. No buyer or accountable field on a PO (E-36) |
| W-2 | `:73` — `ASSIGNED T. Alvarez (receiving)` | **SUPPORTED** | The receiver **is** recorded today, from server-derived trusted actor context, never from the payload (`functions/src/inventoryReceiving/receiveInventoryStockCommand.ts:19-22`, `:220`, `:552`) |
| W-3 | `:99` — supplier substitution never posts silently; *"The governed command records which human accepted it"* | **SUPPORTED** | Actor recorded on movement, receiving order and cost fact (same command, `:300`, `:314`, `:469`) |
| W-4 | `:40` — *"company owns the records; the buyer is accountable for the PO outcome, the receiver is assigned the receiving work"* | **SUPPORTED** as a distinction | `#180` invariant 8; company is inherited never supplied on a PO (`purchasingRepository.ts:241-245`) |

### 3.8 `NS2-EQP-01-equipment` — Equipment (`pages/NS2-EQP-01-equipment.md`)

| Id | Design behaviour | Class | Basis |
|---|---|---|---|
| Q-1 | `NS2-WHS-EQP r2:173` — `Operating company Taylor AZ`, with a cross-company mismatch surfacing *"as an explicit exception, never silently normalized"* (EQ-G5) | **SUPPORTED** | `equipment` carries `operatingCompanyId` in the matrix (E-2, `ownershipMatrix.ts:462`) and the company arm is registry-validated (E-4) |
| Q-2 | `:163` — *"Mar 2019 Installed · governed install confirmation · S. Naber"* — a person attributed on a historical install | **SUPPORTED — IMPLEMENTATION MISSING** | `#186` §7 (history preserved) and `#182` §2. Missing: the person resolver that makes a historical attribution distinguishable from an invalid one (E-12); see X-8 |
| Q-3 | `:116`, `:193` — an unresolved location says *"Location unavailable"*, never a guess | **SUPPORTED** | Reason-bearing unavailability is the established pattern (E-33 precedent; E-41 refusal codes). Note: this is **location** unavailability, not person-authority unavailability — see X-7 |
| Q-4 | Equipment carries **no** personal accountability | **SUPPORTED** | Family applicability (`#180` invariant 9); matrix classifies installed equipment COMPANY, not PERSON (E-2) |

### 3.9 `NS2-FIN-financials` — Financials suite (`pages/NS2-FIN-financials.md`)

| Id | Design behaviour | Class | Basis |
|---|---|---|---|
| F-1 | **The Financials suite received no employee-model propagation.** `NS2-FIN Financials r1` contains **zero** occurrences of `accountab*` (verified by grep), and `08-EMP-PROPAGATION-MATRIX.md` has **no FIN row** — yet the Index lists FIN r1 as a current surface (`NS2 Index r1.dc.html:28`) and FIN carries credit approvals, billing holds and collection escalations | **SUPPORTED — IMPLEMENTATION MISSING**, and a **coverage gap in the package** | Not a ruling conflict: an unpropagated surface asserts nothing false. But `#187` §1 names APPROVAL and ESCALATION as governed axes, and the FIN pages are where both actually happen. Recorded so §27 does not read FIN's silence as "no responsibility model needed here" |
| F-2 | `NS2-FIN r1:95`, `:143-152` — *"Credits awaiting approval 1 · $18.4k"*; a billing hold renders its policy name, and releasing it shows NOT AUTHORIZED *"visually distinct from the blocked state"* | **SUPPORTED — IMPLEMENTATION MISSING** | Credit-memo **recording** exists; **approval does not**, and the threshold engine is wired only to performance goals (E-39). The four-state action rule is X-14 |
| F-3 | `NS2-HOME-01 r2:77` states the approval contract for the same credit memo, while the FIN surface that owns the queue does not | **SUPPORTED** in substance (X-26), **inconsistently placed** | `#180` invariant 4 holds wherever it is rendered; recorded as a package-internal inconsistency, not a contradiction |
| F-4 | `:87` — figures render only from governed reads, and an absent projection shows *"the honest unavailable posture with its gap id"* | **SUPPORTED** | Identical to the census's governing rule (E-40); the billing-queue projection exists but is unwired (E-39) |

### 3.10 `NS2-ADM-RPT-PUR` — Administration / Reporting / Purchasing (`pages/NS2-ADM-RPT-PUR.md`)

| Id | Design behaviour | Class | Basis |
|---|---|---|---|
| M-1 | `NS2-ADM-RPT-PUR r2:75-84` — the *"why can this person…"* derivation chain with change-preview | see **X-33** — **SUPPORTED — IMPLEMENTATION MISSING** | The nav feed deliberately withholds exactly these facts (E-18) |
| M-2 | `:42` — *"Distinct concepts stay distinct: role, permission, capability, assignment, operating company, policy"* | **SUPPORTED** | EOS holds all six apart (E-15, E-16, E-17, E-31, E-41) |
| M-3 | `:270-273` — User Access gains *"exactly one thing — the employee link"*; service accounts and login-less employees both legitimate | see **X-18** (SUPPORTED), **X-19**/**X-20** (CONTRADICTED), **X-21** (OWNER DECISION) | |
| M-4 | `:98-101` — *"Denials are facts worth showing"* with recent access events | **SUPPORTED — IMPLEMENTATION MISSING** | Denial audit events are written (`employeeProfileCommands.ts:479-487`); no per-person access-event read surface exists |
| M-5 | `:139`, `:159` — *"Records owned by Taylor AZ — buyers are accountable for outcomes, never record owners"* with `ACCOUNTABLE Maria V.` on an open PO | **SUPPORTED — IMPLEMENTATION MISSING** | As W-1 (E-36) |
| M-6 | `:164` — every Purchasing write action renders **NOT YET IMPLEMENTED**, *"distinct from denied/unavailable"*, until the authority audit lands (P2-G3) | **SUPPORTED** | Exemplary: the package refuses to draw a working control over an unaudited command set. Package-marked (`05-GAP-REGISTER.md:28`). A PO schema/command set does exist but only as a reorder-bound sidecar with no buyer (E-36) |
| M-7 | `:192`, `:203-209` — reporting definitions run against governed reads only; the draft is an editable definition, not an answer | **SUPPORTED** | Report catalog, execution service, saved definitions and the runner all exist. Note the `customer.accountOwner` **field-read capability is deferred**, so an owner-filtered report does not work today |
| M-8 | ADM People navigation exposes Employees / Job Roles / Responsibilities / Proficiencies / Qualifications / Decision Authority / Coverage / User Access as managed objects (`NS2-EMP Profile r1:58-66`; `pages/NS2-EMP-responsibility.md:20`) | **OWNER DECISION REQUIRED** | Six of the eight name concepts with **no governed existence at all** (E-25, E-28, X-16, X-25). The package already flags the grouping as *"a usability hypothesis"* (`:69`) — but the **objects themselves**, not their grouping, are what needs the Owner |

### 3.11 `NS2-EMP-responsibility` — Employee Work & Responsibility (`pages/NS2-EMP-responsibility.md`)

The pattern source. Most of its behaviour is cross-cutting: **X-1** to **X-42**. Family-specific rows:

| Id | Design behaviour | Class | Basis |
|---|---|---|---|
| P-1 | `NS2-EMP Responsibility r2:151` — responsibility context renders *"only the relationships that apply to the family… reference/master-data objects never get fake personal accountability"* | **SUPPORTED** | `#180` invariant 9 and P2-D11. The matrix's REFERENCE/EXCLUDED classification already implements the same idea (E-2) |
| P-2 | `:70` — a pending inbound transfer appears in the recipient's ACCOUNTABLE queue **while stating the current holder is still accountable** | **SUPPORTED — IMPLEMENTATION MISSING** (acceptance gating itself is **X-28**) | `#180` invariants 1 and 7 — no NONE state, no gap. Missing: pending-transfer persistence (E-13) |
| P-3 | `:217`, `:220` — *"Assume accountability"* as an explicit recorded act; *"Viewing or helping never transfers anything implicitly"*; forced transfer behind Options with reason + authorization + effective time | **SUPPORTED — IMPLEMENTATION MISSING** (forcing rights = **X-28**) | `#180` invariants 2/4/6; `#184`'s governed-orchestration boundary. Missing: the command (E-13) and the boundary (E-7) |
| P-4 | `:171-175` — Responsibility history: accountability **periods** with start/end, transfer reason, transferring/accepting employee, forced-transfer actor, escalations, assignments within each period | **SUPPORTED — IMPLEMENTATION MISSING** | `#180` invariant 6 (*"historical accountability must remain auditable"*) and `#186` §7. Missing: the storage, and a material audit constraint — the audit schema *"has no metadata/detail field, so BEFORE/AFTER VALUES CANNOT BE RECORDED without altering the governed audit schema"* (E-34). A period model needs values, not field names |
| P-5 | `:90` — `accountable: J. Ruiz — you perform, Ruiz answers for the outcome` on an assigned row | **SUPPORTED** | `#180`'s core distinction; `#182` §4 (*"An accountable person may delegate execution"*) |
| P-6 | `:104` — escalation row names the accountable person *"underneath"* and the manager's intervention as *"decide reschedule vs reassign"* | **SUPPORTED — IMPLEMENTATION MISSING** | `#180` invariant 5. No escalation axis exists (E-32) |
| P-7 | `:180` — automatic raise of a proficiency-gap escalation | see **X-27** — **OWNER DECISION REQUIRED** | |
| P-8 | `:227-230` — per-person Accountable / Assigned / Approvals / Pending-transfer / Risk columns for a named team | see **X-24** | |

### 3.12 `NS2-TEC-01-technician-mobile` — Technician Mobile Day (`pages/NS2-TEC-01-technician-mobile.md`)

| Id | Design behaviour | Class | Basis |
|---|---|---|---|
| T-1 | page doc `:6` — *"Assignment scopes what they see… assignment never authorizes — capabilities do"* | **SUPPORTED** | E-41, X-32 |
| T-2 | `NS2-EMP Responsibility r2:251` — *"Hand back to Dispatch — returns the assigned work to the queue; the currently governed accountable person does not change through this action"* | **SUPPORTED — IMPLEMENTATION MISSING** | `#187` §5. This is the v4.1 correction of the r1 text (X-1) |
| T-3 | `:248`, `:254` — `ASSIGNED TO ME` and `ACCOUNTABLE: R. DIAZ` render as **independent** chips; *"accepting an assignment does NOT automatically transfer accountability"* | **SUPPORTED** | `#187` §5. The independence of the two chips is the ruled distinction, and the backend already keeps the axes apart (E-3, E-19) |
| T-3b | `:248` — the accountable chip's own **lifecycle rule**, marked `PROPOSED — WORKFLOW VALIDATION REQUIRED` | **WORKFLOW-SPECIFIC HYPOTHESIS** | Package-marked, same rule as D-2 / S-2; cited, not re-derived |
| T-4 | page doc `:17` — day flow not grounded against the registry (P2-G2); *"no invented transitions"* | **WORKFLOW-SPECIFIC HYPOTHESIS** | Package-marked (`05-GAP-REGISTER.md:27`) |
| T-5 | `NS2-EMP Profile r1:278-292` — the phone profile answers job role, five relationship counts, availability and hand-off state | **SUPPORTED — IMPLEMENTATION MISSING** | X-2, X-16, X-31 |

### 3.13 `NS2-INB-PLT-LST` — VDX / Keystone / Lists grammar (`pages/NS2-INB-PLT-LST.md`)

| Id | Design behaviour | Class | Basis |
|---|---|---|---|
| N-1 | `NS2-LST Lists r1.dc.html:41`, `:65-83` — family-scoped responsibility columns and filters; *"'Everything Diaz is accountable for' and 'everything assigned to Diaz' are different filters — never conflated"* | see **X-11** | The strongest single statement of `#187` `M-1` in the whole package |
| N-2 | `:79` — the three-way person-state column (former / not-currently-eligible / could-not-be-resolved) | see **X-8**, **X-9** | |
| N-3 | `:87-91` — the why-popover | see **X-5** | |
| N-4 | `:109-118` — search results carrying responsibility facts; *"Search never widens authority"* | see **X-12** | |
| N-5 | `pages/NS2-INB-PLT-LST.md:5` — inbound suggestions are AI-drafted and **human-confirmed** into governed records | **SUPPORTED** | No parallel write path; consistent with X-13a |
| N-6 | `NS2-PLT-05` global search — `ADD`, MISSING CAPABILITY P2-G1 (`:12-13`) | **SUPPORTED — IMPLEMENTATION MISSING** | Package-marked; confirmed (E-38), including that **employees are not a search corpus** |
| N-7 | `NS2-LST-00`'s 17-state truth register as the cross-cutting authority for every list | **SUPPORTED — IMPLEMENTATION MISSING** | The states that matter here are the person states (X-7, X-8) and the action states (X-14) |

---

## 4. THE ELEVEN ESTABLISHED CLAIMS — verified against the package, one by one

Each verdict is *"does the package actually do this?"*, not *"is it a good idea?"*

| # | Claim | Verdict | Evidence in the package | Qualification |
|---|---|---|---|---|
| 1 | **Employee ≠ User Access** | **YES** | `NS2-EMP Profile r1:79` (*"User Access: c.mendez — linked ↗"*, and *"An employee with no login shows 'No EOS access' here, and still exists"*), `:270-273` (*"It gains exactly one thing — the employee link… A User Access with no employee link (service account) and an employee with no access are both legitimate states"*); `pages/NS2-EMP-responsibility.md:17`, `:23` | The separation is real and well drawn. **But** the concept chain names two layers where the ruling names three (**X-19**), and the matrix claims the row **COMPLETE** with no authority dependency (**X-20**) |
| 2 | **Job Role ≠ Security Role** | **YES** | `NS2-EMP Profile r1:88` — *"Role never equals permission — capabilities derive through governed grants, and the profile only summarizes them"*; `NS2-ADM-RPT-PUR r2:42`; `CHANGELOG-EMP-v4.1.md:5` claims the sweep found no defect | Two qualifications. (a) The design's job-role **names** are not the governed vocabulary (**X-16**). (b) The package uses the same **display label** for both axes — `NS2-EMP Profile r1:89` *"Service Technician PRIMARY"* (job) and `NS2-ADM-RPT-PUR r2:77` *"Role Technician grants capability inventoryCycleCountCounter"* (security). The distinction holds in prose; on screen the two labels collide, which makes the invariant unverifiable by looking |
| 3 | **Owner ≠ Accountable ≠ Assigned** | **YES** | `NS2-EMP Responsibility r2:151-156` renders all three as separate labelled rows with *"Never one generic 'owner' field"*; `NS2-SVC r2:169`; `NS2-LST Lists r1.dc.html:70`; `pages/NS2-EMP-responsibility.md:39` names *"One generic OWNER field and one undifferentiated MY WORK queue"* as anti-patterns | None. This is the package's strongest correspondence with `#180` |
| 4 | **Company ownership remains company ownership** | **YES** | `NS2-SVC r2:153` (*"Owned by Taylor AZ (company record) — no employee owns a work order"*); `NS2-INV r2:42`, `:85`; `NS2-WHS-EQP r2:40`, `:73`; `NS2-ADM-RPT-PUR r2:139`; `NS2-LST Lists r1.dc.html:41` | The design is right and the ruling is satisfied (`#180` invariant 8). **The gap is on the EOS side**: a work order has no company field to render (**S-1**, E-32) |
| 5 | **Technician assignment does not silently transfer accountability** | **YES** — and this is the v4.1 correction | `NS2-DSP-01 r2:39`, `:73`, `:107`; `NS2-EMP Responsibility r2:162` (*"It does not change: work order ownership… the currently governed accountable person, or the promise to the customer"*), `:251`; `NS2-HOME-01 r2:153`; `NS2-SVC r2:169`; `08-EMP-PROPAGATION-MATRIX.md:14` (*"Accept-transfers-accountability REMOVED as general rule"*) | The **r1** frame retained in the ingest still says the opposite (**X-1**). A reader who opens `NS2-EMP Responsibility r1` and not r2 would implement contradicted behaviour |
| 6 | **Responsibility Context uses family applicability** | **YES** | `NS2-EMP Responsibility r2:151` — *"responsibility context is available for every record family whose governed responsibility model defines applicable relationships; only the relationships that apply to the family render, and reference/master-data objects never get fake personal accountability"*; `NS2-SVC r2:169`; `NS2-LST Lists r1.dc.html:70`; `06-DECISION-LOG.md:61` (P2-D11); the matrix's own correction note at `:15` (*"corrected: no 'every important record'"*) | None. It also matches the shape EOS already has (per-family `ownerFields`, REFERENCE/EXCLUDED classes — E-2) |
| 7 | **OD-6 person states are represented** | **PARTIALLY — and the package's own completeness claim is REFUTED** | Represented: valid-current (everywhere), **valid historical / former** (`NS2-SVC r2:217`; `NS2-LST Lists r1.dc.html:79`), **invalid / could-not-be-resolved** (`:79` tooltip), **NONE as a defect** (`:80`; `NS2-EMP Responsibility r2:217`) | Not represented: **`AUTHORITY_UNAVAILABLE`** — it appears in **no** frame, doc or vocabulary list in the package (verified by grep for `authority unavailable` / `unavailable` across all 21 `.dc.html` files). The fourth slot in the package's own enumeration is occupied by person-**availability**, labelled an OD-6 state (**X-7**). `INACTIVE` vs `TERMINATED` is rendered in no frame (**X-9**) |
| 8 | **OD-7 architecture is represented** | **YES, as recited architecture** — not as distinguishable surface behaviour | The full sequence appears on all eight current operating frames (`NS2-HOME-01 r2:38`, `NS2-SVC r2:43`, `NS2-DSP-01 r2:39`, `NS2-CRM-SLS r2:42`, `NS2-INV r2:42`, `NS2-WHS-EQP r2:40`, `NS2-ADM-RPT-PUR r2:37`, `NS2-EMP Responsibility r2:40`) and in `06-DECISION-LOG.md:57` + `08-EMP-PROPAGATION-MATRIX.md:4`, clause for clause with `#184` | What is rendered is the **consequence** (refusal states, two separate actions, forced transfer behind Options). Nothing in the design distinguishes a governed path from a bypass, and the package nowhere notes that `#184`'s named bypass is **live** at the baseline (E-34). Neither reproducing nor addressing it is the safe outcome, but it must not be read as clearance (**X-23**) |
| 9 | **Lists / Search distinguish accountable vs assigned** | **YES, explicitly** | `NS2-LST Lists r1.dc.html:70` — *"'Everything Diaz is accountable for' and 'everything assigned to Diaz' are different filters — never conflated"*; separate columns at `:74-79`; search results at `:112`, `:115` | Purely a read-side design; every field and filter it needs is absent (**X-11**, E-1, E-37) |
| 10 | **"Why is this in front of me?" is part of the design** | **YES** | `NS2-LST Lists r1.dc.html:87-91` (the popover, one line per true relationship, *"never a generic 'relevant to you'"*); `NS2-HOME-01 r2:38` (*"every attention/queue item states WHY it is in front of you"*); `NS2-EMP Responsibility r2:45`, `:70`, `:80`, `:90`, `:98`, `:104` (every row carries its reason) | None as design. See **X-5** for the read it needs |
| 11 | **Service lifecycle accountable-person rules remain proposed where not governed** | **YES, with one exception** | Marked on every Service/Dispatch surface: `NS2-SVC r2:81`, `:169`; `NS2-DSP-01 r2:39`, `:73`; `NS2-EMP Responsibility r2:154`, `:248`; `08-EMP-PROPAGATION-MATRIX.md:9-10`; `05-GAP-REGISTER.md:30`; `06-DECISION-LOG.md:57` | The exception is `NS2-HOME-01 r2:151`, which asserts an `ACCOUNTABLE` chip for a dispatcher-lifecycle conflict **with no PROPOSED marker** (**H-1**) |

---

## 5. CONTRADICTED — all five rows, both quotes each

### X-42 — an accountability that lapsed to NONE because a person went on leave

**The design says** (`docs/atlas/inputs/employee-v4.1/NS2-EMP Responsibility r2.dc.html:217`):

> **"NO ACCOUNTABLE PERSON** Customer escalation — Peoria Schools install delay · **orphaned when T. Ruiz went on leave** · Assume accountability · Assign to…"

**The ruling says** (`#186` §5 case B, and §8):

> **B** | exists, `INACTIVE` | **VALID** (historical references valid) | new accountability **REFUSE**

> *"An actionable current item requiring an Accountable Person may NOT remain healthy merely because its Employee reference still resolves. If the accountable Employee becomes not currently eligible, the reference stays valid **but the current responsibility state may become a responsibility defect requiring governed resolution.** … **accountability is never automatically transferred**"*

and (`#180` invariants 1 and 6):

> *"**ACTIONABLE WORK MUST NEVER HAVE ACCOUNTABLE PERSON = NONE.**"* … *"**Historical accountability must remain auditable.**"*

**Why it contradicts.** `ON_LEAVE` is one of the six governed employment statuses (E-10). Under `#186` the reference to T. Ruiz **stays valid**; what changes is eligibility, and the correct rendering is the package's *own* `ACCOUNTABLE NOT CURRENTLY ELIGIBLE` defect (`08-EMP-PROPAGATION-MATRIX.md:22`) — which names T. Ruiz and preserves the audit trail. Rendering it as `NO ACCOUNTABLE PERSON` asserts that accountability **left** the person automatically when their status changed, which is the automatic transfer `#186` §8 forbids, produces the NONE state `#180` invariant 1 prohibits, and erases who held it.

**Both readings carried.** A second reading of *"orphaned when T. Ruiz went on leave"* is that the item **never** had an accountable person and Ruiz's absence merely revealed it. On that reading the row is `SUPPORTED — IMPLEMENTATION MISSING` (identical to **X-41**) and only the wording misleads. The design does not disambiguate, and the same frame's defect list (`:215`) contains **both** *"NO ACCOUNTABLE PERSON"* and *"holder unavailable"* as separate classes — so the package has the vocabulary to say which it means and does not use it here.

**Required distinction, not a fix:** a lapse in a person's **eligibility** must never be rendered as the **absence** of an accountable person, and the identity of the person who held it must survive the lapse.

### X-7 — the fourth person state is availability, and `AUTHORITY_UNAVAILABLE` is absent

**The design says** (`docs/atlas/inputs/employee-v4.1/08-EMP-PROPAGATION-MATRIX.md:23`):

> *"OD-6 person states rendered distinctly: valid current / former-historical (healthy on history) / invalid-unresolved (defect) / **current-but-unavailable (scheduling fact)**."*

and (`NS2-DSP-01 Dispatch Board r2.dc.html:109`):

> *"Kellerman is CURRENT EMPLOYEE, UNAVAILABLE **(OD-6 state)** — not a broken reference; his assignments show as ASSIGNEE UNAVAILABLE defects until moved."*

**The rulings say** (`#182` §3, the complete state contract):

> **A** `VALID_CURRENT` · **B** `VALID_HISTORICAL / NOT_CURRENTLY_ELIGIBLE` · **C** `MISSING / INVALID_REFERENCE` · **D** `NONE` *"only where the family legitimately permits no person reference"*

and (`#187` §2):

> *"**Ruled distinct from `INVALID / MISSING EMPLOYEE REFERENCE`** … **`AUTHORITY_UNAVAILABLE` must FAIL CLOSED.** It must **not** be interpreted as person missing or person invalid, must **not** be represented as healthy empty data, and must **not** fall back silently… The distinction must be preserved in: resolver contract · census · enforcement · audit/error semantics · **UI outcome vocabulary where applicable** · tests."*

**Why it contradicts.** `#182`'s state contract has four members and **none of them is availability**; availability is a scheduling fact about a person who is `VALID_CURRENT`. Labelling it *"(OD-6 state)"* asserts a governed classification that the ruling does not contain. And the slot that ruling **does** require — `AUTHORITY_UNAVAILABLE`, fail-closed, distinct from missing and from invalid — is rendered **nowhere** in the package, while the matrix line presents its four-item list as the complete rendering of *"OD-6 person states"*.

**What is right about it, and must be kept.** *"not a broken reference"* is exactly `#186`'s separation of reference validity from eligibility, and `ASSIGNEE UNAVAILABLE` as a defect on the **assignments** is exactly `#186` §8. Only the classification label and the missing fifth outcome are wrong.

**Required distinction:** four outcomes must be separately renderable — **valid current** · **valid but not currently eligible** · **invalid / unresolvable reference** · **the Employee authority could not be reached** — and the fourth must fail closed rather than display as empty, missing or merely unavailable. Person **availability** is a fifth, orthogonal fact and must not occupy one of those slots.

### X-19 — the concept chain omits PRINCIPAL

**The design says** (`docs/atlas/inputs/employee-v4.1/pages/NS2-EMP-responsibility.md:23`):

> *"Concept chain binding: **USER IDENTITY → EMPLOYEE** → JOB ROLE(S) → RESPONSIBILITIES → PROFICIENCIES → QUALIFICATIONS → DECISION AUTHORITY → EOS CAPABILITIES → CURRENT WORK. Employee ≠ User Access; an employee may exist with no login; linkage is one field + navigation, never a merge."*

**The ruling says** (`#185`):

> *"**Resolution chain: CREDENTIAL → PRINCIPAL → EMPLOYEE LINK → EMPLOYEE.** Never *Firebase user → therefore Employee.*"*

and:

> *"**Never collapse** EMPLOYEE into PRINCIPAL, Firebase Auth, Firestore `users`, or `fieldops_technicians`."* … *"**The crosswalk must not rely permanently on** matching strings · Firebase uid coincidence · `users/{uid}.employeeId` · `fieldops_technicians` identity · client-side linkage."*

**Why it contradicts.** The design's chain is a **two-party** relation — user identity linked to employee by *"one field"*. That is precisely `users/{uid}.employeeId`, the mechanism the ruling names as non-canonical, and it is what production actually uses today (E-21). The ruling's chain has a mandatory middle term: the **security principal**, which is the authorization identity, distinct from both the credential and the Employee.

**What is right about it.** *"never a merge"*, *"an employee may exist with no login"* and the service-account case are all correct and are `#185`-compatible.

**Required distinction:** three concepts, not two — **credential** (authentication only), **principal** (authorization), **employee** (business person) — with the governed link between principal and employee, not between login and employee.

### X-20 — a COMPLETE status on the one row whose authority is retired

**The design says** (`docs/atlas/inputs/employee-v4.1/08-EMP-PROPAGATION-MATRIX.md:18`):

> `| ADM People / User Access | Employee ≠ Principal ≠ Credential; bidirectional link only | N/A | — | — | — | — | — | N/A | — | COMPLETE |`

(the two trailing columns are *"Authority dependency"* = **—** and *"Status"* = **COMPLETE**).

**The rulings say** (`#187` §4):

> *"**Ruled:** it **may be retained as historical migration provenance** and **must NOT remain the permanent authority for creating new Employee ↔ Principal links.** … **Verified state at the baseline:** … `employeePrincipalLink.ts:36` records `RECIPROCAL_FIREBASE_UID_LINK` as **"the ONLY derived source"**; and it **is minted in code** … **So "retain as history" is not the current state — the mint site must be closed for this ruling to hold**"*

and (`#185`): *"`employee_principal_links` = **governed crosswalk**, made referentially sound with **real foreign keys**"*.

**Why it contradicts.** The row asserts a three-concept model while describing a **bidirectional link** — a two-party relation, i.e. X-19's defect in tabular form — and it declares **no authority dependency** for the one surface whose linkage authority is (a) the mechanism `#187` §4 retires, (b) still minted in code at the baseline (E-24 mint site), (c) unreachable from any deployed callable, and (d) missing the `employee_id` foreign key that `#185`'s work item **D** exists to add (E-23). `COMPLETE` with a `—` dependency is not a supportable status for that row.

**Required distinction:** the People & Access surface depends on a **governed** employee↔principal link with its own provenance (who / when / through which governed process / which employee / which principal), not on a reciprocal uid pointer — and that dependency must be stated, not blank.

### X-1 — the retained r1 frame still says accepting an assignment creates accountability

**The design says** (`docs/atlas/inputs/employee-v4.1/NS2-EMP Responsibility r1.dc.html:251`):

> *"Can't finish? **Hand back to Dispatch** — that returns **the outcome** to R. Diaz, visibly. … §29: the model is sophisticated, the interaction is not. **Accepting the visit (scenario 4) added the ACCOUNTABLE chip**; handing back is one action with a stated consequence"*

and (`:70`): *"until you accept, **T. Ruiz remains accountable**"* — stated as settled, with no hypothesis marker.

**The ruling says** (`#187` §5 `M-1`):

> *"**ASSIGNMENT remains a separate axis**, and an assignment command is **not** automatically an `OD-7` handoff. … Therefore: **REASSIGNMENT ≠ OWNERSHIP TRANSFER · REASSIGNMENT ≠ ACCOUNTABILITY TRANSFER · ACCOUNTABILITY TRANSFER ≠ OWNERSHIP TRANSFER** — unless the named governed command explicitly changes both."*

**Status.** **Already corrected by the Owner in v4.1.** `NS2-EMP Responsibility r2.dc.html:251` replaces it with *"returns the assigned work to the queue; the currently governed accountable person does not change through this action"* plus *"Standing rule: accepting an assignment does NOT automatically transfer accountability"*, and `08-EMP-PROPAGATION-MATRIX.md:14` records *"Accept-transfers-accountability REMOVED as general rule"*.

**Why it is still recorded here.** The r1 file is retained in the ingest as acceptance evidence (`CHANGELOG-EMP-v4.1.md:2`), it is byte-identical to r2 in most respects, and its filename differs by one character. `§27` must read **r2**. This row exists so the superseded text cannot be picked up as design authority by accident.

---

## 6. OWNER DECISION REQUIRED — all ten rows

| Id | The decision | Why only the Owner can settle it |
|---|---|---|
| **X-16** | The **job-role vocabulary**: which job roles exist; whether Sales splits into Retail / National Accounts; whether roles carry PRIMARY vs ADDITIONAL grain | A governed vocabulary already exists and is **closed, frozen, literal-mirrored across two writers and drift-guarded by test** (E-15, E-30). Changing it is a governed-vocabulary decision. `#186` §4's *"invent nothing"* protects **employment status**, a different vocabulary — the design does not conflict with it, but neither does it license a new role set |
| **X-21** | Whether **one administrative surface** may present credential facts, security-role facts and capability facts as a single *"User Access"* object | `#185` keeps CREDENTIAL and PRINCIPAL permanently separate concepts with different canonical targets; it does not rule on surface composition, and naming is withheld |
| **X-25** | Whether **Responsibility Coverage** (primary/backup per critical responsibility) is a **governed axis** with its own integrity measurement, and whether a single-person dependency is a first-class defect | `#187` §1 enumerates five governed axes and coverage is not among them; `#182` §6's eventual measurable axes also exclude it; `#180` invariant 9 reserves stewardship models to a separate decision. EOS's existing coverage model is commercial territory coverage with `PRIMARY \| SECONDARY \| OVERLAY` and no backup term (E-28) |
| **X-27** | Whether a proficiency gap (or any defect) may **automatically raise an escalation** | `#186` §13 lists *"automatic escalation"* among the things explicitly **not decided** |
| **X-37** | Whether two people may share accountability during a shift handover window, or `MULTIPLE ACCOUNTABLE PEOPLE` is always a zero-tolerance defect (`EMP-PQ2`) | `#180` requires exactly one accountable person at every point in time *"unless an explicit, separately Owner-approved exception defines otherwise"* — this **is** that exception question |
| **X-38** | Whether a pending accountability transfer expires, after how long, and to whom it falls back (`EMP-PQ3`) | `#180` invariants 1 and 7 forbid a NONE state and any responsibility gap, so a fallback is load-bearing; `#186` §13 leaves handoff acceptance semantics open |
| **X-39** | Whether territory / service area is a profile fact or an assignment-model concept (`EMP-PQ5`) | Package-marked. EOS has commercial sales territory only, with an explicit *"Coverage ≠ … ≠ Service Territory"* boundary (E-28) |
| **X-40** | Which qualifications **legally block** assignment when expired, vs advisory (`EMP-PQ6`) | Package-marked. Note the ruling interaction: a blocking qualification is **execution authority**, which `#182` §4 holds separate from accountability eligibility — the decision must not fuse them |
| **S-7** | The **per-state Service lifecycle accountable person** for NEW / DISPATCHED / IN-PROGRESS / WAITING-PARTS / RETURN / BILLING / EXCEPTION | The package itself classifies this row **BLOCKED — OWNER DECISION** (`08-EMP-PROPAGATION-MATRIX.md:10`); `#186` §8 rules the behaviour *"workflow-specific"* and settles nothing per state |
| **M-8** | Whether **Job Roles · Responsibilities · Proficiencies · Qualifications · Decision Authority · Coverage** become governed first-class objects at all | Six administered object types with no governed existence (E-25, E-28). The package flags the *grouping* as a usability hypothesis; the **objects** are the Owner decision |

Two further Owner-only questions are already returned by the package and are **not** re-derived here: `EMP-PQ1` (manager-validated vs self-declared adjudication) and `EMP-PQ4` (thresholds per employee, per role, or both) — `pages/NS2-EMP-responsibility.md:31`, `:34`. They are recorded under **X-17** and **X-34** as the implementation-missing rows they gate.

---

## 7. WHAT `§27` COULD BUILD TODAY vs WHAT NEEDS BACKEND

### 7.1 Buildable now against existing governed capability (41 SUPPORTED rows)

| Area | What is already there | Rows |
|---|---|---|
| Company-vs-person ownership rendering | Per-family `ownerFields`, registry-validated company arm, `account → accountOwner`, `equipment/inventory → operatingCompanyId`, explicit-owner-at-creation on Accounts | X-4, A-1, A-3, Q-1, Q-4, W-4 |
| Reassignment semantics | Reassignment already records prior/new technician, actor, time and mandatory reason, and touches nothing else | H-3, D-1, S-6, X-3 (partial) |
| Assignment-scopes-which / capability-decides-whether | Enforced with four reason-bearing refusal codes and a refusal on ambiguity | X-32, I-4, T-1, D-7 |
| Technician availability and capacity | Governed availability model with deployed callables, seven blocked-time kinds | X-30, H-6 |
| Recommend-then-govern shape | Pure client ranker with no write path feeding the governed Assign | X-13a, N-5, I-5 |
| Role-shaped navigation | Callable effective-access decision feed | X-35, H-7 |
| Receiving attribution | Receiver recorded from server-derived trusted actor, never from payload; substitution requires a named human | W-2, W-3 |
| Workflow-truth rendering | Two mirrored state machines; refusals name their rule | S-8, L-3 |
| Employee ≠ User Access | Reciprocal two-way link, fails closed on a one-way pointer; `employees` has no client writer | X-18, M-2 |
| Honest absence | The dashboard census's `UNAVAILABLE / AUTHORITY REQUIRED` rule and the NOT-YET-IMPLEMENTED treatment | F-4, M-6, M-7, X-23, A-4 |

### 7.2 Needs backend first — the named missing capabilities (45 rows)

| Missing capability | Blocks | Authority position |
|---|---|---|
| **Canonical Employee authority (PostgreSQL Employee relation)** — does not exist (E-22) | every person fact on every surface | `#185`; ten prepared items **A–J**, all NOT AUTHORIZED |
| **Authoritative person resolution with semantic states** — no resolver returns a person-reference state; all five non-`ACTIVE` statuses and a read failure collapse to one boolean (E-11, E-12) | X-8, X-9, S-5, Q-2, N-2 | `#182` Layer 1; `#186`; `#187` §2 |
| **`AUTHORITY_UNAVAILABLE` as a distinct fail-closed outcome** (E-12) | X-7 | `#187` §2 |
| **Accountable-person persistence** — no field anywhere (E-1) | X-2, X-5, X-24, L-1, I-1, I-3, W-1, M-5, P-2…P-6 | `#180`, `#181` |
| **Governed responsibility commands** (transfer accountability, assume, accept, decline, force) (E-13) | X-3, P-3 | `#184` boundary; `#186` §13 for the per-workflow parts |
| **Governed orchestration boundary + bypass elimination** — builder inert, bypass live (E-7, E-34) | X-22 | `#184` |
| **A dedicated accountability census composed into the gate** (E-9) | X-6, X-41, D-4 | `#187` §1 — and it must **not** be `ownershipMatrix.ownerFields` |
| **Approval axis and escalation axis storage** (E-32, E-39) | X-26, P-6, A-2, F-2 | `#187` §1 |
| **Accountability history as periods with values** — the audit schema cannot record before/after values (E-34) | P-4 | `#180` invariant 6 |
| **Responsibility reads / projections per axis, and filters** — no assignee filter, no saved-view backend (E-37) | X-5, X-11, N-1, N-3 | read-side only |
| **Cross-object search including employees** (E-38) | X-12, N-4 | P2-G1 |
| **Operating-company provenance on a work order** (E-32, census `G-13`) | S-1 | `#180` invariant 8 |
| **Four-state action semantics on work orders** — collapsed today; precedent named (E-33) | X-14, S-4, F-2 | `#184`, `#182` §4 |
| **Proficiency / qualification / specialization / decision-authority-threshold models** (E-25, E-39) | X-13b, X-17, X-34, D-5, T-5 | `#185` names them Employee business data; vocabularies are Owner decisions |
| **Person-level reporting relation** — `managerEmployeeId` read by no server decision; hierarchy is Role-derived (E-27) | X-24, P-8 | — |
| **Governed EMPLOYEE ↔ TECHNICIAN projection** — no `employeeId` on a technician; 2 of 13 ids do not coincide (E-29) | X-29 | `#187` §3 |
| **Employee-level availability** — existing model is technician-keyed (E-26) | X-31 | `#185` |
| **Admin-scoped access-derivation read** — the nav feed deliberately withholds reason/role/scope/condition (E-18) | X-33, M-1 | not ruled; a **new** read, not a widening of the nav feed |
| **Governed employee↔principal linkage with FK and successor provenance** (E-21, E-23, E-24) | X-19, X-20, M-3 | `#185`, `#187` §4 |
| **Notification delivery** (E-44) | X-10 | — |

### 7.3 The occupancy caveat that applies to every populated surface

Production at 2026-09-02 held **6 employee records, 2 role assignments, one principal with any active
assignment, zero governed manager Roles and zero location scopes** (E-20). Every surface whose usefulness
depends on a populated roster — the seven HOME persona variants, the manager team-load table
(`NS2-EMP Responsibility r2.dc.html:223-230`), Responsibility Coverage
(`NS2-EMP Profile r1.dc.html:240-247`), the technician lanes (`NS2-DSP-01 r2:83-107`), the recommendation
grounds (`:74`) — is **SUPPORTED — IMPLEMENTATION MISSING at minimum**, and would additionally be
undemonstrable against real data even if the backend existed tomorrow. The census's own framing applies:
*"It is not evidence that production is ready to use R-32 — activating manager authority there is a grant
decision"* (`docs/assessments/r32-production-exposure-census.md:144-145`).

---

## 8. UNPROVEN

| Id | Statement I could not verify | Why |
|---|---|---|
| U-1 | Whether the matrix's `COMPLETE` statuses mean *design-pattern complete* or *delivered* | `08-EMP-PROPAGATION-MATRIX.md:3` defines the vocabulary but rows mix the senses: `:14` says `COMPLETE (correction applied)` with authority dependency `P2-G5, OD-6`; `:15` says `COMPLETE for pattern; flows WS-HYP`; `:17` says `COMPLETE as pattern`; `:18` says `COMPLETE` with dependency `—`. Only `:18` is unqualified — hence **X-20** |
| U-2 | Whether `INACTIVE` and `TERMINATED` are separately **rendered** anywhere in the package | Grep across all 21 `.dc.html` files finds *"former employee"* (`NS2-SVC r2:217`, `NS2-LST r1:79`) and no `INACTIVE`/`TERMINATED` rendering. `ACCOUNTABLE INACTIVE` exists only in two prose vocabulary lists. `#186` §4 requires the distinction; the package may intend it without showing it |
| U-3 | The second production role assignment's roleId, scope and status | `totals.roleAssignments = 2` but `principals[]` carries one entry with one active assignment; the script emits only ACTIVE labels, so the second is filtered as a recognised non-active status and appears in neither artifact |
| U-4 | Which individual HOME / FIN figures are `REPORTABLE_NOW` vs `AUTHORITY_GAP` vs `BLOCKED_BY_DEPENDENCY` | Requires per-figure mapping against the 132 fact families in `docs/assessments/eos-dashboard-reporting-authority-census.md`; that is family-open work, not authority reconciliation. Note the census's own withdrawn headline about `finance.visibility.*` (`:26-41`) — cite it carefully |
| U-5 | Whether the scheduling command actually **server-refuses** an overlapping placement, as `NS2-DSP-01 r2:89` asserts (*"The board cannot save an overlapping state; the command refuses it"*) | Scheduling commands, dispatcher gating and mandatory reasons were verified; overlap refusal was not read |
| U-6 | Whether `NS2-Layout-Atlas.dc.html:22`'s *"charter A1 visual ruling pending"* is deliberate retained staleness | `06-DECISION-LOG.md:39-42` and `ATLAS-CHARTER-v3.1.md:18-19` record A1 as **RESOLVED**. Harmless for responsibility, but it is a stale authority statement inside a current-linked file |
| U-7 | Whether any of the **other 18** Financials pages assert responsibility facts | Only `FIN-01` and `FIN-02` are framed at r1; the remaining 18 exist as the P1 register referenced at `pages/NS2-FIN-financials.md:2`, which is outside this ingest. **F-1**'s coverage-gap finding is therefore about what is *in* the package |
| U-8 | Whether `NS2-EMP-12` (profile data collection & validation) asserts anything beyond the one proficiency case that is framed | `pages/NS2-EMP-responsibility.md:19` describes four evidence classes; only the Refrigeration Diagnostics review is drawn (`NS2-EMP Profile r1:153-200`) |
| U-9 | Whether `#184`'s required **end-to-end call-path census** has been performed anywhere | Out of this lane's surface. `#184` names it *"Required before implementation authorization"*, and E-34 confirms at least one bypass is live |

---

## 9. MISSING INPUT — the questions only the Owner can answer

These are the §6 rows restated as questions, so a decision packet can be assembled without re-reading the
tables. No option is recommended here.

| | Question |
|---|---|
| MI-1 | Which **job roles** exist as governed values, and does the governed eight-value `operationalRoles` set get extended, replaced, or joined by a second business-role vocabulary? (X-16) |
| MI-2 | Is **Responsibility Coverage** a governed axis with its own measurement, and is a single-person dependency a defect? (X-25) |
| MI-3 | May any defect **automatically raise** an escalation? (X-27) |
| MI-4 | May two people hold accountability simultaneously during a handover window? (X-37) |
| MI-5 | Does a pending accountability transfer **expire**, and to whom does it fall back? (X-38) |
| MI-6 | Is **territory** a profile fact or an assignment-model concept? (X-39) |
| MI-7 | Which **expired qualifications block** assignment, as against advising? (X-40) |
| MI-8 | Who is the accountable person at each **Service lifecycle state**? (S-7) |
| MI-9 | Do **Job Roles · Responsibilities · Proficiencies · Qualifications · Decision Authority · Coverage** become governed first-class objects? (M-8) |
| MI-10 | May one administrative surface compose **credential** and **principal** facts as a single object? (X-21) |
| MI-11 | Are decision-authority thresholds per employee, per role, or both with overrides? (`EMP-PQ4`, X-34) |
| MI-12 | When manager-validated and self-declared proficiency conflict, is the governed level always the manager's? (`EMP-PQ1`, X-17) |

---

## 10. CORRECTIONS TO THE LANE BRIEF

Recorded because the brief asks for them, and because each would have produced a wrong row.

| | Brief said | Correct position |
|---|---|---|
| B-1 | *"**Does any surface require a job-role vocabulary?** There is none governed at baseline"* | **Wrong.** A governed job-role vocabulary **does** exist: `OPERATIONAL_ROLE_VALUES`, eight frozen values on `employees/{id}.operationalRoles`, written through the governed command, mirrored by literal in a second writer, **drift-guarded by test**, and consumed for authority gating (E-15, E-30). EOS also holds 45 inert governed business **Roles** named after job titles (E-17) and states the job-vs-security distinction in its own comments (E-31). The brief's load-bearing point **survives in a sharper form**: the governed set contains **none** of the design's role names and no PRIMARY/ADDITIONAL grain, so the design needs a vocabulary **extension**, which is an Owner decision (X-16) — not an absent vocabulary |
| B-2 | *"governed-business-role occupancy is **zero** per committed census `be1e5579` … (one principal `admin@global`, `employeeId: null`, second assignment unitemised)"* | **Substantially right, incomplete in a way that matters.** Confirmed: zero governed manager Roles (`0 of 1` PARTS_MANAGER, `0 of 1` WAREHOUSE_MANAGER), zero location scopes, one principal with any ACTIVE assignment (`admin@global`, `employeeId: null`), and the second assignment is filtered as non-active and itemised nowhere. **But** the same census records **6 employee records, 16 users**, and **two production managers with real `employeeId`s carrying `PARTS_MANAGER` / `WAREHOUSE_MANAGER` operational roles** (E-20). So the correct statement is *"zero **governed-Role** occupancy, two operational-role holders, six employees"* — not *"nothing is populated"*. The brief's conclusion for design rows is unchanged |
| B-3 | *"`#186`'s … `operationalRoleContext.ts:51-52`"* | Those lines are the **doc comment**; the implementing line is **`:123`** (E-11). Both are true and the ruling's citation is accurate as a citation — recorded so a later lane looking for the code does not conclude the citation is wrong |
| B-4 | *"Baseline `64008d5a`. Every claim about EOS carries `[OBSERVED AT: 64008d5a]`"* | Correct for EOS claims, and followed throughout. **But `#180`–`#187` are not at that baseline** — they live on `int/a-correctness-register` @ `ea3db970`, which is not an ancestor of `64008d5a` (§0). Ruling citations therefore carry their own baseline, as the charter's own rule requires |
| B-5 | *"**21 HTML frames** plus `NS2-Layout-Atlas.dc.html` and `support.js`"* | There are **21 `.dc.html` files in total, the Layout Atlas and the Index included** — so 19 design/index frames + the atlas + the index. The 50-file total is right. The brief's governing-docs list also omits `INGEST-MANIFEST.md`, which is the file that makes the no-edit rule enforceable |
| B-6 | *"**21 HTML frames (r1/r2 per family)**"* | Four current surfaces have **no r2**: `NS2-FIN Financials r1`, `NS2-LST Lists r1`, `NS2-EMP Profile r1`, `NS2 Index r1`. `NS2-LST` and `NS2-EMP Profile` are **new at r1** and carry some of the package's most load-bearing responsibility content (X-8, X-11, X-25) |
| B-7 | *"its own gap register is likely your best source of candidate `OWNER DECISION REQUIRED` … rows"* | The gap register's New-in-P2 rows are **AG / MC / WG** — authority and capability gaps, which map to **IMPLEMENTATION MISSING**, not Owner decisions. The richest Owner-decision sources were `pages/NS2-EMP-responsibility.md:30-36` (**EMP-PQ1–PQ6**) and `08-EMP-PROPAGATION-MATRIX.md:9-10` (the two `BLOCKED — OWNER DECISION` rows). Eight of the ten §6 rows come from those two places or from a ruling's own *"not decided"* clause |
| B-8 | Test 1 — *"a design that renders [ownership and accountability] as one field is **CONTRADICTED**"* | **No surface does this.** The package passes, repeatedly and deliberately: `NS2-EMP Responsibility r2:151` (*"Never one generic 'owner' field"*), `:153-156` (three separate rows), `NS2-LST Lists r1.dc.html:41` (*"no personal Owner column (company-owned family)"*), and `pages/NS2-EMP-responsibility.md:39` names the generic OWNER field an anti-pattern. Recorded as a **verified negative**, because an unexamined pass is worth as little as an unverified endorsement |
| B-9 | Test 4 — *"Does any surface imply reassignment transfers accountability or ownership?"* | **Only the retained r1 frame** (X-1), which the Owner already corrected in v4.1. Every current surface states the opposite explicitly |

---

## 11. COUNTS

| Class | Cross-cutting | Per-family | Total |
|---|---:|---:|---:|
| **SUPPORTED** | 8 | 33 | **41** |
| **SUPPORTED — IMPLEMENTATION MISSING** | 21 | 24 | **45** |
| **WORKFLOW-SPECIFIC HYPOTHESIS** | 1 | 6 | **7** |
| **OWNER DECISION REQUIRED** | 8 | 2 | **10** |
| **CONTRADICTED** | 5 | 0 | **5** |
| | **43** | **65** | **108** |

Plus **9 UNPROVEN** statements (§8), **12 MISSING INPUT** questions (§9) and **9 corrections to the lane
brief** (§10). Family rows that only cross-reference a cross-cutting row are not counted twice.

**The distribution is the finding.** 45 of 108 material behaviours are authority-correct with no backend,
and 41 are already supported. Only **5** contradict a ruling, and **one of those five (X-1) the Owner had
already corrected** in this very package. The design is not the problem; the missing person authority is.

---

## 12. STANDING LIMITS OF THIS DOCUMENT

- **No implementation is authorized by this file.** All 42 items in
  `OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md` and the ten prepared PostgreSQL items **A–J** remain
  `IMPLEMENTATION STATUS = NOT AUTHORIZED` (`#182`, `#184`, `#185`, `#186`, `#187`).
- **Naming is not frozen.** `#182` §3 and `#185` both withhold enum and schema names for the person-reference
  states. Where this document names a state it quotes the ruling's own wording as a semantic label, never as
  an identifier to implement.
- **No UI is proposed.** Every row names a required **distinction**, not a component, label or copy string.
- **The design input was not modified.** `docs/atlas/inputs/employee-v4.1/` is byte-unchanged; corrections
  live here, as `INGEST-MANIFEST.md:9-12` requires.
