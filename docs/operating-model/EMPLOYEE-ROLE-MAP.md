---
artifact_type: operating-model-canonical
lane: EMP-OWN-SYNTHESIZER
baseline: 64008d5ae0bdd9532909671b15a91122400accf1
date: 2026-09-13
implementation_status: NOT AUTHORIZED
---

# EMPLOYEE ROLE MAP

**OBSERVED AT: 64008d5a.** Integrated from **EMP-ROLE** (primary), **EMP-WORK** §1, **EMP-INFORMATION**
§4, **EMP-EXPERIENCE** §2, **EMP-PERFORMANCE** §3.6, with occupancy from **OWN-E2E** and
**EMP-EXPERIENCE** §2.3. Conflicts live in
[`EMPLOYEE-OPERATING-MODEL.md`](EMPLOYEE-OPERATING-MODEL.md) §5.2; the ids **R-1 … R-8** are used here
as cross-references.

> **This lane did not start from EOS security Roles.** EMP-ROLE started from **observed work** — the
> 1,010-activity corpus — and used the Role catalogs only as corroboration that a body of work exists.
> **That method is preserved.**

---

## 1. There is no job-role vocabulary. There are five, and a sixth in the corpus.

**EMP-ROLE F-3 — the central structural finding of the role lane.** The repository has **no single
enumerated job-role model.** It has five disjoint role vocabularies, **none of which is an org chart**,
and **no mapping between them.**

| # | Vocabulary | Size | Declared at | Is it a job role? | Who consumes it |
|---|---|---:|---|---|---|
| V1 | `employees/{id}.jobTitle` | **unbounded** | `employeeProfile.js:83` — `{ key: "jobTitle", kind: "TEXT" }` | Closest in **intent**, but **free text**. No enum, no validation, no vocabulary | **Nothing.** Unqueryable, no referential integrity |
| V2 | `employees/{id}.operationalRoles[]` | **8** | write vocabulary `VALID_OPERATIONAL_ROLES` in `functions/scripts/provisionEmployeeAccess.js` (**the sole writer of the collection**); mirrored `employeeVocabulary.js:67-76`; server enum `employeeProfileCommands.ts:336` | Closest in **form** — an enum on the Employee. `PARTS_MANAGER · PARTS_ASSOCIATE · TECHNICIAN · WAREHOUSE_MANAGER · WAREHOUSE_ASSOCIATE · SERVICE_MANAGER · SALES_MANAGER · SALES_ASSOCIATE` | **Between 3 and 5 of 8 gate a real check** — see §2 and conflict **E-3** |
| V3 | Governed business Roles | **45** | `governedBusinessRoles.ts` (45 `id:` declarations, re-derived by this synthesis) | **NO — security.** The brief is right to refuse these as the org chart | The authority model, via `roleAssignments` |
| V4 | Compatibility Roles | **3** | `compatibilityRoles.ts:350` — `admin`, `dispatcher`, `technician` | **NO** — security, and a parity oracle | **The only Roles Firestore Rules can see** |
| V5 | `users/{uid}.role` | **3** | legacy role string | NO | *"the role that actually decides what a user can see"* — `P3B1-S09-A09`: *"A user with the right capabilities and the wrong legacy role sees the wrong app"* |
| V5b | `employees/{id}.securityRole` | 3 | denormalised **read-only mirror** of `users/{uid}.role` | NO | Display. `updateEmployeeProfile` **refuses it by name** |
| V6 | Corpus role labels | **8 / 14 / 18** raw (40 distinct) | the three activity libraries | **Descriptive of observed work.** **No two libraries share a vocabulary or a casing convention** | Nothing — prose |

**V2 is the most defensible starting point and it is very small.** Eight values covering only Parts,
Warehouse, Service and Sales. **It has no value for Owner, General Manager, Dispatcher, Service
Coordinator, Purchasing, Finance/Accounting, Controller or Administration** — every one of which has
substantial observed work (EMP-ROLE §3).

**The measured consequence — EMP-EXPERIENCE §2.1**, mapping all 1,010 activities' role labels against
the access model by normalised name:

