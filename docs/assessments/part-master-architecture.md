---
artifact_type: assessment
gate: Repository Assessment
status: Approved — Owner decisions O-1…O-12 (2026-07-22), recorded in DECISIONS.md #40
date: 2026-07-22
owner: Claude Code (Inventory)
related_adrs:
  - docs/architecture/ADR-003-inventory-trigger-system.md
  - docs/architecture/ADR-006-equipment-and-installed-asset-management.md
  - docs/architecture/ADR-008-part-master.md
depends_on:
  - docs/specifications/enterprise-inventory-architecture.md
implements: Owner authorization "INV-1 Phase 1 — Part Master ADR & authorization review" (2026-07-22)
supersedes: none
superseded_by: none
related_pr: TBD (this PR)
target_release: none — governance artifact only
---

# Assessment Report: Part Master Architecture (current state)

**Business Request:** establish the canonical enterprise Part Master required by Decision #37 D-4 before any Phase 1 implementation. **This Assessment authorizes NO implementation.** Verified against `origin/main` @ `8147c1a`.

## 1. Current-source inventory matrix

Every present-day source of part identity/descriptive data. **No current collection is a canonical Part Master — none exists.** No `parts` collection appears in `firestore.rules`; no `partNumber`/`mpn`/`upc`/`gtin`/barcode field exists anywhere in code.

| # | Source | Identifier | Descriptive fields | Qty/cost fields | Writers | Readers | Class |
|---|---|---|---|---|---|---|---|
| 1 | `PARTS_CATALOG` — `field-ops-app-vite/src/data/partsCatalog.ts` + byte-mirror `functions/src/data/partsCatalog.ts` | `sku` (e.g. `TST-1001`) | name, category, unit (`ea`×158/`kit`×31/`bottle`×7/`tube`×4) | cost, price, reorderThreshold, warehouseQty (static baseline) | none (in-code, generated from `synthetic_parts_test_data.csv`, 200 rows — CSV not in repo) | every parts UI (PartsList, PartDetail, WarehousePanel, ProcurementPanel, role homes), `inventoryService.getAvailableQuantity`, analytics engines | **Authoritative-by-default for descriptive identity, but synthetic, static, duplicated ("if either file changes, change the other"); explicitly "METADATA ONLY — NO STOCK AUTHORITY"** |
| 2 | `inventory_transactions` ledger | `partId` = sku string | none | quantity (unit implicit) | `functions/src/inventoryService.ts` only | ledger hooks, analytics | Authoritative for stock movement (append-only; never rewritten) |
| 3 | `supplier_catalog` (dormant) | `supplierId` + `partId` (sku) | — | unitPrice, available | none deployed (Admin-SDK only, unwired) | ProcurementPanel (read-only) | Dormant; Epic 5 |
| 4 | `purchase_orders` (dormant) | line `partId` | — | quantity, unitPrice, totalCost | none deployed | ProcurementPanel | Dormant; deprecation direction recorded (D-3) |
| 5 | `reorder_requests` / `reorder_purchase_orders` / `_voids` / `inventory_actions` | `partId` (sku) | — (`supplierName` **free-text**, `externalPoNumber` free-text on POs) | requestedQty/orderedQuantity/quantityDelta | client-direct (governed Rules) | reorder UIs, role homes | Live workflow objects referencing sku |
| 6 | Work Order `inventorySnapshot` | `sku` | name, category, notes (denormalized copies) | qtyPlanned, qtyUsed | client at WO creation; `updateWorkOrderExecutionData` (qtyUsed) | WO UIs, `inventoryService` (reads qtyPlanned) | Historical denormalized context — must be preserved as-written |
| 7 | `stock_locations` (dormant) | doc ID `warehouseId__partId__binCode` | — | quantity | none deployed | WarehousePanel | Dormant; Epic 4 |
| 8 | Demo layer (`demo/inventoryData.js`, `InventoryContext.jsx`) | `id` **== name** (3 parts) | name, unit | in-memory quantities | React state | Inventory.jsx (unrouted), FieldMode | Demo-only; truck stock lives ONLY here |
| 9 | Equipment (`equipment` collection, ADR-006) | equipment doc ID; manufacturer/model/serialNumber/assetTag | — | — | admin/dispatcher client-direct | equipment UIs | **Not a part source** — ADR-006 hard boundary: "separate collections, domains, and UIs"; zero part linkage today |

**CSV:** the only CSV code in the repo is the Contact importer (`domain/contactCsvImport.js` — pure RFC-4180-style parser, header auto-suggestion, column mapping, per-row validation, duplicate detection; tested). **No parts CSV import/export exists.** This is the house pattern for §16 of the specification.

**Indexes:** `firestore.indexes.json` has 5 composite indexes; only `reorder_requests (status, createdAt)` is inventory-related. No part-alias or supplier-item indexes exist.

## 2. Known inconsistencies and duplication

1. Descriptive identity is a synthetic in-code array duplicated in two files with a manual-sync rule; production `fieldops_wos` is currently **empty** (Gate 0.4(a) evidence) and the catalog has never described real parts.
2. `sku` doubles as the ledger's `partId`, the workflow objects' `partId`, and the human-visible number — one string is simultaneously the immutable reference and the mutable business label.
3. Supplier identity is free-text (`supplierName`) in the live PO flow while a dormant normalized `suppliers`/`supplier_catalog` pair exists — two unreconciled supplier models (Assessment `enterprise-inventory-architecture` §2.4; D-3 direction already recorded).
4. Units exist on the catalog but nowhere on ledger entries or workflow quantities — every quantity's unit is implicit.
5. The demo layer's part identity (`id == name`) is disconnected from everything.
6. No manufacturer concept exists for parts at all (only Equipment carries `manufacturer`).

## 3. Timing observation

The only production evidence available (Gate 0.4(a), disposition A) shows **zero Work Orders in the audited `fieldops_wos` collection**; that audit did not inspect other collections, so this assessment does not claim broader production-data absence. What IS established from the schema itself: **no canonical Part Master collection exists anywhere** (no `parts` collection appears in `firestore.rules` or code), and descriptive part identity in the repository is synthetic. This still makes now the cheapest moment to introduce the Part Master: there is no Part Master data anywhere to migrate — "migration" reduces to schema adoption, reference-compatibility for the sku-shaped IDs already embedded in code/tests, profiling of any part-adjacent production collections at migration time (plan §4 step 1), and a seed path for real data.

## 4. Risks

1. **Identity freeze-in:** letting `sku` remain the only identity forever repeats the current defect at production scale. 2. **Unbounded embedded arrays** if aliases/suppliers are embedded in the Part doc. 3. **History rewrite temptation:** ledger/WO snapshots must never be rewritten to new IDs — compatibility must come from ID adoption + aliases. 4. **Rules complexity budget** if Part CRUD were client-direct — trusted-writer is mandated by the adopted spec (invariant 3). 5. **Equipment boundary erosion** — serialized parts must not blur into ADR-006 Equipment.

## 5. Open questions → carried to the Owner decision list (Implementation Plan §6, O-1…O-12).
