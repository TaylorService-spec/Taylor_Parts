# Phase 2 — consolidated open-decision ledger

**Scope.** Every "not done / deferred / Owner decision" note across the 32 Wave-1 lanes; all
`docs/handoff/w1-c*-registrations.md` files — **31 of them, for lanes C1–C13 and C15–C32; there is no
`w1-c14-registrations.md` in the tree**; all 18 migration headers under `functions/migrations/`; the
integration record (`docs/integration/w1-integration-rehearsal.md` plus integration commits
`8dfcd006`, `0b95a347`, `d104cf49` — no `docs/` file names PR #1898 by number, so the commits and the
rehearsal document are the record); `LISTS-P2-COLLECTION-DISPOSITION.md` §5 and §11; ADR-004, ADR-007,
ADR-010, ADR-013; and the contradictions the integrated tree surfaced that no single lane could see.

**Tree.** Verified against the integrated head `d104cf49` — all 32 Wave-1 lanes plus the `eos_finance`
ruling. Every item below was re-checked against *this* tree, not against the branch that raised it.
Several were already closed by a sibling lane's merged work; those are marked and listed in §4.

**This document changes no behaviour.** It decides nothing. Where an item is mechanical, the
mechanical answer is stated and deliberately not applied.

## Dispositions used

| Disposition | Meaning |
|---|---|
| `CLOSED_BY_OWNER_RULING` | An Owner ruling settles the question. Residual work, if any, is mechanical. |
| `CLOSED_BY_PHASE2` | Already closed in the integrated tree by merged Wave-1 / integration work. |
| `BLOCKS_NONPROD` | Something is red, unrun or unenforced *today*, in a non-production gate. |
| `BLOCKS_CUTOVER` | Latent today because the surface is inactive; becomes live the moment a capability is activated, a client is cut over, or a wave-3 object arrives. |
| `PHASE3_OPERATIONAL_REVIEW` | Real, not urgent, and belongs to a later operational pass. |
| `OWNER_DECISION_REQUIRED` | Cannot be settled mechanically. Needs a business answer. |
| `INTENTIONALLY_DEFERRED` | Named, reasoned, and correctly left alone. |

---

## 1. The two Owner rulings that landed tonight

### R-A — overlapping blocked-time facts are legitimate (union semantics, not sum, not prohibition)

**Closes:** the contradiction integration commit `0b95a347` escalated between PR #1893 (W1-C27's
ND-25) and the contract already merged on `main` from #1549.

**What the tree holds today (verified):**
- `functions/src/scheduling/schedulingCommands.ts:460-469` — `createTechnicianBlockedTime` **refuses**
  any new absence overlapping an existing one (`BLOCKED_TIME_CONFLICT`).
- `functions/test/e2e/schedulingAvailabilityEmulator.test.mjs:370-377` — requires a multi-day
  `COMPANY_CLOSURE` straddling a daily `LUNCH` block to be representable, and asserts both are
  returned ("the straddling closure is included").
- `functions/src/scheduling/availabilityModel.ts:293-312` `blockedMinutesInWindow` — walks minutes,
  therefore **de-duplicates** (union).
- `field-ops-app-vite/src/domain/dispatchBoardGeometry.js:221-230` `blockedMinutesInBand` — `reduce`
  over blocks, therefore **sums** (double-counts an overlap).

**What the ruling settles:** the overlap is a legitimate fact; the correct reader arithmetic is the
union, which `availabilityModel` already implements. ND-25's prohibition and
`dispatchBoardGeometry`'s sum are both now wrong, and neither is a decision any more.

**Residual, mechanical, NOT applied here:** withdraw the `createTechnicianBlockedTime` overlap
refusal and its `schedulingBlockedTimeExclusion.test.mjs:156` source assertion; make
`blockedMinutesInBand` de-duplicate the way `blockedMinutesInWindow` does. See item **14**.

**Also closed by the same ruling:** W1-C27 §5 Q3's second half — overlapping `weeklyHours` intervals
within one weekday (`validation.ts:177-197` accepts them, `availabilityModel.ts:102-122`
`normalizeIntervals` merges them). Union semantics is exactly what that code already does, so the
"known divergence" C27 recorded is now the ruled behaviour. See item **14b**.

### R-B — `stock_locations` is retired as an operational authority

**Closes:** the three-guard deadlock integration commit `d104cf49` escalated and explicitly refused to
adjudicate.

