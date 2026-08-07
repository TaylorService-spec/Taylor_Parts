# R-1 Input — Governed Catalog-Read Authority (concrete requirement)

**Source:** Owner decision on the Manufacturer read authority (2026-08-07, option (b) — WAIT). This is a
**requirement fed into R-1**, not a build. It does not change any existing production access; it governs
**new** catalog surfaces and the eventual convergence of the legacy catalog reads.

## Requirement

R-1 must provide a **durable governed read-authority model for catalog / reference data** sufficient for:

- **Parts** (`parts`)
- **Manufacturers** (`manufacturers`)
- **Suppliers** (`suppliers`)
- **Part↔Supplier relationships / procurement terms** (`part_supplier_items`)

…**without requiring new legacy `isAdminOrDispatcher()` (or `isActiveOperationalRole`) Rules sites.** New
catalog surfaces (Manufacturer now; part_supplier_items next) are BLOCKED on this model — they will not add
legacy read authority that R-1 is actively retiring (ADR-005 §2.7 criterion 1 / the `legacy-surface-gate`).

## Permission-catalog evaluation (does an appropriate read capability already exist?)

**No.** `functions/src/access/permissionCatalog.ts` defines read capabilities for other resources —
`account.record.read`, `inventory.transaction.read`, `inventory.action.read`, `warehouse.record.read`,
`report.*.read` — but **none expresses catalog reference-data read**. The `inventory.catalog` resource
carries only `inventory.catalog.manage` (create/edit) and `inventory.catalog.activate` (lifecycle) — write
and lifecycle, no read. Catalog reference-data reads (`parts`/`suppliers`) are currently **role-based**
(`isAdminOrDispatcher` + operational roles), which is exactly the legacy surface R-1 is converging.

## Minimum durable proposal (for R-1 to own — reconciles all siblings, not a Manufacturer-only hack)

Add one capability to complete the catalog resource's authority triad:

- **`inventory.catalog.read`** — resource `inventory.catalog`, action `read`. The single governed
  read for basic catalog/reference visibility across ALL catalog objects: Parts, Manufacturers,
  Suppliers, and part_supplier_items (relationship + operational fields).
- **`inventory.catalog.cost.read`** — **RATIFIED as a SEPARATE capability (Owner 2026-08-07).**
  Sensitive procurement-cost / commercial-terms visibility (unit cost, currency, contract terms). Cost
  is NOT an incidental field of general catalog read: *"Supplier X supplies Part Y"* is materially
  different authority from *"we pay Supplier X $Z for Part Y."* Cost/contract visibility must be
  **independently grantable / revocable / auditable**, and the cost projection must never broaden general
  catalog visibility. The cost projection requires **both** `inventory.catalog.read` AND
  `inventory.catalog.cost.read`.

### Ratified cost-authorized personas (near-term business intent — R-1 to grant, not Product Eng)

Business responsibility determines cost authority; broad admin/seniority is NOT a shortcut.

| Persona | catalog.read (relationship+operational) | catalog.cost.read |
|---|---|---|
| Catalog administrator | ✓ | ✓ |
| Purchasing / procurement operator | ✓ | ✓ |
| Finance / accounting | (future) | **FUTURE — do not invent now** |
| Parts room manager | ✓ (as business need proves) | ✗ by default |
| Warehouse manager | ✓ (as needed) | ✗ by default |
| Dispatcher | ✓ (only where workflow requires) | ✗ by default |
| Technician | — | ✗ |
| Sales | — | ✗ |
| Owner / Admin | do NOT infer from seniority/legacy-admin | do NOT infer |

**Durable purchasing/procurement role:** if it does not yet exist as a governed role, R-1 should record
that as an **authorization-design requirement** rather than manufacturing a production role. Do not use
broad admin access as a shortcut for cost authority.

Convergence path (R-1-owned, no production access change now):
1. **New surfaces adopt it from day one** — Manufacturer + part_supplier_items reads gate on
   `inventory.catalog.read` (never a new legacy site).
2. **Existing legacy reads are reproduced, then converged** — `parts`/`suppliers` keep their current
   role-based reads *unchanged in production* until R-1 swaps them to `inventory.catalog.read` as part of
   its normal cutover (existing legacy authority is *reproduced* during convergence, per Owner direction;
   only NEW surfaces avoid adding legacy authority).
3. **Grant model** — `inventory.catalog.read` granted to the personas that legitimately view catalog
   reference data (at minimum the catalog administrator; likely also the roles that read parts today —
   admin/dispatcher/PARTS_MANAGER/WAREHOUSE_MANAGER — reconciled by R-1, not invented here).

Do **not** invent/implement this capability solely to unblock Manufacturer; it must be adopted through
R-1's governed cutover so Parts/Suppliers/part_supplier_items are reconciled together.

## Note for part_supplier_items (next capability)

`part_supplier_items` read is currently Rules-closed and will hit the same gate. Its design
(`docs/architecture/part-supplier-items-procurement-terms-design.md`) separates **relationship
visibility** from **procurement-cost visibility** — so R-1's catalog-read model must support
**field-level / projection-level** distinctions (basic relationship visibility may be broader than
cost visibility). See that design's persona-visibility matrix + cost-exposure model.