| Authored under a role label that… | Activities | Share |
|---|---:|---:|
| matches a **governed business Role** | 392 | 39% |
| matches a **compatibility role only** (`dispatcher`, `technician`) | 101 | 10% |
| **matches no role in the access model at all** | **517** | **51%** |

The 517 includes **the two largest populations in the corpus** — `field_technician` (130) and
`service_coordinator` (68) — plus `Administrator`/`System Admin` (110), `service_manager` (60),
`Inventory Control Analyst` (34), `Stocker/scanner operator` (28), `Receiving Lead` (19),
`service_billing_admin` (18), `Branch Parts Coordinator` (12), `Satellite Attendant` (7),
`parts_counter` (5), `after_hours_coordinator` (5).

Conversely, **29 of the 45 governed Roles have no corpus role label at all** — every
`inventory*`/`equipment*`/`report*`/`workOrderLabor*`/`emailIntake*`/`serviceInboundWork*` Role, plus
`shopManager`, `shopAssociate`, `supportStaff`, `warehouseAssociate`, `generalEmployee`,
`crmActivityContributor`, `performanceGoalSubject`. **(EMP-ROLE independently reports 26 of 45 with no
corpus ACTIVITY — the 26/29 difference is label-matching vs activity-attribution and both are
recorded.)**

> **THE REQUIREMENT THIS PRODUCES.** *There is no authoritative role on which to key a role-shaped
> queue.* **The authority model is written in CAPABILITY-BUNDLE language (`inventoryPutAwayOperator`)
> and the work is written in JOB language (`Receiving Lead`), and nothing maps them.** Every
> requirement anywhere in this corpus that says "the queue is keyed on Role" is **conditional on a
> job-role↔Role mapping that does not exist at this baseline.** → `OD-1`

---

## 2. How inert is V2? Four readings — conflict E-3

| Reading | Count inert | Basis | Lane |
|---|---:|---|---|
| **5 of 8** | `TECHNICIAN`, `WAREHOUSE_ASSOCIATE`, `SERVICE_MANAGER`, `SALES_MANAGER`, `SALES_ASSOCIATE` | `employeeVocabulary.js:19-20` — *"have no consumer anywhere in this client yet"* | EMP-ROLE F-4 |
| **5 of 8** | only `PARTS_MANAGER` and `WAREHOUSE_MANAGER` appear in `firestore.rules` via `isActiveOperationalRole()` (`:112`, used at the `parts` block ~`:1633-1636`), **plus `TECHNICIAN` through separate technician predicates** | EXECUTED on the enum (8 members at `employeeProfileCommands.ts:336`), static on consumers | OWN-E2E F-7 |
| **4** | `SERVICE_MANAGER`, `SALES_MANAGER`, `SALES_ASSOCIATE`, `WAREHOUSE_ASSOCIATE` have ≤2 non-declaring consumer files | independent verification | OWN-DESIGN §14 |
| **3** | only `SERVICE_MANAGER`, `SALES_MANAGER`, `SALES_ASSOCIATE` appear **solely** in the enum, a label list and a policy seed snapshot; `WAREHOUSE_ASSOCIATE` and `TECHNICIAN` each have **at least one real consumer** (`dashboardComposition.js:154`; the technician binding) | *"The count is EMP-ROLE's to settle; the three that matter to this lane are verified"* | EMP-ACCOUNTABILITY UN-7 |

**The disagreement is definitional — what counts as a consumer.** **All four readings agree on the
three that matter:** `SERVICE_MANAGER`, `SALES_MANAGER`, `SALES_ASSOCIATE`.

> **And the load-bearing consequence is invariant across all four readings: `SERVICE_MANAGER` — the
> exact value the Owner's worked example names as the Work Order accountable person — has NO
> CONSUMER.** `SALES_MANAGER`, the natural first escalation for the commercial chain, is the same.
> **So the Owner's worked example fails on this axis too: not only is there no accountability *field*,
> there is no *role value* with any behaviour behind it to point one at.**
> (EMP-ACCOUNTABILITY §1.2)

