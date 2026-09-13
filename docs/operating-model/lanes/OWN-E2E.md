# OWN-E2E — end-to-end ownership lifecycle census

**LANE:** OWN-E2E · **BASELINE:** `64008d5ae0bdd9532909671b15a91122400accf1` (`ATLAS-BASE-2026-09-12-A`)
**MODE:** READ_ONLY (all code) / EVIDENCE_WRITE (this file only) · **DATE:** 2026-09-13
**OBSERVED AT: 64008d5a** applies to every claim below.

> **The lane rule.** Helper modules existing ≠ end-to-end ownership complete. Nothing in this
> document treats the existence of a module as the completion of a stage. Ownership handoff was
> **audited, not activated.**

---

## 0. Method and reliability

Reliability order used throughout: **EXECUTED > SOURCE+CONFIG RECONCILED > STATIC READ.**
Every verdict names its method.

| Method | How |
|---|---|
| **EXECUTED** | Node 22.23.2 `--experimental-strip-types` plus a custom `resolve` loader hook mapping extensionless **and** `.js`-suffixed specifiers onto the shipped `.ts` files. The **shipped modules were run**, not parsed. Harness: `/tmp/claude-1000/-home-rudy2/420f8db5-9c22-4692-ab2c-a24bee4416dd/scratchpad/owne2e/{register,hook}.mjs`. |
| **RECONCILED** | `npx tsc --noEmit -p functions/tsconfig.json` → **exit 0, 0 errors**. All 12 ownership modules typecheck at this baseline. |
| **STATIC READ** | `grep`/`sed` over source and `firestore.rules`, cited `file:line`. Used only where execution is impossible (Rules language, JSX). |

**Comments are not evidence.** This program has already corrected ~80 false comments across 44 files.
Two fresh instances were found in this lane's own scope and are reported as findings, not as facts:
`ownershipBackfillRules.ts:5` (F-3) and `governedBusinessRoles.ts:61` (C-10). Every count below comes
from executing or reading the **code**, never its header.

**Dependency borrow.** `functions/node_modules` is absent at this baseline. Borrowed by symlink from
`p1b-dryrun`, verified idle first (no process with a cwd in it; `git status --porcelain` empty) and
dependency-identical (`functions/package-lock.json` **md5 byte-identical**, `ffd6e97b2883b03654dd184c0fed12e0`;
`package.json` differs **only** in `test:*` script strings, no dependency delta). Link removed after each run.
**Lender verified intact afterwards:** 637 `node_modules` entries, `firebase-admin` resolves,
`git status` clean, HEAD `68f1bde9c36d37fa086ade0439964daa89cb7c4a`.

**No production contact, no deploy, no Firestore read or write, no database mutation.** The one
Firebase call made was `initializeApp({ projectId: "demo-own-e2e-probe" })` — a local object graph
with no credentials and no network — used so that audit-writer validation could be reached with a
**fake in-memory writer**. Nothing was committed; the probe counted staged objects in an array.

**Emulator.** Cannot run here (no JRE; port 8080 held by unrelated uvicorn pid 187). Emulator-dependent
claims are marked **UNPROVEN** in §9 with the exact read that would settle each.

**`functions/lib` is absent** (gitignored build output). No conclusion here depends on it: the
EXECUTED harness runs `src/**` directly, and the typecheck was `--noEmit`.

---

## 1. Corrections to the brief — re-derived at this baseline

The brief asked to be corrected. Nine items; four of its claims are wrong or mis-scoped.

| # | Brief claim | Verdict | Evidence |
|---|---|---|---|
| C-1 | 12 modules in `functions/src/ownership/**` | **CONFIRMED** | 12 `.ts` files. The brief's "three warehouse-specific" is really **two** warehouse (`warehouseCanonicalIdRepair.ts`, `warehouseRootCompanyAssignment.ts`) plus **one reorder** (`reorderRequestLocationAuthority.ts`). Count right, description wrong. |
| C-2 | Matrix distribution 20 SINGLE_COMPANY / 30 COMPANY_NEUTRAL / 1 CROSS_COMPANY_CAPABLE | **CONFIRMED (EXECUTED)** | 51 rows total. Exactly `{"COMPANY_NEUTRAL":30,"SINGLE_COMPANY":20,"CROSS_COMPANY_CAPABLE":1}`. |
| C-3 | `ownerClass === "PARTICIPATING_COMPANIES"` is the cross-company discriminator, not a company pair | **CONFIRMED (EXECUTED)** | Exactly **1** row: `transferOrder`. And `inventoryTransaction` **carries the company pair** (`participatingFields: ["sourceOperatingCompanyId","destinationOperatingCompanyId"]`, `ownershipMatrix.ts:389`) while being `ownerClass: "COMPANY"` — so the pair genuinely is **not** the discriminator. The handoff command keys on `ownerClass`, `ownershipHandoffCommand.ts:101`. |
| C-4 | Work Order carries no company field at all (`ownerFields: []`, 0 of 30) | **CONFIRMED, but the brief's denominator is wrong** | `ownershipMatrix.ts:248-249`: `family: "workOrder", collection: "fieldops_wos"`, `ownerFields: []`. The "0 of 30" is the **sandbox record count** for that one family (`:254` note), not a matrix ratio. Across the matrix, **38 of 51 rows have empty `ownerFields`** (EXECUTED). **Nuance the brief misses:** the *legacy* service family `workOrderLegacy`/`fieldops_jobs` **does** carry `operatingCompanyId` (`:267-268`). "The Work Order has no company field" is true only of `fieldops_wos`. |
| C-5 | `ownershipMatrix.ts:248` now reads `ownerFields: []` where an older doc claimed storage | **CONFIRMED** | `:249`. The file documents the withdrawal itself at `:236-247`, including *why*: the census reason string `"family has no ownership storage yet"` is emitted only when `ownerFields` is empty, so the non-empty declaration post-dated the reconciliation the header claimed. |
| C-6 | `ownershipMatrix.ts:392-414` points four families (`inventoryTransaction`, `inventoryAction`, `transfer`, `cycleCount`) at retired `stock_locations` | **WRONG AS STATED** | Three errors. (a) **`transfer` is not a family** — the transfer family is `transferOrder` at `:447`, and its `inheritanceSource` is *"the governed source and destination location authorities"*, never `stock_locations`. (b) **`receivingOrder` (`:403`) was omitted** from the list but belongs to it. (c) The span is wrong: `inventoryTransaction` is at **`:385`**, outside `392-414`. Correct set and span: `inventoryTransaction:385`, `inventoryAction:396`, `receivingOrder:403`, `cycleCount:411` — i.e. **`:385-417`**. Further nuance: only `inventoryTransaction` and `inventoryAction` literally name *"the governed stock location's company"*; `receivingOrder` and `cycleCount` say *"the receiving/counted **location's** company"*, which under the D-9 reclassification means a `warehouses`/`mobile_locations` root. |
| C-7 | `stock_locations` was retired as operational authority | **CONFIRMED** — and the retirement **deliberately keeps** the matrix row | `firestore.rules:1181` "CLIENT READ RETIRED (BIN-P2R, Decision #160 / ADR-014)"; `functions/src/types/warehouse.ts:9` "BIN-P2 retired all of it"; `docs/assessments/bin-p2-legacy-inventory-authority-retirement.md:86` records **0** `stock_locations` accesses in `functions/src`. **But `:43` of that same doc rules the ownership-matrix entry `KEEP`** — "already records it as a balance row, not a place." So the matrix row is *sanctioned*, not stale. |
| C-8 | Two stale matrix rows: `:287-296` (reorder `warehouseId`) and `:327-336` (retired `stock_locations`) | **BOTH WRONG at this baseline** | `:287-294` `reorderRequest` already reads `ownerFields: []`, `backfillSource: null`, and its note **records the gap** ("MEASURED DESIGN GAP: 6/6 sandbox requests carry no warehouseId"). It is corrected, not stale. `:328-335` `stockLocation` is the row C-7 shows was explicitly retained. **The real staleness is elsewhere** — see F-2 and F-3 below. |
| C-9 | Governed-role capacity proven, **occupancy unknown**; that gap is load-bearing for stages 4 and 5 | **CAPACITY CONFIRMED; OCCUPANCY IS NOT UNKNOWN — IT IS MEASURED** | 45 governed roles, `functions/src/access/governedBusinessRoles.ts:1683-1728`. **Production (`taylor-parts`, measured 2026-09-02): governed-role occupancy is ZERO.** `docs/assessments/r32-production-exposure-census.md:53` (`roleAssignments \| 2`), `:64-66` ("Exactly one principal holds any active RoleAssignment: `admin` at `global` scope"), `:70-79`, `:84-90` ("No manager Role is assigned at any scope in production"). **Sandbox: occupancy is NON-ZERO** — 86 active governed assignments across **30 distinct** governed roles, `docs/governance/certification-grant-manifest.json:3-4` + entry tally, with the pre-state at `docs/governance/pre-grant-snapshot.json`. The brief's gap is **closed**, and closed in the direction that makes stages 4/5 worse in production, not better. |

