# EMP-EXPERIENCE — Employee Experience Requirements

**LANE:** EMP-EXPERIENCE · **MODE:** EVIDENCE_WRITE
**BASELINE:** `64008d5ae0bdd9532909671b15a91122400accf1` (= `ATLAS-BASE-2026-09-12-A`)
**OBSERVED AT: 64008d5a** — every derived fact in this document was measured or read at that commit.

## What this document is, and is not

**Is.** A register of **experience requirements** — what EOS must be able to *do for a person* doing a
real job, expressed per role, with the trigger, what EOS must already know, and whether EOS can know
it at this baseline.

**Is not.** Not UI design. **No screen, layout, composition, wireframe or mockup is specified here, and
none should be inferred.** Where this document says "the queue must distinguish X from Y" it is stating
an information requirement, not a component. Not an Atlas artifact — this lane is **upstream of**
Atlas, not part of it. Not a canonical artifact — only EMP-OWN-SYNTHESIZER writes those.

---

## 0. Method, evidence, and the caveats measured rather than inherited

### 0.1 Evidence actually read at this baseline

| Source | Path (read-only) | What it gave this lane |
|---|---|---|
| P3-B1 activity library | `p3b1-act-service/docs/scenarios/day-in-the-life/service-technician.json` | 330 activities · 33 stories · 12 personas · 8 roles · device + coverage + friction + AI fields |
| P3-B2 activity library | `p3b2-act-inventory/docs/scenarios/day-in-the-life/inventory-warehouse-purchasing.json` | 330 activities · 33 stories · 13 roles · device + coverage + friction + AI fields · three-gate authority model |
| P3-B3 activity library | `p3b3-act-sales/docs/activities/p3b3-{sales,crm,financial,management,administration,adversarial}-activities.json` | 350 activities · 18 roles · **thin schema** (see 0.3) |
| Service archaeology | `p3a1-arch-service/docs/design/archaeology/service-scheduling-technician-equipment.md` | §5 never-implemented (12) · §7 missing-workflow (12) · §8 UNPROVEN |
| Inventory archaeology | `p3a2-arch-inventory/docs/design/archaeology/inventory-warehouse-purchasing-scanner.md` | Part 8 never-implemented (10) · Part 11 inert-capability surfaces (13 rows) · Part 12 missing-workflow (15) |
| Sales archaeology | `p3a3-arch-sales/docs/design/archaeology/sales-crm-financials-reporting-administration.md` | §8.1 never-implemented (10) · §8.3 missing-workflow (12) · §6.3 dashboard composition authority |
| Design P2 master brief (**INPUT only**) | `p3c-design-brief/docs/design/eos-design-p2-master-brief.md` | §1 measured condition · §5 what is unknown · §6 the seven measurement traps |
| This worktree | `/home/rudy2/.local/share/eos-worktrees/emp-exp` @ `64008d5a` | `VITE_EOS_API_BASE_URL` trace · 147 catalog ids · `roleAssignments` read sites |

### 0.2 Corpus arithmetic, re-measured by this lane

Normalised all three libraries into one 1,010-row table and counted.

| Measure | Value | Note |
|---|---:|---|
| Corpus records | 1,010 | matches the libraries' own `corpusRecords` |
| Distinct record **ids** | **1,010** | all ids unique — the "1,009 distinct" figure is by **title**, not id |
| Duplicate title | 1 | *"Attribute an operational record to the company that performed the work"* appears twice (`P3B3-MGMT-018`, `P3B3-ADV-…`) |
| Executed | 42 | all in P3-B3: **22 `EXECUTED_PASS` · 20 `EXECUTED_FAIL`** |
| Not executed | 968 | of which **660** carry the literal `NOT_RUN` token (P3-B1 330 + P3-B2 330) |
| P3-B3 unexecuted statuses | 308 | `IMPLEMENTED_UNEXECUTED` 141 · `PARTIAL` 68 · `BLOCKED` 64 · `NOT_SUPPORTED` 26 · `DESIGNED_ONLY` 9 — **never `NOT_RUN`** |
| Distinct role labels | 34 | normalised to **15 role families** for this document |
| Operating company present | 660 of 1,010 | `taylor` 599 · `ventana` 61 · **absent on all 350 P3-B3 rows** |

**The 42 executions prove authority resolution, never workflow completion.** Master brief §6.6:
*"all 42 are capability resolutions — which prove who may do a thing and never that the thing
completes."* No requirement in this document may cite an execution as proof that a person can finish a
job.

### 0.3 The asymmetry this lane's brief did not state

The brief describes the corpus as carrying device context, coverage categories, exception/recovery
behaviour and AI-opportunity fields **per activity**. That is true of **660 of 1,010 rows only.**

