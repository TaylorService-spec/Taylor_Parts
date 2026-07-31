# Specification — Serialized Asset ↔ Equipment Installation & Available Inventory Composition (P0)

Base: `origin/main` `b6fcf77c3e61fd2feb5098b21297877f48b6bc73`.
Governance home: [ADR-010](../architecture/ADR-010-equipment-custody-and-available-inventory.md) + `DECISIONS.md` #59 (durable on main; this Specification conforms to them).
Authorities: DECISIONS #37/#40; [ADR-006](../architecture/ADR-006-equipment-and-installed-asset-management.md), [ADR-008](../architecture/ADR-008-part-master.md), [ADR-009](../architecture/ADR-009-business-operations-through-application.md); [Enterprise Inventory Specification](enterprise-inventory-architecture.md) §§2, 3.1, 3.2, 4.1, 4.4, 4.5, 4.6, 4.9, 4.12, 4.18 and Phases 1–4; [Enterprise Inventory Implementation Plan](../implementation-plans/enterprise-inventory-architecture.md); [Part Master Architecture](part-master-architecture.md); Product/Platform/Business models.

Scope: docs-only design. This Specification authorizes NO runtime code, Rules/Functions/index/migration/import, supplier integration, purchasing, Sales/invoicing/Financial, or QR/RFID implementation. It reuses existing authorities and introduces NO new inventory ledger, custody collection, or truck authority.

Superseded from earlier drafts: COMPANY-owned pre-installation records in `equipment/{id}`; `equipment_movements`; `equipment_fulfillment_events`; a `vehicles/{id}` custody authority; pre-install `fulfillmentState` on Equipment; the "serial custody never touches `inventory_transactions`" claim; migration of legacy Equipment into a pre-install model. (Serial units are inventory and coordinate with the single governed ledger.)

## A. Existing governance & non-authorities

Inventory and Equipment are SEPARATE authorities. Equipment (ADR-006) = installed/customer-serviceable asset + Work-Order/service history, carrying its installed unit's serial identity. Serialized Asset (Enterprise Inventory §3.1/§4.9) = persistent inventory identity for SERIAL-tracked Parts, moving via the SINGLE append-only ledger (§4.1, invariants 1–2) + Transfer Orders (§4.5) across the Location tree (§3.1). This P0 does NOT broaden `equipment/{id}`, create a second movement/quantity authority, or redefine Parts quantity/UD-3; it reuses the location-aware ledger + Serialized Asset authority and adds only the installation handoff (§H) + the composed read experience (§I).

## B. Canonical Part & 36k catalog vs stocked-subset (ADR-008)

Part: `partId` (immutable internal reference), `internalPartNumber` (company-facing SKU), tracking mode NONE/SERIAL/LOT. Catalog membership (≈ 36,000 purchasable parts) NEVER implies internal stock. Stock exists ONLY through governed location/ledger authority. Equipment compatibility may reference STOCKED or NON-STOCK parts. Non-stock/special-order stays searchable/purchasable but is never "Available" until governed receiving (§F). Customer output exposes `internalPartNumber` as the ONLY part IDENTIFIER; customer-safe DESCRIPTION and QUANTITY may render (supplier/manufacturer identifiers governed by §J).

## C. Supplier catalog & Parts Town fulfillment boundary

`part_supplier_items` holds supplier SKU/cost/terms. Parts Town (partstown.com) = EXTERNAL Supplier, NOT a company location; its Phoenix site is a SUPPLIER FULFILLMENT location, never an internal Warehouse. Supplier availability is a TIMESTAMPED OBSERVATION, never guaranteed stock, never company on-hand until governed receiving (§F) — receiving is the authority-changing supplier→internal-stock handoff. Supplier catalog fields: supplier SKU, manufacturer PN, cost, package/UoM, lead time, availability observation, fulfillment location, SHIP/LOCAL_PICKUP/SAME_DAY. NO API/scraping/ordering/integration authorized.

## D. Serialized Asset identity (Enterprise Inventory §4.9)

`{ serialNo, partId, currentLocationId (ledger-derived), inventoryState, currentEquipmentId (NULLABLE — the ACTIVE installation link; null while in inventory / returned / in-repair), ownership attribute (company / vendor-consignment §4.13) }`. Serial identity (serialNo + assetTag + QR) persists end-to-end. PRE-INSTALL states RECEIVED/AVAILABLE/RESERVED/STAGED/LOADED/IN_TRANSIT/DELIVERED and the INSTALLED state live on the Serialized Asset/allocation/Transfer workflow, NEVER on Equipment. An IMMUTABLE, append-only INSTALLATION-LINK HISTORY records every install and uninstall (serial↔equipmentId, at, context, reason). A serial may have SEQUENTIAL Equipment installations over its life (install → uninstall/return → repair → redeploy → new install), NEVER concurrent — `currentEquipmentId` is single-valued. Movement = ledger + Transfer Order (§F). One exact representation; foreign shapes fail closed.

