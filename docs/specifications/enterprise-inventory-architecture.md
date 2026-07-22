---
artifact_type: specification
gate: Sprint Specification
status: Approved — Owner decisions D-1–D-6 (2026-07-21), recorded in DECISIONS.md #37; adopted on merge
date: 2026-07-21
owner: Claude Code (Inventory)
related_adrs:
  - docs/architecture/ADR-002-work-order-engine.md
  - docs/architecture/ADR-003-inventory-trigger-system.md
  - docs/architecture/ADR-006-equipment-and-installed-asset-management.md
  - docs/architecture/ADR-007-governed-object-based-report-creator.md
depends_on:
  - docs/assessments/enterprise-inventory-architecture.md
implements: Owner authorization "Begin INV-1 Governance and Architecture" (2026-07-21)
supersedes: none
superseded_by: none
related_pr: "#371"
target_release: none — governance artifact only
---

# Enterprise Inventory Specification — Enterprise Operations OS

**Derived from:** `docs/assessments/enterprise-inventory-architecture.md`. Companion AI document: `docs/specifications/enterprise-inventory-ai-strategy.md`.

**This Specification authorizes NO implementation.** It defines the target architecture; every implementation step requires its own gated row in the Implementation Plan and, where applicable, its own Owner authorization. Taylor Parts is the **reference implementation only** — every capability below is specified company-neutral for Enterprise Operations OS.

Verified against `origin/main` @ `8ebf140`.

---

## 1. Executive summary

Inventory becomes a single governed capability family built on one append-only **Inventory Ledger** (the existing `inventory_transactions` Platform Event stream, generalized additively), a first-class **Location** model (warehouse, bin, mobile/truck, vendor, customer), and a set of **Operational Workflow Objects** (Reorder Request — already live; Transfer Order, Receiving Order, Count Sheet, Return, Adjustment) that move stock only through **trusted-writer Cloud Functions**. Client-direct Firestore writes to stock-bearing collections are never introduced; the Rules-governed reorder lifecycle remains the historical exception, not the template. AI is a recommendation layer above the ledger — it never mutates stock.

## 2. Architectural invariants (non-negotiable)