**V2 is therefore between 37% and 62% inert**, and it is still the **least-bad existing carrier** for a
job role (EMP-ACCOUNTABILITY OD-EMP-007) — *"but only after the three dead values acquire consumers."*

---

## 3. The role register — observed work, with its security home

**Provenance per role.** **KNOWN** = observed work with a citation · **INFERRED** = assembled from
adjacent evidence · **OWNER DECISION REQUIRED** / **MISSING INPUT** as defined in
`EMPLOYEE-OPEN-DECISIONS.md`. Counts are re-derived activity counts at baseline (EMP-ROLE §5).
"Sec. Role" = nearest security Role, or `—` for none.

| Job role | Corpus evidence | Count | Sec. Role | Org-tree placement | Verdict |
|---|---|---:|---|---|---|
| **Owner** | B3 `Owner` | 10 | `owner` | root, `stated:true` | KNOWN |
| **General Manager** | B3 `General Manager` | 14 | `generalManager` | under `owner`, `stated:true` | KNOWN · **0 of 9 workflows finishable** |
| *…/ Partner* | **none — `partner` = 0 occurrences repo-wide** | 0 | — | — | **MISSING INPUT** |
| **Service Manager** | B1 `service_manager` 60; B3 `Field Manager` 9 | 69 | **`fieldManager`** | under `operationsManager` | KNOWN — **see R-6: the chart's Service Manager IS `fieldManager`** |
| **Service Coordinator** | B1 `service_coordinator` (Marisol Vega, Rosa Delgado) | 68 | **—** | **unplaced** | **KNOWN work, NO security Role — the largest such gap** |
| **Dispatcher** | B1 `dispatcher` 61; B2 27; B3 9 | 97 | `dispatcher` (**compatibility**) | under `fieldManager`, above `technician` | KNOWN |
| **Service Technician** | B1 `field_technician` 104; B2 26; B3 4 | 134 | `technician` (**compatibility**) | under `dispatcher` | KNOWN |
| — *Apprentice Technician* | B1 `apprentice_technician` (Wes Tanner) | 9 | **—** | unplaced | KNOWN work, NO Role · **indistinguishable from a journeyman** |
| — *After-hours Coordinator* | B1 `after_hours_coordinator` (Ken Iwata) | 5 | **—** | unplaced | KNOWN work, NO Role · **`ACTION_PERMISSIONS` has no time-of-day or on-call dimension** |
| — *Service Billing Admin* | B1 `service_billing_admin` (Amanda Foy) | 18 | **—** | unplaced | KNOWN work, NO Role · **0 of 5 workflows finishable** |
| **Retail Sales** | **no channel-differentiated activity** | **0** | `salesperson` (shared) | under `salesManager` | **OWNER DECISION — see R-7** |
| **National Accounts Sales** | **no channel-differentiated activity** | **0** | `salesperson` (shared) | under `salesManager` | **OWNER DECISION — see R-7** |
| *(undifferentiated Salesperson)* | B3 `Salesperson` | 43 | `salesperson` | under `salesManager` | KNOWN as observed; **NOT a role EMP-ROLE endorses** |
| — *Sales Manager* | B3 `Sales Manager` | 52 | `salesManager` | under `admin`, peer of Ops/Finance/Marketing | KNOWN · **7% finishable** |
| **Parts Manager** | B2 65; B3 4 | 69 | `partsManager` | under `operationsManager` | KNOWN |
| **Parts Associate** | B2 (Dwayne Holbrook) | 37 | `partsAssociate` | under `partsManager` | KNOWN |
| **Parts Counter** | B1 `parts_counter` (Nate Purcell) | 5 | **—** | unplaced | KNOWN work; **distinct from Parts Associate — see R-5** |
| — *Branch Parts Coordinator* | B2 (Nadia Fournier, **100% `ventana`**) | 12 | **—** | unplaced | KNOWN work, NO Role · **12/12 `OC_UNCLEAR`, 11/12 `OWNERSHIP_UNCLEAR`** |
| **Warehouse Manager** | B3 | 5 | `warehouseManager` | under `operationsManager` | KNOWN (thin: 5) |
| — *Warehouse Associate* | **no corpus activity** | 0 | `warehouseAssociate` | under `warehouseManager` | **Role with no activity — see §5** |
| — *Receiving Lead* | B2 (Ray Camacho) | 19 | `inventoryReceivingClerk` | unplaced | KNOWN work · EMP-ROLE records **—**; EMP-INFORMATION maps `inventoryReceivingClerk`. **Both recorded** |
| — *Stocker / scanner operator* | B2 28 + `Stocker` 4 (**both Luis Mendoza**) | 32 | **—** | unplaced | KNOWN work, NO Role · **intra-library naming conflict — R-3** |
| — *Satellite Attendant* | B2 (Owen Tate) | 7 | **—** | unplaced | KNOWN work, NO Role |
| — *Inventory Control Analyst* | B2 (Tessa Nguyen) | 34 | **—** (nearest `inventoryCycleCountCounter` / `…Reconciler`) | unplaced | **KNOWN work, NO Role — the largest such gap after Service Coordinator** |
| **Purchasing Manager** | B3 | 2 | `purchasingManager` | under `financeManager` | KNOWN (very thin: 2) |
| — *Purchasing Admin* | B2 (Gil Overton) | 8 | **—** | unplaced | KNOWN work, NO Role |
| **Finance / Accounting** | B3 `Accounting Manager` 36; `Finance Manager` 2; `Controller` 30; B2 `Controller` 19 | 87 | `accountingManager`, `financeManager`, `controller` | all on the `financeManager` spine | KNOWN — **see §4 F-10** · Controller **15% finishable, 20 workflows** |
| **Administration** | B3 `Administrator` 83; B2 `System Admin` 27; B3 `Office Manager` 18 | 128 | `admin` (compatibility) / `officeManager` | `admin` under `generalManager` | **KNOWN work; role boundary UNCLEAR — see §4 F-11** · **9% finishable** |
| — *Operations Manager* | B2 17; B3 26 | 43 | `operationsManager` | under `admin` | KNOWN · **8 domains crossed** |
| — *Marketing Manager* | B3 | 2 | `marketingManager` | under `admin`, peer of Sales by Owner ruling 2026-08-19 | KNOWN (very thin: 2) |
| — *Report Viewer* | B3 | 1 | `reportViewer` | non-hierarchical | **NOT A JOB ROLE — a grant** |

