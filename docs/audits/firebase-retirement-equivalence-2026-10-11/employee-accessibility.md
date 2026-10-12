# Employee Accessibility Verification: Retired Firebase Operations

Audited 2026-10-11 at main `acc65f2e`. Gate B asks: can an authorized employee reach and use the
capability through an EOS screen or a supported integration?

**Method and limit.**
- Each operation was traced from the screen to the EOS operation it calls, through the navigation gate
  and the capability, to the Roles and canonical personas that hold that capability. Sources:
  - PostgreSQL grants (`functions/migrations`, `functions/src/adminPolicy/seed/roleCapabilityAuthorityBaseline.json`);
  - the activation deltas;
  - the 2026-10-04 nonprod census (`docs/architecture/admin-role-capability-census-2026-10-04.json`).
- **No live run was performed.** No live persona run is recorded for any of these operations, so every
  "reachable" below is **static (on paper)**. Under the gate that is `PARTIAL` at best.
- Live grants were not re-measured. The census is from 2026-10-04 and some deltas are from 2026-10-01.
- Most of these screens are enabled only in **platform-sandbox**. `PART_MASTER_WRITE_READY`,
  `PART_IDENTIFIER_TRANSPORT_READY` and `EOS_NAVIGATION_AUTHORITY_READY` are false for production,
  certification, integration and local (`config/environments.json`). Production never had these paths.

**Retail Sales and National Accounts Sales.** Both are kept distinct. Neither holds any of the write
capabilities below (`personaBusinessNeeds.v1.json`), so neither is an intended user, by design.
- Both hold `inventory.catalog.read`, so they can look up a Part by its part code.
- They do not hold `inventory.catalog.alias.read`, so the alias half of a scan answers `aliasDenied`.
- They have no Purchasing, Catalog Admin or Field Mode surface.

## Inventory and warehouse

| Operation | Screen and navigation | Gate | Holders (static) | Status |
|---|---|---|---|---|
| `recordPutAway` | Scan → Put Away (`PutAwayScan.jsx`, through relocation) and Pick and stage (`PickScan.jsx`, through `/operations/placement`). Scan nav `/service/scan` (`navConfig.js:785`); offered when the user holds `inventory.placement.record` + `inventory.location.bin.read` (`scanWorkflows.js:223-237`). | `inventory.placement.record` + WAREHOUSE_OPERATIONS eligibility + warehouse scope | Warehouse Associate (`inventoryPutAwayOperator`), admin | Reachable for the Warehouse Associate. **The Parts Associate is refused** (PA-1, Owner question). |

## Purchasing

| Operation | Screen and navigation | Gate | Holders (static) | Status |
|---|---|---|---|---|
| `createSupplier` | Purchasing → Suppliers → Supplier administration (`SupplierAdministration.jsx`; `navConfig.js:518, 813`) | `inventory.catalog.manage`; surface `supplier.record.read` | Admin (by standing, #223), Parts Manager / Purchasing Manager | Reachable. The form cannot capture phone, address, payment terms or notes. Owner, GM, Service Manager and Warehouse Manager hold manage but **have no Suppliers surface**. |
| `updateSupplier` | **none** (`updateSupplierFields` is imported by nothing) | `inventory.catalog.manage` | n/a | **GAP** |
| `activateSupplier` / `deactivateSupplier` | Supplier administration → Reactivate / Deactivate | `inventory.catalog.activate` | **Admin only** | Admin-only in practice; the reason is hard-coded. |
| Part-supplier terms (4 ops) | **none** | none: no governed operation exists | n/a | **GAP** (SUP-1) |

## Service

| Operation | Screen and navigation | Gate | Holders (static) | Status |
|---|---|---|---|---|
| `recordWorkOrderLabor` | Technician workspace → Field Mode → job → Labor → Add time (`JobLabor.jsx`; nav `field.myWorkOrders`, `navConfig.js:294, 782`) | `workOrder.execution.record`, own assignment | service-technician-a, service-technician-b, contract-technician, **once the activation delta grants execution.record** (`serviceActivationAuthorityDelta.ts:65-68`); no in-repo record shows it applied | Reachable on paper. DURATION only, for today only; no backdating. |
| `correctWorkOrderLabor` | **none** | `workOrder.labor.correctEntry` | Service Manager (fieldManager, ruling D) | **GAP**: the holder has no screen. |
| `getWorkOrderLabor` | Field Mode → Labor (totals only) | `workOrder.record.read` (RECORD_ASSIGNMENT for technicians) | Technicians for their own jobs; every record.read holder by API | Technicians see totals, never entries. **No office or manager screen** shows labor. |

## Catalog

| Operation | Screen and navigation | Gate | Holders (static) | Status |
|---|---|---|---|---|
| `createPart` / `updatePart` | Inventory → Catalog Admin (`/inventory/part-master`, surface `inventory.catalogAdmin`); Parts list "New Part"; Part Detail "Edit part" | `inventory.catalog.manage` | Owner, Admin, GM, Service Manager, Parts Manager, Warehouse Manager | Reachable. **Every success is shown as an error** (CAT-1). The buttons are not hidden from non-holders; the server refuses, with a generic message. |
| `changePartStatus` | Part Detail "Change status" | `inventory.catalog.activate` | **Admin only** | **GAP** (CAT-3): no business persona can activate a Part. |
| `createPartAlias` | Part Detail → Barcodes & Identifiers → Add (Inventory domain) | `inventory.catalog.manage` | as `createPart` | Reachable. Conflict and replay outcomes are shown generically. |
| `listPartAliases` / `deactivatePartAlias` / `reactivatePartAlias` | Part Detail → Barcodes & Identifiers | manage (+ read for list) | as `createPart` | **GAP** (CAT-2): the list always renders empty, so the deactivate/reactivate rows never appear. |
| `probePartAlias` | Barcodes & Identifiers → "Test This Scan" | manage + read | as `createPart`, minus operationsManager | Reachable. |
| `lookupScannedPart` / (`resolveScannedPartIdentifier`) | Scan → Look Up / Move stock / Cycle Count (`LookupScan.jsx`, `MoveStockScan.jsx`, `CycleCountScan.jsx`) | `inventory.catalog.read` (+ `alias.read` for barcodes) | Parts Associate, Parts Manager, Warehouse Associate, Warehouse Manager, service technicians (`inventoryLookupReader`, `truckInventoryActivationDelta.ts:45-69`) | Reachable on paper. Vendor barcodes do not resolve inside put-away, pick or transfer verification, which never had alias resolution (no regression). |

## What would make Gate B VERIFIED

For each operation, both of the following:

1. **A screen-level test (`ui-test`)** that drives the employee's screen against the **real EOS result
   shape**. The current UI tests mock the retired callable shapes, which is how CAT-1 and CAT-2 went
   unnoticed.
2. **A recorded live run (`uat`)** by the canonical persona against the deployed nonprod environment,
   using the EOS persona session harness (`scripts/eosPersonaSession.mjs`). Write paths mutate nonprod
   data, so this is an operator action that needs authorization.