## E. Unified inventory Location model (MOBILE, VIRTUAL)

Single Location tree (§3.1): WAREHOUSE, BIN, MOBILE (truck), VENDOR, CUSTOMER, VIRTUAL (in-transit). A serialized unit's physical CUSTODY = its current ledger `locationId` — not an Equipment field, not a new authority. IN_TRANSIT is the VIRTUAL location (§4.5).

## F. Receiving & Transfer Order authority (reused)

Receiving Order (§4.4, EI Phase 2) = supplier→internal-stock authority change; serial capture at receipt (§4.9) activates the Serialized Asset at its put-away location (RECEIVED). Transfer Order (§4.5, EI Phase 4): REQUESTED→PICKED→IN_TRANSIT→COMPLETED for warehouse↔warehouse / warehouse↔truck / truck↔truck, two-sided TRANSFER_OUT/IN through the VIRTUAL in-transit location, serial carried on entries. Delivery to a customer is such a governed Transfer to the CUSTOMER location. No new mechanism here.

## G. Truck inventory & serialized-unit custody (adopted EI Phase 4 — not downgraded)

Trucks are MOBILE Locations owned by an assigned technician (§4.6). "On a truck" = ledger location is that MOBILE location; restock is a Transfer (§F); FieldMode consumption posts CONSUMED at the truck location. An OPTIONAL future Vehicle BUSINESS record (fleet/registration) may LINK to a MOBILE location but is NOT the custody authority and NOT a competing truck-location model. Full Truck Inventory = adopted EI Phase 4; this Specification aligns to it.

## H. Delivery & installation handoff — one atomic installation effect

DELIVERY (prior, reused authority §F): a governed Transfer moves the serial to the CUSTOMER location (TRANSFER_IN at CUSTOMER). This is inventory movement — NOT the installation effect.

INSTALLATION (the new atomic command) posts ONE governed ledger effect, all-or-nothing (invariant 4):

1. VERIFY: `serialNo` exists and is AT the customer Location (delivered); `currentEquipmentId` is NULL (not already installed); target Account + Location (Location ∈ Account, ADR-006); acceptance context; caller capability.
2. APPEND the SINGLE governed INSTALLATION effect = CONSUMED (installed) FROM the CUSTOMER location (delivery already placed the serial there — no TRANSFER in this command).
3. SET the Serialized Asset to INSTALLED / NON-AVAILABLE and set `currentEquipmentId` = the new Equipment id.
4. CREATE the ADR-006 Equipment record (accountId, locationId, serial/assetTag frozen from the asset); set immutable `Equipment.serializedAssetId` (one Equipment ↔ one serial).
5. APPEND the install entry to the immutable installation-link history + the cross-authority audit.

INVARIANTS: steps 2–5 commit together or not at all; NO successful state leaves the serial both INSTALLED and AVAILABLE; NEVER concurrent links (fails closed if `currentEquipmentId` already set, serial not delivered, or Equipment already bound). Idempotency-keyed.

Ownership transfer (company→customer) = SEPARATE future commercial action (§K), never performed here.

UNINSTALL / RETURN / REPAIR-REDEPLOY / REPLACEMENT / RETIREMENT (both histories preserved; identity never silently reused; sequential-not-concurrent):