---

## 4. Named findings carried from EMP-ROLE

| id | Finding |
|---|---|
| **F-1** | **Concepts MANAGER and JOB ROLE are conflated in OPPOSITE DIRECTIONS by two subsystems at the same baseline.** `roleHierarchy.ts` derives the manager relation from the **security Role** (*"Role is the hierarchy levels"*, Owner 2026-08-19), so a security Role does a job-role's and a manager-edge's work at once. Meanwhile `employeeProfileCommands.ts` stores a real `managerEmployeeId` the visibility resolver **does not read**. **Two answers to "who manages this person" exist and nothing reconciles them.** → conflict **AU-1** |
| **F-2** | **ESCALATION OWNER and DOMAIN STEWARD have NO representation at baseline.** Any per-role escalation or steward attribute anywhere in this corpus is therefore **INFERRED from observed handoffs only, never read from a model** |
| **F-5** | **Occupancy.** Every Employee profile field added by the Administration consolidation is *"All nullable, all backward compatible, **none backfilled**"* — so `jobTitle`, `managerEmployeeId` and `operatingCompanyId` are **presumed empty on existing records**. **Job-role occupancy is UNPROVEN and probably unpopulated.** *(EMP-ROLE additionally recorded security-Role occupancy as unproven; that half is now **withdrawn** — see §6)* |
| **F-7** | **The chart's Service Manager IS this platform's `fieldManager` Role**, not a Role named `serviceManager`. *"The name difference is why 'serviceManager' could not be granted earlier — it is this."* **Do not treat them as different roles.** → **R-6** |
| **F-8** | **"Parts Associate / Counter" collapses two roles the corpus holds apart** — B2 `Parts Associate` (37, purchasing/approval) and B1 `parts_counter` (5, truck-stock reconciliation and serialized custody). Different libraries, different personas, different work → **R-5** |
| **F-9** | **Luis Mendoza carries two role strings WITHIN B2** — `Stocker/scanner operator` (28) and `Stocker` (4). **An intra-library inconsistency, distinct from the two cross-library conflicts the brief names** → **R-3** |
| **F-10** | **`accountingManager` and `financeManager` are INTENTIONALLY identical in capability** — *"Two Roles that resolve the same way are not a defect when the distinction they encode is real and the authority difference has not been designed yet"* (DECISIONS #114). **This is the same pattern as `salesperson`/`salesManager` and the same pattern the Retail/National ruling will hit** — the repo has a precedent for holding two roles distinct in name while identical in authority. **The sales archaeology nonetheless classes the divergence an AUTHORITY GAP. Both readings recorded** |
| **F-11** | **"Administration" is the largest observed work block (128) and the least role-like.** It spans compatibility `admin`, `officeManager`, and B2's `System Admin` (27, Sam Ortega — void/cancel/schema-repair work that reads as **platform operations**, not office administration). **Whether Administration is one job role, two, or an IT function is OWNER DECISION REQUIRED** |
| **F-12** | **Five governed Roles are POSITIONS with zero observed work** — `generalEmployee`, `supportStaff`, `shopManager`, `shopAssociate`, `warehouseAssociate`. `shopManager` is placed in the tree from the Owner roster 2026-08-20 (Willie) with the note *"Holds no capabilities; placement is visibility only and confers nothing"* — **an Owner-named position with neither capability nor observed work.** `warehouseAssociate` is placed under `warehouseManager` yet has zero activity **while `Receiving Lead`, `Stocker` and `Satellite Attendant` (30 activities) do the warehouse floor work and have no Role.** **The Role catalog and the corpus disagree about what warehouse work is** |
| **F-13** | **Only 22 of 48 security Roles are placed in the org tree.** Absence is deliberate and meaningful. **So 26 Roles confer no hierarchical visibility**, and a job-role model built from the Role catalog would inherit 26 positionless entries — `hierarchicalVisibility.ts:33-35`: *"they are grants, not positions, so holding one neither widens what their holder sees nor makes that holder visible to anyone"* |
| **F-14** | **Proficiency is entirely unmodelled and the corpus proves the consequence.** `employee-foundation.md:67-72` puts **Skills** and **Certifications** explicitly out of scope alongside HR integration, scheduling, payroll, availability and time tracking. Corpus **P3B1-S17-A06** — *"Complete a job that requires a certification he does not hold"* — records the expected result in two words: **"Nothing warns."** **So proficiency is not merely unrecorded; the system cannot enforce one and does not notice its violation.** Three subsystems that should gate on competence read none of it: the recommendation engine, the scheduler and the transition engine → `OD-12` |

---

## 5. Roles without security Roles · security Roles without work

**Both directions are findings.** Matching was by exact name normalisation against the 45 governed
Roles, then reconciled by hand against `compatibilityRoles.ts` (EMP-ROLE §6).

### 5.1 Corpus roles with NO security Role at all — **13 roles, 290 activities = 28.7% of the corpus**

`service_coordinator` **68** (largest gap; inbound-work queue owner) · `Inventory Control Analyst` 34 ·
`Stocker/scanner operator` 28 · `System Admin` 27 · `Receiving Lead` 19 · `service_billing_admin` 18 ·
`Branch Parts Coordinator` 12 · `apprentice_technician` 9 · `Purchasing Admin` 8 ·
`Satellite Attendant` 7 · `after_hours_coordinator` 5 · `parts_counter` 5 · `Stocker` 4.

**Reconciled as NOT gaps** (they resolve to **compatibility** Roles, not governed ones):
`dispatcher`/`Dispatcher` (97), `field_technician`/`Field Technician`/`Technician` (134),
`Administrator` (83 → compatibility `admin`). **Without the 48-vs-45 correction these 314 activities
(31% of the corpus) appear falsely as roles with no security Role.** That is what makes 48 load-bearing.

> **290 activities (28.7%) belong to roles with no security Role. Either the role model is short 13
> roles or the corpus invented 13 actors. Nothing in this repository decides which** (EMP-ROLE §12.5)
> → `OD-3`

### 5.2 Governed Roles with NO corpus activity — **26 of 45**

| Class | Roles | Count |
|---|---|---:|
| **Positions with no observed work** (job-role candidates that failed to appear) | `generalEmployee`, `supportStaff`, `shopManager`, `shopAssociate`, `warehouseAssociate` | **5** |
| **Grants, not positions** (correctly absent from any job-role model) | 12 `inventory*` operator/clerk/administrator Roles, `workOrderPartsPlanner`, `workOrderLaborCorrector`, `technicianLaborRecorder`, `crmActivityContributor`, `emailIntakeAdministrator`, `serviceInboundWorkReviewer`, `equipmentCatalogAdministrator`, `equipmentInstaller`, `performanceGoalSubject`, `reportAuthor`, `reportFinanceViewer` | **21** |

**The five positions are the actionable half.** The 21 grants are correctly absent
(`NON_HIERARCHICAL_ROLES`, `roleHierarchy.ts:251`).

---

## 6. OCCUPANCY — measured, and zero in production

**"Occupancy unknown" is WITHDRAWN.** Full evidence in
[`EMPLOYEE-OPERATING-MODEL.md`](EMPLOYEE-OPERATING-MODEL.md) §2. Three tables exist and **must not be
merged** (conflict **AU-11**):

| Environment | Source | Measure |
|---|---|---|
| **Production (`taylor-parts`)** | `docs/assessments/r32-production-exposure-census.{md,json}`, committed by **`be1e5579`** (2026-09-02, **verified an ancestor of HEAD**), `readOnly`, `writesPerformed: 0` | **2** `roleAssignments` total · **1** principal with any active assignment, holding `["admin@global"]` — a **compatibility** Role with **`employeeId: null`** (anomaly `PRINCIPAL_HAS_NO_EMPLOYEE_LINK`) · `uniqueExposedPrincipals: 0` · `capabilityMatrix: []` · **holders of any of the 45 governed business Roles: 0** |
| **Sandbox (`eos-platform-sandbox`)** | `docs/governance/certification-grant-manifest.json:3-4`, pre-state `pre-grant-snapshot.json` | **86** active governed assignments across **30 distinct** governed Roles. All 47 cert employees had `currentRoleAssignmentExists: false` beforehand |
| **Sandbox capacity table** | `docs/governance/capacity-report.json`, generated by `capacityReport.mjs` from `buildWorkforce()` | **47 employees — ALL SYNTHETIC.** The generator's own header: *"ALL IDENTITIES ARE SYNTHETIC. No real Taylor, Ventana, Phoenix-business or public-directory PII."* Ids are `cw-emp-000`. `activation-readiness.md:199` names it in terms: *"**This is sandbox fixture staffing, not hiring advice.**"* — and that document opens *"Nothing in this document has been executed."* |

**The two production managers, in exactly the state that proves JOB ROLE ≠ SECURITY ROLE:**

| `employeeId` | `managerOperationalRoles` | `governedRoleId` | `state` | `scopes` | `assignedWarehouseComparison` |
|---|---|---|---|---|---|
| `emp-rudy-parts-manager` | `["PARTS_MANAGER"]` | `partsManager` | **`OPERATIONAL_ROLE_ONLY`** | `[]` | `BOTH_EMPTY` |
| `emp-rudy-warehouse-manager` | `["WAREHOUSE_MANAGER"]` | `warehouseManager` | **`OPERATIONAL_ROLE_ONLY`** | `[]` | `BOTH_EMPTY` |

`OPERATIONAL_ROLE_ONLY` is set by the census script **precisely when a principal holds zero matching
governed `roleAssignments`**. **The job role exists. The security role does not.**
(EMP-EXPERIENCE §2.3)

**In the synthetic roster, 30 of 45 governed Roles are occupied and 15 are not.** The four unoccupied
ones that matter most (EMP-PERFORMANCE §3.6):

| Unoccupied Role | Why it matters |
|---|---|
| **`performanceGoalSubject`** — **0 holders** | Its entire purpose is to let a measured person read their own target. **Nobody holds it, even in the sandbox** |
| **`technicianLaborRecorder`** | Unoccupied **and** inert (its capability is dead in every environment) |
| **`workOrderLaborCorrector`** | Unoccupied **and** inert — **so even the correction path for labour has no holder** |
| **`controller`** | An actor on `WF-SVC-016` (the technician scorecard workflow) and on **20** workflows overall — **zero holders even in the synthetic roster** |

Also unoccupied: `generalEmployee`, `marketingManager`, `shopManager`, `shopAssociate`,
`inventoryCreateExecutor`, `workOrderPartsPlanner`, `inventoryStockRelocationOperator`,
`inventoryTransferReceiver`, `equipmentCatalogAdministrator`, `emailIntakeAdministrator`,
`serviceInboundWorkReviewer`.

### 6.1 Two role-naming facts that break naive per-role metrics and queues

1. **There is no governed business Role named `technician`.** It is a *compatibility* Role, and the
   technician surface **routes on `role === "technician"` — a role string, not a capability.**
2. **There is no governed Role named `dispatcher` or `serviceCoordinator` either.** The nearest
   governed Role is `officeManager`, described as *"Office/customer/service coordination"*.
   (EMP-PERFORMANCE OD-EMP-019)

### 6.2 One stale claim that must NOT be carried forward

`docs/governance/effective-authority.md:97-101` heads a section *"### 1. Reporting — 39 capabilities,
nobody holds them (LARGEST OPEN GAP)"* and states *"Reporting is unreachable for every persona."*
**That document is dated 2026-08-21 and tabulates only 20 Roles — stale against 45.** At this baseline
`reportViewer` (7), `reportFinanceViewer` (3) and `reportAuthor` (4) all have holders in the synthetic
roster. **The claim is stale; do not cite it.** (EMP-PERFORMANCE §3.6)

---

## 7. Persona / role conflicts — carried, not fixed

**Three, not two** — the brief names the first two. **Both readings preserved in every case.**
Conflicts **R-1 · R-2 · R-3**.

| Persona | Reading A | Reading B | Kind |
|---|---|---|---|
| **Marisol Vega** | B1 `service_coordinator` (68 per EMP-ROLE §5/§6.1; **49** per its own §8) | B2 `Parts Manager` (65) | **cross-library contradiction** — brief named it. **Note the internal 68-vs-49 discrepancy inside EMP-ROLE, recorded not reconciled** |
| **Priya Raman** | B1 `service_manager` (60) | B2 `Operations Manager` (17) | **cross-library contradiction** — brief named it. **Not merely a label clash: `service_manager` → `fieldManager` (under `operationsManager`) while `Operations Manager` → `operationsManager` itself. The two readings place the same person ONE LEVEL APART ON THE SAME BRANCH — a manager and her own manager** |
| **Luis Mendoza** | B2 `Stocker/scanner operator` (28) | B2 `Stocker` (4) | **intra-library inconsistency — NOT in the brief** |

**Both activity libraries record the first two as known-and-not-fixed in their own
`corrections.recordedNotFixed.personaIdentityCollision` blocks.** **B1 is internally consistent** — its
persona block declares 12 personas, the derived activity set uses exactly those 12, and `counts.byRole`
reproduces the derived counts exactly. **B3 has no `persona` field at all** — only `actor_role` — so B3
contributes no persona evidence and cannot be cross-checked.

---

## 8. Role profiles — what was written, and what was deliberately NOT

**EMP-ROLE declined per-role stubs and produced a COVERAGE MAP instead of eleven invented paragraphs
per role.** That judgement is respected: **`role-profiles/` contains profiles only where three lanes
independently supply substance**, and **no stub exists for any other role.**

**The admission test (all four must hold):**
1. ≥ 30 corpus activities (a real body of observed work);
2. a full 13-facet work block in **EMP-WORK** §2;
3. a full 11-dimension information row-set in **EMP-INFORMATION** §7;
4. a named, non-empty experience requirement set in **EMP-EXPERIENCE** §4.

**Seven roles pass and have profiles:** `field-technician` · `dispatcher` · `service-coordinator` ·
`parts-manager` · `parts-floor` · `inventory-control-analyst` · `controller`.

**Declined, with the reason stated** (this is the respect for EMP-ROLE's judgement, not an omission):

| Role | Why no profile |
|---|---|
| Service Manager / Field Manager (69) | Fails test 2 — EMP-WORK folds it into a 136-activity OPS/SERVICE MANAGEMENT block spanning five labels, so no per-role facet set exists. And **R-6** is unresolved: the Role is `fieldManager`, the label is Service Manager, the `operationalRoles` value has no consumer |
| Service Billing Admin (18) · Office Manager (18) | Below the activity floor, and **0 of 5 finishable workflows** — a profile would describe an empty implementation |
| Salesperson (43) · Sales Manager (52) · Marketing Manager (2) | **THIN EVIDENCE by construction**: all P3-B3, which carries **no device, no coverage, no friction, no exception/recovery and no operating-company field.** A profile would present measurement silence as a finding. And **R-7** is unresolved |
| Administrator / System Admin (128) | **F-11: the role boundary itself is OWNER DECISION REQUIRED.** A profile would silently pick one of three answers |
| Apprentice Technician (9) · After-hours Coordinator (5) · Satellite Attendant (7) · Branch Parts Coordinator (12) · Purchasing Admin (8) · Parts Counter (5) · Receiving Lead (19) · Stocker (32) | Below the floor, or folded into a parent job by at least one lane and held apart by another (**R-3**, **R-5**). Their evidence lives in the parent profile and in `EMPLOYEE-WORK-MATRIX.md` |
| General Manager (14) · Owner (10) · Operations Manager (43) · Accounting Manager (36) · Purchasing Manager (2) · Warehouse Manager (5) · Report Viewer (1) | Below the floor, or **0% finishable** (GM), or **not a job role at all** (Report Viewer — a grant) |

---

## 9. Where the role model is blocked, and by what

| Blocker | Nature | Decision |
|---|---|---|
| **No authoritative job-role vocabulary, and no mapping to the 48 security Roles** | **MODEL GAP.** Five vocabularies, a sixth in the corpus, 51% of authored work naming no Role | `OD-1` |
| **Production occupancy is zero** | **PROVISIONING GAP — the only gap a GRANT rather than a design would close** | `OD-2` |
| **Occupancy and vocabulary are INDEPENDENT prerequisites** | Grant every Role tomorrow and a role-shaped queue becomes **non-empty and keyed on the wrong thing** | both |
| **13 corpus roles / 290 activities have no security Role** | Either the model is short 13 roles or the corpus invented 13 actors | `OD-3` |
| **Retail vs National Accounts is blocked on a DEFERRED MODEL, not on missing evidence** | The coverage/territory model is *"built, registered, reachable by nobody"* — `coverage.write`/`coverage.read` are `active:false`, absent from every override array, storage deny-all (`firestore.rules:1832-1837`). The Owner instructed *"record and preserve the seams, do NOT build during the runway."* **A SCHEDULING COLLISION for the Owner, not an evidence gap** | `OD-20` |
| **A second Sales Manager cannot be distinguished from the first** | `roleHierarchy.ts:16` records that it cannot: *"With role-only hierarchy, EVERY salesManager sees EVERY salesperson… diverges the moment a second is appointed"* | `OD-6b` |
| **Proficiency / certification wholly unmodelled** | *"Nothing warns."* No outside channel holds it either | `OD-12` |
| **No approval-limit or discount-authority model** | `governedBusinessRoles.ts:387-390`: *"a Salesperson may bind the same terms a General Manager can. That is a real governance gap to close deliberately."* Corpus `P3B3-ADV-033` exercises it | `OD-30` |