**What the tree holds today (verified by running the guards):**
- `firestore.indexes.json` — the `stock_locations (warehouseId, binCode)` composite is **already gone**
  (PR #1877 removed it; `d104cf49` left the removal standing).
- `scripts/indexDriftGuard.test.mjs:187` — still asserts `expectedLive === 35`. **RED.**
- `scripts/listIndexCoverage.test.mjs` — "every registered demand is declared". **RED.**
  ```
  $ node --test scripts/indexDriftGuard.test.mjs scripts/listIndexCoverage.test.mjs
  not ok 8  - O-4: every declared index is either live or explicitly listed as pending deploy
  not ok 16 - every registered demand is declared in firestore.indexes.json
  # tests 24 / pass 22 / fail 2
  ```
- `field-ops-app-vite/src/metadata/definitions/stockLocation.js:153` — `stockLocationIndexList` is
  still a registered list view with a `warehouseId` EQUALS filter and a `binCode` sort.
- `field-ops-app-vite/src/metadata/entityRegistry.js:47,79` — `stockLocationEntity` still registered.
- `functions/test/eosOpsWarehouseBinAuthority.test.mjs:243` — "the dead composite index is gone".
  **GREEN**, and stays green.

**What the ruling settles:** do not restore the index; retire the stale list/metadata registration.
The two red guards are now bookkeeping, not a decision.

**Everything that still registers `stock_locations`, enumerated.** The operational-authority pieces
the ruling targets are *already* gone: no `firestore.indexes.json` entry, no `firestore.rules` match
block (deny-all by absence, stated at `firestore.rules:1180-1189` — "CLIENT READ RETIRED (BIN-P2R,
Decision #160 / ADR-014)"), and `functions/src/warehouseService.ts`, the only historical writer, no
longer exists. What remains:

| # | registration | class |
|---|---|---|
| 1 | `field-ops-app-vite/src/metadata/definitions/stockLocation.js:72-88` (`stockLocationEntity`) and `:153-169` (`stockLocationIndexList`, `id: "stockLocation.index"`, `warehouseId` filter, `binCode` sort) | **the list/metadata registration the ruling names** |
| 2 | `field-ops-app-vite/src/metadata/entityRegistry.js:47,79` — import + array entry | same |
| 3 | `scripts/listIndexCoverage.mjs:394-404` — `REQUIRED_INDEXES` still demands the composite, `requiredBy: "stockLocation.index"`; `:522` lists the definition file in `REGISTERED_DEFINITION_SOURCES` | same — this is what makes `listIndexCoverage.test.mjs` red |
| 4 | `scripts/indexDriftGuard.test.mjs:187` — asserts 35; live value is 34 | same |
| 5 | `functions/src/ownership/ownershipBackfillRules.ts:99,228`; `ownershipDerivation.ts:80`; `ownershipMatrix.ts:139,302,327-334,392,399,406,414`; `config/ownership/operating-company-roots.sandbox.json:114` | **separately gated** — items 15b / 15c |
| 6 | `functions/src/access/permissionCatalog.ts:596-598` + client mirror `:602-604` (`warehouse.stockLocation.read`, whose own description says "nothing evaluates it"); referenced by `compatibilityRoles.ts:95`/`:101`, `governedBusinessRoles.ts:574`/`:580`, `policyObjectRegistry.js:125`, `docs/governance/effective-authority.json:301,344,824,840`, `docs/architecture/capability-graph.json:2035-2038` | inert historical residue |
| 7 | `functions/src/adminPolicy/seed/policySeedSnapshot.json:5801,5811,5834`; `policySeedCoverage.json:39,2568,2573` | generated; follows 1–2 |
| 8 | `functions/src/types/warehouse.ts:9` and ~15 prose comments across `functions/src` and `field-ops-app-vite/src` | history, not dependency — W1-C21 argues removing them "would delete the reasoning that stops someone re-adding a second balance table" |

**Residual, mechanical, NOT applied here:** rows 1–4 — drop `stockLocationIndexList` and
`stockLocationEntity` (and the `entityRegistry.js` import), drop the `listIndexCoverage.mjs` demand
and definition-source entry, move `indexDriftGuard.test.mjs`'s `35` to `34`, and absorb the
object/field census movement. Ripple named by W1-C18 §4.3: `policySeedCoverage.json`
`capabilityGapsFilled`, `adminPolicySeedCoverage.test.mjs:159`, `policyObjectRegistry.test.mjs:99`,
and `MATRIX_GAP_CAPABILITIES.stockLocation`. Rows 5–8 are items 15b/15c or deliberate residue.
See item **15**.

**What the ruling does NOT close** — two residuals that need the Owner, recorded as items **15b** and
**15c**:
1. `functions/src/ownership/ownershipBackfillRules.ts:99,228` is a one-time Ownership-v1 stamping
   plan over **5 `stock_locations` rows that still exist**, with `ownershipDerivation.ts:80` declaring
   the matching derivation. W1-C3 and W1-C21 both gated removal on "it goes when those rows do", and
   this wave prohibits deleting the rows. Retiring the *list/metadata registration* does not by itself
   say whether the *stamping plan* is also withdrawn.
2. `functions/src/ownership/ownershipMatrix.ts:392,399,406,414` declares `stock_locations` as the
   company-inheritance source for **four** families — `inventoryTransaction`, `inventoryAction`,
   `transfer`, `cycleCount` ("the stock location's operatingCompanyId, once D-9 is populated"). The
   ruling retires the authority those four inherit from.

---

## 2. The ledger — 25 items after deduplication

Each item states: the question · who raised it and where · the evidence on each side · why it cannot
be settled mechanically (or the mechanical answer, if it can) · what it blocks · the disposition.

---

### 1 — May a Ventana order be promised against Taylor stock?

**Raised by:** W1-C32 §"Not done" · W1-C10 (finding 1) · W1-C16 §3 · W1-C30 §3 · DECISIONS #165
ruling 4 ("RESERVATION SCOPE ... Taylor/Ventana and warehouse/truck can be distinguished") recorded
**NOT closed**.

**Evidence — the allocation engine is company-blind:**
- `functions/src/fulfillment/allocateSalesOrder.ts:121-122` — the eligible-warehouse set is
  `where("status","==","ACTIVE")` and nothing else. No company predicate.
- `functions/src/fulfillment/allocateSalesOrder.ts:61,74,90,125,141` — `readPartOnHand`,
  `readOpenWoReserved`, the linked-WO read and the competing-SO query all filter on `partId`/`state`
  only.
- `functions/src/fulfillment/fulfillmentAvailability.ts` — `sumLedgerEligibleOnHand`,
  `openWorkOrderReserved`, `computePartAvailability`, `sumOtherSoCommitments` take no company
  parameter.

**Evidence — the data to filter on partly exists:**
- `functions/src/salesOrder/salesOrderCommands.ts:274,287` — a Sales Order **does** carry a required
  governed `operatingCompanyId` (`COMPANY_REQUIRED`).
- `functions/src/types/warehouse.ts:79` — `Warehouse.operatingCompanyId?: string` is **optional**.
- `functions/src/ownership/ownershipMatrix.ts:311-323` — `warehouses` is a D-9 company-boundary root
  whose `backfillSource` is "explicit governed configuration, Owner-supplied per site" and whose
  `unresolvedPolicy` is `OWNERLESS_UNTIL_SUPPLIED`. **It has not been supplied.**

**Why it is not mechanical.** A company-scoped pool must answer *what to do with a company-less
warehouse* — refuse it, or include it. Refusing empties the pool (the roots are unpopulated);
including it silently reintroduces the blindness. Either answer is new business authority, and
DECISIONS #143 forbids inferring the company from the location. W1-C32 says this in those words.

**Blocks:** activating `salesOrder.fulfill` (`permissionCatalog.ts:253-258`, `active: false`) —
which is precisely what keeps this latent rather than live today.

**Disposition:** `OWNER_DECISION_REQUIRED` (and `BLOCKS_CUTOVER`).

---

### 2 — Does a Work Order store an `operatingCompanyId`, and if so from where?

**Raised by:** W1-C19 §"Findings" 1 · W1-C30 §3 · W1-C31 §4 · DECISIONS #165 "Ruling 4 is blocked on
an authority that does not exist".

**Evidence — the field does not exist (verified):**
- `functions/src/types/workOrder.ts:83-186` — the `WorkOrder` interface has no such field.
- `functions/src/createWorkOrder.ts`, `functions/src/transitionWorkOrder.ts` — never write one.
- `sb-evidence/ownership-census-sandbox-postbackfill-2026-08-30.txt` — all 30 `fieldops_wos` records
  report "family has no ownership storage yet". **0 of 30.**

**Evidence — two governance documents still say it is stored:**
- `docs/DECISIONS.md:3347-3351` (Decision #143) — "is stored on the Work Order as a historical fact".
- `docs/architecture/SYSTEM_AUTHORITIES.md:115` — "stores it as a historical fact".

**ALREADY CLOSED in the integrated tree, in part:** `functions/src/ownership/ownershipMatrix.ts:228-253`
now declares `ownerFields: []` with the measurement written out inline ("This row declared
`ownerFields: ["operatingCompanyId"]` until this correction... the field was added to the matrix
AFTER the reconciliation the file's header claims"). **The matrix no longer declares a field the type
lacks.** W1-C19's finding 1, as raised, is stale.

**What remains open:** DECISIONS #143 and SYSTEM_AUTHORITIES.md still describe storage that has never
existed, and nothing has decided whether to *create* it. `ownershipMatrix.ts:253` records the only
latent source: 11 of 30 sandbox Work Orders carry a `salesOrderId` — "to be measured, never assumed".

**Why it is not mechanical.** Three options, each with a different consequence: (a) require explicit
company at creation and refuse otherwise — fails every current dispatch closed; (b) read it from the
Sales Order at creation — covers 11 of 30 and leaves 19 refused; (c) leave the Work Order
company-less permanently and scope reservations some other way. #143 forbids the fourth option
(inference from technician, dispatcher, creator, customer or location).

**Blocks:** DECISIONS #165 ruling 4; item 1; item 9's wave-3 arm; any company-scoped Work Order
reporting.

**Disposition:** `OWNER_DECISION_REQUIRED`.

---

### 3 — Which capability governs Work Order *visibility*?

**Raised by:** W1-C30 §2 (registered as a frozen exception) · W1-C19 §"Findings" 3.

**Evidence — no capability exists:**
- `functions/src/access/permissionCatalog.ts` registers `workOrder.create` (:94),
  `.transition` (:100), `.cancel` (:107), `.labor.record` (:125), `.labor.correct` (:133),
  `.parts.plan` (:141). **There is no `workOrder.read`.** Confirmed absent from
  `docs/architecture/capability-graph.json` and the client catalog too.

**Evidence — a role string decides instead:**
- `firestore.rules:506-509` — `allow read: if isAdminOrDispatcher() || (isTechnician() &&
  isOwnTechnician(resource.data.assignedTechId))`, resolved through `firestore.rules:18-42`'s
  `users/{uid}.role` string equality.
- `functions/src/ai/workOrderContext.ts:55-63` — a **hand copy** of the same predicate, server-side,
  reading `users/{uid}.role` via `functions/src/callerContext.ts:15-22`.
- `functions/migrations/1757894400000_operational-capability-vocabulary.sql:94-104` registers
  `workOrder.lifecycle.dispatch` / `.cancel` / `.complete` in the SQL vocabulary while
  `functions/src/transitionEngine.ts:128-143` still enforces hardcoded role strings — and that same
  SQL file records the gap at `:43-48`.

**Frozen, not fixed:** `functions/test/aiAssistantAuthorityBoundary.test.mjs`'s
`REGISTERED_ROLE_STRING_AUTHORITY` contains exactly `ai/workOrderContext.ts`; a second role-string
authority anywhere in that surface fails the suite.

**Why it is not mechanical.** Minting `workOrder.read` requires deciding what it *means* — global
read, own-assignment read, or a scoped condition — and which Roles hold it. W1-C30 refused to mint
"a capability no Role grants and no other surface honours".

**Blocks:** retiring the Rules-as-authorization exposure on `fieldops_wos`; any capability-governed
Work Order read path.

**Disposition:** `OWNER_DECISION_REQUIRED`.

---

### 4 — Does commitment subtract CONSUMED?

**Raised by:** DECISIONS #165 §"The blocker" (records the disagreement, explicitly declines to choose)
· W1-C32 §"Not done".

**Evidence — three formula sites, two structurally different formulas (verified):**
- **A — `RESERVED − RELEASED − CONSUMED`**, warehouse-wide, used by Sales Order allocation:
  `functions/src/fulfillment/fulfillmentAvailability.ts:138-139`.
- **B — `RESERVED − RELEASED` only**, warehouse-wide, used by the live Work Order dispatch gate:
  `functions/src/inventoryService.ts:153-160` (`openCommitment`, called from `getAvailableQuantity`
  at `:123`). Its own comment at `:126-151` says adopting A here would import "a REAL PRE-EXISTING
  OVER-AVAILABILITY DEFECT".
- **C — `RESERVED − RELEASED − CONSUMED`, scoped to one Work Order**:
  `functions/src/inventoryService.ts:168-189` and `:282-294`. Different scope, so not a third opinion.

**The underlying defect, proven:** `functions/test/inventoryConsumptionOnHandGap.test.mjs` —
`sumLedgerEligibleOnHand` counts only physical movement types and legacy commitment rows carry no
`location`, so a CONSUMED entry is invisible twice over and **consumed stock never leaves on-hand**.
A compensates by subtracting it from commitment (right number, wrong reason); B does not compensate
and over-reports availability.

**Why it is not mechanical.** DECISIONS #165 names three mutually exclusive answers: (a) consumption
writes a physical removal movement, (b) `sumLedgerEligibleOnHand` counts location-less CONSUMED rows,
(c) commitment permanently retains consumed quantity platform-wide. Each changes inventory semantics
or an Owner-ratified derivation. **None was chosen.**

**Blocks:** DECISIONS #165 ruling 1 (one commitment pool); converging the two commitment authorities;
activating `salesOrder.fulfill`.

**Disposition:** `OWNER_DECISION_REQUIRED`.

---

### 5 — Sales Order allocation never takes the per-part reservation lock

**Raised by:** W1-C32 §"Not done" (third bullet).

**Evidence (verified):**
- The lock: `functions/src/inventoryService.ts:60-67` — `inventory_reservation_locks`,
  `reservationLockRef(partId)`.
- **Work Order path takes it:** `inventoryService.ts:239-241` (`reserveParts` reads *and* writes every
  part's lock), `:360` (plan reconciliation), `:427` (consumption).
- **Sales Order path does not:** `inventory_reservation_locks` / `reservationLockRef` appears nowhere
  under `functions/src/fulfillment/` or `functions/src/salesOrder/`. The only other hits are a comment
  in `transitionWorkOrder.ts` referencing the pattern for an unrelated per-technician lock, and the
  unwired `functions/src/eosOps/inventoryCommitmentRepository.ts:38`.
- `functions/src/eosOps/inventoryCommitmentRepository.ts:35-42` states the lock's purpose: "a MUTEX
  ... it exists only to force a competing reserve into the same Firestore transaction's read set".
- Independently documented at `docs/assessments/inventory-commitment-reservation-authority.md:172-180`
  ("CONFLICT 1 — the Work Order path is blind to Sales Order allocations").

**Why W1-C32 did not fix it:** `reservationLockRef` is private to `inventoryService.ts`, which lane
C1 owned this wave.

**Is it mechanical?** *The fix is*, but the fix presumes item **4**: making the two paths take one
mutex while they compute commitment by two different formulas serializes a disagreement rather than
resolving it. Sequence it after 4.

**Blocks:** activating `salesOrder.fulfill`. Latent today because that capability is `active: false`.

**Disposition:** `BLOCKS_CUTOVER` (mechanical once item 4 is ruled).

---

### 6 — Serialized status and custody: `RECEIVED` / `IN_TRANSIT`, and the ADR-010 install ledger effect

**Raised by:** W1-C7 §3.1 and §3.2 · W1-C20 §3 (ruled the vocabulary) and §4.1 (OR-3, left open) ·
W1-C25 §"Facts this lane leaves".

**PARTIALLY CLOSED BY W1-C20.** C20 re-derived the set from *writers* rather than declarations and
ruled: `RECEIVED` (2 live rows) and `IN_TRANSIT` (0 live rows, fully reachable) **refuse at import —
do not fold into AVAILABLE or RESERVED**; `STAGED` / `DELIVERED` / `LOADED` / `RESERVED` have **no
writer anywhere**, so C7's 8-vs-5 hazard is unreachable rather than latent, and the enum must **not**
be widened for them. Pinned by `functions/test/serializedCustodyTypedPair.test.mjs`. C20 also decided
`ops_serial_status` **should** gain `RECEIVED` and `IN_TRANSIT` — but in the migration that ships the
importer (lane C15's), so the refusal path and the widened enum are tested together. Migration id
`1759622400000` was left unspent for it.

**A second correction this lane made, against the item as handed to it.** "INSTALLED custody
semantics are undefined" is **REFUTED**. The custody holder *is* defined, in two places that agree:
`functions/src/eosOps/operatingCompanyCustody.ts:35-38` ("after installation the honest answer is the
customer's Equipment record, whose id the custody row carries in `locationId`. CUSTOMER is
deliberately absent: the Equipment record already names the account") and `:114-119`
(`isInstalledCustodyConsistent` — the biconditional `(status === "INSTALLED") === (locationType ===
"EQUIPMENT")`). ADR-010 §2 and `functions/src/eosOps/equipmentCustody.ts:118-140` carry the same
answer: the account, through the minted `equipment/{id}` record's `accountId` + `customerLocation`.
What is genuinely undefined is a *different* question — the ledger effect, below.

**What genuinely remains open — OR-3 and the ADR-010 ledger effect:**
- `functions/src/equipmentInstall/installSerializedAssetCommand.ts` preserves `currentLocationId` at
  the **origin warehouse** on install, so an installed unit's stamped pair describes where it *was*.
- Migration 007's biconditional (`status='INSTALLED'` ⟺ `location_type='EQUIPMENT'`) means an importer
  must derive EQUIPMENT custody from `currentEquipmentId` and must **not** carry the physical pair.
- W1-C7 §3.4: two live INSTALLED assets sit at customer sites while `currentLocationId` reads
  `wh-main` — "a naive importer would place two customer-owned machines back into warehouse stock".
- W1-C7 §3.2: **ADR-010 §3 cannot be honoured.** It says installation appends a governed `CONSUMED`
  ledger effect *from the customer Location*; migration 007 ruled the customer's Equipment out of
  `ops_location_type`, so no such row is emittable, and emitting one from the origin warehouse would
  claim stock left a place it left at delivery. **Migration 008 writes no ledger row and
  `installSerializedUnitAsEquipment` emits none.**
- W1-C20 §3: three `ops_serial_status` values — `CONSUMED`, `RESERVED`, `SCRAPPED` — have no Firestore
  producer at all; consuming a serialized unit on a work order does not change its `inventoryState`,
  so a consumed serial stays `AVAILABLE`.

**Why it is not mechanical.** "Does installation have a ledger effect at all, and from where?" is an
unresolved conflict between ADR-010 and migration 007's own ruling. It is a ledger-authority decision.

**Blocks:** the serialized cutover importer; ADR-010 §4 (uninstall/return/replacement, which has no
command on either side).

**Disposition:** `OWNER_DECISION_REQUIRED` for the ADR-010 ledger effect (does installation emit a
movement, and from where?). Vocabulary half: `CLOSED_BY_PHASE2` (C20's ruling), with the enum widening
`INTENTIONALLY_DEFERRED` to the importer migration. **Custody identity: already defined — the item as
raised is stale** (see §4).

---

### 7 — Administration: which capability governs which verb?

**Raised by:** W1-C18 (the whole census) · W1-C13 §2 · W1-C5 §7 · W1-C7 §1.3 · W1-C9 §4 · W1-C4 §3 ·
W1-C10 §3. **Seven lanes, one question.**

**Four tables answer it** (`docs/handoff/w1-c18-registrations.md` §0):

| table | path | consumed by |
|---|---|---|
| `OBJECT_PERMISSIONS` | `field-ops-app-vite/src/access/objectPermissionMap.js:33` | the Administration screens, and transitively the policy seed |
| `OBJECT_CAPABILITY_MAP` | `functions/scripts/governance/objectCapabilityMap.mjs:39` | every committed artifact under `docs/governance/` |
| `MATRIX_GAP_CAPABILITIES` | `field-ops-app-vite/src/access/policyObjectRegistry.js:123` | `GOVERNABLE_OBJECTS` → `policySeedSnapshot.json` → the tenant policy store |
| a fourth, private copy | `scripts/reconcileCrudMatrix.mjs:100-127` | the reconciliation report only |

`objectCapabilityMap.mjs:13-16` claims in its own header that the fourth was consolidated into it.
**It was not**, and it had drifted.

**W1-C18 closed the provably-wrong part and refused the rest.** Removed: `inventory.action.create`
from `objectPermissionMap.js` (verified — `:54` now carries a REMOVED comment) and from
`scripts/reconcileCrudMatrix.mjs:113`; `reorder.request.postPurchasingUpdate` from
`objectCapabilityMap.mjs`. Added `functions/test/administrationObjectDrift.test.mjs` (15 tests,
mutation-proven) which pins what is decided and fails on what is new. Registered at the integration
in `functions/package.json` `test:governance` and `.github/workflows/role-governance-tests.yml:34`.

**What remains — the sub-questions, each needing its own answer:**

**7a. 21 object/verb disagreements** between `permMap` and `capMap` (W1-C18 §2.3). Three are
deliberate and test-defended (`Users`, `Roles / Permissions`, `Contacts`). The rest are unexplained.
Two are **structural**, not a matter of degree:
- **Work Orders / Delete.** `capMap` puts `workOrder.cancel` under D; `permMap` puts it under E.
  `supportsDelete` derives from `permMap`'s D list (`policyObjectRegistry.js:160`), so the seeded
  policy store says Work Orders are not deletable while the governance contract says cancel is the
  delete verb. **One of the two is wrong** and the artifact the business reads is generated from the
  one nobody checks. → `OWNER_DECISION_REQUIRED`.
- **`Reorder Requests` has no row in `OBJECT_CAPABILITY_MAP` at all — and, measured here, none in the
  private copy either.** Owner decision D-5 split it out as its own canonical Object;
  `field-ops-app-vite/src/access/objectPermissionMap.js:79` got the row, and
  `policyObjectRegistry.js:51` (`ENTITY_BY_MATRIX_OBJECT`) carries it into the governable-object union
  with a comment at `:112-118` recording that it was deliberately dropped from
  `MATRIX_GAP_CAPABILITIES` once it had its own matrix row. But **`objectCapabilityMap.mjs:39-90` has
  no such key, and neither does `scripts/reconcileCrudMatrix.mjs:100-127`'s `OBJECTS` array** — so the
  object is present in 2 of the 4 tables and absent from 2. W1-C18 named one omission; there are two. So `reorder.request.create.manual`, `.create.system`, `.read.queue`, `.read.own` are attributed
  to **no object** in every generated contract, workbook sheet and precedence-sweep classification.
  **This one IS mechanical** — W1-C18 §5.2 item 1 gives the exact row
  (`R: ["reorder.request.read.queue","reorder.request.read.own"]`,
  `C: ["reorder.request.create.manual","reorder.request.create.system"]`, `E: []`, `D: []`); nothing
  new is granted, and `administrationObjectDrift.test.mjs`'s pin is deleted in the same change.
  Not applied here because it is an *addition to a capability map*. → `BLOCKS_NONPROD` (mechanical).

**7b. `Employees` has no `OBJECT_PERMISSIONS` row.** Raised identically by W1-C5 §7 and W1-C18 §5.2
item 2; **both lanes explicitly refused to decide inside a shared file.** `firestore.rules`
`employees/{employeeId}` (lines 476-498) is three role/relationship OR branches with **no capability
id**; there is no `employee.*` id in the catalog and `definitions/employee.js` records
`readCapability: null` for exactly that reason. Two honest options, per C5:
`{ object: "Employees", rulesOnly: "employees", C: [], R: [], E: [], D: [] }` (truthful today, and it
grows the `rulesOnly` census to four, which **will** fail C18's pinned census test — intended, so the
decision is visible), or introduce real `employee.*` ids first, which is a permission-catalog change
**and** a Rules change. Both lanes' position: the second is the end state, the first the honest
interim. → `OWNER_DECISION_REQUIRED`.

**7c. The `rulesOnly` standing exposure — authorization living in Firestore Rules.** `Contacts`,
`Customer Locations`, `Equipment / Installed Base` are `rulesOnly` with all four CRUD lists empty;
there is no `equipment_models` row at all; `firestore.rules` `/locations/{locationId}` validates
literally nothing (W1-C9 §4). Adjacent and worse: `employees` (7b) and `inventory_actions` (item 8).
`Notifications` and `Technician Time / Non-work` are `RULE_GOVERNED` server-side but **not**
`rulesOnly` client-side — the two tables disagree about the mechanism, and for Technician Time no
corresponding Rules collection exists at all, so `UNMODELLED` is the correct classification.
W1-C9 proposed six ids (`customer.contact.*`, `customer.location.*`); W1-C7 §1.4 flags that
`equipmentImportCommand.ts:58` reuses `equipment.install` as `CAP_EQUIPMENT_CREATE` and says in its
own header that "whether Equipment deserves its own create capability is a real question and a
separate decision". None were added; nothing grants or depends on them.
→ `OWNER_DECISION_REQUIRED` (the capability shape), `BLOCKS_CUTOVER` (the Rules exposure).

**7d. The policy seed drops `rulesOnly` entirely.** `GOVERNABLE_OBJECTS` carries the marker;
`scripts/buildAdminPolicySeedSnapshot.mjs:59-70` does not copy it into `policySeedSnapshot.json`.
Inside the tenant policy store a Rules-governed object is **indistinguishable** from an unmodelled
one — both are an object with four empty verb lists. Mechanical to fix; it changes what the seed
means, so it is a governance-owner call whether the marker should be seeded.
→ `PHASE3_OPERATIONAL_REVIEW`.

**7e. Roughly half the advertised capability ids are inert — and "inert" does not mean what it
sounds like.** W1-C18 finding 13 and §2.4 state "30 of 58". Re-measured here by importing
`GOVERNABLE_OBJECTS` (`field-ops-app-vite/src/access/policyObjectRegistry.js`) and
`OBJECT_CAPABILITY_MAP` (`functions/scripts/governance/objectCapabilityMap.mjs`) and unioning their
ids: **57 unique ids, of which 31–32 are `active: false`** — the 30 W1-C18 itemised, all confirmed
`active: false`, plus at least `equipment.compatibility.view`
(`field-ops-app-vite/src/metadata/definitions/equipmentModel.js:124`'s `readCapability`), which its
§2.4 list does not carry. Close to the recorded figure; not identical to it.

**The important correction is what "inert" means.** It is *not* "declared but never checked". Of four
spot-checked ids, three have live enforcement call sites that simply always deny:
- `opportunity.read` → `functions/src/opportunity/opportunityReadService.ts:292-296,327-331,478-482`
  (`resolveEffectiveAccess({ permissionIds: [OPPORTUNITY_READ_CAPABILITY] })`);
- `salesOrder.fulfill` → `functions/src/fulfillment/allocateSalesOrder.ts:37-38`;
- `inventory.cycleCount.submit` → `functions/src/cycleCount/cycleCountCallables.ts:268`, also
  `functions/src/eosOps/capabilityAuthority.ts:42`.
The denial comes from `functions/src/access/resolveEffectivePermission.ts:264-265` — `active === false`
plus no activation override ⇒ `DENY / inactivePermission`, regardless of grant. So these are
**advertised and permanently blocked**, which is the transitional state working as designed.
**`admin.credentialReset.initiate` is the genuine "never enforced anywhere" case** (item 7g) — its only
`functions/src` occurrences are the catalog entry and two comments. Distinguishing the two classes
matters: the first needs an activation gate, the second needs a decision.

Seven objects are inert on **every** advertised verb: Opportunities, Sales Orders, Transfer Orders,
Serialized Assets, Invoices / AR, Payments, Sales Agreement. W1-C18's own reading: "this is not
drift — it is the transitional state". `AdminObjects.jsx:147-151,174` does render them as inert.
→ `INTENTIONALLY_DEFERRED` (the transitional state), `BLOCKS_CUTOVER` (each activation is its own
gate).

**7f. There is no machine-readable list of capabilities a governed command actually enforces, and one
cannot be derived** (W1-C18 finding 14). Capability ids reach enforcement through module constants and
an injected `authorize` seam, and at least six `*Callables.ts` wirings **discard** the id the command
passes and resolve their own (`inventoryReceiving/receivingCallables.ts:172`;
`cycleCount/cycleCountCallables.ts:163,196,227,252`;
`inventoryTransfer/transferCallables.ts:136,154,172,190`). `capability-graph.json` records
literal-reference evidence and says so itself. The missing piece is small and has a precedent:
`functions/src/eosOps/migration/inventoryWriterCapabilityCensus.ts:59` is a hand-verified 18-row
`{operationKey, sourceFile, capabilityKey, kind}` table. **Extending it to every governed command**
would make "advertised verb ⇒ enforcing command" a lookup. Real work, with an owner.
→ `PHASE3_OPERATIONAL_REVIEW`.

**7g. `admin.credentialReset.initiate` is advertised on `Users / Edit` and has no server
implementation at all.** `capability-graph.json` classifies it `CLIENT_ONLY`,
`serverReferenceCount: 0`; its only `functions/src` occurrences are the catalog entry
(`permissionCatalog.ts:1053`) and two comments (`access/adminCredentialCommands.ts:29`). Registered
`active: false`, so it grants nothing. W1-C18 did not remove it: whether the credential-reset command
should carry it is a permission-catalog decision. → `OWNER_DECISION_REQUIRED`.

**Overall disposition for item 7:** `OWNER_DECISION_REQUIRED`, with 7a's Reorder Requests row
mechanical and `BLOCKS_NONPROD`.

---

### 8 — `inventory_actions` Firestore create is the only remaining write path

**Raised by:** W1-C13 §3 (explicitly "TIER-2, OWNER DECISION") · W1-C18 §2.2.

**Evidence (verified in this tree):**
- `firestore.rules:1154-1158`:
  ```
  match /inventory_actions/{actionId} {
    allow read: if isAdminOrDispatcher() || isActiveOperationalRole("WAREHOUSE_MANAGER");
    allow create: if isAdminOrDispatcher();
    allow update, delete: if false;
  }
  ```
- No `hasOnly([...])`, **no per-field type check**, and **no
  `request.resource.data.createdBy == request.auth.uid` binding**.
- The product's writer is retired and throws unconditionally:
  `field-ops-app-vite/src/domain/inventoryActions.js:47-54` (Owner ruling 2026-08-30). Its header
  at `:28-35` states plainly: "WITH THE PRODUCT'S PATHS SHUT, THAT RULE IS NOW THE ONLY REMAINING WAY
  TO CREATE A DOCUMENT."
- Two live UI panels display the collection as attributable history:
  `PartDetail.jsx:1224` (`InventoryActionsPanel`) and `WarehouseManagerHome.jsx:90`.

**The consequence, stated:** any admin or dispatcher with a console can write an arbitrarily-shaped
document with a `createdBy` naming someone else into a collection the product presents as an audit
trail.

**Is it mechanical?** The edit is one line — `allow create: if false;`. It is **not** mechanical to
*decide*, because it is a Tier-2 Rules change and because it closes the last write path to a
collection two panels read: somebody must confirm that no operational workflow depends on a console
write. W1-C13 declined for exactly this reason, and `firestore.rules`' own comment records that the
presentation ruling did not authorize closing it.

**Also open, separately:** `ownershipMatrix.ts:396-401` classifies `inventoryAction` as
`ownerClass: "COMPANY"` with `ownerFields: []` and `backfillSource: "the stock location's
operatingCompanyId, once D-9 is populated"` — and C2's `validateObjectAdministrationProfile` rejects
`ownerClass === "COMPANY"` with no `companyField`, so **no Admin→Objects profile can be written for
this object**. W1-C13 §4: "It needs an Owner answer, not a local workaround, and operating company
must not be inferred from the Part, the warehouse, or the actor." Tonight's ruling R-B retires the
collection that inheritance names — see item **15c**.

**Blocks:** honest attribution on a live-displayed history collection; the Admin→Objects profile.

**Disposition:** `OWNER_DECISION_REQUIRED` (Tier-2).

---

### 9 — No report carries an operating-company dimension

**Raised by:** W1-C16 §3 ("REQUIRED BEFORE WAVE 3/4") · W1-C30 §3 names the same class.

**Evidence:**
- The report catalog declares **no `operatingCompanyId` field on any object**, and
  `functions/src/reporting/reportExecutionService.ts` applies **no company predicate** — it reads
  `db.collection(object.collection).limit(maxScanDocs + 1).get()` and filters in memory.
- **Latent today:** the four activated objects (`customer`→`accounts`, `contact`→`contacts`,
  `location`→`locations`, `equipment`→`equipment`) carry no `operatingCompanyId` at all, so there is
  nothing to mix.
- **Live at wave 3:** `reorder_requests` and `reorder_purchase_orders` *do* carry it —
  `firestore.rules:1067`, "A purchase order now carries operatingCompanyId, INHERITED from its
  reorder request".
- **The deferral is stale by its own lineage.** ADR-007 deferred this as "Tenant Scope stays inert
  across all waves until #140 defines it"
  (`docs/specifications/governed-object-based-report-creator.md:225`). That deferral **predates** the
  EOS ruling that `operatingCompanyId` is the governed company authority and is never inferred, so it
  should be revisited rather than inherited.

**The mechanical part** (W1-C16 §3, do at wave 3): add
`report.reorderRequest.field.operatingCompanyId.read` and
`report.purchaseOrder.field.operatingCompanyId.read` to `permissionCatalog.ts`
(`sensitivity: "standard"`, operators `filter`/`group` — a company dimension must be **groupable**,
or a consolidated figure cannot be broken out), plus the matching `f(...)` entries in **both** catalog
copies (`functions/src/reporting/reportCatalog.ts` and
`field-ops-app-vite/src/domain/reporting/reportCatalog.js`; parity enforced by
`functions/test/reportCatalogParity.test.mjs`).

**The part that is not mechanical, and is the whole point:** does a wave-3 run **default** to the
runner's company, or **require** an explicit company filter? "A silent consolidated default is the
failure mode the EOS ruling names."

**Blocks:** wave-3 reporting activation. Nothing today — reporting is environment-deactivated in
production (`functions/test/reportingActivationBoundary.test.mjs:14-16`).

**Disposition:** `OWNER_DECISION_REQUIRED` (the default), `BLOCKS_CUTOVER` (wave 3).

---

### 10 — Is a saved report user data or business configuration?

**Raised by:** ADR-007 §"Open decisions carried to the Specification / Owner" item 5 — "Sharing model
specifics (private-only first? governed share to named principals/roles?)".

**Evidence — the code has implemented the private-only interim, deliberately:**
- `functions/src/reporting/savedDefinitionCommands.ts:110,331,381,404,503` — `ownerUid` is stamped
  from the trusted `request.auth.uid`, never from `request.data`; `list` is
  `.where("ownerUid","==",params.actorUid)`; `rename`/`delete` refuse when
  `data.ownerUid !== params.actorUid`.
- Its header (`:13-20`) states the split precisely: `report.definition.{create,read,rename,duplicate,
  delete}` answer "may this principal use this action on **THEIR OWN** definitions at all"; per-record
  ownership is separate application logic and deliberately **not** a `resolveEffectivePermission`
  Scope/Condition (no new `ConditionKind`).
- `firestore.rules:1592-1594` — `reportDefinitions` is `allow read, write: if false`, and the block's
  own comment records that the client-direct design was withdrawn because Rules cannot resolve a live
  RoleAssignment, pair a mutation with an Audit Event, or run the definition validator.
- ADR-007 §3 argues the saved definition is *inert metadata that re-resolves the runner's live access*
  precisely so that "sharing and scheduling exist without a leak".
- `field-ops-app-vite/src/domain/reporting/savedReportModel.js:1-8` is unambiguous about the interim:
  "A saved report is inert metadata: a **private owner**, a name, and an embedded report definition...
  **there is deliberately no shared-with / schedule field here.**" `SAVED_REPORT_KEYS` (`:14-16`) is
  exactly `["id","name","ownerUid","definition","createdAt","updatedAt"]` — no `sharedWith`, no
  company, no tenant.
- The sequencing is written down, not merely implied:
  `docs/specifications/governed-object-based-report-creator.md:187-188` — "Private by default...
  Cross-tenant sharing is bounded by #140's tenant Scope, **inert today**"; and
  `docs/implementation-plans/governed-object-based-report-creator.md:16,84` — "private-only first,
  then governed same-tenant sharing after saved reports + export verify", with the `W-SHARE` row
  gated on "**Owner decision 4**" plus a security review.

**Why it cannot be settled mechanically.** The two framings produce different systems, not different
defaults. *User data*: private-only, owner-scoped, deleted with the user, invisible to
Administration → Objects. *Business configuration*: a governed object with its own lifecycle,
shareable to named principals or Roles, surviving its author, and appearing in the object registry —
which requires a new `ConditionKind` or a share-record collection, an Audit Event for the share
(ADR-007 §88 already reserves `sharing` as an audited action), and a decision about whether a shared
definition confers anything (ADR-007 §2.6 says it confers **no** data access — that part is settled).

**Blocks:** ADR-007's scheduling and sharing activation (open decision 4 in the same list).

**Disposition:** `OWNER_DECISION_REQUIRED` — and it is blocked on the sharing model, which is itself
the open decision. The interim (private-only, owner-scoped) is shipped and honest.

---

### 11 — May one customer's cash settle a related customer's invoice?

**Raised by:** the `eos_finance` Owner ruling's own migration (integration commit `8dfcd006`).

**Evidence (verified):** `functions/migrations/1759017600000_ar-cash-application-authority.sql:309-312`
```sql
-- NOTE: the ACCOUNT is deliberately NOT checked here. Whether one customer's cash may settle a
-- related customer's invoice (parent/child billing relationships) is business policy nobody in
-- this program has decided, and a schema that guesses it would be inventing authority. Named
-- as an open question, not silently answered in either direction.
```
What the same trigger **does** enforce (`:300-307`): the operating company **is** checked and fails
closed — a receipt may not settle an invoice on another company's books, and a NULL on either side is
refused as a mismatch rather than waved through. Over-application is refused at `:318-324`.

**The Firestore path has no concept of a remitter at all.** `functions/src/finance/paymentCommands.ts:92-96`
records that `accountId` on `ApplyPaymentInput` is "Assertion-only: must match the invoice's accountId
when supplied. **Never a choice.**" `requireInvoiceParty`
(`functions/src/finance/financialAttribution.ts:262-286`) throws `ACCOUNT_MISMATCH` on disagreement
and otherwise **derives** the receipt's account solely from the invoice
(`paymentCommands.ts:120,142-143`). There is no field on `CashReceiptRecord` or `ApplyPaymentInput`
for who actually sent the money — so today the question is not so much *answered* as *unaskable*: the
receipt is always stamped with whichever account owns the targeted invoice.

**The data prerequisite is also absent.** `parentAccountId` is **PROPOSED (D-C1-3)** in
`docs/architecture/customer-domain-foundation.md:212-216` and is **not stored today** (VERIFIED
there). W1-C9 §7 deliberately did not model it: "building either here would be schema ahead of a
decision." So today there is no machine-readable notion of a related account at all.

**Why it is not mechanical.** Three coherent answers — never (strictest, and what a per-account check
would encode), only within an explicit `parentAccountId` hierarchy, or freely with the application
row as the record of intent. Each implies a different schema constraint and a different collections
workflow, and the second requires D-C1-3 first.

**Blocks:** nothing today (no data, no surface). It is the next question after the company check.

**Disposition:** `OWNER_DECISION_REQUIRED`.

---

### 12 — `docs/architecture/repo-graph.json` has stale references

**Raised by:** W1-C21 §"REGISTRATIONS REQUIRED" item 4.

**Measured in this tree, two ways.**

*The artifact is far staler than its own stale-reference counter suggests.* Run read-only
(`node scripts/buildRepoGraph.mjs --check`, verified to write nothing — `git status` unchanged
afterwards, and the ledger file itself was moved aside so it would not inflate the count):

| | committed `repo-graph.json` | live regeneration |
|---|---|---|
| files | 2530 | **4475** |
| import edges | 2415 | **5110** |
| `hygiene.staleRefs` | 54 | **99** |
| `hygiene.orphanDocs` | 242 | 402 |
| `hygiene.unimportedCode` | 96 | 311 |

The committed artifact was last generated on 2026-08-16, before the Wave-1 merges. It is not
*slightly* behind; it describes a repository roughly half the size of the one in the tree.
`docs/architecture/repo-graph.md:33-36` explains the `staleRefs` semantics ("Only root-anchored
references are judged stale... An early version reported 1,073; anchoring cut it to 54 real ones").

*Its import graph, specifically.* The artifact declares 2530 files / 2415 import edges. **11 `imports` keys and 6
`importedBy` keys name files that no longer exist**, including all three of W1-C21's retirements:
```
functions/src/supplierService.ts
field-ops-app-vite/src/analytics/operationsIntelligenceService.ts
field-ops-app-vite/src/hooks/useAssignedJobs.js
```
plus eight that predate Wave 1 (`useWarehouses.js`, three `dispatcherBoard/*.jsx`,
`controlTower/panels/OverloadedTechPanel.jsx`, `warehouseReconciliationEngine.*`) and, in the edge
*values*, `functions/src/warehouseService.ts` and `functions/src/warehouseAnalyticsBridge.ts`.
`docRefs` and `workflowPaths` keys are clean; 126 `inboundDocLinks` keys are stale, which is the
ordinary decay of a doc-link census.

**Nothing fails.** `node --test scripts/repoGraph.test.mjs` → **13/13 pass**, and
`.github/workflows/repo-graph-tests.yml` regenerates the artifact report-only (`:32` runs the test,
`:34` runs `node scripts/buildRepoGraph.mjs`) with **no `git diff --exit-code`**, so staleness can
never turn a build red. W1-C21 deliberately did not regenerate it to avoid colliding with ten
concurrent lanes.

**Mechanical answer:** run `node scripts/buildRepoGraph.mjs` from the repo root and commit. The result
is deterministic. Whether the workflow should *also* diff-check is a CI-owner call.

**Blocks:** nothing. It misleads a reader.

**Disposition:** `BLOCKS_NONPROD` (mechanical — an accuracy defect in a committed architecture
artifact, closable in one command).

---

### 13 — 37 frontend `.test.mjs` suites are absent from `suites.json`

**Raised by:** integration commit `0b95a347` — the fourth field census escaped every local sweep
because `field-ops-app-vite/test/policyObjectRegistry.test.mjs` is one of them.

**Verified, and the claim needs one correction.** The number **37 is exact for `.test.mjs`**, and it
is the number that matters: `field-ops-app-vite/test/suites.json` registers **291** suites, is a flat
literal list with **no globs**, and is what `npm test` runs via
`field-ops-app-vite/scripts/runSuites.mjs`. There are 328 `.test.mjs` files in `test/`; 37 are not in
the manifest. All 37 are individually named by a workflow `run:` step (e.g.
`.github/workflows/account-attention-projection-tests.yml`,
`.github/workflows/work-order-intelligence-tests.yml`), so they **do** run in CI — but only when that
workflow's path filter fires, never under `npm test`. That is exactly the hole `0b95a347` fell into.

**The claim is wrong if read as "`.test.mjs` **and** `.test.jsx`":** `suites.json` never contains a
`.jsx` entry at all — jsx suites are vitest, run by `npm run test:components`. The combined count of
frontend test files absent from `suites.json` is **263**, not 37.

**The guard exists and passes.** `field-ops-app-vite/test/ciSuiteCoverage.test.mjs` asserts every
`.test.mjs` is in `suites.json` **or** named by a workflow (no allowlist on that side), and every
`.test.jsx` is workflow-named **or** on a shrink-only `KNOWN_UNNAMED` allowlist (currently 50 entries,
ceiling `<= 54`). Run here: **5/5 pass.** So the 37 are a *known, guarded* state, not an escape.

**NEW, surfaced tonight — the guard has a blind spot.** `ciSuiteCoverage.test.mjs:93,156,170` use
non-recursive `readdirSync(here)` over `test/`, so the **7 files in
`field-ops-app-vite/test/__visual__/*.test.jsx` are invisible to every one of its assertions**. They
are named by zero workflows. They are not unrun — `field-ops-app-vite/vitest.config.js:49`'s
`include: ["test/**/*.test.jsx"]` is recursive, so `npm run test:components` sweeps them — but the
guard's census does not know they exist and would not notice if they stopped being run.

**Mechanical answer:** make the guard's directory walk recursive. Whether the 37 should be *moved into*
`suites.json` is a CI-ownership judgement, not mechanical: each currently has a dedicated
path-filtered workflow that reports as its own family failure, which is the point of a family lane
(W1-C26 §"Registration a shared-file owner should add" makes exactly this argument).

**Blocks:** nothing is unrun. It blocks a *local sweep* from being trustworthy — the concrete harm
`0b95a347` names.

**Disposition:** `BLOCKS_NONPROD` — the `__visual__` blind spot is mechanical; the 37's registration
is `PHASE3_OPERATIONAL_REVIEW`.

---

### 14 — Overlapping blocked time · **RULED TONIGHT (R-A)**

See §1. `CLOSED_BY_OWNER_RULING`. Residual mechanical work: withdraw the ND-25 write-time refusal
(`functions/src/scheduling/schedulingCommands.ts:460-469` and the source assertion at
`functions/test/schedulingBlockedTimeExclusion.test.mjs:156`), and make
`field-ops-app-vite/src/domain/dispatchBoardGeometry.js:221-230` de-duplicate the way
`functions/src/scheduling/availabilityModel.ts:293-312` already does.

**Note on what the ruling does *not* undo.** ND-25's *other* half — that both
`createTechnicianBlockedTime` and `deleteTechnicianBlockedTime` now read **and write**
`work_order_tech_locks/{technicianId}` — is a serialization primitive, not an overlap rule, and
nothing in the ruling touches it. The ND-20 asymmetry (an absence is never refused because work is
already placed there; a placement *is* refused into blocked time — `placementPolicy.ts:99`) likewise
stands.

**14b.** Overlapping `weeklyHours` intervals within one weekday (W1-C27 §5 Q3): also
`CLOSED_BY_OWNER_RULING`. `validation.ts:177-197` accepts the overlap and
`availabilityModel.ts:102-122` `normalizeIntervals` merges it — which *is* the union. C27's recorded
residual risk (a reader misinterpreting `[07:00–16:00, 12:00–13:00]` as a lunch *subtraction*) is a
documentation matter; the file's own idiom for a lunch is a gap, not a second interval
(`types.ts:31-33`).

---

### 15 — `stock_locations` retirement · **RULED TONIGHT (R-B)**

See §1. `CLOSED_BY_OWNER_RULING`, and `BLOCKS_NONPROD` until the mechanical residual lands (two guards
are red in this tree right now). Two sub-items are **not** closed by the ruling:

**15b — does the retirement also withdraw the Ownership-v1 stamping plan?**
`functions/src/ownership/ownershipBackfillRules.ts:99` (`{ collection: "stock_locations", fields:
["operatingCompanyId"], evaluate: companyFromRoot(["warehouseId"]) }`) and `:228` (`stock_locations: 5`)
are a one-time stamping plan over 5 sandbox documents that still exist, with
`functions/src/ownership/ownershipDerivation.ts:80` declaring the matching derivation. W1-C3 and
W1-C21 both left it deliberately — "deleting the rule while the rows remain would make the plan
silently incomplete" — and W1-C31 §4 confirms `ownershipBackfillRules.ts` is unchanged and no backfill
has run. Retiring a *list/metadata registration* does not say whether the *stamping plan* goes too,
and deleting the 5 rows would be a cutover this wave prohibits.
→ `OWNER_DECISION_REQUIRED`.

**15c — what inherits company now?** `functions/src/ownership/ownershipMatrix.ts:392,399,406,414`
names `stock_locations` as the company-inheritance source for **four** families —
`inventoryTransaction`, `inventoryAction`, `transfer`, `cycleCount` ("the stock location's
operatingCompanyId, once D-9 is populated"). `ownershipMatrix.ts:295-323` records that D-9's two real
roots are `warehouses` and `mobile_locations`, both `OWNERLESS_UNTIL_SUPPLIED`; `:327-334` reclassified
`stockLocation` from root to *derived* ("a per-warehouse-per-part balance, not a physical place")
precisely so its company would be constitutive rather than inferred. Retiring the collection removes
the intermediate hop those four rows name. **This is a new contradiction created by tonight's ruling**,
not a pre-existing one. The obvious answer — those four inherit from the **warehouse** directly — is
one the matrix's own D-10 reasoning supports, but it is a company-authority statement and this lane
will not make it.
→ `OWNER_DECISION_REQUIRED`.

---

### 16 — Which collection *is* the Purchase Order?

**Raised by:** W1-C8 §4 · W1-C24 §4 dimension 15 and §7 · `LISTS-P2-COLLECTION-DISPOSITION.md` §11.2
(`PURCHASE_ORDER_MONEY_LIVES_ON_A_DIFFERENT_COLLECTION`, owner: Financial).

**Evidence:** two purchase-order representations exist and only `reorder_purchase_orders` is governed.
`purchaseOrderNormalization.ts` records that whether the canonical `procurementService.ts` /
`procurementBridge.ts` layer is **retired or converted** is an open Owner decision, and that its price
field is a **currency-less float that must not become a cost authority**. Migration 008 therefore made
`receiving_orders.source_purchase_order_id` an opaque id with a stated `source_kind`, **not** a foreign
key, "so a canonical receipt stays representable without this schema pretending to hold an authority
it does not". The same question surfaces as a label divergence in Admin → Objects:
`purchaseOrderEntity.label` is `"Purchase Order"` while the report catalog relabelled the same
collection `"Reorder Purchase Order"` (W1-C24 dim 15) — recorded as a ledgered divergence and
deliberately not corrected, because "renaming an object to settle a label takes that decision by
accident". It is also one of the four DEFERRED rows in DECISIONS' R-1 permission analysis
(`docs/DECISIONS.md:909` — "architecture ambiguity: two purchase-order collections exist ... resolve
before any permission").

**Why it is not mechanical.** Retire vs convert changes which records are authoritative, whether the
float price is migrated or discarded, and whether `receiving_orders` gains a real foreign key.

**Blocks:** a purchasing permission model; the Admin → Objects label; the Purchase Order cost
authority.

**Disposition:** `OWNER_DECISION_REQUIRED`.

---

### 17 — What does a VOID invoice mean, and who may void one?

**Raised by:** W1-C11 §"What was NOT registered because it does not exist" · W1-C17 §5 (third bullet).
**Same question, two halves.**

**Evidence:**
- **Nothing sets VOID.** Every occurrence of `"VOID"` under `functions/src/finance/` is a *read* —
  `paymentCommands.ts:84,123`, `adjustmentCommands.ts:88`, `refundCommands.ts:79`,
  `financeReadProjection.ts:41,47`, `financialReconciliation.ts:142`. Four commands *refuse to act on*
  a void invoice; none creates one.
- Migration `1758931200000` gave `invoices` the `voided_at` / `void_reason` / `voided_by` columns
  anyway, because the AR read already **projects** a VOID position.
- **And the arithmetic disagrees with the projection.** `financeReadProjection.ts` `deriveArPosition`
  returns `VOID`, but `deriveOutstandingMinor` still returns `total − applied − …` for it, so
  `summarizeAccountAr` counts it in `openCount` / `outstandingByCurrency` and `summarizeArAging` files
  it under `currentMinor`. **A void invoice is still counted as owed.**

**Why it is not mechanical.** W1-C11: inventing the command means deciding "who may void, on what
evidence, with what effect on issued numbering". W1-C17: deciding what a voided invoice's outstanding
means "is a policy call that also has to agree with `financialReconciliation.ts:100`".

**Blocks:** nothing today — the state is **unreachable** because no command can produce it.

**Disposition:** `OWNER_DECISION_REQUIRED` (latent; unreachable until a void command exists).

---

### 18 — The technician identity trap: `users/{uid}.technicianId` spent as an Employee id

**Raised by:** W1-C5 §8 (fenced with a shrink-only ratchet) · W1-C27 §4 (confirms and extends).

**Evidence:**
- `functions/src/callerContext.ts:14-21` — `getCallerContext()` returns
  `technicianId: data?.technicianId`, a **`fieldops_technicians` doc id**.
- Four call sites spend that value where `trucks.assignedDriverEmployeeId` — an **Employee** id — is
  the declared authority. Ratcheted by `functions/test/employeePrincipalLinkPlan.test.mjs`
  (`USER_TECHNICIAN_ID_READERS`, `TECHNICIAN_ID_AS_DRIVER_EMPLOYEE_ID`): a **new** fallback fails the
  test; removing one is a one-line edit there.
- `field-ops-app-vite/src/domain/actorDisplayName.js:61` agrees explicitly — "a `fieldops_technicians`
  doc id, NOT a Firebase uid".
- W1-C27 §4: the scheduling domain is a **live consumer of the compatibility collection as assignment
  authority** — `schedulingRepository.ts:32` `loadTechnician` is the existence and eligibility gate for
  *every* placement, and `schedulingReadService.ts:78` enumerates the technician roster from it.
- Two `firestore.rules` visibility predicates route through `callerTechnicianId()`
  (`firestore.rules:325`): `:363` (`fieldops_jobs`) and `:406-409` (`fieldops_technicians`).

**The replacement already exists and is proved:** `resolveEmployeeIdForPrincipal()` in
`functions/src/employeeIdentity/employeePrincipalLinkRepository.ts` answers "which Employee is this
principal" with **no fallback chain** — null is a complete answer. Backed by
`eos_policy.employee_principal_links` (migration `1758412800000`).

**Why neither lane rewired it.** The suites covering the deployed callables
(`functions/test/cycleCountAssignedMobileLocation.test.mjs` and siblings) are **Firestore-emulator
suites that cannot run in this environment**, and C5 would not change a production authorization path
without being able to run its tests. C27 reached the same conclusion independently.

**Is it mechanical?** The *swap* is; the *cutover* is not — it changes who can see what, on a deployed
path, and cannot be verified here. It also has to be sequenced with the Rules predicates at
`firestore.rules:363,406-409`, which means resolving the key space first.

**Blocks:** retiring `fieldops_technicians` as assignment authority; item 3's Rules seam.

**Disposition:** `BLOCKS_NONPROD` (the covering suites cannot run here — see §5), sequenced behind an
environment that can run emulator suites.

---

### 19 — `fieldops_technicians.status` is a stored aggregate that drifts

**Raised by:** W1-C27 §5 Q5 — "the largest finding in this lane".

**Evidence (verified unchanged in this tree):**
- It is a stored three-valued summary (`available` / `on_job` / `off_shift`) of a question whose real
  answer is intervals: working hours, blocked time, and the live Work Order lifecycle.
- **Written by:** `completeAssignedJob.ts:316` (→ `available`), client
  `field-ops-app-vite/src/domain/jobActions.js:121` (→ `on_job`) and `:80` (→ `available`) — all three
  on the **legacy `fieldops_jobs`** flow — plus any admin or dispatcher by hand via
  `firestore.rules:418`.
- **Never written by** the governed Work Order lifecycle: `transitionWorkOrder.ts` references no
  technician collection, and neither does any command in `functions/src/scheduling/`.
- **Read as authority by:** `placementPolicy.ts:90` (eligibility gate — currently benign, since all
  three enum values pass) and `technicianRecommendationEngine.ts:119-127` (**20% of the recommendation
  score**; `AVAILABILITY_BY_STATUS = { available: 100, on_job: 50, off_shift: 0 }`).
- **Therefore:** a technician on recorded PTO reads `available`; a technician whose only work is
  governed Work Orders can read `on_job` indefinitely. It "drifts by default and is right by
  coincidence".

**Why it is not mechanical.** Removing it means the recommendation engine needs a different
availability input — which is item **20**, an unmade formula decision. Making the governed lifecycle
write it would be adding a second authority for a fact the interval model already holds.

**Blocks:** the accuracy of dispatch recommendations; nothing fails.

**Disposition:** `PHASE3_OPERATIONAL_REVIEW`.

---

### 20 — How does governed availability become a 0–100 recommendation score?

**Raised by:** W1-C27 §5 Q4.

**Evidence:** `field-ops-app-vite/src/domain/technicianRecommendationEngine.ts:119-127` — Factor C,
*Availability*, 20% of the score, reads `fieldops_technicians.status`. The governed availability
authority (`technician_working_availability` / `technician_blocked_time`) is **never consulted**, so a
technician on recorded PTO still scores 100. The board already holds the governed answer for the same
technicians in the same render (`DispatcherBoard.jsx:131-137` → `availabilityByTechnicianId`) and does
not pass it to the engine (`:210`). Factor D, *Territory*, returns a constant 50 for everyone
(`:139-141`) — correctly degraded, but 15% of every score is noise.

**Why it is not mechanical, in C27's own words:** the engine scores **unplaced** queue cards, which
have no window, while the governed availability read is **windowed** over the whole visible view.
"Turning 'available minutes over a fortnight' into a 0–100 availability score is a formula nobody has
chosen, and inventing one would be the speculative architecture this lane was told to avoid. **It
needs a ruling, not a patch.**"

**Also recorded:** `ADR-004:13` says the recommendation engine is "design-stage only, no
implementation exists". That is **stale** — it is implemented and wired into `DispatcherBoard.jsx:16,210`,
and ADR-004 §12's acceptance checklist is entirely unticked for a shipped feature.

**Disposition:** `OWNER_DECISION_REQUIRED` (the formula), with the stale ADR a
`PHASE3_OPERATIONAL_REVIEW` doc correction.

---

### 21 — The legacy job dispatch path authorizes in Firestore Rules

**Raised by:** W1-C27 §5 Q1 — named as "the prohibited class".

**Evidence:** `assignJob` (`field-ops-app-vite/src/domain/jobActions.js:89-131`) is a **client-side
transaction** writing `fieldops_jobs.technicianId`/`status` and `fieldops_technicians.status`
directly. The only thing between a browser and a dispatch assignment is `isAdminOrDispatcher()` at
`firestore.rules:373-395` and `:418`. That is authorization, workflow **and** assignment routing in
Rules. By contrast the governed Work Order scheduling domain enforces in server commands
(`schedulingCommands.ts:82-91` `requireDispatcher`, `schedulingReadService.ts:63`), and both
availability collections are `allow read, write: if false` (`firestore.rules:1773,1776`) with
visibility decided by a server projection — "the correct posture, already in place".

Its guard is a **client-side check-then-act that Firestore happens to rescue** (W1-C27 Q2.3):
`jobActions.js:110-123` reads the technician doc, refuses unless `status === available`, then writes,
inside `runTransaction` with the doc in the read set — so the race is caught, but the guard is
`TECH_STATUS`, the stale aggregate of item 19. "It serializes correctly on a field that is frequently
wrong."

**Why it is not mechanical.** Retiring the legacy `fieldops_jobs` dispatch path is a domain retirement
(the W4 intention recorded at `docs/DECISIONS.md:909`), not a Rules edit, and its Rules predicates
route through the identity trap (item 18).

**Blocks:** the program's standing prohibition on Rules-as-authorization.

**Disposition:** `BLOCKS_CUTOVER`.

---

### 22 — Is a Supplier company-scoped?

**Raised by:** W1-C6 §"Open question this lane surfaced but did NOT settle".

**Evidence (verified, still open):** `functions/src/ownership/ownershipMatrix.ts:496-505` —
```
family: "supplier", collection: "suppliers", ownerClass: "REFERENCE", ownerType: null,
unresolvedPolicy: "PROVISIONALLY not ownable -- pending the Owner ruling in the note",
note: "OPEN QUESTION. Supplier identity is shared; supplier terms may be per-company. If
       `suppliers` carries commercial terms, it is company-scoped and belongs in COMPANY,
       not REFERENCE."
```

**What W1-C6 established for whoever rules:** every commercial term — cost, currency, lead time,
minimum order quantity, order multiple, contract window — already lives on `supplier_catalog_items`,
**not** on `suppliers`. The Supplier record carries identity, contact and `payment_terms_ref`, which
`supplierMasterTypes.ts` states is "a label/reference, not a terms engine". **If the ruling is "terms
are company-scoped", the column lands on `supplier_catalog_items`, and both tables are still empty, so
it is a one-line additive migration.**

**Why migration 008 did not settle it by adding a column:** no governed source record carries an
operating company, so a `NOT NULL` column would have to be defaulted or backfilled with a value nobody
stated, and a nullable one would record "we do not know" as data.

**Related, unchanged production gap (W1-C6 §5):** no standing role carries
`inventory.catalog.activate`, so supplier activate/deactivate fails closed
(`docs/releases/supplier-master-rc-1.md`).

**Disposition:** `OWNER_DECISION_REQUIRED` — the cheapest open item on this list to answer.

---

### 23 — `submit_work` is not idempotent across a merged intake

**Raised by:** W1-C22 §3.

**Evidence:** `GitHubArtifactStore.submit`
(`integrations/chatgpt-eos-intake/src/githubStore.mjs:21-37`) is replay-safe only while the intake
branch still exists — a 422 on branch creation compares the stored `sha256` and returns
`replayed: true`. Once the intake PR is merged and the branch deleted, a retry of the same `requestId`
creates the branch again; and because `buildIntake` stamps `createdAt`/`updatedAt` from `now()`
(`src/artifacts.mjs:8,:34`), the recomputed `sha256` differs — so the retry opens a **second** pull
request rewriting the already-merged artifact at the same location with a new hash.

**Why it is not mechanical:** it is a contract decision with two coherent options, each changing the
published tool's observable behaviour — (a) make the artifact genuinely content-addressed by deriving
timestamps from the request rather than the clock, or (b) have `submit` read `main` for an existing
`<requestId>.work.json` before creating a branch and return the merged pointer.

**Blocks:** the intake contract's replay guarantee.

**Disposition:** `OWNER_DECISION_REQUIRED` (contract owner, not the platform).

---

### 24 — Job Assignments: a distinct board, or a view of Work Orders?

**Raised by:** `LISTS-P2-COLLECTION-DISPOSITION.md` §5 and §11.2 (BLOCKED, owner: Owner) · W1-C24 §7.

**Evidence:** still nav-mounted at `/service/job-assignments`. Its *presentation* was corrected in
§10 of that document; the product question is untouched and "is not a rendering question". The
disposition explicitly notes it is "the same shape as the Employees/Technicians question settled
2026-08-20" — i.e. a family-vs-role decision the Owner has made once before.

**The other four BLOCKED list surfaces** in the same section are not decisions but missing reads, and
this wave did not supply any of them (verified by W1-C24 §7: "no global contacts route,
`AdministrationUnavailable` still mounted, Job Assignments still nav-mounted, the Transfers part cell
still `Unresolved reference`"): Contacts global index (needs a route + a per-contact read), Returns
register (needs a register read, and building one implies stock effects the authority refuses),
Audit Logs / Permission Preview (needs a deployed Cloud Function read path), Transfers → part label
(needs a list-level part-name projection). W1-C24 confirms the BLOCKED set is **unchanged, not
superseded**, by this wave's authority moves.

**Disposition:** `OWNER_DECISION_REQUIRED` for Job Assignments; `PHASE3_OPERATIONAL_REVIEW` for the
other four.

---

### 25 — `technicianRecommendationEngine` / ADR-004 and other stale authority documents

**Raised by:** W1-C27 §5 Q4 (ADR-004 stale) · W1-C4 §A (two client metadata files claim the truck
callables are undeployed; `functions/src/index.ts:255-265` exports all nine, and the accurate posture
is two lines above at `:249-251` — deployed to `eos-platform-sandbox`, not to production;
`mobileLocation.js:77-84` also asserts no client reader exists while
`services/truckRegistryQueries.js:34` is one) · item 2's DECISIONS #143 / SYSTEM_AUTHORITIES.md
divergence · item 20's ADR-004.

**Why grouped:** each is a document asserting something the code contradicts. None changes behaviour;
all mislead the next reader, and W1-C4 explicitly notes "the same stale sentence pattern appears in
sibling definitions other lanes own — it should be corrected in one pass."

**Mechanical?** Yes for the deployment claims and the ADR-004 status line. **No** for DECISIONS #143 /
SYSTEM_AUTHORITIES.md: amending a *ruling* to match code is a decision about which one is right, and
item 2 is that decision.

**Disposition:** `PHASE3_OPERATIONAL_REVIEW` (one documentation pass), except the #143 half which
rides on item 2.

---

## 3. Disposition summary

**25 items after deduplication**, from ~90 raised notes across 31 handoff documents, 18 migration
headers, `LISTS-P2-COLLECTION-DISPOSITION.md`, ADR-004 / ADR-007 / ADR-010, and 3 integration commits.
Several items carry a primary and a secondary disposition (a question that is *both* undecided *and*
holding a gate); the primary is what the item is counted under.

| Item | Primary | Secondary |
|---|---|---|
| 1 · allocation is operating-company blind | `OWNER_DECISION_REQUIRED` | `BLOCKS_CUTOVER` |
| 2 · Work Order `operatingCompanyId` | `OWNER_DECISION_REQUIRED` | — |
| 3 · Work Order visibility capability | `OWNER_DECISION_REQUIRED` | `BLOCKS_CUTOVER` |
| 4 · does commitment subtract CONSUMED | `OWNER_DECISION_REQUIRED` | — |
| 5 · allocation skips the reservation lock | `BLOCKS_CUTOVER` | mechanical, after 4 |
| 6 · serialized: ADR-010 ledger effect | `OWNER_DECISION_REQUIRED` | vocabulary half `CLOSED_BY_PHASE2`; enum widening `INTENTIONALLY_DEFERRED` |
| 7 · Administration capability/object governance (7a–7g) | `OWNER_DECISION_REQUIRED` | 7a Reorder-Requests row `BLOCKS_NONPROD` (mechanical); 7d/7f `PHASE3_OPERATIONAL_REVIEW`; 7e `INTENTIONALLY_DEFERRED` + `BLOCKS_CUTOVER` |
| 8 · `inventory_actions` unvalidated create | `OWNER_DECISION_REQUIRED` (Tier-2) | — |
| 9 · reporting operating-company dimension | `OWNER_DECISION_REQUIRED` | `BLOCKS_CUTOVER` (wave 3) |
| 10 · saved-report ownership | `OWNER_DECISION_REQUIRED` | blocked on the sharing model, itself open |
| 11 · related-account cash application | `OWNER_DECISION_REQUIRED` | — |
| 12 · stale `repo-graph.json` | `BLOCKS_NONPROD` | mechanical — one command |
| 13 · 37 unregistered `.test.mjs` + `__visual__` blind spot | `BLOCKS_NONPROD` | registration itself `PHASE3_OPERATIONAL_REVIEW` |
| 14 · overlapping blocked time (+14b weeklyHours) | `CLOSED_BY_OWNER_RULING` | mechanical residual |
| 15 · `stock_locations` retirement | `CLOSED_BY_OWNER_RULING` | `BLOCKS_NONPROD` until the residual lands |
| 15b · does retirement withdraw the stamping plan | `OWNER_DECISION_REQUIRED` | — |
| 15c · what do four families inherit company from now | `OWNER_DECISION_REQUIRED` | new tonight |
| 16 · which collection *is* the Purchase Order | `OWNER_DECISION_REQUIRED` | — |
| 17 · voiding an invoice | `OWNER_DECISION_REQUIRED` | latent — unreachable today |
| 18 · technician identity trap | `BLOCKS_NONPROD` | covering suites cannot run here |
| 19 · `fieldops_technicians.status` drifts | `PHASE3_OPERATIONAL_REVIEW` | — |
| 20 · availability→score formula | `OWNER_DECISION_REQUIRED` | stale ADR-004 `PHASE3_OPERATIONAL_REVIEW` |
| 21 · legacy job dispatch authorizes in Rules | `BLOCKS_CUTOVER` | — |
| 22 · is a Supplier company-scoped | `OWNER_DECISION_REQUIRED` | — |
| 23 · `submit_work` replay idempotency | `OWNER_DECISION_REQUIRED` | — |
| 24 · Job Assignments | `OWNER_DECISION_REQUIRED` | four other BLOCKED surfaces `PHASE3_OPERATIONAL_REVIEW` |
| 25 · stale authority documents | `PHASE3_OPERATIONAL_REVIEW` | the #143 half rides on item 2 |

**Counts by primary disposition**

| Disposition | Count |
|---|---|
| `OWNER_DECISION_REQUIRED` | **17** (items 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 15b, 15c, 16, 17, 20, 22, 23, 24 — 18 rows, collapsing 15b/15c into one §6 question gives **20 distinct questions**) |
| `BLOCKS_NONPROD` | **4** (12, 13, 15-residual, 18) |
| `BLOCKS_CUTOVER` | **3** (5, 21, and 9's wave-3 arm) |
| `CLOSED_BY_OWNER_RULING` | **2** (14 + 14b, 15) |
| `PHASE3_OPERATIONAL_REVIEW` | **2** (19, 25) |
| `CLOSED_BY_PHASE2` | **11 previously-open items** — see §4 |
| `INTENTIONALLY_DEFERRED` | **2** (the serialized enum widening; the inert transitional capability state) |

**`BLOCKS_NONPROD` vs `BLOCKS_CUTOVER`, stated plainly.**
- `BLOCKS_NONPROD` = something is **red, stale or blind right now** in a gate that is supposed to be
  green: two index guards failing (15), a committed architecture artifact describing half the
  repository (12), a guard that cannot see 7 of its own test files (13), a governance contract that
  omits an entire object (7a), and an identity defect whose covering suites this environment cannot
  run (18). None of these touches production. All are fixable without an Owner answer except 15b/15c
  and 7a's sibling questions.
- `BLOCKS_CUTOVER` = **latent today, live on activation.** Each is held harmless only by a switch that
  is currently off: `salesOrder.fulfill` is `active: false` (1, 5); reporting is
  environment-deactivated in production (9); the 30-odd inert ids deny unconditionally (7e); the
  legacy `fieldops_jobs` dispatch path is a live client-side Rules-authorized write that survives only
  because the governed Work Order path has not replaced it (21). Turning any of these on without the
  corresponding decision converts a latent defect into a live one.

## 4. Previously-open items found ALREADY CLOSED in the integrated tree

These were raised against pre-integration code and are stale as written. Carrying them forward would
be as costly as missing a real one.

| Item as raised | Where raised | State at `d104cf49` |
|---|---|---|
| "The ownership matrix declares `fieldops_wos.operatingCompanyId`, a field the type lacks" | W1-C19 §"Findings" 1 | **CLOSED.** `functions/src/ownership/ownershipMatrix.ts:248-249` now reads `ownerFields: []`, with the measurement written out inline at `:230-243`. The *governance documents* still disagree — that residual is item 2. |
| "`ownershipMatrix.ts` family labels are inverted — `workOrder`→`fieldops_jobs`, `workOrderLegacy`→`fieldops_wos`" | W1-C19 §"Findings" 2 | **CLOSED.** `:248` `family: "workOrder", collection: "fieldops_wos"`; `:267` `family: "workOrderLegacy", collection: "fieldops_jobs"`. |
| "`ownershipMatrix.ts:143-145` is stale — it says `operatingCompanyId` is NOT STORED TODAY on the commercial rows" | W1-C10 §5 finding 1 | **CLOSED.** `:141-150` now reads "Ruling R-8. NOW STORED", names `commercialCompanyScope.ts` as the authority and cites the three writers. |
| "`firestore.rules:353-358`'s `fieldops_jobs` READ comment is stale — no client issues that query" | W1-C21 §"REGISTRATIONS" 3 | **CLOSED.** The comment at `firestore.rules:354-358` now reads as the correct posture. |
| "`profiles/part.js:377` lists a deleted file in `readBy`" | W1-C21 §"REGISTRATIONS" 2 | **CLOSED.** `:377` now records the deletion explicitly ("WAS a reader and was deleted by W1-C21"). |
| "`inventory.action.create` is advertised as a Create nothing can perform" | W1-C13 §2 | **CLOSED** by W1-C18 §3.1 in both `objectPermissionMap.js:54` and `scripts/reconcileCrudMatrix.mjs:113`. |
| "Seven Wave-1 suites run in no npm script and no workflow (121 assertions enforced by nothing)" · "CI path filters lanes C5/C9/C18/C31 could not make" · "`firebase-exit-manifest` lists 4 keys where the guard fences 12" · "`integrations/` tests are run by no workflow" · "`firebase-exit-guard.yml` does not path-filter `integrations/**`" | W1-C5 §1-3, C9 §1-2, C16 §1, C17 §1, C18 §5.1, C22 §1, C26, C28 §1-2, C31 §2 | **ALL CLOSED at the integration** (`8dfcd006`). Verified: `functions/package.json` `test:reporting` now names `reportTruncationHonesty`; `test:governance` names `administrationObjectDrift`; `.github/workflows/finance-invoice-persistence-tests.yml:59,110,158` carries `financialCompanyDimension`; `financials-north-star-tests.yml:41,67` carries `companyAttribution.js`; `eos-admin-policy-tests.yml:77,80,126,129` carries the CRM and employeeIdentity filters; `eos-ownership-model-tests.yml:51` carries `sb-evidence/ownership-census-*.txt`; `.github/workflows/integrations-intake-tests.yml` exists; `firebase-exit-guard.yml:19,30` includes `integrations/**`; `firebase-exit-manifest.json` `BUSINESS_RUNTIME.baselineKeys` now lists **12** keys. |
| "Register the Invoice and Payment administration profiles once C2 lands" · "register `inventoryActionRetirementContract.test.mjs` in `suites.json`" | W1-C11 §1, C12 §2, C13 §1 | **CLOSED.** `administrationProfileRegistry.js` imports and lists `invoiceAdministrationProfile`, `partAdministrationProfile`, `paymentAdministrationProfile`; `suites.json:365` carries the retirement contract and `:569` the profile suite. |
| "Invoice vs Payment schema collision — `eos_ops.invoices` vs 1881's forbidden-table assertion" | rehearsal §6 | **CLOSED by the `eos_finance` Owner ruling**, applied at `8dfcd006`. Both authorities now live in `eos_finance`; `payment_applications.invoice_id` is a real composite foreign key; the guard was strengthened to prove both halves rather than deleted. |
| "The serialized status vocabulary is 8-vs-5 and STAGED/DELIVERED are unrepresentable" | W1-C7 §3.1 | **NARROWED to unreachable** by W1-C20 §3: no writer exists for STAGED/DELIVERED/LOADED/RESERVED anywhere, pinned by `functions/test/serializedCustodyTypedPair.test.mjs`. The live half (`RECEIVED`, `IN_TRANSIT`) is ruled: refuse at import. |
| "INSTALLED custody semantics are undefined" | carried into this lane's brief; W1-C20 §4.1 OR-3 | **DEFINED, in two agreeing places.** `functions/src/eosOps/operatingCompanyCustody.ts:35-38` and `:114-119` (`isInstalledCustodyConsistent`, the `INSTALLED ⟺ EQUIPMENT` biconditional); `functions/src/eosOps/equipmentCustody.ts:118-140` and ADR-010 §2 name the account, through the minted `equipment/{id}` record. What is open is the **ledger effect** (ADR-010 §3 vs migration 007), which is a different question — item 6. |
| "30 of 58 advertised ids are declared but never checked or enforced anywhere" | as framed into this lane's brief | **The count is close (57 unique / 31–32 inert) but the characterization is wrong.** Three of four spot-checked ids have live `resolveEffectiveAccess` call sites and are denied by `resolveEffectivePermission.ts:264-265`'s `active: false` rule, not by absence of a check. Only `admin.credentialReset.initiate` is genuinely unreferenced. Item 7e. |
| "37 unregistered frontend `.test.mjs`/`.test.jsx` suites absent from `suites.json`" | integration commit `0b95a347` | **37 is exact for `.test.mjs` and that is the number that matters** — but `suites.json` contains no `.jsx` entry at all, so the combined figure is 263, and `field-ops-app-vite/test/ciSuiteCoverage.test.mjs` already guards the state (5/5 pass here). Item 13. |

---

## 5. UNPROVEN

| Claim | Why it could not be settled here |
|---|---|
| Whether the ND-25 overlap refusal (item 14) actually fails the `#1549` E2E contract **at runtime** | `functions/test/e2e/schedulingAvailabilityEmulator.test.mjs` is a **Firestore-emulator suite**. Port 8080 on this host holds an unrelated uvicorn service and the Admin SDK retries forever rather than failing, so the suite hangs. The contradiction is proved from source (`schedulingCommands.ts:460-469` refuses the overlap; `schedulingAvailabilityEmulator.test.mjs:370-377` requires it) and by integration commit `0b95a347`'s own account of the CI failure, **not** by an executed run here. |
| Whether item 18's rewire would break a deployed authorization path | The covering suites (`functions/test/cycleCountAssignedMobileLocation.test.mjs` and siblings) are emulator-only. Same environment constraint. This is exactly why W1-C5 fenced rather than fixed. |
| Whether the 21 `permMap`/`capMap` disagreements (7a) are individually defects | W1-C18 measured them and stated that "most of those rows are a judgement nobody has written down". This lane re-read the census and did not re-derive all 21 row by row. The **two structural** ones (Work Orders / Delete, Reorder Requests) were verified. |
| Whether any of the 30 inert ids (7e) would behave correctly if activated | Activation is a per-environment gate outside this lane; no capability was activated to test. |
| The exact live/declared index reconciliation after item 15's residual lands | `scripts/indexDriftGuard.test.mjs`'s measured estate was last taken against a live project. Nothing was deployed, so `0b95a347`'s arithmetic (38 live · 42 declared · 34 declared-AND-live · 8 declared-not-live · 4 live-but-undeclared) is the best available figure and was not re-measured here. The guard's live-computed value **is** 34 against an asserted 35, which is consistent with it. |
| Whether item 10's phrase "blocked on an open sharing-model decision" is a literal repository statement | The **substance** is verified (ADR-007 open decision 5; `W-SHARE` gated on "Owner decision 4" in the implementation plan; `savedReportModel.js:1-8`'s "deliberately no shared-with… field"). No file uses the word "blocked" for it. Stated as sequencing, not as a blocker, in the source. |
| Whether the 21 disagreements are exactly 21 today | Re-counted: §2.3's table has exactly 21 data rows and six were spot-checked against current code and matched exactly. **No test pins the number**, so it is an accurate manual census rather than a machine-enforced invariant, and a lane could move it without anything going red. |

---

## 6. The `OWNER_DECISION_REQUIRED` list, as questions

Stated so they can be answered without reading the repository. Each is one decision.

1. **Inventory allocation.** When a Sales Order for one operating company is allocated, may it draw
   stock from a warehouse that belongs to a different company — or from a warehouse whose company
   nobody has recorded? (Today: yes to both, silently. Item 1.)
2. **Work Order company.** Does a Work Order carry its own operating company? If yes: required at
   creation (refusing the 19 of 30 that have no source), or inherited from its Sales Order where one
   exists (covering 11 of 30)? If no: how is a reservation attributed to Taylor vs Ventana? (Item 2.)
3. **Work Order visibility.** Should a `workOrder.read` capability exist, and does it mean "read any
   Work Order" or "read the ones assigned to me"? (Today a `users/{uid}.role` string decides, in two
   hand-copies. Item 3.)
4. **Consumed stock.** When parts are consumed on a work order, how does the stock leave on-hand?
   (a) consumption writes a physical removal movement, (b) the on-hand derivation starts counting
   location-less CONSUMED rows, or (c) commitment permanently retains consumed quantity. Today two
   code paths compensate differently and one over-reports availability. (Item 4.)
5. **Installed serialized units.** When a serialized unit is installed on customer equipment, does the
   installation emit an inventory ledger movement — and if so, from where? (ADR-010 §3 says "a
   governed CONSUMED effect from the customer Location"; migration 007 ruled the customer's Equipment
   out of the location type enum, so no such row is emittable, and emitting one from the origin
   warehouse would claim stock left a place it left at delivery. Today nothing is emitted. *Custody
   itself is already defined — the account, via the Equipment record.* Item 6.)
6. **Work Orders / Delete.** Is `workOrder.cancel` the Work Order's *delete* verb or its *edit* verb?
   The seeded policy store and the generated governance contract currently disagree. (Item 7a.)
7. **Employees.** Is Employee access expressed as real `employee.*` capabilities, or recorded honestly
   as Rules-governed for now? (Both W1-C5 and W1-C18 refused to choose. Item 7b.)
8. **Rules-governed objects.** Should Contacts, Customer Locations and Equipment get real capabilities
   (six ids proposed, plus whether Equipment deserves its own *create* separate from
   `equipment.install`) — or stay governed by Firestore role branches? (Item 7c.)
9. **`admin.credentialReset.initiate`.** Administration advertises this verb and no server code
   implements it. Delete the advertisement, or build the command? (Item 7g.)
10. **`inventory_actions`.** May an admin or dispatcher still create an inventory-action document
    straight from a console, with no field validation and a `createdBy` naming anyone? The product's
    own writer was retired by ruling; this Rules grant is what survived it. (Item 8.)
11. **Reporting.** When a report runs against a wave-3 object that carries an operating company, does
    it **default** to the runner's company, or **require** an explicit company filter? (A silent
    consolidated default is the failure mode the EOS ruling names. Item 9.)
12. **Saved reports.** Is a saved report the user's private thing (deleted with them, never shared), or
    a piece of business configuration (shareable to named principals or Roles, surviving its author,
    listed in Administration → Objects)? (Item 10.)
13. **Related-account cash.** May a payment received from one customer settle a different, related
    customer's invoice? (The company check is enforced; the account check is deliberately absent, and
    `parentAccountId` is not stored at all. Item 11.)
14. **`stock_locations`, after tonight's retirement.** (a) Does the retirement also withdraw the
    one-time Ownership-v1 stamping plan over the 5 rows that still exist? (b) Four record families —
    inventory transaction, inventory action, transfer, cycle count — are declared to inherit their
    operating company *from a stock location*. What do they inherit from now? (Items 15b, 15c.)
15. **Purchase Order.** Two purchase-order collections exist and only one is governed. Is the
    canonical `procurementService` layer **retired** or **converted**? (Its price is a currency-less
    float that must not become a cost authority. Item 16.)
16. **Voiding an invoice.** Who may void an issued invoice, on what evidence, with what effect on
    issued numbering — and does a voided invoice still count as owed? (Today nothing can void one, and
    the AR projection would count it as owed if anything could. Item 17.)
17. **Technician availability score.** How do "available minutes over a window" become a 0–100
    recommendation score for an *unplaced* queue card that has no window? (Today 20% of the score
    reads a stored status field that a technician on recorded PTO still reads `available`. Item 20.)
18. **Supplier.** Do supplier commercial terms vary by operating company? (If yes, one additive column
    on `supplier_catalog_items`, both tables still empty. Item 22.)
19. **`submit_work` replay.** After an intake PR is merged and its branch deleted, should a retry of
    the same request return the merged pointer, or is content-addressing the artifact (deriving
    timestamps from the request rather than the clock) the answer? (Item 23.)
20. **Job Assignments.** Is it a distinct assignment board, or an assignment *view* of Work Orders?
    (Same shape as the Employees/Technicians question settled 2026-08-20. Item 24.)

---

## 7. What this lane changed

Nothing but this file. No code, no schema, no registration, no Rules, no deploy, no production
contact, and no Owner question answered.