| Field | P3-B1 (330) | P3-B2 (330) | P3-B3 (350) |
|---|---|---|---|
| `deviceContext` / `device` | yes (DESKTOP/MOBILE) | yes (DESKTOP/MOBILE/**HANDHELD_SCANNER**) | **absent** |
| `coverageCategories` | yes (20 values) | yes (24 values incl. split RETRY/IDEMPOTENCY) | **absent** |
| `exceptionRecoveryBehaviour` | yes | yes | **absent** |
| `aiOpportunityClassification` | yes (6 values) | yes (5 **different** values) | **absent** |
| friction score block | yes (`frictionScore`, camelCase) | yes (`scores`, snake_case) | **absent** |
| operating company | yes | yes | **absent by construction** |

**Consequence, stated as a limit on this document.** Salesperson, Sales Manager, Marketing Manager and
Warehouse Manager appear **only** in P3-B3. Their experience requirements therefore rest on trigger and
narrative prose with **no device evidence, no friction evidence, no exception/recovery evidence and no
operating-company evidence at all.** Every such requirement below is marked **THIN EVIDENCE**. This is
the same population the master brief reports as commercially dead in production — so the roles whose
experience is least evidenced are the roles whose capability set is most switched off. That coincidence
is not a coincidence; it is the same absence measured twice.

`HANDHELD_SCANNER` is a real third device class carrying **69 activities**, and it exists in **one
library only**. P3-B1's technicians are `MOBILE`-only even where they scan.

### 0.4 The friction instrument — the strongest signal in the corpus, and this lane's spine

Both story-based libraries score every activity against the same eleven booleans (two naming
conventions, one meaning). Canonicalised and counted over **N = 660**:

| Flag (canonical) | Count | Share of 660 | What it is evidence of |
|---|---:|---:|---|
| `NO_NEXT` — no obvious "what next" location | **261** | 40% | The single largest experience defect in EOS. Forty per cent of modelled work ends without telling the person what to do next. |
| `NO_WHY` — no obvious "why" location | **216** | 33% | A third of work gives no in-place account of why the state is what it is. |
| `RECOVERY_UNCLEAR` | **195** | 30% | Recovery from the failure the activity models is not discoverable. |
| `HUNT` — user had to hunt for necessary information | **182** | 28% | The literal defect the organising rule names. |
| `OWNERSHIP_UNCLEAR` | **166** | 25% | A quarter of work cannot answer "whose is this?" |
| `HANDOFF_UNCLEAR` | **90** | 14% | Role-to-role transfer is unclear. |
| `HELP_MISSING` | **85** | 13% | Help absent at the moment it was needed. |
| `OC_UNCLEAR` — operating-company attribution unclear | **81** | 12% | And 81 of the 660 is a floor, not a ceiling — see 0.3. |
| `AI_SHORTEN` — AI could materially shorten | **37** | 6% | |
| `AI_NOISE` — AI would be noise | **8** | 1% | Under-counts; the categorical `aiOpportunity` field is the better instrument (§9). |
| `NOISE_PAGE` — unnecessary explanation permanently occupied the page | **4** | 1% | Over-explaining is **not** an EOS problem. Under-explaining is. |

**Read the top four together.** `NO_NEXT` (40%), `NO_WHY` (33%), `RECOVERY_UNCLEAR` (30%) and `HUNT`
(28%) are not four defects. They are one: **EOS shows state and withholds consequence.** Every
experience requirement in §5 is, at bottom, a demand that a state be accompanied by its why, its next
move, and its recovery.

**And read `NOISE_PAGE` = 4/660 as a design instruction.** The corpus authors were asked whether
explanation was in the way, and in 656 of 660 cases it was not. Nothing in this evidence supports
stripping explanation to make surfaces cleaner.

### 0.5 The happy path is the minority case

Counting the exception family (`EXCEPTION`, `MISTAKE`, `RECOVERY`, `BAD_DATA`, `MISSING_DATA`,
`DUPLICATE_DATA`, `PERMISSION_DENIAL`, `NETWORK_INTERRUPTION`) over the 660 scored rows:

| Device | Touch an exception-family category | Share |
|---|---|---:|
| DESKTOP (442) | 296 | 67% |
| MOBILE (149) | 96 | 64% |
| HANDHELD_SCANNER (69) | 55 | **80%** |
| **All 660** | **447** | **68%** |

Only **213 of 660** activities touch no exception category at all. An experience designed around the
213 is designed around a third of the work. **The handheld is the most exception-dense surface in EOS
and has the least screen to spend on it.**

---

## 1. The organising rule, applied

> **Do not force real work into current module boundaries.** If a real job crosses Service, Customer,
> Equipment, Inventory, Purchasing and Financials, design the experience around the work.

### 1.1 Seven real jobs in the corpus, each crossing modules, none owned by a module

Each row is a **single job one person is trying to finish**, with the modules it must touch and the
module boundary that currently breaks it.

| # | The job, as the person would say it | Modules it crosses | Where the module boundary breaks it | Evidence |
|---|---|---|---|---|
| J1 | *"This machine keeps failing — should we keep fixing it or sell them a new one?"* | Equipment · Service (history) · Inventory (parts spend) · Financials (repair vs replacement cost) · Sales (Opportunity) | **No equipment↔opportunity relationship exists in any entity definition**, and repair economics (repairs-12mo, repair spend vs replacement cost) was deferred and never built | P3-A1 §5 items 4–5 |
| J2 | *"I'm standing in front of the machine — what happened to it last time, and what parts will I need?"* | Service (WO history) · Equipment (serial, model) · Inventory (parts on my truck) | Service history may be on a page the technician cannot open → *"he phones the office"*; the truck is not offered as a parts source until a seven-record join resolves | `P3B1-S03-A04`, `P3B1-S12-A05`, `P3B1-S09-A03` |
| J3 | *"One customer, four machines, one trip."* | Service · Customer · Equipment · Scheduling · Fulfilment | Both coordinated surfaces are **read-only over a projection awaiting grants/deploys** — *"No command on either coordinated surface"* | P3-A1 §7 item 6; `P3B3-MGMT-048` (BLOCKED) |
| J4 | *"Get this part on order tonight so I don't lose tomorrow morning."* | Service (the WO that needs it) · Inventory (balance) · Purchasing (reorder → PO) · Financials (spend) | The reorder chain runs — and **the Parts Manager who raises the request cannot approve, reject or cancel one**; only an administrator or dispatcher can | Master brief §1.5; corpus `S03-A05`, `S07-A04` |
| J5 | *"Bill this repair visit."* | Service (completed WO) · Customer · Inventory (parts consumed) · Financials (invoice) | *"The billing queue anchors on a Sales Order; a repair call has none"*; `billingQueue.ts` has **zero importers** — *"written and connected to neither end"* | Master brief §1.4 `WF-FIN-002`; P3-A3 §8.3 item 9 |
| J6 | *"Four drive belts crossed the company line."* | Inventory · Warehouse · Operating Company · Financials (title transfer) | The model *"has no owner dimension at all"*; allocation is built with **no operating-company predicate** (`grep -n operatingCompany` over four allocation files returns **zero hits**) | P3-A2 Part 8 item 5, Part 10 |
| J7 | *"A manufacturer safety notice — find every affected machine in the field."* | Equipment · Customer · Location · Service | One story, ten activities, and no cross-module population read; the coordinator reconstructs it | `P3B1-S31` (story: *"A manufacturer safety notice — finding every affected machine in the field"*) |

**The rule this produces.** None of J1–J7 is a Service job, an Inventory job or a Finance job. Every
one is *a job*. **An experience organised by module cannot express any of the seven.** That is the
finding, and it is measured, not asserted.

### 1.2 The three questions, answered once for the whole system

**What should EOS already know?** At this baseline, the honest answer is: **less than any of these jobs
requires, and it usually knows the fact and cannot deliver it to the browser.** The pattern recurs
across all three domains — the authority exists in one place and the surface asks in another
(master brief §2: *"the site that **declares** the requirement and the site that **asks** for the
answer are different files with nothing linking them"*).

**What should EOS bring to the employee?** The corpus answers this negatively and precisely: in **261 of
660** scored activities there is **no obvious "what next" location**. The primary thing EOS must bring
is not data. It is **the next move, the reason, and the recovery** — attached to the state, at the
moment the state is shown.

**What should the employee never have to hunt through six modules to discover?** Measured, the four
recurring hunts are:

| The hunt | Roles that do it most | Why it is a hunt today |
|---|---|---|
| **"Whose is this right now?"** | service_manager (24) · service_coordinator (19) · Parts Manager (14) · Branch Parts Coordinator (11 of 11) | 166 of 660 flagged `OWNERSHIP_UNCLEAR`. Approval assigns a record to a **Role**, and a second act assigns it to a **person** — and nothing on screen says which state it is in |
| **"Which company did this?"** | service_coordinator (12) · Branch Parts Coordinator (12 of 12) · Controller (7) | **No Work Order carries `operatingCompanyId`** — *"the grouping she actually manages by does not exist on the record"* |
| **"What happened to this since I last looked?"** | dispatcher · service_manager · Operations Manager | The dispatcher activity feed is **session-only**: *"the incoming dispatcher's feed is empty. There is no shift-note or handover surface"* |
| **"Who can do the thing I am refused?"** | field_technician (11) · Stocker/scanner (6) · System Admin (6) | 69 of 660 are `PERMISSION_DENIAL` and the recovery is repeatedly *"find someone"* with no named target — *"the escalation target must be stated"* |

---

## 2. The nine concepts — how EOS represents each at this baseline

A queue keyed on the wrong one shows the wrong person's work. Measured at `64008d5a`.

| # | Concept | Is it represented distinctly? | The representation | Verdict |
|---|---|---|---|---|
| 1 | **RECORD OWNER** | **Yes — and under four different field names** | `OWNERSHIP_MATRIX` (`functions/src/ownership/ownershipMatrix.ts`) with per-family `ownerFields[]`. The actual stored names are **heterogeneous**: `accounts.accountOwner` (an object containing `assignedToEmployeeId`, `typedOwner.ts:101`) · `contacts.owner` · `locations.owner` · `opportunities`/`salesOrders`/`salesAgreements`.`ownerEmployeeId` (`typedOwner.ts:111-114`). Owner **type** is `USER` \| `COMPANY` (`typedOwner.ts:12`); owner **class** is `PERSON` \| `COMPANY` \| `PARTICIPATING_COMPANIES` \| `REFERENCE` \| `EXCLUDED`. Resolved at creation by a dedicated module (ruling D-4); auditable handoff command exists (ruling D-5) | **PARTIAL.** The concept is distinct and governed; there is **no single field to key "my owned relationships" on**. The handoff command *"has no onCall export, so the command has no caller"*. The owning spec is still **Draft** (`docs/specifications/record-ownership.md`, 2026-08-19) and names its own defect: `createSalesOrderFromOpportunity.ts:232` takes `ownerEmployeeId` **caller-supplied**, validated only as a non-empty string, never checked against the authenticated actor |
| 2 | **ACCOUNTABLE PERSON** | **No — collapsed into RECORD OWNER** | No `accountablePersonId` / `accountableEmployeeId` field exists anywhere; zero hits for `accountable` in `functions/src/ownership/*.ts` or `docs/specifications/record-ownership.md`. The matrix's framing is that *"business responsibility belongs to an employee"* (`ownershipMatrix.ts:22`) — accountability **is** ownership. The only accountability-shaped construct is role-keyed: reorder approval moves a request to `READY_FOR_PARTS_MANAGER` — *"it assigns ownership to PARTS_MANAGER, **not to a person**"* | **MODEL GAP.** Two different things wear one field: the person who owns the record, and the person answerable for the outcome. Accountability is otherwise expressible only as a *role-shaped state* with no person in it until a separate assignment act |
| 3 | **ASSIGNEE / EXECUTOR** | **Yes — deliberately walled off from ownership, and with no canonical field name** | `assignedTechId` / `technicianId` (Work Order, scheduling) · `assignedToEmployeeId` (inside `accountOwner`, and `crm/customerMigrationSource.ts`) · `ASSIGNED_TO_PARTS_ASSOCIATE` + assignee (Reorder Request). `ownershipMatrix.ts:227,259` **forbids** deriving owner from assignee: *"Never from the technician, dispatcher, creator, assignedTo, customer owner… those are who DOES the work"* | **PARTIAL.** The separation from ownership is correct and explicit — a genuine asset. There is **no uniform `assigneeId`**, so a cross-domain "my assigned work" queue must be assembled per domain; and *"there is no reassignment branch in Rules"* once a record is past a stage |
| 4 | **MANAGER** | **Yes — and twice, unreconciled** | (a) `managerEmployeeId`, `kind: "MANAGER"` (`access/employeeProfileCommands.ts:214`, self-reference rejected `:534-538`; `domain/employeeProfile.js:84`; `metadata/definitions/employee.js:225`). (b) **role parentage** in `roleHierarchy.ts:9-11`, which is what `hierarchicalVisibility.ts` actually resolves from — the file states the tree lives with the Role definitions *"rather than as a `reportsTo` field… the Owner named `reportsTo` on the employee as a NICE TO HAVE"* | **MODEL GAP, and the sharpest one in this table.** `performanceMetricRegistry.ts:105`: ***"NO TEAM ENTITY EXISTS. There is no `teams` collection and no `reportsTo` edge on the employee record… with role-only hierarchy EVERY salesManager sees EVERY salesperson."*** So the field that names a person's manager governs nothing, and the mechanism that governs visibility cannot express a team. `P3B3-MGMT-040` confirms the split is deliberate: *"scope answers which targets an assignment reaches, hierarchy answers which people a manager's role resolves to"* |
| 5 | **ESCALATION OWNER** | **No — no representation of any kind** | No `escalationOwner`, `escalationPath` or `approverRole` field exists. Every repo hit for *escalation* is either the security sense (`governedBusinessRoles.ts:641,655` "self-escalation path") or UI prose declaring the policy **unconfigured**: four Financials surfaces (`FinancialsCreditsAdjustments.jsx:57`, `FinancialsInvoiceDetail.jsx:230`, `FinancialsPaymentDetail.jsx:202`, `FinancialsGovernance.jsx:162`) each state *"FIN-007 approval policy — thresholds, approver roles, dual-control, escalation, expiry — is not configured."* The corpus demands it repeatedly: *"If refused, Ray has no self-service path. **Escalation target must be stated**"* | **MODEL GAP.** `MY ESCALATIONS` as a bucket **cannot be built at this baseline** — there is nothing to key it on |
| 6 | **OPERATING COMPANY** | **Yes on the commercial axis — absent on the operational axis** | `operatingCompanyId`, with its own authority module (`functions/src/ownership/operatingCompanyAuthority.ts`, client mirror `domain/operatingCompanyAuthority.js`, Owner ruling D-2), its own matrix column `companyScopeField`, its own `CompanyScope` enum (`SINGLE_COMPANY` \| `CROSS_COMPANY_CAPABLE` \| `COMPANY_NEUTRAL`), an employee field, a warehouse field, an access-scope kind and a seed. `ownershipMatrix.ts:85-93` warns explicitly: *"`ownerEmployeeId = Rudy`, `operatingCompanyId = taylor` are two true, independent facts."* **But**: absent from Work Order; **optional** on legacy warehouses; and **zero** operating-company predicate in any allocation path | **PARTIAL / MODEL GAP.** The model is one of the strongest in EOS **and it is not in the operational path** — *"operational records carry no governed company provenance and the ownership model that would supply it is inert"* |
| 7 | **DOMAIN STEWARD** | **No — does not exist** | Repo-wide case-insensitive search for `steward` returns **two** hits, and neither is a representation: `inboundWork/inboundCandidateResolution.ts:6` (*"no stewardship here on purpose"*) and `docs/implementation-plans/equipment-compatibility-d4-trusted-persistence.md:189` (*"**D4 creates no roles and grants nothing.** Dedicated verifier, corrector, model-steward, and importer…"* — named as not built). Service quality is *"assigned to a Service Operations domain authority that does not exist"*; the eight inventory recommenders have owners in a spec and nowhere else | **MODEL GAP.** No collection, no field, no matrix column, no role id |
| 8 | **SECURITY ROLE** | **Yes — and the count is 48, not 45** | **45** governed business Roles (`governedBusinessRoles.ts:1683-1727`) **plus 3** compatibility roles (`admin`, `dispatcher`, `technician`, `compatibilityRoles.ts:350`). The Employee's own `securityRole` field (`metadata/definitions/employee.js:299`) is a **read-only mirror** of `users/{uid}.role`, absent from `EDITABLE_FIELDS`, and `updateEmployeeProfile` *"REFUSES BY NAME `securityRole`/`role`"* — the authority is the `roleAssignments/{id}` document (`roleId`, `principalUid`, `status`, `scope`) | **AVAILABLE as capacity.** `roleAssignments` is read per request at 15+ sites as the sole source of an ALLOW. **Occupancy is a separate question and it is measured — see §2.3** |
| 9 | **JOB ROLE** | **No — five disjoint vocabularies, no mapping** | see 2.1 | **MODEL GAP — the most experience-blocking of the nine** |

### 2.1 JOB ROLE: five vocabularies, and the measurement that makes it a blocker

| Vocabulary | Where | Size | Who consumes it |
|---|---|---:|---|
| `jobTitle` | `employeeProfile.js:83` — `kind: "TEXT"` | unbounded | **free text.** Nothing |
| `operationalRoles[]` | write vocabulary `VALID_OPERATIONAL_ROLES` in `functions/scripts/provisionEmployeeAccess.js` (the **sole writer** of the collection); mirrored `employeeVocabulary.js:67` | **8** | **3** gate a real check (`firestore.rules` `isActiveOperationalRole()`); **5 have no consumer anywhere** — TECHNICIAN, WAREHOUSE_ASSOCIATE, SERVICE_MANAGER, SALES_MANAGER, SALES_ASSOCIATE |
| `employees/{id}.securityRole` | denormalised **read-only mirror** of `users/{uid}.role` | 3 | display |
| `users/{uid}.role` | legacy role string | 3 | *"the role that actually decides what a user can see"* — `P3B1-S09-A09`: *"A user with the right capabilities and the wrong legacy role sees the wrong app"* |
| 45 governed business Roles | `roleAssignments` | 45 | the authority model |

**And the corpus speaks a sixth.** This lane mapped all 1,010 activities' role labels against the
access model by normalised name:

| Authored under a role label that… | Activities | Share |
|---|---:|---:|
| matches a **governed business Role** | 392 | 39% |
| matches a **compatibility role only** (`dispatcher`, `technician`) | 101 | 10% |
| **matches no role in the access model at all** | **517** | **51%** |

The 517 includes **the two largest populations in the corpus**: `field_technician` (130 with
`Field Technician`) and `service_coordinator` (68), plus `Administrator`/`System Admin` (110),
`service_manager` (60), `Inventory Control Analyst` (34), `Stocker/scanner operator` (28),
`Receiving Lead` (19), `service_billing_admin` (18), `Branch Parts Coordinator` (12),
`Satellite Attendant` (7), `parts_counter` (5), `after_hours_coordinator` (5).

Conversely, **29 of the 45 governed Roles have no corpus role label at all** — every
`inventory*`/`equipment*`/`report*`/`workOrderLabor*`/`emailIntake*`/`serviceInboundWork*` Role, plus
`shopManager`, `shopAssociate`, `supportStaff`, `warehouseAssociate`, `generalEmployee`,
`crmActivityContributor`, `performanceGoalSubject`.

**The consequence, stated as an experience requirement.** *There is no authoritative role on which to
key a role-shaped queue.* The authority model is written in **capability-bundle** language
(`inventoryPutAwayOperator`) and the work is written in **job** language (`Receiving Lead`), and
**nothing maps them.** Every requirement below that says "the queue is keyed on Role" is therefore
conditional on a job-role↔Role mapping that **does not exist at this baseline** →
**`OD-EMP-001`**.

### 2.2 Two further conflations measured by sibling lane EMP-ROLE and corroborated here

- **Proficiency / certification is wholly unmodelled.** `P3B1-S17-A06` — a technician completing work
  requiring a certification he does not hold — records the expected result as **"Nothing warns."**
  Every "should EOS bring me the right work" requirement that implies competence is therefore
  **MISSING**.
- **Sales channel is a property of the deal, not of the person.** `SALES_CHANNELS =
  ["NATIONAL_ACCOUNTS", "RETAIL", "STRATEGIC_ACCOUNTS"]` (`salesOrder/salesOrderLifecycle.ts:18`,
  `opportunity/opportunityLifecycle.ts:27`); `roleHierarchy.ts:139` states it explicitly: channel is
  *"a property of the DEAL … not of the Role."* **Three** ratified channels, not two. A
  channel-shaped salesperson queue must be keyed on the deal, never on the person → affects §5.11.

### 2.3 Role occupancy is **not** unknown — it is measured, and it is zero

**This corrects this lane's brief.** The brief states *"Governed-role occupancy is unknown … no lane has
established whether any human holds any of them."* A committed, read-only **production** census exists
at this baseline.

`docs/assessments/r32-production-exposure-census.json` — tracked at `64008d5a`, landed by
`be1e5579` *"docs(access): R-32 production exposure census — zero exposed principals (#1752)"*,
`measuredAt: 2026-09-02T23:29:21.418Z`, `readOnly`, `writesPerformed: 0`, produced by
`functions/scripts/r32ProductionExposureCensus.js`.

| Measured in the production project | Value |
|---|---:|
| `roleAssignments` documents, **total** | **2** |
| `users` | 16 |
| `employees` | 6 |
| `warehouses` | 2 |
| Principals with **any** active assignment | **1** |
| That principal's assignments | `["admin@global"]` — the **compatibility** `admin` role |
| That principal's `employeeId` | **`null`** — anomaly `PRINCIPAL_HAS_NO_EMPLOYEE_LINK` |
| Humans holding **any** of the 45 **governed business** Roles | **0** |
| `primaryExposure.uniqueExposedPrincipals` | **0** |
| `capabilityMatrix` | `[]` |

And the two employees who *do* carry a job role are recorded in exactly the state that proves the
split in §2.1:

| `employeeId` | `managerOperationalRoles` | `governedRoleId` | `state` | `scopes` | `assignedWarehouseComparison` |
|---|---|---|---|---|---|
| `emp-rudy-parts-manager` | `["PARTS_MANAGER"]` | `partsManager` | **`OPERATIONAL_ROLE_ONLY`** | `[]` | `BOTH_EMPTY` |
| `emp-rudy-warehouse-manager` | `["WAREHOUSE_MANAGER"]` | `warehouseManager` | **`OPERATIONAL_ROLE_ONLY`** | `[]` | `BOTH_EMPTY` |

`OPERATIONAL_ROLE_ONLY` is set by the census script precisely when a principal holds **zero** matching
governed `roleAssignments`. **The job role exists. The security role does not.** That is the JOB
ROLE ↔ SECURITY ROLE gap of §2.1, measured in production data rather than argued from source.

**The experience consequence, and it is the hardest constraint in this document.**

> **Every role-shaped queue in EOS is empty in production today.** Not "might be empty" — measured
> empty. `MY ACCOUNTABILITIES`, `MY APPROVALS` and `MY TEAM` all key on a governed Role, and **no
> human holds one.** The reorder request that lands in `READY_FOR_PARTS_MANAGER` lands in a queue
> **nobody can open**, because the one active principal in production holds `admin@global` and is not
> linked to an employee.

This does **not** retire the brief's concern; it sharpens it into three separate facts that must not be
merged:

| Fact | Status | Bearing on an experience requirement |
|---|---|---|
| The 45 Roles are **assignable** (all appear in `ASSIGNABLE_ROLES`) | **AVAILABLE NOW** | Capacity is real |
| **0** humans hold any of them in production (2026-09-02) | **MEASURED** | Every role-keyed queue is empty until someone is granted |
| **29 of 45** Roles have no corpus job label, and **51%** of authored work names no Role at all | **MEASURED** (§2.1) | Even after granting, there is no mapping from the job to the Role |

**UNKNOWN — REVERIFY:** the census is a 2026-09-02 snapshot and this baseline is 2026-09-12. Occupancy
may have changed. No lane may re-measure it without production authorisation. → **`OD-EMP-002`**

---

## 3. "My Work" is six buckets, and they are keyed on six different things

**Do not produce one generic "My Work."** The evidence for keeping them apart is not stylistic; the six
buckets key on six of the nine concepts, and at this baseline **three of the six keys do not exist**.

### 3.1 The six buckets, their keys, and whether each can be built

| Bucket | Keyed on (concept #) | The key field, at this baseline | Buildable now? | When it matters |
|---|---|---|---|---|
| **MY OWNED RELATIONSHIPS** | RECORD OWNER (1) | four different field names — `accountOwner.assignedToEmployeeId`, `contacts.owner`, `locations.owner`, `ownerEmployeeId` | **PARTIAL** — no single key; a union query across four shapes | Continuously, for anyone who carries a book of accounts. This is a **standing** list, not a to-do list, and must never be merged with work |
| **MY ACCOUNTABILITIES** | ACCOUNTABLE PERSON (2) — **collapsed** | none. Nearest is a role-keyed state (`READY_FOR_PARTS_MANAGER`) | **MISSING (MODEL GAP)** + empty on occupancy | When something is *mine to see through* without being assigned to me — the case the corpus names as *"Marisol needs to know this is hers now"* |
| **MY ASSIGNED WORK** | ASSIGNEE / EXECUTOR (3) | `assignedTechId`/`technicianId`, `assignedToEmployeeId`, per-domain assignee | **PARTIAL** — per-domain assembly, no uniform field | The technician's and parts associate's whole day. This is the only bucket with a real, working key today |
| **MY APPROVALS** | SECURITY ROLE (8) + ACCOUNTABLE PERSON (2) | `roleAssignments` → capability | **AVAILABLE as capacity / EMPTY in production** | At the moment someone else is blocked waiting for me. **Separation of duties lives here** — `S27-A05`: *"A counter cannot approve their own material variance. This is a control, not a permissions problem"* |
| **MY ESCALATIONS** | ESCALATION OWNER (5) | **nothing exists** | **MISSING (MODEL GAP)** | When my own authority has run out. Cannot be built at all — §2 concept 5 |
| **MY TEAM / MANAGEMENT VIEW** | MANAGER (4) | two unreconciled answers: `managerEmployeeId` (governs nothing) and role parentage (*"EVERY salesManager sees EVERY salesperson"*) | **MISSING (MODEL GAP)** | Only for someone with people. See §6 — and it must be a **separate surface**, not a wider version of an individual's |

**The single most important line in this document:** of the six buckets, **one** (`MY ASSIGNED WORK`)
has a working key; **two** are partial and need a union across heterogeneous fields; **three** cannot be
built at all at this baseline. A design that ships one "My Work" list hides that distribution and
implies EOS can answer questions it cannot.

### 3.2 What each bucket contains, per role

`AVAILABLE NOW` / `PARTIAL` / `MISSING` / `UNKNOWN — REVERIFY` per cell. **`—`** means this role has no
legitimate content in that bucket. **`ROLE-EMPTY`** means the bucket's key resolves but returns nothing
in production per §2.3.

| Role family (corpus n) | MY OWNED RELATIONSHIPS | MY ACCOUNTABILITIES | MY ASSIGNED WORK | MY APPROVALS | MY ESCALATIONS | MY TEAM |
|---|---|---|---|---|---|---|
| **Field Technician** (143) | — (owns no records) | The jobs he accepted but has not finished, and the sync intents still queued — **PARTIAL**, the sync queue exists and *"whether anything escalates it is UNPROVEN"* | Today's dispatched + accepted Work Orders, in the order he will drive them — **PARTIAL**: assignment works, **route order does not exist** (`P3B1-S10-A10`) | — | The refusals he cannot self-serve: *"no verb for 'could not work'"*, a certification he lacks (*"Nothing warns"*), a part he cannot source — **MISSING** | — |
| **Dispatcher** (97) | — | The board for the day(s) she owns; jobs stuck in `DISPATCHED` past their age — **PARTIAL**, `dispatchedAt` makes age computable, *"whether any surface shows time-in-status is UNPROVEN"* | Placements she made that have not been accepted — **PARTIAL** | **Reorder approve/reject/cancel — which she holds and the Parts Manager does not** — `ROLE-EMPTY` | Technician gone sick with four jobs outstanding; no reassign verb — **MISSING** (*"In practice the dispatcher leaves them and phones the customers"*) | Her technicians' lanes — but see §6: this is capacity, not people management |
| **Service Coordinator** (73) | The accounts and sites she habitually handles — **MISSING**: no owner field on an inbound row, so *"the afternoon coordinator cannot tell a row nobody has looked at from one someone is actively chasing"* | The inbound queue rows she has decided vs not; customers she has promised a callback — **MISSING** | Work Orders she created that are not yet scheduled — **PARTIAL** | — | A cross-company mis-intake with *"no 'move this WO to the other company'"* — **MISSING** | — |
| **Service Manager / Field Manager** (69) | — | Service quality for her branch — **MISSING**: *"assigned to a Service Operations domain authority that does not exist"* | — (a manager's own assigned work is rare and must not dominate) | Goal approval (`P3B3-MGMT-016` BLOCKED) | Onboarding chain incomplete for a new starter — **MISSING**: *"seven records with no single view"* | **§6** |
| **Parts Manager** (79) | The catalog and reorder points she stewards — **MISSING** (no steward concept) | Requests in `READY_FOR_PARTS_MANAGER` — **the canonical accountability bucket**, and `ROLE-EMPTY`: she cannot approve what lands there | Requests assigned to her by name — **PARTIAL** | **None — and she should have them.** `reorder.request.approve/reject/cancel` reach no governed business Role | Capability inactive with no self-service path (`S26-A02`: *"the escalation target is Sam Ortega … and the screen must say so rather than leaving Tessa to guess"*) — **MISSING** | **§6** |
| **Parts floor** — Associate · Receiving Lead · Stocker/scanner · Satellite Attendant (100) | — | The receiving session or count sheet he opened and has not closed — **PARTIAL** | Scan tasks, put-aways, pick/stage requests — **PARTIAL**; *"Nothing produces a pick list"* | — | **The densest escalation need in the corpus.** `S01-A06`: a committed duplicate needs an `ADJUSTED` movement *"which requires authority Ray may not hold. That escalation must be discoverable from the line."* `S06-A05` is a *"genuine structural dead end"* — **MISSING** | — |
| **Inventory Control Analyst** (34) | The count sheets and variance lines she authored — **PARTIAL** | Open variances awaiting a second reviewer — **PARTIAL** | Sheets assigned to her — **PARTIAL** | **Cannot approve her own** — correct, and the screen must *"offer that as the next action, with the eligible reviewers named, or the recovery is a Slack message"* — **MISSING** (no eligible-reviewer resolver) | Inactive `cycleCount` capabilities — **MISSING** | — |
| **Service Billing Admin / Office Mgr / Accounting Mgr** (72) | — | Work Orders completed-but-not-closed — **PARTIAL**, and *"Two companies' revenue recognition runs off one unsegregated list"* | — | Invoice issue / credit approval — **MISSING** (`finance.invoice.issue` inactive; FIN-007 approval policy *"not configured"*) | A WO completed with no content: *"The technician is phoned and re-enters the information verbally"* — **MISSING** | — |
| **Controller / Finance Manager** (51) | — | The four month-end numbers; the books each entry lands in — **PARTIAL** | — | Period close, void, intercompany — **MISSING** (all `CANNOT_START`, three of them `OWNER_DECISION_PENDING`) | — | **§6** |
| **Salesperson** (43) **THIN EVIDENCE** | **The primary bucket for this role** — accounts, opportunities, agreements she owns (`ownerEmployeeId`) — **PARTIAL model / MISSING in production**: every `opportunity.*` id resolves DENY for all 48 roles under the production activation set | Agreements awaiting acceptance; orders requiring action — designed and **GATED** | — | — | An ownerless Account refuses Opportunity creation and *"the report field that would list them is inactive in every environment"* (`P3B3-MGMT-038`, **EXECUTED_FAIL**) — **MISSING** | — |
| **Sales Manager** (54) **THIN EVIDENCE** | Accounts he owns directly | Channel/territory coverage — **MISSING** (channel is a property of the deal, not the person) | — | Goal approval — **BLOCKED** | — | **§6**, and *"EVERY salesManager sees EVERY salesperson"* |
| **Operations Mgr / General Mgr / Owner** (68) | — | Cross-domain exception review — **PARTIAL** (see §6.2) | — | Access grants, ownership handoff — **PARTIAL** (handoff command has no caller) | — | **§6** |
| **Administrator / System Admin** (110) | — | Objects, roles and policy she governs — **PARTIAL**: *"`Employees` has no row in any of the four tables"* | Access requests — **MISSING** (no request object) | Role grant / revoke — `WF-ADM-002` **CAPABILITY_INACTIVE** | *"Sam is asked to just switch the capability on"* — the correct answer is refusal plus a pointer at the release process; **the screen does not say what `active:false` means** | — |
| **Branch Parts Coordinator** (12) | — | Stock crossing the company line — **MISSING**: **12 of 12** of this role's activities are flagged `OC_UNCLEAR` and **11 of 12** `OWNERSHIP_UNCLEAR`. This role exists *because* of the operating-company boundary and EOS cannot express it | — | — | Intercompany transfer with no title-transfer event — **MISSING** | — |
| **Warehouse Manager** (5) **THIN EVIDENCE** | The warehouses she is assigned — **PARTIAL**: `assignedWarehouseIds` went live in Rules; the census records `assignedWarehouseComparison: BOTH_EMPTY` for the one warehouse-manager employee | — | — | — | *"No governed way to create or activate a warehouse"* — **MISSING** | — |

### 3.3 Two anti-requirements, stated so a later pass cannot re-derive them

- **`MY OWNED RELATIONSHIPS` must never be merged into a task list.** An owned account is not a
  to-do. The accepted dashboard authority already ruled the equivalent point: *"A gated module holds
  its place. Re-ranking a dashboard around what happens to be available today teaches the reader that
  availability is importance."*
- **A bucket whose key does not exist must render as a stated absence, not as an empty list.** The
  corpus proves the cost of getting this wrong twice over: `P3B1-S33-A03` — *"The honest-state
  vocabulary distinguishes EMPTY from NO_MATCHES from CAPABILITY_NOT_ENABLED, which is precisely what
  separates 'no work today' from 'your account is not linked'"* — and `P3B1-S01-A01`, where an
  unpolled transport makes the queue *"empty and indistinguishable from 'no weekend demand'."*
  **Given §2.3, every role-keyed bucket will be empty on day one for structural reasons, and must say
  which reason.**

### 3.4 Reconciliation with sibling lane EMP-WORK — one disagreement, recorded not resolved

EMP-WORK reports: *"EOS models the ASSIGNEE and no other role concept … MY ACCOUNTABILITIES, MY OWNED
RELATIONSHIPS, MY APPROVALS, MY ESCALATIONS and MY TEAM VIEW each need something EOS does not currently
store."*

**Agreed on four of the five.** ACCOUNTABLE PERSON, ESCALATION OWNER and DOMAIN STEWARD are absent
(§2), and MY TEAM has two unreconciled keys neither of which expresses a team.

**Disagreed on MY OWNED RELATIONSHIPS, and this lane's reading is the narrower one.** RECORD OWNER **is**
stored — `functions/src/ownership/ownershipMatrix.ts` with per-family `ownerFields[]`, `OWNER_TYPES` in
`typedOwner.ts:12`, and four concrete stored fields (`accountOwner.assignedToEmployeeId`,
`contacts.owner`, `locations.owner`, `ownerEmployeeId`). What is missing is not the fact but **a single
key to query it by**, plus a live read path: every `opportunity.*` id resolves DENY for all 48 roles
under the production activation set. So this lane classifies it **PARTIAL (MODEL: heterogeneous keys) +
MISSING (production transport)** rather than "not stored."

**Where both lanes agree, and it is the governing sentence for this document:** *the distinction the
Owner is asking to preserve is correct and currently unrepresentable.* This document therefore states
the requirement and the gap side by side in every row, and **designs around none of them.**

### 3.5 Three EMP-WORK findings folded in

| Finding | Bearing here | Provenance |
|---|---|---|
| **General Manager: 0 of 9 workflows finishable. Service Billing Admin: 0 of 5.** | The person accountable for the numbers and the person who turns work into money have **no finishable workflow at all.** Every requirement for these two roles below is a requirement against an empty implementation, not an improvement to a working one | EMP-WORK over the 86-workflow registry |
| **Field Technician and Operations Manager each cross 8 EOS domains; Controller carries 20 workflows at 15% finishable** | These three are the strongest candidates for *"never hunt through six modules"* — and this lane's independent friction data agrees: TECH carries the highest `NO_NEXT` count (70) and Controller the joint-highest `HUNT` rate | EMP-WORK; corroborated by §0.4 |
| **44 instances of work held outside EOS, and in every one the outside channel is a recovery path, not a preference** — phone for the customer promise, verbal for the dispatcher shift handoff, paper for labour time, spreadsheet for the published financial position | This is the **exception experience** requirement in one line: EOS does not lose the work, it **exports** it to a channel with no record. This lane's own mining found the same four channels verbatim (*"He phones the office"* ×4, *"She maintains the split in a spreadsheet"*, *"The correction, if any, happens in a conversation"*) | EMP-WORK — and EMP-WORK states this rests **entirely on authored narrative**. **Carry that qualifier: a hypothesis to test, not observed practice** |

---

## 4. Per-role experience requirements

**Reading rules.** Every requirement states the **role**, the **trigger**, **what EOS must already
know**, and **whether EOS can know it today**. Gap classes: **AUTHORITY GAP** (a capability/grant
decision) · **WORKFLOW GAP** (no next step exists) · **MODEL GAP** (the fact has no home) ·
**ENGINEERING GAP** (the fact exists and does not reach the surface). Organised by the twelve
dimensions so requirements can be compared across roles — the dimension, not the module, is the unit.

Device and coverage figures in this section are over **660 rows** (P3-B1 + P3-B2). **For Salesperson,
Sales Manager, Marketing Manager, Warehouse Manager, Administrator, Office Manager, Accounting Manager,
Controller (P3-B3 portion), General Manager and Owner there is no device, coverage or friction evidence
at all** — that silence is a **measurement gap, not evidence that those roles do not need mobile,
do not hit exceptions, or do not hunt.** Marked **NO DEVICE EVIDENCE** wherever it bites.

### 4.1 START-OF-DAY EXPERIENCE

| ID | Role | Trigger | What EOS must already know | Can EOS know it? | Gap |
|---|---|---|---|---|---|
| EXP-001 | **Field Technician** | Opens the phone at 06:50 before leaving the driveway | The whole day's dispatched jobs **in the order he will drive them**, each with address, equipment, symptom, and what parts the job will need | **MISSING.** Assignment resolves; ordering does not — *"Technicians have no location data in their records and the recommendation engine's territory component is flat for that reason, so a route optimiser has nothing to work from."* He *"sequences by memory"* | MODEL GAP |
| EXP-002 | **Field Technician** | Same moment | That he intends to accept **all four** jobs, not one | **MISSING.** *"Four taps. There is no 'accept all.'"* And *"Technicians accept the whole day at once; the model assumes one at a time"* | WORKFLOW GAP |
| EXP-003 | **Field Technician** | Signs in and sees nothing | Whether the empty list means *no work today*, *your account is not linked*, or *this capability is off* | **AVAILABLE NOW** — the honest-state vocabulary distinguishes `EMPTY` / `NO_MATCHES` / `CAPABILITY_NOT_ENABLED`. **This is the one start-of-day requirement EOS already satisfies, and it is load-bearing**: *"A wrong honest state on day one costs an hour of somebody's time"* | — |
| EXP-004 | **Dispatcher** | Opens the board at 07:55 to build tomorrow | Ready-to-schedule demand **and** technician capacity **and** blocked time, in one read, for the date being built | **AVAILABLE NOW (partial).** *"Three panes: queue, lane grid, technician pane"*; blocked time renders. **But** a technician with unrecorded hours *"draws a lane that cannot honestly be shaded"*, and the warning must read *"we do not know"*, never *"outside hours"* | — |
| EXP-005 | **Dispatcher** | Same moment, having inherited the board | What the previous shift did to it | **MISSING.** The activity feed is **session-only**: *"the incoming dispatcher's feed is empty. There is no shift-note or handover surface"* | MODEL GAP |
| EXP-006 | **Service Coordinator** | 06:40 Monday, weekend email pile | How many inbound requests are decidable, **and when the transport last successfully polled** | **PARTIAL.** The queue reads; the poll timestamp is the requirement: *"If the transport has not polled, the queue is empty and indistinguishable from 'no weekend demand'. The screen must say when it last successfully polled, not just show zero rows"* | ENGINEERING GAP |
| EXP-007 | **Service Coordinator** | Same | Which rows someone is **already chasing** | **MISSING.** *"With no owner field, the afternoon coordinator cannot tell a row nobody has looked at from one someone is actively chasing"* | MODEL GAP |
| EXP-008 | **Parts Manager** | Opens her queue | Requests newly landed in `READY_FOR_PARTS_MANAGER` — role-owned, not yet person-assigned — **and that they are hers** | **PARTIAL model, ROLE-EMPTY in production.** The state exists and the help text the corpus asks for is exact: *"Owned by the Parts Manager role. Not yet assigned to a person"* | AUTHORITY GAP (approval verbs reach no governed Role) |
| EXP-009 | **Receiving Lead** | 06:00 at the dock, gun in hand | What is expected in today, against which order | **MISSING.** *"A purchase order has no business number. Nothing prints, encodes or resolves a scannable order label"* — so scan-first receiving entry cannot be built | MODEL GAP |
| EXP-010 | **Service Manager** | Start of day | Which Work Orders created overnight are incomplete, **grouped by operating company** | **MISSING.** *"Because no Work Order carries `operatingCompanyId`, she cannot filter this review by operating company at all — the grouping she actually manages by does not exist on the record"* | MODEL GAP |
| EXP-011 | **Controller** | Month-end morning | The four numbers, each with its basis and its as-of time | **PARTIAL.** *"Valuation is not a place for inference"*; three of the four month-end paths are `OWNER_DECISION_PENDING` | AUTHORITY GAP + WORKFLOW GAP |
| EXP-012 | **Salesperson** | Monday morning | Owned accounts, agreements awaiting acceptance, orders requiring action, booked-vs-goal | **MISSING in production.** Designed, Owner-accepted, and *"for the Salesperson persona **every** Current Work and Performance module is GATED, so a salesperson's dashboard is one live figure (`AccountPortfolio`) and a column of honest refusals"* | AUTHORITY GAP |
| EXP-013 | **All roles** | Any start of day | That a module is gated rather than empty, **without re-ranking the page around what happens to work** | **AVAILABLE NOW as authority** — Decision #161: *"A gated module holds its place. Re-ranking a dashboard around what happens to be available today teaches the reader that availability is importance."* **Adopt this verbatim as an experience rule for all six buckets** | — |

### 4.2 WORK QUEUES

| ID | Role | Trigger | What EOS must already know | Can EOS know it? | Gap |
|---|---|---|---|---|---|
| EXP-014 | **All** | Any queue render | Which of the six buckets this queue **is**, named on the surface | **MISSING** — three of six keys do not exist (§3.1) | MODEL GAP |
| EXP-015 | **Dispatcher** | Reviewing open work at 17:20 | "Still open" as a first-class filter | **PARTIAL.** Terminal statuses are `COMPLETED`/`CLOSED`/`CANCELLED`, so *"'still open' is everything else — a filter the surfaces should support directly"* | ENGINEERING GAP |
| EXP-016 | **Dispatcher** | A job sat in `DISPATCHED` since 09:40 | **Time-in-status**, not just status | **UNKNOWN — REVERIFY.** *"`dispatchedAt` makes the age computable; whether any surface shows time-in-status is UNPROVEN"*. The cost is named: *"A job left in DISPATCHED overnight silently blocks that technician's first dispatch tomorrow"* | ENGINEERING GAP |
| EXP-017 | **Operations Manager** | Weekly exception review | Which Sales Orders are stuck **and for how long** | **MISSING.** *"the order records no stage times, so 'stuck' can be inferred from state but not measured in days"*; *"'When did this order enter fulfilment?' has no answer anywhere"* | MODEL GAP |
| EXP-018 | **Parts Manager** | Any queue over both companies | Which company each row belongs to | **MISSING** on operational rows; **AVAILABLE** on commercial rows (two independent axes, `ownershipMatrix.ts:85-93`) | MODEL GAP |
| EXP-019 | **Inventory Control Analyst** | Working a variance queue | Which lines she may not approve because she counted them | **PARTIAL.** The control exists; **the eligible-reviewer list does not**: *"The screen must offer that as the next action, with the eligible reviewers named, or the recovery is a Slack message"* | MODEL GAP |
| EXP-020 | **Service Billing Admin** | Closing the day | Completed-but-not-closed Work Orders, **segregated by company** | **MISSING.** *"Two companies' revenue recognition runs off one unsegregated list"* | MODEL GAP |
| EXP-021 | **Field Technician** | Mid-day | A queue of his **own** refused/queued sync intents, distinguishing retryable from refused | **AVAILABLE NOW (partial).** The queue and the distinction exist; *"An intent that never succeeds ages in the queue; whether anything escalates it is UNPROVEN"* | ENGINEERING GAP |

### 4.3 ATTENTION MODEL

| ID | Role | Trigger | What EOS must already know | Can EOS know it? | Gap |
|---|---|---|---|---|---|
| EXP-022 | **All** | Anything demanding attention | That **SEEN ≠ RESOLVED**, and that an attention item is a **projection that never invents lifecycle, permission or severity**, whose action *"invokes the same governed command the source domain uses"* | **DESIGNED, NOT BUILT.** The Action Center architecture was explicitly required *before* implementation to avoid a *"frontend hook aggregator"* anti-pattern; **only the first bounded slice shipped** (`domain/partsAttentionProjection.js` + re-pointing the notification bell) | ENGINEERING GAP |
| EXP-023 | **All** | Any attention surface | That **68% of modelled work touches an exception** (§0.5), so exceptions are the norm and cannot be a secondary tray | **AVAILABLE NOW as evidence**; not reflected anywhere in built surfaces | — |
| EXP-024 | **Dispatcher** | A placement collides | The **colliding Work Order by name**, in the dialog — *"must name the colliding Work Order, not merely say 'conflict'"* — and *"even when that technician is filtered out of view"* | **AVAILABLE NOW (partial).** Overlap is refused, not warned; shift overrun is warned, never refused — the distinction is correct and must be preserved | — |
| EXP-025 | **Service Manager** | Reading a technician scorecard | That a metric with no goal is a metric with no goal | **AVAILABLE NOW.** *"a ready-to-schedule count metric with a goal authority entry that is null — the metric exists and no goal is set against it"*. And Rule 6: *"A bounded read may return a page and say so. A TOTAL may not"* | — |
| EXP-026 | **Field Technician** | A job is cancelled while he drives | That it left his day, **and that it was cancelled rather than imagined** | **UNKNOWN — REVERIFY.** *"Whether it is shown as cancelled or silently vanishes is UNPROVEN by this lane; silently vanishing is worse, because the technician wonders whether he imagined it"* | ENGINEERING GAP |
| EXP-027 | **Parts Manager** | A number on screen is wrong | **Nothing.** AI must be silent here: *"Narrating a wrong number makes it more convincing, not more correct"* | **AVAILABLE NOW as a rule** | — |

### 4.4 INFORMATION HIERARCHY

| ID | Role | Trigger | What EOS must already know | Can EOS know it? | Gap |
|---|---|---|---|---|---|
| EXP-028 | **All** | Every state shown | The **why**, the **next move**, and the **recovery**, attached to the state | **MISSING at scale** — `NO_NEXT` 261/660, `NO_WHY` 216/660, `RECOVERY_UNCLEAR` 195/660. This is the single largest experience requirement in EOS | ENGINEERING GAP (mostly) |
| EXP-029 | **All** | Any record with an owner | Owner **and** operating company as **two independent facts**, neither displacing the other | **AVAILABLE NOW on commercial records** (`ownershipMatrix.ts:85-93`, ruling D-2 / D-4); **MISSING on operational records** | MODEL GAP |
| EXP-030 | **Field Technician** | Standing at the machine | Model, serial, warranty date, **and the service history of this unit** | **PARTIAL.** `warrantyExpiresDate` is a governed fact; history may be *"on a page he cannot open"*, in which case *"he phones the office — which is the failure this scenario exists to surface"* | AUTHORITY GAP |
| EXP-031 | **Service Coordinator** | Linking equipment to a new WO | Which of four identical `C712`s at four sister stores this is | **PARTIAL, and dangerous.** *"Picking the sister store's C712 produces a Work Order that looks complete and sends a technician to the right address to service the wrong serial"* | ENGINEERING GAP |
| EXP-032 | **Service Coordinator** | Reading a machine's history | Which **company** serviced it each time | **MISSING.** *"A coordinator answering 'who serviced this last?' cannot answer 'under which company?' from the record"* | MODEL GAP |
| EXP-033 | **Parts floor** | At the point of a placement action | That *"recording a placement does not change any quantity"*, and that *"staging does not reserve"* — *"the most important sentence on this screen"* | **AVAILABLE NOW as a stated requirement**; `HELP_MISSING` is flagged on **27 of 100** parts-floor activities, the highest rate of any family | ENGINEERING GAP |
| EXP-034 | **All** | Any surface rendering over an inactive capability | That the section is **inactive**, not empty | **AVAILABLE NOW where done well** — the Part record *"renders **stated absence** rather than empty tables — the correct treatment, and still four dead sections"*. **Contrast**: `/inventory/transfers` shows *"Four live, undisabled buttons over four `active: false` capabilities; the page explains in prose instead of in the control state"* | ENGINEERING GAP |
| EXP-035 | **All** | Document-level field sensitivity | That *"a technician completes work/parts/times/readings; pricing, rates, tax, and totals are office-only"* | **MISSING — named as genuinely new capability.** *"Route-level `ROLE_NAV_ACCESS` cannot express this."* ADR-007 solved the same problem for **reports** and *"nobody connected the two"* | MODEL GAP |

### 4.5 DECISION SUPPORT

| ID | Role | Trigger | What EOS must already know | Can EOS know it? | Gap |
|---|---|---|---|---|---|
| EXP-036 | **Dispatcher** | Choosing a technician | A ranked recommendation **with its reason sentence**, and whether the reason accounts for PTO | **PARTIAL and misleading.** The engine *"projects reason sentences and the board renders them"* — but *"the recommendation that does not know about PTO"*, and afterwards *"The manager cannot distinguish 'the dispatcher ignored the score' from 'the score was wrong'"* | ENGINEERING GAP |
| EXP-037 | **Dispatcher** | Overriding a recommendation | That *"this customer has banned this technician"* | **MISSING.** *"Facts like that have no home in the model at all"* | MODEL GAP |
| EXP-038 | **Service Manager** | Repair-vs-replace | Repairs-12mo, repair spend, replacement cost, repair-heavy flag | **MISSING.** Deferred (EQ-D1) and never built; *"no composer exists"* | MODEL GAP |
| EXP-039 | **Parts Manager** | Twenty replenishment recommendations | Recommended quantity **with its basis**, grouped by supplier before they become twenty POs | **MISSING.** Eight designed recommenders, *"**Nothing from it was built**"*; the only live intelligence is `EPIC3_LINEAR_V1` and `partsAttentionProjection` | ENGINEERING GAP |
| EXP-040 | **Controller / GM** | Any margin question | Cost and revenue for a job | **MISSING.** *"Margin is structurally unknown and must render as unknown, never as zero. The cost engine is 425 lines and is imported by nothing"* | AUTHORITY GAP (cost authority unruled) |
| EXP-041 | **All** | Any recommendation | That it is **non-binding**, computed on read, never persisted, and that deviations are recorded | **AVAILABLE NOW as a design idiom** (`dispatchScoring.js`); the serialized-unit ranking engine designed on the same idiom was **never built** | — |

### 4.6 HANDOFF EXPERIENCE

| ID | Role | Trigger | What EOS must already know | Can EOS know it? | Gap |
|---|---|---|---|---|---|
| EXP-042 | **Field Technician → Field Technician** | A long job or a shift change at 14:20 | That the job moved, and what the receiving technician needs to know | **MISSING.** *"The only representable options are complete-and-recreate or cancel-and-recreate"*; `WF-SVC-011` is `BROKEN_MIDWAY`/`NO_CODE`. And *"Parts consumption on a cancelled Work Order — whether it reverses, stands, or is orphaned — is UNPROVEN"* | WORKFLOW GAP |
| EXP-043 | **Dispatcher → Dispatcher** | Shift change at 17:30 | The day's context | **MISSING.** *"There is no shift-note or handover surface"* | MODEL GAP |
| EXP-044 | **After-hours Coordinator → Service Coordinator** | 06:45 the next morning | What happened overnight | **MISSING.** *"She reads the note and phones Ken"* | WORKFLOW GAP |
| EXP-045 | **Dispatcher** | Technician goes home sick at 11:00 with four jobs outstanding | That four jobs need redistributing, and a verb to do it | **MISSING.** *"In practice the dispatcher leaves them and phones the customers"* | WORKFLOW GAP |
| EXP-046 | **Service Manager** | Two technicians on one install | Both technicians' attribution on one job | **MISSING.** *"Two technicians on one job — routine for an install or a heavy lift — is unrepresentable even without a handoff"* — and *"Attribution is what pay, scheduling and performance all rest on"* | MODEL GAP |
| EXP-047 | **Field Technician → Parts Associate** | Restock request from the truck | The ask, in a form the warehouse can pick against | **MISSING.** *"If the request surface does not exist, the handoff happens by phone and the whole story below runs with no record of intent"*; and *"Nothing produces a pick list"* | WORKFLOW GAP |
| EXP-048 | **Parts Associate → Field Technician** | Nine parts staged for Thursday 06:00 | That staging **does not reserve**, and who removed a staged part | **PARTIAL/MISSING.** *"If Curt arrives Thursday and two parts are gone, the recovery is a re-pull with no record of who took them. Placements record stowing, not removal"* | MODEL GAP |
| EXP-049 | **Any → Any** | Ownership genuinely changes hands | An auditable owner handoff | **PARTIAL.** The command exists per ruling D-5 and *"has no onCall export, so the command has no caller"* | ENGINEERING GAP |
| EXP-050 | **Service Manager** | Asking whether to prioritise the missing handoff verb | **How often** work is handed over | **MISSING.** The corpus models the manager attempting to count handoffs and failing — so the business cannot size its own most-cited workflow gap | MODEL GAP |

### 4.7 EXCEPTION EXPERIENCE

| ID | Role | Trigger | What EOS must already know | Can EOS know it? | Gap |
|---|---|---|---|---|---|
| EXP-051 | **Field Technician** | Store shut · wrong address · machine fine · customer refuses over an unpaid invoice | A governed **"I could not do this"** outcome | **MISSING — the most-cited gap in the corpus.** *"there is no 'I could not do this' outcome, so a technician's real day has no governed expression"*; the corpus records the same dead end four times in one story | WORKFLOW GAP |
| EXP-052 | **Field Technician** | Fat-fingers **Arrive** on the freeway | A correction path | **MISSING.** *"The only recovery is a back-office correction outside the lifecycle, and there is no such correction path in the technician's app."* Mis-taps *"are constant"* on a truck-mounted phone | WORKFLOW GAP |
| EXP-053 | **Receiving Lead** | Scans the same carton twice | That the recovery is an `ADJUSTED` movement he may not be authorised for, **and who is** | **MISSING.** *"That escalation must be discoverable from the line"* | MODEL GAP (no escalation owner) |
| EXP-054 | **Parts Associate** | Tries to void an order he owns | Who **can**, and that *"the person closest to the order is the person who cannot cancel it"* | **MISSING, and structurally so.** *"Dwayne must find a dispatcher who is ALSO the assignee — and the assignee is Dwayne … a genuine structural dead end"* | AUTHORITY GAP |
| EXP-055 | **Stocker/scanner** | Relocates more than the source bin holds | An **offer to split** the movement, not a bare refusal | **MISSING.** *"The screen should offer to split, not just refuse"* | ENGINEERING GAP |
| EXP-056 | **Inventory Control Analyst** | The create capability is inactive | *"This workspace is visible but the create capability is inactive in this environment"* — **before** the picker, not after — plus the named escalation target | **MISSING.** *"There is no self-service recovery … and the screen must say so rather than leaving Tessa to guess"* | ENGINEERING GAP |
| EXP-057 | **System Admin** | Asked under pressure to flip `active:false` | What `active:false` means, and that *"an administrator cannot change it"* | **MISSING on screen.** *"The recovery is to say no clearly and point at the release process"* — and at Role-assignment time, *"ⓘ on each capability in a Role: ACTIVE or INACTIVE in the catalog, shown at assignment time"*, because today *"nothing on the Role screen tells him"* | ENGINEERING GAP |
| EXP-058 | **Any** | A bulk act partly fails | **Exactly which rows failed**, each retryable alone | **PARTIAL.** The requirement is stated four times (*"If row 12 fails, rows 1-11 must remain created and row 12 must be retryable alone"*; *"If four of eleven fail, the operator must know which four before the vendor call ends"*). 66 of 660 activities are `BULK` | ENGINEERING GAP |
| EXP-059 | **Any** | Same act submitted twice from two tabs | A refusal that reads as protection, not as a fault | **AVAILABLE NOW as authority, MISSING as experience.** *"Rules protect correctness well and the UI is likely to translate the protection into a frightening error. The finding will be UX, not authority"* | ENGINEERING GAP |
| EXP-060 | **Field Technician** | Offline in a freezer room | That the intent is queued, in what order, and that dependencies hold | **AVAILABLE NOW — the strongest exception experience in EOS.** Queued intents, a dependency graph (*"If the install is refused, the completion behind it must not be sent either"*), and *"Optimistic local state is deliberately avoided — there is no second source of truth for quantities."* **Two residual requirements**: a cold start with no signal *"gives him nothing — he cannot even load the app"*, and the local store *"is explicitly NOT encrypted, which matters for a lost phone carrying customer notes"* | ENGINEERING GAP (residual) |
| EXP-061 | **Field Technician** | A queued intent is refused at 18:00 | That a refusal arriving after hours will not be seen | **MISSING.** *"A refusal at 18:00 is discovered when everyone has gone home"* | WORKFLOW GAP |

### 4.8 MANAGER EXPERIENCE (requirements; the visibility boundary is §5)

| ID | Role | Trigger | What EOS must already know | Can EOS know it? | Gap |
|---|---|---|---|---|---|
| EXP-062 | **Service Manager** | Comparing two technicians | That the comparison is fair, and that a technician **can see and contest** his own figure | **MISSING both halves.** *"A technician penalised by a data model defect has no way to see or contest it"*; *"The correction, if any, happens in a conversation"* | MODEL GAP |
| EXP-063 | **General Manager** | A performance conversation | What one employee did **across sales, service and inventory in one place** | **MISSING.** *"Employee is a wave-4 reportable object with **no fields populated**"*; the audit event trail is *"the nearest thing to a cross-domain activity record"* — and the eleven governed Roles that declare `audit.event.read` **are refused by the deployed `listRecordChangeHistory`** | ENGINEERING GAP + AUTHORITY GAP |
| EXP-064 | **Any manager** | Asking why they cannot see a peer's team | Where their visibility stops, and **why** | **PARTIAL / MODEL GAP.** *"Visibility is resolved from the role hierarchy rather than from a scope on the grant"* — and `performanceMetricRegistry.ts:105`: *"**NO TEAM ENTITY EXISTS** … with role-only hierarchy EVERY salesManager sees EVERY salesperson"* | MODEL GAP |
| EXP-065 | **Sales Manager** | Annual goal-setting | A governed goal with draft/approve/supersede/retire, readable by the subject and authored by the manager | **BLOCKED.** The object and lifecycle exist; *"the read is granted widely and the authoring is not — the Owner's stated position is that employees do not automatically manage their own targets"*; `WF-RPT-004` is `CANNOT_START` | AUTHORITY GAP |
| EXP-066 | **Service Manager** | A new starter's day one | Whether the technician is **fully onboarded** | **MISSING.** *"user, role, technicianId, technician record, employee, truck and availability are **seven records with no single view**"*, and *"Forgetting this field is the single most common onboarding failure and presents as an empty jobs list"* | ENGINEERING GAP |
| EXP-067 | **Service Manager** | A new technician exists but is not ready | That he must not be recommended for work yet | **PARTIAL and wrong by default.** *"a record created as available scores 100 from day zero — before training, before a truck, before working hours"*; the only lever is marking him `off_shift` | MODEL GAP |
| EXP-068 | **Any manager** | Assigning work requiring a certification | Whether the person holds it | **MISSING.** `P3B1-S17-A06`: **"Nothing warns."** Proficiency is wholly unmodelled | MODEL GAP |
| EXP-069 | **Owner** | Monthly review | Taylor's and Ventana's month side by side | **BLOCKED.** *"The financial axis is closed and the operational axis is an authority gap"* (`P3B3-MGMT-017`, `P3B3-MGMT-018`) | AUTHORITY GAP + MODEL GAP |

### 4.9 MOBILE NEEDS

| ID | Role | Trigger | What EOS must already know | Can EOS know it? | Gap |
|---|---|---|---|---|---|
| EXP-070 | **Field Technician** | Any phone use | That **width changes composition, never authority**, and that the choice of technician surface must follow **the user, not the viewport** | **MISSING.** `P3B1-S10-A08`: *"**Two different technician experiences chosen by viewport width, not by user preference**"* — and *"A technician on a tablet in a truck may get either, depending on orientation."* And *"Technicians do paperwork at a desk at the start and end of the day"*, so the phone composition must not be the only one he can reach | ENGINEERING GAP |
| EXP-071 | **Field Technician** | Parking lot, no signal, cold start | Enough of today to work from | **MISSING.** *"A cold start with no signal gives him nothing — he cannot even load the app"* | ENGINEERING GAP |
| EXP-072 | **Field Technician** | Recording a part on the phone | Where the part came from | **AVAILABLE NOW as a refusal** (*"Select where this part came from before recording usage"*) — **and MISSING as a source**: the truck is not offered until a fragile join resolves, so *"The technician sees only warehouses and either picks a warehouse he was never at, or gives up and does not record the part"* | MODEL GAP |
| EXP-073 | **Parts floor** | Gun in hand, freezer or dock | That **scanning resolves IDENTITY and does not determine AUTHORITY** | **AVAILABLE NOW as principle** — *"The scanner identifies an object and prepares an operation; it never changes inventory merely because a barcode was read"*; one shared `resolveScannedIdentity`. **But**: `inventory.stock.relocate` is one of the five never-requested ids, so *"the only quantity-moving scanner workflow can never be offered to anyone"* | ENGINEERING GAP |
| EXP-074 | **Handheld operators** | Any handheld task | That this is the **most exception-dense surface in EOS** — 55 of 69 handheld activities (80%) touch an exception category — and the least able to spend screen on it | **AVAILABLE NOW as evidence** | — |
| EXP-075 | **All commercial/office roles** | Any mobile use | — | **NO DEVICE EVIDENCE.** All 350 P3-B3 rows carry no device field. **Do not read that silence as "desktop only."** A Controller approving at month end, a Salesperson at a customer site and an Accounting Manager on collections are all plausible phone users and **none is evidenced either way** → **`OD-EMP-003`** | MEASUREMENT GAP |
| EXP-076 | **All** | 375px | An honest composition, which may differ from the desktop one | **Requirement, not a finding.** *"Phone is not shrunk desktop … Do not fake usability at 375px."* Nothing in the evidence contradicts it and nothing implements it | — |

### 4.10 SEARCH NEEDS

80 of 1,010 activities involve a lookup (48 DESKTOP · 14 MOBILE · 5 HANDHELD · 13 no device field).
Top searchers: service_coordinator 13 · field_technician 11 · service_manager 7 · Parts Manager 6.

| ID | Role | Trigger | What EOS must already know | Can EOS know it? | Gap |
|---|---|---|---|---|---|
| EXP-077 | **Service Billing Admin** | A customer reads a WO number over the phone | Resolve a business number to the record | **PARTIAL.** And *"There is no in-product way to renumber a Work Order"*; `woNumber` uniqueness is **not enforced** and `counters` is client-unreadable, *"so a collision is invisible from the product"* | MODEL GAP |
| EXP-078 | **Field Technician** | In front of the machine | Resolve **by scanning the serial plate**, with manual entry as the fallback | **PARTIAL.** *"If the plate is unreadable (they are, on old machines, behind the panel and covered in mix), manual entry must exist"* | ENGINEERING GAP |
| EXP-079 | **Service Manager** | A manufacturer safety notice | Find **every affected machine in the field** by model | **MISSING.** `WF-SVC-015` is `BROKEN_MIDWAY`/`CAPABILITY_INACTIVE` | AUTHORITY GAP |
| EXP-080 | **Service Coordinator** | Phone-call day, customer waiting | Answer from one place while the customer is on the line | **PARTIAL** — this is the purest *"never hunt through six modules"* case in the corpus (`P3B1-S30`: *"The phone-call day — what a coordinator can find while a customer waits"*) | ENGINEERING GAP |
| EXP-081 | **Office Manager / Sales** | Looking for a person | A contact | **MISSING.** *"Contacts has no global index, no per-contact read, no record page — correctly BLOCKED, and a real operational absence"* | MODEL GAP |
| EXP-082 | **Any** | Any list worth returning to | A **saved view** | **MISSING.** Deferred from the Opportunity list, from Lists P2 and *"from every list that followed, for the same reason each time: 'needs somewhere to persist a named view. That is new authority.'"* And *"there is **no administration surface for list/view configuration at all**"* | MODEL GAP |
| EXP-083 | **Any** | Any search result set | That a result set may be **a page and say so**, and that a TOTAL may not | **AVAILABLE NOW as authority** (Rule 6) | — |
| EXP-084 | **Report Author / Viewer** | Getting a number out | Export | **MISSING.** *"`report.export` does not exist anywhere in the repository"*; *"a governed report you cannot get out of the building is a report you looked at"* | MODEL GAP (capability not in the 147) |

### 4.11 AI ASSISTANCE

Measured over the 660 scored rows, using each library's own AI classification:

| Verdict | P3-B1 | P3-B2 | Combined | Share of 660 |
|---|---:|---:|---:|---:|
| **AI is useful** (`SHORTEN`/`CLASSIFY`/`DRAFT`/`EXPLAIN`/`AI_MATERIAL`/`AI_ASSIST_NARROW`) | 129 | 103 | **232** | **35%** |
| **AI is noise or unsafe** (`NOISE`/`AI_NOISE`/`AI_UNSAFE_HERE`) | 25 | 171 | **196** | **30%** |
| **AI not applicable** (`NONE`/`AI_NOT_APPLICABLE`) | 176 | 56 | **232** | **35%** |

**Two thirds of modelled work is work AI should stay out of.** The libraries disagree sharply on the
split (B1 8% noise, B2 52%) — a **scoring-convention difference, not a domain difference**, so treat
the 30% as a floor and the per-activity notes as the real instrument.

| ID | Role | Trigger | What AI may do | Can EOS support it? | Gap |
|---|---|---|---|---|---|
| EXP-085 | **All** | Any AI output | **Summarize, explain, investigate, prioritize, draft, recommend — and nothing else.** An accepted recommendation flows through **the normal governed command**; AI gets no independent write path | **AVAILABLE NOW as governance** — the Action Center rule already says every surfaced action *"invokes the same governed command the source domain uses"*, and the inventory AI strategy already says *"Recommend, never execute"*, recommendations as governed objects carrying model id and version, *"abstain honestly"*, server-side, tenant-inert | — |
| EXP-086 | **All** | Any AI widget | **Not one capability per widget.** AI reads what the person may already read | **Requirement.** Precedent exists for the opposite failure: *"Six governed capabilities the composition gates on were never in the access-feed request set, so seven modules could not resolve for anyone"* | — |
| EXP-087 | **Service Coordinator** | Inbound queue triage | **CLASSIFY** — *"AI's value is classification/triage, not execution"* | **PARTIAL** — the queue exists; the assistant is *"**wired to nothing**"*: `functions/src/index.ts` contains no assistant export | ENGINEERING GAP |
| EXP-088 | **Field Technician** | *"compressor dead on a C712 at Circle K Chandler"* | **DRAFT** a correct part request — *"exactly what a technician cannot do quickly and a model can"* | **MISSING** (no request surface; assistant unwired) | ENGINEERING GAP |
| EXP-089 | **Parts Manager** | Twenty requests | **Group by supplier before they become twenty POs** — *"real leverage"*; but *"Drafting justification text from the demand signal is useful; **choosing the quantity is not**"* | **MISSING** | ENGINEERING GAP |
| EXP-090 | **Operations Manager** | *"why has this taken nine days?"* | **EXPLAIN** — *"Turning eight timestamp/actor pairs into one sentence is exactly the right use of a model"* | **MISSING.** *"If no surface assembles the chronology, Priya reconstructs it from field names"* | ENGINEERING GAP |
| EXP-091 | **Dispatcher / Parts Associate** | *"the goods are wrong"* / *"which verb applies here"* | **Navigate the person to the correct governed path** — *"exactly the kind of navigation a model does well"* | **MISSING** | ENGINEERING GAP |
| EXP-092 | **Parts Manager / Controller / ICA** | A wrong number · a valuation · a determinism guarantee · an ambiguous alias | **Nothing. Be absent.** *"Narrating a wrong number makes it more convincing, not more correct"* · *"Valuation is not a place for inference"* · *"This is a determinism guarantee. A model near it is a liability"* · *"Ranking two equally-registered aliases is exactly the pick the server refuses to make. A model doing it in the UI reintroduces the defect above the API"* | **AVAILABLE NOW as a rule, and it must be enforceable per surface** | — |
| EXP-093 | **Receiving Lead** | A write may or may not have landed | **Nothing.** *"A model guessing whether the write landed is exactly the wrong tool. This needs an idempotency key, not an inference"* | **AVAILABLE NOW as a rule** | — |
| EXP-094 | **All** | Any AI presence | That AI is **quiet or absent when it has nothing grounded to contribute** — and the corpus gives the test: *"The queue is three rows. A summary here is decoration"*, *"Opening a list is not a comprehension problem"*, *"Choosing a shelf is a physical decision"* | **Requirement.** Supported by the friction data: `NOISE_PAGE` is flagged on **4 of 660** — EOS's problem is under-explanation, so AI must add explanation **without occupying the page** | — |

### 4.12 END-OF-DAY / FOLLOW-UP EXPERIENCE

41 of 660 activities are `END_OF_DAY`; 63 are `END_OF_MONTH`. Parts Manager (12) and Dispatcher (7)
carry the most end-of-day work.

| ID | Role | Trigger | What EOS must already know | Can EOS know it? | Gap |
|---|---|---|---|---|---|
| EXP-095 | **Dispatcher** | 17:20 | Every non-terminal Work Order, and which will **block tomorrow** | **PARTIAL.** *"A job left in DISPATCHED overnight silently blocks that technician's first dispatch tomorrow"*, and *"A technician with two overnight jobs and a full tomorrow looks free tomorrow"* | ENGINEERING GAP |
| EXP-096 | **Dispatcher** | Jobs legitimately running past 17:30 | That this is normal — *"The board simply reflects reality, which is correct"* — and that *"**Nothing sweeps or prompts**"* | **PARTIAL** | WORKFLOW GAP |
| EXP-097 | **Service Coordinator** | Leaving at 17:30 | Which requests arrived **after hours**, and which are emergencies | **MISSING.** *"The queue does not distinguish 'arrived while you were here' from 'arrived after hours'"*; *"An emergency emailed at 18:30 is indistinguishable from a routine one"* | MODEL GAP |
| EXP-098 | **Field Technician** | Last completion of the day at 17:45 in a car park | That this is *"the most rushed record of the day"* | **MISSING.** *"No friction, no checklist, no prompt"* — stated as a finding, not a request for friction for its own sake | ENGINEERING GAP |
| EXP-099 | **Field Technician** | Depot car park, 18:00, nine queued intents | Which landed, which were refused, and that a refusal now will not be seen | **PARTIAL** (see EXP-061) | WORKFLOW GAP |
| EXP-100 | **Service Manager** | Reading the day's numbers | The day's numbers | **MISSING.** *"**She counts by hand**"* | ENGINEERING GAP |
| EXP-101 | **Service Billing Admin** | Same-day close of seven completed WOs | A close path that is not seven record pages | **PARTIAL.** *"Seven record pages"* | ENGINEERING GAP |
| EXP-102 | **Parts Manager / Warehouse Lead** | 17:30 at Phoenix Main | What a warehouse lead closes out | **PARTIAL** — `P3B2-S31` models it across ten activities; end-of-day is the densest `HELP_MISSING` zone for this family | ENGINEERING GAP |
| EXP-103 | **Controller** | Month end, both companies | Four numbers with a company split | **MISSING.** *"The split is reconstructed downstream and is a reconciliation, not a report"*; and *"She maintains the split in a spreadsheet"* | MODEL GAP |

---

## 5. What managers need to see that individuals should not — and the reverse

The brief asks one question; the evidence forces **three**, because the visibility boundary runs in two
directions and one of them is currently unenforceable.

### 5.1 Manager-only, and why

| Manager sees | Individual must not | Why | Can EOS enforce the boundary? |
|---|---|---|---|
| **Comparison across people** — two technicians' productivity side by side | An individual seeing a peer's figures | Comparison is the manager's job and a peer-visible league table is not | **NO.** *"with role-only hierarchy EVERY salesManager sees EVERY salesperson"* — the boundary exists between *levels*, not between *teams* |
| **Unassigned / unowned work** — accounts with no owner, requests nobody has claimed | — | This is a management failure to fix, not an individual's queue | **NO.** `P3B3-MGMT-038` (**EXECUTED_FAIL**): *"an ownerless account blocks opportunity creation by design, and the report field that would list them is inactive in every environment"* |
| **Capacity and utilisation across the team** — fleet `% booked` | An individual seeing colleagues' load | | **PARTIAL.** `% booked` *"renders only when every technician in view has a recorded schedule, which in practice means never"* |
| **Goals and targets** — set and approve them | An individual **authoring** their own target | Owner's stated position: *"employees do not automatically manage their own targets"* | **PARTIAL.** Read is granted widely, authoring is not — and `WF-RPT-004` `CANNOT_START` |
| **Cost, margin, rate** — what a job cost and earned | A technician seeing pricing, rates, tax, totals | *"A technician completes work/parts/times/readings; pricing, rates, tax, and totals are office-only"* | **NO.** *"Route-level `ROLE_NAV_ACCESS` cannot express this"* — **field-level visibility within a document is a named, unbuilt capability (G35)** |
| **Cross-domain activity for one employee** | An individual seeing another's activity trail | | **NO.** `P3B3-MGMT-039`: Employee is *"a wave-4 reportable object with **no fields populated**"*; and the eleven governed Roles declaring `audit.event.read` are **refused by the deployed service** |
| **Salary-class aggregates** — *"SUM(salary) by department but not any individual salary"* | Any individual row | ADR-007 calls it *"the single most common sensitive report"* | **NO.** Aggregate-only field access was **ruled out for v1**, surfaced *"now rather than discovered in wave 5"* — and wave 5 is the financial wave |

### 5.2 Individual-only, and the requirement nobody has written

This direction is missing from the brief and the evidence is unambiguous.

| Individual must see | Manager should not, or not silently | Evidence |
|---|---|---|
| **His own performance figure, and a way to contest it** | A manager acting on an uncontested figure | `P3B1-S28-A07`: *"Contestability is what makes performance data legitimate"* — and *"The correction, if any, happens in a conversation"*. `P3B1-S28-A04`: *"A technician penalised by a data model defect has no way to see or contest it"* |
| **His own technician status** — because a stale `on_job` silently scores him occupied all the next day | | `P3B1-S09-A08`: *"If the status is stale (left at on_job overnight), he is scored as occupied all the next day with no way to notice"* |
| **His own goal, without reading anyone else's** | | `P3B3-MGMT-015` — `IMPLEMENTED_UNEXECUTED`; the `performanceGoalSubject` Role exists for exactly this and has **no corpus activity and zero occupancy** |
| **Nothing at all about a peer's pay, rate or margin** | | See 5.1 row 5 — and today the absence of field-level visibility fails in the **permissive** direction |

**The asymmetry that must be stated to the Owner.** Every manager-only boundary in 5.1 is currently
enforced by *what happens to be switched off*, not by a visibility model. When the commercial
capabilities are activated — the cheapest change in the master brief — **the boundaries in 5.1 open
before the mechanisms that should govern them exist.** → **`OD-EMP-004`**

### 5.3 The manager surface must be a different surface, not a wider one

| Requirement | Evidence |
|---|---|
| A manager's surface is composed from **different questions**, not from an individual's surface with a bigger scope | `P3B3-MGMT-013`: the **only** role-conditional composition in the built dashboard is *"technicians get their own surface, everyone else gets the shared one"* — i.e. EOS today has exactly one manager/individual split and it is device-shaped, not role-shaped |
| The composition may **not** mint its own permissions | Decision #161 Rule 1: *"A dashboard composes authority. It is never a second permission layer."* **Zero `dashboard.*` ids exist in either catalog mirror** — verified |
| Personalization inputs are a **closed set, and never a persona name** | Rule 1a |
| Actual and target must share a measurement basis; **never BOOKED actual vs BILLED goal** | Rule 3 |
| A rate rolls up as `sum(numerator)/sum(denominator)`, **never `average(per-employee percentages)`** | Rule 8 — the single most common manager-dashboard arithmetic error |
| An action a manager surface offers must be an action that exists | Rule 10 |
| Cross-entity sums must type as `UNELIMINATED_SUM` | Rule 8 |

**Adopt Decision #161's ten rules as the manager-experience contract.** They are already Owner-accepted,
already live-verified, and this lane found nothing in the corpus that contradicts them.

### 5.4 The exception queues managers need, and their state

Each is a manager's real weekly question, from the P3-B3 management block.

| # | The manager's question | Activity | State |
|---|---|---|---|
| 1 | Which Sales Orders are stuck, and why | `MGMT-033` | **PARTIAL** — no stage times, so no "how long" |
| 2 | Which Opportunities closed WON and never became an order | `MGMT-034` | **PARTIAL** |
| 3 | Which fulfilled orders were never invoiced (revenue leakage) | `MGMT-035` | **PARTIAL** |
| 4 | Which invoices are open past terms | `MGMT-036` | **BLOCKED** |
| 5 | Which Work Orders don't tie to their Sales Order quantities | `MGMT-037` | `IMPLEMENTED_UNEXECUTED` |
| 6 | Which customers have **no account owner** | `MGMT-038` | **EXECUTED_FAIL** — *"the most consequential exception in the CRM domain and the hardest to see"* |
| 7 | Which records have no resolvable owner at all | `MGMT-029` | `IMPLEMENTED_UNEXECUTED` (an ownership census exists as a script) |

**Six of seven are exception queues over the commercial spine, and the commercial spine is off.** A
manager experience built on these seven is a manager experience that shows seven honest refusals today.

---

## 6. Requirements that depend on unknown — now **measured-zero** — role occupancy

Per §2.3, production holds **2** `roleAssignments` documents, **1** active assignment (compatibility
`admin`, unlinked to any employee) and **0** holders of any of the 45 governed business Roles. Each
requirement below is **empty, not broken**, until someone is granted — and the surface must say which.

| Requirement | Keyed on Role | Effect of zero occupancy | Also blocked by |
|---|---|---|---|
| EXP-008 Parts Manager's `READY_FOR_PARTS_MANAGER` queue | `partsManager` | Queue opens for nobody | Approval verbs reach no governed Role at all |
| EXP-065 goal authoring / approval | `salesManager`, `generalManager`, `performanceGoalSubject` | No author, no subject | `WF-RPT-004` `CANNOT_START` |
| EXP-063 cross-domain employee activity | eleven Roles declaring `audit.event.read` | Nobody holds them **and** the service refuses them anyway | `listRecordChangeHistory` defaults to `COMPATIBILITY_ROLES` |
| EXP-079 safety-notice population read | `equipmentCatalogAdministrator` | — | `CAPABILITY_INACTIVE` |
| EXP-084 report export / authoring | `reportAuthor`, `reportViewer`, `reportFinanceViewer` | — | *"Reporting — 39 capabilities, nobody holds them (LARGEST OPEN GAP)"* |
| EXP-073 scanner move-stock | `inventoryStockRelocationOperator` | — | One of the five never-requested gate ids |
| EXP-056 cycle-count create | `inventoryCycleCountCounter` / `Reconciler` | — | All four capabilities `active:false`; `inventory.cycleCount.close` **not in the catalog at all** |
| EXP-009 receiving | `inventoryReceivingClerk` | — | `RECEIVING_TRANSPORT_READY` true only for `platform-sandbox` |
| EXP-047 pick/stage | — | — | **No pick-list object exists** |
| MY APPROVALS (all) | every approval Role | **The whole bucket is empty in production** | FIN-007 approval policy *"not configured"* |
| MY TEAM (all) | role parentage | Resolves, but to *everyone* at the level below | No team entity |

**And a second-order emptiness, which is the harder one.** Even granting every Role tomorrow, **29 of
the 45 have no corpus job label and 51% of authored work names no Role at all** (§2.1). So a
role-shaped queue would then be **non-empty and keyed on the wrong thing** — the failure mode the
brief warns about. Occupancy and vocabulary are two separate prerequisites and fixing one does not fix
the other. → **`OD-EMP-001`**, **`OD-EMP-002`**

---

## 7. Gap register — every gap in this document, classified

**Counting basis, stated so the figures can be checked.** The counts below are over the **103 numbered
requirements EXP-001…EXP-103 only**, taken from the gap column of each requirement row. Three rows carry
two classes; **16 rows carry none** (the requirement is already satisfied, or is a rule rather than a
gap). Additional gaps are named in §2, §3 and §5 and are **not** counted here.

| Class | Count over EXP-001…EXP-103 | The defining examples |
|---|---:|---|
| **ENGINEERING GAP** — the fact exists and does not reach the surface | **36** | the five never-requested capability ids (5 ids · 5 gate sites · 4 pages) · `VITE_EOS_API_BASE_URL` absent everywhere · assistant module wired to nothing (`index.ts` has no assistant export) · owner-handoff command with no `onCall` export · session-only activity feed · time-in-status not shown · poll timestamp not shown · viewport-chosen technician surface · `billingQueue.ts` with zero importers · `financialReconciliation.ts` *"a detector that is never run"* |
| **MODEL GAP** — the fact has no home | **32** | ESCALATION OWNER (nothing) · ACCOUNTABLE PERSON (collapsed into owner) · DOMAIN STEWARD (nothing) · team entity (nothing) · `operatingCompanyId` on operational records · route/sequence · proficiency · stage timestamps · field-level visibility (G35) · saved views · inventory owner dimension · escalation target on a refusal |
| **WORKFLOW GAP** — no next step exists | **11** | governed non-completion (*"I could not do this"*) · technician→technician handoff · dispatcher shift handover · reassignment after a stage · uninstall/return/replacement · returns disposition out of `AWAITING_DISPOSITION` · short-receipt close · post-acceptance agreement revision · period reopen · `Arrive` correction |
| **AUTHORITY GAP** — a capability or grant decision | **10** | reorder approve/reject/cancel reach no governed Role · `finance.invoice.issue` inactive · `workOrder.labor.record` inactive **and absent from every activation array** · every `opportunity.*` DENY for all 48 roles · every `report.*` inactive · `salesOrder.fulfill`/`.service` held by no governed Role · eleven Roles' `audit.event.read` refused by the service · cost authority unruled |
| **MEASUREMENT GAP** — this lane cannot answer from the evidence | **1** in the register; **4** in total across this document | no device/coverage/friction/operating-company evidence for 350 of 1,010 rows · production occupancy is a 2026-09-02 snapshot · handoff frequency unmeasurable · outside-EOS channels rest on authored narrative only |

### 7.1 The five unreachable gates, stated precisely

Re-measured at `64008d5a`: `REPORT_CAPABILITY_REQUEST` (`field-ops-app-vite/src/access/reportCapabilityAccess.js:30`)
resolves to **44 unique ids** from four lists; `buildHasCapability` grants only on an explicit
`decisions[id] === true`, so an id never requested is `undefined` → permanent deny.

| Capability | Gate site | Costs the person |
|---|---|---|
| `inventory.location.bin.manage` | `AdminWarehouseRacking.jsx:42`, checked `:158` | Nobody can rack a warehouse — **including `inventoryBinAdministrator`, the Role built to hold it** |
| `inventory.stock.relocate` | `access/scanWorkflows.js:91`, gate `:211` | The one scanner workflow that moves quantity can never be offered |
| `equipment.compatibility.view` | `domain/equipmentCompatibilitySection.js:13`, gate `:32` | *"which parts fit which machine"* is dead on the Part record |
| `financialPolicy.profile.read` | `AdminFinancialPolicy.jsx:39`, gate `:71` | The financial policy profile cannot be read |
| `financialPolicy.profile.configure` | `AdminFinancialPolicy.jsx:40`, gate `:72` | …or configured. *"Activating the capability would not help"* |

**Correction to the brief's phrasing:** it is **five capability ids at five gate sites spanning four
pages** (Financial Policy contributes two ids). *"Five built surfaces"* over-counts if "surface" means
"page". `inventory.location.bin.read` **is** in the 44 — only the `.manage` half is missing, so racking
reads and no control works.

### 7.2 Transport: confirmed zero, and what it forbids promising

`VITE_EOS_API_BASE_URL` appears in exactly **5 tracked locations in 2 files**, none of them an env file:
read at `field-ops-app-vite/src/services/adminPolicyApiClient.js:75` inside `policyApiBaseUrl()`;
absent → `failure("NOT_CONFIGURED", …)` at `:113-118`; and the source says so itself at `:26` —
*"absent in every environment today, because no EOS API is deployed."* The only tracked `.env*` file is
`integrations/chatgpt-eos-intake/.env.example` (no `VITE_*` keys); `vercel.json` has no env block;
`src/config/env.js` has **zero** `VITE_` references; `.gitignore` hides nothing.

**Therefore:** any requirement above that would be served by a Postgres-backed finance, CRM, commercial
or admin-policy read is a **gap, not a feature**. `WF-FIN-012` is the registry's single
`TRANSPORT_UNREACHABLE` record and states the transport exposes only `/health`, `POST /admin/policy`
and `POST /operations/inventory` — *"No finance route, no CRM route, no commercial route exists."*
This bites EXP-011, EXP-017, EXP-040, EXP-063, EXP-069 and EXP-103 directly.

---

## 8. Owner decisions raised by this lane

**This lane answers none of these.** Numbered for the synthesizer.

| ID | Decision required | Why it cannot be decided below the Owner | Blocks |
|---|---|---|---|
| **OD-EMP-001** | **What is the authoritative JOB ROLE, and what maps it to the 48 security Roles?** Today there are five disjoint vocabularies (`jobTitle` free text · `operationalRoles[]` 8 values of which 5 have no consumer · `securityRole` mirror · `users.role` legacy · 45 governed Roles) plus a sixth in the corpus, and **51% of authored work names a role the access model does not have.** | Choosing the authoritative vocabulary is an operating-model decision, not an engineering one | Every role-shaped queue: MY ACCOUNTABILITIES, MY APPROVALS, MY TEAM |
| **OD-EMP-002** | **Will any human be granted a governed business Role before the employee experience is designed?** Production holds 0 holders of all 45 (2026-09-02 census). Re-measurement needs production authorisation this lane does not have. | Only the Owner can authorise a production read or a grant | §6 in its entirety |
| **OD-EMP-003** | **Which office and commercial roles actually work on a phone?** 350 of 1,010 activities carry **no device field at all**, so sales, CRM, finance and administration mobile need is unmeasured in both directions. | Needs the Owner's knowledge of how these people actually work; cannot be inferred | EXP-075, EXP-076, all mobile composition for 10 role families |
| **OD-EMP-004** | **When the commercial capabilities are activated, which manager/individual visibility boundaries must exist first?** Today every boundary in §5.1 is enforced by what happens to be switched off. Field-level visibility within a document (G35) is named, unbuilt, and *"genuinely new capability"*. | Activation is the cheapest change in the programme and it opens the boundaries before the mechanisms | §5.1 rows 5–7; EXP-035 |
| **OD-EMP-005** | **Is there a governed "I could not complete this" outcome, and what does it do downstream?** The single most-cited gap in the corpus. A technician's real day — locked door, wrong address, machine fine, customer refuses over an unpaid invoice — has no governed expression; the state machine offers only `CANCELLED`. | It is a business-outcome decision with billing, scheduling and metric consequences | EXP-051, EXP-052, EXP-096, and the honesty of every on-time metric |
| **OD-EMP-006** | **Who is the escalation owner, per refusal class?** ESCALATION OWNER has no representation of any kind; FIN-007 approval policy (*"thresholds, approver roles, dual-control, escalation, expiry"*) is declared **not configured** on four Financials surfaces. | Naming escalation owners is an organisational decision | The whole MY ESCALATIONS bucket; EXP-053 through EXP-057 |
| **OD-EMP-007** | **Does a manager's team come from `managerEmployeeId` or from role parentage?** Two unreconciled answers; `performanceMetricRegistry.ts:105` records *"NO TEAM ENTITY EXISTS … EVERY salesManager sees EVERY salesperson."* | It determines whether EOS has teams at all | EXP-062, EXP-064, MY TEAM, §5 |
| **OD-EMP-008** | **Is a technician's performance figure contestable in the product?** Contestability is currently a conversation. | It is a fairness and employment decision before it is a feature | EXP-062, §5.2 |
| **OD-EMP-009** | **Does an operational record carry an operating company?** Work Orders do not. `OC_UNCLEAR` on 81 of 660 rows; Branch Parts Coordinator is **12 of 12**; a Ventana technician can act on a Taylor Work Order and *"nothing refuses"*. | The ownership model declares the axis and the operational path does not enforce it — closing it is an Owner ruling | EXP-010, EXP-018, EXP-020, EXP-029, EXP-032, EXP-069, EXP-103 |
| **OD-EMP-010** | **Is proficiency/certification modelled?** `P3B1-S17-A06` completes an uncertified job and *"Nothing warns."* | Safety and liability decision | EXP-067, EXP-068 |
| **OD-EMP-011** | **Is route/sequence authority in scope?** A technician's *"first and most valuable decision"* is sequencing his day; EOS has no travel, sequence, ETA or location authority and the handheld's central idea (*"a route, not a list"*) was never built. | It is a build-or-decline decision with real cost | EXP-001 |
| **OD-EMP-012** | **Do saved views become authority?** Deferred from every list *"for the same reason each time: needs somewhere to persist a named view. That is new authority"*, and there is **no administration surface for list/view configuration at all**. | It is a new authority | EXP-082, and the usability of every queue in §4.2 |
| **OD-EMP-013** | **Which single surface answers "what is this person's onboarding state?"** Seven records must be correct before a technician can tap Accept, with **no single view**, and the most common failure presents as an empty jobs list. | It crosses Administration, Service and Inventory ownership | EXP-003, EXP-066 |

---

## 9. MISSING INPUT

Where only the Owner's separate employee-design conversation can settle a requirement. **Not guessed.**

| # | The requirement that cannot be settled here | Why only that conversation settles it |
|---|---|---|
| MI-1 | **Which of the six buckets each role sees at all**, and in what precedence when several are non-empty | This is an operating-model choice about how people are asked to work. The corpus records what people *do*; it does not record what the Owner wants them *shown* |
| MI-2 | **Whether MY OWNED RELATIONSHIPS is a standing list or a periodic review** | Determines whether it is a persistent bucket or a scheduled prompt |
| MI-3 | **The intended attention precedence between an escalation to me and work assigned to me** | A policy decision about interrupting someone |
| MI-4 | **Whether after-hours work is a separate role or a rota on an existing one** — the corpus models `after_hours_coordinator` as a distinct role (5 activities, MOBILE default) and the access model has no such Role | Organisational |
| MI-5 | **What a manager may see about an individual's *day* as opposed to their *output*** | An employment-practice decision that §5.2 can frame and not settle |
| MI-6 | **Whether the apprentice/technician distinction is an experience distinction** — the corpus separates `apprentice_technician` (9 activities) from `field_technician` and EOS has no such split | Training-model decision |
| MI-7 | **The intended relationship between the three ratified sales channels and a salesperson's queue** — the ruling is silent on `STRATEGIC_ACCOUNTS` and the code says channel is a property of the **deal**, not the person | The ruling's own silence |
| MI-8 | **Whether the Retail vs National Accounts ruling implies two different Service Coordinator experiences** — sibling lane EMP-ROLE reports the corpus separates Coordinator from Dispatcher *"on exactly the dimensions the ruling demands"*; whether it also splits the Coordinator role itself is not in the evidence | The ruling's scope |

**Design r1 artifacts** (`docs/atlas/inputs/design-r1/`) — **confirmed absent** at this baseline by four
independent checks (`ls docs/atlas`, `find -type d -name design-r1`, `find -iname '*atlas*'`,
`git ls-files | grep -iE 'atlas|design-r1'`). There is no `atlas` path of any kind in this worktree.
**Not referenced and not reconstructed anywhere above.**

---

## 10. UNPROVEN

Stated plainly. Nothing in this list may be restated as a fact.

| # | Claim | Status |
|---|---|---|
| U-1 | **Every experience requirement in this document is authored, not observed.** The corpus is authored scenario material — *"authored ≠ observed practice"* — and **968 of 1,010 activities were never executed** | UNPROVEN |
| U-2 | The 42 executed activities prove **capability resolution only**. *"No Cloud Function was invoked, no Firestore Rules were evaluated, no Postgres connection was made, no HTTP request reached any deployed service"* | Bounded fact, not a workflow proof |
| U-3 | **No workflow in EOS has been demonstrated end to end.** 0 of 86 `WORKS_END_TO_END`; 27 gaps / 31 broken midway / 23 cannot start / 5 no implementation — independently recounted from `eos-workflow-registry.json` | Confirmed absence of a success measurement |
| U-4 | Production role occupancy is a **2026-09-02** snapshot; this baseline is **2026-09-12** | UNKNOWN — REVERIFY |
| U-5 | Whether any surface shows **time-in-status** | UNPROVEN (source: P3-A1/corpus) |
| U-6 | Whether a cancelled job is **shown as cancelled or silently vanishes** on the technician's phone | UNPROVEN |
| U-7 | Whether anything **escalates an aging offline intent** | UNPROVEN |
| U-8 | Whether **parts consumption on a cancelled Work Order** reverses, stands or is orphaned | UNPROVEN — and it is the cost of the only representable handoff |
| U-9 | Whether **route ordering or mapping exists** in any technician surface | UNPROVEN |
| U-10 | **Which technician composition real technicians see** (`TechnicianShell` vs `FieldMode`) | UNPROVEN (P3-A1 §8) |
| U-11 | Whether **detach** exists for an email attached to the wrong Work Order | UNPROVEN |
| U-12 | Whether **blocked time renders at 2-week grain** — *"A coarse view that hides a blocked-time collision is worse than no view"* | UNPROVEN |
| U-13 | Whether the **coordinated-visit pipeline** is granted or deployed anywhere | UNPROVEN (P3-A1 §8) |
| U-14 | **Dashboard composition Rules 2, 4, 7, 8 and 10** were not verified per tile | UNPROVEN (P3-A3 §6.3) |
| U-15 | The **outside-EOS channel** findings (phone / verbal / paper / spreadsheet) rest **entirely on authored narrative** | Hypothesis to test |
| U-16 | This lane's **38 registered-active** static count differs by one from the registry's executed **37 allowed anywhere in production**; the 1-id delta is unattributed. This lane cites **147 / 109 inactive / 37 ALLOW** and did **not** re-run the 48×147 resolver | Stated, not reconciled |
| U-17 | Whether the honest-state vocabulary (`EMPTY` / `NO_MATCHES` / `CAPABILITY_NOT_ENABLED`) is applied on every surface, or only on the technician jobs list where the corpus observed it | UNPROVEN — and EXP-003/§3.3 depend on it |

---

## 11. Corrections to this lane's brief

Five errors and three imprecisions, each measured at `64008d5a`.

| # | The brief says | Measured | Consequence |
|---|---|---|---|
| **C-1** | *"62 of 147 capabilities resolve ALLOW in production"* | **37.** The figure **62 appears in no document in any worktree.** The master brief §1.1 says *"37 of its 147 capabilities are allowed to anyone anywhere in production, and not one of them is commercial"*; `eos-workflow-registry.json` `executed_evidence.results_at_0ba8ab0d.allowed_anywhere_in_production = 37`; corpus `P3B3-MGMT-046` (**EXECUTED_PASS**) says *"Thirty-seven of the one hundred and forty-seven."* Static recount: 147 ids, **109** `active: false`, **38** registered active | **The brief overstates production reach by 25 capabilities.** Use 37 |
| **C-2** | *"Governed-role occupancy is unknown … no lane has established whether any human holds any of them"* | **A production census exists and is committed.** `docs/assessments/r32-production-exposure-census.json` (`be1e5579`, 2026-09-02, read-only, 0 writes): **2** `roleAssignments` total, **1** active assignment (compatibility `admin`, `employeeId: null`), **0** holders of any of the 45 governed Roles, `uniqueExposedPrincipals: 0` | **Stronger, not weaker.** Occupancy is not unknown; it is **zero**. Every role-keyed queue is measured-empty, not possibly-empty |
| **C-3** | *"45 governed business Roles are live authority"* — used as the security-Role count | **48 security Roles: 45 governed + 3 compatibility** (`admin`, `dispatcher`, `technician`, `compatibilityRoles.ts:350`). Confirmed by sibling lane EMP-ROLE and by the master brief's executed run (*"all 48 roles × all 147 capabilities"*) | Using 45 makes **~10% of authored work (101 activities under `dispatcher`/`technician`) falsely appear roleless** |
| **C-4** | *"Five built surfaces are unreachable"* | **Five capability ids at five gate sites spanning four pages** — Financial Policy contributes two ids (`.read` + `.configure`). Re-measured: `REPORT_CAPABILITY_REQUEST` = **44** unique ids | *"Five surfaces"* over-counts if "surface" means "page". The registry itself says *"3 records + one section"* when mapped to workflows |
| **C-5** | The corpus *"carries device context, coverage categories, exception/recovery behaviour and AI-opportunity fields **per activity**"* | True of **660 of 1,010**. **All 350 P3-B3 rows carry none of them** — no device, no coverage, no exception/recovery, no AI field, no friction block, no operating company | Every device/coverage/friction/AI figure has denominator **660**. Sales, CRM, finance and administration mobile need is **unmeasured in both directions** — a measurement gap, not evidence of desktop-only work |
| **C-6** | *"1,010 activities / 1,009 distinct"* | **All 1,010 record ids are unique.** The 1,009 is distinct **by title** — one title repeats (*"Attribute an operational record to the company that performed the work"*) | Minor, but "1,009 distinct activities" invites a wrong dedup |
| **C-7** | Corpus path `p3c-design-master-brief` | The worktree is **`p3c-design-brief`**; the P3-B3 corpus is **six** files (`p3b3-{sales,crm,financial,management,administration,adversarial}-activities.json`), not one glob of 350 in one file; the **86-workflow registry is not in this worktree** — it is `p3d-workflow-registry/docs/architecture/eos-workflow-registry.{json,md}` on branch `night/p3d-workflow-registry` | Path corrections only. The registry declares itself verified at `0ba8ab0d`, which **is** an ancestor of this baseline, so its figures are compatible |
| **C-8** | *"`roleAssignments` is the sole source of an ALLOW"* — implied as one read site | **True, and read at 15+ independent sites**, each declaring its own `ROLE_ASSIGNMENTS_COLLECTION` (`effectiveAccessFeed.ts:49` is the client-facing feed; plus finance, reporting, partMaster, performance ×2, workOrderLabor, receiving, transfer, cycleCount, dataImport ×2, reorder, employeeProfile), and `firestore.rules:1684` | The claim is confirmed and **understated**. It also means a queue's authority answer is assembled per domain, which compounds §3.1 |

### 11.1 One thing in the brief this lane could not verify and does not dispute

The brief's *"27 work with gaps, 31 break midway, 23 cannot start, 5 have no implementation"* is
**exactly confirmed** by an independent recount of the registry's `workflows[]` array (86 records) and
its `counts.by_state`. `WORKS_END_TO_END` **is** in the declared vocabulary, so its count of zero is a
measured absence rather than an unmodelled category. Evidence grades: `TRACED` 52, `EXECUTED` 34,
`INFERRED` 0 — and the registry narrows "executed" to capability resolution only.

---

## 12. The five requirements this lane would carry forward first

Not a plan and not a priority ruling — the five places where the evidence is strongest and the cost of
getting the experience wrong is highest.

| # | Requirement | Why first |
|---|---|---|
| 1 | **Attach why / next / recovery to every state.** | `NO_NEXT` 261/660 · `NO_WHY` 216/660 · `RECOVERY_UNCLEAR` 195/660. It is one defect, it is the largest, and it is mostly an ENGINEERING GAP — the facts usually exist |
| 2 | **Name the escalation owner on every refusal.** | 69 `PERMISSION_DENIAL` activities whose recovery is *"find someone"*, one of them a *"genuine structural dead end"*. Requires `OD-EMP-006` and nothing else |
| 3 | **Keep the six buckets distinct, and render the three that cannot be built as stated absences.** | Three of six keys do not exist; production occupancy is zero. A single "My Work" list would make all of that invisible |
| 4 | **Distinguish EMPTY from NOT-LINKED from CAPABILITY-OFF everywhere.** | The one start-of-day requirement EOS already satisfies somewhere, and *"A wrong honest state on day one costs an hour of somebody's time"* — and given §2.3 **day one is the normal case** |
| 5 | **Let width change composition and never authority.** | `P3B1-S10-A08` — the technician surface is chosen by **viewport width, not by user preference** — is a live violation of the rule, on the most mobile role in the business |

---

*Lane EMP-EXPERIENCE. Requirements only. **No UI designed, no screen specified, no layout proposed.**
No production contact, no deploy, no implementation. Read-only outside
`docs/operating-model/lanes/EMP-EXPERIENCE.md`. Nothing pushed.*
*OBSERVED AT: 64008d5a*
