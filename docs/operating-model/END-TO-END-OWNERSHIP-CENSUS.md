---
artifact_type: operating-model-canonical
lane: EMP-OWN-SYNTHESIZER
baseline: 64008d5ae0bdd9532909671b15a91122400accf1
date: 2026-09-13
implementation_status: NOT AUTHORIZED
---

# END-TO-END OWNERSHIP CENSUS

**OBSERVED AT: 64008d5a.** Integrated from **OWN-E2E** (primary — the only lane with EXECUTED
evidence), **OWN-DESIGN** §4.5 and §5, **EMP-ACCOUNTABILITY** §7.

> **THE RULE THIS DOCUMENT HOLDS (OWN-E2E's lane rule, adopted verbatim):** *"Helper modules existing ≠
> end-to-end ownership complete. Nothing in this document treats the existence of a module as the
> completion of a stage. Ownership handoff was AUDITED, NOT ACTIVATED."*

**Reliability order used throughout: EXECUTED > SOURCE+CONFIG RECONCILED > STATIC READ.** Every verdict
names its method. **Comments are not evidence** — this programme has already corrected ~80 false
comments across 44 files, and OWN-E2E found two fresh instances **in its own scope** and reported them
as findings, not facts.

---

## 1. Method provenance — what "EXECUTED" means here

| Method | How (OWN-E2E §0) |
|---|---|
| **EXECUTED** | Node 22.23.2 `--experimental-strip-types` plus a custom `resolve` loader hook mapping extensionless **and** `.js`-suffixed specifiers onto the shipped `.ts` files. **The shipped modules were RUN, not parsed** |
| **RECONCILED** | `npx tsc --noEmit -p functions/tsconfig.json` → **exit 0, 0 errors.** All 12 ownership modules typecheck at this baseline |
| **STATIC READ** | `grep`/`sed` over source and `firestore.rules`, cited `file:line`. **Used only where execution is impossible** (Rules language, JSX) |

**Integrity conditions OWN-E2E recorded and this synthesis carries because they bound the evidence:**
`functions/node_modules` is absent at this baseline and was **borrowed by symlink from an idle sibling
worktree, verified dependency-identical** (`package-lock.json` md5 byte-identical), **link removed after
each run, lender verified intact afterwards.** **No production contact, no deploy, no Firestore read or
write.** The one Firebase call was `initializeApp({ projectId: "demo-own-e2e-probe" })` — a local object
graph with **no credentials and no network** — used so audit-writer validation could be reached with a
**fake in-memory writer**. **Nothing was committed; the probe counted staged objects in an array.**
**The emulator could not run** (no JRE; port 8080 held by an unrelated process), so emulator-dependent
claims are marked UNPROVEN with the exact read that would settle each.

---

## 2. The 16-stage lifecycle × family matrix

Codes: **P** PROVEN · **PA** PARTIAL · **M** MISSING · **I** INERT (code exists, nothing invokes it) ·
**NA** NOT APPLICABLE · **OD** OWNER DECISION REQUIRED.
Stages: 1 CREATION · 2 PERSISTENCE · 3 AUTHORITATIVE READ · 4 DISPLAY · 5 WORK QUEUE ·
6 COMMAND AUTHORITY · 7 HANDOFF · 8 ACCEPTANCE · 9 ATOMICITY · 10 AUDIT · 11 HISTORICAL · 12 FUTURE ·
13 ASSIGNMENT SEPARATION · 14 ESCALATION · 15 SEARCH/REPORTING · 16 UI/API REACHABILITY.

| Family (matrix key) | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Account** | PA | P | PA\* | P | M | **M** | **M** | M | I | **M** | PA | P | PA | M | I | P |
| **Contact** | M | PA | PA\* | M | M | **M** | I | M | I | **M** | NA | NA | P | M | M | M |
| **Location** | M | PA | PA\* | M | M | **M** | I | M | I | **M** | NA | NA | P | M | M | M |
| **Opportunity** | **P** | P | PA\* | **P** | M | P | **PA** | M | I | PA | PA | P | P | M | M | **P** |
| **Sales Agreement** | PA | P | PA\* | **P** | M | P | I | M | I | PA | PA | P | P | M | M | PA |
| **Sales Order** | **P** | P | PA\* | **P** | M | P | I | M | I | PA | PA | P | P | M | M | PA |
| **Work Order** (`fieldops_wos`) | M | **M** | M | NA | M | P | I | M | I | M | NA | M | NA | M | M | M |
| **Service Visit/Job** (`fieldops_jobs`) | M | P | P | M | M | **M** | I | M | I | **M** | NA | M | PA | M | M | M |
| **Equipment** | M | P | P | **I** | M | P | I | M | I | M | NA | M | P | M | M | **I** |
| **Part** (+ 6 REFERENCE) | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA |
| **Warehouse** | **OD** | **M** | M | M | M | P | I | M | I | M | NA | M | NA | M | M | M |
| **Mobile Location** | **OD** | **M** | M | M | M | P | I | M | I | M | NA | M | NA | M | M | M |
| **Truck** | **OD** | P | P | M | M | P | I | M | I | M | NA | M | P | M | M | M |
| **Purchase Order** | M | **M** | M | M | M | P | NA | NA | I | M | P | M | NA | M | M | M |
| **Reorder PO** | M | **M** | M | M | M | P | NA | NA | I | M | P | M | NA | M | M | M |
| **Reorder Request** | **OD** | PA | PA | M† | PA | P | I | M | I | M | NA | M | PA† | M | M | M |
| **Transfer Order** | M | P | P | M | M | P | **NA** | NA | I | M | P | M | NA | M | M | M |
| **Cycle Count** | PA | P | P | M | M | P | NA | NA | I | M | P | M | NA | M | M | M |
| **Invoice** | M | **M** | M | M | M | P | NA | NA | I | M | P | M | NA | M | M‡ | M |
| **Payment** | M | **M** | M | M | M | P | NA | NA | I | M | P | M | NA | M | M‡ | M |
| **Report** *(execution)* | **M** | **M** | M | NA | NA | M | M | M | M | P | NA | NA | NA | M | NA | M |
| **Saved Report Definition** | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA |
| **Employee** / **Role Assignment** | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA |
| **Approval/Exception** *(no family)* | **M** | **M** | M | M | M | M | M | M | M | M | M | M | M | M | M | M |
| **Inbound Work** (`inbound_work_requests`) | **M** | PA | M | **P** | **PA** | M | M | M | M | M | M | M | M | M | M | PA |

**\* Stage 3 on the person axis is SHAPE-ONLY.** The resolver **never reads an Employee document**, so
a record owned by a terminated or non-existent employee resolves as `RESOLVED` — see §3. **The code runs
correctly; it answers a NARROWER question than the stage asks, and the census gate reads its structural
zero as a measurement.**

**† ACTIVELY MISLEADING, not merely absent.** `reorder_requests` shows a field labelled **"Current
owner"** — the raw role-queue token — at `PartDetail.jsx:1131-1141`, **immediately followed by "Assigned
to"**, while the record's actual company owner (`operatingCompanyId`) is **never shown at all.**
**The only ownership-shaped thing a user sees on this family is the one thing that is not ownership.**

**‡ One company-shaped report axis exists** — Taylor/Ventana columns at
`FinancialsCompanyPerformance.jsx:74-80` — **but it is driven by `invoice.companyId`, NOT by any
ownership field**, and the code states it is not owner attribution. **Reading it as ownership WOULD BE
the "false scope" stage 15 asks about.**

### 2.1 The axis split — the shape a per-family verdict hides

| Stage | **PERSON axis** (6 families) | **COMPANY axis** (20 families) |
|---|---|---|
| 1 CREATION | **PA** — governed resolver live for **2 of 6** (`opportunityCommands.ts:159`, `salesOrderCommands.ts:261`); refusal-on-unresolved is correct | **M/OD** — no writer stamps a company for most; **12 root decisions outstanding** |
| 2 PERSISTENCE | **PA** — 4 of 6 in Firestore; **`contact`/`location` POSTGRES-ONLY** | **PA** — **7 of 20** have a real field; **13 have none** |
| 3 AUTHORITATIVE READ | **PA — shape-only, no referential integrity** | **PA — existence checked, active-status not** |
| 4 DISPLAY | **P** — 4 of 6 displayed and name-resolved | **M** — **11 of 13 stored fields never rendered** |
| 6 COMMAND AUTHORITY | **M for 3 of 6** — unguarded client write | **P** — mostly `if false` or `hasOnly`-guarded |
| 7 HANDOFF | **PA** — one live control (opportunity), **bypassing the authority** | **I** — no path at all |
| 10 AUDIT | **PA** — field diffs only, **no handoff semantics** | **M** |
| 15 SEARCH | **I** — one dimension, permission `active:false` | **M** — **zero dimensions** |

> **THE PERSON AXIS IS REACHABLE BUT NOT TRUSTWORTHY; THE COMPANY AXIS IS TRUSTWORTHY BUT NOT
> REACHABLE. Neither completes a lifecycle, and they fail at OPPOSITE ENDS — which is why a per-family
> verdict alone hides the shape of the problem.** (OWN-E2E F-8)

---

## 3. The stage evidence that changes what the census can be used for

### 3.1 Stage 3 — the person axis has no referential integrity (EXECUTED)

`deriveEmployeeRefOwner` and `deriveAccountOwner` end at `typedOwner(OWNER_TYPES.USER, value)`, which is
`isTypedOwner` — **a pure shape check.** **Neither ever reads an Employee document.**
`deriveCompanyOwner` instead calls `resolveOperatingCompany(value)` and distinguishes `INVALID` from
`UNKNOWN` from `INACTIVE`.

**EXECUTED PROOF, from Probe A:** the first run **accepted** `USER:EMP-OLD → USER:EMP-NEW` — arbitrary
strings naming no employee — **while REFUSING arbitrary COMPANY ids with `NEW_OWNER_INVALID`** until the
governed `taylor`/`ventana` were substituted. **The asymmetry is not inferred from reading; it is what
the shipped code did when run.**

> **CONSEQUENCE: a record owned by a TERMINATED, DELETED or NEVER-EXISTENT employee censuses as
> `RESOLVED`. The census that gates enforcement is STRUCTURALLY BLIND to person-level orphans, so THE
> EXISTING CENSUS CANNOT BE USED AS EVIDENCE THAT PERSON OWNERSHIP RESOLVES — only that a non-empty
> string is present.**

**The census's shape-valid counts must therefore be read as shape-valid, never referentially valid:**
100/103 accounts, 337/339 contacts, 180/183 locations, 14/14 opportunities, 5/5 agreements, 17/17 sales
orders. (OWN-DESIGN §3.4, OD-OWN-017)

**And two precisions:** the blindness is **deliberate and documented** (Owner ruling O-1 excludes *"a
fallible cross-collection lookup"*; a USER family's `UNKNOWN` count is *"structurally zero, not merely
empty"*) — **the defect is that the census reports that structural zero AS IF IT WERE A MEASUREMENT.**
And the COMPANY axis has **existence integrity but not active-status integrity** (an `INACTIVE` company
resolves `RESOLVED` by design, *"a record owned by a since-deactivated company still HAS an owner"*).

**The read the enforcement gate actually needs and does not have (OWN-E2E U-13):** join
`accounts.accountOwner.assignedToEmployeeId` and `{opportunities,sales_agreements,sales_orders}.ownerEmployeeId`
against the `employees` collection, per environment. → `OD-6`

### 3.2 Stage 2 — 13 MODEL gaps vs 14 DATA gaps (EXECUTED)

`classifyDocument(family, {})` separates the two kinds. **13 families return *"family has no ownership
storage yet"* (a MODEL gap):** `invoice`, `payment`, `paymentApplication`, `invoiceAdjustment`,
`refund`, `workOrder`, `reorderRequest`, `warehouse`, `mobileLocation`, `supplierCompanyTerms`,
`inventoryAction`, `purchaseOrder`, `reorderPurchaseOrder`. **14 families name a real field (a DATA
gap).**

**Note the tension with conflict O-1 and O-7:** `reorderRequest` is in the MODEL-gap list **because the
matrix says `ownerFields: []`** while the live writer stamps a company; and `invoice`/`payment` are in it
**because the matrix is factually wrong** about `companyId`. **So the census's own MODEL/DATA split
inherits two of the matrix's stale descriptions.**

### 3.3 Stage 7 — handoff (EXECUTED, Probe A)

`buildOwnershipHandoff` **accepts 14 / refuses 37**, with the refusals **correct and correctly
DIFFERENTIATED**: `FAMILY_IMMUTABLE` ×12, `FAMILY_NOT_OWNABLE` ×24,
`FAMILY_PARTICIPATING_COMPANIES` ×1. **The builder is not a stub.** **This synthesis independently
re-derived the 14 from the matrix source** (12 literal + 2 from the spread block at
`ownershipMatrix.ts:311-325`), closing conflict **E-10**.

### 3.4 Stage 9 — INERT but architecturally correct

`stageOwnershipHandoff` stages onto a **caller-supplied transaction/batch and never commits**, so the
responsibility change and its audit event *would* be one commit. **No caller exists, so it is
unexercised, not unsound.**

### 3.5 Stage 10 — audit CAPACITY is proven; audit OCCUPANCY for ownership is ZERO

The action and field vocabulary are live (`auditEventWriter.ts:256,384-390,429-435`, three
`OWNERSHIP_HANDOFF_SOURCES`) but **no `functions/src` caller ever passes `action:
"OWNERSHIP_HANDOFF"`** — the only two occurrences are the inert builder and a script path.

### 3.6 Stage 8 and stage 14 — MISSING AT THE MODEL LEVEL FOR EVERY FAMILY

**Stage 8 ACCEPTANCE.** `CUSTOMER_HANDOFF_REVIEW` exists only as a source **token**. **No `acceptedBy`,
no acceptance state, no two-sided handoff anywhere in `functions/src/ownership/`. Handoff is unilateral
by construction.**

**Stage 14 ESCALATION.** Re-verified and **broader than first reported** — `transitionEngine.ts:37`:
*"committed, so DISPATCHED / ACCEPTED / EN_ROUTE / ARRIVED / WORK_IN_PROGRESS have no way back."*
**That is FIVE terminal-ish states, not two.** Past `Dispatch` a Work Order's only exits are the next
technician-gated step (`requiresOwnAssignment`) or `Cancel`.

> **EOS's ONLY EXPRESSIBLE ANSWER TO AN UNAVAILABLE TECHNICIAN IS TO CANCEL THE RECORD OF A LIVE
> CUSTOMER COMMITMENT. Stage 14 is therefore MISSING AT THE MODEL LEVEL, not merely unimplemented —
> there is no representation for responsibility moving when work fails, and the workaround DESTROYS
> the commercial record.** (OWN-E2E F-9; corpus `P3B1-S21-A09`: *"None of the four can be reassigned.
> All four must be cancelled and recreated."*)

**Compounding, and it is the operational cost:** the double-booking guard refuses to dispatch a
technician *"actively assigned to another Work Order"*, so **an orphaned Work Order PERMANENTLY CONSUMES
its technician's dispatch capacity** — *"It blocks dispatch to a technician who no longer exists."*

---

## 4. Stage 4 / 15 / 16 — WHAT IS ACTUALLY REACHABLE FROM THE PRODUCT

**Settled from source (STATIC READ of JSX and the report catalog; no emulator needed). OWN-E2E calls
this "the single most damaging result in the lane."** (§7A)

### 4.1 Displayed — 4 field families

| Field | Render site | Label |
|---|---|---|
| `accounts.accountOwner` | `AccountDetail.jsx:245→270` (`IdentityLine`), `:588→796`; list column `metadata/definitions/account.js:600` | "Owner" |
| `opportunities.ownerEmployeeId` | `OpportunityDetail.jsx:112-114→272-277`; `OpportunityList.jsx:538-540`; `SalesWorkspace.jsx:172-178` | "Owner" |
| `sales_orders.ownerEmployeeId` | `SalesOrderDetail.jsx:215-219`; `metadata/definitions/salesOrderPage.js:58` | "Owner" |
| `sales_agreements.ownerEmployeeId` | `SalesAgreementDetail.jsx:238→381` | **"Owner" in UI, "Salesperson" in metadata — LABEL DRIFT on the same fact** |

All three `ownerEmployeeId` families are returned by their callables, **so the commercial head of the
model is genuinely reachable end-to-end. That part works.**

### 4.2 WRITE-ONLY — stored, live writer, never rendered anywhere

**11 of 13 company fields, plus both person fields on contact/location** (OWN-E2E; count contested —
conflict **E-4**): `fieldops_jobs`, `trucks`, `stock_locations`, `inventory_transactions` (all three
fields), `receiving_orders`, `cycle_counts`, `transfer_orders` (both fields), `reorder_requests`,
`purchase_orders`. **Writers exist and are LIVE** —
`operationalMovementRepository.ts:124-130,246-247`, `receivingRepository.ts:154-181`,
`cycleCountSheetRepository.ts:164`, `transferOrderRepository.ts:91-108`, `reorderCommands.ts:190-191`
— **and no component reads any of them, no callable returns any as a displayed fact, and no report
exposes any.**

> **COMPANY RESPONSIBILITY IS RECORDED AND THEN INVISIBLE.** *"A fact nobody can see cannot be verified
> by the people accountable for it"* — which is why `OD-10` **must be answered before the census
> gate**, not after.

**OWN-DESIGN's divergence is recorded and stands** (conflict **E-4**): it counts 24 frontend files
reading a company field, finds the **financial pair IS rendered and reportable**, inbound work's company
reaches two workspaces, and equipment's is read **and reported as UNKNOWN**. **The DISTINCTION is
adopted by both lanes; the DENOMINATOR is contested; the renderability criterion was never stated and
that is the actual unresolved item.**

### 4.3 Two INERT display paths — the lane's vocabulary applies exactly

- **`equipment.operatingCompanyId`** — a renderer **exists and is deliberately not called**:
  `domain/equipmentNorthStar.js:151-168` (`installedOperatingCompany()`) has **zero callers**, and
  `EquipmentDetail.jsx:236-241` states *"NO OPERATING-COMPANY ROW (EQ-G5)"*.
- **The frontend mirror of the whole typed-owner model** — `domain/typedOwner.js` (incl.
  `deriveAccountOwner`, `deriveCompanyOwner`) has **zero importers anywhere in `field-ops-app-vite/src`.
  The client-side ownership resolver is shipped and unused — the same defect as F-1, on the other side
  of the wire.**

### 4.4 `contacts.owner` / `locations.owner` are unreachable — and it downgrades stages 2 and 3

**The only writer is `crm/customerRepository.ts:215-244,294-303` (`inheritOwnerFromAccount`) and it is
POSTGRES-ONLY**; there is **no `onCall` in `functions/src/crm/`** and **no `owner` field in
`metadata/definitions/contact.js` or `location.js`.**

> **So the matrix's `ownerFields: ["owner"]` describes storage in a DIFFERENT DATASTORE from the one the
> census and Rules operate on.** (conflict **EG-C2**)

**AND THIS RAISES A LIVE RISK (U-11): the two largest backfill caps in the authorized total —
`contacts: 337` + `locations: 180` = 517, **51% of 1013** — may target a field that does not exist where
the applier writes. *"Confirm the applier's target datastore before any backfill runs."* This is the
highest-consequence UNPROVEN in the corpus.**

### 4.5 Owner-change controls — exactly ONE exists, and it bypasses the authority

- **`OwnerSelect.jsx:21`** (header: *"OWNER REASSIGNMENT control"*) → `opportunitySections.jsx:92-96` →
  `opportunityCommandClient.js:122,136` → `updateOpportunity` → diff at `opportunityCommands.ts:312-318`.
  **Real, live, Opportunity-only** → stage 7 = PA. **It records a field diff but emits NO
  `OWNERSHIP_HANDOFF`**, so stage 10 stays PA: **the FACT of the change is auditable; the HANDOFF
  SEMANTICS (from whom, to whom, under which source, and why) are not.**
- `sales_agreements` and `sales_orders` **display an owner and offer no way to change it** → 16 = PA.
- **Accounts corroborate the exposure from the UI side.** `assignAccountOwner` calls itself *"the ONLY
  way one is ever set after creation"* — **and it is exposed by no callable and called by no UI.** What
  actually changes an Account owner is a **direct client Firestore write of the seven-field map** from
  `AccountForm.jsx:162-171`, plus a **"Clear owner" button at `:465`. The governed path is unreachable
  and the ungoverned path is the product.** Stage 7 for `account` is therefore **M, not I** — ownership
  there does not merely lack a handoff, **it is changed by a path designed not to be one.**
- **Zero hits for `changeOwner` / `transferOwnership` in `field-ops-app-vite/src`.** Every `reassign` hit
  is **technician assignment**.
- **`buildOwnershipHandoff` / `stageOwnershipHandoff` have no callable, no route, no component.**

### 4.6 Stage 15 — reporting: ONE owner dimension, gated off; ZERO company dimensions

- The **only** owner field in the report catalog is `reportCatalog.ts:142` —
  `f("customer","accountOwner","Account owner","reference",["filter","group"],…)`. It declares **both
  filter and group** and **surfaces in the builder. But its server field-read permission is
  `active: false`** (*"employee-sensitivity, deferred to wave 4"*). **Complete, reachable in the UI, and
  deniable to every principal → INERT, the same shape as F-1.**
- The `customer → employee` traversal is catalogued **and unreachable**: `employee` is
  `fieldsPopulated: false`.
- `contact` and `location` field sets contain **no `owner`**; `equipment` contains **no
  `operatingCompanyId`**; **no `operatingCompanyId` / `source|destinationOperatingCompanyId` appears
  anywhere** in `functions/src/reporting/**` or the client reporting domain.
- **Opportunity, Sales Order and Sales Agreement are NOT CATALOGUED OBJECTS AT ALL** — so **the one
  ownership field that IS displayed everywhere is not reportable anywhere.**
- **No callable supports an owner filter** — the only `where` in the opportunity read service is
  `accountId`.

> **ANSWER TO STAGE 15 AS POSED: RESPONSIBILITY CANNOT BE QUERIED TODAY, and the only axis that looks
> like it could be would INVENT FALSE SCOPE if used.**

**And the ownership model's one hard refusal is unreportable (OWN-E2E EG-10):** an ownerless Account
makes Opportunity creation REFUSE **by design**, yet **no report can list ownerless Accounts** —
`report.customer.field.accountOwner.read` is *"deferred to wave 4 despite sitting in the wave-1 object
table."* **The field the whole PERSON chain hangs off cannot be read by any report.**

---

## 5. RUNTIME WIRING — the LIVE / INERT / MISSING split

`functions/src/ownership/` has **no barrel, no `export *`, and no dynamic `import()`** in
`functions/src`, so the static import graph is complete. **`functions/src/index.ts` contains ZERO
occurrences of `ownership`** — every module reaches runtime only transitively.

| Module | Wiring verdict |
|---|---|
| `operatingCompanyAuthority.ts` | **LIVE** (12+ src importers, several reaching `index.ts`) |
| `typedOwner.ts` | **LIVE** (`auditEventWriter.ts:58`, three opportunity paths) |
| `creationOwnerResolution.ts` | **LIVE** (`salesOrderCommands.ts:261`, `opportunityCommands.ts:159`) |
| `commercialCompanyScope.ts` | **LIVE** (`opportunityCommands.ts:175`, `salesOrderCommands.ts:274`, `salesAgreementCommands.ts:304`) |
| `ownershipMatrix.ts` | **INERT** — its only `functions/src` importer is `commercialOwnershipAuthority.ts:33`, whose only importer is `commercialOwnershipRepository.ts:35`, which **has no importer at all — a closed test-only island** |
| `ownershipHandoffCommand.ts` | **INERT** — no `functions/src` importer; two tests + `assignWarehouseRootCompany.js:72` |
| `ownershipCensus.ts` · `ownershipDerivation.ts` · `ownershipBackfillRules.ts` · `warehouseCanonicalIdRepair.ts` · `warehouseRootCompanyAssignment.ts` | **INERT** (script-only) |
| `reorderRequestLocationAuthority.ts` | **INERT** (test-only) — one dynamic import. **No src, NO SCRIPT** |

> **NO MATRIX COLUMN HAS A LIVE RUNTIME READER.** Every read of `.ownerClass` / `.transfer` /
> `.companyScope` is inside an INERT module, the matrix's own helpers, or the dead island. **This
> CONFIRMS AND GENERALIZES the brief: it is not only the two company-scope columns that lack a runtime
> reader — it is ALL of them.** The repo states the intent plainly:
> `ownershipProductionGuard.test.mjs:3-5` — ***"NO APPLIER EXISTS YET."***

**Four matrix accessors are DEAD EXPORTS:** `participatingCompanyFamilies()`,
`transferableFamilies()`, `familiesWithoutBackfillSource()` have **zero callers**;
`crossCompanyFamilies()` is called **only from a test** (OWN-DESIGN EG-5).

**And `participatingFields` is read TWO INCOMPATIBLE WAYS** (OWN-DESIGN EG-6/OD-OWN-002): the census
reads it **structurally** on any family, so `inventory_transactions` is honoured;
`participatingCompanyFamilies()` filters on **`ownerClass`**, so the same row is **excluded**. **The
discriminator for the participating shape is `ownerClass === "PARTICIPATING_COMPANIES"`, never the
presence of a company pair** — `inventoryTransaction` carries the pair while `SINGLE_COMPANY`.

### 5.1 The safety inversion — OWN-E2E F-1, EXECUTED

**Probe B: `stageAuditEvent` (the LIVE writer) with a fake in-memory writer ACCEPTED an
`OWNERSHIP_HANDOFF` event for EVERY case the builder refuses:**

| Probe | Builder (inert) | Live audit writer |
|---|---|---|
| `invoice`, `payment`, `inventoryTransaction` (IMMUTABLE) | REFUSED `FAMILY_IMMUTABLE` | **ACCEPTED** |
| `part` (REFERENCE) | REFUSED `FAMILY_NOT_OWNABLE` | **ACCEPTED** |
| `auditEvent`, `roleAssignment` (EXCLUDED) | REFUSED `FAMILY_NOT_OWNABLE` | **ACCEPTED** |
| `transferOrder` (PARTICIPATING) | REFUSED `FAMILY_PARTICIPATING_COMPANIES` | **ACCEPTED** |
| `notAFamilyAtAll` (nonexistent) | REFUSED `FAMILY_UNKNOWN` | **ACCEPTED** |
| `account` given a **COMPANY** owner | REFUSED `OWNER_TYPE_MISMATCH` | **ACCEPTED** |

**Cause:** `auditEventWriter.ts` imports only `typedOwner` — **never `ownershipMatrix`** — and validates
`targetType` as nothing more than a non-empty string. Its handoff block checks `objectId`, owner
*shape*, the no-op case, `handoffSource` and reason hygiene, **and no family semantics at all. All five
family-level refusals exist ONLY in the unwired builder.**

> **`OWNERSHIP_HANDOFF` is a valid `AuditAction` and `auditEventWriter` has MANY LIVE CALLERS — so this
> is reachable the moment any caller passes the action. WIRING THE HANDOFF BY CALLING THE AUDIT WRITER
> DIRECTLY — THE SHORTEST PATH — WOULD PRODUCE EXACTLY THE CORRUPTION THE MATRIX WAS WRITTEN TO
> PREVENT.** → `OD-7`

### 5.2 A live path that refuses universally, gated on unpopulated roots

`reorderCommands.ts:177-185` is **LIVE** and reads the warehouse's company, refusing
`WAREHOUSE_NO_COMPANY` when absent. **The code says so itself:** *"Today no sandbox warehouse does, so
this REFUSES rather than inventing one."* But `warehouse` has `ownerFields: []` — **no company storage
exists** — and `unresolvedPolicy` is `OWNERLESS_UNTIL_SUPPLIED` pending the Owner's root assignments
(*"12 root decisions, not 19"*).

> **So the trusted reorder-creation path is COMPLETE, LIVE, FAIL-CLOSED and CURRENTLY REFUSING EVERY
> REQUEST IN EVERY ENVIRONMENT. This is neither INERT (it runs) nor MISSING (it is correct) — it is a
> FINISHED MECHANISM BLOCKED ON A DATA DECISION ONLY THE OWNER CAN MAKE.** → `OD-9`

### 5.3 The split, counted

| | Count | Detail |
|---|---:|---|
| **LIVE** (invoked from an `index.ts` export chain) | **4 modules** | `operatingCompanyAuthority`, `typedOwner`, `creationOwnerResolution`, `commercialCompanyScope` |
| **INERT** — backend | **8 modules** | the eight above |
| **INERT** — frontend | **2 modules + 1 catalog field + 1 capability** | `domain/typedOwner.js` (zero importers) · `installedOperatingCompany()` (zero callers) · the `accountOwner` report dimension (`active:false`) · `service.inboundWork.read` (`active:false`) |
| **INERT** — vocabulary values | **3–5 of 8** `OPERATIONAL_ROLE_VALUES` | conflict **E-3** |
| **INERT stages** | 7 (HANDOFF) ×9, 9 (ATOMICITY) ×all ownable, 4 ×1, 15 ×1 | Code proven correct by execution; **no caller** |
| **WRITE-ONLY** | **11 of 13** company fields + 2 person fields | **the largest single category in the model** |
| **MISSING — model gap** (no storage) | **13 of 27** ownable families | — |
| **MISSING — no code at all** | stage 8 ACCEPTANCE, stage 14 ESCALATION (**every family**); the **Approval/Exception**, **Report-execution** and **Inbound Work** families | — |
| **MISSING — command authority** | **4 collections** | §5.2 of the matrix artifact |
| **OWNER DECISION** | **12** physical-root company assignments | — |

---

## 6. THE ORPHAN REGISTER — merged, two granularities preserved

**OWN-E2E counts FAMILIES with an orphaning mechanism; EMP-ACCOUNTABILITY counts WORKFLOWS with a
structural orphaning path. 13 each. The two are consistent at different granularity and NEITHER IS A
SUBSET OF THE OTHER.** An orphan = **no principal or company is identifiably responsible, and nothing
in the product will flag it.**

### 6.1 By family (OWN-E2E §10)

| Family | Orphaning mechanism |
|---|---|
| `account` | Storage exists but `unresolvedPolicy` is *"remains OWNERLESS until an owner is explicitly assigned"*. Creation does not route through the resolver, **and a dispatcher can clear the field.** **Orphaning an Account CASCADES: an ownerless Account makes inherited Opportunity creation REFUSE** |
| `contact`, `location` | Inheritance declared; the only writer is **Postgres-only** with no callable and no UI; **created ownerless by default in Firestore; field unguarded there. Orphaned in the datastore the census and Rules actually read** |
| `workOrder` (`fieldops_wos`) | **No storage at all. PERMANENTLY ORPHANED BY CONSTRUCTION** — 0 of 30 sandbox records carry any company |
| `warehouse`, `mobileLocation` | No storage; `OWNERLESS_UNTIL_SUPPLIED`; **12 Owner root decisions outstanding. Their orphanhood PROPAGATES to every location-derived family and blocks the live reorder path** |
| `invoice`, `payment`, `paymentApplication`, `invoiceAdjustment`, `refund` | No storage **and `IMMUTABLE`** — so **ownership can never be ADDED through a handoff either. Orphaned and unfixable by the handoff authority** |
| `purchaseOrder`, `reorderPurchaseOrder`, `inventoryAction`, `supplierCompanyTerms` | No storage; company derivable **only once the physical roots are populated**, which they are not |
| `reorderRequest` | Matrix says no storage; the live writer does stamp one **but refuses universally, so in practice no record is created at all** |
| `transferOrder` | `participatingFields` declared, `transfer: N_A`, handoff **deliberately refuses**. **If its pair is wrong, ownership has NO correction path** — only a transfer-domain correction that does not exist yet |
| **Inbound Work** | **Not in the matrix at all.** Live collection, live queue, stamps `operatingCompanyId` — **governed by nothing, censused by nothing, with a status-only queue. UNGOVERNED *and* UNMEASURED** |
| **Approval/Exception** | **No family, no collection located.** If approvals exist as a business concept they are **entirely outside the model** |
| **Report** (execution) | No family. Definitions are EXCLUDED; executions are audited **and have no owner** |

### 6.2 By workflow, ordered by severity (EMP-ACCOUNTABILITY §7)

| id | Orphan | Severity | Classification |
|---|---|---|---|
| **ORPHAN-1** | **Work Order past `Dispatch`: only destruction is reachable.** From five active statuses the only exits are the next technician-only step or `CANCELLED`. *"None of the four can be reassigned. All four must be cancelled and recreated."* **Compounding: an orphan permanently consumes its technician's dispatch capacity** — *"It blocks dispatch to a technician who no longer exists"* | **CRITICAL** | WORKFLOW GAP + MODEL GAP. `WF-SVC-011` `blocking_mechanism: NO_CODE` |
| **ORPHAN-2** | **The unaccepted dispatch window.** Between `Dispatch` and `Accept` the dispatcher has acted and the technician has not agreed. **No field names who holds the outcome.** *"An unaccepted dispatch is the earliest signal that a technician's day has gone wrong"*; recovery: *"The dispatcher phones."* Continuity model **B** is required and unrepresentable | HIGH | MODEL GAP |
| **ORPHAN-3** | **Role-queue custody with no assignee.** *"Ownership by ROLE with no assignee is the classic 'everyone's job is nobody's job' state."* **And there is no way back** — no branch from `ASSIGNED_TO_PARTS_ASSOCIATE` to `READY_FOR_PARTS_MANAGER`, and **no reassignment branch in Rules** | HIGH | MODEL + WORKFLOW GAP |
| **ORPHAN-4** | **Terminated employee as PERPETUAL INHERITANCE ROOT.** A departed Account owner remains the governed **default owner of records not yet created** | HIGH | MODEL GAP |
| **ORPHAN-5** | **Fulfilment step owned by NO GOVERNED ROLE.** *"The order-to-cash chain therefore has a step in the middle that belongs to nobody in the governed model."* Its `owner_question`: *"Which named job allocates stock against a booked Sales Order, and which raises its service visit? … no governed business role holds either"* | HIGH | **AUTHORITY GAP — not a missing field, a missing ROLE DEFINITION** |
| **ORPHAN-6** | **Goods on nobody's books.** Cancelling a transfer after the van has left: *"the four motors are off WH-PHX-MAIN's books, ON NOBODY'S BOOKS, and attached to no open transfer — the most completely lost stock any of these stories produces."* `transfer_orders` is PARTICIPATING with `transfer: N_A` and the handoff refuses it **correctly** — **but that means NO AUTHORITY AT ALL governs custody during transit** | HIGH | MODEL GAP |
| **ORPHAN-7** | **Aged open work with no accountable party and no blocked-on field.** *"A WO in CREATED for three weeks means nobody marked it ready, and nothing records who was supposed to."* Compounded: the stalled-job detector returns **only HIGH and CRITICAL**, and a WO with an unusable `createdAt` **is dropped from the At-risk table entirely** | MEDIUM | MODEL + ENGINEERING GAP |
| **ORPHAN-8** | **Inbound work rows with no owner.** *"With no owner field, the afternoon coordinator cannot tell a row nobody has looked at from one someone is actively chasing."* **And `inbound_work_requests` does not appear in the 51-family matrix at all** — neither ownable, REFERENCE, nor EXCLUDED | MEDIUM | MODEL GAP + a **matrix completeness gap** |
| **ORPHAN-9** | **Open cycle-count sheet across a shift boundary.** *"If nobody picks it up, the sheet sits open indefinitely and the stale expected snapshots drift further from reality every day."* And *"A receipt stuck in IN_PROGRESS with no live session is the worst outcome, because nobody else can work it"* | MEDIUM | MODEL GAP |
| **ORPHAN-10** | **Receiving completed, request never closed.** *"The warehouse receipts the goods but nobody closes the request. Ray emails Dwayne. That is the current integration."* | MEDIUM | WORKFLOW GAP |
| **ORPHAN-11** | **Departed employee's platform records.** *"A saved report survives its author's departure and keeps naming them as owner… the person best placed to tidy a departed colleague's reports is the one role that cannot."* The EXCLUDED classification is **right for ownership and leaves a real departure consequence ungoverned** | LOW but instructive | **MODEL GAP in the EXCLUDED boundary** |
| **ORPHAN-12** | **Unattributable changes.** *"A customer's payment terms changed and nobody knows who changed them"* — Account edits are raw client writes producing **no audit event**, unlike governed employee edits. **Accountability that cannot be reconstructed after the fact is not accountability** | LOW, but it defeats accountability retroactively | ENGINEERING GAP |
| **ORPHAN-13** | ***"Which accounts have no owner?"* IS UNANSWERABLE.** *"A report that would answer 'which accounts have no owner' — the question the whole commercial chain depends on — cannot be built."* **Combined with the shape-only person derivation, EOS CAN NEITHER PREVENT, DETECT, NOR REPORT person-level responsibility gaps** | **HIGH, meta** | ENGINEERING + MODEL GAP |

**Count: 13 families · 13 workflows · and ZERO of the 86 registry workflows are `WORKS_END_TO_END`.**

---

## 7. THE LANE'S SUMMARY JUDGEMENT — adopted verbatim

> **Ownership at this baseline is a WELL-BUILT DESCRIPTIVE MODEL WITH A LIVE COMMERCIAL HEAD AND AN
> INERT BODY.** The commercial chain (Account→Opportunity→Sales Agreement/Order) genuinely resolves
> ownership at creation through live code **and displays it end-to-end — that part works.** Everything
> else does not:
>
> 1. **Creation is live for 2 of 27 ownable families** (`opportunity`, `salesOrder`).
> 2. **13 of 27 have no storage at all** — a MODEL gap, not a data gap.
> 3. **11 of 13 stored company fields are write-only** — recorded by live writers, rendered nowhere,
>    reportable nowhere. **Company responsibility is captured and then invisible.**
> 4. **Handoff is inert for every family**, and the one place ownership actually moves in the product
>    routes **around** the handoff authority.
> 4b. **The person axis has no referential integrity** — a record owned by a terminated employee
>    censuses RESOLVED, so **the census cannot evidence that person ownership resolves at all.**
> 4c. **Escalation is MISSING at the model level** — past `Dispatch` the only expressible answer to an
>    unavailable technician is to **cancel a live customer commitment.**
> 5. **Acceptance and escalation do not exist for any family.**
> 6. **Responsibility cannot be queried at all**; the one axis that looks like it could be **would
>    invent false scope if used.**
>
> **And in FOUR places the inertness is not merely incomplete but UNSAFE:**
> **F-1** — every family-level safety refusal sits in the uncalled module; the called audit writer has
> none, and EXECUTED accepts a handoff of an invoice, a part, an audit event, or a nonexistent family ·
> **F-4/§7A** — the ownership root is client-writable with no audit, the governed setter that calls
> itself *"the ONLY way"* is unreachable, and the ungoverned client write is what ships ·
> **F-2** — a backfill cap still authorizes writes to a **retired** collection ·
> **F-3** — the authorized total (1013) does not match what was applied (1015).
>
> **`ownershipMatrix.ts` is DESCRIPTIVE of existing storage, exactly as the brief said — and 38 of its
> 51 rows describe storage that does not exist.** The lane's rule holds all the way down: **twelve
> typechecking modules, 1,013 authorized writes and a 51-row matrix are NOT an end-to-end ownership
> lifecycle, and at this baseline NO FAMILY COMPLETES ONE.**

---

## 8. UNPROVEN — and the exact read that would settle each

| # | Claim | The read that would settle it | Lane |
|---|---|---|---|
| U-4 | **Current** production governed-role occupancy (the census is 2026-09-02, **11 days stale** at baseline) | `node functions/scripts/r32ProductionExposureCensus.js --read-only --projectId taylor-parts` (**refuses any other project, has no `--apply`**; write-freedom enforced by a test). Minimal equivalent: `roleAssignments where status=="active"` intersected with the 45 governed keys | OWN-E2E |
| U-5 | Whether the 2 already-applied `trucks` company writes match what the current rules would produce | Read `trucks.operatingCompanyId` for `cert-trk-04/05` in sandbox against `BACKFILL_RULES`. **No rule can now produce them — that IS the finding** | OWN-E2E |
| U-6 | Whether `stock_locations` still holds `operatingCompanyId` values written by the retired-collection cap | Read the 5 sandbox / 4 production `stock_locations` docs | OWN-E2E |
| U-7 | Whether a handoff **has ever been recorded** — audit occupancy | `auditEvents where action=="OWNERSHIP_HANDOFF"` per environment. **Static analysis proves no emitter exists, so the expected answer is 0; a non-zero result would mean an out-of-band write** | OWN-E2E |
| U-9 | **All Firestore Rules behaviour in the exposure finding — read as source, NEVER EXECUTED** | `firebase emulators:exec` with a Rules unit test asserting an `admin`/`dispatcher` client `update` changing only `accounts.accountOwner`. **Blocked: no JRE, port 8080 held.** *"This is the one place my headline claim rests on STATIC READ, and it should be executed before it is relied on"* | OWN-E2E |
| **U-11** | Whether `contacts.owner` / `locations.owner` exist in **Firestore** at all, or only in Postgres | Read one `contacts` doc per environment for an `owner` field. **THE HIGHEST-CONSEQUENCE UNPROVEN: if the field is Postgres-only, the two largest backfill caps (51% of the authorized total) target a field that does not exist where the applier writes** | OWN-E2E |
| U-13 | **How many records are person-owned by an employee who no longer exists** | Join the owner ids against the `employees` collection, per environment. **THIS IS THE READ THE ENFORCEMENT GATE ACTUALLY NEEDS AND DOES NOT HAVE** | OWN-E2E |
| UP-1 | Whether the 11/30 Work Orders carrying a `salesOrderId` would resolve a company if the field existed | Read the linked Sales Orders' `operatingCompanyId` in live data. **The matrix itself says *"to be measured, never assumed"*** | OWN-DESIGN |
| UP-3 | Whether the census numbers still hold. **All census figures are from `…-postbackfill-2026-08-30.txt`, TWO WEEKS STALE**, and `reorder_requests` has demonstrably changed shape since | Open item O-3: *"the census cannot be run from a repository session — needs Admin-SDK credentials against a real target, separately Owner-authorized"* | OWN-DESIGN |
| UP-5 | Whether the four email/inbound collections carry `operatingCompanyId` on real records, or **only in the write path** | **No census covers them — they are not matrix families** | OWN-DESIGN |
| UP-7 | Whether `commercialOwnershipAuthority.ts`'s **Postgres** path agrees with the Firestore matrix | The Postgres plane was out of scope | OWN-DESIGN |
| UN-3 | Whether backfill has run since | The plan projects 517 PERSON + 451 COMPANY + 47 PARTICIPATING writes with 99 blocked; **whether any executed is not visible from the repository** | EMP-ACCT |
| U-8 | Whether the residual fixture doc `roleAssignments/migfix-operator-assignment` (**non-catalog `roleId: migfixCatalog`**, written by a script, **no delete found**) still exists | Doc `get` per environment | OWN-E2E |