1. **Single ledger of record.** `inventory_transactions` (generalized) is the only source of truth for stock movement. No mutable "current stock" field is ever authoritative; any cached aggregate is derived, trusted-writer-maintained, and rebuildable from the ledger.
2. **Append-only Platform Events.** Ledger entries are never updated or deleted. Corrections are new compensating entries.
3. **Trusted-writer mutation only.** Every stock mutation (receive, adjust, transfer, count, consume, return) goes through a Cloud Function following the #226/#325 pattern: server-derived actor, capability check via `resolveEffectivePermission()`, input validation, idempotency key as deterministic doc ID, business write + Audit Event staged in one transaction, sanitized error taxonomy. New stock lifecycles are **not** implemented as Rules-governed client writes (Rules complexity budget; Assessment §3.3).
4. **Document-pair atomicity.** Workflow-object state changes and their ledger effects commit together or not at all — eliminating by construction the post-commit effect-loss class that produced INV-1. Where a legacy post-commit path remains (Work Order effects), it gains detection + a retry driver (Phase 0) until migrated.
5. **Capability-based authorization.** Inventory operations are governed by an `inventory.*` capability namespace resolved through the Enterprise Access model (#226). Operational roles (Issue #100 matrix) map to capability grants; roles remain work eligibility, never direct security authority.
6. **Tenant-shaped, tenant-inert.** No tenant/company field is introduced before Issue #140. Every entity is keyed and every capability scoped so that a single tenant boundary can partition it later without remodeling (locations, catalogs, policies, ledgers are all per-tenant-partitionable by design).
7. **Configuration over code.** Lead times, safety factors, reorder policies, location types, units of measure, and count frequencies are configuration objects, not constants.
8. **AI recommends; humans decide.** No AI output mutates stock or auto-executes a purchase. See AI Strategy §2.
9. **Merge ≠ deploy ≠ verify.** Every activation follows the platform's separate Owner gates; "export is not deployment."

## 3. Domain model

### 3.1 Entities (Business Objects)

| Entity | Description | Today | Target |
|---|---|---|---|
| **Part (Item Master)** | Governed catalog record: sku, name, category, UoM, tracking mode (NONE / SERIAL / LOT), cost/price, per-location policies | Static in-code array | Governed collection, trusted-writer CRUD, its own ADR (Assessment OQ-C) |
| **Location** | Anything that holds stock: WAREHOUSE, BIN, MOBILE (truck), VENDOR (VMI/consignment), CUSTOMER (returns/installed), VIRTUAL (in-transit) | `warehouses` + `stock_locations`; trucks demo-only | Unified location tree; trucks become MOBILE locations |
| **Ledger Entry** | Append-only stock movement event | RESERVED / RELEASED / CONSUMED, location-blind | + RECEIVED, ADJUSTED, TRANSFER_OUT, TRANSFER_IN, COUNTED, RETURNED, SCRAPPED; carries `locationId` (and `lotId`/`serialNo` when tracked) |
| **Reservation** | Claim against future availability | Implicit in RESERVED entries keyed to Work Orders | First-class reservation object: source (WO, transfer, order), expiry policy, release discipline; availability = on-hand − active reservations |
| **Supplier / Supplier Catalog Item** | Vendor master + part-supplier terms (price, lead time, MOQ) | Dormant collections; live flow uses free-text names | Referenced by all procurement objects; lead times feed forecasting |
| **Serialized Asset** | Individual unit identity for SERIAL-tracked parts, linked to Equipment records where installed | Absent | Serial registry; ledger entries reference serials; ADR-006 equipment linkage |
| **Lot** | Batch identity for LOT-tracked parts: lot number, received date, expiration date | Absent | Lot registry; expiration drives FEFO picking and expiry alerts |

### 3.2 Operational Workflow Objects (lifecycle-governed)

Each moves through capabilities; each mutation is a trusted-writer command with atomic ledger effects and Audit Events. Statuses are illustrative targets; exact machines are per-phase specification work.

| Object | Lifecycle (target) | Ledger effect |
|---|---|---|
| **Reorder Request** (live) | Existing 9-status machine (six forward statuses + three terminals), unchanged | none directly (hands off to PO/Receiving) |
| **Purchase Order** (unified) | DRAFT → APPROVED → SENT → PARTIALLY_RECEIVED → RECEIVED / CANCELLED | none until receiving |
| **Receiving Order** | EXPECTED → CHECKED_IN → PUTAWAY_COMPLETE | RECEIVED per line, at putaway location |
| **Transfer Order** | REQUESTED → PICKED → IN_TRANSIT → COMPLETED / CANCELLED | TRANSFER_OUT at source, TRANSFER_IN at destination (in-transit VIRTUAL location between) |
| **Count Sheet** (cycle count) | SCHEDULED → IN_PROGRESS → SUBMITTED → APPROVED / REJECTED | COUNTED (variance) entries on approval only |
| **Adjustment** | DRAFT → SUBMITTED → APPROVED / REJECTED | ADJUSTED on approval; replaces the never-applied `inventory_actions` log with an applied, approval-gated flow (the log's append-only audit character is preserved) |
| **Return (RMA)** | REQUESTED → AUTHORIZED → RECEIVED → DISPOSITIONED (restock / scrap / return-to-vendor) | RETURNED / SCRAPPED / TRANSFER_OUT per disposition |

## 4. Capability specifications

### 4.1 Inventory Ledger
Generalize `inventory_transactions` **additively**: existing RESERVED/RELEASED/CONSUMED entries remain valid forever; new entry types and a `locationId` dimension are added; legacy location-blind entries are interpreted against a designated default location. Materialized per-part-per-location aggregates (`on_hand`, `reserved`) are maintained by the trusted writer in the same transaction as each ledger append, and are rebuildable by full replay (a `rebuildAggregates` admin command validates drift). Client reads move from full-collection scans to aggregate reads + paginated, indexed ledger queries.

### 4.2 Inventory Reservations
Reservations become explicit objects with source references and lifecycle (ACTIVE → RELEASED / CONSUMED / EXPIRED). Work Order reservations migrate onto this model; transfer picks and allocated sales reserve through the same mechanism. Availability formula everywhere: `available = on_hand − Σ active reservations`. Expiry policy is configuration (invariant 7).

### 4.3 Warehouse Operations
Activate the dormant physical layer through trusted-writer commands (create/update warehouse, bin management, putaway, pick). `updateStockLocation`'s non-idempotent delta write is retired in favor of idempotency-keyed ledger commands. Bin-level addressing replaces the `"TRANSFER"` pseudo-bin. Reconciliation (ledger vs bins) becomes location-aware and gains a repair path: discrepancies convert to draft Adjustments, never silent fixes.

### 4.4 Receiving
One receiving flow for all inbound stock: against a PO (three-way match: PO line, received qty, putaway), against a reorder request (closing the current `receiveReorderRequest` status-only gap), or blind receipt (adjustment-class approval). Receiving is the single point where lots/serials/expiration are captured for tracked parts.

### 4.5 Transfers
Transfer Orders cover warehouse↔warehouse, warehouse↔truck, truck↔truck. Two-sided ledger effects with an in-transit VIRTUAL location so stock is never invisible mid-move. Truck restocking is a transfer, not a special case.

### 4.6 Truck Inventory
Trucks are MOBILE locations owned by an assigned technician. Truck stock is real ledger stock; FieldMode consumption writes CONSUMED at the truck location via the Work Order effect path. The demo layer (`InventoryContext`) is retired only after parity (last phase). Recommended truck stock profiles come from AI Strategy §3.2.

### 4.7 Cycle Counting
Count Sheets generated by policy (ABC class, velocity, exception-triggered), executed on mobile (barcode-assisted), variance-approved by a manager capability. Approval writes COUNTED variance entries. Count accuracy metrics feed the analytics layer.

### 4.8 Inventory Adjustments
All quantity corrections flow through the Adjustment object with approval gates and reason codes (config). The existing `inventory_actions` collection is preserved as historical audit; new adjustments are applied, not merely logged.

### 4.9 Serialized Assets
Parts with tracking mode SERIAL require serial capture at receive/transfer/consume. Serial registry links to Equipment (ADR-006) on installation — the inventory→installed-asset handoff becomes traceable end to end.

### 4.10 Lots
Parts with tracking mode LOT require lot capture at receiving. Ledger entries carry `lotId`; picking guidance is FEFO where expiration applies.

### 4.11 Expiration
Expiration dates live on lots. Expiry horizon alerts, expired-stock quarantine (a location state), and disposal via Adjustment with reason EXPIRED.

### 4.12 Returns
RMA workflow object (§3.2) covering customer returns, vendor returns, and field returns from trucks. Disposition drives ledger effects; credit/financial linkage is out of scope until the Financials domain exists (ProductVision).

### 4.13 Vendor Managed Inventory
VENDOR-type locations hold consignment stock (visible, not owned — ownership is an entry attribute); supplier-visibility feeds are a Platform Integration service concern. VMI replenishment reuses the Replenishment engine with vendor-owned policy. Later-phase; no schema now.

### 4.14 Inventory Forecasting
Server-side forecasting service (authoritative home already exists: `inventoryAnalyticsService.ts`) upgraded from `EPIC3_LINEAR_V1` per AI Strategy §3.7: per-part demand curves, seasonality, supplier-specific lead times from the supplier catalog, service-level-driven safety stock. Client mirrors read forecast outputs; they never recompute authority.

### 4.15 Demand Planning
Planning layer above forecasting: aggregate demand by location/period, planned Work Order demand (qtyPlanned pipeline), seasonal events, growth assumptions as planner inputs. Output: time-phased projected inventory position per part per location, feeding Replenishment.

### 4.16 Replenishment
Policy-driven engine (min/max, reorder-point, periodic review — per part per location, as configuration) generating recommendations into the **existing live Reorder Request lifecycle** — the governed human chain (review → assign → purchase) is retained as the execution path. Truck replenishment generates Transfer recommendations instead of purchase recommendations.

### 4.17 Procurement Integration
One PO model (Assessment OQ-B): the live reorder-PO chain evolves into the unified Purchase Order object; the dormant Epic 5 `purchase_orders` surface is deprecated (D-3). Supplier becomes a reference, not free text; supplier catalog supplies price/lead-time/MOQ at PO creation; receiving closes the loop into the ledger (§4.4). External ERP/accounting connectors are Platform Integration concerns, out of inventory scope.

### 4.18 Barcode / RFID
Barcode/QR is a shared platform capability (MobileStrategy): part labels, bin labels, truck labels, PO/receiving documents. Scanning accelerates receiving, transfers, counts, and FieldMode consumption. Symbology/label format is configuration. RFID is a future intake channel behind the same scan-event abstraction; no RFID commitment now.

### 4.19 Multi-location support
The Location tree (§3.1) plus the ledger `locationId` dimension make every capability location-aware. Per-location read scoping extends the existing `isAssignedToWarehouse()` pattern into location-scope capability conditions under #226. Reconciliation, analytics, forecasting, and replenishment all operate per location.

### 4.20 Future tenant isolation
Deferred to Issue #140 in full (invariant 6). This specification's contribution: every collection introduced by this architecture must be enumerable in a future tenant-partitioning migration; every capability check flows through `resolveEffectivePermission()` where the inert `tenant` ScopeType already exists; no cross-entity references bypass IDs (no denormalized identity that a tenant split would break). A conformance checklist is part of each implementation phase's review.

## 5. Authorization model

New capability namespace (catalog ownership follows the #226 permission-catalog process; names illustrative, final catalog is a Phase 1 deliverable):
`inventory.ledger.read`, `inventory.stock.receive`, `inventory.stock.adjust.request`, `inventory.stock.adjust.approve`, `inventory.transfer.request`, `inventory.transfer.execute`, `inventory.count.execute`, `inventory.count.approve`, `inventory.catalog.manage`, `inventory.location.manage`, `procurement.po.create`, `procurement.po.approve`, `procurement.receive`, plus read-scoped variants. Issue #100's operational-role matrix maps onto these grants with existing effects unchanged (PARTS_MANAGER ≈ queue + assign; PARTS_ASSOCIATE ≈ own-assignment purchasing execution; WAREHOUSE_MANAGER ≈ warehouse-scoped visibility). Count-execute and adjust-request for WAREHOUSE_MANAGER are **new proposed grants** — the Owner-adopted matrix never granted them, and adopting them is part of the Phase 2/5 capability-catalog decision, not a restatement of #100. Legacy admin/dispatcher behavior is preserved during migration per the platform's compatibility-mapping discipline.

## 6. Firestore Rules impact (target posture — no change authorized now)

All stock-bearing collections introduced by this architecture are **closed to client writes** (`allow write: if false`), reads scoped per role/location. The reorder-request Rules lifecycle remains as-is. Net long-term effect: Rules complexity for inventory *decreases* as new logic lives in trusted writers. Every Rules change remains Tier 2 under the DelegationCharter.

## 7. Testing strategy (target)

Per platform convention: pure-logic engines with unit tests; rules regression suites with pinned expected counts added to `rulesRegressionRunner.mjs`; emulator lifecycle discipline; trusted-writer tests with injectable seams including mid-transaction failure simulation (atomicity proof, per `savedDefinitionCommands` precedent); ledger property tests (replay determinism: aggregates rebuilt from ledger must equal maintained aggregates); idempotency tests (same key twice → one effect).

## 8. Rollback strategy

Docs-only at this gate: reverting this PR removes the architecture. Implementation phases each define per-row rollback in the Implementation Plan; ledger additivity (invariant on §4.1) guarantees new entry types can be ignored by old readers.

## 9. Explicitly out of scope

Financials/accounting integration; sales/CRM; pricing strategy (Tier 3); tenant schema (#140); Work Order lifecycle changes; any deployment; any change to currently-live behavior.

## 10. Acceptance criteria for this specification

1. Every capability named in the Owner authorization has a section (§4.1–§4.20 + AI Strategy).
2. Every invariant is consistent with ADR-002/003/006/007, the #226 access model, and the DelegationCharter tiers.
3. No statement authorizes implementation, deployment, or Rules change.
4. Taylor-specific facts appear only as reference-implementation evidence, never as platform constraints.

## 11. Open questions

Carried in the Assessment (§9 OQ-A–OQ-D) and Implementation Plan (§7 decision recommendations). One additional: OQ-E — whether Reservations (§4.2) warrant their own ADR given they touch the deployed Work Order effect path.
