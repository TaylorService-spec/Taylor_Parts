# EMP-ROLE — Taylor Job-Role Model (lane-local evidence)

**LANE:** EMP-ROLE · **MODE:** EVIDENCE_WRITE
**BASELINE / OBSERVED AT:** `64008d5ae0bdd9532909671b15a91122400accf1` (`ATLAS-BASE-2026-09-12-A`)
**STATUS:** Lane-local evidence. **NOT a canonical artifact.** Only EMP-OWN-SYNTHESIZER may write the
integrated job-role model. Nothing here is an Owner decision; every Owner decision needed is listed
in §10 (MISSING INPUT).

Every code- or doc-derived fact in this file carries **OBSERVED AT: 64008d5a**. Provenance tags are
**KNOWN** (a citation exists), **INFERRED** (derived, marked as such), **OWNER DECISION REQUIRED**
(no evidence can settle it), **MISSING INPUT** (only the unavailable employee-design conversation
can settle it), **UNPROVEN** (asserted somewhere but not demonstrated).

---

## 1. What this lane did and did not start from

Per brief, this lane did **not** start from EOS security Roles. It started from **observed work** —
the 1,010-activity Day-in-Life corpus — and used the Role catalogs only as corroboration that a
body of work exists.

**All counts below were re-derived at baseline, not inherited.**

| Evidence source | Path | Re-derived figure | Brief's figure | Agrees? |
|---|---|---|---|---|
| B1 Day-in-Life (service) | `p3b1-act-service/docs/scenarios/day-in-the-life/service-technician.json` | 330 activities · **8** distinct `role` · **12** distinct `persona` | 330 · 8 · 12 | YES |
| B2 Day-in-Life (inventory/warehouse/purchasing) | `p3b2-act-inventory/docs/scenarios/day-in-the-life/inventory-warehouse-purchasing.json` | 330 activities · **14** distinct `role` · **14** distinct `persona` | 330 · 14 · 14 | YES |
| B3 activities (sales/CRM/finance/admin) | `p3b3-act-sales/docs/activities/p3b3-*.json` (6 files) | 350 activities · **18** distinct `actor_role` · no `persona` field | 350 · 18 | YES |
| **Corpus total** | — | **1,010** | 1,010 | YES |
| Governed business Roles | `functions/src/access/governedBusinessRoles.ts` | **45** `id:` declarations | 45 | YES |
| Compatibility Roles | `functions/src/access/compatibilityRoles.ts` | **3** (`admin`, `dispatcher`, `technician`) | not mentioned | **BRIEF INCOMPLETE — see §11** |
| Roles placed in the org tree | `functions/src/access/roleHierarchy.ts` | **22** of 48 | not mentioned | new |

B3 file-level split (re-derived): administration 60 · adversarial 40 · crm 60 · financial 70 ·
management 50 · sales 70 = **350**. **KNOWN** · OBSERVED AT: 64008d5a.

---

## 2. The nine concepts, and where the system conflates them

The brief requires these nine never be collapsed. Status of each **as the repository models it**:

| # | Concept | Modelled? | Authority / citation | OBSERVED AT |
|---|---|---|---|---|
| 1 | **RECORD OWNER** | YES | `functions/src/ownership/ownershipMatrix.ts:119-125` (Account owner row; ruling **D-6**) | 64008d5a |
| 2 | **ACCOUNTABLE PERSON** | **NO distinct model** | Nearest is `creditedSalespersonId`, held explicitly separate from owner: `docs/north-star/financials/pages/15-employee-performance.md:30` — *"creditedSalespersonId ≠ ownerEmployeeId ≠ createdBy ≠ responsibleEmployeeId — labelled per row"* | 64008d5a |
| 3 | **ASSIGNEE / EXECUTOR** | YES | `responsibleEmployeeId` (same line as above); Work Order technician assignment throughout B1 | 64008d5a |
| 4 | **ESCALATION OWNER** | **NO** | No escalation field, collection, or command found at baseline. **UNPROVEN** that escalation is modelled anywhere | 64008d5a |
| 5 | **MANAGER** | **TWO COMPETING MODELS — a finding** | (a) `employees/{id}.managerEmployeeId`, relational, validated, self-manager refused — `docs/specifications/administration-users-consolidation.md:206,208-209`, `functions/src/access/employeeProfileCommands.ts:498,534-538`, `field-ops-app-vite/src/domain/employeeProfile.js:84`. (b) `functions/src/access/roleHierarchy.ts` — the org tree lives **on the Roles**, and `reportsTo` on the employee is *"deliberately not modelled yet"* (`:9-16`) | 64008d5a |
| 6 | **DOMAIN STEWARD** | **NO** | No steward concept found. **UNPROVEN** | 64008d5a |
| 7 | **OPERATING COMPANY** | YES | `functions/src/ownership/operatingCompanyAuthority.ts:22-25` — two governed ids (`taylor`, `ventana`); `employees/{id}.operatingCompanyId` | 64008d5a |
| 8 | **JOB ROLE** | **NOT MODELLED AS A VOCABULARY — the central finding.** See §3 | — | 64008d5a |
| 9 | **SECURITY ROLE** | YES | 45 governed + 3 compatibility = **48** | 64008d5a |

**FINDING F-1 (concept conflation).** Concepts 5 and 8 are conflated in *opposite directions* by two
subsystems at the same baseline. `roleHierarchy.ts` derives the **manager** relation from the
**security Role** (*"Role is the hierarchy levels"*, Owner 2026-08-19, `:1-5`), so a security Role is
doing a job-role's and a manager-edge's work at once. Meanwhile `employeeProfileCommands.ts` stores a
real `managerEmployeeId` edge that the visibility resolver **does not read**. Two answers to "who
manages this person" exist and nothing reconciles them. **KNOWN** · OBSERVED AT: 64008d5a.