| C-10 | *(from sibling lane EMP-ROLE)* the security-Role set is **48**, not 45 | **CONFIRMED (EXECUTED)** | `GOVERNED_BUSINESS_ROLES` = **45** keys, `COMPATIBILITY_ROLES` = **3** (`admin`, `dispatcher`, `technician`, `compatibilityRoles.ts:350-353`), **overlap 0** → **48**. And the sibling's warning is borne out: **`governedBusinessRoles.ts:61` says "eleven -- three compatibility, eight governed business"** — stale by 37. The code is authority; the header is not. The 48-vs-45 distinction is **load-bearing for this lane**, because the 3 compatibility Roles are the *only* ones Firestore Rules can see (`firestore.rules:22,112`) and they are exactly the Roles that carry the §5 ownership-write exposure. |

### Also wrong in the brief's framing

- **"`roleAssignments` is the sole source of an ALLOW"** — true only of the trusted callable surface
  (`functions/src/access/effectiveAccessFeed.ts:175-181`, ~20 repeat consumers). **False for Firestore
  Rules**, where `roleAssignments` is `allow read, write: if false` (`firestore.rules:1684-1686`) and
  contributes to **no** ALLOW. Every Rules ALLOW comes from `isSignedIn()` (`:6`),
  `isAdminOrDispatcher()` (`:22`), or `isActiveOperationalRole()` (`:112`) — i.e. from `users.role`
  and the linked Employee, never from a governed Role. Rules cannot call the resolver, stated at
  `firestore.rules:1576-1586`.
- **"Ownership handoff has historically been INERT and not a complete runtime lifecycle"** —
  the *wiring* is INERT, but the brief undersells the module: **EXECUTED, `buildOwnershipHandoff`
  accepts and produces a complete, well-formed audit-event input for 14 of 51 families** (§4). The
  builder is not a stub. What is missing is a caller, storage on most families, and — critically —
  the fact that the validation is in the **wrong module** (F-1).

---

## 2. Re-derived numbers (all EXECUTED unless noted)

| Quantity | Value | Source |
|---|---|---|
| Matrix rows | **51** | `OWNERSHIP_MATRIX.length` |
| `companyScope` | COMPANY_NEUTRAL **30** / SINGLE_COMPANY **20** / CROSS_COMPANY_CAPABLE **1** | — |
| `ownerClass` | EXCLUDED **17** / COMPANY **20** / REFERENCE **7** / PERSON **6** / PARTICIPATING_COMPANIES **1** | — |
| `ownerType` | COMPANY **20** / USER **6** / null **25** | — |
| `transfer` | N_A **25** / HANDOFF **14** / IMMUTABLE **12** | — |
| Rows with empty `ownerFields` | **38 of 51** | — |
| `ownableFamilies()` / `CENSUS_FAMILIES` | **27** | `ownershipMatrix.ts:552`, `ownershipCensus.ts:251` |
| Families with a **MODEL** gap (census reason `"family has no ownership storage yet"`) | **13** | `classifyDocument` over `{}` |
| Families with a **DATA** gap (storage exists, value absent) | **14** | same |
| Families `buildOwnershipHandoff` **accepts** | **14** | §4 |
| `BACKFILL_RULES` | **9** | `ownershipBackfillRules.ts:95` |
| `DERIVATION_RULES` | **8** | `ownershipDerivation.ts:59` |
| `AUTHORIZED_TOTAL` | **1013** | `ownershipBackfillRules.ts:234` |
| Governed business Roles | **45** | `governedBusinessRoles.ts:1683-1728` (header at `:61` says 8 — stale) |
| Compatibility Roles | **3** | `compatibilityRoles.ts:350-353` |
| **Total security Roles** | **48** (overlap 0) | EXECUTED |
| `OPERATIONAL_ROLE_VALUES` | **8** | `employeeProfileCommands.ts:336` |
| Operating companies | **2** (`taylor`, `ventana`) | `operatingCompanyAuthority.ts:22-26` |
| `OWNERSHIP_HANDOFF_SOURCES` | **3** — `DIRECT_HANDOFF`, `CUSTOMER_HANDOFF_REVIEW`, `ADMIN_CORRECTION` | `auditEventWriter.ts:429-435` |

### F-3 — the authorized-write total contradicts its own header

`ownershipBackfillRules.ts:5` states *"The Owner authorized exactly **1,015** writes."*
**EXECUTED: `AUTHORIZED_TOTAL` = 1013** (`337+180+278+99+47+41+24+5+2`). The 2-write delta is the
removed `trucks` cap, `:229-231`. `ownershipMatrix.ts:359` records that the applier **already wrote
`operatingCompanyId` on both trucks** ("evidence: applied 1015/1015"). So **2 writes stand in the data
that the current rule set can neither reproduce nor verify**, and the blast-radius control the module
exists to provide (`:215-218`) now authorizes a total that does not match what was applied.
→ **OD-OWN-004.**

### F-2 — the real matrix staleness: a backfill cap aimed at a retired collection

`ownershipBackfillRules.ts:99` still carries an **active rule** writing `operatingCompanyId` onto
`stock_locations`, and `:228` an **active cap of 5 writes** — against the collection C-7 proves was
retired as operational authority with **0** readers in `functions/src`. Unlike the matrix row (which
the retirement doc deliberately keeps as *description*), this is an **applier instruction**.
→ **OD-OWN-005.**

---

### F-6 — occupancy: three states, not two (sharpening requested by the coordinator)

The coordinator asked me to separate *"we cannot tell whether the queue is populated"* from *"the
queue is empty because nobody holds the Role."* For this lane the distinction resolves into **three**
states, and two of them are establishable from committed source — no emulator needed.

| State | Meaning | Established? |
|---|---|---|
| **UNPOPULATED — proven** | Production governed-Role occupancy is **zero**, by a committed read-only census | **YES.** `docs/assessments/r32-production-exposure-census.md:53,64-66,70-79,84-90`. Not "unmeasured" — *measured, and the measurement is zero.* The two principals holding an operational role (PARTS_MANAGER, WAREHOUSE_MANAGER) hold **no RoleAssignment whatsoever** (`:70-79`). |
| **POPULATED — proven** | Sandbox holds 86 active governed assignments across **30 distinct** Roles | **YES.** `docs/governance/certification-grant-manifest.json:3-4` + per-entry tally; pre-state `docs/governance/pre-grant-snapshot.json` (all 47 cert employees `currentRoleAssignmentExists: false`). |
| **UNMEASURED** | Occupancy *today* (census is 2026-09-13 minus 2026-09-02 = 11 days stale); `eos-platform-certification` never measured | **NO** → U-4. |

**But for ownership specifically the question does not bite, and that is the more important finding.**
**No work queue anywhere is keyed on an ownership fact** (§7 stage 5). So the failure mode is not "a
queue keyed on a Role nobody holds is empty" — it is that **there is no ownership-keyed queue to be
empty in the first place.** Role occupancy is therefore *not* the binding constraint on stages 4 and 5
for ownership; the binding constraints are (a) 11 of 13 stored company fields are never rendered
(§7A) and (b) no queue consults an owner. I can establish both from source.

Where occupancy *does* bite is the capability gate, and there the answer is worse than occupancy:
`service.inboundWork.read` is `active: false` (`access/permissionCatalog.ts:1612-1617`), so the Inbound
Work queue denies **every** principal regardless of Role held. A Role nobody holds and a capability
nobody can hold are different failures; this is the second.

### F-7 — the same failure shape, elsewhere in the vocabulary (INERT values)

The coordinator notes 5 of 8 `operationalRoles[]` values have no consumer. **EXECUTED:
`OPERATIONAL_ROLE_VALUES` has exactly 8 members** — `PARTS_MANAGER`, `PARTS_ASSOCIATE`, `TECHNICIAN`,
`WAREHOUSE_MANAGER`, `WAREHOUSE_ASSOCIATE`, `SERVICE_MANAGER`, `SALES_MANAGER`, `SALES_ASSOCIATE`
(`employeeProfileCommands.ts:336`). Only `PARTS_MANAGER` and `WAREHOUSE_MANAGER` appear in
`firestore.rules` via `isActiveOperationalRole()` (`:112`, used at the `parts` block ~`:1633-1636`),
plus `TECHNICIAN` through the separate technician predicates.

In this lane's vocabulary **a declared value with no consumer is INERT, not missing** — identical in
shape to the ownership handoff being audited here: complete, valid, typechecked, and invoked by
nothing. Recording it because the two defects will otherwise be remediated by different teams under
different names. Per the coordinator, `jobTitle` is free text and there is **no mapping** between the
five role vocabularies; that is upstream of this lane but it is the same root cause as F-1 — a model
declared in one place and consumed in another, with nothing forcing the two to meet.

