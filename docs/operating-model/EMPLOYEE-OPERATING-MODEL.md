---
artifact_type: operating-model-canonical
lane: EMP-OWN-SYNTHESIZER
mode: EVIDENCE_WRITE
baseline: 64008d5ae0bdd9532909671b15a91122400accf1
baseline_tag: ATLAS-BASE-2026-09-12-A
date: 2026-09-13
status: Canonical integration of eight lane-local evidence documents. Discovery only.
implementation_status: NOT AUTHORIZED
---

# EMPLOYEE OPERATING MODEL — integrated synthesis

**OBSERVED AT: 64008d5a** applies to every code-derived claim in this document and in every sibling
artifact under `docs/operating-model/`.

This is the **single integration** of eight lane-local evidence documents, copied unmodified to
`docs/operating-model/lanes/` (6,460 lines) so the synthesis and its inputs travel together. Every
finding below is **attributed to the lane that established it**. Where this document re-derived a
figure it says so; where it could not, it attributes and marks it.

**This document does not answer Owner questions.** It consolidates them — see
[`EMPLOYEE-OPEN-DECISIONS.md`](EMPLOYEE-OPEN-DECISIONS.md).

**Nothing here authorizes implementation.** Every entry in
[`EMPLOYEE-ENGINEERING-IMPLICATIONS.md`](EMPLOYEE-ENGINEERING-IMPLICATIONS.md) defaults to
`IMPLEMENTATION STATUS = NOT AUTHORIZED`. Discovery does not authorize implementation.

---

## 0. Artifact map

| Artifact | Owns |
|---|---|
| **EMPLOYEE-OPERATING-MODEL.md** (this) | The invariant verdict · the twelve answers · the nine concepts · the conflict register · reconciliation with existing authority |
| [`EMPLOYEE-ROLE-MAP.md`](EMPLOYEE-ROLE-MAP.md) | Job roles, the five vocabularies, the corpus↔Role crosswalk, measured occupancy, persona conflicts |
| [`EMPLOYEE-WORK-MATRIX.md`](EMPLOYEE-WORK-MATRIX.md) | Real jobs vs module boundaries, per-job work facets, the 07:30 answer, work held outside EOS, the queues, "My Work", the manager boundary |
| [`OWNERSHIP-ACCOUNTABILITY-ASSIGNMENT-MATRIX.md`](OWNERSHIP-ACCOUNTABILITY-ASSIGNMENT-MATRIX.md) | The nine concepts × object families; where owner, assignee, company and accountability are confused |
| [`END-TO-END-OWNERSHIP-CENSUS.md`](END-TO-END-OWNERSHIP-CENSUS.md) | The 16-stage lifecycle per family · LIVE/INERT/MISSING/WRITE-ONLY · the orphan register |
| [`RESPONSIBILITY-HANDOFF-MODEL.md`](RESPONSIBILITY-HANDOFF-MODEL.md) | Continuity models A/B/C per workflow · what is lost between two people · departure and unavailability |
| [`EMPLOYEE-ESCALATION-MODEL.md`](EMPLOYEE-ESCALATION-MODEL.md) | Escalation per actionable workflow · the five modalities · the occupancy dependency |
| [`EMPLOYEE-ATLAS-HANDOFF.md`](EMPLOYEE-ATLAS-HANDOFF.md) | What must be true before any North Star family is operationally complete |
| [`EMPLOYEE-ENGINEERING-IMPLICATIONS.md`](EMPLOYEE-ENGINEERING-IMPLICATIONS.md) | The engineering-implication register · the seven-way backlog |
| [`EMPLOYEE-OPEN-DECISIONS.md`](EMPLOYEE-OPEN-DECISIONS.md) | The consolidated, de-duplicated Owner-decision set with per-lane provenance · MISSING INPUT · UNPROVEN |
| [`role-profiles/`](role-profiles/) | Seven profiles, only where three lanes supply substance. EMP-ROLE declined stubs; that judgement is respected — see EMPLOYEE-ROLE-MAP.md §8 |

---

## 1. Do not create a competing authority — what this synthesis references and does not restate

