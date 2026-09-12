# Inventory Reference Authority — P1B Census

**Status:** Discovery / reconciliation evidence. **No authority is changed by this document.**

> **Read Part II first for anything you intend to act on.** Part I (§0-§10) is the original
> source-only discovery census of 2026-09-11. **Part II (§11-§17)** adds the five authoritative
> architecture rulings (R1-R5), the nonprod live-data evidence that resolves Part I's UNPROVEN
> items, and the cutover/final dispositions. Where the two disagree, **Part II supersedes**, and
> each supersession is marked at the point of conflict. Part I is preserved unedited as the
> discovery record.
**Base commit:** `a8ec169e` (`origin/main`, includes PR #1860 "p1a-capability-parity").
**Date:** 2026-09-11.
**Scope:** the reference data that must be resolved before the inventory ledger can migrate from
Firestore to `eos_ops` (PostgreSQL), i.e. step 3 of the cutover sequence in
`docs/design/eos-operational-data-plane-inventory-authority-cutover.md` §4.

This document does not create a table, change a grant, migrate a row, or cut over a reader or a
writer. It is the mechanical census that step 3 asks for, and it exists to be argued with: every
claim below carries a `path:line` citation, and everything that could not be proven from code is
labelled **UNPROVEN** rather than smoothed over.

---

## 0. Method

Four independent read-only lanes ran concurrently against one clean worktree of `a8ec169e`, with no
lane permitted to write to the repository and no lane sharing an evidence file with another:

| Lane | Scope |
|---|---|
| **A** | Part identity, tracking mode, aliases, manufacturers |
| **B** | Warehouse, BIN, parentage, location resolvers, warehouse-aggregate readers |
| **C** | MOBILE locations, Truck Registry, Employee/technician identity, employee→truck assignment |
| **D** | Adversarial repo-wide sweep — collection names, hidden/legacy/seed/import/migration writers, identifier remaps, duplicate representations, discrepancies against the cutover design |

Lane D was explicitly instructed not to trust A–C. Integration reconciled the four reports; two
cross-lane gaps were closed by direct verification (§7), and genuine contradictions are preserved as
discrepancies rather than averaged away.

**A methodological finding that shaped everything below:** `functions/src/constants/collections.ts`
declares **none of the seven reference entities**. It declares the ledger
(`:13` `inventory_transactions`) and serialized assets (`:83` `serialized_assets`), but every
reference collection in this repository is a string literal declared locally, frequently more than
once. A census that starts from the constants module — as the cutover design's §3 table appears to
have — finds nothing and must infer. That is the root cause of most of §6.

---

## 1. Authority matrix — summary

Classification vocabulary: `AUTHORITATIVE_MUTABLE`, `AUTHORITATIVE_REFERENCE`, `DERIVED_PROJECTION`,
`CACHE`, `MIGRATION_ONLY`, `SEED_ONLY`, `LEGACY_INERT`, `UNKNOWN`, `DUPLICATE_AUTHORITY`.

| # | Entity | Current authority | Collection / table | Primary identifier | Parent id | Mutable after use? | Referenced historically? | Duplicate repr.? | Can move independently? | Postgres target | Blocking ambiguity? |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **Part** | AUTHORITATIVE_MUTABLE | `parts` | doc id = `Part.partId` | — | Yes (attributes), id **no** | Yes | Yes — display only | Yes | **C** resolve by stable id | BA-1 |
| 2 | **Part tracking mode** | AUTHORITATIVE_MUTABLE (**derived**, not stored) | `parts.controlType` | — | `partId` | **Yes — ungoverned** | Yes (per-row copy) | Yes — 3 mappings | No | **E** owner ruling | **BA-2** |
| 3 | **Warehouse** | AUTHORITATIVE_REFERENCE by read; **SEED_ONLY / MIGRATION_ONLY by write** | `warehouses` | doc id | — | Yes | Yes | No | Yes | **E** owner ruling | **BA-3, BA-4** |
| 4 | **BIN** | AUTHORITATIVE_REFERENCE | `bins` (+`bin_code_claims`) | doc id `bin_<sha256>` | `bins.warehouseId` (immutable) | No (parent frozen) | Yes, incl. retired | No | Yes | **C** resolve by stable id | BA-5 |
| 5 | **Truck** | AUTHORITATIVE_MUTABLE | `trucks` | doc id | — | Yes (attrs) | Yes | No | Yes | **C** resolve by stable id | — |
| 6 | **MOBILE location** | AUTHORITATIVE_REFERENCE | `mobile_locations` (+`location_truck_claims`) | doc id, **operator-typed** | `trucks.locationId` (1:1, immutable) | No | Yes | No | Yes | **B** keep external temporarily | **BA-6** |
| 7 | **Employee** | **DUPLICATE_AUTHORITY** | `employees` + `users` + `fieldops_technicians` + `eos_policy.principals` | four disjoint id spaces | — | Yes | Yes | **Yes — 4** | No | **E** owner ruling | **BA-7** |
| 8 | **Employee↔Truck assignment** | AUTHORITATIVE_MUTABLE (write) / **DUPLICATE_AUTHORITY** (resolution) | `trucks.assignedDriverEmployeeId` | employees doc id | — | Yes | **No history kept** | Yes — cross-namespace read | No | **E** owner ruling, then **D** retire | **BA-7** |
| 9 | **Operating Company / ownership root** *(8th dependency — not in the design)* | AUTHORITATIVE_REFERENCE, already applied to the ledger | `operating_companies` + hardcoded + config | `operatingCompanyId` | warehouse/mobile roots | Yes | **Yes — on 99 ledger rows** | **Yes — 3** | No | **E** owner ruling | **BA-8** |
| 10 | **Serialized custody location** *(proven independent)* | AUTHORITATIVE_MUTABLE, **internally inconsistent** | `serialized_assets.currentLocationId` / `.currentLocationType` | serial doc id | — | Yes | Yes | Yes — parallel to ledger | No | **E** owner ruling | **BA-9** |

Supporting registries proven to exist and unnamed by the design: `bin_code_claims`
(`functions/src/inventoryLocation/binCommands.ts:60`), `location_truck_claims`
(`functions/src/truckRegistry/truckRegistryRepository.ts:17`), `employee_number_registry`
(`functions/src/access/employeeProfileCommands.ts:96`), `warehouse_bin_conversions`
(`functions/src/inventoryLocation/binConversionGate.ts:18`), `part_aliases`
(`functions/src/partMaster/partAliasRepository.ts:22`).

---

## 2. Per-entity detail

### 2.1 Part

| Field | Finding |
|---|---|
| Authority | **AUTHORITATIVE_MUTABLE** — one collection, one write-service family |
| Collection | `parts`, literal at `functions/src/partMaster/partMasterRepository.ts:19`; path `parts/{partId}` `:166`. Re-declared identically at `functions/src/salesAgreement/salesAgreementLineReferences.ts:67` and `functions/src/workOrderInstall/workOrderInstallCommand.ts:58`, and in three client modules (`field-ops-app-vite/src/hooks/useSerialTrackedParts.js:38`, `.../useWholeUnitParts.js:28`, `.../services/partMasterQueries.js:22`) |
| Primary identifier | doc id = `Part.partId`; agreement **enforced at read** — `partMasterRepository.ts:102-104` throws when `data.partId !== docId`. Format `/^[A-Za-z0-9_-]{1,64}$/` (`functions/src/partMaster/validation.ts:27,49`) |
| Business key | `internalPartNumber` — **mutable** under governance (`functions/src/partMaster/partMasterCommands.ts:256`). Distinct from the doc key |
| Creation writer | `createPart()` `partMasterCommands.ts:199-242` → `txn.create` `partMasterRepository.ts:174`; callable `partMasterCallables.ts:68-78`, deployed `functions/src/index.ts:350`; Data Import via the same command `dataImport/firestoreDataImportAdapters.ts:180-190`; operator script `functions/scripts/executePartMasterCreate.js:139` |
| Update writer | `updatePart()` `partMasterCommands.ts:258-370` (version CAS `:282-284`); callable `partMasterCallables.ts:80-96` |
| Status writer | `changePartStatus()` `partMasterCommands.ts:382-430`; callable `:98-112`. Transition table `:60`; DISCONTINUED/SUPERSEDED terminal `:17-21` |
| **Bypassing writer** | `functions/scripts/seedSandboxBaseline.js:192-208` — raw `.set({merge:true})`, **bypasses the command entirely**; nonprod guard at `:141`. SEED_ONLY but a real direct writer. Cert-world seeds also write `parts` directly: `functions/scripts/certificationWorld/emulatorBootstrap.mjs:67`, `applyDemandPlan.mjs:82` |
| Delete | **Does not exist.** No repository method (`partMasterRepository.ts:43-47`), rules deny (`firestore.rules:1636`), zero `deletePart` in the tree |
| Inventory readers | Receiving `inventoryReceiving/receivingCallableWiring.ts:65-73`, `:112-119`; Transfer `inventoryTransfer/transferCallableWiring.ts:61-69`; **Relocation** via the same resolver (`inventoryLocation/stockRelocationCallables.ts:61`); Cycle Count/Adjustments `cycleCount/cycleCountCallableWiring.ts:72-80`; opening-balance import `dataImport/firestoreInventoryImportAdapters.ts:155-182` |
| Quantity/custody readers | `inventory/partBalanceReadService.ts:398-405`, `:278-338`; `inventory/partBalanceBatchReadService.ts:227-232`; `inventoryLedger/locationOnHand.ts:92,:144` |
| Authorization | `inventory.catalog.manage` / `.activate` (`partMasterCommands.ts:48-49`, enforced `:208,:272,:391`), granted to no standing role (`partMasterCallables.ts:12-16`). Client writes impossible: `firestore.rules:1632-1636` `allow create, update, delete: if false`. Client gate `PART_MASTER_WRITE_READY` sandbox-only (`field-ops-app-vite/src/config/partMasterWriteReadiness.js:7-10`) |
| Duplicate representation | **Display-layer only.** Static `PARTS_CATALOG` mirrors (`functions/src/data/partsCatalog.ts:29`; `field-ops-app-vite/src/data/partsCatalog.ts:31`; third copy `functions/scripts/certificationWorld/data/partsCatalog.mjs`) are composed with canonical rows in the live UI (`field-ops-app-vite/src/domain/partsCatalogView.js:20`, `.../partsCompatibilityAdapter.js:83+`), and **ten SKUs render as Parts with no canonical record** (`.../partsCompatibilityAdapter.js:36-38`). The server-side dual resolver `partMaster/partReferenceCompatibility.ts:83-117` is flag-guarded `PART_MASTER_REFERENCE`, default OFF, set by nothing in-repo (`:21-22,:66`). **No command path can reach a static-only SKU** — every command resolves through `parts` and would get `null` |
| Identifier stability | **STABLE — proven.** `partId` excluded from `UPDATABLE_FIELDS` (`partMasterCommands.ts:256`), forced from the stored record (`:287`), agreement enforced at read (`partMasterRepository.ts:102-104`); no delete, so no recycling; `AlreadyExistsError` on re-create (`:218`); no merge/dedup path (`part_relationships` is an unimplemented comment, `functions/src/partMaster/types.ts:5`) |
| Residual | For imported parts the doc id **is** the upper-cased IPN (`dataImport/contracts/partImportContract.ts:439-444`) while the IPN stays mutable — so `part_id` must never be read back as "the current part number" |
| Disposition | **C. RESOLVE_BY_STABLE_ID_WITHOUT_COPY**, conditional on MB-5 and MB-8 |

**Aliases do not affect ledger identity.** `part_aliases` uses a derived doc id (`partAliasRepository.ts:6,:22,:38`); ownership never transfers (`partMasterCommands`/`partAliasCommands.ts:118-131,:223-224`); aliases affect *resolution* only (`scannerPartLookup.ts:74-84`) and **no ledger row is ever keyed by an alias**.

### 2.2 Part tracking mode — **the primary blocker**

There is **no stored `trackingMode` field on a Part.** The mode is derived at read time from
`Part.controlType` by `functions/src/partMaster/controlTypeTrackingMode.ts:24-35`
(STANDARD→NONE, SERIALIZED→SERIAL, LOT/unknown→LOT).

**`controlType` is freely updatable, and no guard exists.** It is in the update allowlist
(`partMasterCommands.ts:253,:256`) and forwarded verbatim by the callable
(`partMasterCallables.ts:84-92`). Proof of absence: `updatePart`'s transaction reads only the audit
doc (`:282`), the Part (`:284`), the equipment model (`:294`) and aliases (`:309-312`) — grep for
`inventory_transactions|serialized_assets|onHand|balance` inside `partMasterCommands.ts` returns
**zero matches**; `validatePart` is pure (`validation.ts:1-3`) and structurally cannot know. No
test, no ADR and no rules clause asserts immutability anywhere in `functions/`,
`field-ops-app-vite/` or `docs/`.

**Why it corrupts a ledger.** The row stores the mode at write time
(`inventoryLedger/operationalMovementValidation.ts:146`), summation filters on the *row's* mode
(`locationOnHand.ts:92,:144`), but `getPartBalance` chooses the answer *shape* from the *Part's
current* mode (`partBalanceReadService.ts:404`). A STANDARD→SERIALIZED edit therefore reproduces
exactly the "confident zero for a shelf that is not empty" defect that file already documents at
`:381-389`. In Postgres it splits an immutable table: `movement_serial_matches_tracking`
(`functions/migrations/1757808000000_eos-ops-foundation.sql:118-121`) accepts old NONE rows and new
SERIAL rows for the same `part_id`, and the schema deliberately offers no update or delete path to
reconcile them (`:53-58`).

**Three mappings, one of which disagrees.** The canonical `controlTypeTrackingMode.ts` exists
because the rule had already been copied twice (header `:3-12`) — yet
`cycleCount/cycleCountCallableWiring.ts:59-70` is a byte-identical re-copy, and the client
`field-ops-app-vite/src/domain/inventoryLedgerEvent.js:128-134` has **different semantics**
(`SERIALIZED_LOT` → refuse; server → `"LOT"`).

**A writer that never reads the Part at all.** Work-order physical consumption hardcodes
`const trackingMode = "NONE";` — `functions/src/workOrderConsumption/planPhysicalConsumption.ts:92`
and `:151`. A SERIALIZED part consumed on a work order posts a NONE-mode ledger row.

**Disposition: E. NEEDS_OWNER_RULING** — see BA-2.

### 2.3 Warehouse

| Field | Finding |
|---|---|
| Authority | **AUTHORITATIVE_REFERENCE by read; SEED_ONLY / MIGRATION_ONLY by write** — the governed writer is inert |
| Collection | `warehouses` — `functions/src/constants/collections.ts:29` (the one reference entity the constants module does declare), plus three local re-declarations: `truckRegistry/truckRegistryRepository.ts:19`, `workOrderConsumption/consumptionSourceService.ts:23`, `reorderRequest/reorderCallables.ts:53` |
| Identifier | doc id **is** the business key; no separate code exists (`field-ops-app-vite/src/metadata/definitions/warehouse.js:62-65`). Id re-asserted in the body and bound — `warehouseGovernance/governedWarehouseValidation.ts:137-138` (`ID_MISMATCH`) |
| Creation / status writer | `createWarehouse` / `setWarehouseStatus` — `warehouseGovernance/warehouseStatusWriter.ts:113,153,163,207`. **Header `:1-6` declares it inert/unexported, and repo-wide grep finds zero importers.** Its capability `inventory.warehouse.status.set` (`:24`) is **not registered in the permission catalog** — one repo-wide hit, the declaration itself |
| Actual writers | seeds `functions/scripts/seedSandboxBaseline.js:159-179` (governed shape) and `seedOperationsDemoData.js:85-88` (**ungoverned — no status, version or provenance**); `seedTruckFleetFixtures.mjs:93-106` (direct `ref.set`, bypasses the governed writer); operator CLIs `assignWarehouseRootCompany.js:231`, `repairSandboxWarehouseCanonicalIds.js:171`, `warehouseBackupRestoreCli.js:146` (full-doc `txn.set`); migration `warehouseGovernanceMigration.ts` (inert, CLI-driven) |
| Delete | No path anywhere. Client writes impossible — `firestore.rules:1178` `allow create, update, delete: if false` |
| Inventory readers | Aggregate: `fulfillment/fulfillmentAvailability.ts:19,109`; `fulfillment/allocateSalesOrder.ts:68`; `inventory/partBalanceReadService.ts:335`; `inventory/partBalanceBatchReadService.ts:159`; `inventoryAnalyticsCallables.ts:200-205`; `inventoryService.ts:120`; `inventoryLedger/binConversionReconciliation.ts:74`. Resolvers: receiving `inventoryReceiving/receivingLocationResolver.ts:31-45` (**WAREHOUSE-only**); transfer/relocation/cycle-count `inventoryTransfer/transferLocationResolver.ts:20-62` |
| **Two incompatible predicates** | Seven readers use raw `where("status","==","ACTIVE")` without running `validateGovernedWarehouse`, which the four resolvers require: `inventoryService.ts:113`, `fulfillment/allocateSalesOrder.ts:121`, `inventory/partBalanceReadService.ts:285`, `inventory/partBalanceBatchReadService.ts:102`, `inventoryAnalyticsCallables.ts:186`, `workOrderConsumption/consumptionSourceService.ts:46`, `dataImport/firestoreInventoryImportAdapters.ts:46,182`. **These admit different document sets today** |
| Identifier stability | Stable in code — no delete, re-key or rename path — but **UNPROVEN operationally**: ids are arbitrary operator-chosen strings written by seeds and CLIs with no live governed writer to enforce anything, and one CLI exists specifically to patch the `id` field (`ownership/warehouseCanonicalIdRepair.ts:30,44-45`) |
| Disposition | **E. NEEDS_OWNER_RULING** |

### 2.4 BIN

| Field | Finding |
|---|---|
| Authority | **AUTHORITATIVE_REFERENCE** — one production writer, exported, capabilities inert |
| Collections | `bins` `inventoryLocation/binCommands.ts:59`; `bin_code_claims` `:60`; `bin_placements` `inventoryLocation/putAwayCommand.ts:51` (re-declared `workOrderConsumption/consumptionSourceService.ts:22`); `warehouse_bin_conversions` `inventoryLocation/binConversionGate.ts:18` |
| Shape | **Top-level, not a subcollection** — `binCommands.ts:159` `db.collection(BINS_COLLECTION).doc(binId)`; parent scoping is a field query `:400-403`. No `collectionGroup("bins")`; `firestore.indexes.json` has zero `bins` entries |
| Identifier | Opaque, server-derived — `inventoryLocation/binRegistry.ts:86-88` `bin_${sha256(idempotencyKey).slice(0,40)}`. Caller-supplied `binId` and `code` are **refused, not ignored** (`:274-275`). Globally unique (`:425-427,:462`) |
| Business key | `(warehouseId, code)` held in a reservation index — `binRegistry.ts:97-99`; codes unique **only within a warehouse** (`:349-355`, ruling O-7) |
| Parent | Stored as a **field on the bin document only** — written `binCommands.ts:194`, read `inventoryLocation/binParentage.ts:31-32`. Deriving it from the id prefix or code is explicitly forbidden (`binParentage.ts:5-7`; `transferLocationResolver.ts:33-35`) |
| Parent mutable? | **No.** `binRegistry.ts:314` — `if (draft.warehouseId !== undefined) return invalid("warehouse_not_movable")`; neither `renameBin` (`binCommands.ts:277-287`) nor `setBinStatus` (`:341`) touches it; cross-warehouse movement is refused by name (`inventoryTransfer/transferOrderCommand.ts:214-219`, `inventoryLocation/stockRelocationCommand.ts:380-381`) |
| Writers | `createBin` `binCommands.ts:143-213` (`txn.create` on bin **and** claim); `renameBin` `:229-291`; `setBinStatus` `:303-344`; callables `functions/src/index.ts:495-509`. `recordPutAway` writes `bin_placements` only — no ledger, no quantity (`putAwayCommand.ts:12-15,373-378`). `relocateStock` writes ledger + placement + `serialized_assets` (`stockRelocationCommand.ts:433-452`). `warehouse_bin_conversions` is written **only** by an operator script (`functions/scripts/completeBinConversion.mjs:6,49`), gated on a balanced report (`binConversionGate.ts:36-45`) |
| Authorization | All four bin/placement/relocate capabilities are `active:false` and granted to no Role — `access/permissionCatalog.ts:1128,1133,1157,1162,1182,1187,1190,1195`. No client rules block ⇒ deny-all (`binCommands.ts:3-6`) |
| Delete | Never (`binCommands.ts:295-297`). Bin codes are never released even on deactivation (`:27-33,:274-276`), so "delete and recreate the same code" is structurally blocked |
| Historical references | Retired bins stay readable **and their stock still counts** — status is deliberately ignored by the parentage reader (`binParentage.ts:14-15`). Unresolvable bins are **excluded, never zeroed** (`locationOnHand.ts:100-103`); unsafe ids are silently dropped (`binParentage.ts:47`) |
| Identifier stability | **Stable going forward — proven.** But see BA-5: the id scheme **already changed once**, from `bin_{warehouseId}__{code}` (`binRegistry.ts:25-26`) to the sha256 form (`:87`) |
| Latent defect (non-blocking) | `renameBin` mutates `area/aisle/bay/position` but never refreshes the stored `fingerprint` (`binCommands.ts:277-287`), so a legitimate `createBin` replay afterwards raises `BinMalformedStoredRecordError` instead of `unchanged` (`:167-169`). Cannot create a duplicate bin; does not break rename or status |
| Disposition | **C. RESOLVE_BY_STABLE_ID_WITHOUT_COPY** |

### 2.5 Truck and MOBILE location

| Field | Finding |
|---|---|
| Authority | Truck **AUTHORITATIVE_MUTABLE**; MOBILE location **AUTHORITATIVE_REFERENCE**; `location_truck_claims` AUTHORITATIVE_REFERENCE (1:1 infrastructure) |
| Collections | `trucks`, `mobile_locations`, `location_truck_claims`, `employees`, `warehouses` — all five declared at `functions/src/truckRegistry/truckRegistryRepository.ts:15-19`; independently re-declared at `workOrderConsumption/consumptionSourceService.ts:24-25` and `field-ops-app-vite/src/services/truckRegistryQueries.js:16-17`. **Neither `trucks` nor `mobile_locations` appears in `constants/collections.ts`** |
| `truckRegistry` | **Is not a collection.** Zero `.collection("truckRegistry")` hits repo-wide — the design's `truckRegistry/*` names a source directory |
| Identifiers | Truck: doc id, reciprocity-enforced `truckRegistryRepository.ts:104`. MOBILE: doc id — **operator-typed free text**, read raw at `truckRegistry/validation.ts:80-82`, validated only by `isId` (`:18`), copied verbatim into both the location doc and `truck.locationId` (`:105-109`), taken from `request.data` at `truckRegistryCallables.ts:100`, entered in a UI text field (`field-ops-app-vite/src/modules/inventory/truckManagement/CreateTruckModal.jsx:79-81`) |
| **MOBILE id construction** | **Nothing constructs it.** Three ad-hoc conventions prove no rule exists: `functions/scripts/seedTruckFleetFixtures.mjs:129` (`mobile-<run>-101`), `functions/scripts/verifyTruckFunctionsDeployment.js:99` (`${truckId}_loc`), `.../TruckManagementPreview.jsx:24` (`MOBILE-101`). **It is not derived from the truck id, the employee id, or any assignment** — so the anticipated "MOBILE id is assignment-derived" blocker **does not apply** |
| Writers | Sole governed writer `truckRegistry/truckRegistryCommands.ts` — `createTruck:173-208`, `setDriver:270-289`, `unassignDriver:292-299`, `changeStatus:303-321`, `changeHomeWarehouse:325-337`, `deactivateTruck:341-360`, `reactivateTruck:364-382`, `deleteTruckCreatedInError:407-488` (admin-only, in-txn role read `:430-433`). All version-CAS `:244`, idempotent `:122-135`. **All nine callables are deployed** — `functions/src/index.ts:255-265` |
| Stale doc | `field-ops-app-vite/src/metadata/definitions/truck.js:37-47` and `mobileLocation.js:42-43` both claim these are unexported/undeployed. **Contradicted by `index.ts:255-265`** |
| Out-of-band writer | `ownership/ownershipBackfillRules.ts:100`, executed by `functions/scripts/ownershipSandboxBackfill.js:233` (`tx.set(..., {merge:true})`) — bypasses version and audit, writes `operatingCompanyId`, a field the client allow-list rejects (`field-ops-app-vite/src/domain/truckRegistry.js:36`) |
| Client writes | None — `firestore.rules:1229-1232/1234-1237/1245-1248` all `create, update, delete: if false`; claims are also `read: if false` |
| Readiness gate | `field-ops-app-vite/src/hooks/useTruckManagement.js:41-42,:70`; flag `config/truckManagementReadiness.js:41` → sandbox/emulator/integration **true**, certification and `taylor-parts-production` **false** |
| Inventory readers | `inventoryTransfer/transferLocationResolver.ts:47-58` (requires `active===true`); `cycleCount/cycleCountLocationEligibility.ts:19-26`; `cycleCount/cycleCountSheetRead.ts:37-49`; `inventoryLocation/locationDisplayReadService.ts:88-99`; `inventoryLedger/mobileLocationPresenceProbe.ts:151-159`; `truckRegistry/operationalReferenceProbe.ts:162-201`; `inventoryTransfer/transferReceivableRead.ts:102-107`; `workOrderConsumption/consumptionSourceService.ts:146-149`, `planPhysicalConsumption.ts:63-76`; ledger write `workOrderConsumption/consumptionMovement.ts:113` |
| Explicit non-readers | `inventoryAnalyticsCallables.ts:184`, `fulfillment/allocateSalesOrder.ts:119`, `ai/workOrderReadinessContext.ts:168` |
| Reassignment semantics | **Physical referent unchanged; human referent never recorded.** The ledger stores only the location id (`consumptionMovement.ts:113`; SQL `:98-99`); `locationId` is immutable (`truckRegistryCommands.ts:17`); `setDriver` writes only the driver field (`:283`), header `:15-17` "inventory custody provably unchanged". **No assignment history exists anywhere** — `operationalReferenceProbe.ts:34,:195`; only prose audit summaries (`truckRegistryCommands.ts:285`) |
| Identifier stability | **Truck id STABLE; MOBILE id STABLE and not assignment-derived.** Both reciprocity-enforced (`truckRegistryRepository.ts:82,:104`), claim-unique (`truckRegistryCommands.ts:190-191`); a location named by any ledger row is permanently undeletable (`operationalReferenceProbe.ts:174,:193`). **Reassignment changes RELATIONSHIP only, never IDENTITY** |
| Caveat | Trucks are hard-deletable (`index.ts:264`) behind a probe its own header documents as necessarily inconclusive — 5 of 11 checks conclusive, aggregate always UNKNOWN (`operationalReferenceProbe.ts:44-46,:203-210`) |
| Disposition | Truck **C. RESOLVE_BY_STABLE_ID_WITHOUT_COPY**; MOBILE **B. KEEP_EXTERNAL_REFERENCE_TEMPORARILY** (opaque string + `location_type='MOBILE'`, exactly today's schema) |

### 2.6 Employee identity and the truck assignment

**Four live representations of one human — DUPLICATE_AUTHORITY.**

```
uid ─┬─ users/{uid}.employeeId ⇄ employees/{employeeId}.userId      [TWO-WAY]
     │    writer:    functions/scripts/provisionEmployeeAccess.js:609-644
     │    translate: functions/src/access/operationalRoleContext.ts:36,:155 ; firestore.rules:476
     │
     ├─ users/{uid}.technicianId → fieldops_technicians/{id}        [ONE-WAY, no back-check]
     │    writer:    functions/scripts/assignTechnicianToUser.js:62
     │    translate: functions/src/callerContext.ts:15-22 ; deref completeAssignedJob.ts:300
     │
     └─ eos_policy.principals(identity_provider, external_subject=uid).id
          functions/migrations/1757548800000_tenant-and-identity.sql:79-95
          (":81-82 For Firebase this is the UID")
```

**There is no mapping between `employees` and `fieldops_technicians`.** They are declared separate
at `functions/scripts/provisionEmployeeAccess.js:11-15` and
`docs/specifications/employee-foundation.md:378-380`. A fourth id is minted for the same human by
`adminPolicy/postgresPolicyRepository.ts:611-613` (Firebase uid → new `principals.id` via
`newId()`), and **nothing stores it back**. No SQL object in any of the six migrations references a
truck, driver, employee or technician.

**The assignment itself lives in exactly one place** — `trucks/{truckId}.assignedDriverEmployeeId`
(`truckRegistryRepository.ts:95,:108-109,:120`). Proven negatives: no employee-side field (grep
`assignedTruck` across `functions/src` + `field-ops-app-vite/src` = zero hits); no Postgres table
(`functions/migrations/1757635200000_assignment-integrity.sql` is about **Role** assignments —
`:57` `principal_uid→principal_id`, `:66-69` composite FK to `tenant_memberships`, `:80-82`
one-active-row index — nothing about trucks); `location_truck_claims` holds `{locationId, truckId}`
only (`truckRegistryRepository.ts:129-130`).

**But the edge is written in one id space and read in another.**

- **Write side** validates against `employees/{id}` — `truckRegistryCommands.ts:277` →
  `truckRegistryRepository.ts:196-200`; the UI picker offers employee doc ids
  (`field-ops-app-vite/src/hooks/useDriverOptions.js:12-14` → `.../domain/employees.js:24-36`).
- **Read side** matches `trucks.assignedDriverEmployeeId == users/{uid}.technicianId` —
  `workOrderConsumption/consumptionSourceService.ts:72`, id sourced at `callerContext.ts:19-20`,
  and that field is validated against `fieldops_technicians`
  (`functions/scripts/assignTechnicianToUser.js:36,43`).
- **Proof the two spaces differ:** `functions/scripts/seedSandboxTransactional.js:174` resolves by
  `employeeId==="sbx-tech"`, `:187` writes `technicianId="tech-sbx-01"`, `:191` creates
  `fieldops_technicians/tech-sbx-01`.
- The convention is explicit and unenforced —
  `functions/scripts/seedSandboxPerformanceStory.mjs:232-234` "their employeeId doubles as their
  technicianId"; operator prerequisite at `docs/releases/bin-sandbox-release-2026-09-10.md:117-119`.

It **fails closed** (`snap.empty` → `NO_TRUCK_ASSIGNMENT` / `{mobile:null}`) rather than
misattributing, so there is no correctness breach today — but it is not resolvable by a migration
that must pick one id space.

**`fieldops_technicians` is the only reference entity with a live client write path** —
`firestore.rules:407-408` (create) and `:418-419` (update), exercised from the browser by
`field-ops-app-vite/src/domain/jobActions.js:73,80,107,121`.

**Stability:** Employee id **not stable enough** — body/doc-id agreement is unenforced
(`field-ops-app-vite/src/metadata/definitions/employee.js:30-37`) and consumers hold a
`technicianId` from a different namespace. Technician id **unsuitable** — explicitly re-pointable
(`functions/scripts/assignTechnicianToUser.js:26-30`) and client-writable.

**Disposition:** Employee **E. NEEDS_OWNER_RULING**; assignment **E. NEEDS_OWNER_RULING**, then
**D. RETIRE_DUPLICATE** on the `technicianId` join at `consumptionSourceService.ts:72`;
`fieldops_technicians` **D. RETIRE_DUPLICATE** (contingent on the ruling).

### 2.7 Operating Company / ownership root — the 8th reference dependency

**Not named by the cutover design, and already stamped onto ledger rows.**

`warehouses` and `mobile_locations` are declared PRIMARY ownership roots with `trucks` and
`stock_locations` deriving from them
(`config/ownership/operating-company-roots.sandbox.json`); per-collection derivation paths at
`functions/src/ownership/ownershipDerivation.ts:60-100`. `operatingCompanyId` is stamped onto
`cycle_counts`, `receiving_orders`, `transfer_orders` and **`inventory_transactions`** by
`ownership/ownershipBackfillRules.ts:99-167`, and the backfill **has been applied** — 1015
documents, `sb-evidence/ownership-backfill-applied-eos-platform-sandbox.json` records
`"applied": true`, 99 of them ledger rows.

Three sources compete: a hardcoded map `ownership/operatingCompanyAuthority.ts:36-49` whose own
header claims it is "INERT in v1 … no backfill has run" (`:10`) — **falsified by the applied
evidence**; a client mirror plus the `operating_companies` collection seeded by
`functions/scripts/seedOperatingCompanies.js:101`; and the sandbox config file above, which has
run-stamped seed MOBILE ids (e.g. `mobile-seed1786749487428-101`, minted at
`seedTruckFleetFixtures.mjs:127`) **pinned into it as authored facts**.

**`eos_ops.inventory_movements` has no company column** (`…eos-ops-foundation.sql:93-125`). A
cutover performed today would silently drop the ownership attribution that 99 sandbox ledger rows
already carry.

### 2.8 Serialized custody location — proven independently authoritative, and inconsistent

`serialized_assets.currentLocationId` / `.currentLocationType` (`serializedAsset/types.ts:19,72`) is
a **typeless parallel location representation** alongside the ledger.
`currentLocationType` is **read** — `workOrderConsumption/consumptionSourceService.ts:122-124`,
defaulting to `"WAREHOUSE"` — but **written by nothing in the repository** (grep returns exactly one
hit, that reader). Meanwhile relocation now sets `currentLocationId` to a **bin id**
(`inventoryLocation/stockRelocationCommand.ts:447`).

**Consequence:** a serialized unit sitting in a bin is currently reported to Work-Order consumption
as a *warehouse whose id is a bin id* — and would import verbatim into
`eos_ops.serialized_custody(location_type, location_id)` (`…eos-ops-foundation.sql:142-143`), where
the index `serialized_custody_by_location (tenant_id, location_type, location_id)` (`:152`) would
then be keyed on a type that is wrong by construction.

---

## 3. Identifier stability proof

A stable historical ledger row must never silently point at a different real-world thing later.

### Proven stable

| Identifier | Proof |
|---|---|
| **Part id** | Not updatable (`partMasterCommands.ts:256`), forced from the stored record (`:287`), agreement enforced at read (`partMasterRepository.ts:102-104`), no delete ⇒ no recycling (`partMasterRepository.ts:43-47`; `firestore.rules:1636`), re-create refused (`:218`), no merge/dedup path exists |
| **BIN id** | Opaque sha256-derived (`binRegistry.ts:86-88`), caller-supplied ids refused (`:274-275`), never deleted (`binCommands.ts:295-297`), rename does not re-key (`:219-220`), parent immutable (`binRegistry.ts:314`), code permanently claimed (`:27-33`) — **forward from the current scheme** |
| **Truck id** | doc id, reciprocity-enforced (`truckRegistryRepository.ts:104`), never rewritten; deletion blocked once referenced (`operationalReferenceProbe.ts:195-210`) |
| **MOBILE location id** | Immutable (`truckRegistryCommands.ts:17`), reciprocity-enforced (`truckRegistryRepository.ts:82`), claim-unique (`truckRegistryCommands.ts:190-191`), permanently undeletable once named by a ledger row (`operationalReferenceProbe.ts:174,:193`) |
| **Reassignment** | Changes **RELATIONSHIP only, never IDENTITY**, for both Truck and MOBILE — `setDriver` writes only the driver field (`truckRegistryCommands.ts:283`) |

### Not proven / unstable

| Identifier | Finding |
|---|---|
| **Warehouse id** | Stable in code (no delete, re-key or rename path) but **operationally UNPROVEN** — arbitrary operator-chosen strings, no live governed writer, and a CLI exists specifically to patch the `id` field (`warehouseCanonicalIdRepair.ts:30,44-45`) |
| **BIN id — historical** | The scheme **already changed once**, `bin_{warehouseId}__{code}` → `bin_<sha256>` (`binRegistry.ts:25-26` vs `:87`). This is precisely the hazard §4-step-3 of the cutover design warns about, already realised. `docs/architecture/SYSTEM_AUTHORITIES.md:73` still documents the retired scheme. Whether old-scheme ids survive in live ledger rows is **UNPROVEN** (a data question, not a code question) |
| **Employee id** | Body/doc-id agreement unenforced; consumers hold a `technicianId` from a different namespace |
| **Technician id** | Explicitly re-pointable (`assignTechnicianToUser.js:26-30`) and client-writable (`firestore.rules:407,418`) — **unsuitable as a permanent reference** |
| **WAREHOUSE vs MOBILE namespace** | The two share **one flat, unpartitioned, operator-typed id namespace** with no cross-collection uniqueness anywhere; the display resolver probes `warehouses` first and **warehouse silently wins** a collision — `inventoryLocation/locationDisplayReadService.ts:85-99`. `(location_type, location_id)` in `eos_ops` disambiguates *at write time only if the writer already knows the type* |

### Identifier transformation / remap sites (ledger risk)

| Site | Transform | Risk |
|---|---|---|
| `inventoryLocation/binRegistry.ts:87` | `bin_` + `sha256(nonce)[0:40]` | scheme already changed once — see above |
| `inventoryLocation/binCommands.ts:29` | `bin_code_claims/{warehouseId}__{code}` | composed doc id embeds a mutable attribute |
| `inventoryLocation/binRegistry.ts:198,232,236` | strip whitespace + `toUpperCase()` on code/area/aisle | distinct operator labels collapse onto one rack |
| `partMaster/normalization.ts:76,83,110` | `toUpperCase()`; `${manufacturerId}\|${value}`; `${aliasType}__${value}` → doc id | alias identity is a composite of type + folded value |
| `dataImport/importPreview.ts:60` **and** `dataImport/contracts/inventoryImportContract.ts:223` | `trim().toUpperCase().replace(/\s+/g,"")` — **two byte-identical copies** | two chances to diverge on import duplicate detection |
| **`dataImport/firestoreInventoryImportAdapters.ts:181-186`** | warehouse **display name** → folded key → `warehouseId` | **an imported opening-balance ledger row's location is chosen by fuzzy-matching a spreadsheet's warehouse name.** Only guard: 2 matches → `null` |
| `dataImport/firestoreDataImportAdapters.ts:228,335` | `IMP-${slug}-${shortDigest(...)}`; `serial.toUpperCase()` | import **synthesises** doc ids; the serial — SERIAL custody identity — is case-folded |
| `access/employeeProfileCommands.ts:161-163` | `value.toUpperCase()` → registry doc id | employee-number uniqueness is case-folded |
| `adminPolicy/postgresPolicyRepository.ts:611-613` | Firebase uid → **new** `principals.id` via `newId()` | mints a 4th id namespace for one human; never stored back |
| `inventoryLocation/locationDisplayReadService.ts:85-92` | probe `warehouses`, then `mobile_locations` | unpartitioned namespace; collision silently reads WAREHOUSE |
| `docs/architecture/ADR-008-part-master.md` §Decision 1 | `partId` "grandfathered to the existing sku string" | two id conventions inside one `parts` collection |
| `inventoryLocation/binParentage.ts:47` | unsafe ids **silently dropped** before read | ledger rows excluded from the warehouse aggregate with no error |

---

## 4. Duplicate authorities

**Count: 6 live duplicate-authority findings**, plus 2 retired-but-residual and 1 build artefact.

| # | Duplicate | Sources | Why both look live |
|---|---|---|---|
| **DA-1** | Part identity (display) | `parts` vs hardcoded `PARTS_CATALOG` | Static array still read live by `field-ops-app-vite/src/modules/inventoryRole/WarehouseManagerHome.jsx:177`, `.../hooks/useCanonicalPartNames.js:74`, `.../modules/inventory/PartDetail.jsx:79`, `.../analytics/operationsIntelligenceService.ts:60`; server-side `partMaster/partReferenceCompatibility.ts:70,95,137` is reachable from `workOrderSnapshotCompatibility.ts:30` but flag-gated OFF. `docs/architecture/inventory-parts-authority-contract.md` §2 de-authorises the static catalog; the cutover design names it anyway. **Ten SKUs have no canonical record** (`partsCompatibilityAdapter.js:36-38`) |
| **DA-2** | On-hand quantity | ledger vs `warehouseQty` | Three live **client** derivations of `availableStock = warehouseQty − (RESERVED − RELEASED)` that ignore every physical movement type: `field-ops-app-vite/src/domain/inventoryAnalyticsEngine.ts:273`, `.../analytics/operationsIntelligenceService.ts:49-62`, `.../domain/partsShadowParity.js:63-78` |
| **DA-3** | Employee identity | `users/{uid}` + `employees` + `fieldops_technicians` + `eos_policy.principals` | Four disjoint id spaces, no stored edge between the middle two, a fourth minted and discarded |
| **DA-4** | Employee→truck edge | write in `employees` space, read in `fieldops_technicians` space | §2.6. Mismatch fails silently (`snap.empty`). Whether the id spaces coincide is **UNPROVEN** |
| **DA-5** | Tracking-mode mapping | canonical + byte-identical copy + **divergent** client copy | `partMaster/controlTypeTrackingMode.ts:24-35`; `cycleCount/cycleCountCallableWiring.ts:59-70`; `field-ops-app-vite/src/domain/inventoryLedgerEvent.js:128-134` (different `SERIALIZED_LOT` semantics) |
| **DA-6** | Operating Company | hardcoded + `operating_companies` + config file | §2.7; the hardcoded source's self-description as inert is falsified by applied evidence |
| DA-7 *(residual)* | `stock_locations` | "retired" vs still written | `constants/collections.ts:24-27` says nothing ever wrote it; `functions/scripts/seedOperationsDemoData.js:98` writes it, `ownership/ownershipBackfillRules.ts:99` backfills it, `sb-evidence/…json` records 5 rows, `firestore.indexes.json:497-510` still indexes it, and it is a registered client entity (`field-ops-app-vite/src/metadata/entityRegistry.js:79`) |
| DA-8 *(residual)* | Serialized custody location | ledger vs `serialized_assets.currentLocation*` | §2.8 |
| DA-9 *(artefact)* | `firestore.rules` | root vs `field-ops-app-vite/firestore.rules` | Byte-identical (`diff -q`); only the root is deployed (`firebase.json`). Whether any pipeline deploys the second is **UNPROVEN** |

---

## 5. Migration constraints (MB-*) — evidence, not a work plan

| Id | Constraint | Severity |
|---|---|---|
| **MB-1** | Freeze `controlType` once ledger or serial evidence exists for a Part. The transaction is already in place (`partMasterCommands.ts:281-370`); only the read and the refusal are missing | **BLOCKER** |
| **MB-2** | Collapse the three tracking-mode mappings (DA-5), including the divergent client copy | **BLOCKER** |
| **MB-3** | Fix the hardcoded `trackingMode:"NONE"` at `workOrderConsumption/planPhysicalConsumption.ts:92,:151` | **BLOCKER** |
| **MB-4** | `serialized_assets.currentLocationType` must be written by whoever writes `currentLocationId`, before any import (§2.8) | **BLOCKER** |
| **MB-5** | State the `eos_ops.inventory_movements.part_id` contract — an FK, or a header comment mirroring `…eos-ops-foundation.sql:33-44`. Today it is `TEXT NOT NULL` with no FK and no format constraint (`:96`) | High |
| **MB-6** | Decide which warehouse predicate is authoritative — raw `status=="ACTIVE"` or `validateGovernedWarehouse` (§2.3) | High |
| **MB-7** | Resolve the employee/technician id-space join before any identity migration (DA-4) | High |
| **MB-8** | Correct the cutover design's §3 table (§6 discrepancies 1–3) | High |
| **MB-9** | Decide whether `operatingCompanyId` survives the cutover; `eos_ops` has no column for it (§2.7) | High |
| MB-10 | `LOT` / `SERIALIZED_LOT` parts are creatable (`partMaster/types.ts:31`) but uninventoriable — `ops_tracking_mode` has only `('NONE','SERIAL')` (`…eos-ops-foundation.sql:65`) | Medium |
| MB-11 | Reconcile `ops_location_type` (3 values, `:67`) with the ledger's 6 (`inventoryLedger/operationalMovementTypes.ts:112`, accepted at `operationalMovementValidation.ts:46`); no writer emits the other 3 today | Medium |
| MB-12 | Retire or gate the bypassing seed writers — `seedSandboxBaseline.js:192-208` (parts), `seedOperationsDemoData.js:85-88` (ungoverned warehouses), `seedTruckFleetFixtures.mjs:93-106` | Medium |
| MB-13 | Resolve the ten static-only SKUs (`partsCompatibilityAdapter.js:36-38`) | Medium |
| MB-14 | A stocked Part can be moved to terminal DISCONTINUED with no check (`partMasterCommands.ts:60,:382-430`), stranding its stock | Medium |
| MB-15 | Determine whether old-scheme bin ids survive in live ledger rows (§3) | Medium |
| MB-16 | `fieldops_technicians` is client-writable (`firestore.rules:407,418`) — a reference entity a browser can mutate | Medium |
| MB-17 | Update `docs/architecture/SYSTEM_AUTHORITIES.md:73` (retired bin id scheme) and the two truck metadata definitions that claim undeployed callables | Low |

### Foreign-key safety

The SQL header's reasoning for keeping `(location_type, location_id)` as opaque columns rather than
a foreign key (`…eos-ops-foundation.sql:32-43`) **still holds verbatim**: Firestore remains the sole
writer of `warehouses`, `bins` and `mobile_locations`, and no importer exists
(`functions/src/eosOps/migration/` contains none).

A future FK is **SAFE for BIN**, **CONDITIONALLY SAFE for WAREHOUSE and MOBILE**, only if:
(a) the import is **total** — every document including INACTIVE and ungoverned ones, because retired
bins hold counted stock (`binParentage.ts:14-15`) and an absent bin silently drops ledger rows
(`locationOnHand.ts:100-103`); (b) MB-11 is settled; (c) no delete path is ever introduced (trucks
currently have one — `index.ts:264`); (d) a single writer is nominated per collection; and (e) the
WAREHOUSE/MOBILE namespace collision (§3) is resolved or proven empty.
**Add the FK in the same change that imports the reference data, never before.**

---

## 6. Discrepancies against the cutover design

Against `docs/design/eos-operational-data-plane-inventory-authority-cutover.md` §3.

1. **Parts authority is misnamed.** The design says `partsCatalog` (via `data/partsCatalog.ts`).
   That is a hardcoded 200-row array whose own header disclaims stock authority
   (`functions/src/data/partsCatalog.ts:29-229`). The Firestore authority is **`parts`**
   (`partMasterRepository.ts:19`).
2. **Tracking mode is not in the named source.** `PartCatalogItem`
   (`functions/src/data/partsCatalog.ts:18-27`) has no control or tracking field. The mode is
   derived from `parts.controlType` (`partMaster/controlTypeTrackingMode.ts:24-34`).
3. **"Truck Registry = `truckRegistry/*`" names a source directory, not a collection.** The three
   real collections are `trucks`, `mobile_locations` and `location_truck_claims`
   (`truckRegistryRepository.ts:15-17`); the 1:1 guard is unnamed by the design.
4. **MOBILE is a concrete collection, and there is no single shared resolver.** The design says
   MOBILE locations are "resolved via the existing location resolver … the same resolver
   Transfer/Cycle Count already share". Receiving's resolver **refuses MOBILE outright**
   (`inventoryReceiving/receivingLocationResolver.ts:33-37`) and is WAREHOUSE-only (`:31-45`).
5. **BIN state spans four collections**, including `warehouse_bin_conversions`, which gates Cycle
   Count eligibility (`cycleCount/cycleCountLocationEligibility.ts:8`) and is written **only** by an
   operator script (`functions/scripts/completeBinConversion.mjs:6`).
6. **The bin-id change §4-step-3 warns about has already happened** (§3), and
   `docs/architecture/SYSTEM_AUTHORITIES.md:73` still documents the retired scheme.
7. **`warehouses` is not a governed AUTHORITATIVE_REFERENCE today.** Its only trusted writer is
   inert with zero importers and an unregistered capability
   (`warehouseGovernance/warehouseStatusWriter.ts:1-6,:24`); every real write comes from a seed or
   an operator CLI.
8. **§2a's "no third implementation exists" is false.** Three live client-side on-hand/available
   derivations exist (DA-2). The original grep appears to have been scoped to `functions/src`.
9. **Two live authority documents contradict each other on `CONSUMED`** — the cutover design §2a
   ("not physical") versus `docs/architecture/inventory-parts-authority-contract.md` §1 ("CONSUMED
   reduces physical on-hand"). **The code agrees with §2a.**
10. **The ledger is not purely append-only in practice.**
    `functions/scripts/ownershipSandboxBackfill.js:233` merge-writes `operatingCompanyId` /
    `source…` / `destination…` onto existing `inventory_transactions` rows
    (`ownership/ownershipBackfillRules.ts:134`), and the evidence file records 99 rows written with
    `"applied": true`. **Reconciled nuance:** the rule is guarded — it returns `ALREADY_SET` when
    any of the three fields is present (`ownershipBackfillRules.ts:136-142`), and its own header states
    the rule outright — "ALREADY_SET the ownership field is already present -- never overwritten"
    (`:21`). So it is *additive attribution* that never overwrites a movement fact, not mutation of
    the ledger's meaning. It is
    nonetheless a live writer to a table `eos_ops` models as immutable
    (`…eos-ops-foundation.sql:53-58`).
11. **An 8th reference dependency exists** — Operating Company / ownership root (§2.7).
12. **`constants/collections.ts` declares none of the seven entities** (§0), so the design's method
    could not have enumerated them mechanically.
13. **A reference entity is client-writable** — `fieldops_technicians` (`firestore.rules:407,418`).
14. **Trucks are hard-deletable** (`index.ts:264`) behind a probe documented as necessarily
    inconclusive (`operationalReferenceProbe.ts:44-46`).
15. **`employee_number_registry` is an unnamed uniqueness authority**
    (`access/employeeProfileCommands.ts:96`).
16. **`eos_policy.principals` has no stored edge back to `employees` or `fieldops_technicians`.**
17. **Truck metadata definitions claim their callables are undeployed** — contradicted by
    `functions/src/index.ts:255-265`.
18. **`putAwayCommand.ts:8-10`'s claim** that movements are counted only at `type === "WAREHOUSE"`
    is falsified by `stockRelocationCommand.ts:51` and `inventoryLedger/locationOnHand.ts:118`.

---

## 7. Cross-lane reconciliation

Resolved mechanically during integration:

- **Lane A could not locate the Part / tracking-mode source for relocation.** **Resolved:**
  `inventoryLocation/stockRelocationCallables.ts:61` injects
  `resolveTransferPartThroughTxn`, which reads `parts` through
  `buildFirestorePartRepository(db).getById` and derives the mode via the canonical
  `controlTypeToTrackingMode` (`inventoryTransfer/transferCallableWiring.ts:61-69`). Relocation
  therefore shares Transfer's resolver exactly; it is not a separate Part authority.
  Lane A's BA-3 is **closed**.
- **Lane D's "ledger is not append-only" versus Lane B's immutability reading.** **Resolved to a
  nuance, not a contradiction** — see discrepancy 10 above; the backfill is guarded by an
  `ALREADY_SET` check and is additive only.
- **Lane A read `PARTS_CATALOG` as LEGACY_INERT; Lane D read it as live.** **Reconciled:** both are
  right about different layers — the *server* dual resolver is flag-gated OFF, the *client*
  composition is live. Recorded as DA-1, display-layer only, with the ten orphan SKUs preserved.
- **Lane B proved BIN ids stable; Lane D proved the scheme already changed.** **Reconciled:** stable
  *forward from the current scheme*; historical survival of old-scheme ids is a data question,
  recorded as MB-15 and **UNPROVEN**.

Preserved as genuine contradictions, not averaged: discrepancy 9 (two authority documents disagree
on `CONSUMED`) and the two warehouse-eligibility predicates (MB-6).

---

## 8. Blocking ambiguities — owner ruling required

These cannot be resolved from code or data in this repository.

| Id | Ambiguity |
|---|---|
| **BA-1** | The `eos_ops.inventory_movements.part_id` contract is **nowhere stated**. §2.1's answer (the Firestore `parts/{partId}` doc id) is inferred from `operationalMovementValidation.ts:101-103` and what step-6 reconciliation requires — the SQL constrains nothing (`:96`), the only writer takes a caller-supplied string with no validation (`eosOps/cycleCountRepository.ts:216-222`, and `:6-9` notes it is wired to no HTTP operation), and the design names the wrong source |
| **BA-2** | **Is `tracking_mode` on a ledger row a historical fact about the movement, or a claim about the Part?** `…eos-ops-foundation.sql:53-58` asserts the former; `partBalanceReadService.ts:404` behaves as the latter. Both cannot be right, and the answer decides whether MB-1 is a hard refusal or a versioned-migration event |
| **BA-3** | **Which warehouse predicate is authoritative** — raw `status=="ACTIVE"` or the §3A validator? They admit different document sets today (§2.3) |
| **BA-4** | **Is `warehouses` meant to have a live writer this epoch?** The writer is inert *and* its capability is unregistered — a stronger statement than "not yet granted" |
| **BA-5** | Whether old-scheme bin ids survive in live ledger rows (data question; blocks total import) |
| **BA-6** | Whether the WAREHOUSE/MOBILE shared id namespace is collision-free in real data (data question) |
| **BA-7** | Whether `employees` and `fieldops_technicians` doc ids coincide in real data. DA-4's severity hinges entirely on this, and the convention is documented as an operator prerequisite rather than enforced |
| **BA-8** | Whether `operatingCompanyId` is in scope for the ledger cutover. `eos_ops` has no column; 99 sandbox rows already carry one |
| **BA-9** | Who owns writing `serialized_assets.currentLocationType`, and what the correct type is for units relocated into bins (§2.8) |

**UNPROVEN (data, not code):** whether production holds `stock_locations` documents; whether any
`trucks` / `mobile_locations` documents exist in production; the live production bundle's
`TRUCK_MANAGEMENT_WRITE_READY` value (`config/truckManagementReadiness.js:20-25` states the repo
value cannot establish it); whether `field-ops-app-vite/firestore.rules` is deployed by any
pipeline; whether `principals.id` is ever joined back to a Firestore identity; whether external
tooling re-derives `derivePartId` against existing parts.

---

## 9. Recommended dispositions

| Entity | Disposition |
|---|---|
| Part | **C. RESOLVE_BY_STABLE_ID_WITHOUT_COPY** (conditional on MB-5, MB-8) |
| Part tracking mode | **E. NEEDS_OWNER_RULING** (BA-2) |
| Warehouse | **E. NEEDS_OWNER_RULING** (BA-3, BA-4) |
| BIN | **C. RESOLVE_BY_STABLE_ID_WITHOUT_COPY** (conditional on MB-15) |
| Truck | **C. RESOLVE_BY_STABLE_ID_WITHOUT_COPY** |
| MOBILE location | **B. KEEP_EXTERNAL_REFERENCE_TEMPORARILY** — opaque string + `location_type='MOBILE'`, exactly today's schema; promote to FK only with the reference-data import named at `…eos-ops-foundation.sql:41-43` |
| Employee | **E. NEEDS_OWNER_RULING** (BA-7) |
| Employee↔Truck assignment | **E. NEEDS_OWNER_RULING**, then **D. RETIRE_DUPLICATE** on the `technicianId` join |
| Operating Company / ownership root | **E. NEEDS_OWNER_RULING** (BA-8) |
| Serialized custody location | **E. NEEDS_OWNER_RULING** (BA-9) |
| `fieldops_technicians` | **D. RETIRE_DUPLICATE** (contingent on BA-7) |
| `stock_locations` | **D. RETIRE_DUPLICATE** — already retired in code; clean up the entity-registry entry and the demo seed |

**Net:** 3 resolve-by-stable-id · 1 keep-external-temporarily · 2 retire-duplicate ·
**6 owner rulings** · 0 migrate-to-Postgres-authority in this tranche.

No reference entity is recommended for **A. MIGRATE_TO_POSTGRES_AUTHORITY** in this tranche. The
three stable-id entities need no copy at all, and the six under owner ruling must not be copied
until their authority is settled — copying them now, with no writer keeping the copy in sync, is the
exact duplication `…eos-ops-foundation.sql:32-43` and the cutover design §3 already refuse.

---

## 10. What this census does not do

It creates no table, changes no grant, migrates no row, and cuts over no reader or writer. It adds
no Firebase import, no baseline entry and no guard exemption — this document is the only file it
changes. P1A's capability activation lane was not touched.

---
---

# PART II — P1B RESOLUTION (live-data + design pass)

**Added:** 2026-09-11, same base commit `a8ec169e`. Part I above is the original discovery census and
is preserved unchanged except where a ruling explicitly supersedes it (marked inline below).

**What changed:** five architecture rulings are now authoritative, and the Firestore-side evidence
that Part I could only label UNPROVEN has been obtained against live nonprod data.

---

## 11. Architecture rulings — now authoritative

These are owner rulings. They are not re-litigated by this document; they are applied.

### R1 — CANONICAL PART ID
`eos_ops.inventory_movements.part_id` means **`Part.partId`**, which during the current transition is
exactly the document id of the authoritative Firestore `parts` record. The hardcoded `partsCatalog`
array is **not** Part authority. Aliases, manufacturer part numbers, display numbers, catalog-array
identifiers and spreadsheet names are never substitutes.

*Resolves Part I **BA-1**.* The cutover design's §3 table has been corrected accordingly
(`docs/design/eos-operational-data-plane-inventory-authority-cutover.md`, Parts row).

### R2 — TRACKING MODE SEMANTICS
Two distinct concepts that must stay distinct:
1. **movement `tracking_mode`** — an immutable historical fact describing the tracking representation
   under which that movement was recorded;
2. **`Part.controlType`** — current operational policy governing **future** inventory operations.

Historical movement rows must **never** be reinterpreted merely because `controlType` changes later.
Therefore: once a Part has inventory-movement or serialized-custody history, a direct `controlType`
transition that changes tracking semantics must **FAIL CLOSED**. A future tracking-mode conversion
requires an explicit governed conversion process that reconciles existing quantity/custody — **not
built in this packet**. Unrestricted current `controlType` mutation is classified as a **defect to
close before inventory cutover**.

*Resolves Part I **BA-2**.* Part I §2.2 asked which of the two readings was correct; R2 answers
"both, as separate fields", and makes the missing guard a defect rather than an open question.

### R3 — LOCATION IDENTITY
Inventory location identity is the **typed pair `(location_type, location_id)`**. `location_type`
distinguishes at minimum the governed types already used by the inventory model (Warehouse / BIN /
MOBILE as applicable). A raw `location_id` alone is **not** globally authoritative. Warehouse and
MOBILE may therefore share an opaque string without collision **if `location_type` is known**. Any
source row whose location type cannot be determined mechanically must be **rejected by migration
reconciliation, never guessed**.

*Resolves Part I **BA-6*** (the shared-namespace worry) *by design rather than by data.*

### R4 — EMPLOYEE / PRINCIPAL
Canonical business Employee is **`employees`**. Security identity is **`eos_policy.principals`**.
These are **different concerns, not duplicate business authorities** — Part I's `DUPLICATE_AUTHORITY`
classification for Employee is **superseded** to that extent. Firebase UID is an external identity
key mapping into an EOS Principal. `users/{uid}` and `fieldops_technicians` are legacy/compatibility
representations **unless this pass proves an independent business fact exists only there**, and
neither is promoted into the future canonical Employee model.

### R5 — OPERATING COMPANY
Operating Company authority is a **required inventory dimension**. Live ledger rows already carry it.
The PostgreSQL cutover **must not silently discard it**. The existing canonical representation is to
be identified mechanically; **no second company model may be invented**. P1B design must specify how
this authority is represented on future `eos_ops` inventory records **before export/import is
authorized**.

*Resolves Part I **BA-8** in principle* (it is in scope), and promotes Part I §2.7's "8th reference
dependency" from a finding to a requirement.

---

## 12. Nonprod live-data evidence

**Source:** Firebase project `eos-platform-sandbox`, read-only REST (`listDocuments` /
`runAggregationQuery` only), 2026-09-11. Production (`taylor-parts`) was never contacted.
**`eos_policy` / PostgreSQL: NOT_EVALUATED** — no `DATABASE_URL`, no ADC for the Render database, and
local `sudo` requires a password. Migration files were read as SQL text; whether the schemas are
applied anywhere is unknown.

### 12.0 The evidence caveat, stated first

**The sandbox is effectively 100% synthetic, and every "proven safe on live data" below is
therefore proven against a seed script.** `certification_world/current` reports datasetVersion
`1.6.0`, fingerprint `005ebb1b`, expectedRecords 1092.

`inventory_transactions`: **105 of 105 rows are seed-attributable, 0 organic** — certification-world
opening balances 87 (82.9%), legacy no-actor rows 4 (3.8%), import-derived `ACC-*` 2 (1.9%), seeded
idempotency keys (`trfmv_*`, `recvln_*`, `recvsn_*`, `cycmv_*`) 12 (11.4%). Also ~100% synthetic:
employees, transfer_orders, serialized_assets, warehouses, mobile_locations, stock_locations; ~96–99%:
locations, equipment, parts, cycle_counts.

Consequences that must be carried forward rather than forgotten:
- "Zero duplicate warehouse ids" proves the seed is internally consistent, **not** that the
  production population is clean.
- `parts.version` is **1 on all 54 docs**, so the IPN-mutation and `controlType`-flip hazards are
  **completely unexercised**. Absence of live corruption is not evidence of a guard.
- The only rows that look organic — the 4 legacy no-location rows — **break the most rules**. That
  is the shape of the real risk.

### 12.1 Collection reality check

The live sandbox collection list settles several Part I assumptions:

| Part I treated as live | Live count | Correction |
|---|---|---|
| `bins` | **0** | collection empty |
| `bin_code_claims`, `bin_placements`, `warehouse_bin_conversions` | **0 each** | empty |
| `operating_companies` | **0** | `seedOperatingCompanies.js` has never been run; company authority is **code + config, not data** |
| `manufacturers`, `part_relationships` | absent | never created |
| — | **`locations` 185** | **uncensused by Part I** |
| — | `inventory_sync_status` 16 | uncensused by Part I |

Counts: parts 54 · inventory_transactions 105 · warehouses 5 · serialized_assets 35 ·
mobile_locations 7 · trucks 2 · location_truck_claims 2 · employees 60 · users 62 ·
fieldops_technicians 13 · part_aliases 21 · cycle_counts 24 · transfer_orders 47 ·
receiving_orders 2 · inventory_returns 20 · stock_locations 5 · equipment 290 · accounts 105 ·
certification_opening_balances 87.

### 12.2 `locations` (185 docs) — the Part I gap, resolved

**It is a CRM customer-site address book, not an inventory location authority.** All 185 carry
`accountId` across 104 accounts; fields are `name / addressLine1 / city / state / owner{USER} /
fieldProvenance`; names are customer premises. **0 of 185 carry any `type` or `locationType`.** Ids
are `cw-acct-####-loc-##` (180) plus `acc-loc-NQX1QO`, `acc-loc-NUBQGX`, `loc-harbor-airport`,
`loc-harbor-downtown`, `loc-summit-flag`.

Confirmed by code: `field-ops-app-vite/src/access/objectPermissionMap.js:37` labels it
`object: "Customer Locations", domain: "CRM"`; `functions/src/ownership/ownershipMatrix.ts:134` gives
it `ownerClass: "PERSON"`; the boundary is stated outright at
`functions/src/inventoryLocation/locationDisplayReadService.ts:11-15` — "`locations` as a
customer-site directory is not modeled here — this resolver NEVER fabricates a label or a `type`".

**Zero id overlap with any inventory registry**, so R3 is not threatened by collision. It is
threatened by something subtler — see 12.7.

### 12.3 Part — identity is clean

- **Zero orphans.** 49 distinct inventory-referenced partIds, **all** resolve to `parts` doc ids;
  `_id === partId` on all 54. Orphans in inventory_transactions, serialized_assets, stock_locations,
  receiving_orders, cycle_counts, transfer_orders, inventory_returns, part_aliases,
  certification_opening_balances (87 rows / 32 partIds), part_supplier_items: **0 in every one**.
- **Zero catalog leakage.** `functions/src/data/partsCatalog.ts` holds 200 `TST-####` SKUs (client
  mirror byte-identical). Intersection with inventory-referenced ids = ∅; with `parts` doc ids = ∅;
  with `parts.sku` = ∅. All ten static-only exclusions
  (`field-ops-app-vite/src/domain/partsCompatibilityAdapter.js:36-38`) appear **nowhere** in live
  data. **R1 is upheld with no live counter-example.**
- **Aliases clean.** 21 docs, `_id === aliasId === "{aliasType}__{normalizedValue}"` on all 21.
  Alias values mapping to >1 part: **0** (structurally impossible via the derived id). Orphan-owner
  aliases: **0**.
- **The brief's own premise was wrong and is corrected here:** there are **no `IMP-`-shaped part
  ids**. `IMP-` is the *account* prefix
  (`functions/src/dataImport/firestoreDataImportAdapters.ts:226-229`). Import-derived parts are
  `ACC-NQX1QO-1` / `ACC-NUBQGX-1`, whose partId is the IPN verbatim with no digest.
- **R1 condition to carry:** `internalPartNumber` IS mutable
  (`functions/src/partMaster/partMasterCommands.ts:253,:256`), and on change `:302-349` atomically
  preserves the old IPN as an ACTIVE `INTERNAL_PN` alias. **`part_aliases` is therefore load-bearing
  Part-identity data, not a lookup convenience** — after any IPN edit, `derivePartId(IPN)` no longer
  reproduces the id. Live divergence: **0** (all parts at version 1 — unexercised, not guarded).

### 12.4 Tracking mode — R2's defect is real in code, dormant in data

- **controlType distribution:** `STANDARD` 42, `SERIALIZED` 12. No LOT / SERIALIZED_LOT live.
  Status ACTIVE 52 / DRAFT 2.
- **R2 conflict list: EMPTY.** For every part with history, the recorded movement `trackingMode`
  agrees with what its current `controlType` maps to. cycle_counts 24/24 NONE ✓ · transfer_orders
  47/47 NONE ✓ · receiving_orders both lines ✓ · **serialized_assets 0/35 sit under a
  non-SERIALIZED part**. `certLedgerTrackingMode` present on 45 parts, **0 disagree**.
- **But the guard does not exist.** `grep -iE "inventory_transactions|ledger|movement|history|
  trackingMode|serialized" functions/src/partMaster/partMasterCommands.ts` → **zero matches**.
  `updatePart` performs only a version check, shape re-validation, and an `equipmentModelId` FK
  check. So today `PRT-1001` (14 ledger rows) can flip STANDARD→SERIALIZED, and `PRT-2001` /
  `CW-P-0403` (serialized assets **and** SERIAL ledger rows) can flip SERIALIZED→STANDARD, in one
  call by any `inventory.catalog.manage` holder. **This is exactly the corruption R2 exists to
  prevent.**
- **Three tracking vocabularies coexist on live `parts` docs:** `controlType`
  {STANDARD, SERIALIZED} 54/54 · `partTrackingMode` {QUANTITY, SERIAL} 52/54 ·
  `certLedgerTrackingMode` {NONE, SERIAL} 45/54 — the latter two disagree lexically on **34 parts**.
  (Part I §2.1 found `partTrackingMode` had zero readers; it has 52 live *writers'* worth of data.)

### 12.5 Warehouse — BA-3 does not reproduce

- 5 warehouses: `wh-main` (ACTIVE, taylor) · `wh-north` (ACTIVE, ventana) · `wh-retired` (INACTIVE,
  taylor) · `wh-sandbox-central` (ACTIVE, taylor) · `wh-sandbox-north` (ACTIVE, ventana). All
  `provenance: NATIVE`, `version: 1`.
- **All referenced ids resolve; non-resolving: NONE.** Only `wh-main` and `wh-north` are referenced
  by anything. No duplicate names. **No `code` field exists in the warehouse schema at all**
  (`functions/src/warehouseGovernance/governedWarehouseValidation.ts:36-55`) — so Part I's
  "duplicates by name/code" question is partly moot. No id reuse.
- **BA-3 resolved: the two predicates admit IDENTICAL sets.** Replaying all 21 fail branches of
  `validateGovernedWarehouse` over the 5 live docs:
  raw `status=="ACTIVE"` → 4 docs; governed-valid AND ACTIVE → **the same 4**; symmetric difference
  **∅**. BA-3 is a **latent code-consolidation risk, not a live divergence**.
- Caveat: two seed generations coexist, giving taylor two ACTIVE roots and ventana two — so any
  "one active root per company" assumption is wrong here.

### 12.6 BIN — the orphan class is empty, not unresolved

`bins` 0 · `bin_code_claims` 0 · `bin_placements` 0 · `warehouse_bin_conversions` 0.

A regex scan of the raw JSONL of inventory_transactions, serialized_assets, cycle_counts,
transfer_orders, receiving_orders, stock_locations and inventory_returns for `/bin[_A-Za-z0-9]*/`
and for the literal `"BIN"` returns **0 matches of either**. All `location.type` values ∈
{WAREHOUSE, MOBILE}.

**Part I MB-15 / BA-5 resolved: zero old-scheme (`bin_{warehouseId}__{code}`) and zero new-scheme
(`bin_<40 hex>`) ids exist in live data.** The bin-id scheme change is real in code history but has
**no live blast radius**. No historical-id reconciliation map is needed.

This must be stated together with its opposite: `ops_location_type` reserves `'BIN'` and the
cycleCount / transfer / relocation code branches on BIN heavily. The concept is live; the data is not.

### 12.7 R3 — type recoverability, measured

| Source | Rows | Type stored? |
|---|---|---|
| `inventory_transactions` | **101 / 105** | typed `location:{type, locationId}`; all 8 `counterpartyLocation` values typed too |
| `inventory_transactions` (legacy) | **4** | **no location field at all** |
| `cycle_counts` | 24 / 24 | typed |
| `transfer_orders` | 47 / 47 | typed on both origin and destination |
| `certification_opening_balances` | 87 / 87 | typed |
| **`serialized_assets`** | **0 / 35** | **bare untyped scalar — R3 violated** |
| `stock_locations` | 5 | type implied by field name `warehouseId` |
| `equipment` | 290 | bare scalar → **customer sites**, not inventory |

8 distinct typed pairs in the ledger: `(WAREHOUSE, wh-main)` 41 · `(MOBILE, cert-trk-01)` 17 ·
`(MOBILE, cert-trk-02)` 15 · `(MOBILE, cert-trk-03)` 12 · `(MOBILE, cert-trk-05)` 7 ·
`(MOBILE, cert-trk-04)` 4 · `(MOBILE, mobile-seed…-101)` 3 · `(WAREHOUSE, wh-north)` 2.
**Raw-id collision across types: ∅.**

**BA-6 resolved — the namespace collision is empty.** `warehouses` ∩ `mobile_locations` = ∅;
`locations` ∩ each = ∅; trucks / stock_locations likewise. **But disjointness rests on a prefix
convention (`wh-` vs `cert-trk-` / `mobile-`) enforced by no constraint, rule or validator.** Safe
by accident, not by construction — which is precisely why R3's typed pair is the right model.

**The real R3 threat is not collision, it is a shared field name.** `equipment.locationId`
(290/290) resolves **100% into `locations`** (customer sites) and 0% into inventory registries, while
`serialized_assets.currentLocationId` and `cycle_counts.location.locationId` resolve 100% the other
way. One field name, two disjoint namespaces, **no type discriminator on either side**. A migration
that unions `locationId`-named fields merges 290 customer sites into the inventory location
namespace.

**Untyped-scalar readers that discard type** (the live R3 defect surface):
`functions/src/inventoryAnalyticsCallables.ts:91-95` (says outright "currentLocationId is a typeless
scalar", then falls back to *assume warehouse*) · `functions/src/inventoryTransfer/transferOrderCommand.ts:232,:332` ·
`functions/src/cycleCount/cycleCountExpectedQuantity.ts:74`.

### 12.8 Employee / truck / MOBILE — BA-7 answered

**The decisive question Part I could not answer: `employees` and `fieldops_technicians` doc ids DO
coincide — for 11 of 13.**

- 13 technician ids: `cw-emp-012` … `cw-emp-022` (11), `tech-sbx-01`, `tech-sbx-02`.
- For all 11 `cw-emp-*`: doc id == `technicianId` == `employeeId` == the `employees` doc id, all with
  `securityRole: "technician"` and a resolvable UID.
- **2 orphans — `tech-sbx-01`, `tech-sbx-02`** — exist as no employee. `tech-sbx-02` also has
  `userId: null`: **it exists in no other collection**, so a cutover treating `employees` as complete
  deletes it. **15% of the technician population is unrepresented in the canonical authority.**

**The UID ↔ Employee edge is a clean bijection:** employees 60, `userId` populated **60/60**, zero
dangling in either direction, **zero bidirectional disagreements**; `users` 62, `employeeId` on
60 — the 2 extras are self-evident probe artifacts (`PROBE_NOT_A_REAL_UID`,
`probe-principal-that-does-not-exist`).

**R4's exception clause fires, narrowly.** `fieldops_technicians.skills` exists on **0 of 60
employees** (no skills-like field at all): `tech-sbx-01` `["refrigeration","ice-machines"]`,
`tech-sbx-02` `["refrigeration"]`. Dispatch `status` (available 11 / off_shift 2) likewise has no
`employees` equivalent. Every other technician field is a duplicate projection agreeing 11/11
(`name`→`displayName`, `phone`→`certPhone`, `status`→`certAvailable`). `users/{uid}` carries **no**
surviving business fact (one vocabulary skew: uid `0TeiR5wPHCXoAIJShLsY8HDMzJN2` has
`users.role="admin"` vs `employees.securityRole="Owner"`, and `"Owner"` is absent from
`type Role` at `functions/src/callerContext.ts:8`).

**`grep -i "employee" functions/migrations/*.sql` → ZERO MATCHES.** `principals`
(`1757548800000_tenant-and-identity.sql:79-92`) has no `employee_id` and there is no join table —
**the R4 identity mapping currently has nowhere to live.**

**The truck assignment read-side defect is live and reproducible.**
- Trucks: `TRK-SEED-101` — driver `"sbx-tech"`, location `mobile-seed1786749487428-101`, taylor.
  `TRK-SEED-102` — driver `null`, location `mobile-seed1786749487428-102`, ventana.
- `"sbx-tech"` resolves in **`employees` only**; `fieldops_technicians/sbx-tech` does not exist.
  Write side is correct (`truckRegistryRepository.ts:196-199` validates against `employees`).
- Read side (`functions/src/workOrderConsumption/consumptionSourceService.ts:72`) compares
  `assignedDriverEmployeeId` against `users/{uid}.technicianId`, which is a **`fieldops_technicians`**
  id (`functions/src/completeAssignedJob.ts:44,:300`). **Two key spaces, silently equated.**
- **Live outcome: 0 of 13 technicians resolve to a truck.** Only 1 user doc carries `technicianId`
  at all (`rgVA63… → tech-sbx-01`); that one reaches the query, matches nothing, and returns
  `{mobile: null, ambiguous: false}` — **no truck, no error, no ambiguity flag**. The other 12 fail
  loudly upstream at `consumptionSourceCallables.ts:38-39`. Meanwhile that same human's truck
  exists: `users/rgVA63….employeeId == "sbx-tech" == TRK-SEED-101.assignedDriverEmployeeId`.
- Same join reused at `cycleCount/cycleCountSheetCallables.ts:221-225`,
  `inventoryTransfer/transferReceivableRead.ts:92-96`, `workOrderConsumption/planPhysicalConsumption.ts:66`.
- **Deterministic fix:** key the read the way the write keys — resolve `uid → users/{uid}.employeeId`
  (60/62 present, 0 dangling, 0 disagreements) and query on that. The live data then resolves
  end-to-end. No business ruling needed; R4 already names `employees` canonical.

**MOBILE:** 7 locations, all `active: true`. Both `location_truck_claims` rows are internally
consistent in both directions; 0 dangling claims. **5 of 7 have no Truck and no claim —
`cert-trk-01`…`cert-trk-05` — yet they carry 55 ledger references** (17/15/12/4/7). Every referenced
MOBILE id still exists, so this is not deletion: it is five certification-world mobile locations
holding real inventory history **with no custodian and no driver**.

### 12.9 Operating company — the canonical representation, and what is lost

**Canonical key: `operatingCompanyId`. Values: exactly `"taylor"` | `"ventana"` (lowercase).**
`functions/src/ownership/operatingCompanyAuthority.ts:22-25` (`OPERATING_COMPANY_IDS`), `:37-50`
(aliases), `:68-70` (shape guard `/^[a-z][a-z0-9_-]{1,62}$/`), `:76-81` (`resolveOperatingCompany` →
INVALID | UNKNOWN | INACTIVE | RESOLVED). Client mirror parity-asserted at
`field-ops-app-vite/src/domain/operatingCompanyAuthority.js:34-58`. **No competing representation
exists**; `code` and `displayName` are explicitly never authority (`:36`, `:83-85`), and six proxies
are explicitly forbidden (`operatingCompanyAuthority.js:10-24`). Part I DA-6 is **superseded**: the
three "competing sources" are one model with an authored config and an unrun seed.

**Authored source of truth:** `config/ownership/operating-company-roots.sandbox.json` — 12 root
decisions (5 warehouses `:34-66`, 7 mobile_locations `:67-110`), the file itself stating (`:7-11`)
"THEY ARE NOT INFERRED, AND NO CODE MAY EVER INFER THEM."

**Trap:** `serialized_assets.ownership = "COMPANY"` (35/35) is the **title-holder** attribute
(`functions/src/serializedAsset/types.ts:58-60`), **not** an operating company. Do not conflate.

**Live ledger attribution (105 rows):**

| | count |
|---|---|
| scalar `operatingCompanyId` = taylor | 85 |
| scalar = ventana | 12 |
| PARTICIPATING PAIR ventana→taylor | 1 |
| PARTICIPATING PAIR taylor→ventana | 1 |
| **carrying authority** | **99** |
| **missing entirely** | **6** |
| invalid / unknown values | **0** |
| stored-vs-derived disagreements | **0** |

**What `eos_ops` loses on import today: 99 of 105 rows (94.3%), silently and totally.**
`grep -iE "operating_compan|operatingCompany|company_id" functions/migrations/*.sql` → **ZERO
MATCHES**. `inventory_movements` (`1757808000000_eos-ops-foundation.sql:93-122`),
`serialized_custody` (`:136-150`) and `cycle_count_sheets` (`:159-174`) carry only `tenant_id` →
`eos_policy.tenants`, which is the **platform customer**, a different axis; both operating companies
live in one tenant. The 2 participating-pair rows — **the only cross-company movements in the
dataset, the exact records the roots config was split to certify** — lose their directional
attribution entirely. **23 of 47 transfer_orders (49%) are cross-company** and face the same loss.
Re-derivation afterwards is impossible from `eos_ops` (nothing to derive from) and impossible from
Firestore alone for the 58 MOBILE rows.

**The MOBILE company gap — and why the obvious fallback is wrong.** `mobile_locations` is a co-equal
PRIMARY ROOT (`functions/src/ownership/ownershipMatrix.ts:269-282`), but **0 of 7 live
mobile_locations carry `operatingCompanyId`**, and no assignment script covers them
(`functions/scripts/assignWarehouseRootCompany.js:76` is warehouses-only). A "derive from
`homeWarehouseId`" fallback is **provably wrong**: `cert-trk-01`…`cert-trk-05` all carry
`homeWarehouseId = "wh-main"` (taylor), but the authored ruling makes `cert-trk-04` and `cert-trk-05`
**ventana** — 11 ledger rows would be silently re-attributed. The code already says so:
`functions/src/cycleCount/cycleCountSheetCallables.ts:46` — "a truck's company is not derived here".
**The only truth for MOBILE roots is the authored config file, which is not in Firestore.**

**Part: company-neutral, correctly** — REFERENCE / COMPANY_NEUTRAL, `ownerType: null`, `NOT_OWNABLE`
(`ownershipMatrix.ts:409-424`), absent from `ownershipDerivation.ts:59-104`, live 0/54. **Warehouse:
it IS the company boundary root** (`ownershipMatrix.ts:269-282`), live 5/5 stamped and matching the
authored config exactly; derived families verified live (trucks 2/2, stock_locations 5/5).

**Only two writes since the 2026-08-30 backfill, and both are unstamped** —
`imv_88d0daa908bdcd3b82f3a9cf8c8dfdb185d8b810` and `imv_a2142a43369660940db9114161b992269616a5e5`,
both `{WAREHOUSE, wh-main}` → derivable as taylor. **Live proof that no writer stamps the field**;
the backfill was a one-shot, and Part I §2.7's reading of it as an ongoing authority is corrected.

### 12.10 Serialized custody — code defect confirmed, data hazard latent

**`currentLocationType` is ABSENT on all 35 rows — 0/35 have the field at all.** Repo-wide grep
returns **exactly one hit**: `functions/src/workOrderConsumption/consumptionSourceService.ts:124`, a
read with `?? "WAREHOUSE"`. **Written in zero places, so the default is taken 100% of the time.**
Writers put typeless ids in: `inventoryLocation/stockRelocationCommand.ts:447` (endpoints
WAREHOUSE|BIN), `inventoryTransfer/transferOrderCommand.ts:461` (WAREHOUSE|BIN|MOBILE),
`serializedAsset/acquireSerializedAssetCommand.ts:261`.

**Part I §2.8 / BA-9 is CONFIRMED IN CODE and REFUTED IN DATA.** Zero live rows carry a bin id — all
35 have `currentLocationId = "wh-main"`. No bin has ever existed and no serial has ever been
relocated, so the hazard is **latent, not manifest**.

**Classification of all 35:**

| Class | Count | Ids |
|---|---|---|
| VALID_TYPED_LOCATION | **33** | 31 AVAILABLE + 2 RECEIVED, all @ `wh-main` |
| REPAIRABLE_TYPE_MISMATCH | **0** | — |
| ORPHAN_LOCATION | **0** | — |
| AMBIGUOUS_LOCATION | **0** | — |
| INSTALLED_LOCATION | **2** | `sa_b23c5a1a5ba988e1a985662d46a1f7029b0c52df`, `sa_f898c9019d6a0ec00729530eb2066306b1da3c39` |
| OTHER_EXPLICIT_STATE | **0** | see caveat |

*Caveat, stated openly:* the 2 RECEIVED units
(`sa_253b2f47f5a7b4b3ebbad504ebd6f9f87a928d74`, `sa_e69fdc0b0d729d9fa5678efd2a588744c9b4fa2f`) have a
valid typed location, so on the **location** axis they are VALID; on the **state** axis they are
unmappable (see 12.11). If OTHER_EXPLICIT_STATE is meant to capture state-driven export exceptions,
they move there and VALID drops to 31.

**INSTALLED is by design, not a defect** — `installSerializedAssetCommand.ts:334-343` deliberately
does not move `currentLocationId` (the origin is preserved as `installedFromLocationId` at `:327`).
But both units are physically at **customer sites** (`loc-harbor-airport`, `cw-acct-0003-loc-00`)
while `currentLocationId` still reads `wh-main`, and `serialized_custody` (`:141-148`) requires
NOT NULL `(location_type, location_id)` from a **3-value enum that has no CUSTOMER value**. So on
import these two rows would assert a warehouse location for a machine sitting at a customer.

**Normalization determinism:** location type is DETERMINISTIC for all 35 (registry probe: bins →
BIN via governed parent, else warehouses → WAREHOUSE, else mobile_locations → MOBILE, else REJECT —
the rule already written at `inventoryAnalyticsCallables.ts:91-95`), **valid only while the
namespaces stay disjoint**. The 2 INSTALLED units' **custody semantics** are not deterministic, and
the 2 RECEIVED units' **status mapping** is not deterministic.

### 12.11 New blockers this pass found that Part I did not

| Id | Finding | Severity |
|---|---|---|
| **NB-1** | **Three sign conventions in one source column.** `quantity_delta` is signed; live rows split `direction=SIGNED` (90, quantity self-signed), `IN` (7, unsigned), `OUT` (**4, unsigned POSITIVE**), null (4). **A naive `quantity → quantity_delta` copy inverts 4 TRANSFER_OUT rows and 1 CONSUMED row — silent balance corruption that satisfies every table constraint.** | **CRITICAL** |
| **NB-2** | **Movement-type enum gap.** Live `type` values **RESERVED (2), CONSUMED (1), RELEASED (1)** have no value in `ops_movement_type` (`1757808000000:72-79`). RESERVED/RELEASED are reservation events, not quantity movements — and `inventory_movements` has `CHECK (quantity_delta <> 0)` while being "THE SOLE QUANTITY-MUTATING RECORD". **No `eos_ops` reservation table exists in any migration.** | **BLOCKER** |
| **NB-3** | **Location-type vocabulary 6 vs 3.** `inventoryLedger/operationalMovementTypes.ts:112` declares WAREHOUSE, BIN, MOBILE, **VENDOR, CUSTOMER, VIRTUAL**; `ops_location_type` has 3. Writable via `LocationRef.type`; live impact 0. | High (latent) |
| **NB-4** | **Serial-status vocabulary 8 vs 5.** `serializedAsset/types.ts:46-55` vs `ops_serial_status` (`:80`). **`RECEIVED` is unmappable — live impact 2 rows.** Mapping to AVAILABLE asserts pickability; RESERVED asserts a reservation that does not exist. | High |
| **NB-5** | **`eos_ops` has no operating-company column** — 12.9. | **BLOCKER** |
| **NB-6** | **INSTALLED serials have no valid target location type** (true site is CUSTOMER; enum lacks it) — 12.10. `ops_serial_status` *does* include `'INSTALLED'`, so the schema anticipates the state while providing no location type for it. | **BLOCKER** |
| **NB-7** | **`inventory_sync_status` (16 docs, 5 carrying recorded failures) is the idempotency guard for work-order inventory effects and has no target table in any migration.** Dropping it re-opens processed work orders to replay. | **BLOCKER** |
| **NB-8** | **The 4 legacy ledger rows are invisible to the governed reader.** `inventoryLedger/operationalMovementRepository.ts:94` filters `schemaVersion === 2`, so a migration driven by that repository **drops them with no reject record**. | High |
| **NB-9** | **2 orphan `fieldops_technicians` + the `skills`/`status` facts** — 12.8. | High |
| **NB-10** | **The sandbox is ~100% synthetic** — 12.0. Every live proof in this pass is bounded by this. | High (evidence quality) |
| **NB-11** | **`stock_locations` is a denormalised balance cache** (`quantity` and `quantityOnHand` both populated and equal in all 5 rows) with no target and no owner. If it survives it becomes a second balance authority against `eos_ops`'s "the ledger row IS the balance" (`1757808000000:87-89`). | Medium |
| **NB-12** | **The repo's only governed id→type resolver, `locationDisplayReadService`, is registered `active:false` and granted to no role.** There is currently **no enabled type resolver** to implement R3 with. | Medium |
| **NB-13** | **`trucks` and `mobile_locations` are unlinked registries for the same physical truck** — `TRK-SEED-101` / `mobile-seed…-101`, both "Truck 101 (seed)", neither referencing the other. `trucks` holds `operatingCompanyId` and the driver; `mobile_locations` holds neither but is the id the **ledger** references. Compounds NB-5. | Medium |

---

## 13. Blocker resolution

Every Part I ambiguity, resolved to one of the four required classes. **Nothing is left as an owner
ruling merely because the code is messy.**

| Id | Subject | Resolution | Basis |
|---|---|---|---|
| **BA-1** | `part_id` contract | **RESOLVED BY RULING R1** | R1; upheld live with zero orphans and zero catalog leakage (12.3) |
| **BA-2** | tracking-mode semantics | **RESOLVED BY RULING R2** → the residue is **PROVEN_DEFECT_WITH_DETERMINISTIC_FIX** | R2; guard provably absent (12.4). Fix: read history in `updatePart`'s existing transaction, reject a semantics-changing transition. Zero data reconciliation |
| **BA-3** | which warehouse predicate | **PROVEN_SAFE** (latent risk only) | Symmetric difference over all 5 live docs is ∅ (12.5). Consolidation is hygiene, not a cutover gate |
| **BA-4** | should `warehouses` have a live writer this epoch | **PROVEN_SAFE for the inventory boundary** — not an owner ruling | Warehouse identity is stable, 5 docs, no reuse, no delete path. Whether an admin UI writer ships is a product decision **outside the inventory cutover boundary**; the ledger needs identity stability, which it has |
| **BA-5** | old-scheme bin ids in live ledger | **PROVEN_SAFE** | Zero bin-shaped ids and zero `"BIN"` location types in any live collection; `bins` is empty (12.6). No reconciliation map needed |
| **BA-6** | WAREHOUSE/MOBILE namespace collision | **PROVEN_SAFE**, and **RESOLVED BY RULING R3** for the general case | Intersection ∅ across all four registries (12.7). R3's typed pair makes the convention non-load-bearing going forward |
| **BA-7** | do `employees` and `fieldops_technicians` ids coincide | **PROVEN_DEFECT_WITH_DETERMINISTIC_FIX** for the read-side join; **LIVE_DATA_RECONCILIATION_REQUIRED** for the 2 orphan technicians | 11/13 coincide; the join breaks 0/13 with one silent failure; fix is to key on `employees` as the write side already does (12.8) |
| **BA-8** | is operating company in scope | **RESOLVED BY RULING R5** (yes) → residue **PROVEN_DEFECT_WITH_DETERMINISTIC_FIX** | R5; canonical key and values are unambiguous, the authored config is declared non-inferable, and 4 of 6 unstamped rows are derivable (12.9) |
| **BA-9** | who writes `currentLocationType` | **PROVEN_DEFECT_WITH_DETERMINISTIC_FIX** | Three writers already know the type and discard it; the reader defaults. Stamp at the writers, delete the `?? "WAREHOUSE"` default, fail closed (12.10) |

**Genuinely remaining — TRUE_OWNER_RULING_REQUIRED (4, all narrow and none of them "the code is messy"):**

| # | Ruling needed | Why code cannot decide it |
|---|---|---|
| **OR-1** | **How does operating company ride on `eos_ops` inventory records** — a scalar column, a source/destination pair, or both? | The live data contains **both shapes** (99 scalar, 2 directional), and 49% of transfer_orders are cross-company. This is a schema-modelling decision with no single mechanically correct answer. R5 mandates that it be answered; it does not answer it |
| **OR-2** | **What is the operating company of the 5 `cert-trk-*` MOBILE locations, and who owns stamping it** | The only truth is an authored config file declared non-inferable; the obvious derivation is provably wrong for 2 of 5. A human authored those roots and a human must confirm them into Firestore or into the export |
| **OR-3** | **Custody semantics for INSTALLED serialized units** (NB-6) — does an installed unit keep a warehouse location, gain a CUSTOMER location type, or leave the location model entirely? | The enum has no CUSTOMER value while `ops_serial_status` has INSTALLED; the two halves of the schema disagree about whether installed units are located |
| **OR-4** | **Must the future Employee model carry a technician-capability attribute** (`skills`, dispatch `status`) before `fieldops_technicians` is retired, and what happens to the 2 orphan technicians | R4 classifies it legacy "unless an independent business fact exists only there". One does. R4 explicitly defers to this pass to decide whether the exception fires — it does |

**Reduction: Part I carried 9 blocking ambiguities. 5 are now PROVEN_SAFE or resolved by ruling, 4
reduce to deterministic fixes, and 4 narrow owner rulings remain — 2 of which (OR-1, OR-2) are the
same operating-company question R5 already declared in scope.**

---

## 14. Cutover-time dispositions

Target reminder: **zero Firebase dependency.** `STABLE_EXTERNAL_REFERENCE_ALLOWED_DURING_CUTOVER`
means *temporary, for the cutover window only* — never permanent architecture.

| Entity | Cutover-time disposition | Condition |
|---|---|---|
| **Part** | STABLE_EXTERNAL_REFERENCE_ALLOWED_DURING_CUTOVER | `part_id` resolves by stable id (R1). Requires the R2 guard shipped first |
| **Part tracking mode** | STABLE_EXTERNAL_REFERENCE_ALLOWED_DURING_CUTOVER | Movement rows already carry their own immutable `tracking_mode` (R2). Requires the guard |
| **Warehouse** | STABLE_EXTERNAL_REFERENCE_ALLOWED_DURING_CUTOVER | Identity proven stable; 5 docs; no reuse |
| **BIN** | STABLE_EXTERNAL_REFERENCE_ALLOWED_DURING_CUTOVER | Zero live rows — nothing to migrate or reconcile |
| **Truck** | STABLE_EXTERNAL_REFERENCE_ALLOWED_DURING_CUTOVER | Identity stable; reassignment is relationship-only |
| **MOBILE location** | STABLE_EXTERNAL_REFERENCE_ALLOWED_DURING_CUTOVER | **Blocked until OR-2**: 58 ledger rows (55%) depend on a company value these docs do not carry |
| **Employee** | NOT_IN_INVENTORY_BOUNDARY | No ledger column references an employee. Enters the boundary only via the truck-assignment read |
| **Employee↔Truck assignment** | MUST_RETIRE_BEFORE_CUTOVER | The `technicianId` join must be retired in favour of the `employeeId` key the write side already uses. It resolves 0/13 today |
| **Operating Company** | **POSTGRES_AUTHORITY_REQUIRED_BEFORE_INVENTORY_CUTOVER** | R5. 94.3% of the live ledger loses attribution otherwise, unrecoverably |
| **Serialized custody location type** | MUST_RETIRE_BEFORE_CUTOVER | The untyped scalar + `?? "WAREHOUSE"` default must be retired; R3 forbids guessing |
| **`inventory_sync_status`** | **POSTGRES_AUTHORITY_REQUIRED_BEFORE_INVENTORY_CUTOVER** | NB-7 — the idempotency guard must survive or processed work orders replay |
| **`fieldops_technicians`** | MUST_RETIRE_BEFORE_CUTOVER *(the join only)* | Subject to OR-4 for the `skills` fact and the 2 orphans |
| **`users/{uid}`** | NOT_IN_INVENTORY_BOUNDARY | Pure compat; no surviving business fact |
| **`stock_locations`** | MUST_RETIRE_BEFORE_CUTOVER | NB-11 — a second balance authority cannot coexist with the ledger-is-balance rule |
| **static `partsCatalog`** | NOT_IN_INVENTORY_BOUNDARY | Zero live leakage into inventory (12.3); display-layer only |
| **`locations` (CRM sites)** | NOT_IN_INVENTORY_BOUNDARY | Customer address book; zero id overlap. **But see NB/12.7: never union it by field name** |

## 15. Final EOS dispositions

The steady state after Firebase exit. These are **not** the cutover-time answers above.

| Entity | Final EOS disposition |
|---|---|
| Part | **MIGRATE_TO_POSTGRES_AUTHORITY** |
| Part tracking mode (`controlType` policy) | **MIGRATE_TO_POSTGRES_AUTHORITY** (as a Part attribute; the movement's `tracking_mode` stays an immutable ledger fact per R2) |
| Warehouse | **MIGRATE_TO_POSTGRES_AUTHORITY** |
| BIN | **MIGRATE_TO_POSTGRES_AUTHORITY** |
| Truck | **MIGRATE_TO_POSTGRES_AUTHORITY** |
| MOBILE location | **MIGRATE_TO_POSTGRES_AUTHORITY** (and NB-13: unify with `trucks`, which is the same physical thing under two unlinked registries) |
| Employee | **EOS_IDENTITY_MAPPING** — `employees` (business) ↔ `eos_policy.principals` (security) per R4. **The mapping has nowhere to live today**: zero `employee` references in any migration |
| Employee↔Truck assignment | **MIGRATE_TO_POSTGRES_AUTHORITY** |
| Operating Company | **MIGRATE_TO_POSTGRES_AUTHORITY** |
| Serialized custody | **MIGRATE_TO_POSTGRES_AUTHORITY** (typed pair, per R3) |
| `inventory_sync_status` | **MIGRATE_TO_POSTGRES_AUTHORITY** |
| `users/{uid}` | **RETIRE** → replaced by the R4 identity mapping |
| `fieldops_technicians` | **RETIRE** — subject to OR-4 preserving `skills` / dispatch status onto Employee first |
| `stock_locations` | **RETIRE** |
| static `partsCatalog` | **RETIRE** |
| Inventory balances | **DERIVED_ONLY** — unchanged; the ledger row is the balance |
| `locations` (CRM sites) | **MIGRATE_TO_POSTGRES_AUTHORITY** under the CRM domain, **not** the inventory boundary |

---

## 16. Minimum P1B implementation packet

The smallest set proven necessary before inventory export/import is authorized. **Specification
only — nothing here is built in this run.** Items are included only where this census produced
direct evidence; speculative abstractions are listed at the end as explicitly **excluded**.

### P1B-1 — `controlType` mutation guard *(runtime guard)*
Close the R2 defect. In `updatePart`'s **existing** transaction
(`functions/src/partMaster/partMasterCommands.ts:258-370`), read for any `inventory_transactions` or
`serialized_assets` history for the part and reject when the mapped `trackingMode` would change.
No new transaction, no schema, no data reconciliation. **Evidence:** 12.4.

### P1B-2 — canonical `part_id` contract *(validation + comment)*
Assert R1 at the `eos_ops` boundary: `part_id` is the `parts` doc id. At minimum a schema comment
mirroring the file's own location-column rationale (`1757808000000:33-44`), plus validation at the
writer (`functions/src/eosOps/cycleCountRepository.ts:216-222` currently accepts any string).
Record that **`part_aliases` is load-bearing identity data** under IPN mutation. **Evidence:** 12.3.

### P1B-3 — operating-company authority on `eos_ops` *(schema design — requires OR-1)*
Specify how `operatingCompanyId` rides on inventory records, covering **both** live shapes (scalar
and source/destination pair). Must be settled **before** export, since 94.3% of rows and 49% of
transfer orders depend on it and re-derivation afterwards is impossible. Includes stamping
`mobile_locations` from the authored config (**requires OR-2**) and adding a stamping writer, since
the 2 post-backfill rows prove none exists. **Evidence:** 12.9, NB-5.

### P1B-4 — typed location at the serialized-custody writers *(runtime guard)*
Stamp `currentLocationType` at all three writers (`stockRelocationCommand.ts:447`,
`transferOrderCommand.ts:461`, `acquireSerializedAssetCommand.ts:261`), delete the `?? "WAREHOUSE"`
default at `consumptionSourceService.ts:124`, and fail closed. Backfill the 35 live rows
deterministically by registry probe. **Evidence:** 12.10, BA-9.

### P1B-5 — quantity sign-convention normalization contract *(export/import mapping spec)*
**The highest-severity item in this packet.** Define the `quantity → quantity_delta` mapping per
`direction` (`SIGNED` / `IN` / `OUT` / null). A naive copy inverts 4 TRANSFER_OUT rows and 1
CONSUMED row, producing corruption that satisfies every table constraint and is invisible
afterwards. **Evidence:** NB-1.

### P1B-6 — vocabulary reconciliation *(schema decision, no migration in this packet)*
Three enum gaps, each with a live or reachable impact: movement type (NB-2 — including **where
reservation events live, since `eos_ops` has no reservation table**), location type (NB-3, 6 vs 3),
serial status (NB-4 — `RECEIVED` unmappable, 2 live rows). **OR-3** is required for the INSTALLED
location-type half.

### P1B-7 — employee/truck crosswalk fix *(runtime fix, deterministic)*
Re-key the read side from `users/{uid}.technicianId` to `users/{uid}.employeeId` at
`consumptionSourceService.ts:72` and the three sibling call sites. Restores 0/13 → resolving, and
removes the silent-null path. **Evidence:** 12.8.

### P1B-8 — migration reject bucket + reconciliation *(tooling)*
An explicit, recorded reject path — never a silent drop — for: the **4 legacy ledger rows** with no
location (also invisible to the governed reader per NB-8, which must not be the migration's source),
and the **2 INSTALLED serialized units** with no valid target location type. **Evidence:** 12.7,
12.10, NB-8.

### P1B-9 — `inventory_sync_status` target *(schema design)*
Give the work-order idempotency guard a home, or prove replay is impossible without it. 16 live docs,
5 carrying recorded failures. **Evidence:** NB-7.

### Explicitly EXCLUDED as unnecessary — proven, not assumed
- **A warehouse/bin historical-id reconciliation table or migration map.** Part I MB-15 anticipated
  one; live data shows **zero bin-shaped ids and zero BIN location types anywhere** (12.6). Building
  it would be speculative.
- **A warehouse-predicate consolidation gate.** The two predicates admit identical sets (12.5);
  worth cleaning up, not a cutover blocker.
- **A namespace-partitioning scheme for WAREHOUSE vs MOBILE ids.** R3's typed pair already solves
  it; the live intersection is ∅ (12.7).
- **Any `partsCatalog` de-authorization work in the inventory boundary.** Zero live leakage (12.3).
- **A second operating-company model.** Forbidden by R5; the canonical one is unambiguous (12.9).

---

## 17. What Part II does not do

No runtime implementation, no SQL migration, no authority cutover, no Firebase write, no PostgreSQL
write, no capability-grant change, no deployment. P1A remains an independent lane and was not
touched. Live access was read-only against `eos-platform-sandbox` only; production was never
contacted. Two documentation files change: this census and the corrected Parts row in the cutover
design (mandated by R1).