**Bearing on stages 2 and 3 for person-shaped families:** `jobTitle` and `managerEmployeeId` are absent
from `employee-foundation.md` and arrived via `docs/assessments/administration-users-consolidation.md:204-209`
(sibling lane's citation, not re-verified here — flagged U-10). If `managerEmployeeId` is the only
escalation path an Employee record carries, then stage 14 (ESCALATION) being MISSING across every
family is not an oversight in the ownership model but the absence of any accountable-person hierarchy
for it to escalate *to*. → **OD-OWN-008.**

### F-8 — the PERSON axis has no referential integrity; the COMPANY axis has only partial integrity

Raised by sibling lane EMP-ACCOUNTABILITY, **re-verified here, and I already held EXECUTED proof of it
without having recognised it.** This is the most consequential correction to my own stage 3.

`deriveEmployeeRefOwner` (`typedOwner.ts:112-126`) and `deriveAccountOwner` (`:95-108`) end at
`typedOwner(OWNER_TYPES.USER, value)`, which is `isTypedOwner` — a **pure shape check**
(`:73-76`). **Neither ever reads an Employee document.** `deriveCompanyOwner` (`:131-148`) instead calls
`resolveOperatingCompany(value)` and distinguishes `INVALID` from `UNKNOWN`.

**EXECUTED proof, from my own §4 Probe A.** The first run accepted
`USER:EMP-OLD → USER:EMP-NEW` — arbitrary strings naming no employee — while **refusing** arbitrary
COMPANY ids with `NEW_OWNER_INVALID` until I substituted the governed `taylor`/`ventana`. The asymmetry
is not inferred from reading; it is what the shipped code did when run.

**Consequence:** a record owned by a **terminated, deleted or never-existent employee censuses as
`RESOLVED`.** The census that gates enforcement is **structurally blind to person-level orphans**, so
**the existing census cannot be used as evidence that person ownership resolves** — only that a
non-empty string is present. Stage 3 is therefore downgraded to **PA for every person-owned family**
even though the code exists and runs correctly: it answers a narrower question than the stage asks.

Two precisions I would add to the sibling's framing:

1. **It is deliberate and documented, not accidental** — `typedOwner.ts:45-48` cites Owner ruling O-1
   excluding "a fallible cross-collection lookup" from ownership resolution, and states that a USER
   family's `UNKNOWN` count is *"structurally zero, not merely empty."* The defect is that the census
   **reports that structural zero as if it were a measurement**, and the gate reads it as one.
2. **The COMPANY axis is not fully integral either.** `deriveCompanyOwner` resolves an **INACTIVE**
   company as `RESOLVED` by design (`typedOwner.ts:127-130`: "a record owned by a since-deactivated
   company still HAS an owner"). So the company axis has **existence** integrity but not
   **active-status** integrity. "COMPANY has referential integrity, PERSON has none" is right in
   direction and slightly too strong in degree.

**Axis split (the coordinator asked for this rather than per-family alone):**

| Stage | PERSON axis (6 families: account, contact, location, opportunity, salesAgreement, salesOrder) | COMPANY axis (20 families) |
|---|---|---|
| 1 CREATION | **PA** — governed resolver live for 2 of 6 (`opportunityCommands.ts:159`, `salesOrderCommands.ts:261`); refusal-on-unresolved is correct (`creationOwnerResolution.ts:58`) | **M/OD** — no writer stamps a company for most; 12 root decisions outstanding |
| 2 PERSISTENCE | **PA** — 4 of 6 in Firestore; `contact`/`location` **Postgres-only** (§7A) | **PA** — 7 of 20 have a real field; 13 have none |
| 3 AUTHORITATIVE READ | **PA — shape-only, no referential integrity (F-8)** | **PA — existence checked, active-status not** |
| 4 DISPLAY | **P** — 4 of 6 displayed and name-resolved (§7A) | **M** — 11 of 13 stored fields never rendered |
| 6 COMMAND AUTHORITY | **M for 3 of 6** — unguarded client write (§5) | **P** — mostly `if false` or `hasOnly`-guarded |
| 7 HANDOFF | **PA** — one live control (opportunity), bypassing the authority | **I** — no path at all |
| 10 AUDIT | **PA** — field diffs only, no handoff semantics | **M** |
| 15 SEARCH | **I** — one dimension, permission `active:false` | **M** — zero dimensions |

**The person axis is reachable but not trustworthy; the company axis is trustworthy but not
reachable.** Neither completes a lifecycle, and they fail at opposite ends — which is why a
per-family verdict alone hides the shape of the problem.

### F-9 — stage 14: the only expressible escalation is to cancel the customer's commitment

**Re-verified and broader than reported.** `functions/src/transitionEngine.ts:37`:

> *"committed, so DISPATCHED / ACCEPTED / EN_ROUTE / ARRIVED / WORK_IN_PROGRESS have no way back."*

That is **five** terminal-ish states, not the two reported. Past `Dispatch`
(`transitionEngine.ts:135`), a Work Order's only exits are the next technician-gated step
(`requiresOwnAssignment`, `:108`) or `Cancel` (`:137`). Independently corroborated by corpus
`P3B1-S21-A09` — *"None of the four can be reassigned. All four must be cancelled and recreated"*
(sibling citation, not re-derived → U-12).

So **EOS's only expressible answer to an unavailable technician is to cancel the record of a live
customer commitment.** Stage 14 is therefore **MISSING at the model level, not merely unimplemented** —
there is no representation for responsibility moving when work fails, and the workaround destroys the
commercial record. Compounding it: per EMP-ACCOUNTABILITY, **ACCOUNTABLE PERSON and ESCALATION OWNER
have no representation at all**, MANAGER has two unreconciled authorities, and
`SERVICE_MANAGER`/`SALES_MANAGER` are labels with no consumer (consistent with my own F-7: 5 of 8
`OPERATIONAL_ROLE_VALUES` have no consumer). **Any stage presupposing an accountable person is MISSING
at the model level** — which is stages 8 and 14 across all 24 families. → **OD-OWN-012.**

### Superseded documents — do not cite as ownership authority

Flagged by the coordinator as its own errors; recorded so no downstream lane re-adopts them.

| Document | Status |
|---|---|
| `docs/OWNERSHIP.md` | **NOT a record-ownership authority.** IP/attribution governance; contains nothing about record ownership. |
| `docs/specifications/record-ownership.md` | Contains *"whoever creates a record owns it"*, **superseded by ruling D-4 and not marked as such.** It contradicts the standing rule that the actor/creator does **not** become owner — the rule `creationOwnerResolution.ts:12-23` exists specifically to enforce, listing six forbidden fallbacks including `createdBy` and the authenticated user. Cite only as superseded. |

Neither is cited as authority anywhere in this document.

---

## 3. Runtime wiring — the INERT / MISSING / LIVE split

`functions/src/ownership/` has no barrel, no `export *`, and no dynamic `import()` in `functions/src`,
so the static import graph is complete. `functions/src/index.ts` contains **zero** occurrences of
`ownership` — every module reaches runtime only transitively.

| Module | Wiring verdict | Evidence |
|---|---|---|
| `operatingCompanyAuthority.ts` | **LIVE** (12+ src importers) | `finance/financeReadCallables.ts:24` (→`index.ts:109`), `reorderRequest/reorderCallables.ts:34` (→`index.ts:53`), `cycleCount/cycleCountSheetCallables.ts:15` (→`index.ts:320`), `access/trustedWriterCommands.ts:51` (→`index.ts:170`), `warehouseGovernance/governedWarehouseValidation.ts:25`, `inventoryTransfer/transferOrderRepository.ts:27`, `inventoryReceiving/receivingRepository.ts:34`, `inventoryLedger/operationalMovementRepository.ts:39` |
| `typedOwner.ts` | **LIVE** | `access/auditEventWriter.ts:58`, `opportunity/opportunityCallables.ts:32` (→`index.ts:42`), `opportunity/closeOpportunityAsWon.ts:73` (→`index.ts:67`), `opportunity/createSalesOrderFromOpportunity.ts:32` (→`index.ts:64`) |
| `creationOwnerResolution.ts` | **LIVE** | called `salesOrder/salesOrderCommands.ts:261` (→`salesOrderCallables.ts:22`→`index.ts:93`) and `opportunity/opportunityCommands.ts:159` (→`index.ts:42`) |
| `commercialCompanyScope.ts` | **LIVE** | called `opportunityCommands.ts:175`, `salesOrderCommands.ts:274`, `salesAgreementCommands.ts:304` (→`index.ts:74`) |
| `ownershipMatrix.ts` | **INERT** | Its only `functions/src` importer is `eosCommercial/commercialOwnershipAuthority.ts:33`, whose only importer is `commercialOwnershipRepository.ts:35`, which **has no importer at all** in `functions/src` — a closed test-only island. |
| `ownershipHandoffCommand.ts` | **INERT** | No `functions/src` importer. Only `functions/test/ownershipModel.test.mjs:36`, `functions/test/warehouseRootCompanyAssignment.test.mjs:28`, `functions/scripts/assignWarehouseRootCompany.js:72`. |
| `ownershipCensus.ts` | **INERT** (script-only) | `functions/scripts/ownershipCensusDryRun.js:41` + tests |
| `ownershipDerivation.ts` | **INERT** (script-only) | `functions/scripts/ownershipDerivationCheck.js:25` + tests |
| `ownershipBackfillRules.ts` | **INERT** (script-only) | `functions/scripts/ownershipSandboxBackfill.js:43`, `ownershipBackfillSimulation.js:38` |
| `warehouseCanonicalIdRepair.ts` | **INERT** (script-only) | `functions/scripts/repairSandboxWarehouseCanonicalIds.js:53` |
| `warehouseRootCompanyAssignment.ts` | **INERT** (script-only) | `functions/scripts/assignWarehouseRootCompany.js:71` |
| `reorderRequestLocationAuthority.ts` | **INERT** (test-only) | one dynamic import, `functions/test/ownershipModel.test.mjs:631`. No src, **no script**. |

**No matrix column has a live runtime reader.** Every read of `.ownerClass` / `.transfer` /
`.companyScope` is inside an INERT module or the matrix's own helpers
(`ownershipHandoffCommand.ts:101,110,116`; `ownershipMatrix.ts:552,558,563,572`; the dead island at
`commercialOwnershipAuthority.ts:120`). This **confirms and generalizes** the brief: it is not only the
two company-scope columns that lack a runtime reader — **it is all of them.**

The repo states the intent plainly: `functions/test/ownershipProductionGuard.test.mjs:3-5` —
*"NO APPLIER EXISTS YET."*

---

## 4. F-1 — THE HEADLINE: the safety checks are in the inert module; the live writer has none

**EXECUTED, two probes against the shipped modules.**

**Probe A — `buildOwnershipHandoff` (INERT module) across all 51 families**, using valid governed
owner ids (`taylor`→`ventana` for COMPANY, employee ids for USER):

**Accepts 14 / refuses 37.** Accepted: `account`, `contact`, `location`, `opportunity`,
`salesAgreement`, `salesOrder`, `workOrder`, `workOrderLegacy`, `reorderRequest`, `warehouse`,
`mobileLocation`, `truck`, `supplierCompanyTerms`, `equipment`. Refusals were all correct and
correctly *differentiated*: `FAMILY_IMMUTABLE` ×12, `FAMILY_NOT_OWNABLE` ×24, `FAMILY_PARTICIPATING_COMPANIES` ×1.

*(A first run refused all COMPANY families with `NEW_OWNER_INVALID`. That was the probe's fault —
`typedOwner` validates the id against the governed company authority — not the module's. Recorded
because a static read would have mis-reported it, and the program has already been burned once by a
static parse.)*

**Probe B — `stageAuditEvent` (the LIVE writer) with a fake in-memory writer.** The live path
**ACCEPTED an `OWNERSHIP_HANDOFF` event for every case the builder refuses**:

| Probe | Builder (inert) | Live audit writer |
|---|---|---|
| `invoice` (IMMUTABLE) | REFUSED `FAMILY_IMMUTABLE` | **ACCEPTED** |
| `payment` (IMMUTABLE) | REFUSED `FAMILY_IMMUTABLE` | **ACCEPTED** |
| `inventoryTransaction` (IMMUTABLE) | REFUSED `FAMILY_IMMUTABLE` | **ACCEPTED** |
| `part` (REFERENCE) | REFUSED `FAMILY_NOT_OWNABLE` | **ACCEPTED** |
| `auditEvent` (EXCLUDED) | REFUSED `FAMILY_NOT_OWNABLE` | **ACCEPTED** |
| `roleAssignment` (EXCLUDED) | REFUSED `FAMILY_NOT_OWNABLE` | **ACCEPTED** |
| `transferOrder` (PARTICIPATING) | REFUSED `FAMILY_PARTICIPATING_COMPANIES` | **ACCEPTED** |
| `notAFamilyAtAll` (nonexistent) | REFUSED `FAMILY_UNKNOWN` | **ACCEPTED** |
| `account` given a **COMPANY** owner | REFUSED `OWNER_TYPE_MISMATCH` | **ACCEPTED** |

**Cause:** `auditEventWriter.ts` imports only `typedOwner` (`:58`) — **never `ownershipMatrix`** — and
validates `targetType` as nothing more than a non-empty string (`:470-471`). Its handoff block
(`:514-600`) checks `objectId`, owner *shape*, the no-op case, `handoffSource` and reason hygiene, but
**no family semantics at all**. All five family-level refusals exist **only** in the unwired builder.

**Consequence:** the module that makes ownership handoff *safe* is the one **no runtime or product
path calls** — precisely: it IS invoked, by `functions/scripts/assignWarehouseRootCompany.js:72`, so
"nothing calls it" would be false; "no callable, route or component reaches it" is true, and that is
the claim. The module that is *live* the module
that is *live* would persist a handoff of an invoice, of a part, of an audit event, or of a record
family that does not exist. `OWNERSHIP_HANDOFF` is a valid `AuditAction` (`auditEventWriter.ts:256`,
`types/access.ts:510`) and `auditEventWriter` has many live callers — so this is reachable the moment
any caller passes the action. **Wiring the handoff by calling the audit writer directly — the shortest
path — would produce exactly the corruption the matrix was written to prevent.** → **OD-OWN-001.**

Nothing was committed: the fake writer counted 10 staged objects in an array.

---

## 5. F-4 — command authority is missing where the ownership chain is rooted

`accounts` is **client-writable** by any `admin` **or** `dispatcher`:
`firestore.rules:1332-1337` — `allow create/update: if isAdminOrDispatcher() && accountGovernedFieldsValid(...) && (isAdmin() || accountGovernedFieldsUnchanged())`.

The "governed fields" are **only `paymentTerms` and `taxStatus`** — `accountGovernedFieldsValid`
(`:1298-1300`), `accountGovernedFieldsUnchanged` (`:1306-1309`). **`accountOwner` is not among them,
and there is no `hasOnly` key restriction on the write.** `grep 'accountOwner\|ownerEmployeeId'
firestore.rules` returns **nothing**.

So **any admin or dispatcher can rewrite `accounts.accountOwner` — the root of the entire
person-ownership inheritance chain — by a direct client Firestore write, with no handoff, no audit
event, and no governed command.** Identical exposure:

| Collection | Owner field | Rule | Field-level guard? |
|---|---|---|---|
| `accounts` | `accountOwner` | `firestore.rules:1335-1337` | **NONE** |
| `contacts` | `owner` | `firestore.rules:1557` — bare `isAdminOrDispatcher()` | **NONE** |
| `locations` | `owner` | `firestore.rules:1343` — bare `isAdminOrDispatcher()` | **NONE** |
| `fieldops_jobs` | `operatingCompanyId` | `firestore.rules:382-391` — admin/dispatcher update, transition-gated only, **no `hasOnly`** | **NONE** |

Protected by contrast — the pattern that *should* have been used:

| Collection | Why protected |
|---|---|
| `equipment` | `firestore.rules:1543` `hasOnly(equipmentEditableKeys())`, and `:1396-1401` **omits `operatingCompanyId`** → client cannot touch the company. |
| `opportunities`, `sales_orders`, `sales_agreements` | `allow read, write: if false` (`:1741`, `:1750`, `:1795`) — fully trusted-writer. |
| `warehouses`, `trucks`, `fieldops_wos` | `allow create, update, delete: if false`. |

**This intersects the occupancy finding and makes it sharp.** Production holds exactly **one** active
role assignment and it is `admin` at global scope (`r32-production-exposure-census.md:64-66`). The one
principal that exists in production is precisely the one who can silently rewrite ownership on
`accounts`, `contacts` and `locations`. → **OD-OWN-002.**

---

## 6. F-5 — a live path that refuses universally, gated on unpopulated roots

`reorderRequest/reorderCommands.ts:177-185` is **LIVE** (`→reorderCallables.ts→index.ts:53`) and
reads the warehouse's company, refusing `WAREHOUSE_NO_COMPANY` when absent. The code says so itself
at `:177-178`: *"Today no sandbox warehouse does, so this REFUSES rather than inventing one."*

But `warehouse` has `ownerFields: []` (`ownershipMatrix.ts:319`) — **no company storage exists**, and
`unresolvedPolicy` is `OWNERLESS_UNTIL_SUPPLIED` pending the Owner's root assignments
(`:300-303`: "12 root decisions, not 19").

So the trusted reorder-creation path is **complete, live, fail-closed and currently refusing every
request in every environment**. This is neither INERT (it runs) nor MISSING (it is correct) — it is a
finished mechanism blocked on a **data decision only the Owner can make**. It also means
`reorderCommands.ts:190` **does** stamp `operatingCompanyId` on a reorder request, which the matrix's
`reorderRequest` row (`ownerFields: []`, `:288`) does not reflect. → **OD-OWN-003.**

---

## 7. Family × 16-stage matrix

Codes: **P** PROVEN · **PA** PARTIAL · **M** MISSING · **I** INERT (code exists, nothing invokes it) ·
**NA** NOT APPLICABLE · **OD** OWNER DECISION REQUIRED · **U** UNPROVEN.
Stages: 1 CREATION · 2 PERSISTENCE · 3 AUTHORITATIVE READ · 4 DISPLAY · 5 WORK QUEUE ·
6 COMMAND AUTHORITY · 7 HANDOFF · 8 ACCEPTANCE · 9 ATOMICITY · 10 AUDIT · 11 HISTORICAL ·
12 FUTURE · 13 ASSIGNMENT SEPARATION · 14 ESCALATION · 15 SEARCH/REPORTING · 16 UI/API REACHABILITY.

| Family (matrix key) | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Account** `account` | PA | P | **PA*** | **P** | M | **M** | **M** | M | I | **M** | PA | P | **PA** | M | **I** | **P** |
| **Contact** `contact` | M | PA | **PA*** | **M** | M | **M** | I | M | I | **M** | NA | NA | P | M | **M** | **M** |
| **Location** `location` | M | PA | **PA*** | **M** | M | **M** | I | M | I | **M** | NA | NA | P | M | **M** | **M** |
| **Opportunity** `opportunity` | **P** | P | **PA*** | **P** | M | P | **PA** | M | I | **PA** | PA | P | P | M | **M** | **P** |
| **Sales Agreement** `salesAgreement` | PA | P | **PA*** | **P** | M | P | I | M | I | PA | PA | P | P | M | **M** | **PA** |
| **Sales Order** `salesOrder` | **P** | P | **PA*** | **P** | M | P | I | M | I | PA | PA | P | P | M | **M** | **PA** |
| **Work Order** `workOrder` (`fieldops_wos`) | M | **M** | M | **NA** | M | P | I | M | I | M | NA | M | NA | M | **M** | **M** |
| **Service Visit/Job** `workOrderLegacy` (`fieldops_jobs`) | M | P | P | **M** | M | **M** | I | M | I | **M** | NA | M | **PA** | M | **M** | **M** |
| **Equipment** `equipment` | M | P | P | **I** | M | **P** | I | M | I | M | NA | M | P | M | **M** | **I** |
| **Part** `part` | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA |
| **Warehouse** `warehouse` | **OD** | **M** | M | **M** | M | P | I | M | I | M | NA | M | NA | M | **M** | **M** |
| **Mobile Location** `mobileLocation` | **OD** | **M** | M | **M** | M | P | I | M | I | M | NA | M | NA | M | **M** | **M** |
| **Truck** `truck` | **OD** | P | P | **M** | M | P | I | M | I | M | NA | M | P | M | **M** | **M** |
| **Purchase Order** `purchaseOrder` | M | **M** | M | **M** | M | P | NA | NA | I | M | P | M | NA | M | **M** | **M** |
| **Reorder PO** `reorderPurchaseOrder` | M | **M** | M | **M** | M | P | NA | NA | I | M | P | M | NA | M | **M** | **M** |
| **Reorder Request** `reorderRequest` | **OD** | PA | PA | **M**† | PA | P | I | M | I | M | NA | M | **PA**† | M | **M** | **M** |
| **Transfer Order** `transferOrder` | M | P | P | **M** | M | P | **NA** | NA | I | M | P | M | NA | M | **M** | **M** |
| **Cycle Count** `cycleCount` | PA | P | P | **M** | M | P | NA | NA | I | M | P | M | NA | M | **M** | **M** |
| **Invoice** `invoice` | M | **M** | M | **M** | M | P | NA | NA | I | M | P | M | NA | M | **M**‡ | **M** |
| **Payment** `payment` | M | **M** | M | **M** | M | P | NA | NA | I | M | P | M | NA | M | **M**‡ | **M** |
| **Report** *(execution)* | **M** | **M** | M | NA | NA | M | M | M | M | P | NA | NA | NA | M | **NA** | **M** |
| **Saved Report Definition** `reportDefinition` | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA |
| **Employee** `employee` | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA |
| **Role Assignment** `roleAssignment` | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA |
| **Approval/Exception** *(no family)* | **M** | **M** | M | M | M | M | M | M | M | M | M | M | M | M | M | M |
| **Inbound Work** *(`inbound_work_requests`)* | **M** | PA | M | **P** | **PA** | M | M | M | M | M | M | M | M | M | **M** | **PA** |

\* **Stage 3 on the person axis is shape-only.** The resolver never reads an Employee document, so a
record owned by a terminated or non-existent employee resolves as `RESOLVED` — see **F-8**. The code
runs correctly; it answers a narrower question than the stage asks, and the census gate reads its
structural zero as a measurement.
† **Actively misleading, not merely absent.** `reorder_requests` shows a field labelled **"Current
owner"** — the raw role-queue token — at `field-ops-app-vite/src/modules/inventory/PartDetail.jsx:1131-1141`,
immediately followed by **"Assigned to"**, while the record's *actual* company owner
(`operatingCompanyId`) is never shown at all. The only ownership-shaped thing a user sees on this
family is the one thing that is not ownership.
‡ One company-shaped report axis exists — Taylor/Ventana columns at
`field-ops-app-vite/src/modules/financials/FinancialsCompanyPerformance.jsx:74-80` — but it is driven by
`invoice.companyId`, **not** by any ownership field, and the code states it is not owner attribution
(`FinancialsCustomerFinancials.jsx:169`, `FinancialsEmployeePerformance.jsx:118`). Reading it as
ownership *would be* the "false scope" stage 15 asks about.

### 7A. Stage 4 / 15 / 16 — what is actually reachable from the product

This was the brief's hardest question and it is now **settled from source** (STATIC READ of JSX and the
report catalog; no emulator needed). It is the single most damaging result in the lane.

**Displayed (4 field families):**

| Field | Render site | Label |
|---|---|---|
| `accounts.accountOwner` | `modules/accounts/AccountDetail.jsx:245→270` (`IdentityLine`), `:588→796`; list column `metadata/definitions/account.js:600` | "Owner" |
| `opportunities.ownerEmployeeId` | `modules/sales/OpportunityDetail.jsx:112-114→272-277`; list `OpportunityList.jsx:538-540`; `SalesWorkspace.jsx:172-178` | "Owner" |
| `sales_orders.ownerEmployeeId` | `modules/sales/SalesOrderDetail.jsx:215-219`; `metadata/definitions/salesOrderPage.js:58` | "Owner" |
| `sales_agreements.ownerEmployeeId` | `modules/sales/SalesAgreementDetail.jsx:238→381` | "Owner" in UI, **"Salesperson"** in metadata (`salesAgreement.js:90-93`) — label drift on the same fact |

All three `ownerEmployeeId` families are returned by their callables
(`opportunityReadService.ts:43,132`; `salesOrderReadService.ts:64,228`; `salesAgreementReadService.ts:63,136`),
so the commercial head of the model is genuinely reachable end-to-end.

**Write-only — stored and never rendered (11 of 13 company fields, plus both person fields on
contact/location):** `fieldops_jobs`, `trucks`, `stock_locations`, `inventory_transactions`
(all three fields), `receiving_orders`, `cycle_counts`, `transfer_orders` (both fields),
`reorder_requests`, `purchase_orders`. Writers exist and are live —
`inventoryLedger/operationalMovementRepository.ts:124-130,246-247`,
`inventoryReceiving/receivingRepository.ts:154-181`, `cycleCount/cycleCountSheetRepository.ts:164`,
`inventoryTransfer/transferOrderRepository.ts:91-108`, `reorderRequest/reorderCommands.ts:190-191` —
and **no component reads any of them, no callable returns any as a displayed fact, and no report
exposes any.** Company responsibility is recorded and then invisible.

**Two INERT display paths** (the lane's vocabulary applies exactly):
- `equipment.operatingCompanyId` — a renderer **exists and is deliberately not called**:
  `field-ops-app-vite/src/domain/equipmentNorthStar.js:151-168` (`installedOperatingCompany()`) has
  **zero callers**, and `modules/equipment/EquipmentDetail.jsx:236-241` states "NO OPERATING-COMPANY ROW (EQ-G5)".
- The frontend mirror of the whole typed-owner model,
  `field-ops-app-vite/src/domain/typedOwner.js` (incl. `deriveAccountOwner:115`, `deriveCompanyOwner:147`),
  has **zero importers** anywhere in `field-ops-app-vite/src`. The client-side ownership resolver is
  shipped and unused — the same defect as F-1, on the other side of the wire.

**`contacts.owner` / `locations.owner` are unreachable, which downgrades stages 2 and 3.** The only
writer is `functions/src/crm/customerRepository.ts:215-244,294-303` (`inheritOwnerFromAccount`) and it
is **Postgres-only**; there is **no `onCall` in `functions/src/crm/`** and no `owner` field in
`metadata/definitions/contact.js` or `location.js`. So the matrix's `ownerFields: ["owner"]`
(`ownershipMatrix.ts:129-144`) describes storage in a **different datastore from the one the census and
Rules operate on** — hence stage 2 downgraded to PA for both.

**Owner-change controls — exactly one exists, and it bypasses the handoff authority:**
- `field-ops-app-vite/src/modules/sales/OwnerSelect.jsx:21` (header: "OWNER REASSIGNMENT control"),
  wired only at `modules/sales/opportunitySections.jsx:92-96` → `services/opportunityCommandClient.js:122,136`
  → `updateOpportunity` (`functions/src/opportunity/opportunityCallables.ts:387`), with a diff recorded
  at `opportunity/opportunityCommands.ts:312-318`. **Real, live, Opportunity-only** → stage 7 = PA.
  It records a field diff but emits **no `OWNERSHIP_HANDOFF`**, so stage 10 stays PA: the *fact* of the
  change is auditable, the *handoff semantics* (from-whom, to-whom, source, reason) are not.
- `sales_agreements` and `sales_orders` display an owner and offer **no way to change it** → 16 = PA.
- **Accounts corroborate F-4 from the UI side.** `assignAccountOwner`
  (`functions/src/crm/customerRepository.ts:182-196`) calls itself *"the ONLY way one is ever set after
  creation"* — and it is **exposed by no callable and called by no UI.** What actually changes an
  Account owner is a **direct client Firestore write of the seven-field map** from
  `modules/accounts/AccountForm.jsx:162-171`, plus a "Clear owner" button at `:465`. The governed path
  is unreachable and the ungoverned path is the product. Stage 7 for `account` is therefore **M, not
  I** — ownership there does not merely lack a handoff, it is changed by a path designed not to be one.
- Zero hits for `changeOwner` / `transferOwnership` in `field-ops-app-vite/src`. Every `reassign` hit is
  technician assignment (`modules/dispatch/Dispatch.jsx:111-150`,
  `modules/dispatcherBoard/PlacementDialog.jsx:33-54`, `hooks/useTruckManagement.js:113-116`).
- `buildOwnershipHandoff` / `stageOwnershipHandoff` have **no callable, no route, no component** —
  confirming §3 from the product side.

**Stage 15 — reporting: one owner dimension, gated off; zero company dimensions.**
- The **only** owner field in the report catalog is `reportCatalog.ts:142` (client mirror
  `field-ops-app-vite/src/domain/reporting/reportCatalog.js:125`):
  `f("customer","accountOwner","Account owner","reference",["filter","group"],...)`. It declares **both
  filter and group** and surfaces in the builder (`domain/reporting/reportBuilderModel.js:33-44` →
  `modules/reporting/ReportBuilder.jsx:428-436`). **But its server field-read permission is
  `active: false`** (`access/permissionCatalog.ts:734-740`, "employee-sensitivity, deferred to wave 4").
  Complete, reachable in the UI, and deniable to every principal → **INERT**, the same shape as F-1.
- The `customer → employee` traversal is catalogued (`reportCatalog.js:189-191`) but unreachable:
  `employee` is `fieldsPopulated: false` (`:69`).
- `contact` and `location` field sets contain **no `owner`** (`reportCatalog.ts:144-160`); `equipment`
  contains **no `operatingCompanyId`** (`:162-175`); **no `operatingCompanyId` /
  `source|destinationOperatingCompanyId` appears anywhere** in `functions/src/reporting/**` or
  `field-ops-app-vite/src/domain/reporting/**`. Opportunity, Sales Order and Sales Agreement are **not
  catalogued objects at all** (`reportCatalog.js:54-70`), so the one ownership field that *is* displayed
  everywhere is not reportable anywhere.
- No callable supports an owner filter — the only `where` in the opportunity read service is
  `accountId` (`opportunityReadService.ts:265`).

**Answer to stage 15 as posed:** responsibility **cannot** be queried today, and the only axis that
looks like it could be (§7 note ‡) would invent false scope if used. → **OD-OWN-009.**

### Stage evidence (why the codes are what they are)

- **Stage 1 CREATION.** Only `opportunity` and `salesOrder` route creation through the governed
  resolver — `opportunityCommands.ts:159`, `salesOrderCommands.ts:261` calling
  `resolveCreationOwner` (LIVE). `salesAgreement` gets company scope (`salesAgreementCommands.ts:304`)
  but **no** owner resolution → PA. `contact`/`location` declare inheritance from the parent Account
  owner (`ownershipMatrix.ts:130,137`) with **no live writer implementing it** → M. The four physical
  roots are **OD**: storage is `OWNERLESS_UNTIL_SUPPLIED` pending Owner root assignment.
- **Stage 2 PERSISTENCE.** EXECUTED `classifyDocument(family, {})` separates the two gap kinds:
  **13 families** return `"family has no ownership storage yet"` (a **MODEL** gap → **M**): `invoice`,
  `payment`, `paymentApplication`, `invoiceAdjustment`, `refund`, `workOrder`, `reorderRequest`,
  `warehouse`, `mobileLocation`, `supplierCompanyTerms`, `inventoryAction`, `purchaseOrder`,
  `reorderPurchaseOrder`. **14 families** name a real field (a **DATA** gap → **P**).
  `ownershipCensus.ts:157-163` is where the distinction is emitted.
- **Stage 3 AUTHORITATIVE READ.** **PA on the person axis — see F-8**, the single most important
  qualifier in this table. EXECUTED — the census classifier resolves all 27 ownable families
  deterministically (`typedOwner.ts:95` `deriveAccountOwner`, `:112` `deriveEmployeeRefOwner`,
  `:131` `deriveCompanyOwner`, `:151` `combineOwnerDerivations`). Where storage is absent the answer
  is a correct `OWNERLESS`, so stage 3 tracks stage 2.
- **Stage 4 DISPLAY / 15 SEARCH / 16 UI-API — settled in §7A.** Also established: the frontend never
  queries `roleAssignments` (all 10 hits are prose), learning authority only through the
  effective-access feed.
- **Stage 5 WORK QUEUE.** The only real queue is Inbound Work,
  `inboundWork/inboundWorkReadService.ts:82-83` — it filters on **`status` only**, with no owner,
  role or company predicate. `reorder_requests.currentOwner` is a role-queue token, not ownership
  (below). **No queue anywhere is keyed on an ownership fact**, so the brief's worry — "a queue keyed
  on a Role nobody holds is empty" — does not arise for ownership: there is no such queue to be empty.
  It *does* arise for capability gating: `service.inboundWork.read` is `active: false`
  (`access/permissionCatalog.ts:1612-1617`), so the Inbound Work callable
  (`inboundWorkCallables.ts:16,50`) **denies every principal** absent a per-environment override →
  stage 16 PA, stage 5 PA.
- **Stage 6 COMMAND AUTHORITY.** §5. `M` = a generic client write can change the ownership fact.
- **Stage 7 HANDOFF.** **I** for all 14 accepted families: EXECUTED-complete builder, zero callers
  (§3, §4). `NA` for IMMUTABLE and PARTICIPATING families — refusal is the designed answer, and
  `transferOrder`'s `FAMILY_PARTICIPATING_COMPANIES` (`ownershipHandoffCommand.ts:101-105`) is
  deliberately a *different* refusal from not-ownable.
- **Stage 8 ACCEPTANCE.** **MISSING everywhere.** `CUSTOMER_HANDOFF_REVIEW` exists only as a source
  *token* (`auditEventWriter.ts:431`). No `acceptedBy`, no acceptance state, no two-sided handoff
  anywhere in `functions/src/ownership/`. Handoff is unilateral by construction.
- **Stage 9 ATOMICITY.** **INERT but architecturally correct.** `stageOwnershipHandoff`
  (`ownershipHandoffCommand.ts:200-206`) stages onto a caller-supplied transaction/batch and never
  commits, so the responsibility change and its audit event *would* be one commit. No caller exists,
  so it is unexercised, not unsound.
- **Stage 10 AUDIT.** `M` where a client-direct write path can change ownership while emitting
  nothing (§5). `PA` for the trusted commercial families: the action and field vocabulary are live
  (`auditEventWriter.ts:256,384-390,429-435`) but **no `functions/src` caller ever passes
  `action: "OWNERSHIP_HANDOFF"`** — the only two occurrences are the inert builder
  (`ownershipHandoffCommand.ts:180`) and a script path (`warehouseRootCompanyAssignment.ts:389`).
  Audit **capacity** is proven; audit **occupancy** for ownership is zero.
- **Stage 11 HISTORICAL.** `P` for the 12 IMMUTABLE families — historical ownership is structurally
  non-transferable, EXECUTED-verified in the builder. **But the guarantee is only as strong as the
  builder, which nothing calls** — F-1 shows the live writer will happily record an invoice handoff.
- **Stage 12 FUTURE.** `P` only along the live commercial chain (Account→Opportunity→Sales
  Order/Agreement), which copies rather than follows — `commercialCompanyScope.ts:21-24`. `M`
  elsewhere: no writer stamps a company at creation for the inventory/service families.
- **Stage 13 ASSIGNMENT SEPARATION.** See §8.
- **Stage 14 ESCALATION.** **MISSING at the MODEL level for every family — see F-9.** No ownership
  escalation exists; the only `escalat*` hits in `functions/src` are unrelated
  (`assistant/assistantContext.ts`, `performance/performanceMetricRegistry.ts`,
  `access/governedBusinessRoles.ts`). Responsibility does not move when work fails, and for a Work
  Order past `Dispatch` the only expressible answer is `Cancel` (`transitionEngine.ts:37,135,137`) —
  cancelling the record of a live customer commitment.

---

## 8. Where assignment and ownership share storage (corruption risk)

| Risk | Where | Why it is a risk |
|---|---|---|
| **Ownership stored *inside* an assignment record** | `accounts.accountOwner` is a **seven-field Person Assignment map** whose ownership-bearing key is **`assignedToEmployeeId`**: `assignedToEmployeeId, assignedToUserId, assignedToDisplayName, assignedByEmployeeId, assignedByUserId, assignedByDisplayName, assignedAt` — written by the UI at `field-ops-app-vite/src/modules/accounts/AccountForm.jsx:162-171`; completeness invariant `domain/commercialProfile.js:206-217`; declared `metadata/definitions/account.js:302-334` ("one of seven fields in the stored Person Assignment map"); projected back out as ownership at `typedOwner.ts:95-108` | The root ownership fact of the whole person chain **is literally stored inside an assignment record** — the vocabulary collapse is at the *storage* level, not just the label. `crm/customerMigrationSource.ts:127-158` compounds it by accepting **two** owner shapes on the same field (`{type,id}` *and* `{assignedToEmployeeId}`). Combined with §5 (no Rules guard) and §7A (the governed setter is unreachable while the client write ships), this is the single highest-value corruption path in the model. |
| **A field literally named `currentOwner` that is not ownership — and it is the only "owner" the user sees** | `reorder_requests.currentOwner = "INVENTORY"` — `reorderCommands.ts:99,198`, returned at `reorderCallables.ts:185`, handed between roles at `domain/inventoryReorderRequests.js:215,235`. Displayed as **"Current owner"** directly above **"Assigned to"** at `modules/inventory/PartDetail.jsx:1131-1141`. The same document also carries `assignedToUserId`/`assignedBy`/`assignedAt` (`metadata/definitions/reorderRequest.js:331`; `firestore.rules:225,257`) | Three responsibility concepts — role queue, user assignment, company ownership — on one document, with the **role queue rendered under the word "owner"** and the **real company owner never rendered at all**. The disclaimers exist (`reorderRequest.js:281`; `domain/typedOwner.js:29`) but sit in code the UI does not consult. Any consumer reading `currentOwner` as the owner is wrong, and the UI actively invites it. → **OD-OWN-006.** |
| **Assignment and company on one client-writable document** | `fieldops_jobs` carries both `technicianId` (assignment) and `operatingCompanyId` (ownership), and the update rule has **no `hasOnly`** — `firestore.rules:382-391` | A technician-assignment edit and a company-ownership edit are indistinguishable at the Rules layer, so the write that legitimately changes *who does the work* can change *which company owns it*. |
| **Correctly separated (the counter-examples)** | `equipment` — `hasOnly(equipmentEditableKeys())` excludes `operatingCompanyId` (`firestore.rules:1543`, `:1396-1401`). `reorder_requests` — `requestedBy` (actor) is explicitly **not** the owner (`reorderCommands.ts:200-202`). The two-axis rule — `ownerEmployeeId` vs `operatingCompanyId` as independent facts on one record — is stated at `commercialCompanyScope.ts:9-12`. | Shows the model *can* hold the distinction; the gaps above are omissions, not design. |

---

## 9. Explicit UNPROVEN list

| # | Claim that cannot be settled here | The exact read that would settle it |
|---|---|---|
| ~~U-1~~ | ~~Stage 4 DISPLAY~~ | **RESOLVED in §7A** — settled by static sweep of `field-ops-app-vite/src`, no emulator needed. |
| ~~U-2~~ | ~~Stage 15 SEARCH/REPORTING~~ | **RESOLVED in §7A** — report catalog read directly. |
| ~~U-3~~ | ~~Stage 16 UI/API reachability~~ | **RESOLVED in §7A.** |
| U-4 | **Current** production governed-role occupancy (the census is 2026-09-02, 11 days stale) | `node functions/scripts/r32ProductionExposureCensus.js --read-only --projectId taylor-parts` (refuses any other project, has no `--apply`; write-freedom enforced by `functions/test/r32ProductionExposureCensus.test.mjs`). Minimal equivalent: `roleAssignments where status=="active"` against `taylor-parts`, intersect each `roleId` with the 45 keys of `GOVERNED_BUSINESS_ROLES`. |
| U-5 | Whether the 2 already-applied `trucks` company writes (F-3) match what the current rules would produce | Read `trucks.operatingCompanyId` for `cert-trk-04`/`cert-trk-05` in sandbox and compare against `BACKFILL_RULES`. **No rule can now produce them** — that is the finding. |
| U-6 | Whether `stock_locations` still holds `operatingCompanyId` values written by the retired-collection cap (F-2) | Read the 5 sandbox / 4 production `stock_locations` docs (`bin-p2-...md:128`) for `operatingCompanyId`. |
| U-7 | Whether any handoff **has ever been recorded** — audit occupancy | `auditEvents where action=="OWNERSHIP_HANDOFF"` per environment. Static analysis proves no `functions/src` emitter exists, so the expected answer is 0; a non-zero result would mean an out-of-band write. |
| U-8 | Whether the residual fixture doc `roleAssignments/migfix-operator-assignment` (non-catalog roleId `migfixCatalog`, written by `functions/scripts/generatePartMasterMigrationEvidence.js:50`, no delete found) still exists | Doc `get` on `roleAssignments/migfix-operator-assignment` per environment. |
| U-9 | All Firestore **Rules behaviour** in §5 — read as source, never executed | `firebase emulators:exec` with a Rules unit test asserting an `admin`/`dispatcher` client `update` that changes only `accounts.accountOwner`. **Blocked here: no JRE, port 8080 held by uvicorn pid 187.** This is the one place my headline claim rests on STATIC READ, and it should be executed before it is relied on. *(Partially corroborated from the other side: `AccountForm.jsx:162-171` is a client-direct write of the owner map that ships in the product and evidently succeeds — §7A.)* |
| U-10 | Sibling-lane citation `docs/assessments/administration-users-consolidation.md:204-209` for `jobTitle` / `managerEmployeeId` (F-7) | Read those lines directly. Accepted here on EMP-ROLE's authority and **not re-verified** — flagged because this lane's standard is to re-derive, and I did not. |
| U-12 | Corpus citation `P3B1-S21-A09` ("None of the four can be reassigned. All four must be cancelled and recreated") backing F-9 | Read that corpus activity directly. Accepted on EMP-ACCOUNTABILITY's authority; **the code half of F-9 I did re-derive** (`transitionEngine.ts:37,135,137`). |
| U-13 | **How many records are person-owned by an employee who no longer exists** — the orphan count F-8 makes the census structurally unable to report | Join `accounts.accountOwner.assignedToEmployeeId` and `{opportunities,sales_agreements,sales_orders}.ownerEmployeeId` against the `employees` collection, per environment. **This is the read the enforcement gate actually needs and does not have.** |
| U-11 | Whether `contacts.owner` / `locations.owner` exist in **Firestore** at all, or only in Postgres | The only writer is Postgres-only (`crm/customerRepository.ts:215-244`) and the backfill caps `contacts: 337` / `locations: 180` (`ownershipBackfillRules.ts:221-222`) imply Firestore documents. Read one `contacts` doc per environment for an `owner` field. **This matters:** if the field is Postgres-only, the two largest backfill caps in the authorized total target a field that does not exist where the applier writes. |

---

## 10. Families that can become responsibility-orphaned

An orphan = no principal or company is identifiably responsible, and nothing in the product will flag it.

| Family | Orphaning mechanism |
|---|---|
| `account` | Storage exists but `unresolvedPolicy` is *"remains OWNERLESS until an owner is explicitly assigned"* (`ownershipMatrix.ts:123`). Creation does not route through the resolver, and §5 lets a dispatcher clear the field. **Orphaning an Account cascades:** `ownershipMatrix.ts:124` — an ownerless Account makes inherited Opportunity creation REFUSE. |
| `contact`, `location` | Inheritance declared (`:130`,`:137`); the only writer is **Postgres-only** with no callable and no UI field (§7A); created ownerless by default in Firestore; field unguarded there (§5). Orphaned in the datastore the census and Rules actually read. |
| `workOrder` (`fieldops_wos`) | **No storage at all** — `ownerFields: []` (`:249`). Permanently orphaned by construction: 0 of 30 sandbox records carry any company. |
| `warehouse`, `mobileLocation` | No storage; `OWNERLESS_UNTIL_SUPPLIED`; 12 Owner root decisions outstanding (`:300-303`). Their orphanhood **propagates** to every location-derived family and blocks the live reorder path (§6). |
| `invoice`, `payment`, `paymentApplication`, `invoiceAdjustment`, `refund` | No storage (`ownerFields: []`), and `IMMUTABLE` — so ownership can never be *added* through a handoff either. Orphaned and unfixable by the handoff authority. |
| `purchaseOrder`, `reorderPurchaseOrder`, `inventoryAction`, `supplierCompanyTerms` | No storage; company derivable only *once D-9 is populated*, which it is not. |
| `reorderRequest` | Matrix says no storage; the live writer does stamp one (§6) but refuses universally, so in practice no record is created at all. |
| `transferOrder` | `participatingFields` declared, `transfer: N_A`, and the handoff authority **deliberately refuses** it. If its pair is wrong, ownership has **no** correction path — only a transfer-domain correction that does not exist yet. |
| **Inbound Work** (`inbound_work_requests`) | **Not in the ownership matrix at all.** Live collection (`constants/collections.ts:130`), live queue (`inboundWorkReadService.ts:82`), stamps `operatingCompanyId` (`inboundIntakeCommand.ts:279`) — governed by nothing, censused by nothing, with a status-only queue. Ungoverned *and* unmeasured. |
| **Approval/Exception** | No family, no collection located. If approvals exist as a business concept, they are entirely outside the model. → **OD-OWN-007.** |
| **Report** (execution) | No family. Report *definitions* are `EXCLUDED`; report *executions* are audited (`REPORT_AUDIT_ACTIONS`, `auditEventWriter.ts:292`) but have no owner. |

## 11. Families with an ownership model but no live handoff

**All 14** families `buildOwnershipHandoff` accepts have a declared, EXECUTED-validated ownership model
and **no route to the governed handoff authority** (§3: no `functions/src` importer; §7A: no callable,
no route, no component). But they are not uniform — there are three distinct failure shapes, and the
distinction is the point of this lane:

| Shape | Families | What it means |
|---|---|---|
| **INERT** — model exists, nothing can change the owner at all | `contact`, `location`, `workOrder`, `reorderRequest`, `warehouse`, `mobileLocation`, `truck`, `supplierCompanyTerms`, `equipment` (9) | Safe but dead. No handoff, and no other mutation path either. |
| **UNGOVERNED CHANGE PATH** — owner *is* changeable, by a path that is not a handoff and emits no handoff audit | `account`, `contact`, `location`, `workOrderLegacy` (4, via §5 Rules) — and `account` most acutely, since the client write ships in `AccountForm.jsx:162-171` while the governed setter `assignAccountOwner` is unreachable (§7A) | **Worse than absent.** Model + no handoff + unguarded mutation = an audit trail that cannot be reconstructed. |
| **PARTIAL, BYPASSING** — a real, live, shipped owner-change control that routes around the handoff authority | `opportunity` only — `OwnerSelect.jsx:21` → `updateOpportunity` (`opportunityCallables.ts:387`), diff recorded at `opportunityCommands.ts:312-318` | The *fact* of the change is auditable as a field diff; the *handoff semantics* — from whom, to whom, under which of the three `OWNERSHIP_HANDOFF_SOURCES`, and why — are not captured. The one place ownership genuinely moves in production is the one place the handoff vocabulary is not used. |

`salesAgreement` and `salesOrder` sit between the first two: owner displayed, no change control at all
(stage 16 = PA), and the collections are `if false` to clients — so they are INERT by Rules rather than
by omission, which is the better of the two failure modes.

## 12. INERT vs MISSING vs LIVE — the split

| | Count | Families / modules |
|---|---|---|
| **LIVE** (invoked from an `index.ts` export chain) | **4 modules** | `operatingCompanyAuthority`, `typedOwner`, `creationOwnerResolution`, `commercialCompanyScope` |
| **INERT** (complete code, zero invocation) — backend | **8 modules** | `ownershipMatrix`, `ownershipHandoffCommand`, `ownershipCensus`, `ownershipDerivation`, `ownershipBackfillRules`, `warehouseCanonicalIdRepair`, `warehouseRootCompanyAssignment`, `reorderRequestLocationAuthority` |
| **INERT** — frontend (new in §7A) | **2 modules + 1 catalog field + 1 capability** | `field-ops-app-vite/src/domain/typedOwner.js` (zero importers); `domain/equipmentNorthStar.js:151-168` `installedOperatingCompany()` (zero callers); the `accountOwner` report dimension (`reportCatalog.ts:142`, permission `active:false` at `permissionCatalog.ts:734-740`); `service.inboundWork.read` (`active:false`, `permissionCatalog.ts:1612-1617`) |
| **INERT** — vocabulary values (F-7) | 5 of 8 `OPERATIONAL_ROLE_VALUES` | Declared at `employeeProfileCommands.ts:336`; only `PARTS_MANAGER`, `WAREHOUSE_MANAGER`, `TECHNICIAN` have a consumer in `firestore.rules` |
| **INERT stages** | 7 (HANDOFF) ×9 families, 9 (ATOMICITY) ×all ownable, 4 (DISPLAY) ×1, 15 ×1 | Code proven correct by execution; no caller |
| **WRITE-ONLY** (stored, live writer, never read back anywhere) | **11 of 13** company fields + 2 person fields | §7A — the largest single category in the model |
| **MISSING — model gap** (no storage exists) | **13 of 27** ownable families | §7 stage 2 |
| **MISSING — no code at all** | stage 8 ACCEPTANCE, stage 14 ESCALATION (every family); the **Approval/Exception**, **Report-execution** and **Inbound Work** families | §7 |
| **MISSING — command authority** | 4 collections | §5 |
| **OWNER DECISION** | 12 physical-root company assignments | `ownershipMatrix.ts:300-303` |

**The lane's summary judgement.** Ownership at this baseline is a **well-built descriptive model with a
live commercial head and an inert body.** The commercial chain
(Account→Opportunity→Sales Agreement/Order) genuinely resolves ownership at creation through live code
and **displays it end-to-end** — that part works. Everything else does not:

1. **Creation is live for 2 of 27 ownable families** (`opportunity`, `salesOrder`).
2. **13 of 27 have no storage at all** — a MODEL gap, not a data gap.
3. **11 of 13 stored company fields are write-only** — recorded by live writers, rendered nowhere, reportable nowhere (§7A). Company responsibility is captured and then invisible.
4. **Handoff is inert for every family**, and the one place ownership actually moves in the product (`opportunity`) routes around the handoff authority (§11).
4b. **The person axis has no referential integrity (F-8)** — a record owned by a terminated employee censuses as RESOLVED, so the census cannot evidence that person ownership resolves at all.
4c. **Escalation is MISSING at the model level (F-9)** — past `Dispatch` the only expressible answer to an unavailable technician is to cancel a live customer commitment.
5. **Acceptance and escalation do not exist for any family.**
6. **Responsibility cannot be queried at all**; the one axis that looks like it could be would invent false scope (§7A ‡).

And in four places the inertness is not merely incomplete but **unsafe**:

- **F-1** — every family-level safety refusal sits in the uncalled module; the called audit writer has none, and EXECUTED accepts a handoff of an invoice, a part, an audit event, or a nonexistent family.
- **F-4/§7A** — the ownership root is client-writable with no audit, the governed setter that calls itself *"the ONLY way"* is unreachable, and the ungoverned client write is what ships.
- **F-2** — a backfill cap still authorizes writes to a retired collection.
- **F-3** — the authorized total (1013) does not match what was applied (1015).

`ownershipMatrix.ts` is **DESCRIPTIVE of existing storage**, exactly as the brief said — and **38 of its
51 rows describe storage that does not exist.** The lane's rule holds all the way down: twelve
typechecking modules, 1,013 authorized writes and a 51-row matrix are **not** an end-to-end ownership
lifecycle, and at this baseline no family completes one.

---

## 13. Owner decisions

| # | Decision required |
|---|---|
| **OD-OWN-001** | Where must family-level handoff validation live? All five refusals (`FAMILY_UNKNOWN`, `FAMILY_IMMUTABLE`, `FAMILY_NOT_OWNABLE`, `FAMILY_PARTICIPATING_COMPANIES`, `OWNER_TYPE_MISMATCH`) exist only in the uncalled `ownershipHandoffCommand`; the live `auditEventWriter` accepts an `OWNERSHIP_HANDOFF` for an invoice, a part, an audit event, or a nonexistent family (EXECUTED, §4). Should `auditEventWriter` consult `ownershipMatrix` directly, or must `OWNERSHIP_HANDOFF` be rejected there unless staged through the builder? |
| **OD-OWN-002** | `accounts.accountOwner`, `contacts.owner`, `locations.owner` and `fieldops_jobs.operatingCompanyId` are rewritable by any `admin` **or** `dispatcher` via a generic client write, unguarded and unaudited (§5). Accept this interim exposure, or narrow the Rules now? Note production's only principal holds exactly the `admin` role this depends on. |
| **OD-OWN-003** | The live reorder path refuses **every** request until the physical-root companies are supplied (§6). Ship refusing, or gate the feature until the 12 root decisions land? |
| **OD-OWN-004** | `AUTHORIZED_TOTAL` is **1013** but the header authorizes **1,015** and the applier already wrote **1015/1015** (F-3). Two applied writes have no reproducing rule and no cap. Re-authorize 1013, restore a `trucks` rule, or record the 2 as an accepted exception? |
| **OD-OWN-005** | `ownershipBackfillRules.ts:99` + `:228` still authorize 5 `operatingCompanyId` writes to the **retired** `stock_locations` (F-2). Remove rule and cap, or keep? |
| **OD-OWN-006** | `reorder_requests.currentOwner` holds a role-queue token, not an owner, and is exposed through the API (`reorderCallables.ts:185`). Rename, or accept the collision with the domain's central term? |
| **OD-OWN-007** | Are **Approval/Exception**, **Report execution** and **Inbound Work** governed object families? All three are absent from the matrix; Inbound Work is a live collection with a live queue and a stamped company, governed by nothing. |
| **OD-OWN-008** | Is there an accountable-person hierarchy for responsibility to escalate *to*? Stage 14 is MISSING for all 24 families; if `managerEmployeeId` (F-7) is the only candidate, escalation cannot be designed until its status is settled. |
| **OD-OWN-009** | **11 of 13 stored company fields are write-only** and responsibility is unqueryable (§7A). Is company ownership intended to be a user-visible fact, or an internal scoping key only? The answer determines whether §7A is a UI backlog or a correct design — and it must be answered before the census gate, because a fact nobody can see cannot be verified by the people accountable for it. |
| **OD-OWN-010** | `accounts.accountOwner` is stored inside a seven-field **Person Assignment** map (§8) and two owner shapes are accepted on it (`crm/customerMigrationSource.ts:127-158`). Ratify the assignment-shaped storage, or normalise ownership to a typed owner distinct from assignment? |
| **OD-OWN-012** | **ACCOUNTABLE PERSON** and **ESCALATION OWNER** have no representation in the model; MANAGER has two unreconciled authorities; the Owner's worked example names five roles and EOS can express two (F-9). Stages 8 and 14 are therefore MISSING at the model level for all 24 families. Are these concepts in scope, and is `Cancel` an acceptable escalation answer for a dispatched Work Order in the interim? |
| **OD-OWN-013** | **Does the person axis need referential integrity before the census gates enforcement?** (F-8) Ruling O-1 deliberately excluded the Employee lookup, so the census reports a structural zero for person orphans. Either the gate must stop treating person resolution as measured, or O-1 must be revisited. This decision blocks the gate either way. |
| **OD-OWN-011** | `contacts.owner` / `locations.owner` are written **only in Postgres** with no callable and no UI (§7A, U-11), yet they carry the two largest backfill caps (337 + 180 = **51% of the authorized total**). Confirm the applier's target datastore before any backfill runs. |

---

*Lane-local evidence document. Canonical artifacts are written only by EMP-OWN-SYNTHESIZER.*
