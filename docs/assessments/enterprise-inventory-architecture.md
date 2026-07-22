---
artifact_type: assessment
gate: Repository Assessment
status: Approved — Owner decisions D-1–D-6 (2026-07-21), recorded in DECISIONS.md #37; adopted on merge
date: 2026-07-21
owner: Claude Code (Inventory)
related_adrs:
  - docs/architecture/ADR-002-work-order-engine.md
  - docs/architecture/ADR-003-inventory-trigger-system.md
  - docs/architecture/ADR-006-equipment-and-installed-asset-management.md
  - docs/architecture/ADR-007-governed-object-based-report-creator.md
depends_on:
  - docs/roadmaps/roadmap-reconciliation-2026-07.md
  - docs/architecture/SYSTEM_AUTHORITIES.md
implements: Owner authorization "Begin INV-1 Governance and Architecture" (2026-07-21)
supersedes: none
superseded_by: none
related_pr: "#371"
target_release: none — governance artifact only
---

# Assessment Report: Enterprise Inventory Architecture

**Business Request:** Produce the complete enterprise inventory architecture for Enterprise Operations OS, with Taylor Parts as the reference implementation only, supporting future SaaS deployment across multiple industries. This Assessment is the first artifact of the governance chain (Assessment → Specification → Implementation Plan) and, together with its companions, constitutes the governance home the roadmap reconciliation demanded for finding **INV-1** (candidate gate B; OQ-4).

**This Assessment authorizes NO implementation.** No production code, no Firestore changes, no Functions, no UI, no deployment.

Verified against `origin/main` @ `8ebf140`.

---

## 1. Scope of this assessment

Reviewed domains: current inventory implementation, warehouse, truck inventory, procurement, purchasing, reorder engine, inventory analytics, transfer orders, receiving, supplier catalog. Reviewed dimensions: missing capabilities, technical debt, scalability risks, SaaS considerations, AI opportunities.