**FINDING F-2 (concept 4 and 6 absent).** ESCALATION OWNER and DOMAIN STEWARD have no representation
at baseline. Any per-role "ESCALATION RELATIONSHIP" or "DOMAIN STEWARD" attribute below is therefore
**INFERRED from observed handoffs only**, never read from a model. **KNOWN** (the absence) ·
OBSERVED AT: 64008d5a.

---

## 3. There is no job-role vocabulary. There are five different role vocabularies.

**FINDING F-3 — the central structural finding of this lane.** The repository has no single
enumerated job-role model. It has five disjoint role vocabularies, none of which is an org chart,
and no mapping between them. **KNOWN** · OBSERVED AT: 64008d5a.

| # | Vocabulary | Size | Where stored / declared | Is it a job role? |
|---|---|---|---|---|
| V1 | `employees/{id}.jobTitle` | **unbounded** | `field-ops-app-vite/src/domain/employeeProfile.js:83` — `{ key: "jobTitle", kind: "TEXT" }` | Closest in *intent*, but **free text**. No enum, no validation, no vocabulary. |
| V2 | `employees/{id}.operationalRoles[]` | **8** | `field-ops-app-vite/src/domain/employeeVocabulary.js:67-76`, mirroring `VALID_OPERATIONAL_ROLES` in `functions/scripts/provisionEmployeeAccess.js` | Closest in *form* — an enum stored on the Employee. `PARTS_MANAGER · PARTS_ASSOCIATE · TECHNICIAN · WAREHOUSE_MANAGER · WAREHOUSE_ASSOCIATE · SERVICE_MANAGER · SALES_MANAGER · SALES_ASSOCIATE` |
| V3 | Governed business Roles | **45** | `functions/src/access/governedBusinessRoles.ts` | **NO — security.** Brief is right to refuse these as the org chart. |
| V4 | Compatibility Roles | **3** | `functions/src/access/compatibilityRoles.ts:247,265,292` | NO — security, parity oracle. |
| V5 | Corpus roles | **8 / 14 / 18** | the three Day-in-Life libraries | Descriptive of observed work. No two libraries share a vocabulary or a casing convention. |

**V2 is the most defensible starting point for a job-role model** and it is very small: eight values,
covering only Parts, Warehouse, Service and Sales. It has **no value** for Owner, General Manager,
Dispatcher, Service Coordinator, Purchasing, Finance/Accounting, Controller or Administration —
every one of which has substantial observed work in the corpus. **KNOWN** · OBSERVED AT: 64008d5a.

**FINDING F-4.** `employeeVocabulary.js:19-20` records that **five of the eight** V2 values
(`TECHNICIAN`, `WAREHOUSE_ASSOCIATE`, `SERVICE_MANAGER`, `SALES_MANAGER`, `SALES_ASSOCIATE`)
*"have no consumer anywhere in this client yet"*. Only three (`PARTS_MANAGER`, `WAREHOUSE_MANAGER`,
`PARTS_ASSOCIATE`) gate a real eligibility check. So even V2 is 62% inert. **KNOWN** · OBSERVED AT: 64008d5a.

**FINDING F-5 — occupancy.** The brief states capacity is proven and occupancy unknown. This lane
**confirms and extends** that: no lane has established that any human holds any governed Role, and
this lane found no evidence either. Additionally, `employeeProfileCommands.ts` shows every Employee
profile field added by the Administration consolidation is *"All nullable, all backward compatible,
**none backfilled**"* (`docs/specifications/administration-users-consolidation.md:204-206`) — so
`jobTitle`, `managerEmployeeId` and `operatingCompanyId` are **presumed empty** on existing records.
**Job-role occupancy is UNPROVEN and probably unpopulated.** **KNOWN** · OBSERVED AT: 64008d5a.

---

## 4. BINDING OWNER RULING — Retail Sales vs National Accounts Sales, dimension by dimension

> **Owner ruling (binding on this lane): RETAIL SALES and NATIONAL ACCOUNTS SALES are distinct job roles.**

This lane does **not** model a generic "Sales" role. Per the brief, where the evidence cannot
distinguish them on a dimension, that is stated per dimension rather than merged.

### 4.1 What the repository actually says about the distinction

This is the single most load-bearing citation in this lane —
`functions/src/access/roleHierarchy.ts:135-139`:

```
  // --- sales branch ---------------------------------------------------------
  // The chart's National Accounts and Retail Sales columns are CHANNELS, each with
  // its own salespeople. They are not modelled as separate Roles here -- see
  // PLACEMENT_GAPS. `salesperson` is the single Role today, and which channel a
  // person sells into is a property of the DEAL (SALES_CHANNELS on Opportunity and
  // Sales Order: NATIONAL_ACCOUNTS | RETAIL | STRATEGIC_ACCOUNTS), not of the Role.
```

