---
artifact_type: specification
gate: Sprint Specification
status: Approved — Owner decisions O-1…O-12 (2026-07-22), recorded in DECISIONS.md #40
date: 2026-07-22
owner: Claude Code (Inventory)
related_adrs:
  - docs/architecture/ADR-003-inventory-trigger-system.md
  - docs/architecture/ADR-006-equipment-and-installed-asset-management.md
  - docs/architecture/ADR-008-part-master.md
depends_on:
  - docs/assessments/part-master-architecture.md
  - docs/specifications/enterprise-inventory-architecture.md
implements: Owner authorization "INV-1 Phase 1 — Part Master ADR & authorization review" (2026-07-22)
supersedes: none
superseded_by: none
related_pr: TBD (this PR)
target_release: none — governance artifact only
---

# Part Master Specification — Enterprise Operations OS

**This Specification authorizes NO implementation.** Company-neutral; Taylor Parts is the reference implementation. Verified against `origin/main` @ `8147c1a`. Design decisions herein are **approved per Owner decisions O-1…O-12** (2026-07-22; dispositions in Implementation Plan §6, adopted as DECISIONS.md #40).

## 1. Canonical identity (recommendation for O-1: Option D, hybrid)

- **`partId`** — immutable internal identity = the Firestore document ID of `parts/{partId}`. Opaque going forward; **grandfathering rule:** parts migrated from existing references adopt their current sku string (e.g. `TST-1001`) as `partId`, because that string is already embedded in the append-only ledger, workflow objects, and WO snapshots, and history is never rewritten. New parts get generated opaque IDs.
- **`internalPartNumber`** — human-readable business number, mutable under governance, unique among active parts, initially equal to the legacy sku for migrated parts.
- All external identifiers (manufacturer PN, supplier SKU, UPC/EAN/GTIN, legacy numbers) are **aliases** (§2), never the database identity. Principle honored: external/human-readable identifiers are never the only immutable identity.
- Rejected: A (bare doc ID with no business number — unusable for humans/import), B (partId field ≠ doc ID — two identities to keep consistent for no benefit), C (business number as canonical ID — breaks on renumbering, mergers, supplier/manufacturer changes; the current sku-as-everything defect at scale).

## 2. Identifier model (recommendation for O-3: separate indexed alias collection)

`part_aliases/{aliasId}` — one document per identifier, **doc ID = `<type>__<normalizedValue>`**, which makes uniqueness structural (a second claim on the same normalized value is a create-collision, not a query race) and is tenant-ready (a future tenant key prefixes the ID under #140 — no remodel).

- Fields: `partId` (ref), `type` (enum: `INTERNAL_PN` | `MANUFACTURER_PN` | `SUPPLIER_SKU` | `UPC` | `EAN` | `GTIN` | `LEGACY` | `CUSTOMER_REF` | `VENDOR_REF` | `BARCODE_OTHER`), `rawValue`, `normalizedValue`, `status` (`ACTIVE`|`INACTIVE`), `source`, `effectiveFrom`/`effectiveTo` (optional), `notes`, audit stamps.
- **Normalization** (pure domain function, single authority): trim; uppercase; collapse internal whitespace; strip punctuation for numeric symbologies (UPC/EAN/GTIN digits-only with check-digit validation); preserve punctuation for MPN/SKU types except whitespace collapse. Same function used at write and at lookup.
- **Uniqueness scope:** normalized value unique per `type` across the deployment (tenant-scoped later). `MANUFACTURER_PN` uniqueness is per manufacturer — encoded in the normalized composite (`<manufacturerId>|<value>`).
- **Conflict handling:** a claimed alias returns an explicit conflict (existing owner surfaced), never silent reassignment; moving an alias between parts is a governed two-step (deactivate + recreate) with audit.
- **Lookup:** exact-match get by doc ID (fast, offline-cacheable); resolution order in §9.
- All alias mutations are trusted-writer with audit events.

## 3. Manufacturer and supplier model (recommendation for O-5: normalized top-level collections)

- **`manufacturers/{manufacturerId}`** — name, status. Distinct from suppliers/distributors; a party may be both (separate records referencing a future common party model — out of scope).
- **Part→manufacturer:** `manufacturerId` + `manufacturerPartNumber` on the Part (single primary), plus optional additional MPN aliases; brand/productFamily optional descriptive fields; `oemStatus` (`OEM`|`AFTERMARKET`|`UNKNOWN`); manufacturer discontinuation is a part-lifecycle input (§5 supersession), not a delete.
- **`part_supplier_items/{itemId}`** (doc ID `<partId>__<supplierId>`; multi-item-per-supplier variant uses a suffix) — the normalized supplier-catalog entry: `partId`, `supplierId` (ref to `suppliers`), `supplierSku`, `cost`, `currency`, `leadTimeDays`, `minOrderQty`, `orderMultiple`, `purchaseUnit` + `conversionToStockingUnit`, `contractStart/End`, `availability`, `preferred` (boolean; at most one preferred per part, enforced by the trusted writer), `lastVerifiedAt`, `status`.
- **Invariants:** one Part supports many supplier items without duplication; changing suppliers never changes `partId`; supplier pricing/terms live here (procurement authority), never on the Part's descriptive core. The dormant Epic 5 `supplier_catalog` is superseded by this model (consistent with D-3's unified direction; no deletion/migration now).

## 4. Data model (recommendation for O-2: Option C — normalized top-level collections)

`parts/{partId}` + `part_aliases` + `part_supplier_items` + `part_relationships` (+ existing `suppliers`, new `manufacturers`). Assessed against the gate's criteria: bounded document size (no unbounded arrays — rejected Option A); direct indexed lookups for barcode/import (rejected B's child collections, which can't be queried across parts without collection-group indexes and complicate per-doc Rules); Rules stay trivial (everything client-write-closed, trusted-writer only); CSV import maps rows to alias/supplier-item upserts; tenant-ready doc-ID scheme; audit via the standard envelope; migration is additive. Option D (partial embedding of a bounded primary-alias set) is the fallback if lookup fan-out proves costly — revisit at PR 1.3 with measurements, not now.

### `parts/{partId}` (conceptual schema)

Required: `internalPartNumber`, `name`, `controlType` (§6), `stockingClass` (§6), `stockingUnit` (§5), `status` (`DRAFT`|`ACTIVE`|`INACTIVE`|`SUPERSEDED`|`DISCONTINUED`), `createdAt/By`, `updatedAt/By`, `schemaVersion`.
Optional: `description`, `category`, `manufacturerId`, `manufacturerPartNumber`, `brand`, `productFamily`, `oemStatus`, `dimensions`, `weight`, `expiryTracked` (bool), `returnableCore` (bool), `defaultCost`/`listPrice` (reference only; procurement truth lives in supplier items), `notes`.
Explicitly absent: stock quantities (ledger-derived), supplier terms, tenant fields (#140), embedded alias/supplier arrays.

### `part_relationships/{relId}` (§5) and index requirements

New composite indexes expected (pinned at PR-1.3/1.4 spec time): `part_aliases (partId, status)`, `part_supplier_items (partId, status)`, `part_supplier_items (supplierId, status)`, `part_relationships (fromPartId)/(toPartId)`. All added via `firestore.indexes.json` under its own gated row — none authorized now.

## 5. Aliases vs supersession vs substitutes (`part_relationships`)

Four distinct concepts, never conflated: **same part, different identifier** → alias (§2). **Superseded part** → relationship `SUPERSEDED_BY` (one-way; old part status `SUPERSEDED`; procurement redirects, history untouched). **Compatible substitute** → `SUBSTITUTE` (symmetric or one-way flag, never auto-applied; `preferredReplacement` boolean; temporary substitutes carry effective dates). **Kit/assembly** → `KIT_COMPONENT` (kit Part `stockingClass: KIT` with component lines; consumption semantics defined at the Phase-6 tracked-stock gate, not Phase 1). Many-to-one consolidation = several `SUPERSEDED_BY` edges to one survivor; one-to-many replacement kits = `SUPERSEDED_BY` to a KIT part. Every relationship carries `reasonCode`, effective dates, approving actor, audit event. **Historical identities are never silently merged** — old partIds remain resolvable forever; reports translate via relationships, never rewrite.
Work Order behavior: an open WO referencing a superseded part keeps its reference; planning UIs surface the successor. Procurement behavior: new POs target the successor unless overridden. Inventory behavior: remaining stock of a superseded part stays sellable/consumable until exhausted.

## 6. Control classification (recommendation for O-6: two orthogonal axes + flags)

- `controlType`: `STANDARD` | `SERIALIZED` | `LOT` | `SERIALIZED_LOT` (tracking axis; `expiryTracked` boolean valid only with LOT variants).
- `stockingClass`: `STOCKED` | `NON_STOCK` | `SERVICE` | `KIT` (stocking axis; `CONSUMABLE` and `RETURNABLE/CORE` are flags on STOCKED, not classes).
- Per-type behavior matrix (receiving/transfer/consumption/count/return requirements) is specified for implementation at the corresponding enterprise-plan phase (serials/lots are **Phase 6**; Phase 1 stores the classification fields inert so parts are born correctly classified — no serial/lot capture logic in Phase 1).
- **Equipment boundary (ADR-006 preserved):** Part = what you stock; Equipment = installed/customer-serviceable asset. A SERIALIZED part instance is inventory until installation; installation creates/links an Equipment record via a future governed handoff (enterprise spec §4.9) — Equipment never becomes a Part row, customer-owned vs company-owned assets stay in the Equipment domain.

## 7. Field-authority matrix (summary; full row-per-field table maintained with the schema at PR 1.1)

| Domain (authority) | Fields | Source of truth | Mutation authority | Replicated consumers |
|---|---|---|---|---|
| Part Master descriptive | name, description, category, manufacturer refs, identifiers, units, controlType/stockingClass, dimensions/weight, status | `parts` + `part_aliases` (+`part_relationships`) | trusted writer, `inventory.catalog.manage` | WO snapshots (historical copies), UIs, analytics |
| Procurement | supplier, supplierSku, cost, currency, leadTime, MOQ, contract terms | `part_supplier_items` | trusted writer, `procurement.*` | reorder engine, PO drafts |
| Inventory | on-hand, reserved, available, locations | `inventory_transactions` (+ Phase-1 aggregates) | `inventoryService` only | dashboards |
| Operational usage | qtyPlanned, qtyUsed, truck allocation | WO docs / ledger | WO engine / `updateWorkOrderExecutionData` | analytics |
| Analytics | usage rate, forecast, reorder point | analytics service | derived, read-only | UIs |
| AI | recommendations | recommendation objects (Phase 7) | **recommend-only, never authoritative execution** | humans |

## 8. CSV import/export contract (O-9 direction)

Follows the `contactCsvImport.js` house pattern (pure parser, header auto-suggestion, column→field mapping, per-row validation, duplicate detection) extended with: required columns (internalPartNumber, name, controlType, stockingClass, stockingUnit); optional (description, category, manufacturer name+MPN, supplier name+SKU+cost+leadTime, UPC/EAN, aliases, flags); canonical `partId` column accepted for updates and forbidden for creates; **dry-run mode is the default** (mutating run is an explicit flag through the trusted writer); idempotent re-import via alias/internalPartNumber matching with explicit UPDATE vs CREATE vs CONFLICT per row; row-level error report artifact per the audit-artifact standard. No existing CSV code changes in this gate.

## 9. Barcode and mobile resolution (O-direction; no scanner implementation)

Scan → normalize (same §2 function) → resolve in priority order: exact `part_aliases` doc-ID get for numeric symbologies (UPC→EAN→GTIN), then INTERNAL_PN, then MANUFACTURER_PN, then SUPPLIER_SKU, then LEGACY. Deterministic outcome per scan: exactly one ACTIVE part, or an explicit multi-match conflict list (never a guess), or no-match → governed "capture unknown identifier" workflow (draft alias for review). INACTIVE alias → resolves with an inactive warning; SUPERSEDED part → resolves + surfaces successor. Offline: bounded alias cache (active aliases only) with staleness marker; scan audits (who/when/what resolved) ride the standard audit envelope. Latency target: single-get by doc ID.

## 10. Security and audit (O-direction)

All five part-master collections are **client-write-closed** (`allow write: if false`); reads role-scoped (cost fields restricted to purchasing-capable roles — cost-free projections for technicians). Mutations only via trusted-writer Functions following the #226/#325 pattern (capability check via `resolveEffectivePermission` — `inventory.catalog.manage`, `inventory.catalog.identifiers.manage`, `procurement.supplieritem.manage`, `inventory.catalog.supersession.approve`, `inventory.catalog.activate`; final names via the permission-catalog process), idempotency keys, atomic audit events (append-only; denials audited), server-derived actors. operationalRoles remain work-eligibility only — never security authority. Import runs produce evidence artifacts. No Enterprise Access implementation in this gate.

## 11. Unit-of-measure model (recommendation for O-4)

- **`stockingUnit`** on the Part (the unit of ledger truth: `ea`, `kit`, `bottle`, `tube` today; registry is configuration, not schema).
- **`purchaseUnit` + `conversionToStockingUnit`** on each supplier item (supplier pack sizes differ per supplier); counting/transfer/consumption default to the stocking unit.
- **Precision:** per-unit `precision` config (integer for `ea`/`kit`; up to 2–3 decimals for measured units like foot/gallon when introduced); rounding = half-up at the defined precision, applied only at conversion boundaries.
- **Conversion authority:** one pure domain module (client-mirrored per house convention); conversions computed at transaction time; **historical transactions store quantity + unit as transacted** and are never restated. Changing a part's stocking unit is a governed supersession-class change (new effective config + audit), not an edit of history.

## 12. Tenant-ready, tenant-inert (O-7; Issue #140 preserved)

No `tenantId`/`companyId` field is introduced. Readiness by construction: opaque `partId`s; alias/supplier-item doc-ID schemes accept a future scope prefix; uniqueness rules defined "per deployment" now, "per tenant" later; no query hard-codes a single-company assumption; every collection enumerable for a future partitioning migration; `ScopeType.tenant` (already inert in the access model) is where enforcement would land. Global-vs-tenant split expected under #140: UPC/EAN/GTIN globally unique; INTERNAL_PN/LEGACY/SUPPLIER_SKU tenant-scoped.

## 13. Domain integrations (summary against gate §14)

Ledger, warehouse/stock locations, truck balances, reorder recommendations, PO lines, receiving reconciliation (ordered part + supplier item + qty + unit + lot/serial + exceptions), returns, and reports all reference immutable `partId`; WO snapshots keep their historical denormalized copies unchanged while referencing `partId`; reports resolve current + historical identifiers via aliases/relationships; barcode per §9. The grandfathering rule (§1) makes every existing `partId`-shaped reference (sku strings) already canonical on day one — **zero rewrites of append-only history**.
