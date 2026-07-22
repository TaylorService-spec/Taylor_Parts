# ADR-008: Part Master — canonical part identity and governed catalog

**Status:** Accepted (2026-07-22) — Owner decisions O-1…O-12 approved (recorded in `docs/DECISIONS.md` #40; dispositions in `docs/implementation-plans/inv1-phase1-part-master.md` §6). Acceptance authorizes no implementation, schema, Rules, index, Function, migration, or deployment — each Phase 1 PR remains its own governed gate, and only PR 1.1 is recommended for the next separately authorized gate.

## Context

The platform has no Part Master. Descriptive part identity lives in a static, synthetic, duplicated in-code array (`partsCatalog.ts`, "METADATA ONLY — NO STOCK AUTHORITY"); the human-readable `sku` string simultaneously serves as the immutable `partId` in the append-only inventory ledger, all reorder workflow objects, and Work Order snapshots; supplier identity is free text in the live purchasing flow while a normalized supplier catalog lies dormant; no manufacturer, alias, UoM-conversion, or control-classification concept exists for parts (full inventory: `docs/assessments/part-master-architecture.md`). The adopted enterprise inventory architecture (Decision #37) requires catalog-as-data with a Part Master ADR before Phase 1 (D-4). Production currently contains zero Work Orders (Gate 0.4(a) evidence), making this the cheapest moment to fix identity.

## Decision drivers

Immutable referential identity vs human usability; append-only history that must never be rewritten; multi-supplier/multi-identifier reality (MPN, supplier SKU, UPC/EAN/GTIN, legacy numbers); supersession without history loss; varied units (`ea`/`kit`/`bottle`/`tube` already); Firestore constraints (document growth, Rules budget, index-driven lookup); tenant-ready-tenant-inert (#140); trusted-writer mutation discipline (enterprise spec invariant 3); ADR-006's hard Part↔Equipment boundary; SaaS/industry neutrality.

## Options considered

**Identity:** (A) bare doc ID; (B) generated partId field distinct from doc ID; (C) business part number as canonical ID; **(D) hybrid — chosen.**
**Storage:** (A) single Part doc with embedded arrays; (B) Part + child subcollections; **(C) Part + normalized top-level collections — chosen;** (D) partial embedding hybrid (documented fallback).

## Decision (proposed)

1. **Hybrid identity:** immutable `partId` = `parts/{partId}` document ID (opaque for new parts; **grandfathered to the existing sku string for parts already referenced by the ledger/workflows/snapshots**, so no append-only history is ever rewritten) + mutable, governed, unique `internalPartNumber` + all external identifiers as aliases. External/human-readable identifiers are never the sole immutable identity.
2. **Normalized model:** `parts`, `part_aliases` (doc ID `<type>__<normalizedValue>` → structural uniqueness, single-get barcode lookup, tenant-prefixable), `part_supplier_items` (procurement authority; many suppliers per part; supplier change never changes identity), `part_relationships` (SUPERSEDED_BY / SUBSTITUTE / KIT_COMPONENT with reason codes, effective dates, approval, audit — historical identities never silently merged), `manufacturers`. No unbounded arrays in the Part document.
3. **Data ownership:** descriptive identity (Part Master) / procurement terms (supplier items) / stock truth (ledger) / operational usage (WO docs) / analytics (derived) / AI (recommend-only) — field-authority matrix in the specification §7.
4. **Units:** `stockingUnit` on the Part; `purchaseUnit` + conversion factor per supplier item; one pure conversion module; historical transactions preserve quantity+unit as transacted.
5. **Control classification:** orthogonal `controlType` (STANDARD/SERIALIZED/LOT/SERIALIZED_LOT + `expiryTracked`) × `stockingClass` (STOCKED/NON_STOCK/SERVICE/KIT + consumable/core flags), stored inert in Phase 1; serial/lot behavior implements at the enterprise plan's Phase 6. Equipment remains a separate domain (ADR-006); installation of a serialized part links to Equipment via a future governed handoff.
6. **Security:** all part-master collections client-write-closed; trusted-writer Functions with capability checks, idempotency, atomic append-only audit; cost visibility role-restricted.
7. **Tenant posture:** no tenant fields now; doc-ID schemes, uniqueness scoping, and query patterns designed so #140 can partition later without remodeling.

## Consequences

- Every stock-bearing domain references one immutable `partId`; barcode/import resolve through one alias mechanism; supplier/manufacturer churn never destabilizes references.
- The static catalog becomes a bootstrap/seed source only, then retires (its `warehouseQty` baseline replacement is a Phase-1 ledger-aggregate concern flagged in the implementation plan).
- New composite indexes and new trusted-writer Functions are required (each behind its own gated row; none authorized by this ADR).
- Migration is additive and cheap now (no Part Master collection exists anywhere; the only production audit to date found the Work Order collection empty — part-adjacent collections are profiled at migration step 1); deferring makes the sku freeze-in permanent.
- More collections than an embedded design — the cost of bounded documents, simple Rules, and indexable lookups.

## Migration implications

Ten-step sequence (profile → canonical IDs (grandfathered skus) → alias map → create `parts` → supplier items → reference backfill only where a field is absent (never rewriting history) → dual-read → validation → cutover → legacy deprecation) — detailed in the implementation plan §4, all steps gated, rollback = additive-collection removal before cutover.

## Rejected alternatives

Business-number-as-ID (C) — renumbering/mergers/supplier changes would mutate referential identity; the current defect institutionalized. Embedded arrays (A) — unbounded document growth, no cross-part alias lookup, alias uniqueness unenforceable structurally. Child subcollections (B) — collection-group indexes + per-doc Rules complexity for no query benefit. Rewriting ledger/snapshot history onto new opaque IDs — violates append-only invariants; grandfathering achieves the same referential integrity free. Client-direct part CRUD — violates enterprise spec invariant 3 and the Rules complexity budget.

## Implementation and deployment gates

Adoption of this ADR = Owner decision O-11. Implementation = the bounded PR sequence in `docs/implementation-plans/inv1-phase1-part-master.md`, every PR Owner-review-gated; Rules/index/Function deploys each carry their own authorize→deploy→verify gates; migration and cutover are separate Owner gates. Nothing is authorized by merging this document.