Out of scope: any change to code, Rules, Functions, indexes, deployed surface, or navigation. The Work Order lifecycle itself (Issue #15) is reviewed only where it touches inventory effects.

## 2. Current repository state — the three inventory layers

The inventory domain today is **three coexisting layers with different write authorities**:

| Layer | Collections / state | Write authority | Status |
|---|---|---|---|
| **Ledger + physical** (Epics 2D/3/4/5, ADR-002/003) | `inventory_transactions`, `inventory_sync_status`, `warehouses`, `stock_locations`, `transfer_orders`, `suppliers`, `supplier_catalog`, `purchase_orders` | Admin SDK / Cloud Functions only (client writes `if false`) | Ledger live via deployed Work Order Functions; warehouse/procurement service code exists but is **not exported/deployed** — display-only in production |
| **Reorder workflow** (Sprints 2.1.3–2.1.11, Issue #100) | `reorder_requests`, `inventory_actions`, `reorder_purchase_orders`, `reorder_purchase_order_voids` | Client-direct-write under per-collection Rules (`reorder_requests`: the eight-branch governed lifecycle; the other three: create-only gates with cross-document invariants) | Live and deployed; the platform's most mature governed workflow object outside Work Order |
| **Legacy demo** (Sprint 3.6) | In-memory React state (`src/demo/InventoryContext.jsx`, `src/demo/inventoryData.js`) | None (resets on reload) | Still mounted app-wide; sole implementation of truck inventory |

The parts catalog is a **static in-code array** (`field-ops-app-vite/src/data/partsCatalog.ts`, mirrored at `functions/src/data/partsCatalog.ts`): 200 synthetic rows, metadata only, no stock authority, no CRUD anywhere.

### 2.1 Inventory ledger (ADR-003)

- `inventory_transactions` is an append-only Platform Event ledger with exactly three entry types: RESERVED / RELEASED / CONSUMED, written only by `functions/src/inventoryService.ts`, driven by Work Order transitions. Availability is always computed by summation against the catalog's static `warehouseQty` baseline (`computeAvailableStockByPart`, `getAvailableQuantity`) — no mutable "current stock" document exists, by design.
- Effects run **strictly post-commit**: `transitionWorkOrder.ts` calls `triggerInventoryEffects()` only after its transaction commits; a failure is caught and recorded in `inventory_sync_status` with `retryNeeded`, and **no retry mechanism or detection surface exists**. This is finding **INV-1 (High)** — a Work Order can complete while its inventory effect is silently lost; reconciliation does not detect the missing-effect condition.
- Consumption records use `qtyPlanned`, not actual `qtyUsed` (`inventoryService.ts:156-163`); `updateWorkOrderExecutionData` can capture `qtyUsed` but nothing reconciles it into the ledger.
- Ledger entries carry **no warehouse/location dimension** — `warehouseReconciliationEngine.ts:6-9` documents that expected quantity is global while bin totals are per-warehouse ("a real simplification for multi-warehouse").

### 2.2 Warehouse operations

`warehouses`, `stock_locations` (doc id `warehouseId__partId__binCode`), `transfer_orders` exist with service code (`warehouseService.ts`: `updateStockLocation` — relative delta, explicitly not idempotent; `createTransferOrder`/`completeTransferOrder`) — but **none of it is exported as a deployed callable**. There is no production write path into the physical-stock collections other than console/Admin seeding. Client surface (`WarehousePanel.jsx`) is read-only, including a read-only discrepancy report with "no fix button." Transfers use a fixed pseudo-bin `"TRANSFER"` (no bin-level routing). WAREHOUSE_MANAGER read access is scoped per-warehouse via `isAssignedToWarehouse()` and Employee `assignedWarehouseIds`.

### 2.3 Truck inventory

Demo-only. `truckStock` is an in-memory `{partName: qty}` map with `transferPart()`/`consumePart()`; explicitly no Firestore writes; resets on reload. `FieldMode.jsx` "Use Part" operates against it. The "Truck Inventory" nav item renders a placeholder. Truck-parts sale-to-invoice is deferred as Issue #182 (assessment-only). No connection whatsoever between truck stock and the real ledger.

### 2.4 Procurement / purchasing — two unrelated PO systems

1. **Epic 5 `purchase_orders`** (dormant): DRAFT→APPROVED→SENT→RECEIVED/CANCELLED in `procurementService.ts`, not deployed; RECEIVED explicitly "not wired" to any stock increase; supplier selection logic (`findBestSupplierForPart`) and draft-proposal engine exist but are inert. Read-only panel in the client.
2. **Reorder `reorder_purchase_orders`** (live): client-direct-write, doc id = `reorderRequestId`, atomic two-sided `getAfter()` invariants with the reorder request, append-only void ledger. Supplier is captured as a **free-text `supplierName` string**, not a reference to `suppliers`.

The deliberate split is documented (`constants.js:269-287`), but it means the live purchasing flow bypasses the supplier catalog, and the supplier-aware flow is unreachable.

### 2.5 Reorder engine and analytics

- Model `EPIC3_LINEAR_V1` (`inventoryAnalyticsEngine.ts`, server-authoritative mirror): 30-day CONSUMED window → `avgDailyUsage`; reorder point = `avgDailyUsage × leadTimeDays(7) + avgDailyUsage × 1.5`. **Fixed global lead time; no per-part min/max; the catalog's `reorderThreshold` field is never used by the engine.** Zero-history parts route to `NEEDS_PLANNING` (governed manual quantity path).
- Reorder Request lifecycle: PENDING_REVIEW → READY_FOR_PARTS_MANAGER → ASSIGNED_TO_PARTS_ASSOCIATE → PURCHASING_IN_PROGRESS → ORDERED → RECEIVED (+ REJECTED/CANCELLED/VOIDED), enforced by the eight-branch Rules `allow update` with canonical 35-key creation shape, actor pinning, immutable base facts, and cross-document atomic invariants. This is the platform's canonical governed-lifecycle-in-Rules artifact.
- Analytics reads are a **one-shot, unfiltered full-collection read** of `inventory_transactions` on every mount (`useInventoryLedger.js`) — no pagination, no realtime, no aggregation; the whole dashboard recomputes client-side.

### 2.6 Receiving

Three disconnected fragments, none of which moves stock:
- `receiveReorderRequest()` — status closeout only; comments state it does not touch the ledger.
- `inventory_actions` — append-only human log (RECEIVE_STOCK / ADJUST_STOCK / CORRECT_MISTAKE) that is **never applied to any stock number**.
- Epic 5 PO `RECEIVED` — explicitly unwired.

No putaway, no PO-receiving flow, no receiving→ledger reconciliation anywhere.

### 2.7 Supplier catalog

`suppliers` (`name, contactEmail, leadTimeDays`) and `supplier_catalog` (`supplierId, partId, unitPrice, available`) exist, Admin-SDK-only, read-only to admin/dispatcher, with no operational write path and no consumer in the live purchasing flow.

### 2.8 Barcode / scanning

Nothing scanning-related exists in committed application code. Barcode/QR is named in `docs/MobileStrategy.md` as a planned shared platform capability; equipment scanning was explicitly deferred (ADR-006 docs).

### 2.9 Roles and access (Issue #100)

The Owner-adopted per-role capability matrix (PARTS_MANAGER / WAREHOUSE_MANAGER / PARTS_ASSOCIATE over technician security role, reciprocal `users↔employees` linkage, ACTIVE employment) is implemented in Rules and role-home surfaces. One merged Rules grant (employees candidate read, PRs #236/#237) is **not yet deployed** — Assign works only against the emulator pending its own Owner Deployment Authorization. Operational roles are work eligibility, never security authority. The governed Enterprise Access model (#226) with `resolveEffectivePermission()`, accessVersion, and compact claims is live for reporting reads; the six admin-mutation Functions remain undeployed (Rows 19–22 gates).

## 3. Gap analysis

### 3.1 Missing capabilities (no implementation exists at all)

| Capability | Current state |
|---|---|
| Stock mutation write path (receive/adjust/transfer/count) | None deployed — ledger only moves via Work Order effects |
| Cycle counting | Absent |
| Inventory adjustments applied to stock | `inventory_actions` log exists but is never applied |
| Receiving / putaway | Absent (three disconnected fragments, §2.6) |
| Real truck inventory | Demo-only in-memory state |
| Serialized assets | Absent (equipment records exist but carry no inventory linkage) |
| Lot tracking / expiration | Absent |
| Returns (customer/vendor/RMA) | Absent |
| Vendor Managed Inventory | Absent |
| Demand planning (beyond 30-day linear usage) | Absent |
| Barcode / RFID | Absent in committed code |
| Part catalog CRUD / governance | Absent — static synthetic array |
| Multi-location ledger dimension | Absent — ledger is location-blind |
| Effect-loss detection + retry driver | Absent — **INV-1 (High)** |

### 3.2 Technical debt

1. **INV-1 (High):** post-commit inventory-effect loss with no detection and no retry driver (ADR-003 design gap). Highest-priority integrity item in the domain.
2. **Two parallel PO systems** — live flow uses free-text supplier names; supplier-aware flow is dormant.
3. **qtyPlanned vs qtyUsed** — consumption never reconciled to actuals despite a deployed capture callable.
4. **Location-blind ledger** — reconciliation compares global expected vs per-warehouse actual.
5. **Static duplicated catalog** — synthetic data byte-mirrored client/server under the "if either file changes, change the other to match" discipline (the analytics mirror separately carries a "server wins on drift" caveat); `reorderThreshold` and `warehouseQty` are frozen fictions.
6. **Unbounded client reads** — full-ledger fetch per mount; recompute-everything analytics.
7. **Demo layer still mounted app-wide** — `InventoryProvider` wraps the whole app; FieldMode depends on it.
8. **`updateStockLocation` is delta-based and not idempotent** — unsafe as-is under retries, acknowledged in code.
9. **No retry/repair surface for `inventory_sync_status.retryNeeded`** — bookkeeping exists, driver does not.
10. **Legacy reorder docs lack `requestedQty`** — display fallback logic carries the migration burden.

### 3.3 Scalability risks

- **Ledger summation without aggregation:** availability = full-scan summation. Grows linearly with history forever; already an unbounded client read. Needs materialized aggregates (trusted-writer-maintained) before any real volume.
- **Firestore Rules complexity budget:** the eight-branch reorder lifecycle already required restructuring to stay under the ~1000-subexpression evaluation budget. The Rules-governed-lifecycle pattern **does not scale** to many more inventory workflow objects; new lifecycles must move to trusted-writer Functions (the #226/#325 pattern).
- **Composite index and pagination discipline:** only the reorder History page paginates today; every new listing surface needs indexed, paginated queries from day one.
- **Client-side recompute of analytics** will not survive multi-warehouse × multi-tenant data volumes; forecasting must move server-side (the authoritative copy already lives in `functions/src/inventoryAnalyticsService.ts`).

### 3.4 SaaS considerations

- **Tenant boundary is Issue #140** (reserved authority) — `ScopeType` already includes an inert `tenant` scope, compact claims reserve `companyId`, and the #226 spec hard-prohibits silently introducing tenant/company schema. The inventory architecture must be **tenant-shaped but tenant-inert**: no tenant fields now; every entity/capability designed so a single tenant key can partition it later without remodeling.
- **Configuration over code:** lead times, safety factors, reorder policies, location types, and unit-of-measure sets are Taylor-specific constants today; each must become per-tenant configuration objects in the target model.
- **Catalog must become data, not code:** a static in-repo parts array cannot serve multiple industries; the catalog becomes a governed collection with industry-neutral shape.
- **Industry neutrality:** truck inventory generalizes to "mobile stock location"; HVAC-specific assumptions (single warehouse, technician trucks) must be location-type configuration, not schema.

### 3.5 AI opportunities

The domain generates exactly the data an AI layer needs (append-only consumption events, lifecycle timestamps, supplier lead times) and the platform has an established AI-governance posture (AI Decision Support platform service; the ADR-004 Technician Recommendation Engine precedent — deterministic, recommend-only, implemented and live in `technicianRecommendationEngine.ts`; "AI recommends, humans accountable"). Opportunity areas — parts prediction, truck loading, replenishment, warehouse optimization, purchasing, stock balancing, demand forecasting, supplier recommendations — are specified in the companion **AI Strategy** (`docs/specifications/enterprise-inventory-ai-strategy.md`).

## 4. Affected files (assessment evidence, not change list)

| Area | Files |
|---|---|
| Ledger | `functions/src/inventoryService.ts`, `functions/src/types/inventoryTransaction.ts`, `field-ops-app-vite/src/hooks/useInventoryLedger.js` |
| Analytics | `functions/src/inventoryAnalyticsService.ts`, `field-ops-app-vite/src/domain/inventoryAnalyticsEngine.ts` |
| Warehouse | `functions/src/warehouseService.ts`, `functions/src/warehouseReconciliationService.ts`, `field-ops-app-vite/src/modules/operations/panels/WarehousePanel.jsx` |
| Procurement | `functions/src/procurementService.ts`, `functions/src/supplierService.ts`, `functions/src/procurementBridge.ts`, `field-ops-app-vite/src/domain/procurementDraftEngine.ts`, `field-ops-app-vite/src/domain/reorderPurchaseOrders.js` |
| Reorder workflow | `field-ops-app-vite/src/domain/inventoryReorderRequests.js`, `field-ops-app-vite/src/domain/inventoryActions.js`, `firestore.rules` (483–1046) |
| Catalog | `field-ops-app-vite/src/data/partsCatalog.ts`, `functions/src/data/partsCatalog.ts` |
| Demo | `field-ops-app-vite/src/demo/InventoryContext.jsx`, `field-ops-app-vite/src/demo/inventoryData.js` |

## 5. Dependencies

- **Issue #140** (tenant/company model) — reserved authority for tenant isolation; this architecture defers to it.
- **Issue #226 Rows 19–22** — governed access mutations; inventory capability grants ride the same model.
- **Issue #100** — per-role inventory operational access (one Rules grant merged, not deployed).
- **Issue #15** — Work Order engine (deployed); INV-1 recovery instruments its effect path.
- **Issue #182** — truck-parts sale-to-invoice (deferred; assessment-only).
- Platform governance: DelegationCharter (firestore.rules changes are always Tier 2), append-only DECISIONS.md, merge ≠ deploy ≠ verify gates.

## 6. Risks

1. **Scope gravity:** this architecture spans ~20 capability areas; without hard phase gates it will pull implementation pressure everywhere at once. Mitigation: the Implementation Plan's bounded-row model with per-row Owner gates.
2. **Rules budget exhaustion** if new lifecycles copy the reorder-request pattern. Mitigation: spec mandates trusted-writer Functions for all new stock-mutating lifecycles.
3. **Tenant-schema leakage:** designing for SaaS risks violating the #140 prohibition. Mitigation: explicit "tenant-shaped, tenant-inert" invariant in the spec.
4. **Concurrent workstreams** share `field-ops-app-vite` and `firestore.rules`; every future implementation row must check open PRs first.
5. **Doc drift:** CLAUDE_CONTEXT.md still claims no Functions are deployed (contradicted by DECISIONS #36); this package cites DECISIONS.md as authoritative.

## 7. Implementation options considered

- **Option A — Incremental patching** (fix INV-1, wire receiving, keep three layers): fastest, but permanently entrenches the two-PO split, the location-blind ledger, and the static catalog. Rejected.
- **Option B — Big-bang re-platform** (replace ledger and workflows wholesale): violates every platform gate discipline; enormous risk. Rejected.
- **Option C — Ledger-centric evolution (recommended):** keep `inventory_transactions` as the single Platform Event ledger; generalize it (location dimension, new event types) additively; activate the dormant physical layer through trusted-writer Functions; unify procurement onto the live reorder chain; retire the demo layer last. The Specification defines this target.

## 8. Estimated PR count

Governance: 1 (this package). Implementation: ~35–45 bounded PRs across nine phases (0–8, Implementation Plan §3) — every one gated, none authorized by this package.

## 9. Open questions for Architecture Review

- OQ-A: Should INV-1 recovery (Phase 0) be authorized ahead of the rest of this architecture, given it is the only High-severity integrity finding? (Recommendation: yes — see Implementation Plan §7 D-2.)
- OQ-B: Is the Epic 5 `purchase_orders` collection formally deprecated in favor of a unified procurement model, or retained as the eventual home? (Recommendation: unify forward onto a single governed PO object; Implementation Plan §7 D-3.)
- OQ-C: Does catalog-as-data (part master governed collection) need its own ADR before Phase 1? (Recommendation: yes, ADR-level.)
- OQ-D: Priority of this architecture relative to F-RULES-1 and the #226 Row 19–22 production gates, which compete for Owner attention.
