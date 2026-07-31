# ADR-010 — Serialized Asset to Installed Equipment Handoff

Issued: 2026-07-30 19:49:42 -07:00 (America/Phoenix)
Authoritative starting head: `364a8b49dcd32209c9fece7c87bc885260b26e71`

Status: Accepted — Owner-approved docs-only architecture
Extends: [ADR-006](ADR-006-equipment-and-installed-asset-management.md), [ADR-008](ADR-008-part-master.md), [ADR-009](ADR-009-business-operations-through-application.md)
Depends on: [Enterprise Inventory Specification](../specifications/enterprise-inventory-architecture.md) and [Implementation Plan](../implementation-plans/enterprise-inventory-architecture.md)

## 1. Decision

Inventory and Equipment remain separate authorities:

```text
Serialized Asset (Inventory)
  receiving → warehouse → truck → transit → customer delivery
                                      ↓
                         trusted installation handoff
                                      ↓
Installed Equipment (Customer/Service)
  installation → Work Orders → service history → retirement
```

- A **Serialized Asset** is the persistent identity of a SERIAL-tracked Part before and between installations.
- **Equipment** is the installed, customer-serviceable record governed by ADR-006.
- Installation links the records; it never broadens `equipment/{id}` into warehouse or truck inventory.
- Customer Equipment and Available Equipment are composed views over their respective authorities, not two states of one document.

## 2. Existing Inventory authorities are reused

This ADR introduces no parallel movement or quantity authority:

- the Enterprise Inventory ledger remains the single stock-movement authority;
- Receiving is the supplier-to-internal-stock handoff;
- Transfer Orders govern warehouse↔warehouse, warehouse↔truck, truck↔truck, and delivery movement;
- trucks are `MOBILE` Inventory Locations;
- in-transit stock uses the `VIRTUAL` Location;
- serialized identity is carried by governed ledger effects;
- an optional future Vehicle business record may link to a `MOBILE` Location but is not custody authority.

## 3. Installation handoff

Delivery first completes through a governed Transfer to the customer Location. Installation is then one idempotent trusted transaction that:

1. verifies the delivered Serialized Asset, Account, Location, acceptance context, and caller capability;
2. appends the single governed `CONSUMED` installation effect from the customer Location;
3. marks the Serialized Asset `INSTALLED` and non-available;
4. creates the ADR-006 Equipment record and links both records;
5. appends immutable installation-link history and audit evidence.

The Serialized Asset has one nullable `currentEquipmentId`. An Equipment record links to exactly one Serialized Asset. Concurrent links fail closed. No successful transaction may leave the serial both installed and available.

## 4. Returns, redeployment, and replacement

- Uninstall/return clears the current link through a governed command, returns the serial to Inventory through the applicable RMA/ledger flow, retires the installed Equipment, and preserves both histories.
- A repaired serial may later be installed again into a **new** Equipment record. Installation history is sequential and immutable.
- Replacement retires the old Equipment, installs the replacement serial as new Equipment, and records `REPLACES` / `REPLACED_BY`.
- A reusable installation-position entity is deferred; a new serial is never attached to an existing Equipment record.
- Legal ownership transfer is a separate future commercial action and never a side effect of installation.

## 5. Part Master, stock, and suppliers

- Part Master membership does not imply stock. The business may govern approximately 36,000 known or purchasable Parts while stocking only a subset.
- Internal stock exists only through ledger and Location authority.
- Equipment compatibility may reference stocked or non-stock Parts.
- Parts Town is an external Supplier. Its Phoenix fulfillment site is not an internal Warehouse.
- Supplier availability is a timestamped observation and becomes internal stock only after governed receiving.
- Supplier SKU, cost, terms, packaging, lead time, and fulfillment options belong to `part_supplier_items`.

## 6. Identifier confidentiality

`internalPartNumber` is the only part identifier exposed to customers. Customer-safe descriptions and quantities may render.

Supplier identity, supplier SKU, supplier URL, account cost, and cross-reference mappings are excluded from customer-facing UI, documents, reports, exports, APIs, QR payloads, routes, logs, and downloads. Manufacturer-part-number visibility is configurable and defaults hidden.

This policy is enforced by backend projections and capability checks, not UI hiding alone. Purchasing users may resolve internal Part numbers to supplier items; supplier identifiers remain preserved in internal purchasing history.

## 7. UI composition

- **Available Equipment** reads available Serialized Assets and their governed ledger/Location state.
- **Customer Equipment** reads installed ADR-006 Equipment scoped by Account and Location.
- A unified read-only timeline composes Receiving, Transfer, RMA, installation-link, and Work Order history without copying or merging authority.
- The Equipment register does not include a Parts column.

Future opportunities, quotes, orders, invoices, and acceptance records bind through typed references at the orchestration/timeline boundary. This ADR does not implement those modules.

## 8. Phasing

This architecture follows the adopted Enterprise Inventory sequence:

1. Phase 1 — location-aware ledger, Part Master, SERIAL tracking, capabilities.
2. Phase 2 — Receiving and Serialized Asset creation.
3. Phase 4 — Transfers and trucks as `MOBILE` Locations.
4. Additive gate — Available Equipment read and timeline composition.
5. Additive gate — trusted installation/uninstall handoff and immutable link history.
6. Additive gate — customer-safe projections and identifier-confidentiality tests.
7. Later — shared QR scan-event reuse; RFID remains a future input channel.

## 9. Boundaries

This ADR authorizes no runtime implementation, Firestore schema/data mutation, Rules, Functions, indexes, migration, import, supplier integration, purchasing action, Sales/Financial module, QR/RFID integration, deployment, or production access. It does not redefine UD-3/UD-4 or the adopted Enterprise Inventory phases.