- UNINSTALL/RETURN (§4.12): governed return moves the serial back to inventory (ledger RETURNED/TRANSFER + disposition); set `currentEquipmentId` = NULL; append an uninstall entry to link-history; the Equipment record is uninstalled/RETIRED per ADR-006. Both histories remain intact + separately owned.
- REPAIR & REDEPLOY: an uninstalled serial may be repaired (RMA disposition/Adjustment) and later re-installed via a fresh §H command — creating a NEW Equipment record and a NEW link-history entry, with `currentEquipmentId` set again. The SAME serial thus has SEQUENTIAL Equipment installations over time.
- REPLACEMENT: the OLD Equipment is retired/uninstalled (its serial's `currentEquipmentId`→NULL) and a NEW Equipment record is created for the REPLACEMENT serial's install; the two Equipment records are linked by REPLACES/REPLACED_BY. A new serial is NEVER attached to the existing Equipment record. A reusable "installation position" persisting across unit swaps is a SEPARATE FUTURE entity (seam only; not built).

## I. Customer Equipment vs Available Equipment — UI composition (compose, never merge)

- Available Equipment UI reads SERIALIZED ASSETS (in-stock serial units + ledger location/availability; `currentEquipmentId` null).
- Customer Equipment UI reads INSTALLED EQUIPMENT (ADR-006), scoped by accountId/locationId.
- Unified Timeline composes the unit's INVENTORY history (ledger + Receiving/Transfer/RMA for its serial + installation-link history) with its SERVICE history (ADR-006/Work Orders) as one read-only chronology; each half stays owned by its authority. No state copied onto Equipment; no blended write; no merged record. The Equipment register does not include a Parts column.

## J. Customer-facing identifier confidentiality (ADR-008 preserved)

Authority: `partId` (immutable internal) · `internalPartNumber` (customer-facing SKU) · `part_supplier_items` (supplier SKU/cost/terms) · `part_aliases` (external resolution). Policy across ALL output (UI, quotes, invoices, WOs, emails, PDFs, reports, CSV, APIs, QR payloads, routes, logs, downloads):

1. `internalPartNumber` is the ONLY exposed part IDENTIFIER; customer-safe description + quantity may render.
2. NEVER expose to customers supplier name/id/SKU/URL, account cost, or cross-reference mappings.
3. Manufacturer PN CONFIGURABLE, DEFAULT HIDDEN for customer output.
4. Technicians get operational fields; procurement fields require a purchasing capability.
5. Purchasing resolves internal SKU → supplier item.
6. & 7. Enforced by BACKEND PROJECTIONS + capability checks (`resolveEffectivePermission`) — UI hiding is INSUFFICIENT.
8. Supplier identifiers PRESERVED INTERNALLY on purchasing history.
9. Tests PROVE customer projections carry no supplier identifiers or costs.

## K. Future Sales / quote / order / invoice reference seams (referenced, not built)

Opaque typed refs `{ module, id }`: `requestRef` | `opportunityRef` | `quoteRef` | `orderRef` | `invoiceRef`, plus the already-governed operational objects (Purchase Order §4.17, Receiving §4.4, Transfer §4.5, RMA §4.12). Composed at the orchestration/timeline layer so identity/custody/handoff never need redesign when those modules land. Not implemented here.

## L. Trusted commands / idempotency / audit / Rules / indexes / tests / migration / rollback

Commands: the §H installation handoff (+ future ownership-transfer, RMA link-back, replacement) are trusted-writer commands (#226/#325 pattern: server-derived actor, `inventory.*`/`equipment.*` capability, idempotency-keyed doc id, business write + Audit Event in ONE transaction, sanitized errors). No client-direct writes.

Rules: stock-bearing collections closed to client writes (`write: if false`), reads scoped per role/location (§4.19); ADR-006 Equipment Rules unchanged except the governed `serializedAssetId` field; installation-link history append-only, client read-only; no new movement/custody rules.

Indexes: Serialized Asset registry by partId/currentLocationId/inventoryState and by currentEquipmentId; installation-link history by serialNo and by equipmentId; ledger queries per §4.1 (no new movement index family).

Tests: pure-logic (link integrity, SEQUENTIAL-not-concurrent `currentEquipmentId`, delivery-Transfer-then-install-CONSUMED ordering, install-removes-availability invariant, uninstall-nulls-`currentEquipmentId` + retires-Equipment + appends immutable history, repair-redeploy creates a new Equipment, replacement REPLACES/REPLACED_BY, Available=serial-stock vs Customer=installed selectors, timeline compose without merge); trusted-writer emulator (atomicity, idempotency, no-effect-on-failure, duplicate/concurrent-link prevention, never-both-installed-and-available); Rules regression (pinned counts); §J customer-projection confidentiality tests.

Migration: LINK-ONLY. Legacy installed Equipment with NO provable Serialized Asset identity match STAYS UNLINKED (`serializedAssetId` absent, `currentEquipmentId` n/a) — do NOT synthesize Serialized Assets or `BASELINE_ESTABLISHED` records without authoritative identity evidence; `BASELINE_ESTABLISHED` only where such evidence exists.

Rollback: docs-only now; later phases per EI Implementation Plan. Rollback removes SCAFFOLDING/code ONLY — it NEVER deletes valid historical installation links, installation-link history, ledger effects, or audit: completed business history is IMMUTABLE. Old readers ignore additive fields (`serializedAssetId`, `currentEquipmentId`, link-history) but those and the ledger are RETAINED; ledger additivity lets old readers ignore new entry types.

## M. Phasing — aligned to the adopted Enterprise Inventory plan (no competing sequence)

Dependencies (not re-implemented): EI Phase 1 (ledger generalization + Part Master ADR-008 governed, tracking mode SERIAL, capability catalog); EI Phase 2 (Receiving); EI Phase 4 (Transfers + trucks as MOBILE locations). This Specification's incremental, separately-authorized additions, each gated on its EI dependency:

1. Serialized Asset identity + Available Equipment read.
2. Unified Timeline compose (read-only).
3. §H installation handoff command + Equipment `serializedAssetId` link + installation-link history.
4. §J customer projection + confidentiality tests.
5. Scan-event reuse (§4.18).

RFID and the §K commercial modules are separate later tracks.

## Boundaries

This Specification authorizes no runtime implementation, Firestore schema/data mutation, Rules, Functions, indexes, migration, import, supplier integration, purchasing action, Sales/Financial module, QR/RFID integration, deployment, or production access. It does not redefine UD-3/UD-4 or the adopted Enterprise Inventory phases. Merge requires separate Owner authorization.