| Existing authority | Lines | Status at `64008d5a` | This synthesis' relationship |
|---|---:|---|---|
| `docs/specifications/employee-foundation.md` | 575 | Approved | **Referenced, extended, not restated.** Its schema at `:91-110` **predates** `jobTitle`, `managerEmployeeId`, `operatingCompanyId`, `employeeNumber`, `separationDate`. A reader of it alone concludes EOS has no manager field. (EMP-ROLE C-1 — that lane's most consequential correction; independently confirmed EMP-ACCT #7, OWN-DESIGN §4.3(ii)) |
| `docs/assessments/employee-foundation.md` | 438 | — | Referenced. Its four open architectural questions (`:334-348`) do not concern job roles (EMP-ROLE §9) |
| `docs/reviews/employee-foundation-architecture-review.md` | 163 | — | Referenced |
| `docs/implementation-plans/eos-ownership-backfill-plan.md` | 482 | — | Authoritative (EMP-ACCT §1). Not restated |
| `docs/assessments/eos-ownership-model-reconciliation.md` | 463 | Ratified | Authoritative rationale for D-1…D-16, Q1–Q4, O-1…O-4. **One correction: its prose says 50 families; its own class breakdown and two lanes measure 51** (EMP-ACCT #6, OWN-E2E EXECUTED, OWN-DESIGN confirmed) |
| `docs/specifications/record-ownership.md` | 257 | **Draft — states the SUPERSEDED model, unmarked** | **Cite only as superseded.** Verified at baseline: `:33` *"Whoever creates a record owns it."*; `:220` *"A create command never accepts an owner from input; the owner always resolves to the actor."* `creationOwnerResolution.ts:12-23` implements the opposite (D-4). Three lanes reached this independently (OWN-DESIGN AG-1/OD-OWN-013, EMP-ACCT #4, OWN-E2E) |
| `docs/OWNERSHIP.md` | 63 | IP / company / attribution governance | **Not a record-ownership authority.** Verified: its own header states it owns *"human/company ownership, attribution, and IP posture"*. Citing it for record ownership is a category error (EMP-ACCT #1, OWN-DESIGN §1, OWN-E2E) |
| `docs/north-star/financials/pages/` (20 pages, incl. `15-employee-performance.md`) | — | Already shipping | **Referenced and reconciled, never contradicted** (EMP-PERFORMANCE §2.1: 10 rows — 5 AGREE, 3 EXTEND, 2 CONFLICT-narrow). Do not restate |
| `functions/src/performance/performanceMetricRegistry.ts` | 839 | 37 metrics, 12 active, test-pinned | **Extend; do not mirror.** EMP-PERFORMANCE proposes no second registry (its handoff item 4) |
| `functions/src/ownership/ownershipMatrix.ts` | 51 families | Descriptive **and** prescriptive | The canonical record-ownership authority (EMP-ACCT #1). **Correction: "purely descriptive" is incomplete** — it is descriptive for `ownerFields` and prescriptive for `ownerClass`, `inheritanceSource`, `transfer`, `unresolvedPolicy`; `supplierCompanyTerms` is declared COMPANY and **its collection does not exist yet** (EMP-ACCT #5) |

---

## 2. THE INVARIANT, JUDGED

> **WHO IS RESPONSIBLE FOR MAKING SURE THE NEXT THING HAPPENS?**
> Exactly one accountable person for every actionable item; a named steward for reference/master
> data; **"nobody is responsible" is not an acceptable steady state**; **no handoff may create a
> responsibility gap.**

### VERDICT: THE INVARIANT IS NOT SATISFIED FOR ANY ACTIONABLE OPERATIONAL ITEM, AND EOS CANNOT DETECT THAT IT IS NOT.

Established by **EMP-ACCOUNTABILITY** (§0), corroborated in code by **OWN-DESIGN** (MG-1, EG-11) and
by execution in **OWN-E2E** (F-8, Probe A), and measured in the corpus independently by
**EMP-EXPERIENCE** and **EMP-WORK**.

**The mechanism is a composition of three individually-correct decisions.** No rule is broken.

| # | Decision | Where | Why it is right alone |
|---|---|---|---|
| 1 | Service and inventory work is **COMPANY**-owned, not person-owned (D-13, D-14) | `ownershipMatrix.ts` (`workOrder`, `workOrderLegacy`, `reorderRequest`) | *"The responsible operating company owns the job; the technician performs it."* Correctly refuses to call assignment ownership |
| 2 | Non-`ACTIVE` `employmentStatus` **fails closed** on every operational capability | `operationalRoleContext.ts:52`; `adminCredentialCommands.ts:183,223`; `firestore.rules isActiveOperationalRole` | A departed or on-leave person must not retain operating authority |
| 3 | Ownership **never cascades implicitly**; historical ownership stays historical | `ownershipHandoffCommand.ts` (verified verbatim at baseline: *"NO CASCADE. The command takes ONE record and produces ONE event… Handing off an Account leaves its Opportunities exactly where they were"*) | Prevents mass rewriting of history and silent mis-attribution |

**The composition.** A company owns the Work Order, so no person is accountable for it by ownership.
The only person on the record is the assignee, whose authority is revoked the instant they stop being
`ACTIVE`. Nothing may cascade to name a replacement. **Result: a live customer commitment with an
identifiable owning company, an identifiable performer who can no longer act, and no identifiable
accountable person at all** — the literal "NOBODY IS RESPONSIBLE" steady state. (EMP-ACCOUNTABILITY §0)

**Why it is invisible.** The person-owner derivation is **shape-only**. `deriveAccountOwner`
(`typedOwner.ts:95-109`) and `deriveEmployeeRefOwner` (`:112-125`) end at `isTypedOwner`, a pure shape
check; **neither ever reads an Employee document.** A record owned by a `TERMINATED`, deleted or
never-existent employee censuses as **RESOLVED**. `deriveCompanyOwner` (`:131-144`) does resolve
against the governed company authority. **The COMPANY axis has referential integrity; the PERSON axis
has none** — established by EMP-ACCOUNTABILITY, re-verified by OWN-DESIGN (§3.4, EG-11), and
**proven by execution** by OWN-E2E, whose Probe A accepted `USER:EMP-OLD → USER:EMP-NEW` (strings
naming no employee) while refusing arbitrary COMPANY ids with `NEW_OWNER_INVALID`.

**Two precisions OWN-E2E adds and this synthesis carries:**
1. The blindness is **deliberate and documented**, not accidental — `typedOwner.ts:45-48` cites Owner
   ruling O-1 excluding *"a fallible cross-collection lookup"*, and states a USER family's `UNKNOWN`
   count is *"structurally zero, not merely empty."* **The defect is that the census reports that
   structural zero as if it were a measurement, and the enforcement gate reads it as one.**
2. The COMPANY axis has **existence** integrity but not **active-status** integrity —
   `deriveCompanyOwner` resolves an `INACTIVE` company as `RESOLVED` by design (`:127-130`). So
   "COMPANY has referential integrity, PERSON has none" is right in direction and slightly too strong
   in degree.

### The Owner's worked example, tested

The Owner's example asserts five potentially-different people. EOS can express **two**.
(EMP-ACCOUNTABILITY §1; corroborated EMP-EXPERIENCE §2)

| Owner's role | Can EOS name this person? | Evidence |
|---|---|---|
| Account owner = salesperson responsible for the commercial relationship | **YES** | `accountOwner.assignedToEmployeeId`, PERSON/USER, HANDOFF |
| Work Order accountable person = service coordinator/manager responsible for the outcome | **NO** | `workOrder` is `ownerClass: COMPANY`, `ownerFields: []`, measured 0/30 |
| Service Visit assignee = technician performing it | **YES** | `assignedTechId` |
| Parts task assignee = whoever pulls or orders the part | **PARTLY** | `reorder_requests.assignedToUserId` + `currentOwner` role queue; `reorderRequest.ownerFields: []` |
| Escalation owner = manager when execution cannot proceed | **NO** | No escalation concept exists anywhere |

**The example is a correct statement of the business and is therefore evidence of the gap, not a
model to adopt on faith.** Its two unrepresentable roles are exactly ACCOUNTABLE PERSON and
ESCALATION OWNER. And the role value the example names for the Work Order — `SERVICE_MANAGER` — is a
label with no consumer (EMP-ACCOUNTABILITY §1.2; EMP-INFORMATION M-6; OWN-E2E F-7).

### The measured production consequence

**Production role occupancy is MEASURED AND ZERO.** Artifact verified present and tracked at this
baseline: `docs/assessments/r32-production-exposure-census.{md,json}`, landed by **`be1e5579`**
(2026-09-02, *"R-32 production exposure census — zero exposed principals (#1752)"*), confirmed by this
synthesis to be **an ancestor of HEAD**. Re-derived from the JSON at baseline:

| Measure | Value |
|---|---:|
| `roleAssignments` documents, total | **2** |
| `users` / `employees` / `warehouses` | 16 / 6 / 2 |
| Principals with any active assignment | **1** — `activeAssignments: ["admin@global"]`, a **compatibility** Role |
| That principal's `employeeId` | **`null`** — anomaly `PRINCIPAL_HAS_NO_EMPLOYEE_LINK` |
| `primaryExposure.uniqueExposedPrincipals` | **0** |
| `capabilityMatrix` | `[]` |
| Holders of any of the **45 governed business Roles** | **0** |
| The two production managers (`emp-rudy-parts-manager`, `emp-rudy-warehouse-manager`) | `state: OPERATIONAL_ROLE_ONLY`, `scopes: []`, `assignedWarehouseComparison: BOTH_EMPTY` — **no RoleAssignment whatsoever** |

**"Occupancy unknown" is WITHDRAWN.** It was carried by EMP-INFORMATION §10 (which quotes the
"capacity not occupancy" framing verbatim and may not read live data), by OWN-DESIGN UP-10 (which
searched `sb-evidence/` and `docs/audits/` and could not locate the artifact — **it lives in
`docs/assessments/`**), and by EMP-PERFORMANCE UNPROVEN-3/-8. It is **established** by OWN-E2E C-9/F-6
and **independently located and quoted** by EMP-EXPERIENCE §2.3.

**Three consequences, which must not be merged** (EMP-EXPERIENCE §2.3):

| Fact | Status | Bearing |
|---|---|---|
| The 45 Roles are **assignable** | AVAILABLE NOW | Capacity is real |
| **0** humans hold any of them in production (2026-09-02) | **MEASURED** | Every role-keyed queue is **measured-empty, not possibly-empty** |
| **29 of 45** Roles have no corpus job label; **51%** of authored work names no Role at all | **MEASURED** | Even after granting, there is **no mapping from the job to the Role** |

> **The gap is a GRANT, not a mechanism — for the occupancy half only.** The vocabulary half is not
> closed by any grant: grant every Role tomorrow and a role-shaped queue becomes *non-empty and keyed
> on the wrong thing.* Occupancy and vocabulary are two independent prerequisites.
> (EMP-EXPERIENCE §6)

**But for ownership specifically the occupancy question does not bite, and that is the sharper
finding.** **No work queue anywhere is keyed on an ownership fact** (OWN-E2E §7 stage 5). So the
failure mode is not "a queue keyed on a Role nobody holds is empty" — it is that **there is no
ownership-keyed queue to be empty in the first place.**

**Where occupancy bites hardest it is compounded by a worse failure:** `service.inboundWork.read` is
`active: false` (`permissionCatalog.ts:1612-1617`), so the one real queue in EOS **denies every
principal regardless of Role held.** A Role nobody holds and a capability nobody *can* hold are
different failures (OWN-E2E F-6).

### A fix on an unpushed branch is not a property of the product

Two defects the controlling brief had recorded as fixed are **LIVE at this baseline**. Both
re-verified by this synthesis:

| Defect | Verification at `64008d5a` |
|---|---|
| **The false-empty report defect.** A bounded 20,000-document page returning `"no matching records"`, audited as `outcome: "applied"` | **LIVE.** `field-ops-app-vite/src/domain/reporting/reportRunOutcome.js` still ships `message: "Running reports isn't available yet. Nothing was read or changed."` — read directly at baseline. `UnprovenAbsenceError` / `reportRunIncompleteScan` do not exist in any lane worktree; the fix is on unmerged `rpt-client` (`b8308e48`, `9d3ab48d`). **EMP-INFORMATION B-8 — the single most dangerous live information defect at this baseline** |
| **The five unreachable surfaces.** Five capability ids gated on ids never in the access-feed request set → permanent deny for every principal in every environment, and **the user is told nothing** | **LIVE.** The fix (`shellCapabilityGates.js`, `17a96ed3` in `p2g-cap-request`) is in no lane worktree. EMP-INFORMATION B-9; re-measured by EMP-EXPERIENCE §7.1 as **five ids at five gate sites spanning four pages** — `inventory.location.bin.manage`, `inventory.stock.relocate`, `equipment.compatibility.view`, `financialPolicy.profile.read`, `financialPolicy.profile.configure`; `REPORT_CAPABILITY_REQUEST` = **44** unique ids |

**The controlling brief was wrong to call these fixed. That correction is upheld and carried.**

### The two-field activation trap — re-derived at baseline

Adopting **EMP-INFORMATION's framing verbatim** because it is the clearest statement of the failure:

> *"All 39 `report.*` ids are `active:false` in the catalog AND 25 are production-activated — a reader
> of either file alone reaches the opposite conclusion."*

Re-derived by this synthesis from `config/environments.json` and `permissionCatalog.ts`:

| Measure | Value |
|---|---:|
| `report.*` ids in the catalog | **39** |
| `taylor-parts-production.productionCapabilityActivations` | **25**, and **all 25 start `report.`** (verified) |
| `taylor-parts-production.capabilityActivationOverrides` | **absent / 0** |
| `platform-sandbox` / `platform-certification` / `platform-integration` / `local-emulator` overrides | 92 / 3 / 0 / 0 — and **`productionCapabilityActivations` = 0 on all four** |
| `environmentCapabilityOverrides.ts:354` | verified verbatim: `if (env.role === "production") return EMPTY;` — *"Hard-block #2: role-keyed. A production environment yields EMPTY no matter what its registry entry says"* |

**The two fields are read by different resolvers.** The overrides path returns EMPTY unconditionally
for `role === "production"`; production activation reaches runtime only through
`productionCapabilityActivations`, introduced by `DECISIONS #169` *precisely because the other
field's production hard-block is absolute*. **This is why EMP-EXPERIENCE U-18 could find no mechanism
by which a `report.*` id is adopted in production and recorded the claim as refuted at this baseline
— it measured the overrides field.** Both lanes are right about the field each measured. The
distinction is the resolution.

**Unscoped set is 24, not 25** — `report.definition.read` is already per-owner row-scoped
(`savedDefinitionCommands.ts:404` issues `.where("ownerUid","==",actorUid)`). **25 is a floor**: under
the last recorded production Functions deploy (pinned `fb45e6ee`) 36 of 39 are `active: true`
(EMP-INFORMATION U-8). Both readings preserved — see conflict **E-2**.

---

## 3. THE NINE CONCEPTS — never collapsed, never into `ownerId`

Integrated from EMP-ROLE §2, EMP-ACCOUNTABILITY §1, OWN-DESIGN §2–§4, EMP-EXPERIENCE §2.
**No field, collection or schema is proposed for any row.**

| # | Concept | Represented? | Storage at `64008d5a` | Integrated verdict |
|---|---|---|---|---|
| 1 | **RECORD OWNER** | **YES, under four field names** | `accounts.accountOwner` (a 7-key Person Assignment map, ownership-bearing key `assignedToEmployeeId`); `contacts.owner` / `locations.owner` (typed `{type,id}` maps); `ownerEmployeeId` on `opportunities`/`sales_agreements`/`sales_orders`; `operatingCompanyId` on COMPANY families; `reportDefinitions.ownerUid` (a Firebase uid) | **PARTIAL.** Governed and distinct — and **there is no single key to query "what is mine" on.** 14 of 27 ownable families have no owner storage at all. **Three tiers the matrix does not express** (OWN-DESIGN §3.1, OD-OWN-015): LIVE · BACKFILL-ONLY · DECLARED-NEVER-AUTHORED. A non-empty `ownerFields` is **not** evidence of populated ownership |
| 2 | **ACCOUNTABLE PERSON** | **NO — no field, no concept, no vocabulary** | none, anywhere. Zero hits for `accountable` in `functions/src/ownership/*.ts` | **ABSENT — the central MODEL GAP** (EMP-ACCT concept 2; OWN-DESIGN MG-1, all 20 COMPANY families). EMP-EXPERIENCE frames it as *"collapsed into RECORD OWNER"*, citing `ownershipMatrix.ts:22` *"business responsibility belongs to an employee"* — see conflict **A-1**; both readings hold |
| 3 | **ASSIGNEE / EXECUTOR** | **YES, and deliberately walled off from ownership** | `assignedTechId` / `scheduledTechId` (Work Order — **two distinct fields, neither ownership**, `types/workOrder.ts:107,122`); `assignedToUserId` (reorder); `assignedDriverEmployeeId` (`trucks`, **explicitly not custody**); `technicianId` (legacy `fieldops_jobs`) | **PARTIAL and the model's strongest part.** `ownershipMatrix.ts:227,259` forbids deriving owner from assignee by name. **No uniform `assigneeId`**, so a cross-domain "my assigned work" queue must be assembled per domain. The **only** bucket with a real working key today (EMP-EXPERIENCE §3.1) |
| 4 | **MANAGER** | **YES — and twice, unreconciled** | (a) `employees.managerEmployeeId`, `kind: "MANAGER"` (`employeeProfileCommands.ts:214`), relationally validated inside the transaction (`:498-515`), self-manager refused (`:534-538`). (b) role parentage in `roleHierarchy.ts`, which is what `hierarchicalVisibility.ts` actually resolves | **AMBIGUOUS — neither usable for escalation.** See conflict **AU-1**. (a) is read by **four display/metadata sites only** and has **zero authorization, visibility or routing readers**. (b) yields a **set**: *"With role-only hierarchy, EVERY salesManager sees EVERY salesperson"* (`roleHierarchy.ts:16`). `performanceMetricRegistry.ts:105`: ***"NO TEAM ENTITY EXISTS."*** Accountability requires exactly one person; role-derived hierarchy structurally cannot supply one |
| 5 | **ESCALATION OWNER** | **NO — no representation of any kind** | none. Every repo hit for `escalat*` is (a) privilege-escalation security prose, (b) FIN-007 approval policy recorded **unconfigured** on four Financials surfaces, or (c) a statement that something is **not** escalated | **ABSENT** (EMP-ACCT §5 exhaustive search; OWN-DESIGN MG-2 uniform across all 25; OWN-E2E stage 14 MISSING at the **model** level for every family; EMP-EXPERIENCE — `MY ESCALATIONS` cannot be built at all) |
| 6 | **OPERATING COMPANY** | **YES on the commercial axis — ABSENT on the operational axis** | `operating_companies` (`taylor`, `ventana`, D-2); `employees.operatingCompanyId`; `operatingCompanyId` on records; `companyId` on the financial tier; `companyScopeField` on three rows | **PARTIAL / MODEL GAP.** The model is one of the strongest in EOS **and it is not in the operational path.** No Work Order carries one and `DECISIONS #143` **forbids inferring it**. **A grep for `operatingCompanyId` misses the entire financial tier**, which stores `companyId` (OWN-DESIGN §3.1, OD-OWN-008) |
| 7 | **DOMAIN STEWARD** | **NO — does not exist** | Repo-wide, `steward` returns two hits and neither is a representation: `inboundCandidateResolution.ts:6` (*"no stewardship here on purpose"*) and an implementation plan naming a model-steward as **not built** | **ABSENT** (EMP-ACCT §2.7; OWN-DESIGN MG-3, most acute on the 7 REFERENCE families; EMP-EXPERIENCE concept 7). **And there is no vocabulary it could be stored in** — `jobTitle` is free text, `operationalRoles` is 8 closed values with 3–5 unconsumed, the 48 security Roles are authorization |
| 8 | **SECURITY ROLE** | **YES — and the set is 48, not 45** | 45 governed (`governedBusinessRoles.ts`) + 3 compatibility (`admin`, `dispatcher`, `technician`, `compatibilityRoles.ts:350`), **overlap 0**. Authority is the `roleAssignments/{id}` document; `employees.securityRole` is a **read-only mirror** that `updateEmployeeProfile` refuses by name | **AVAILABLE as capacity, MEASURED ZERO as occupancy.** Re-derived by this synthesis: 45 + 3. EXECUTED by OWN-E2E; corroborated by EMP-PERFORMANCE (`ROLES 48` in the executed transcript header) and EMP-INFORMATION B-4. **Load-bearing**: the 3 compatibility Roles are the **only** ones Firestore Rules can see, and they carry the ownership-write exposure |
| 9 | **JOB ROLE** | **NO — five disjoint vocabularies, no mapping** | `jobTitle` (free text) · `operationalRoles[]` (8) · `employees.securityRole` (mirror) · `users/{uid}.role` (3, legacy, *"the role that actually decides what a user can see"*) · 45 governed Roles. **A sixth in the corpus** | **MODEL GAP — the most experience-blocking of the nine** (EMP-ROLE F-3, the lane's central structural finding; EMP-EXPERIENCE §2.1). **51% of authored work names a role the access model does not have** |

**Four of the nine must first EXIST before the instruction "never collapse them" can be obeyed**
(EMP-ACCOUNTABILITY #9): ACCOUNTABLE PERSON and ESCALATION OWNER have no representation, MANAGER is
ambiguous, JOB ROLE has no usable vocabulary.

**The one-line conclusion, adopted from EMP-ACCOUNTABILITY §8 because nothing improves on it:**

> **EOS reliably distinguishes ownership from assignment, and has no third term for accountability —
> so accountability gets read into whichever of the two is present. On an Account that is ownership
> (and works); on a Work Order it is assignment (and breaks).**

### The precedent for a second axis already exists — cited, not proposed

Recorded as precedent by OWN-DESIGN (§3.5, OD-OWN-018) and EMP-ACCOUNTABILITY (§6.4, §9), and
carried here because **both lanes reached it independently and neither proposes a schema:**

1. **`companyScopeField`** (`ownershipMatrix.ts:86-96`) — one record carrying two true, independent
   facts, with the column's own comment insisting *"This column is NOT ownership"* and that it exists
   *"so the financial lineage Sales Order → Invoice → Payment can inherit a company without anyone
   concluding the company displaced the salesperson."*
2. **Ruling R-20's accept-in-storage / refuse-in-assignment asymmetry**
   (`warehouseRootCompanyAssignment.ts:39-45`) — *"Storage validity and assignment eligibility are
   different questions. A warehouse may legitimately keep carrying the id of a company that later went
   inactive — that is history, and this command never rewrites it. But creating a NEW operating
   relationship with an already-inactive company is refused… deliberately and not by oversight."*

**This is the correct semantics for a departed employee, already designed, already tested, and
applied only to the company axis.** The person axis has neither half. **Whether such an axis should
exist at all is `OD-1`. No field is proposed here.**

---

## 4. THE TWELVE ANSWERS

### Q1. Can EOS currently identify one accountable person for every actionable business item?

**NO — for zero of 27 ownable families, and it cannot detect the failure.** §2 above is the full
answer. In summary:

| Layer | Finding | Lane |
|---|---|---|
| Model | ACCOUNTABLE PERSON has no field, concept or vocabulary anywhere | EMP-ACCT · OWN-DESIGN MG-1 · EMP-EXP |
| Distribution | **20 of 27** ownable families are COMPANY; **1** PARTICIPATING_COMPANIES; **6** PERSON — **and all 6 PERSON families are commercial.** Every operational family (service, inventory, purchasing, finance, physical) is owned by a company. **A company cannot be asked why the next thing has not happened** | EMP-ACCT §9 |
| Storage | **14 of 27** ownable families have empty `ownerFields`; **38 of 51** matrix rows describe storage that does not exist | OWN-E2E (EXECUTED) |
| Detection | The person axis is shape-only, so a record owned by a terminated employee censuses `RESOLVED`. **The census cannot be used as evidence that person ownership resolves** | EMP-ACCT §0 · OWN-DESIGN EG-11 · OWN-E2E F-8 (EXECUTED) |
| Reporting | *"Which accounts have no owner"* — the question the whole commercial chain depends on — **cannot be built.** `report.customer.field.accountOwner.read` is deferred to wave 4 (`permissionCatalog.ts:735-739`) | EMP-ACCT ORPHAN-13 · OWN-E2E EG-10 |
| Occupancy | Every role-shaped stand-in for accountability is **measured-empty in production** | EMP-EXP §2.3 · OWN-E2E C-9 |
| Corroboration | **166 of 660** tagged corpus activities carry `ownershipUnclear: true` — **one in four**, flagged by the corpus's own authors independently of any lane | EMP-EXP §0.4 · EMP-ACCT §3 · OWN-DESIGN §8 |

**A necessary qualification.** Being unable to name an accountable person is **not** the same as the
ownership model being wrong. **OWN-DESIGN §7.3 establishes that a COMPANY answer on those 20 families
is the model's correct output** — D-13, D-15 and D-14 each state it affirmatively — and that MG-1 is
about a **different column**. EMP-ACCOUNTABILITY §9 reaches the same place from the other side: the
ownership model is, for operations, a **books-and-records** model rather than an accountability model,
*"and that is a legitimate thing for it to be."* **Both lanes agree. The gap is the absence of a
second axis, not a defect in the first.**

### Q2. Which families and workflows can become responsibility-orphaned?

Two registers at two granularities, **neither a subset of the other** — OWN-E2E counts *families with
an orphaning mechanism*, EMP-ACCOUNTABILITY counts *workflows with a structural orphaning path*. Full
merged register in [`END-TO-END-OWNERSHIP-CENSUS.md`](END-TO-END-OWNERSHIP-CENSUS.md) §4. Headline:

**13 families** (OWN-E2E §10) and **13 workflows** (EMP-ACCOUNTABILITY §7). The five that matter most:

| Rank | Orphan | Mechanism | Lane |
|---|---|---|---|
| 1 | **Work Order past `Dispatch`** · CRITICAL | Five committed states (`DISPATCHED`/`ACCEPTED`/`EN_ROUTE`/`ARRIVED`/`WORK_IN_PROGRESS`) whose only exits are the next **technician-only** step (`requiresOwnAssignment: true`) or `CANCELLED`. **EOS's only expressible response to an unavailable technician is to cancel the record of a live customer commitment.** Compounded: the double-booking guard means an orphan **permanently consumes its technician's dispatch capacity** | EMP-ACCT ORPHAN-1 · OWN-E2E F-9/WG-6 · EMP-WORK |
| 2 | **`workOrder` (`fieldops_wos`)** | **No storage at all** — `ownerFields: []`, measured 0/30. Permanently orphaned by construction. Note: the **legacy** `workOrderLegacy`/`fieldops_jobs` *does* store `operatingCompanyId` — the two families differ and must not be generalised | OWN-E2E C-4 · EMP-ACCT #3 |
| 3 | **`warehouse` + `mobileLocation`** | No storage; `OWNERLESS_UNTIL_SUPPLIED`; **12 Owner root decisions outstanding.** Their orphanhood **propagates** to every location-derived family and **blocks the live reorder path**, which is complete, live, fail-closed and **currently refusing every request in every environment** | OWN-E2E F-5 · OWN-DESIGN WG-1 |
| 4 | **`invoice`, `payment`, `paymentApplication`, `invoiceAdjustment`, `refund`** | No storage **and** `IMMUTABLE` — so ownership can never be *added* through a handoff either. **Orphaned and unfixable by the handoff authority.** (And the matrix's `ownerFields: []` on this block **is factually wrong** — `companyId` is required and written) | OWN-E2E §10 · OWN-DESIGN OD-OWN-008 |
| 5 | **Terminated employee as perpetual inheritance root** | A departed Account owner remains the **governed default owner of records that do not yet exist.** Departure does not leave a backlog; it **seeds new orphans indefinitely** | EMP-ACCT ORPHAN-4/§6.3 |

**Two families are ungoverned *and* unmeasured:** `inbound_work_requests` (live collection, live
queue, stamps a governed `operatingCompanyId`, **absent from all 51 matrix families**) and
**Approval/Exception** (no collection, no family, six field vocabularies across six surfaces).

**Zero of the 86 registry workflows are `WORKS_END_TO_END`** — and that zero is *"the absence of a
measurement, not a measurement that they fail"* (EMP-INFORMATION U-13, quoting the registry).

### Q3. Where does EOS confuse owner and assignee?

**The platform is mostly very good at this and the exceptions are specific.** Full table in
[`OWNERSHIP-ACCOUNTABILITY-ASSIGNMENT-MATRIX.md`](OWNERSHIP-ACCOUNTABILITY-ASSIGNMENT-MATRIX.md) §5.
The four real confusions:

| # | Confusion | Verdict | Lane |
|---|---|---|---|
| 1 | **`accounts.accountOwner` stores ownership INSIDE an assignment record** — a 7-field Person Assignment map (`assignedToEmployeeId`, `assignedToUserId`, `assignedToDisplayName`, `assignedByEmployeeId`, `assignedByUserId`, `assignedByDisplayName`, `assignedAt`), projected back out as ownership at `typedOwner.ts:95-108`. `customerMigrationSource.ts:127-158` compounds it by accepting **two** owner shapes on the same field | **VOCABULARY CONFUSION AT THE STORAGE LEVEL, not just the label.** EMP-ACCT: *"the platform's best-provenanced structure, describing ownership in the language of assignment — which is why 'who accepted it' was never asked."* Combined with no Rules guard and an unreachable governed setter, OWN-E2E calls it **the single highest-value corruption path in the model** | EMP-ACCT §8 · OWN-E2E §8 |
| 2 | **`reorder_requests.currentOwner` is a role queue named `currentOwner`, and it is the only "owner" the user sees.** Displayed as **"Current owner"** directly above **"Assigned to"** (`PartDetail.jsx:1131-1141`) while the record's **actual** company owner (`operatingCompanyId`) is never rendered at all | **REAL, and actively misleading.** Three responsibility concepts on one document with the role queue rendered under the word "owner". **Remedy contested — see conflict A-3** | OWN-E2E §8/§7 note † · EMP-ACCT §8 · OWN-DESIGN OD-OWN-014 |
| 3 | **The Reorder Approve/Assign branch makes assignment an ownership move, and Rules enforce it.** `firestore.rules:765-790`: the Assign branch changes `currentOwner` to `"PARTS_ASSOCIATE"` **and** sets `assignedToUserId` in one write, `affectedKeys().hasOnly([...])`. The Approve branch writes `currentOwner == "PARTS_MANAGER"` with **no assignee at all** | **THE ONE GENUINE CONTRADICTION OF "reassignment ≠ ownership transfer" IN EOS.** The defence — that `currentOwner` holds a role and was never ownership — is precisely the naming collision `domain/constants.js:276-287` warns about. **A field named `currentOwner`, mutated by an approval, is the collision doing damage** | OWN-E2E AG-9 (CONFIRMED) |
| 4 | **Sales Order `ownerEmployeeId` vs fulfilment** — the record names the salesperson and **nobody** who must ship it, so "owner" silently absorbs a question it does not answer | **REAL CONFUSION BY OMISSION.** ORPHAN-5: *"The order-to-cash chain has a step in the middle that belongs to nobody in the governed model"* — an **AUTHORITY GAP**, a missing *role definition*, not a missing field | EMP-ACCT ORPHAN-5 |

**The counter-examples must travel with them** — EOS holds the distinction correctly in six places,
and they are the model's load-bearing correct parts:
`reassignWorkOrderTechnician` is a **separate audited action** from `OWNERSHIP_HANDOFF`, with
`reassignedFromTechId`/`reassignedAt`/`reassignedReason` denormalized and a required reason (H20) —
**the code-level proof that reassignment ≠ ownership transfer** (OWN-DESIGN Panel B; EMP-ACCT Q16,
*"the only audited person-change in the platform"*) · `truckRegistry.reassignDriver` vs
`trucks.operatingCompanyId` · `explicitTitleHolder` vs record ownership (D-3) · `sales_territories` /
`commercial_coverage_assignments` vs ownership (EXCLUDED, *"coverage is not ownership, credit,
commission or security"*) · `reorderCommands.ts:200-202` — `requestedBy` is *"The ACTOR. Deliberately
not the owner"* · `equipment` Rules `hasOnly(equipmentEditableKeys())` **omitting**
`operatingCompanyId`.

**And one construct that is correct as authorization and dangerous as accountability:**
`requiresOwnAssignment` makes the assignee the **only** possible actor, converting an assignment gap
into a hard lock (EMP-ACCT §8; OWN-E2E WG-6 — *"One administrative click can immobilise a day's field
work"*).

### Q4. Where does EOS confuse company ownership and employee accountability?

**The ruling "operating-company authority ≠ employee accountability" is the one most at risk, and the
line has already been crossed once — for defensible reasons.** (EMP-ACCOUNTABILITY §9)

| Place | What happened | Verdict |
|---|---|---|
| **D-13 / D-14** — `fieldops_jobs`, `fieldops_wos`, `reorder_requests` reclassified **PERSON → COMPANY** | Justified as *"the responsible operating company owns the job; the technician performs it"* | **Correct about ownership, and it silently vacated the accountability question.** Reclassifying away from PERSON removed the only person-shaped field these families had, and nothing replaced it. **This is the moment the invariant became unsatisfiable for service work** |
| **D-15** — financial artifacts **PERSON → COMPANY** | *"A ledger entry belongs to the books it lands in, not to the salesperson upstream of it… accounting ownership and sales credit are different questions and must not share one field"* | **Correct**, and it explicitly preserves attribution via lineage. Same vacating effect for **collections accountability** — `WF-FIN-005` *"Chase what is owed"* has actors and no accountable party |
| **`companyScopeField`** on opportunity / agreement / salesOrder | The matrix guards the distinction **explicitly**: *"Do not interpret `operatingCompanyId` as replacing salesperson ownership… one record with two true, independent facts"* | **EXEMPLARY. Propagate this pattern, not the D-13 one** |
| **`employees.operatingCompanyId`** | A person belongs to a company | Correct, and **not** an accountability statement |
| **R-20** `warehouseRootCompanyAssignment` | Company lifecycle gates assignment but not storage | **EXEMPLARY — and the pattern the person axis needs** (§3 above) |
| **`equipment` owner vs `explicitTitleHolder`** | A `CUSTOMER` may hold legal title without owning the internal record; `accountId` is the **CUSTOMER**, neither is an owner | **Correctly separated** (D-3), and the matrix says so explicitly to stop a future reader "reconciling" them |
| **`employees` carries TWO company fields, neither authoritative** | `companyId` declared *"Future — reserved, unused this sprint"*; `operatingCompanyId` **live-editable** in `EDITABLE_EMPLOYEE_FIELDS` (`employeeProfileCommands.ts:215`) and **not** set by `provisionEmployeeAccess.js`, so it exists only where someone later edited a profile | **AUTHORITY GAP** (OWN-DESIGN AG-5). And `metadata/definitions/employee.js` records `companyId`/`departmentId`/`locationId` as reserved with **every write path setting all three to `null` unconditionally** (EMP-INFORMATION M-5) — **so there is no per-person anchor to scope any number by** |
| **`roleAssignments` company/business-unit scope bindings** | DECISIONS #157, `financialVisibility.ts:40-48` | **The only place a company binds to a person — and it is ACCESS authority, not employee accountability** (OWN-DESIGN Panel D) |

**The structural finding:** the financial company axis is **CLOSED** (`operatingCompanyId` is
NOT NULLABLE on any reportable financial event; absence is a refusal, never a null to backfill) while
the operational company axis is an **AUTHORITY GAP** (`NO_GOVERNED_COMPANY_SOURCE`; `DECISIONS #143`
**forbids inferring** it from technician, dispatcher, creator, customer or location).
**Consequence (EMP-PERFORMANCE OD-EMP-003): any per-company or per-business-unit *operational* metric
is a GAP, not a requirement.** The single **duplicated** activity in the entire 1,010-record corpus is
exactly this blocker — *"Attribute an operational record to the company that performed the work"*
(`P3B3-FIN-056` ≡ `P3B3-MGMT-018`, byte-identical title, same actor, same `BLOCKED` status).

### Q5. Which records have an ownership model but no runtime handoff?

**All 14 HANDOFF-capable families** — and they are **not uniform**. This synthesis **re-derived the
count and closes conflict E-10**: 12 families carry `transfer: "HANDOFF"` as a literal, and the spread
block at `ownershipMatrix.ts:311-325` emits **`warehouse` + `mobileLocation`** from one literal with
`transfer: "HANDOFF" as const`. **12 + 2 = 14**, matching OWN-E2E's EXECUTED Probe A
(*accepts 14 / refuses 37; `FAMILY_IMMUTABLE` ×12, `FAMILY_NOT_OWNABLE` ×24,
`FAMILY_PARTICIPATING_COMPANIES` ×1*). **The earlier 13 was a static count that missed a spread
block.** OWN-DESIGN had already adopted 14 (its §14).

The 14: `account` · `contact` · `location` · `opportunity` · `salesAgreement` · `salesOrder` ·
`workOrder` · `workOrderLegacy` · `reorderRequest` · `warehouse` · `mobileLocation` · `truck` ·
`supplierCompanyTerms` · `equipment`.

**Three distinct failure shapes** (OWN-E2E §11 — the distinction is the point):

| Shape | Families | What it means |
|---|---|---|
| **INERT** — model exists, nothing can change the owner at all | `contact`, `location`, `workOrder`, `reorderRequest`, `warehouse`, `mobileLocation`, `truck`, `supplierCompanyTerms`, `equipment` (9) | Safe but dead. No handoff, and no other mutation path either |
| **UNGOVERNED CHANGE PATH** — the owner *is* changeable, by a path that is not a handoff and emits no handoff audit | `account`, `contact`, `location`, `workOrderLegacy` (4, via Rules) — **`account` most acutely**, since the client write ships in `AccountForm.jsx:162-171` while the governed setter `assignAccountOwner` (`customerRepository.ts:182-196`, calling itself *"the ONLY way one is ever set after creation"*) **is exposed by no callable and called by no UI** | **Worse than absent.** Model + no handoff + unguarded mutation = an audit trail that cannot be reconstructed. Stage 7 for `account` is therefore **M, not I** |
| **PARTIAL, BYPASSING** — a real, live, shipped owner-change control that routes **around** the handoff authority | `opportunity` only — `OwnerSelect.jsx:21` → `updateOpportunity` (`opportunityCallables.ts:387`), diff at `opportunityCommands.ts:312-318` | The *fact* of the change is auditable as a field diff; the **handoff semantics** — from whom, to whom, under which of the three `OWNERSHIP_HANDOFF_SOURCES`, and why — are **not** captured. **The one place ownership genuinely moves in production is the one place the handoff vocabulary is not used** |

`salesAgreement` and `salesOrder` sit between the first two: owner displayed, **no change control at
all**, collections `if false` to clients — INERT by Rules rather than by omission, *"which is the
better of the two failure modes."*

**And the headline that makes wiring it dangerous — OWN-E2E F-1, EXECUTED:** all five family-level
refusals live **only** in the uncalled `ownershipHandoffCommand`. The **LIVE** `auditEventWriter`
imports only `typedOwner` (`:58`), **never `ownershipMatrix`**, validates `targetType` as nothing more
than a non-empty string (`:470-471`), and **ACCEPTED an `OWNERSHIP_HANDOFF` event for every case the
builder refuses** — an invoice, a payment, a part, an audit event, a role assignment, a transfer
order, a nonexistent family, and an Account given a COMPANY owner. **Wiring the handoff by calling the
audit writer directly — the shortest path — would produce exactly the corruption the matrix was
written to prevent.**

**"Handoff is INERT" is half-true and must be stated precisely** (three lanes independently):
inert as a **deployed callable** (no `functions/src/index.ts` importer — verified: zero occurrences of
`ownership` in 87 exports); **live as an operator CLI** for one COMPANY family —
`functions/scripts/assignWarehouseRootCompany.js:72,234` calls `stageOwnershipHandoff` inside a real
transaction. **Not activated by any lane, and not activated here.**

### Q6. Which records have responsibility in business practice but nowhere to represent it?

Integrated from OWN-DESIGN §6, EMP-WORK §4 (44 named instances) and EMP-ACCOUNTABILITY §2.7.

| The business fact | Why EOS cannot represent it | Class |
|---|---|---|
| **A named person answerable for a company-owned operational record** — Work Order, Service Visit, Equipment, Warehouse, Truck, Cycle Count, Purchase Order, Transfer Order | The model has PERSON-owner, COMPANY-owner, assignee and credited-salesperson and **no fifth slot.** `trucks.assignedDriverEmployeeId` is the only near-miss and is explicitly not custody | MODEL (MG-1) |
| **A company answerable for a Work Order** | No company field exists, and **every** candidate on the record (technician, dispatcher, creator, `assignedTo`, customer, location name, `lineOfBusiness`) is a **prohibited proxy** | ENGINEERING (EG-1) + WORKFLOW (WG-2) |
| **An escalation target, on any family** | No escalation storage of any kind; `managerEmployeeId` exists and is unread | MODEL (MG-2) + ENGINEERING (EG-2) |
| **A curator for shared master data** — Part, Manufacturer, Equipment Model, Supplier Catalog Item, Part Alias, Part Supplier Item | `REFERENCE` correctly says *"no business **owner**"*. **It does not say "no **curator**", and there is no role vocabulary a curator could be stored in.** `inventoryCatalogAdministrator` exists as a capability while no record names a person accountable for catalog correctness | MODEL (MG-3) |
| **The customer promise** — *"The coordinator picks up the phone. The promise lives outside EOS."* | No object. **The single most important accountable commitment in the business has no record at all** — so cancelling a Work Order (ORPHAN-1) does not cancel the promise, and EOS never knew about the promise to begin with | MODEL · `OD-11` |
| **The dispatcher shift handoff** — *"Every in-flight decision — who was phoned, which customer was promised what — is verbal."* The activity feed is **session-only** | No shift-note or handover surface | MODEL |
| **Labour time** — *"captured outside EOS, on paper or in payroll, and the Work Order carries none."* | `workOrder.labor.record` and `.correct` are `active: false` **and absent from every activation array, `platform-sandbox` included** — 2 of the 17 dead-in-every-environment ids (EXECUTED). Storage ships (`work_order_labor_entries`, callables exported at `index.ts:483-484`) with **no `firestore.rules` match block**. Two governed Roles declare the capabilities and grant nothing | AUTHORITY (EMP-PERF §3.5, OD-EMP-002) |
| **Competence** — certification, skill, proficiency | **Wholly unmodelled**, and explicitly out of scope in `employee-foundation.md:67-72`. `P3B1-S17-A06`: an apprentice completes a job requiring a certification he does not hold → *"Nothing warns."* **Three subsystems that should gate on competence read none of it** — the recommendation engine, the scheduler and the transition engine. **This is the one item with NO outside channel: the phone holds the promise, paper holds labour, a spreadsheet holds the position — competence is held by nobody** | MODEL · `OD-12` |
| **An owner on a saved report definition who can hand it on, and an admin who can recover it** | No transfer command, no share command, and **no owner-override capability by design** (`permissionCatalog.ts:890-910` — *"no owner-override id here, matching Spec §9's 'private by default, no admin override'"*). **Two gates stack**: `reportAuthor` lacks `.delete`; an admin who holds it lacks ownership → **the record is undeletable by anyone** | MODEL (MG-5) |
| **One approval concept** | **Six field vocabularies across six surfaces** — `ApprovalRecord.decidedByUid` · `accessRequests.ApprovalPolicy.approverConstraint` · `roleAssignments.approvedBy` · `data_import_jobs.approvedBy` · `performance_goals.approvedByUid` · `financialPolicyProfile.approval.approvedBy` — and **no collection, no matrix family**. Consolidating is a decision, not a schema edit | MODEL (MG-10) |
| **An owner on arrival for inbound work** | `inbound_work_requests` is **not classified at all** and carries a governed `operatingCompanyId` from mailbox/routing configuration. Three sibling email collections carry it too and are equally absent | MODEL (MG-11) |

**EMP-WORK's 44 named instances carry a mandatory qualifier and it must travel with them:** *"In 44 of
44 the outside channel is a **recovery path**, not a convenience — the thing the person does when the
product cannot express the act."* **And EMP-WORK states plainly that its outside-EOS and
lost-between-people sections rest entirely on AUTHORED NARRATIVE and should reach the Owner as a
hypothesis to test, not as observed practice.** EMP-ACCOUNTABILITY carries them with that qualifier at
its Appendix A and instructs that it must survive into any canonical artifact. **It does. Both halves
travel together** — this is the strongest available argument for closing the gap **and** the
weakest-provenance evidence in the corpus.

**One consequence raises the stakes and is not hypothetical:** the P3B1-S21 workaround —
*"Dale tells Javier verbally and the record stays on Curtis"* — **corrupts the technician scorecard
built on that data** (WF-SVC-016 attributes the work to Curtis, who did not do it).
**An accountability model whose only workaround falsifies the performance data is worse than one with
an acknowledged gap.** The choice is not between a gap and a fix; it is between an acknowledged gap
and wrong records. (EMP-ACCOUNTABILITY §0, conclusion 9)

### Q7. Which roles have work spread across unrelated modules?

Measured two ways, by two lanes, agreeing. Full detail in
[`EMPLOYEE-WORK-MATRIX.md`](EMPLOYEE-WORK-MATRIX.md) §2.

**By registry `actors` × `domain`** (EMP-WORK §1.1, **[TRACED]**):

| Rank | Real job | Workflows | Domains crossed | % finishable |
|---|---|---:|---:|---:|
| 1= | **Field Technician** | 18 | **8** — Service, Technician, Equipment, Inventory, Warehouse, Scanner, Reporting, Cross-domain | 28% |
| 1= | **Operations Manager** | 12 | **8** — CRM, Sales, Finance, Inventory, Purchasing, Warehouse, Reporting, Cross-domain | 17% |
| 3 | **Controller** | **20** (most of any actor) | 6 | **15%** |
| 3 | **Dispatcher** | 19 | 6 | 53% |
| 3 | **Salesperson** | 12 | 6 | 25% |
| 6 | Accounting Manager · Sales Manager · Parts Manager | 14 · 14 · 13 | 5 each | 14% · **7%** · 31% |
| 9 | Administrator · General Manager · Owner | 11 · 9 · 9 | 4 each | **9%** · **0%** · — |

> **The two jobs that cross the most boundaries sit at opposite ends of the company** — a technician
> in a parking lot and an operations manager at a desk — **and neither has a surface that spans their
> eight domains.**

> **Two jobs have no finishable workflow at all: General Manager (0 of 9) and Service Billing Admin
> (0 of 5).** The person accountable for the company's numbers and the person who turns completed work
> into money can complete nothing end to end. (EMP-WORK; adopted by EMP-PERFORMANCE OD-EMP-022 as the
> reason **no BUSINESS OUTCOME metric is proposed for either**)

**By the job the person is trying to finish** (EMP-EXPERIENCE §1.1 — seven real jobs, each crossing
modules, **none owned by a module**): J1 repair-vs-replace (Equipment·Service·Inventory·Financials·Sales
— **no equipment↔opportunity relationship exists in any entity definition**) · J2 standing at the
machine · J3 one customer, four machines, one trip · J4 get this part on order tonight (**the Parts
Manager who raises the request cannot approve, reject or cancel one**) · J5 bill this repair visit
(**`billingQueue.ts` has zero importers — "written and connected to neither end"**) · J6 four drive
belts crossed the company line (**zero `operatingCompany` hits across four allocation files**) ·
J7 manufacturer safety notice.

> **None of J1–J7 is a Service job, an Inventory job or a Finance job. Every one is *a job*. An
> experience organised by module cannot express any of the seven.**

**The upstream cause is named:** EOS's role labels **fragment real jobs** because there was no
canonical vocabulary for them to use. **40 raw corpus role labels describe roughly ten real jobs**,
and **four jobs — Technician, Parts/Warehouse, Ops Management, Dispatcher — appear in all three
libraries under three different labels, with nothing joining those views of one person's day**
(EMP-WORK §1; EMP-ROLE F-3). **Four lanes normalised the same 40 labels four different ways — see
conflict R-8.**

### Q8. Which work queues must exist?

Full register in [`EMPLOYEE-WORK-MATRIX.md`](EMPLOYEE-WORK-MATRIX.md) §5. The integrated answer has
three layers.

**(a) The six "My Work" buckets** — see Q9. Three of the six keys do not exist.

**(b) The role-shaped and process queues the evidence positively demands**, with their state:

| Queue | Keyed on | State at `64008d5a` |
|---|---|---|
| **Inbound work decision queue** | `queue` + `status` (`AWAITING_DECISION` / `NEEDS_REVIEW` / `QUARANTINED`) | **The only real queue in EOS** — and it filters on **`status` only**, with no owner, role or company predicate (`inboundWorkReadService.ts:82-83`). Its capability `service.inboundWork.read` is `active:false`, so it **denies every principal**. `NEEDS_REVIEW` is *"same queue, louder"* — **in a code comment and nowhere on screen** |
| **Reorder request ladder** | `currentOwner` role token + `status` | **The one real escalation ladder in EOS, and it is a STATUS ladder**: `PENDING_REVIEW → READY_FOR_PARTS_MANAGER → ASSIGNED_TO_PARTS_ASSOCIATE → PURCHASING_IN_PROGRESS → ORDERED → RECEIVED`, each transition gated by capability + `roleKeys`. **Measured-empty in production**; and the Parts Manager who raises a request **cannot approve it** — the approval verbs reach **no governed business Role** |
| **Ready-to-schedule / dispatch board** | `status` over `SCHEDULABLE_STATUS` | `service.workOrder.readyToSchedule.count` **ACTIVE** at `FIRM` scope. But *"the board surfaces the collision; a person decides"* — **nothing surfaces it**, and the recommendation engine **does not know about PTO** |
| **Past-due / at-risk work** | `scheduledStart` age + stagnation | `service.workOrder.pastDue.count` **ACTIVE** at `FIRM` — **cannot be pointed at a person even if someone wanted to.** `detectStalledJobs` returns **only HIGH and CRITICAL**, and a Work Order with an unusable `createdAt` scores 0 on both factors and **is dropped from the At-risk table entirely** — *"the Work Order the system knows least about is the one it shows least"* |
| **Closable / aged-COMPLETED Work Orders** | `status` | **MISSING.** *"Aged COMPLETED Work Orders accumulate as a queue nobody can clear"*, and *"Two companies' revenue recognition runs off one unsegregated list"* |
| **Variance lines awaiting a second reviewer** | separation of duties | **PARTIAL.** The control exists; **the eligible-reviewer list does not** — *"the screen must offer that as the next action, with the eligible reviewers named, or the recovery is a Slack message"* |
| **Awaiting-receipt / expected-in-today** | supplier receipt lines | **MISSING as a scan-first entry** — *"A purchase order has no business number. Nothing prints, encodes or resolves a scannable order label"* |
| **Ownerless-record queues** — accounts with no owner; records with no resolvable owner | owner field | **MISSING AND UNREPORTABLE.** `MGMT-038` is **EXECUTED_FAIL**: *"the most consequential exception in the CRM domain and the hardest to see"*. `report.customer.field.accountOwner.read` is `active:false`. **The ownership model's one hard refusal is unreportable** (OWN-E2E EG-10) |
| **Access-request / approval queue** | `approverConstraint` | **MISSING.** The `accessRequests` workflow and UI are **explicitly deferred** (`types/access.ts:193-197`), so the one *typed* accountability constraint in EOS (`distinctFromRequester` / `platformAdmin` / `companyAdmin`) has no process behind it |

**(c) Two anti-requirements, stated so a later pass cannot re-derive them** (EMP-EXPERIENCE §3.3):
**`MY OWNED RELATIONSHIPS` must never be merged into a task list** — an owned account is not a to-do;
and **a bucket whose key does not exist must render as a stated absence, not as an empty list.**
Given measured-zero occupancy, **every role-keyed bucket will be empty on day one for structural
reasons, and must say which reason.**

**And the queue rule that binds all of them** (EMP-INFORMATION S-5, `eos-dashboard-composition-authority`
Rule 6): **a bounded read may return a page and say so; a TOTAL may not.**

### Q9. What should "My Work" actually mean?

**Do not produce one generic "My Work."** EMP-EXPERIENCE §3 is the canonical answer and this synthesis
adopts it whole, because the evidence for keeping the buckets apart is structural rather than
stylistic: **the six buckets key on six of the nine concepts, and three of the six keys do not exist.**

| Bucket | Keyed on (concept #) | The key field at `64008d5a` | Buildable now? | When it matters |
|---|---|---|---|---|
| **MY OWNED RELATIONSHIPS** | RECORD OWNER (1) | four different field names — `accountOwner.assignedToEmployeeId`, `contacts.owner`, `locations.owner`, `ownerEmployeeId` | **PARTIAL + UNGOVERNED** — a union across four shapes, **and the key itself is client-writable, unaudited, by any admin or dispatcher** | Continuously, for anyone with a book of accounts. **A standing list, never a to-do list** |
| **MY ACCOUNTABILITIES** | ACCOUNTABLE PERSON (2) — **collapsed** | none. Nearest is a role-keyed state (`READY_FOR_PARTS_MANAGER`) | **MISSING (MODEL GAP)** + measured-empty on occupancy | When something is mine to see through **without being assigned to me** |
| **MY ASSIGNED WORK** | ASSIGNEE / EXECUTOR (3) | `assignedTechId`/`technicianId`, `assignedToUserId`, per-domain assignee | **PARTIAL** — per-domain assembly, no uniform field | The technician's and parts associate's whole day. **The only bucket with a real working key today** |
| **MY APPROVALS** | SECURITY ROLE (8) + ACCOUNTABLE PERSON (2) | `roleAssignments` → capability | **AVAILABLE as capacity / MEASURED-EMPTY in production** | At the moment someone else is blocked waiting for me. **Separation of duties lives here** |
| **MY ESCALATIONS** | ESCALATION OWNER (5) | **nothing exists** | **MISSING (MODEL GAP)** — cannot be built at all | When my own authority has run out |
| **MY TEAM / MANAGEMENT VIEW** | MANAGER (4) | two unreconciled answers, neither expressing a team | **MISSING (MODEL GAP)** | Only for someone with people — **and it must be a different surface, not a wider one** (Q10) |

> **Of the six, ONE has a working key, TWO are partial and need a union across heterogeneous fields,
> and THREE cannot be built at all at this baseline. A design that ships one "My Work" list hides that
> distribution and implies EOS can answer questions it cannot.**

**One recorded disagreement, not resolved** — conflict **A-1** / EMP-EXPERIENCE §3.4: EMP-WORK holds
that *"EOS models the ASSIGNEE and no other role concept"*, so MY OWNED RELATIONSHIPS needs something
EOS does not store. EMP-EXPERIENCE holds the **narrower** reading: RECORD OWNER **is** stored (the
matrix, `OWNER_TYPES`, four concrete fields); what is missing is **a single key to query it by**, plus
a live read path — so `PARTIAL (MODEL: heterogeneous keys) + MISSING (production transport)` rather
than "not stored." **Both readings are preserved. EMP-EXPERIENCE's is the more precise and this
synthesis uses it, while recording that EMP-WORK's is true of every *other* bucket.**

**What "My Work" must mean, integrated:** six named buckets, each labelled with which of the nine
concepts it is keyed on, each rendering a **stated absence naming its reason** where its key does not
exist or its Role is unoccupied — and **never one list.** (No surface, layout or component is
specified; EMP-EXPERIENCE specified none and neither does this.)

### Q10. What must managers see that individuals should not?

**The evidence forces three questions, not one** — the boundary runs in two directions and one of them
is currently unenforceable. (EMP-EXPERIENCE §5; full table in
[`EMPLOYEE-WORK-MATRIX.md`](EMPLOYEE-WORK-MATRIX.md) §7)

**(a) Manager-only, and whether EOS can enforce it:**

| Manager sees | Can EOS enforce the boundary? |
|---|---|
| **Comparison across people** | **NO** — *"with role-only hierarchy EVERY salesManager sees EVERY salesperson"*. The boundary exists between **levels**, not between **teams** |
| **Unassigned / unowned work** | **NO** — `MGMT-038` **EXECUTED_FAIL**; the report field that would list ownerless accounts is inactive in every environment |
| **Capacity / utilisation across the team** | **PARTIAL** — fleet `% booked` renders only when every technician has a recorded schedule, *"which in practice means never"* |
| **Goals and targets — set and approve them** | **PARTIAL** — read granted widely, authoring not; Owner's stated position: *"employees do not automatically manage their own targets"*; `WF-RPT-004` `CANNOT_START` |
| **Cost, margin, rate** | **NO** — *"A technician completes work/parts/times/readings; pricing, rates, tax, and totals are office-only"*, and **route-level `ROLE_NAV_ACCESS` cannot express this.** Field-level visibility within a document (G35) is a **named, unbuilt capability**; ADR-007 solved the same problem for **reports** and *"nobody connected the two"* |
| **Cross-domain activity for one employee** | **NO** — `Employee` is a wave-4 reportable object with **no fields populated**, and the **eleven** governed Roles declaring `audit.event.read` are **refused by the deployed `listRecordChangeHistory`** |
| **Salary-class aggregates** (`SUM(salary) by department`, no individual row) | **NO** — ADR-007 calls it *"the single most common sensitive report"*; aggregate-only field access was **ruled out for v1** |

**(b) Individual-only — the direction missing from the brief, and the evidence is unambiguous:**
a person must see **their own performance figure and a way to contest it** (*"Contestability is what
makes performance data legitimate"*; today *"The correction, if any, happens in a conversation"*);
**their own technician status** (a stale `on_job` left overnight *"scores him as occupied all the next
day with no way to notice"*); **their own goal, without reading anyone else's** (the
`performanceGoalSubject` Role exists for exactly this and has **zero holders even in the synthetic
sandbox roster**); and **nothing at all about a peer's pay, rate or margin** — where the absence of
field-level visibility today **fails in the permissive direction.**

**(c) The manager surface must be a DIFFERENT surface, not a wider one.** Today EOS has exactly one
manager/individual split and **it is device-shaped, not role-shaped** (*"technicians get their own
surface, everyone else gets the shared one"*). **Adopt Decision #161's ten rules as the
manager-experience contract** — already Owner-accepted, already live-verified, and EMP-EXPERIENCE
found nothing in the corpus contradicting them. The two that most often go wrong: **a rate rolls up as
`sum(numerator)/sum(denominator)`, never `average(per-employee percentages)`** (Rule 8 — the single
most common manager-dashboard arithmetic error), and **a dashboard composes authority; it is never a
second permission layer** (Rule 1 — verified: **zero `dashboard.*` ids exist in either catalog
mirror**).

> **THE ASYMMETRY THAT MUST BE STATED TO THE OWNER.** Every manager-only boundary in (a) is currently
> enforced by **what happens to be switched off**, not by a visibility model. When the commercial
> capabilities are activated — **the cheapest change in the programme** — **the boundaries open before
> the mechanisms that should govern them exist.** → `OD-14`

**Six of the seven exception queues managers actually ask for weekly sit over the commercial spine,
and the commercial spine is off.** A manager experience built on them shows seven honest refusals today.

### Q11. What happens when an employee leaves or becomes unavailable?

**Nothing is released, and departure seeds future orphans.** EMP-ACCOUNTABILITY §6 is canonical; full
matrix in [`RESPONSIBILITY-HANDOFF-MODEL.md`](RESPONSIBILITY-HANDOFF-MODEL.md) §4.

**EOS has two independent, deliberately separate switches and neither touches the third thing:**

| Switch | Owner | Effect |
|---|---|---|
| `employmentStatus` ∈ `ACTIVE`·`ON_LEAVE`·`INACTIVE`·`TERMINATED`·`RETIRED`·`CONTRACTOR` | `updateEmployeeProfile` | Business lifecycle. Non-`ACTIVE` → **every** operational capability fails closed |
| Auth account enable/disable | `setUserStatus` (`trustedWriterCommands.ts`) | Account control. Bumps `accessVersion`, resyncs claims |

The source states the separation and its consequence: *"Employment Status IS editable here and account
status is NOT… **Terminating employment through this command switches nobody off, and this file
contains no code that could.**"* **The separation is correct. The uncovered case is the third thing
neither switch touches: the person's outstanding responsibilities.**

**Nine unavailability states × seven consequences — and every cell for owned records is `NO CHANGE`:**

| State | Owned records | Assigned work | Future records |
|---|---|---|---|
| **VACATION** | NO CHANGE — **no vacation state exists** (`ON_LEAVE` is a *status*, not a date range) | NO CHANGE; **executor frozen** where `requiresOwnAssignment` | NO CHANGE — keeps inheriting to an absent owner |
| **SICK / UNAVAILABLE** | NO CHANGE | **Mid-execution work becomes unrecoverable** | NO CHANGE |
| **ROLE CHANGE** | NO CHANGE | NO CHANGE | NO CHANGE — **a former salesperson keeps inheriting new Opportunities** |
| **DEPARTMENT CHANGE** | NO CHANGE | NO CHANGE | NO CHANGE |
| **MANAGER CHANGE** | NO CHANGE (correct) | NO CHANGE | NO CHANGE — nothing reads `managerEmployeeId` |
| **ON_LEAVE** | NO CHANGE | **All capability revoked** | NO CHANGE |
| **CAPABILITY REMOVAL** | NO CHANGE | Executor can no longer act | NO CHANGE |
| **DEACTIVATION** | NO CHANGE | **Stranded** — *"deactivation releases NOTHING. P1 has no release command at all"* | NO CHANGE |
| **TERMINATION / RESIGNATION / RETIREMENT** | **NO CHANGE — they remain the record owner forever** | **Stranded.** *"Disabling the principal silently strands every Work Order assigned to them… nobody else can advance them… One administrative click can immobilise a day's field work with no warning"* | **NO CHANGE — a terminated employee continues to be inherited as owner of every new Contact, Location, Opportunity, Agreement and Sales Order downstream of their Accounts** |

Historical records: `NO CHANGE`, **and that is correct.**

**The two Owner rules divide cleanly, and the resolution is the model's key move:**

| Rule | Verdict |
|---|---|
| *"No actionable item may become orphaned"* | **VIOLATED**, structurally, at every one of the nine states |
| *"Do not mass-rewrite historical ownership"* | **HONOURED — and honoured by the same mechanism that causes the violation.** The non-cascade rule is why both facts are true |

> **These two rules are not in tension. The thing that must be released on departure is
> ACCOUNTABILITY, not RECORD OWNERSHIP.** Historical ownership correctly stays put; the accountable
> person must move. **EOS cannot express this because it has no accountability axis to move — the two
> are the same field. Collapsing them is what forces an unacceptable choice between orphaning work and
> rewriting history.**

**Three live, specific consequences:**
1. **`reportDefinitions` is orphaned outright and unrecoverable.** `ownerUid` is the only gate; there
   is no transfer, no share, and **no admin override by design**. *"A saved report survives its
   author's departure and keeps naming them as owner… the person best placed to tidy a departed
   colleague's reports is the one role that cannot."*
2. **None of the three `OWNERSHIP_HANDOFF_SOURCES` is a departure.** `DIRECT_HANDOFF`,
   `CUSTOMER_HANDOFF_REVIEW`, `ADMIN_CORRECTION`. **Routing a departure through `ADMIN_CORRECTION`
   would file a legitimate lifecycle event as a data-entry fix, destroying the distinction the closed
   set exists to preserve.**
3. **Nothing can list a departed person's obligations**, so even the honest option ("a named role
   clears the backlog") has **no queue to work from** (ORPHAN-13).

**The vocabulary of departure does not exist in the business's own description either:** across all
1,010 corpus activities, **`takeover`, `unassigned`, `out of office` and `terminated` appear ZERO
times each**; `vacation` appears **once**; `delegate` once, *"and in the sense of not delegating."*
Meanwhile **`accept`/acceptance appears 107 times.** **Acceptance is a MODEL GAP against abundant
evidence; departure is MISSING INPUT — the corpus cannot settle it because the business never
described it.**

### Q12. What end-to-end ownership work must complete before North Star implementation?

Canonical list in [`EMPLOYEE-ATLAS-HANDOFF.md`](EMPLOYEE-ATLAS-HANDOFF.md). **Nothing below is
authorized; each is a precondition, stated as a test.** The gates in dependency order:

| # | Gate | Why it precedes North Star implementation | Blocking decision |
|---|---|---|---|
| **G1** | **Rule on whether ACCOUNTABLE PERSON is an axis at all** | 20 COMPANY-owned families wait on it; it gates every other accountability decision; and **answering it by adding a field is exactly what the discovery rule forbids** | `OD-1` |
| **G2** | **Make the person axis referentially honest BEFORE the census gates enforcement** | The census is the instrument the enforcement gate depends on and it is **structurally blind to person-level orphans**. Enforcement could be switched on against a census reading zero while orphans exist. **This is a prerequisite, not a follow-up — and it is a measurement change, not a backfill** | `OD-6` |
| **G3** | **Close the handoff-validation authority question** | All five family-level refusals live in the uncalled builder; the live audit writer has none and **EXECUTED accepts a handoff of an invoice, a part, an audit event, or a nonexistent family.** Wiring anything before this is decided produces the corruption the matrix exists to prevent | `OD-7` |
| **G4** | **Narrow or accept the ownership-write exposure** | `accounts.accountOwner`, `contacts.owner`, `locations.owner` and `fieldops_jobs.operatingCompanyId` are rewritable by any `admin` **or** `dispatcher` via a generic client write, unguarded and unaudited — **and production's only principal holds exactly that `admin` role.** Rules themselves call it an *"INTERIM path"* | `OD-8` |
| **G5** | **Supply the 12 physical-root company assignments** | `warehouses` 0/5 and `mobile_locations` 0/7 are `OWNERLESS_UNTIL_SUPPLIED`; their orphanhood propagates to every location-derived family and the **live, complete, fail-closed reorder path is refusing every request in every environment** until they land. **Inference is explicitly forbidden, so the gap cannot be closed by a default** | `OD-9` |
| **G6** | **Decide whether company ownership is a user-visible fact or an internal scoping key** | It determines whether the write-only company tier is a UI backlog or a correct design — **and it must be answered before the census gate, because a fact nobody can see cannot be verified by the people accountable for it** | `OD-10` |
| **G7** | **Grant at least one human a governed business Role, and decide the honest sentence when occupancy is zero** | Production occupancy is **measured zero**. Every role-keyed queue, every "ask X" escalation sentence, and `MY ACCOUNTABILITIES`/`MY APPROVALS`/`MY TEAM` are **measured-empty**. **Nine of fifteen escalation sentences would render a dead end naming a ghost** | `OD-2`, `OD-25` |
| **G8** | **Rule the authoritative JOB ROLE vocabulary and its mapping to the 48 security Roles** | **Independent of G7.** Grant every Role tomorrow and a role-shaped queue becomes non-empty and keyed on the wrong thing: **29 of 45 Roles have no corpus job label and 51% of authored work names no Role at all** | `OD-1`, `OD-3` |
| **G9** | **Rule the canonical owner id namespace** — `employeeId` or Firebase `uid` | Open item **O-1**, still open: *"the ruling named the type, not the identifier."* Eight families are affected; two namespaces are in live use | `OD-4` |
| **G10** | **Mark `record-ownership.md` §1/§4/AC-7 superseded, and reconcile the six stale matrix descriptions** | **Any lane reading the named evidence in order adopts the wrong model.** Two lanes did so and corrected themselves in writing. Correct code that cannot be audited against its own description is the worse failure mode | `OD-5` (documentation, not design) |
| **G11** | **Decide whether a governed "I could not complete this" outcome exists** | The most-cited gap in the corpus. Without it, **the only expressible answer to an unavailable technician is `Cancel`**, and every on-time and completion metric is computed over a population that excludes the real day | `OD-13` |
| **G12** | **Classify `inbound_work_requests` and the three email collections; and decide whether Approval/Exception and Report-execution are families** | The matrix's own header says a collection absent from the file *"would be indistinguishable from one nobody thought about."* **Four such collections exist**, one of them the first object in the service chain — *"precisely where accountability must begin"* | `OD-16`, `OD-17` |

**And two North-Star-specific preconditions from EMP-PERFORMANCE, which must not be skipped:**

| # | Gate | Evidence |
|---|---|---|
| **G13** | **A contest path must exist before any number is presented as EMPLOYEE PERFORMANCE.** | *"No annotation or correction path exists for a misattributed completion, so immutable execution data becomes uncontestable performance data."* The evidence that would settle a dispute **exists and is unreadable** (audit collections deny-all). **A person-attributed derived number has already shipped wrong once — `-1686m` on a real technician's screen — and the bad records were never repaired, only the display.** → `OD-15` |
| **G14** | **Only TWO governed facts can name a person**: `creditedSalespersonId` on issued invoices, and `assignedTechId` on `fieldops_wos`. `responsibleEmployeeId` is **declared and never populated**; `accountOwner` is client-writable and 0/103 populated; Work Orders record **no creator at all**. | **So the North Star's "Service responsibility" view is structurally empty, not merely unactivated.** Any metric attributed to anyone else rests on a field that is unpopulated, client-writable or absent |

---

## 5. THE CONFLICT REGISTER

**The rule this lane exists to hold: disagreement is not smoothed over, and no contradictory evidence
is silently chosen between.** Every conflict is classified as **exactly one** of EVIDENCE CONFLICT ·
ROLE CONFLICT · ACCOUNTABILITY CONFLICT · OWNERSHIP CONFLICT · ASSIGNMENT CONFLICT · AUTHORITY
CONFLICT · WORKFLOW CONFLICT · ENGINEERING GAP · OWNER DECISION REQUIRED. Where two readings exist,
**both are stated and neither is chosen** unless this synthesis could re-derive the answer — in which
case the re-derivation is shown and the conflict is marked **CLOSED**.

### 5.1 EVIDENCE CONFLICT (10)

| ID | Subject | Reading A | Reading B (and C…) | Disposition |
|---|---|---|---|---|
| **E-1** | **The production capability reach count** | **37 — EXECUTED.** *"37 of 147 capabilities are allowed anywhere in production, and not one of them is commercial"* — the shipped resolver over all 48 roles × 147 caps; `matrix-run.txt` final line `ALLOWED ANYWHERE IN PRODUCTION: 37`; corpus `P3B3-MGMT-046` **EXECUTED_PASS** (EMP-INFO B-1, EMP-PERF §3.2) | **34** static (EMP-INFO's parse: 147 ids / 113 `active:false` / 34 default-active) · **38** static (EMP-PERF: 109 `active:false` → 38; independently corroborated by `capacity-report.json.catalog.globallyActive: 38`) · **39** static (EMP-EXP: 108 `active:false` → 39). **`61` and `62` are WITHDRAWN as invalid method-mixing** — 62 ≈ 37 + 25 summed across two different measurement methods, and the string *"62 of 147"* appears in **no file in any of the 97 worktrees** | **ALL METHODS RECORDED; NO WINNER PICKED.** EMP-EXPERIENCE declined to pick one (§11.1) and **that posture is adopted.** **This synthesis re-derived a fifth reading and it lands exactly on EMP-INFORMATION's**: 147 id lines, **113** whose entry block carries `active: false`, **34** default-active (a naive line-grep gives 119 because 6 occurrences sit outside an id block). **All methods agree on: 147 catalogued ids · ~108–113 registered inactive · 0 production activation overrides · and NOT ONE production-reachable capability is commercial.** **No requirement in any artifact turns on the count.** **Correction to the controlling brief:** it names *"36 static catalog-active"* — **no lane reports 36**; it is a fragment of the withdrawn 61 decomposition (*"36 catalog-active + 25 production-adopted"*). The static reading is itself contested **three** ways: 34 / 38 / 39 |
| **E-2** | **How many `report.*` ids are production-activated** | **25, and it is a FLOOR.** `taylor-parts-production.productionCapabilityActivations` = 25, **all `report.*`** — re-derived by this synthesis. Unscoped set is **24** (`report.definition.read` is already per-owner row-scoped). Under the last recorded production Functions deploy (pinned `fb45e6ee`) **36 of 39** are `active: true` and `owner` resolves ALLOW 36/39 (EMP-INFO B-2, U-8) | **Refuted at this baseline.** EMP-EXPERIENCE measured all 39 `report.*` as `active: false` and `taylor-parts-production.capabilityActivationOverrides` = **0**, and **found no mechanism by which a `report.*` id is adopted in production** (U-18) | **BOTH READINGS ARE CORRECT ABOUT DIFFERENT FIELDS, AND THE DISTINCTION IS THE RESOLUTION.** Verified by this synthesis: the two fields are read by **different resolvers**; `environmentCapabilityOverrides.ts:354` returns EMPTY **unconditionally** for `role === "production"` from the overrides path, which is why `productionCapabilityActivations` was introduced by `DECISIONS #169`. **EMP-EXPERIENCE measured the overrides field and is right that it is 0; EMP-INFORMATION measured the activations field and is right that it is 25.** Adopt EMP-INFORMATION's framing: *"a reader of either file alone reaches the opposite conclusion."* **The blast radius of the row-scope defect is larger under the 36 reading** |
| **E-3** | **How many `operationalRoles[]` values have no consumer** | **5 of 8** — `TECHNICIAN`, `WAREHOUSE_ASSOCIATE`, `SERVICE_MANAGER`, `SALES_MANAGER`, `SALES_ASSOCIATE`, per `employeeVocabulary.js:19-20` *"have no consumer anywhere in this client yet"* (EMP-ROLE F-4). Corroborated by OWN-E2E F-7 (**only `PARTS_MANAGER`, `WAREHOUSE_MANAGER` in `firestore.rules`, plus `TECHNICIAN` via separate technician predicates**) and EMP-INFO M-6 | **Only 3 confirmed.** EMP-ACCOUNTABILITY UN-7: `SERVICE_MANAGER`, `SALES_MANAGER`, `SALES_ASSOCIATE` appear only in the enum, a label list and a seed snapshot; **`WAREHOUSE_ASSOCIATE` and `TECHNICIAN` have at least one real consumer each** (`dashboardComposition.js:154`; the technician binding). *"The count is EMP-ROLE's to settle; the three that matter to this lane are verified."* OWN-DESIGN §14 independently verified **4** with ≤2 non-declaring consumer files | **FOUR READINGS: 3 · 4 · 5 · 5. BOTH BOUNDS PRESERVED.** The disagreement is about **what counts as a consumer** — a Rules predicate (`firestore.rules isActiveOperationalRole`) vs any code reference (`dashboardComposition.js`). **EMP-ACCOUNTABILITY was right to confirm only what it could and say so.** **The synthesis-level fact is unaffected and is what matters: `operationalRoles` is the least-bad existing carrier for a job role and is between 37% and 62% inert**, and **`SERVICE_MANAGER` — the exact value the Owner's worked example names as the Work Order accountable person — has no consumer under every reading** |
| **E-4** | **How many stored company fields are write-only** | **11 of 13**, families named: `fieldops_jobs`, `trucks`, `stock_locations`, `inventory_transactions` (all three fields), `receiving_orders`, `cycle_counts`, `transfer_orders` (both fields), `reorder_requests`, `purchase_orders` — live writers exist and *"no component reads any of them, no callable returns any as a displayed fact, and no report exposes any"* (OWN-E2E §7A) | **Denominator not reproducible.** OWN-DESIGN §4.5/UP-9: `operatingCompanyId` or `companyId` is read by **24 frontend files**; the **financial pair IS rendered** (`FinancialsInvoiceDetail.jsx`, `FinancialsInvoices.jsx`, `FinancialsCustomerFinancials.jsx`) **and reportable** (`financialReportingRead.ts`), with `domain/companyAttribution.js` a dedicated surface; **inbound work's company reaches `InboundWorkWorkspace.jsx` and `AdminEmailCommunications.jsx`**; **equipment's is read** by `domain/equipmentNorthStar.js:163` and **reported as UNKNOWN** | **THE DISTINCTION IS ADOPTED BY BOTH LANES; THE COUNT IS CONTESTED AND STAYS CONTESTED.** `WRITE-ONLY` is **a required third value** for VISIBILITY EFFECT and REPORTING EFFECT (OD-OWN-021): *"a company fact with a live writer, no surface and no report is a distinct condition from absent storage and must not be scored as present."* **The count is attributed to OWN-E2E, not restated as a synthesis figure.** The two lanes' family scopes differ: OWN-E2E's 13 is the set of matrix **ownable** families with a stored company field; OWN-DESIGN counted frontend **readers** across a wider surface including the financial `companyId` tier and unclassified `inbound_work_requests`. **Both are internally consistent. The renderability criterion was never stated, and that is the actual unresolved item** |
| **E-5** | **The authorized backfill write total** | **1013** — `AUTHORIZED_TOTAL` EXECUTED = `337+180+278+99+47+41+24+5+2` (OWN-E2E F-3) | **1,015** — `ownershipBackfillRules.ts:5` header. **And 1015 APPLIED** — `ownershipMatrix.ts:359/369` cites *"applied 1015/1015"* | **THREE NUMBERS FOR ONE AUTHORIZATION, all recorded.** The 2-write delta is the removed `trucks` cap (`:229-231`). **Consequence: 2 writes stand in the data that the current rule set can neither reproduce nor verify**, and the blast-radius control the module exists to provide now authorizes a total that does not match what was applied. → `OD-19` |
| **E-6** | **Corpus distinct-record count** | **1,009 distinct** — `P3B3-FIN-056` ≡ `P3B3-MGMT-018` is a **content** duplicate (identical title, actor, `objects_touched`, status), with instructions to *"count this activity ONCE"* (EMP-WORK §0.1, EMP-PERF) | **All 1,010 ids are unique** — the 1,009 is distinct **by title**, not by id (EMP-EXP C-6) | **BOTH TRUE, ABOUT DIFFERENT OBJECTS. CLOSED as a definitional confusion, not a data conflict.** Always say which. **And the duplicate matters**: it is *"Attribute an operational record to the company that performed the work"* — **the single most load-bearing blocker in the operational-company gap** (Q4) |
| **E-7** | **Downgraded corpus output lines** | The controlling brief: *"34 of P3-B3's recorded output lines are INFERRED"* | **22 are INFERRED.** 118 output lines over 42 rows: `EXECUTED` 90, `INFERRED` 22, `TRACED` 6. **28 lines were downgraded in total** (22 + 6). *"34 matches nothing in the data"* — and each P3-B3 file's own `corrections.fix1_evidenceTiers` block says the same (EMP-WORK §10 #1) | **CLOSED in favour of 22/6/28. The brief is wrong.** Re-derived by EMP-WORK from `execution.output_evidence_tiers` across all six files and cross-checked against the corpus's own corrections block |
| **E-8** | **The stale header in `governedBusinessRoles.ts`** | **`:61` reads *"eleven -- three compatibility, eight governed business"*** — stale by 37 (OWN-E2E C-10, EXECUTED). EMP-ROLE C-6 reports the header as *"eight governed business Role definitions"* at `:1-2` | **Not found.** EMP-ACCOUNTABILITY UN-8: *"the 'eight governed business Role definitions' header string was **not found** by grep at this baseline"* | **BOTH RECORDED.** Two lanes quote the string at two different line numbers (`:1-2` vs `:61`); one could not find it. **The substantive rule is unaffected and all three lanes state it: cite the code, never the header.** Not worth a re-derivation — **the header is not authority under any reading** |
| **E-9** | **Matrix family count** | **51** — EXECUTED (`OWNERSHIP_MATRIX.length`, OWN-E2E), confirmed two ways by OWN-DESIGN, and evaluated rather than pattern-matched by EMP-ACCOUNTABILITY (PERSON 6 + COMPANY 20 + PARTICIPATING 1 + REFERENCE 7 + EXCLUDED 17 = 51) | **50** — the prose of `docs/assessments/eos-ownership-model-reconciliation.md`, whose **own class breakdown sums to 51** | **CLOSED in favour of 51.** Three lanes, one by execution. **The ratified reconciliation document is off by one in its prose and should be corrected** (`OD-5`). This synthesis did **not** re-derive 51 — a static parse cannot expand the four spread blocks — and **attributes it to OWN-E2E (EXECUTED) and OWN-DESIGN** rather than restating it as its own |
| **E-10** | **HANDOFF-capable family count** | **13** — OWN-DESIGN first pass | **14** — corrected; the spread block adds `warehouse` + `mobileLocation` | **CLOSED in favour of 14, and the mechanism is now named.** **Re-derived by this synthesis at baseline:** 12 families carry `transfer: "HANDOFF"` as a literal; the spread block at `ownershipMatrix.ts:311-325` emits `warehouse` and `mobileLocation` from one literal carrying `transfer: "HANDOFF" as const`. **12 + 2 = 14**, matching OWN-E2E's EXECUTED Probe A (accepts 14 / refuses 37). OWN-DESIGN had already adopted 14 (§14). **A naive static count gets 12, not 13** — recorded so the next reader does not produce a fourth figure |

### 5.2 ROLE CONFLICT (8)

| ID | Subject | Reading A | Reading B | Disposition |
|---|---|---|---|---|
| **R-1** | **Marisol Vega** | B1 `service_coordinator` — 68 activities per EMP-ROLE §5 / §6.1; **49** per EMP-ROLE §8 | B2 **`Parts Manager`** — 65 activities | **RECORDED, NOT RESOLVED.** A cross-library contradiction, and **both libraries record it themselves** in their `corrections.recordedNotFixed.personaIdentityCollision` blocks. EMP-INFORMATION §4 independently lists Marisol Vega among Service Coordinator personas. **Note a second-order discrepancy inside EMP-ROLE itself: 68 vs 49 for the same persona-role pair** — recorded, not reconciled. Only the Owner can settle which reading is the person |
| **R-2** | **Priya Raman** | B1 `service_manager` — 60 | B2 `Operations Manager` — 17 | **RECORDED, NOT RESOLVED — and it is not merely a label clash.** `service_manager` maps to **`fieldManager`** (under `operationsManager`) while `Operations Manager` maps to `operationsManager` **itself**. **The two readings place the same person one level apart on the same branch — a manager and her own manager.** (EMP-ROLE §8, INFERRED from `roleHierarchy.ts:151-157` + F-7) |
| **R-3** | **Luis Mendoza** | B2 `Stocker/scanner operator` — 28 | B2 **`Stocker`** — 4 | **RECORDED, NOT RESOLVED. An INTRA-library inconsistency, not in the controlling brief** — EMP-ROLE F-9 / C-5 found it and offered it as a correction. **The brief names two persona conflicts; there are three.** Correction accepted and carried |
| **R-4** | **Service Coordinator vs Dispatcher** | The controlling brief and EMP-WORK's inherited brief list them as **one** candidate role (*"Service Coordinator / Dispatcher"*, *"Service coordination"*) | **Two roles.** EMP-ROLE C-2 (**HIGH**) withdrew its own merge as a violation of its rule; EMP-WORK §1.2 re-derived the separation; EMP-INFORMATION §4 and EMP-PERFORMANCE OD-EMP-012 concur | **CLOSED in favour of TWO roles — four lanes concur, on the dimensions the Owner's own Retail-vs-National-Accounts ruling turns on.** 68 vs 61 activities · **disjoint personas** (Marisol Vega/Rosa Delgado vs Dale Brackett/Brett Hollins, zero overlap) · **asymmetric authorization** — `dispatcher` has a Role **and** a tree placement *above* technicians; `service_coordinator` has **neither** · **different commitment authority** — the Coordinator cannot MarkReady and cannot Dispatch · **different terminal escalation** — the Coordinator escalates **to** the Dispatcher; the Dispatcher escalates to **nobody named**. **The functional split is the point**: *"The person talking to the customer and the person who can see the schedule are two people."* **Merging them would erase the single most consequential handoff in the corpus.** The brief's own rule forbids the merge and the brief itself made it |
| **R-5** | **Parts Associate vs Parts Counter** | **Two roles.** EMP-ROLE F-8: B2 `Parts Associate` (37, Dwayne Holbrook, purchasing/approval work) and B1 `parts_counter` (5, Nate Purcell, truck-stock reconciliation and serialized custody) — different libraries, different personas, different work | **One role.** EMP-INFORMATION §4 normalises `parts_counter` → Parts Associate as one of *"the four genuine synonyms"*. EMP-WORK folds both into a single PARTS/WAREHOUSE DESK job (186 activities) | **BOTH READINGS PRESERVED. OWNER DECISION** (`OD-3`). EMP-ROLE's own verdict: *"Recording both readings per the brief's standard. Whether they are one job role is OWNER DECISION REQUIRED"* |
| **R-6** | **Does Service Manager have a security Role?** | **Yes, under a different name.** EMP-ROLE F-7: *"Service Manager on the chart is this platform's `fieldManager` Role… The name difference is why 'serviceManager' could not be granted earlier — it is this."* **The synthesizer must not treat `fieldManager` and Service Manager as different roles** | **No.** EMP-INFORMATION §4 row 6: Service Manager — *"none as a security Role; `SERVICE_MANAGER` is a reserved, unconsumed `operationalRoles[]` value"*. EMP-PERFORMANCE OD-EMP-019: there is no governed Role named `serviceCoordinator` either; the nearest is `officeManager` | **BOTH TRUE OF DIFFERENT OBJECTS. CLOSED as a naming problem, not a data conflict.** A governed Role whose **capabilities** are the Service Manager's exists (`fieldManager`); a Role **named** `serviceManager` does not; and the `operationalRoles` **value** `SERVICE_MANAGER` exists with no consumer. **All three statements are true simultaneously, and this is the clearest single instance of JOB ROLE ≠ SECURITY ROLE in the corpus.** Any artifact must say which of the three it means |
| **R-7** | **Retail Sales vs National Accounts Sales** | **Distinct JOB roles — the Owner's binding ruling**, and the repository **independently corroborates the chart**: `roleHierarchy.ts:135-139` states *"The chart's National Accounts and Retail Sales columns are CHANNELS, each with its own salespeople"*, i.e. the chart does show them as separate columns under the Sales Manager | **NOT distinct SECURITY Roles, deliberately.** `PLACEMENT_GAPS` — the array's **only** entry: *"Deliberately NOT modelled as Roles: which market a deal belongs to is a property of the DEAL (SALES_CHANNELS), not of the person. A Role per channel multiplies every time a channel is added, and there are already three."* `salesperson` is the single Role | **BOTH RIGHT, ABOUT DIFFERENT THINGS — EMP-PERFORMANCE OD-EMP-020, and this synthesis adopts it.** The ruling is about **job** roles; the repository's model is about **security** Roles; **they deliberately disagree and must not be collapsed.** **Consequences, all recorded: (i)** the evidence distinguishes the two roles on **ZERO of the eleven role dimensions** — `retail` = 0 and `national account` = 0 occurrences across all 1,010 activities (EMP-ROLE §4.2), so EMP-ROLE records **two role entries with identical evidence and refuses to invent a difference**; **(ii)** a per-channel metric is a **record-level grouping, not a per-person Role grouping** (EMP-PERF), and still a gap for two independent reasons; **(iii)** **the ruling is blocked on a DEFERRED MODEL, not on missing evidence** — the coverage/territory model that would carry the distinction is *"built, registered, reachable by nobody"* and the Owner instructed *"record and preserve the seams, do NOT build during the runway."* **That is a scheduling collision the Owner must resolve, not an evidence gap** (EMP-ROLE §4.3, F-6); **(iv)** **there are THREE ratified channels, not two** — `SALES_CHANNELS = ["NATIONAL_ACCOUNTS","RETAIL","STRATEGIC_ACCOUNTS"]`, declared twice server-side, and **the ruling is silent on the third.** This **widens** the ruling and never contradicts it → `OD-20`. **The need is real and observed, not authored**: a pilot finding (not a scenario) records *"a National Accounts rep's opportunities are interleaved with Retail, and the attention-sorted top row was a Retail opportunity, not theirs."* |
| **R-8** | **How many roles does the corpus describe?** | **~10 real jobs** from 40 raw labels (EMP-WORK §1) · **27 distinct roles** after normalising four synonyms (EMP-INFORMATION §4) | **15 role families** from 34 distinct labels (EMP-EXPERIENCE §0.2) · **~30 register rows** holding sub-roles apart (EMP-ROLE §5) | **FOUR NORMALISATIONS OF ONE CORPUS, ALL RECORDED, NONE CHOSEN.** They differ on exactly the judgements this synthesis is forbidden to make silently: whether `parts_counter` is a Parts Associate (R-5), whether `after_hours_coordinator` is a Coordinator on a rota (EMP-WORK flags its own grouping as **this lane's inference, not a corpus fact**), whether `Stocker` and `Stocker/scanner operator` are one (R-3), and whether Administration is one job, two, or an IT function (EMP-ROLE F-11). **EMP-WORK's own §9.6 marks the 40→10 collapse UNPROVEN: *"No artifact in the corpus asserts it."*** **Which vocabulary wins is `OD-1` and needs Owner ratification, not adoption by default** |

### 5.3 ACCOUNTABILITY CONFLICT (4)

| ID | Subject | Reading A | Reading B | Disposition |
|---|---|---|---|---|
| **A-1** | **Is ACCOUNTABLE PERSON absent, or collapsed into RECORD OWNER?** | **ABSENT.** No `accountablePersonId`/`accountableEmployeeId` anywhere; zero hits for `accountable` in `functions/src/ownership/*.ts` or `record-ownership.md`. *"No field, no concept, no vocabulary"* (EMP-ACCOUNTABILITY concept 2; OWN-DESIGN MG-1) | **COLLAPSED.** EMP-EXPERIENCE concept 2: *"the matrix's framing is that 'business responsibility belongs to an employee' (`ownershipMatrix.ts:22`) — accountability **is** ownership. Two different things wear one field"* | **BOTH READINGS PRESERVED AND THEY ARE NOT THE SAME CLAIM.** *Absent* is a statement about **storage** and is verified. *Collapsed* is a statement about **the model's intent** and is also verified — the matrix does assert that business responsibility belongs to an employee, and for the 6 PERSON families it does. **The synthesis-level fact both support: for the 20 COMPANY-owned families there is no person at all, so nothing can be collapsed INTO — which is why "absent" is the right word for operations and "collapsed" is the right word for commerce.** Keep both |
| **A-2** | **Is the ownership model an accountability model?** | **No, and that is legitimate.** EMP-ACCOUNTABILITY §9: for operations it is a **books-and-records** model rather than an accountability model. *"That is a legitimate thing for it to be — but it means the invariant cannot be satisfied by the ownership model at all and needs a second, orthogonal axis"* | **A COMPANY answer is the model's correct output, and MG-1 is a different column.** OWN-DESIGN §7.3 with three affirmative rulings (D-13, D-14, D-15) and an explicit instruction: *"The synthesizer must not read any row in this section as a gap"* | **NOT A CONFLICT ON INSPECTION — THE TWO LANES AGREE AND ARE RECORDED TOGETHER SO NO LATER READER MANUFACTURES ONE.** Both hold that COMPANY ownership of operational work is correct and that the accountability gap is the absence of a **second axis**. **Logged here because the two statements read as opposed and are not**, and because OWN-DESIGN's §7 enumeration of deliberate `NONE`/`REFERENCE`/`COMPANY` answers is **binding on every other artifact**: those are decided, evidenced outcomes, **not gaps** |
| **A-3** | **What to do about `reorder_requests.currentOwner`** | **KEEP, DO NOT RENAME.** EMP-ACCOUNTABILITY §8: *"Naming collision only — correctly identified in the reconciliation and deliberately not folded in. Keep, do not rename (**Tier-2 Rules risk**; `firestore.rules` is **hash-anchored to the live deploy**)"* | **RENAME, OR AMEND THE PRINCIPLE.** OWN-DESIGN OD-OWN-014: *"Either the field is renamed in description (it is a queue, not an owner) or the principle is amended. This lane recommends the former and decides neither."* OWN-E2E OD-OWN-006: *"Rename, or accept the collision with the domain's central term?"* | **OWNER DECISION REQUIRED (`OD-18`) — remedy contested, diagnosis agreed.** All three lanes agree on the facts: `currentOwner` holds a role token, never an employee id; it is the **only** "owner" the user sees (`PartDetail.jsx:1131-1141`, directly above "Assigned to"); the record's **actual** company owner is never rendered; and the disclaimers exist in code the UI does not consult. **The disagreement is entirely about cost**: EMP-ACCOUNTABILITY weighs a Tier-2 Rules change against a naming problem (~15 `firestore.rules` clauses read `currentOwner`); OWN-DESIGN and OWN-E2E weigh the naming collision doing active damage. **OWN-DESIGN's narrowing is the useful one: rename in DESCRIPTION, not in storage** — which carries no Rules risk |
| **A-4** | **Is `reportDefinitions` inside or outside the model?** | **EXCLUDED, *"platform record with its own private-by-owner model — do not disturb"*** (`ownershipMatrix.ts:521`) | **It is the ONLY family in EOS where ownership actually gates access** — `savedDefinitionCommands.ts:268,381,404` on `ownerUid`, and *"the one place a real ownership check runs anywhere in EOS"* | **BOTH TRUE. OWNER DECISION (`OD-21`).** OWN-DESIGN OD-OWN-009 states the paradox exactly: *"simultaneously the only family where ownership functions and the only ownership model the matrix excludes"*, and **instructs that `EXCLUDED` must not be read as ownerlessness — it is a deliberate deferral.** Recorded so no artifact reads it as a gap to close. **And it is the family where departure already bites hardest and unrecoverably** (Q11) |

### 5.4 OWNERSHIP CONFLICT (10)

| ID | Subject | Reading A | Reading B | Disposition |
|---|---|---|---|---|
| **O-1** | **`ownershipMatrix.ts:287-296` — the `reorderRequest` row** | **CORRECTED, NOT STALE.** OWN-E2E C-8: *"`:287-294` already reads `ownerFields: []`, `backfillSource: null`, and its note **records the gap** ('MEASURED DESIGN GAP: 6/6 sandbox requests carry no warehouseId'). It is corrected, not stale."* And §6: there is **no behavioural defect** here — the live reorder path is complete, coherent and fail-closed | **STILL STALE, AND THE CORRECTION IS DECLINED WITH VERBATIM EVIDENCE.** OWN-DESIGN §15 quotes the row at `64008d5a` and shows `reorderCommands.ts:91-92` makes `warehouseId` **and** `operatingCompanyId` **required**, `:190` derives the company from the governed Warehouse, `:130-135` refuses a client-supplied company, `:181-185` refuses a companyless warehouse, and `reorderCallables.ts:177-178` persists both. **Therefore `ownerFields: []` is wrong, `unresolvedPolicy` describes a condition the record can no longer be in, and the note's prospective "Adding it is a schema change" describes a change that HAS SHIPPED.** OWN-DESIGN **reframes** the disagreement: *"the **design** is corrected, the **row describing it** is stale"* — and argues this is **the worse failure** because *"the code is fine and cannot be audited against its own description"* | **BOTH READINGS ARE DEFENSIBLE AND BOTH ARE PRESENTED. NO CHOICE IS MADE.** **This synthesis re-read the row verbatim at baseline and both lanes are factually correct about the layer each describes.** The row still reads `ownerFields: []` · `unresolvedPolicy: "remains OWNERLESS -- measured 6/6 MISSING_REFERENCE, the record cannot say where"` · `note: "MEASURED DESIGN GAP: 6/6 sandbox requests carry no warehouseId. Adding it is a schema change to the reorder request, not a backfill."` — **while the code three files away makes both fields required and refuses three ways.** **OWN-E2E is right that there is no behavioural defect. OWN-DESIGN is right that the description no longer describes the code.** They are answering different questions, and **the reframing is the contribution**: a documentation defect on a correct implementation is not a lesser finding than a behavioural one, because it is what makes the implementation unauditable. OWN-DESIGN **also holds `:327-336` (`stockLocation`) is NOT a defect** — it is *"spent, not wrong"* (its `backfillSource` describes work already applied, census 5/5 RESOLVED) — **agreeing with OWN-E2E and splitting the coordinator's correction in two.** That split is upheld. → `OD-5` |
| **O-2** | **`stock_locations` in the ownership tooling** | **The KEEP is deliberate and sanctioned.** `bin-p2-legacy-inventory-authority-retirement.md:43` rules the ownership-matrix entry **KEEP** — *"already records it as a balance row, not a place."* So the matrix row is sanctioned, not stale (OWN-E2E C-7) | **The real finding is an APPLIER INSTRUCTION, not a description.** OWN-E2E F-2: `ownershipBackfillRules.ts:99` carries an **active rule** writing `operatingCompanyId` onto `stock_locations` and `:228` an **active cap of 5 writes** — against a collection retired as operational authority with **0** readers in `functions/src`, **no `firestore.rules` match block** (deny-all by absence) and its constant **removed** from `constants/collections.ts:24-28`. *"Unlike the matrix row, this is an applier instruction"* | **BOTH, AND THE DESCRIPTION-vs-INSTRUCTION DISTINCTION IS THE RESOLUTION.** The KEEP legitimately covers the matrix **row**; it does not cover a **backfill rule and cap**. **OWN-DESIGN adds the framing that makes it a finding rather than a tidy-up: *"the ownership model is the last authority in EOS still deriving from a collection retired everywhere else"*** (AG-6, OD-OWN-012) — four places (`ownershipMatrix.ts:328-335`, `ownershipBackfillRules.ts:105`, `ownershipDerivation.ts:~80`, `config/ownership/operating-company-roots.sandbox.json`). **OWN-DESIGN also records that its own first pass got the retirement wrong and the brief was right** — and that the **five named documents in the brief's evidence list contain no statement of the retirement**; it lives in `DECISIONS.md`, `firestore.rules`, `constants/collections.ts` and the BIN-P2 assessment. → `OD-22` |
| **O-3** | **A truck's operating company** | **The VEHICLE's.** `ownershipMatrix.ts:364-370` keeps `trucks.operatingCompanyId`; *"a truck **works out of** a depot; it does not belong to the depot's company"*; `cert-trk-04/05` settle it | **The MOBILE LOCATION's.** `ownershipBackfillRules.ts:117-120`: the company *"belongs to the MOBILE LOCATION that holds the stock"* | **MISSING INPUT / OWNER DECISION (`OD-23`).** Two code authorities assert opposite answers at one baseline (AG-7, OD-OWN-007). **Note `mobile_locations` has no company field at all**, so one of the two answers currently has nowhere to live. **And `trucks.operatingCompanyId` is BACKFILL RESIDUE**: 2/2 values stored by the applied sandbox backfill, the rule that produced them **deleted** (`:100-121`), `truckRegistryCommands.ts` never writes it. **The matrix OVERSTATES this row** |
| **O-4** | **Does an Account handoff move Contact/Location visibility?** | **YES.** `record-ownership.md:139,214,226,244` — they move *"immediately and silently"*, and **acceptance criterion 7 requires it** (verified at baseline) | **NO.** `ownershipHandoffCommand.ts:24-30` forbids exactly that, **structurally** (no list input, no children flag): *"NO CASCADE… Handing off an Account leaves its Opportunities exactly where they were."* Contacts and Locations store their **own** `owner` and inherit **at creation only** | **AUTHORITY CONFLICT, UNRESOLVED, BOTH CITED (AG-2 / OD-OWN-004 / `OD-5`).** **EMP-ACCOUNTABILITY's disposition is the one to adopt: the matrix and the handoff command are the later, ratified authority; `record-ownership.md` §4 and AC-7 should be MARKED SUPERSEDED explicitly rather than leaving both standing** — because *"unresolved, a later reader can cite either."* **Consequence under the ratified reading: an Account handoff leaves 339 contacts and 183 locations (sandbox) pointing at the previous owner** |
| **O-5** | **The canonical owner id namespace** | **`employeeId`** — `record-ownership.md` §7; `typedOwner.ts:101` | **Firebase `uid`** — `savedDefinitionCommands.ts:331` (`ownerUid`); `reorderCommands.ts:201` (`requestedBy: ctx.actorUid`) | **MODEL GAP, open item O-1, UNRULED (`OD-4`).** *"The ruling named the type, not the identifier."* Eight families affected. **Both namespaces are in live use and nothing has ruled which is canonical where** |
| **O-6** | **Which company field on `employees` is authoritative?** | **`companyId`** — declared, *"Future — reserved, unused this sprint"* | **`operatingCompanyId`** — **live-editable** (`employeeProfileCommands.ts:215`), validated `:348`, merged by `updateEmployeeProfile`, and **not** set by `provisionEmployeeAccess.js` | **AUTHORITY GAP, NEITHER RULED (AG-5).** *"It exists only where someone later edited a profile."* **Compounding: `metadata/definitions/employee.js` records `companyId`/`departmentId`/`locationId` as reserved with every write path setting all three to `null` unconditionally** — so **there is no per-person anchor to scope any number by**, and a scoped number is **MISSING, not PARTIAL, for every role below General Manager** (EMP-INFORMATION M-5) |
| **O-7** | **Does the financial block have owner storage?** | **`ownerFields: []`** — `ownershipMatrix.ts:182` for all five financial families, and the census consequently reports a company-stamped invoice as **OWNERLESS** (*"family has no ownership storage yet"*) | **It is factually wrong.** `InvoiceRecord.companyId: string` is **required** (`invoiceCommands.ts:214`), written at `:294`, under the structural invariant `companyId === attribution.operatingCompanyId` (`:292-293`); `payments`, `refunds` and `invoice_adjustments` carry `companyId` too. **And the frontend is MORE accurate than the matrix**: `profiles/invoice.js:96` and `profiles/payment.js:112` correctly say `companyField: "companyId"` | **CLOSED AS A MATRIX DEFECT (OD-OWN-008 / AG-8 / `OD-5`).** *"This is the `workOrder` correction in the opposite direction, and it has not been made."* **A grep for `operatingCompanyId` misses the entire financial tier** — it appears only *nested* inside `attribution`. **And the asymmetry is instructive: two parallel ownership vocabularies exist, the frontend re-types `ownerClass`/`companyScope`/`companyField` by hand for 3 of 51 families citing the matrix without importing it, and on this tier the hand-copy is right and the source of truth is wrong** |
| **O-8** | **`record-ownership.md`'s creation rule** | **"Whoever creates a record owns it"** · *"the owner always resolves to the actor"* · *"A create command never accepts an owner from input"* — verified at `:33` and `:220` | **EXPLICIT → INHERIT GOVERNED UPSTREAM → REFUSE**, with the actor **explicitly never a fallback** — `creationOwnerResolution.ts:12-23`, ruling **D-4** (2026-08-30), which refuses **six named fallbacks**: actor, `createdBy`, authenticated user, `assignedTo`, an arbitrary salesperson, an admin, the first available employee | **CLOSED: the specification states the SUPERSEDED model and is NOT MARKED AS SUCH (AG-1 / OD-OWN-013 / `OD-5`).** Three lanes independently. **Consequence that already happened: *"A lane reading the named evidence in order would adopt the wrong rule."*** **And the standing rule is the strongest part of the whole model and must not be weakened**: *"Customer owner = Rudy. An assistant calls createOpportunity with no ownerEmployeeId. Result: owner = Rudy, createdBy = the assistant."* — **the Owner's ruling "an assistant creating a record does not acquire ownership by acting" is implemented, tested and correct** |
| **O-9** | **`docs/OWNERSHIP.md` as record-ownership evidence** | The controlling brief listed it (63 lines) among record-ownership evidence | **It is IP / company / product ownership and AI attribution** — Founder, entity formation, trademark, `Co-Authored-By` policy. Verified at baseline: its own header states it owns *"human/company ownership, attribution, and IP posture"*. **It contains nothing about record ownership, accountability, handoff or employees** | **CLOSED. The brief is wrong; the correction is accepted and already carried by the controlling brief.** Found independently by EMP-ACCOUNTABILITY (#1) and OWN-DESIGN (§1), and confirmed by OWN-E2E. **The brief's instruction "do not write it" remains correct — for a different reason than implied.** Recorded here so it is never cited again |
| **O-10** | **Is `accountOwner` an ownership field or an assignment record?** | **An ownership field** — the matrix's `ownerFields: ["accountOwner"]`, projected as ownership by `typedOwner.ts:95-109` | **A seven-field Person Assignment map** whose ownership-bearing key is `assignedToEmployeeId`, written by the UI, with a completeness invariant rejecting partial records, declared in metadata as *"one of seven fields in the stored Person Assignment map"* — **and `customerMigrationSource.ts:127-158` accepts TWO owner shapes on the same field** (`{type,id}` **and** `{assignedToEmployeeId}`) | **BOTH TRUE. OWNER DECISION (`OD-24`).** OWN-E2E OD-OWN-010: *"Ratify the assignment-shaped storage, or normalise ownership to a typed owner distinct from assignment?"* **The root ownership fact of the whole person chain is literally stored inside an assignment record — the vocabulary collapse is at the STORAGE level, not just the label.** Combined with no Rules guard (AU-5) and an unreachable governed setter, **OWN-E2E rates this the single highest-value corruption path in the model** |

### 5.5 ASSIGNMENT CONFLICT (4)

| ID | Subject | Reading A | Reading B | Disposition |
|---|---|---|---|---|
| **AS-1** | **Does assignment ever move ownership?** | **NO — the standing Owner ruling**, and EOS proves it in code: `reassignWorkOrderTechnician` is a **separate audited action** from `OWNERSHIP_HANDOFF` (`auditEventWriter.ts:256`), with `reassignedFromTechId`/`reassignedAt`/`reassignedReason` and a **required reason** (H20) | **YES, ONCE, AND RULES ENFORCE IT.** `firestore.rules:765-790`: the reorder **Assign** branch changes `currentOwner` to `"PARTS_ASSOCIATE"` **and** sets `assignedToUserId` **in one write**; the **Approve** branch writes `currentOwner == "PARTS_MANAGER"` with **no assignee at all** | **BOTH PRESERVED, AND THE EXCEPTION IS NAMED. OWN-E2E AG-9 (CONFIRMED): *"the one genuine contradiction of 'reassignment ≠ ownership transfer' in EOS."*** **The defence and the rebuttal both stand:** the defence is that `currentOwner` holds a **role** and was never ownership; the rebuttal is that this is **precisely the naming collision `domain/constants.js:276-287` warns about** — `OPERATIONAL_ROLE.PARTS_MANAGER` and `REORDER_REQUEST_OWNER.PARTS_MANAGER` *"are the same string but mean two unrelated things on two unrelated fields"* — and **a field named `currentOwner`, mutated by an approval, is the collision doing damage.** **The Owner's ruling is not violated in substance and is violated in vocabulary, enforced.** Remedy is `OD-18` |
| **AS-2** | **`requiresOwnAssignment`** | **Correct as authorization** — it is what makes "only the assigned technician may advance this job" true, and `transitionEngine.ts:129-140` correctly separates dispatcher-held transitions (`false`) from technician-held ones (`true`) | **Dangerous as accountability** — it makes the assignee the **only** possible actor, converting an assignment gap into a **hard lock**. `Accept`, `Travel`, `Arrive`, `WorkStart` and `Complete` are all `true`, so **disabling a principal strands every Work Order assigned to them and nobody else can advance them. One administrative click can immobilise a day's field work** | **BOTH TRUE AND THE TENSION IS THE FINDING** (EMP-ACCT §8; OWN-E2E WG-6 CONFIRMED). **It is the operational face of the departure gap: employee deactivation has no ownership OR assignment consequence, and the absence bites hardest on the family with no owner at all.** Not a defect in `requiresOwnAssignment`; a defect in the absence of an exit. → `OD-13` |
| **AS-3** | **A dispatcher acting on a technician's Work Order** | It looks like an accountability override | **It is role authority, not escalation and not an ownership transfer.** `transitionEngine.ts:129-140` — dispatcher-held transitions (`MarkReady`/`Schedule`/`Dispatch`/`Close`/`Cancel`) are `requiresOwnAssignment: false` by design | **CLOSED in favour of reading B — and it is *"the closest thing in EOS to escalation, and it is not escalation"*** (OWN-DESIGN Panel C). Recorded so no artifact promotes a role-authority transition into an escalation mechanism. **The Owner ruling "manager intervention ≠ ownership transfer" is upheld by the code** |
| **AS-4** | **Can two people be responsible for one job?** | The business does it routinely — *"Two technicians on one job — routine for an install or a heavy lift"* | **Unrepresentable.** One `assignedTechId`, no multi-technician concept. **And `assignedTechId` is MUTABLE after completion and carries NO per-transition actor** (`ACTION_TIMESTAMP_FIELD` records none), so *"a WO that's since been CLOSED by a dispatcher still counts as completed by this technician"* | **CLOSED as a MODEL GAP with a measured consequence.** *"Attribution is what pay, scheduling and performance all rest on."* **The attribution follows a mutable field, not the person who did the work** — and the corpus records the result: *"completion counts that include handoffs completed by the wrong technician and jobs completed with nothing recorded."* → `OD-15` |

### 5.6 AUTHORITY CONFLICT (11)

| ID | Subject | Reading A | Reading B | Disposition |
|---|---|---|---|---|
| **AU-1** | **"Who manages this person?"** | **A ROLE POSITION.** `roleHierarchy.ts:9-20`: *"the tree lives here, with the Role definitions, rather than as a `reportsTo` field maintained per employee… The Owner named `reportsTo` on the employee as a **NICE TO HAVE**… **It is deliberately not modelled yet**"*, with the stated consequence *"**With role-only hierarchy, EVERY salesManager sees EVERY salesperson**"* | **A PERSON.** `employees.managerEmployeeId`, `kind: "MANAGER"` (`employeeProfileCommands.ts:214`) — a real, governed, **relationally validated** field: the update command reads the referenced employee **inside its transaction** to prove it exists (`:498-515`) and refuses a self-manager (`:534-538`) | **AUTHORITY CONFLICT, UNRESOLVED — the single most-cited conflict in the corpus. FOUR LANES reached it independently** (EMP-ROLE F-1, EMP-ACCT §1.1, OWN-DESIGN AG-3/§4.3(iii), EMP-EXP concept 4; EMP-INFO M-7 marks every dependent row `UNKNOWN — REVERIFY`). **The two are conflated in OPPOSITE DIRECTIONS and nothing reconciles them**: one derives the manager relation from the **security Role** (so a security Role does a job-role's and a manager-edge's work at once) and yields a **set**; the other stores a specific **person** and is nullable, **never backfilled**, and read by **four display/metadata sites and zero authorization, visibility, workflow or routing paths.** **`roleHierarchy.ts` is explicit that the per-employee field is the UNBUILT refinement — while that field now exists, unread.** **Decisive consequence: "escalate to their manager" evaluates to either *every manager of that branch* or *null*.** A second escalation tier is **not expressible today**, independently of there being no escalation mechanism at all. **EMP-ACCOUNTABILITY's OD-EMP-005 offers the only recommendation the evidence supports — (a) `managerEmployeeId` canonical for accountability and escalation, (b) role hierarchy retained unchanged for visibility, which is the separation `roleHierarchy.ts:22-25` already draws — and notes that this makes POPULATING the field a prerequisite, not a nicety.** **Carried as a recommendation, not a decision** → `OD-6b` |
| **AU-2** | **Is ownership handoff INERT?** | **YES** — `ownershipHandoffCommand.ts:8-14` claims inertness, and it is true of callables: **zero** occurrences of `ownership` in `functions/src/index.ts` (87 exports) | **NO, it has one live door** — `functions/scripts/assignWarehouseRootCompany.js:72,234` calls `stageOwnershipHandoff` **inside a real transaction** | **CLOSED AS A PRECISION, NOT A CONFLICT — and three lanes found it independently** (OWN-DESIGN OD-OWN-005 *"before the correction arrived"*, OWN-E2E §4, EMP-ACCT UN-1). **"Inert" is accurate for callables and inaccurate for operator tooling.** The precise claim: *"no callable, route or component reaches it"* is true; *"nothing calls it"* is false. **Recorded so nobody relies on an inertness that has one door. Not activated by any lane, and not activated here** |
| **AU-3** | **Where does handoff safety live?** | The matrix and `ownershipHandoffCommand` are the ownership authority | **All five family-level refusals exist ONLY in the module nothing calls.** OWN-E2E F-1, **EXECUTED, two probes**: the **LIVE** `auditEventWriter` imports only `typedOwner` (`:58`), **never `ownershipMatrix`**, validates `targetType` as a non-empty string (`:470-471`), and its handoff block (`:514-600`) checks `objectId`, owner *shape*, the no-op case, `handoffSource` and reason hygiene — **and no family semantics at all.** It **ACCEPTED** an `OWNERSHIP_HANDOFF` for an invoice, a payment, an inventory transaction, a part, an audit event, a role assignment, a transfer order, a nonexistent family, and an Account given a COMPANY owner | **CLOSED AS THE LANE'S HEADLINE, EXECUTED. `OWNERSHIP_HANDOFF` is a valid `AuditAction` and `auditEventWriter` has many live callers, so this is reachable the moment any caller passes the action.** **Wiring the handoff by calling the audit writer directly — the shortest path — would produce exactly the corruption the matrix was written to prevent.** → `OD-7`. *(Nothing was committed: a fake in-memory writer counted 10 staged objects in an array.)* |
| **AU-4** | **Does ownership govern access?** | Implied throughout the design documents | **NO — not at all.** OWN-DESIGN §3.2: `firestore.rules` (and its byte-identical copy) contains **zero owner-field predicates** — no `accountOwner`, no `ownerEmployeeId`, no `ownerUid`, no `data.owner`. `operatingCompanyId` appears on five lines and **none is an access predicate.** **Rules enforce ASSIGNMENT and ROLE; they never enforce OWNERSHIP.** The one ownership check in the entire product is `savedDefinitionCommands.ts:268,381` | **CLOSED (OD-OWN-016). *"Any statement that ownership 'governs access' is false at this baseline."*** **And the generalisation: ownership has no visibility effect, no work-queue effect and no reporting effect on 24 of the 25 families** — visibility is decided by FIN-004 scopes keyed on `creditedSalespersonId`/`companyId` plus RoleAssignment grants; work queues by `status` + `currentOwner` role tokens + `requiresOwnAssignment`; reporting by the FIN-002 attribution snapshot. **None of these reads an owner field.** The sole exception is the one family the matrix classifies EXCLUDED. **This is the most load-bearing framing in OWN-DESIGN: *"the ownership matrix is the clearest statement of intent in the repository and nothing deployed reads it."*** |
| **AU-5** | **Who can change a record owner?** | Only a governed, audited handoff | **Any `admin` OR `dispatcher`, by generic client write, unguarded and unaudited.** `firestore.rules:1332-1337` on `accounts` — the "governed fields" are **only `paymentTerms` and `taxStatus`**, `accountOwner` is **not** among them, and **there is no `hasOnly` key restriction on the write.** Identical exposure: `contacts.owner` (`:1557`, bare `isAdminOrDispatcher()`), `locations.owner` (`:1343`), `fieldops_jobs.operatingCompanyId` (`:382-391`, **no `hasOnly`**) | **CLOSED, AND IT INTERSECTS THE OCCUPANCY FINDING TO BECOME SHARP.** **Production holds exactly ONE active role assignment and it is `admin` at global scope. The one principal that exists in production is precisely the one who can silently rewrite ownership on `accounts`, `contacts` and `locations`.** Rules themselves record this as an *"INTERIM path"* pending a trusted audited writer. **Two lanes measured it from opposite sides** (OWN-E2E F-4 by Rules read; EMP-EXPERIENCE §3.4 by the shipping client write at `AccountForm.jsx:162-171` plus a "Clear owner" button at `:465`). **One honest caveat OWN-E2E states about its own headline: U-9 — the Rules behaviour was read as source, never executed** (no JRE; port 8080 held). *"This is the one place my headline claim rests on STATIC READ, and it should be executed before it is relied on."* **Partially corroborated from the other side: the client-direct owner write ships in the product and evidently succeeds.** → `OD-8` |
| **AU-6** | **How many authorities answer "may this person do this?"** | One — the 147-capability engine, with `roleAssignments` as *"the sole source of an ALLOW"* | **THREE.** (i) **44 legacy role-string sites in Rules** — and for Firestore Rules `roleAssignments` is `allow read, write: if false` and contributes to **NO** ALLOW; every Rules ALLOW comes from `isSignedIn()`, `isAdminOrDispatcher()` or `isActiveOperationalRole()`, i.e. from `users.role` and the linked Employee, **never from a governed Role** (Rules **cannot** call the resolver, stated at `firestore.rules:1576-1586`). (ii) The 147-capability engine. (iii) **A Postgres object/field store** — the Roles & Permissions screen edits the **Postgres** store while every sales/CRM/finance command resolves against the **Firebase** capability model | **CLOSED AS A THREE-WAY AUTHORITY SPLIT (EMP-INFO §6.2 Policy hop = MISSING; OWN-E2E "also wrong in the brief's framing").** *"`roleAssignments` is the sole source of an ALLOW"* is **true only of the trusted callable surface** and **false for Firestore Rules.** **Load-bearing consequence: the 3 compatibility Roles are the only ones Rules can see, and they are exactly the Roles that carry the AU-5 ownership-write exposure.** And EMP-EXPERIENCE confirms and **understates**: `roleAssignments` is read at **15+ independent sites**, each declaring its own collection constant — *"a queue's authority answer is assembled per domain"* |
| **AU-7** | **Report row scope** | The scope model governs report rows | **Hardcoded global, bypassing the scope model in BOTH directions.** `reportExecutionService.ts:421` — `const target: TargetContext = { scope: { type: "global" }, condition: {} };`. A runner holding the object capability sees **every row**; a grant held at `ownAssignment` or `location` scope resolves to **nothing** | **CLOSED (OWN-E2E AG-10, CONFIRMED). *"The one reporting surface that could have honoured owner-scoping deliberately does not."*** **Compounding (EMP-INFO B-3): row scope is closed for ZERO of four reachable objects** — `customer`, `contact`, `location`, **`equipment`** (the brief's list omitted Equipment). The other eight of twelve carry no fields. **So a company-scoped number over Accounts, Contacts, Locations or Equipment cannot be produced correctly**, and three of the four are `COMPANY_NEUTRAL` in the matrix by design |
| **AU-8** | **The effective-permission trace** | The brief's required trace is **Role → Capability → Assignment → Policy → Operating Company** | **That sentence exists NOWHERE in the repository.** EMP-INFORMATION B-7 searched all 97 worktrees — literal arrow chains, `Assignment →`, `→ Operating Company`, all-five-nouns-on-one-line across every `.md`, a relaxed four-noun search, and `functions/src/access/**` comments — **zero hits.** Nearest real artifacts: `ADR-005:63` (*"effective-permission preview/explanation"* as an MVP item), an implementation-plan Task 16, and p3a3 archaeology classifying `/administration/roles-permissions` as an **AUTHORITY GAP** | **RECORDED AS AN UNSOURCED SYNTHESIS THAT EMP-INFORMATION NEVERTHELESS ADOPTS AS A REQUIREMENT** — *"but it must be recorded as a new requirement needing ratification, not quoted as an existing finding."* **That posture is adopted here.** **All five hops are real and TWO are MISSING** (Policy — three authorities disagree; Operating Company — no `operatingCompanyId` on the Work Order, enforcement forbidden until the census gate, `employees.companyId` always null) **and TWO are PARTIAL** (Role — no Role to name for 9 of 27 observed roles; Assignment — an unratified staleness interpretation). **Verdict: the effective-permission explanation the programme requires cannot be produced at `64008d5a` for ANY role.** → `OD-26` |
| **AU-9** | **The stale-access-version interpretation** | The resolver's reading is settled | **Recorded for Owner review and unratified.** `resolveEffectivePermission.ts:131-142` records **its own** interpretation of *"consistent with the current accessVersion"* as `accessVersionAtGrant <= currentAccessVersion` and notes it was **recorded for Owner review**; corpus `P3B3-MGMT-043` asks *"Has that interpretation been ratified?"* | **OWNER DECISION (`OD-27`).** **The Assignment hop of the trace cannot be cited with confidence until it is ratified** |
| **AU-10** | **Do performance goals exist?** | **`performance_goals` / `performance.goal.*`** — the governed object: draft → approve → supersede → retire, **five capabilities, six callables, a metric registry, a subject Role.** *"Machinery genuinely COMPLETE… the clearest counter-example to 'nothing is built': what is missing is an activation decision, not code"* — but all five capabilities are `active:false`, activated in `platform-sandbox` **only**, and the collection has **no `firestore.rules` match block** | **FIN-003 plan records (GOAL mode)** — the financial plan a Sales-to-Goal surface compares against. **AUTHORITY GAP `FIN-AG-PLAN`: *"goal records have no collection, no command, no read callable"*** (`BUILT_DORMANT` + `DATA SUPPLY MISSING`) | **BOTH EXIST AND MUST NOT BE CONFLATED (EMP-PERFORMANCE OD-EMP-018). *"A synthesiser reading only one of these will contradict itself."*** **A target set through `performance.goal.create` does NOT populate the financial Goal column, and vice versa. Never report "goals exist" or "goals do not exist" without naming which authority.** The shipped Employee Performance page is blocked on the **second** and says so |
| **AU-11** | **Role occupancy evidence** | **Production: measured ZERO** — `r32-production-exposure-census`, committed, read-only, `writesPerformed: 0`, an ancestor of HEAD (§2) | **Sandbox: 86 assignments across 30 Roles** (`certification-grant-manifest.json:3-4`, pre-state `pre-grant-snapshot.json`, all 47 cert employees `currentRoleAssignmentExists: false`). **And a THIRD table: `capacity-report.json`, 47 employees — ALL SYNTHETIC** (`buildWorkforce()`: *"ALL IDENTITIES ARE SYNTHETIC"*; ids `cw-emp-000`), one environment, and it is the sandbox | **ALL THREE RECORDED, NONE MERGED.** **EMP-PERFORMANCE's sharpening is the one to carry: *"Occupancy by REAL employees is not measured anywhere in this repository, and the one occupancy table that exists is over a SYNTHETIC roster."*** In that synthetic roster **30 of 45 governed Roles are occupied and 15 are not** — including **`performanceGoalSubject`, whose entire purpose is to let a measured person read their own target, with ZERO holders even there**, plus `technicianLaborRecorder` and `workOrderLaborCorrector` (**unoccupied AND inert**) and **`controller`** (an actor on 20 workflows). **Sandbox is the only environment with both occupancy and activation, so it is the only place a role-shaped queue has ever been non-empty — and no lane ran a workflow there either** (EMP-EXP U-19). **One stale claim must NOT be carried: `docs/governance/effective-authority.md:97-101` — *"Reporting — 39 capabilities, nobody holds them (LARGEST OPEN GAP)… Reporting is unreachable for every persona"*** — is dated 2026-08-21 and **tabulates only 20 Roles**, stale against 45; `reportViewer` (7), `reportFinanceViewer` (3) and `reportAuthor` (4) all have holders in the synthetic roster. **UNKNOWN — REVERIFY: the production census is a 2026-09-02 snapshot against a 2026-09-12 baseline** → `OD-2` |

### 5.7 WORKFLOW CONFLICT (8)

| ID | Subject | Reading A | Reading B | Disposition |
|---|---|---|---|---|
| **W-1** | **What happens to a dispatched job when the technician is unavailable?** | The lifecycle is deliberately closed: *"Once a technician has been dispatched the job is committed, so DISPATCHED / ACCEPTED / EN_ROUTE / ARRIVED / WORK_IN_PROGRESS have **no way back**"* — and `Unschedule` is allowed from `SCHEDULED` **and nowhere else** | **The only expressible answer is to destroy the record of a live customer commitment.** From any of five active statuses the only exits are the next forward step — performable **solely by the assigned technician** — or `CANCELLED`. Corpus: *"None of the four can be reassigned. All four must be cancelled and recreated"*, losing *"the arrivedAt, workStartedAt and three hours of execution data"* | **BOTH TRUE. THE CLOSURE IS DELIBERATE AND ITS CONSEQUENCE IS UNINTENDED. CRITICAL.** Three lanes independently (EMP-ACCT ORPHAN-1, OWN-E2E F-9, EMP-WORK). **OWN-E2E broadens it: it is FIVE terminal-ish states, not two.** **Compounding: the double-booking guard means an orphaned Work Order PERMANENTLY CONSUMES its technician's dispatch capacity** — *"It blocks dispatch to a technician who no longer exists."* **Stage 14 is therefore MISSING at the MODEL level, not merely unimplemented: there is no representation for responsibility moving when work fails, and the workaround destroys the commercial record.** → `OD-13` |
| **W-2** | **Can a technician record "I could not do this"?** | The lifecycle models a visit that succeeds | **No governed non-completion exists.** *"there is no 'I could not do this' outcome, so a technician's real day has no governed expression"* — the corpus records the same dead end **four times in one story** (store shut · wrong address · machine fine · customer refuses over an unpaid invoice) | **CLOSED as the MOST-CITED GAP IN THE CORPUS** (EMP-EXPERIENCE EXP-051, `OD-13`). **And it has a measurement consequence EMP-PERFORMANCE names: with no governed "could not complete, and why", an exception cannot be separated from a refusal, so no exception-rate metric can be attributed at all.** Also unavailable: a correction path for a mis-tapped `Arrive` (*"the only recovery is a back-office correction outside the lifecycle, and there is no such correction path in the technician's app"*) |
| **W-3** | **Can a reorder request be reassigned?** | The workflow is a clean pull model with role custody | **No reassignment branch exists in Rules, and there is no reverse edge.** *"there is no branch from `ASSIGNED_TO_PARTS_ASSOCIATE` back to `READY_FOR_PARTS_MANAGER`"*, and *"A colleague tries to start purchasing on someone else's request… This is the single most likely real-world friction in the whole procurement chain, and there is NO reassignment branch in Rules to resolve it"* → *"The order misses the cut-off"* | **CLOSED as WORKFLOW GAP + MODEL GAP** (EMP-ACCT ORPHAN-3, EMP-WORK §5). **And the purest statement of the invariant's failure is here, from the corpus itself: *"Ownership by ROLE with no assignee is the classic 'everyone's job is nobody's job' state."*** **Compounded: the Parts Manager who raises the request cannot approve, reject or cancel one — only an administrator or dispatcher can, and `reorder.request.approve/reject/cancel` reach NO governed business Role** |
| **W-4** | **Does anything escalate inbound work by content?** | `NEEDS_REVIEW` exists as a status-level escalation — *"Routing demanded manual review… **Same queue, louder**"* | **Nothing escalates by content, and the escalation that exists is invisible.** *"An emergency emailed at 18:30 waits until 06:40, and nothing escalates it regardless of content."* After 17:30 *"the coordinator taking an emergency call cannot dispatch anybody."* **And the `AWAITING_DECISION` vs `NEEDS_REVIEW` distinction is *"in the code comment and nowhere on screen."*** **No person, no timer, no target.** **And no assignee step at all**: a request sits in a `queue` until `decisionBy` records who happened to act | **BOTH TRUE. WORKFLOW GAP (WG-5) + MODEL GAP.** The status ladder exists and is not escalation. **The standing workaround is recorded in the corpus as a defect in its own right: *"every on-call coordinator is permanently a dispatcher"* — "a standing over-grant created by an after-hours gap."** And `ACTION_PERMISSIONS` has **no time-of-day or on-call dimension** at all → `OD-28` |
| **W-5** | **The `accessRequests` approval workflow** | `approverConstraint` (`distinctFromRequester` / `platformAdmin` / `companyAdmin`) is **the only *typed* accountability constraint in EOS** | **Its workflow and UI are EXPLICITLY DEFERRED** (`types/access.ts:193-197`), so the constraint **has no process behind it** | **CLOSED as WORKFLOW GAP (WG-4).** **Both halves matter: EOS's single best accountability primitive exists and is unreachable.** Approval is **threshold-based, not person-based** — `ApprovalPolicyLine{actionType, requiresApproval, thresholdMinor}` decides *whether* approval is needed, **never *who*** |
| **W-6** | **Blocked-time overlap** | Corpus `P3B1-S05-A02` records `behaviourClaim: DESIRED` — an Owner ruling *"ACCEPTED — overlapping blocked-time facts are legitimate and unavailable time is their UNION"*, **postdating the shipped behaviour** | Archaeology §4.1: *"Tonight's Owner ruling overturns shipped code — **and the shipped fix was applied in the wrong place**"* | **BOTH RECORDED (EMP-WORK §7).** The corpus captures the intended end state; the archaeology captures that the code disagrees **and was patched in the wrong layer**. `P3B1-S05-A10` adds that *"removing the overlap refusal (as the Owner ruling requires) would expose"* a further defect. **And the measured consequence is live: `blockedMinutesInBand` SUMs clipped durations while `availabilityModel` UNIONs minutes, so two identical 8-hour PTO records draw SIXTEEN HOURS BLOCKED ON AN EIGHT-HOUR LANE** |
| **W-7** | **Technician truck handoff** | Corpus `S30-A02`/`S23-A07` treat truck receipt as workable | Archaeology Pt 12.13: *"A technician cannot accept a truck handoff without over-granting — resolved by creating `inventoryTransferReceiver`… **but the design record still describes it as open in three places**"* | **BOTH RECORDED. Resolved in code, stale in three design documents** (EMP-WORK §7). **The same failure shape as O-1: correct code with a stale description.** *(And `inventoryTransferReceiver` is one of the 15 Roles unoccupied even in the synthetic roster.)* |
| **W-8** | **Reorder gating by legacy role string** | A passed-on claim: the contextual assistant bypasses the capability catalog | **Measured FALSE for the assistant** (`assistantStarters.ts:57-58` gates on capability ids) and **TRUE for the UI control** (`RequestReorderControl.jsx:65-67` gates on `role === ROLES.ADMIN` etc.). *"The assistant's real defect is different and larger: **it is wired to nothing**"* — `functions/src/index.ts` contains no assistant export | **CLOSED: THE ARCHAEOLOGY IS CORRECT AND SHARPER.** EMP-WORK cites this *"as the model for how to state such a claim"*, and **this synthesis adopts it as the standard for the whole register: split a passed-on claim into the part that is false and the part that is true, and name the larger defect the original claim concealed** |

### 5.8 ENGINEERING GAP — where lanes disagree about the CLASS, not the fact (5)

Every other engineering gap is in
[`EMPLOYEE-ENGINEERING-IMPLICATIONS.md`](EMPLOYEE-ENGINEERING-IMPLICATIONS.md). These five are here
because two lanes classified the **same fact** differently, and the classification changes who fixes it.

| ID | Fact (agreed) | Class per lane A | Class per lane B | Disposition |
|---|---|---|---|---|
| **EG-C1** | `managerEmployeeId` is stored, relationally validated, and read by **nothing but display metadata** | **ENGINEERING GAP, explicitly not a model gap** — OWN-DESIGN §4.3(ii), EG-2: *"'escalate to their manager' has storage and no mechanism"* | **MODEL GAP** — EMP-ACCOUNTABILITY §1.1: *"for accountability it is a MODEL GAP, because accountability requires exactly one identifiable person and role-derived hierarchy structurally cannot supply one"* | **BOTH, FOR DIFFERENT QUESTIONS, AND THE DISTINCTION IS LOAD-BEARING.** *"Who is this person's manager"* is an **ENGINEERING GAP** (the field exists; nothing routes on it). *"Which of two contradictory manager authorities is canonical"* is an **AUTHORITY CONFLICT** (AU-1). *"Can accountability be escalated to a manager at all"* is a **MODEL GAP** (no escalation concept). **Three gaps, one field. Fixing the engineering one does not close the other two** |
| **EG-C2** | `contacts.owner` / `locations.owner` are declared and not written by the live path | **ENGINEERING GAP** — OWN-DESIGN EG-8: *"declared but never written by any live path; only the sandbox backfill sets them"* | **Sharper and worse** — OWN-E2E §7A: the only writer is `crm/customerRepository.ts:215-244,294-303` (`inheritOwnerFromAccount`) and it is **Postgres-only**; there is **no `onCall` in `functions/src/crm/`** and no `owner` field in the contact/location metadata definitions. **So the matrix describes storage in a DIFFERENT DATASTORE from the one the census and Rules operate on** → stages 2 and 3 downgraded to PA | **OWN-E2E's IS ADOPTED AS THE SHARPER READING, AND IT RAISES A LIVE RISK: the two largest backfill caps in the authorized total (`contacts: 337` + `locations: 180` = **51% of 1013**) may target a field that does not exist where the applier writes.** OWN-E2E U-11: *"Confirm the applier's target datastore before any backfill runs."* **This is the highest-consequence UNPROVEN in the corpus** |
| **EG-C3** | The false-empty report defect | The controlling brief: **recently fixed** | **LIVE at this baseline** — EMP-INFORMATION B-8, re-verified by this synthesis in `reportRunOutcome.js` | **CLOSED: LIVE. The brief is wrong and the correction is upheld.** `MAX_SCAN_DOCS = MAX_RESULT_ROWS * 2` and `MAX_RESULT_ROWS = 10_000` → **20,000**. Reproduction recorded at `92db1d19`: 4 equipment docs, `maxScanDocs 2`, one matching doc beyond the page → `{ kind: "empty", rowCount: 0, truncated: true }` with audit `outcome: "applied"`. **"No records matched" was false, and the audit trail recorded it as a clean answer** |
| **EG-C4** | The five unreachable capability gates | The controlling brief: **recently fixed**; and *"five built surfaces"* | **LIVE**, and it is **five capability ids at five gate sites spanning FOUR PAGES** — EMP-EXPERIENCE C-4/§7.1 re-measured `REPORT_CAPABILITY_REQUEST` = **44** unique ids; Financial Policy contributes two ids. EMP-INFORMATION U-1 records the exact membership of "the five" as `UNKNOWN — REVERIFY` because four sources enumerate overlapping but not identical sets (also naming Data Import and Administration→Users) | **CLOSED: LIVE, and the mechanism is not in doubt. The COUNT of five is TRACED, not executed** — the registry's own words. **Both lanes verified all five gated ids are absent from the request set.** **The mechanism is worse than ungranted or inactive: no grant, no activation and no Role change can reach it, and the user is told NOTHING** — `inventory.location.bin.read` **is** in the 44, so racking reads and no control works, *"including for `inventoryBinAdministrator`, the Role built to hold it"* |
| **EG-C5** | Two of the 12 registry-active metrics rest on a **client-side unbounded Firestore query** (`getTechnicianExecutionStats()`, `executionAnalyticsService.ts:136-138`, **no `limit()`**) | The registry treats them as ACTIVE and measurable | **In tension with the registry's own stated principle *"DOMAIN AUTHORITY OWNS THE ACTUAL"*** — *"a browser-side read is not a server authority"*; its row scope is whatever `firestore.rules` permits rather than a governed server scope, **and its completeness at scale is unverified, so a zero from it is not provably complete** | **CLOSED as ENGINEERING GAP + TESTABILITY (EMP-PERFORMANCE OD-EMP-008, UNPROVEN-1).** *"Any production use needs a server-side authority with a provable scope, or the number must be labelled incomplete."* **This is the one place the metric registry's own discipline is not met by its own active entries** |

### 5.9 OWNER DECISION REQUIRED

Consolidated, de-duplicated and renumbered in
[`EMPLOYEE-OPEN-DECISIONS.md`](EMPLOYEE-OPEN-DECISIONS.md) — **41 primary decisions plus 7
sub-decisions (48 rows), consolidated from 117 lane-local `OD-*` items, 90 MISSING INPUT items and ~96
UNPROVEN items**, each preserving its originating lane ids as provenance. **This synthesis answers none
of them.**

> **RENUMBERING WAS NECESSARY, AND THE REASON IS ITSELF A FINDING.** The 117 lane-local decision items
> occupy only **50 distinct id strings** — the lane namespaces **collide**, and they collide on the most
> load-bearing ids. **`OD-EMP-001` means FOUR DIFFERENT DECISIONS** (EMP-ACCOUNTABILITY: *is
> accountability a distinct axis?* · EMP-INFORMATION: *ratify the effective-permission trace* ·
> EMP-PERFORMANCE: *no metric is production-measurable as a goal* · EMP-EXPERIENCE: *what is the
> authoritative JOB ROLE?*) **and `OD-OWN-001` means THREE.** Any consolidation preserving the
> lane-local ids would be ambiguous at exactly the points that matter most.

---

## 6. CORRECTIONS TO THE CONTROLLING BRIEF

Offered because correcting the brief is in scope and expected.

| # | The brief said | Finding at `64008d5a` | Severity |
|---|---|---|---|
| **B-1** | *"The production capability count is contested three ways by three methods — **37 EXECUTED, 36 static catalog-active, 38 generated artifact**"* | **The 36 is not a lane figure.** No lane reports 36; it is a fragment of the **withdrawn** 61 decomposition (*"36 catalog-active + 25 production-adopted"*), which EMP-EXPERIENCE records and **refutes**. The static reading is contested **three** ways on its own: **34** (EMP-INFORMATION, and re-derived identically by this synthesis), **38** (EMP-PERFORMANCE, corroborated by `capacity-report.json.globallyActive`), **39** (EMP-EXPERIENCE). So the count is contested **four or five** ways, not three. **The brief's instruction — adopt EMP-EXPERIENCE's posture and pick no winner — is correct and is followed.** See conflict E-1 | **MEDIUM** — no requirement turns on it, exactly as the brief says |
| **B-2** | *"**Handoff capable families:** 13 (OWN-DESIGN first pass) vs **14** (corrected — spread blocks add `warehouse` + `mobileLocation`)"* | **Correct, and now CLOSED with the mechanism named.** Re-derived here: **12** literal `transfer: "HANDOFF"` rows + **2** from the spread block at `ownershipMatrix.ts:311-325` = **14**, matching OWN-E2E's EXECUTED Probe A. **One precision: a naive static count yields 12, not 13** — so a future reader re-deriving it will get a *fourth* number unless the spread block is named. OWN-DESIGN had already adopted 14 in its §14. **This conflict should be retired from the open list** | **LOW** |
| **B-3** | *"EMP-ROLE's '5 of 8 unconsumed `operationalRoles` values' — EMP-ACCOUNTABILITY could confirm only **3** and said so"* | **Correct, and there are FOUR readings, not two: 3 (EMP-ACCT) · 4 (OWN-DESIGN §14) · 5 (EMP-ROLE) · 5 (OWN-E2E F-7).** The disagreement is definitional — **what counts as a consumer**: a Rules predicate vs any code reference. **OWN-DESIGN's independent count of 4 is missing from the brief.** See conflict E-3 | **LOW** — the synthesis-level fact is unaffected |
| **B-4** | *"**Security-Role set is 48** (45 governed + 3 compatibility)"* | **Confirmed and re-derived here:** 45 `id:` declarations in `governedBusinessRoles.ts`, 3 in `compatibilityRoles.ts:350`, **overlap 0**. Corroborated by four lanes and by the EXECUTED transcript header `ROLES 48`. **One addition the brief does not carry: the 3 compatibility Roles are the ONLY ones Firestore Rules can see, and they are exactly the Roles that carry the ownership-write exposure (AU-5)** — which is what makes 48-vs-45 load-bearing rather than cosmetic | — confirmation |
| **B-5** | *"`docs/specifications/record-ownership.md` states the model D-4 superseded… **and promises a cascade the handoff command forbids**"* | **Both halves confirmed verbatim at baseline:** `:33` *"Whoever creates a record owns it."*, `:220` *"the owner always resolves to the actor"*, and `:226`/`:244` (**AC-7**) promising Contacts and Locations move *"immediately and silently"* against `ownershipHandoffCommand.ts`'s structural **NO CASCADE**. **One addition: the specification's status is Draft, and it is NOT MARKED superseded** — which is the actual defect, since *"a lane reading the named evidence in order would adopt the wrong rule"*, and two lanes did | — confirmation |
| **B-6** | Lists the eight lane inputs as totalling **6,460 lines** | **Confirmed exactly** — verified by `wc -l` after copying all eight into `docs/operating-model/lanes/`: 490 + 735 + 1,184 + 639 + 729 + 930 + 851 + 902 = **6,460** | — confirmation |
| **B-7** | *"OWN-DESIGN could not find it because it searched `sb-evidence/` and `docs/audits/`; **it lives in `docs/assessments/`**"* | **Confirmed.** `docs/assessments/r32-production-exposure-census.{md,json}` are tracked at baseline; `be1e5579` is verified **an ancestor of HEAD**. **One addition: EMP-EXPERIENCE §2.3 independently LOCATED AND QUOTED the artifact**, so it was not only the controller that closed this — and EMP-EXPERIENCE also supplies the crucial second-order finding the brief does not carry: **even with a grant, 29 of 45 Roles have no corpus job label and 51% of authored work names no Role at all, so occupancy and vocabulary are two independent prerequisites and the grant closes only one** | **MEDIUM** — it qualifies "the gap is a GRANT, not a mechanism" |
| **B-8** | Implies EMP-EXPERIENCE and OWN-DESIGN are separate documents of different length (902 and 639 lines) | **Confirmed, and worth recording because it looks like an error and is not:** `OWN-DESIGN.md` and `EMP-EXPERIENCE.md` are **byte-size identical (118,358 bytes)** with **different md5 hashes** and different line counts. A coincidence, verified, not a copy | **LOW** |
| **B-9** | *"**Do not create a competing authority where one exists.** Existing: … `docs/specifications/employee-foundation.md` (575)…"* | **Correct and insufficient, per EMP-ROLE C-1 (that lane's most consequential correction, rated HIGH).** `jobTitle` and `managerEmployeeId` — **the two most job-role-relevant Employee fields in the repository** — are **absent from `employee-foundation.md`'s schema** and arrived via **`docs/specifications/administration-users-consolidation.md:204-209`**. **A lane reading only the four listed documents would conclude no job-title or manager field exists.** Note the path is contested: EMP-WORK and EMP-ACCOUNTABILITY cite it as `docs/assessments/…`; OWN-DESIGN §14 verified it is **`docs/specifications/…`** and that the assessments path **does not exist**; EMP-INFORMATION MI-5 could not find it in its worktree at all. **OWN-DESIGN's path is the verified one** | **HIGH** |
| **B-10** | *"an already-shipping Employee Performance North Star at `docs/north-star/financials/`"* | **Confirmed — 20 pages present.** And **one correction to the North Star itself, from EMP-PERFORMANCE OD-EMP-016: page 15's *"All values are Certification World specimen fixtures"* is STALE.** `FinancialsEmployeePerformance.jsx` (181 lines) reads the **real** callable `listFinancialFacts` via a server-side `byCreditedSalesperson` rollup, with **no fixture or mock import**. It renders Person · Basis · Billed · Collected · Outstanding · Goal. **Its emptiness in production is a CAPABILITY fact (`finance.read` inactive, sandbox-only), not a design placeholder.** The North Star's conclusion is right for the wrong reason | **MEDIUM** |
| **B-11** | *"**MISSING INPUT** where only the Owner's separate employee-design conversation could answer — it is **not available to this run**. Design r1 artifacts are also absent."* | **Confirmed by four independent checks in EMP-EXPERIENCE §9** (`ls docs/atlas`, `find -type d -name design-r1`, `find -iname '*atlas*'`, and a tracked-file grep for `atlas` or `design-r1`): **there is no `atlas` path of any kind.** Neither input is referenced or reconstructed anywhere in this synthesis. **90 MISSING INPUT items across the eight lanes** are consolidated in `EMPLOYEE-OPEN-DECISIONS.md` §6 | — confirmation |

---

## 7. MISSING INPUT and UNPROVEN

Consolidated in [`EMPLOYEE-OPEN-DECISIONS.md`](EMPLOYEE-OPEN-DECISIONS.md) §3 (MISSING INPUT) and §4
(UNPROVEN). **The two broadest, which condition every other artifact:**

| | Statement |
|---|---|
| **MISSING INPUT — the ceiling** | **The Owner's separate employee-design conversation is not available to this run**, and it is the only legitimate source for the real headcount and job titles, the real escalation tree, whether accountability moves with an assignee, who the domain stewards are, what happens on each of the nine departure states, whether a handoff requires acceptance, and **whether any metric here has a pay or review consequence at all.** The three Owner-stated performance directions reachable at this baseline all describe the **shape** of a surface and **not one states a consequence.** **Design r1 artifacts are absent.** Nothing is reconstructed from either |
| **UNPROVEN — the floor** | **The evidence is 96% unexecuted: 968 of 1,010 corpus activities were never run**, all 660 Service and Inventory rows are `NOT_RUN` (*"an unexecuted activity may never be [labelled PASS]"*), the 42 executed rows are **capability resolutions only** (*"which prove who may do a thing and never that the thing completes"*), **22 of their 118 output lines are INFERRED**, and the corpus was generated against **`d104cf49`, not this baseline.** **0 of 86 workflows are `WORKS_END_TO_END`, and that zero is the absence of a measurement, not a measurement of failure.** **Every friction, handoff, device and operating-company figure has a denominator of 660, not 1,010** — P3-B3's 350 rows (34.7%, and **the entire commercial and back-office half of the business**) carry none of those fields. **That silence is a measurement gap, not evidence of smooth work** |

---

## 8. What this synthesis did not do

- **No production contact. No deploys. No database mutation. No Firestore reads or writes. No schema.
  No implementation. Ownership handoff was NOT activated. No secrets requested or exposed.**
- **No generic `ownerId` invented. No field, collection, index or command proposed anywhere.**
- **No Owner question answered.**
- **No lane's finding overridden.** Where two lanes disagree, both readings are stated. Where this
  synthesis re-derived an answer (E-6, E-7, E-9 attribution, E-10, and the two-field trap in E-2) the
  re-derivation is shown and labelled.
- **Nothing written outside `docs/operating-model/`.**
- **Not pushed. No PR.**