and `functions/src/access/roleHierarchy.ts:283-285` (`PLACEMENT_GAPS`, the file's only entry):

```
  "National Accounts vs Retail Sales -- shown as separate columns under Sales Manager.
   Deliberately NOT modelled as Roles: which market a deal belongs to is a property of
   the DEAL (SALES_CHANNELS on Opportunity and Sales Order), not of the person. A Role
   per channel multiplies every time a channel is added, and there are already three.
   If a national-accounts salesperson must be unable to see retail deals, that is
   channel-scoped visibility -- the deferred coverage model, not this hierarchy."
```

Four facts follow, all **KNOWN** · OBSERVED AT: 64008d5a:

1. **The Owner's org chart does show National Accounts and Retail Sales as separate columns under
   the Sales Manager.** The repository states this as fact about the chart. This *corroborates the
   binding ruling* from an independent source.
2. **The repository deliberately declined to model them as Roles**, and recorded that refusal as a
   named gap rather than hiding it.
3. **The distinction is modelled instead on the DEAL**, as `salesChannel`.
4. **There are three channels, not two** — `STRATEGIC_ACCOUNTS` as well. See §11 correction C-3.

`SALES_CHANNELS = ["NATIONAL_ACCOUNTS", "RETAIL", "STRATEGIC_ACCOUNTS"]` is declared **twice**,
server-side: `functions/src/opportunity/opportunityLifecycle.ts:27` and
`functions/src/salesOrder/salesOrderLifecycle.ts:18`, plus a client mirror. **KNOWN** · OBSERVED AT: 64008d5a.

### 4.2 Dimension-by-dimension verdict

The brief's eleven role dimensions, evaluated for Retail Sales vs National Accounts Sales:

| Dimension | Can the evidence distinguish Retail from National Accounts? | Basis |
|---|---|---|
| **PURPOSE** | **NO — but the distinction is real.** Both sell; the channel on the deal is the only recorded difference. The org chart's separate columns imply different books of business, but no document states either purpose. | `roleHierarchy.ts:135-139` (chart columns) + no purpose statement anywhere · **OWNER DECISION REQUIRED** |
| **RESPONSIBILITIES** | **NO.** Zero corpus activities differentiate. `retail` = **0 occurrences** across all 1,010 activities; `national account` = **0 occurrences**. Re-derived by regex over the raw JSON of all three libraries. | corpus · **KNOWN (the absence)** |
| **ACCOUNTABILITIES** | **NO.** `creditedSalespersonId` carries no channel. No per-channel goal, quota or target exists — `quota` = 0 occurrences corpus-wide. | `15-employee-performance.md:30` · **KNOWN (the absence)** |
| **DECISION AUTHORITY** | **NO — and this is a governance gap, not a modelling choice.** Both are the single `salesperson` Role. Worse: `governedBusinessRoles.ts:387-390` records *"there is no approval-limit or discount-authority model in this repo, so acceptance is all-or-nothing per role and a Salesperson may bind the same terms a General Manager can. That is a real governance gap to close deliberately."* Corpus **P3B3-ADV-033** (`Salesperson`, status `PARTIAL`) exercises exactly this. | **KNOWN** |
| **NORMAL DAILY WORK** | **NO.** 43 `Salesperson` activities in B3, none channel-tagged. | corpus · **KNOWN (the absence)** |
| **RECURRING WORK** | **NO.** No recurring sales cadence (pipeline review, forecast cycle) is role-differentiated. | corpus · **KNOWN (the absence)** |
| **EXCEPTION WORK** | **NO.** | corpus · **KNOWN (the absence)** |
| **CROSS-DEPARTMENT INVOLVEMENT** | **NO.** Both touch the same objects. `Salesperson` objects_touched (re-derived, 43 rows): Opportunity 19 · Account 17 · Sales Agreement 13 · Sales Order 10 · Employee 5 · Capability 4 · Invoice 4 · Part 4 · Operating Company 4 · Role 3. | corpus · **KNOWN** |
| **MANAGEMENT / ESCALATION** | **NO — and it is structurally impossible today.** Both would sit at `salesperson`, `parent: "salesManager"` (`roleHierarchy.ts:140-145`, rationale: *"Individual sales contributor beneath the Sales Manager, **in either channel**"*). The file records the consequence: *"With role-only hierarchy, EVERY salesManager sees EVERY salesperson"* (`:16`). A second sales manager cannot be distinguished from the first. | **KNOWN** |
| **PROFICIENCY EXPECTATIONS** | **NO.** Nothing anywhere models proficiency for any role. See §7. | **KNOWN (the absence)** |
| **SUCCESS OUTCOMES** | **NO.** | **KNOWN (the absence)** |

**Net: the evidence distinguishes Retail from National Accounts on ZERO of the eleven dimensions.**
The ruling stands — it is the Owner's, and `roleHierarchy.ts` independently corroborates that the
chart separates them — but **every attribute that would differentiate the two roles is MISSING INPUT
or OWNER DECISION REQUIRED.** This lane therefore records **two role entries with identical
evidence** and refuses to invent a difference. **See §10 items M-1..M-4.**

### 4.3 The mechanism that would carry the distinction exists, is built, and reaches nobody

**FINDING F-6.** The Owner **explicitly deferred** the coverage/territory model — the exact
mechanism by which a national-accounts salesperson would have a different book of business from a
retail salesperson. `functions/src/access/governedBusinessRoles.ts:348-351` quotes the instruction: *"the coverage/territory model
the Owner explicitly deferred (**'record and preserve the seams, do NOT build during the runway'**)"*.
**KNOWN** · OBSERVED AT: 64008d5a.

A pure model was nonetheless authored —
`docs/assessments/commercial-coverage-territory-authority-model.md` +
`field-ops-app-vite/src/domain/commercialCoverage.js` — with `CoverageAssignment.scope.kind` including
**`CHANNEL`**, i.e. channel-scoped coverage is the designed answer. Its §5 records the runtime
authority as three governed collections built *"later behind protected gates"*. Its §3 holds the
separation this lane needs: *"Commercial coverage ≠ record owner ≠ sales credit ≠ commission ≠
security permission ≠ Service Territory."* **KNOWN** · OBSERVED AT: 64008d5a.

Corpus **P3B3-ADV-024** (`Sales Manager`, status **EXECUTED_FAIL**) proves it reaches nobody:
> *"Territory and coverage are modelled, stored, commanded and denied everywhere. Both capabilities
> are inactive and neither appears in any environment's activation array, so the feature is not
> merely unactivated in production — **there is no environment in the repository where it could be
> exercised at all.**"*

Its authority path: `coverage.write` `permissionCatalog.ts:425` and `coverage.read` `:436`, both
`active:false` and absent from every override array in `config/environments.json`; storage deny-all
`firestore.rules:1832-1837`. **KNOWN** · OBSERVED AT: 64008d5a.

The sales archaeology document reaches the same verdict independently —
`p3a3-arch-sales/docs/design/archaeology/sales-crm-financials-reporting-administration.md:301,324`:
*"Sales Territory / Coverage — built, registered, reachable by nobody"* … *"**Sales Territory is real,
built, and deliberately not ownable**"*, with `COVERAGE_TERRITORY_AUTHORITY_GAP` recorded **OPEN**.
**KNOWN** · OBSERVED AT: 64008d5a.

**Consequence for the synthesizer:** implementing Retail Sales and National Accounts Sales as
distinct job roles is **not blocked on job-role modelling**. It is blocked on the deferred
coverage/territory model, which the Owner instructed not to build during the runway. That is a
scheduling collision the Owner must resolve, not an evidence gap. **INFERRED** (from the two
KNOWN facts above) · OBSERVED AT: 64008d5a.

---

## 5. Role register

Provenance per role. **KNOWN** = observed work with a citation. **INFERRED** = assembled from
adjacent evidence. **OWNER DECISION REQUIRED** / **MISSING INPUT** as defined above.

Counts are re-derived activity counts at baseline. "Sec. Role" = nearest security Role, or `—` for none.

| Job role (brief's candidate) | Corpus evidence | Count | Sec. Role | Org-tree placement | Verdict |
|---|---|---|---|---|---|
| **Owner** | B3 `Owner` | 10 | `owner` | root, `stated:true` | **KNOWN** |
| **General Manager** | B3 `General Manager` | 14 | `generalManager` | under `owner`, `stated:true` | **KNOWN** |
| **…/ Partner** | **none — `partner` = 0 occurrences repo-wide** | 0 | — | — | **MISSING INPUT (M-5)** |
| **Service Manager** | B1 `service_manager` 60; B3 `Field Manager` 9 | 69 | `fieldManager` | under `operationsManager` | **KNOWN**, but see F-7 |
| **Service Coordinator** | B1 `service_coordinator` (Marisol Vega, Rosa Delgado) | 68 | **—** | **unplaced** | **KNOWN work, NO security Role** |
| **Dispatcher** | B1 `dispatcher` 61; B2 `Dispatcher` 27; B3 `Dispatcher` 9 | 97 | `dispatcher` (compatibility) | under `fieldManager`, above `technician` | **KNOWN** |
| **Service Technician** | B1 `field_technician` 104; B2 `Field Technician` 26; B3 `Technician` 4 | 134 | `technician` (compatibility) | under `dispatcher` | **KNOWN** |
| — *Apprentice Technician* | B1 `apprentice_technician` (Wes Tanner) | 9 | **—** | **unplaced** | **KNOWN work, NO security Role** |
| — *After-hours Coordinator* | B1 `after_hours_coordinator` (Ken Iwata) | 5 | **—** | **unplaced** | **KNOWN work, NO security Role** |
| — *Service Billing Admin* | B1 `service_billing_admin` (Amanda Foy) | 18 | **—** | **unplaced** | **KNOWN work, NO security Role** |
| **Retail Sales** | **no channel-differentiated activity** | **0** | `salesperson` (shared) | `salesperson` under `salesManager` | **OWNER DECISION REQUIRED — §4** |
| **National Accounts Sales** | **no channel-differentiated activity** | **0** | `salesperson` (shared) | `salesperson` under `salesManager` | **OWNER DECISION REQUIRED — §4** |
| *(undifferentiated Salesperson)* | B3 `Salesperson` | 43 | `salesperson` | under `salesManager` | **KNOWN as observed; NOT a role this lane endorses** |
| — *Sales Manager* | B3 `Sales Manager` | 52 | `salesManager` | under `admin`, peer of Ops/Finance/Marketing | **KNOWN** |
| **Parts Manager** | B2 `Parts Manager` 65; B3 `Parts Manager` 4 | 69 | `partsManager` | under `operationsManager` | **KNOWN** |
| **Parts Associate** | B2 `Parts Associate` (Dwayne Holbrook) | 37 | `partsAssociate` | under `partsManager` | **KNOWN** |
| **Parts Counter** | B1 `parts_counter` (Nate Purcell) | 5 | **—** | **unplaced** | **KNOWN work; distinct from Parts Associate — see F-8** |
| — *Branch Parts Coordinator* | B2 `Branch Parts Coordinator` (Nadia Fournier, **100% `ventana`**) | 12 | **—** | **unplaced** | **KNOWN work, NO security Role** |
| **Warehouse** (Manager) | B3 `Warehouse Manager` | 5 | `warehouseManager` | under `operationsManager` | **KNOWN** (thin: 5 activities) |
| — *Warehouse Associate* | **no corpus activity** | 0 | `warehouseAssociate` | under `warehouseManager` | **Role with no activity — see §6** |
| — *Receiving Lead* | B2 `Receiving Lead` (Ray Camacho) | 19 | **—** | **unplaced** | **KNOWN work, NO security Role** |
| — *Stocker / scanner operator* | B2 `Stocker/scanner operator` 28 + `Stocker` 4 (both Luis Mendoza) | 32 | **—** | **unplaced** | **KNOWN work, NO security Role; intra-library naming conflict — F-9** |
| — *Satellite Attendant* | B2 `Satellite Attendant` (Owen Tate) | 7 | **—** | **unplaced** | **KNOWN work, NO security Role** |
| — *Inventory Control Analyst* | B2 `Inventory Control Analyst` (Tessa Nguyen) | 34 | **—** | **unplaced** | **KNOWN work, NO security Role — largest such gap** |
| **Purchasing** (Manager) | B3 `Purchasing Manager` | 2 | `purchasingManager` | under `financeManager` | **KNOWN** (very thin: 2 activities) |
| — *Purchasing Admin* | B2 `Purchasing Admin` (Gil Overton) | 8 | **—** | **unplaced** | **KNOWN work, NO security Role** |
| **Finance / Accounting** | B3 `Accounting Manager` 36; `Finance Manager` 2; `Controller` 30; B2 `Controller` 19 | 87 | `accountingManager`, `financeManager`, `controller` | all under `financeManager` spine | **KNOWN**, but see F-10 |
| **Administration** | B3 `Administrator` 83; B2 `System Admin` 27; B3 `Office Manager` 18 | 128 | `admin` (compatibility) / `officeManager` | `admin` under `generalManager` | **KNOWN work; role boundary UNCLEAR — F-11** |
| — *Operations Manager* | B2 `Operations Manager` 17; B3 `Operations Manager` 26 | 43 | `operationsManager` | under `admin`, peer of Sales/Finance/Marketing | **KNOWN** |
| — *Marketing Manager* | B3 `Marketing Manager` | 2 | `marketingManager` | under `admin`, peer of Sales by Owner ruling 2026-08-19 | **KNOWN** (very thin: 2 activities) |
| — *Report Viewer* | B3 `Report Viewer` | 1 | `reportViewer` | non-hierarchical | **NOT A JOB ROLE — a grant** |

### 5.1 Named findings from the register

**F-7.** The chart's **Service Manager is the platform's `fieldManager` Role**, not a role named
"serviceManager". `roleHierarchy.ts:148-150`: *"Service Manager on the chart is this platform's
fieldManager Role … The name difference is why 'serviceManager' could not be granted earlier — it is
this."* The synthesizer must not treat `fieldManager` and Service Manager as different roles.
**KNOWN** · OBSERVED AT: 64008d5a.

**F-8.** The brief's candidate **"Parts Associate / Counter"** collapses two roles the corpus holds
apart: B2 `Parts Associate` (37, Dwayne Holbrook, purchasing/approval work) and B1 `parts_counter`
(5, Nate Purcell, truck-stock reconciliation and serialized custody). Different libraries, different
personas, different work. **Recording both readings per the brief's standard.** Whether they are one
job role is **OWNER DECISION REQUIRED**. **KNOWN** · OBSERVED AT: 64008d5a.

**F-9.** Within B2, persona **Luis Mendoza** carries **two different role strings** —
`Stocker/scanner operator` (28) and `Stocker` (4). This is an *intra-library* inconsistency,
distinct from the two cross-library conflicts the brief names. **Recorded, not fixed.** **KNOWN** ·
OBSERVED AT: 64008d5a.

**F-10.** `accountingManager` and `financeManager` are **intentionally identical in capability** —
`governedBusinessRoles.ts:355-358`: *"accountingManager and financeManager are intentionally
identical (DECISIONS #114). Two Roles that resolve the same way are not a defect when the distinction
they encode is real and the authority difference has not been designed yet."* This is the **same
pattern as `salesperson`/`salesManager`** and the same pattern the Retail/National ruling will hit:
the repo has a precedent for holding two roles distinct in name while identical in authority. The
sales archaeology doc nonetheless classes the divergence an **AUTHORITY GAP** (`:724`). **Both
readings recorded.** **KNOWN** · OBSERVED AT: 64008d5a.

**F-11.** "Administration" is the largest observed work block (128 activities) and the least
role-like. It spans compatibility `admin`, `officeManager`, and B2's `System Admin` (27, Sam Ortega —
void/cancel/schema-repair work that reads as platform operations, not office administration).
Whether Administration is one job role, two, or an IT function is **OWNER DECISION REQUIRED**.
**KNOWN** (the span) · OBSERVED AT: 64008d5a.

---

## 6. Roles without security Roles · security Roles without activities

Both directions are findings per the brief. Matching was by exact name normalisation
(case/punctuation-insensitive) against the 45 governed Roles; `dispatcher`, `technician` and `admin`
were then reconciled by hand against `compatibilityRoles.ts`. **OBSERVED AT: 64008d5a.**

### 6.1 Corpus roles with NO security Role at all — **17**

Real observed work with no authorization home. Total **290 activities = 28.7% of the corpus.**

| Corpus role | Lib | Count | Note |
|---|---|---|---|
| `service_coordinator` | B1 | 68 | **largest gap.** Inbound-work queue owner |
| `Inventory Control Analyst` | B2 | 34 | availability reconciliation |
| `Stocker/scanner operator` | B2 | 28 | scanner operations |
| `System Admin` | B2 | 27 | void / cancel / legacy-schema repair |
| `Receiving Lead` | B2 | 19 | supplier multi-scan receipting |
| `service_billing_admin` | B1 | 18 | Work Order close, month-end |
| `Branch Parts Coordinator` | B2 | 12 | Ventana-only cross-company |
| `apprentice_technician` | B1 | 9 | supervised technician |
| `Purchasing Admin` | B2 | 8 | PO execution |
| `Satellite Attendant` | B2 | 7 | satellite location, after-hours |
| `after_hours_coordinator` | B1 | 5 | emergency intake |
| `parts_counter` | B1 | 5 | truck stock / serialized custody |
| `Stocker` | B2 | 4 | (same persona as `Stocker/scanner operator`) |

Reconciled as **NOT gaps** (they resolve to compatibility Roles, not governed ones):
`dispatcher`/`Dispatcher` (97 total), `field_technician`/`Field Technician`/`Technician` (134),
`Administrator` (83, → compatibility `admin`).

### 6.2 Governed Roles with NO corpus activity — **26 of 45**

Excluding `reportViewer` (1 activity), `shopManager`/`shopAssociate`/`supportStaff`/`generalEmployee`/
`warehouseAssociate` are **positions** with zero observed work; the remaining 21 are
**capability grants, not positions** — `roleHierarchy.ts:251+` lists them in
`NON_HIERARCHICAL_ROLES` (`roleHierarchy.ts:251`); `functions/src/access/hierarchicalVisibility.ts:33-35`
states why: *"they are grants, not positions, so holding one neither widens what their holder sees
nor makes that holder visible to anyone."*

| Class | Roles | Count |
|---|---|---|
| **Positions with no observed work** (job-role candidates that failed to appear) | `generalEmployee`, `supportStaff`, `shopManager`, `shopAssociate`, `warehouseAssociate` | 5 |
| **Grants, not positions** (correctly absent from any job-role model) | 12 `inventory*` operator/clerk/administrator Roles, `workOrderPartsPlanner`, `workOrderLaborCorrector`, `technicianLaborRecorder`, `crmActivityContributor`, `emailIntakeAdministrator`, `serviceInboundWorkReviewer`, `equipmentCatalogAdministrator`, `equipmentInstaller`, `performanceGoalSubject`, `reportAuthor`, `reportFinanceViewer` | 21 |

**F-12.** The five **positions with no observed work** are the actionable half. `shopManager` is
placed in the tree from the Owner roster 2026-08-20 (Willie) with the note *"Holds no capabilities;
placement is visibility only and confers nothing"* (`roleHierarchy.ts:112-113,114-119`) — an Owner-named
position with neither capability nor observed work. `warehouseAssociate` is placed under
`warehouseManager` yet has zero corpus activity while `Receiving Lead`, `Stocker` and
`Satellite Attendant` (30 activities) do the warehouse floor work and have no Role. **The Role
catalog and the corpus disagree about what warehouse work is.** **KNOWN** · OBSERVED AT: 64008d5a.

**F-13.** Only **22 of 48** security Roles are placed in the org tree
(`roleHierarchy.ts` — re-derived). Absence is deliberate and meaningful (`:47-51`). So **26 Roles
confer no hierarchical visibility**, and a job-role model built from the Role catalog would inherit
26 positionless entries. **KNOWN** · OBSERVED AT: 64008d5a.

---

## 7. Per-role dimensions: what can and cannot be filled in

The brief asks eleven dimensions per role. This table records, **for every role**, which dimensions
the evidence can supply at all. It is deliberately a coverage map rather than eleven invented
paragraphs per role.

| Dimension | Evidence available? | Source when yes |
|---|---|---|
| **PURPOSE** | **Partially** — inferable from observed work for the 21 roles with ≥5 activities; absent for the rest. No document states a purpose for any job role. | corpus narrative · **INFERRED** |
| **RESPONSIBILITIES** | **YES** for every role with corpus activity — `title` + `objects_touched` + `action` per activity. | corpus · **KNOWN** |
| **ACCOUNTABILITIES (outcomes answered for)** | **NO.** No outcome is bound to a role. `GOAL_SCOPE_BINDINGS` records **TEAM registered and deliberately NOT bindable** — `performanceMetricRegistry.ts:105`: *"NO TEAM ENTITY EXISTS. There is no `teams` collection and no reportsTo edge on the employee record … A TEAM goal therefore has no durable target id to point at."* | **KNOWN (the absence)** |
| **DECISION AUTHORITY + boundaries** | **YES, but as *security* authority only** — `permissions[]` per governed Role. There is **no business decision-authority model**: no approval limit, no discount authority (`governedBusinessRoles.ts:387-390`), and `functions/src/finance/financialApprovals.ts` has **no policy values set** (corpus P3B3-ADV-033). | **KNOWN** |
| **NORMAL DAILY WORK** | **YES** — corpus `NORMAL` coverage tag, per role. | corpus · **KNOWN** |
| **RECURRING WORK** | **YES** — corpus `END_OF_DAY` / `END_OF_MONTH` tags. E.g. `service_manager` 26 `END_OF_MONTH`, `Controller` 17 of 19. | corpus · **KNOWN** |
| **EXCEPTION WORK** | **YES, richly** — `EXCEPTION`, `BAD_DATA`, `MISSING_DATA`, `MISTAKE`, `RECOVERY`, `PERMISSION_DENIAL`, `NETWORK_INTERRUPTION`, `IDEMPOTENCY`, `DUPLICATE_DATA` tags. This is the corpus's strongest dimension. | corpus · **KNOWN** |
| **CROSS-DEPARTMENT INVOLVEMENT** | **YES** — `HANDOFF` and `CROSS_COMPANY` tags + `objects_touched`. | corpus · **KNOWN** |
| **MANAGEMENT / ESCALATION RELATIONSHIP** | **Management: partially** (22 placed Roles only, and see F-1's two competing models). **Escalation: NO** — see F-2. | `roleHierarchy.ts` · **KNOWN / absent** |
| **PROFICIENCY EXPECTATIONS** | **NO — nothing at all.** See F-14. | **KNOWN (the absence)** |
| **SUCCESS OUTCOMES** | **NO.** No role has a stated definition of doing the job well. Goals exist as a registry with **nine of thirty metrics active**, none role-bound. | `SYSTEM_AUTHORITIES.md:97` · **KNOWN (the absence)** |

**F-14 — proficiency is entirely unmodelled, and the corpus proves the consequence.**
`docs/specifications/employee-foundation.md:67-72` puts **Skills** and **Certifications** explicitly
out of scope, alongside HR integration, scheduling, payroll, availability and time tracking. No
proficiency, competency or certification field exists on the Employee at baseline. Corpus
**P3B1-S17-A06** — *"Complete a job that requires a certification he does not hold"*
(`apprentice_technician`, Wes Tanner) — records the expected result in two words:

> **"Nothing warns."**

So PROFICIENCY EXPECTATIONS is not merely unrecorded; the system cannot enforce one and does not
notice its violation. **KNOWN** · OBSERVED AT: 64008d5a.

---

## 8. Persona / role conflicts — carried, not fixed

The brief names two. This lane re-derived **three**, and both libraries record the first two as
known-and-not-fixed in their own `corrections.recordedNotFixed.personaIdentityCollision` blocks.
**Both readings preserved in every case, per the brief's standard.** **KNOWN** · OBSERVED AT: 64008d5a.

| Persona | Reading A | Reading B | Kind |
|---|---|---|---|
| **Marisol Vega** | B1 `service_coordinator` (49 activities) | B2 `Parts Manager` (65 activities) | **cross-library contradiction** — brief named it |
| **Priya Raman** | B1 `service_manager` (60) | B2 `Operations Manager` (17) | **cross-library contradiction** — brief named it |
| **Luis Mendoza** | B2 `Stocker/scanner operator` (28) | B2 `Stocker` (4) | **intra-library inconsistency — NOT in the brief (F-9)** |

Note the Priya Raman conflict is not merely a label clash: `service_manager` maps to `fieldManager`
(under `operationsManager`) while `Operations Manager` maps to `operationsManager` itself. The two
readings place the same person **one level apart on the same branch** — a manager and her own
manager. **INFERRED** from `roleHierarchy.ts:151-157` + F-7 · OBSERVED AT: 64008d5a.

Also recorded: B1's persona block declares 12 personas and the derived activity set uses exactly
those 12 (`marisol, rosa, dale, brett, priya, ken, curtis, javier, tonya, wes, amanda, nate`);
B1's `counts.byRole` reproduces the derived counts exactly. **B1 is internally consistent.** B3 has
**no `persona` field at all** — only `actor_role` — so B3 contributes no persona evidence and cannot
be cross-checked against B1/B2 personas. **KNOWN** · OBSERVED AT: 64008d5a.

---

## 9. What this lane extends rather than duplicates

Per the brief, `employee-foundation.*` is to be extended, never duplicated. What those documents
establish and this lane does **not** restate: the `employees/{employeeId}` schema, the
`employmentStatus` enum decision, the Employee↔User linkage, the provisioning contract, Rules
impact, and the four open architectural questions (`docs/assessments/employee-foundation.md:334-348`
— none of which concerns job roles).

What this lane **adds** that those documents do not contain:

1. `employee-foundation.md`'s schema (`:91-110`) has **`operationalRoles[]` and no `jobTitle`, no
   `managerEmployeeId`, no `departmentId` in use** (`companyId`/`departmentId`/`locationId` are
   *"Future -- reserved, unused this sprint"*). Those fields **arrived later**, via
   `docs/specifications/administration-users-consolidation.md:204-209`. **The employee-foundation
   documents are no longer the current job-role-relevant schema authority.** See §11 correction C-1.
2. The five-vocabulary finding (F-3) and the 62%-inert V2 finding (F-4).
3. The corpus↔Role crosswalk in §6, which exists nowhere else at baseline.

---

## 10. MISSING INPUT — settleable only by the Owner's employee-design conversation

That conversation is **not available to this run.** These are recorded and stopped at, not
reconstructed. Nothing below was guessed.

| id | MISSING INPUT |
|---|---|
| **M-1** | The **purpose** of Retail Sales as a job role, distinct from National Accounts Sales. |
| **M-2** | The **purpose** of National Accounts Sales as a job role, distinct from Retail Sales. |
| **M-3** | Which **responsibilities, accountabilities and success outcomes** differ between the two, on each of the eleven dimensions in §4.2. |
| **M-4** | Whether **STRATEGIC_ACCOUNTS** (the third ratified channel) is also a distinct job role, or a channel without a role. The ruling named only two. See C-3. |
| **M-5** | Whether **"Partner"** is a job role distinct from General Manager. Zero repository occurrences. |
| **M-6** | Whether **Service Coordinator and Dispatcher are one job role or two.** The brief writes them as one ("Service Coordinator / Dispatcher"); the corpus holds them apart (68 vs 61 activities, disjoint personas, and only Dispatcher has a Role or a tree placement). See C-2. |
| **M-7** | Whether **Parts Associate and Parts Counter** are one job role or two (F-8). |
| **M-8** | Whether **Administration** is one job role, or splits into office administration and platform/system administration (F-11). |
| **M-9** | The **job-role status of the 13 corpus roles with no security Role** (§6.1) — real roles, or activity-library narrative devices? 290 activities depend on the answer. |
| **M-10** | The **manager edge of record**: `managerEmployeeId` or Role placement (F-1). Both exist; they disagree; only the Owner can pick. |
| **M-11** | **Proficiency expectations** for every role (F-14). Nothing exists to extend. |
| **M-12** | Whether **`shopManager`, `shopAssociate`, `warehouseAssociate`, `supportStaff`, `generalEmployee`** are job roles (F-12). Owner-rostered or Role-catalogued, but zero observed work. |
| **M-13** | Which of the two readings is correct for **Marisol Vega** and for **Priya Raman** (§8). |

## 10b. UNPROVEN list

| id | UNPROVEN at baseline |
|---|---|
| **U-1** | That **any human holds any security Role**. Occupancy established by no lane, including this one (F-5). |
| **U-2** | That **`jobTitle`, `managerEmployeeId` or `operatingCompanyId` is populated on any Employee record**. Explicitly *"none backfilled"* (F-5). |
| **U-3** | That **any job-role model is enforced anywhere.** `jobTitle` is free text; V2's five sales/service values have no consumer (F-4). |
| **U-4** | That **escalation or domain stewardship is modelled** (F-2). |
| **U-5** | That **sales pipeline visibility is scoped by person at all.** Archaeology `:183`: *"Is a salesperson supposed to see the whole firm's pipeline? … There is no such scope on this list. **UNPROVEN** whether any scoping is intended here."* |
| **U-6** | That **channel-scoped visibility is intended**, even once coverage lands. `PLACEMENT_GAPS` frames it conditionally: *"**If** a national-accounts salesperson must be unable to see retail deals…"* |
| **U-7** | Whether the **Coverage entity supersedes or duplicates D-C1-6**. Archaeology `:324`: *"**UNKNOWN and worth an Owner ruling before anything else is built on it.**"* |
| **U-8** | That **a second Sales Manager can be distinguished from the first.** `roleHierarchy.ts:16` records that it cannot. |

---

## 11. Corrections to the lane brief — offered per "correcting me is in scope"

| id | Brief said | Evidence at 64008d5a | Severity |
|---|---|---|---|
| **C-1** | Lists `docs/specifications/employee-foundation.md` etc. as the employee documents to extend | Correct but **no longer sufficient**. `jobTitle` and `managerEmployeeId` — the two most job-role-relevant Employee fields in the repository — are **absent from employee-foundation.md's schema** and were added later by `docs/specifications/administration-users-consolidation.md:204-209`, implemented in `functions/src/access/employeeProfileCommands.ts:213,498` and `field-ops-app-vite/src/domain/employeeProfile.js:83-84`. A lane reading only the four listed documents would conclude no job-title or manager field exists. **This lane's most consequential correction.** | **HIGH** |
| **C-2** | Lists "**Service Coordinator / Dispatcher**" as one candidate role | The corpus distinguishes them on exactly the dimensions the brief demands for sales: separate roles (68 vs 61), disjoint personas (Marisol/Rosa vs Dale/Brett), and asymmetric authorization — `dispatcher` has a Role and a tree placement *above* technicians; `service_coordinator` has **neither**. The brief's own rule ("do not model a generic role where role-specific responsibility … differs") applies here and the brief itself collapses it. Logged **M-6**. | **HIGH** |
| **C-3** | "RETAIL SALES and NATIONAL ACCOUNTS SALES are distinct job roles" — **two** channels | There are **three ratified channels**: `SALES_CHANNELS = ["NATIONAL_ACCOUNTS","RETAIL","STRATEGIC_ACCOUNTS"]` (`opportunityLifecycle.ts:27`, `salesOrderLifecycle.ts:18`), and `PLACEMENT_GAPS` reasons explicitly from *"there are already three."* The ruling is silent on `STRATEGIC_ACCOUNTS`. Logged **M-4**. The ruling itself is **unaffected** — this widens it, never contradicts it. | **MEDIUM** |
| **C-4** | "`governedBusinessRoles.ts` — **45** governed business Roles … These are *security* roles" | The 45 is **exactly right** (re-derived). But the security-Role *set* is **48**: `compatibilityRoles.ts` holds `admin`, `dispatcher`, `technician` (`:247,265,292`), and all three are in the org tree. Without this, `dispatcher` (97 corpus activities), `technician` (134) and `Administrator` (83) — **314 activities, 31% of the corpus** — appear falsely as roles with no security Role. | **MEDIUM** |
| **C-5** | Names **two** persona/role conflicts to carry | There is a **third**: Luis Mendoza is `Stocker/scanner operator` **and** `Stocker` within B2 (F-9). | **LOW** |
| **C-6** | — (not in brief) | `governedBusinessRoles.ts`'s own header comment still reads *"**eight** governed business Role definitions"* (`:1-2`) against 45 actual declarations. Stale header, not a model defect — flagged so no downstream lane cites "eight". | **LOW** |

---

## 12. Handoff to EMP-OWN-SYNTHESIZER

1. **Do not build the job-role model from the 45 governed Roles.** 26 have no corpus activity and 21
   of those are grants, not positions (§6.2). The brief's instruction was right.
2. **Do not build it from `operationalRoles[]` alone either.** Eight values, five inert, and no value
   for Owner, GM, Dispatcher, Service Coordinator, Purchasing, Finance or Administration (F-3, F-4).
3. **The Retail/National Accounts ruling is corroborated by the org chart and blocked by a deferred
   model, not by missing evidence** (§4.3). Escalate the scheduling collision — *"record and preserve
   the seams, do NOT build during the runway"* versus a ruling that needs channel-scoped coverage —
   as an Owner decision, not a lane task.
4. **Resolve C-1 and C-2 before integrating.** Both change what a downstream reader would conclude.
5. **290 corpus activities (28.7%) belong to roles with no security Role** (§6.1). Either the role
   model is short 13 roles or the corpus invented 13 actors. M-9 decides which; nothing in this
   repository decides it.
