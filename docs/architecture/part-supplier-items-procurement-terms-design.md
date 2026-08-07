# Part↔Supplier Procurement Terms (`part_supplier_items`) — Design-First Program

**Status:** DESIGN-FIRST (proposed; awaiting Owner ratification). **No build, no deploy, no Rules change.**
**Purpose:** close the procure-to-stock process gap — make Purchasing derive supplier decisions from
governed catalog relationships (preferred supplier + cost + lead time) rather than free-form supplier
selection. This is the higher-value integration capability that ties Part + Supplier + Receiving together.

> Canonical authority: `part_supplier_items` is the SINGLE Part↔Supplier procurement relationship
> (INV-1 PR 1.4; Supplier Master architecture). Do NOT revive `supplier_catalog` or introduce another
> relationship model. The trusted commands already exist:
> `functions/src/partMaster/partSupplierItems.ts` — `createPartSupplierItem` / `updatePartSupplierItem` /
> `changePartSupplierItemStatus` / `setPreferredSupplier` (no callables, no UI, `read,write: if false`).

---

## 1. Information model (existing governed fields — do not redefine)

Per item, keyed `<partId>__<supplierId>` (references governed Part + governed Supplier identities):

| Field | Type | Sensitivity | Notes |
|---|---|---|---|
| `partId`, `supplierId` | governed ids | relationship | the relationship itself |
| `supplierSku` | string | relationship | the supplier's part/reference number |
| `cost` | decimal string | **COST (sensitive)** | procurement cost |
| `currency` | ISO-4217 | cost-adjacent | |
| `leadTimeDays` | number | operational | |
| `minOrderQty`, `orderMultiple`, `purchaseUnit`, `conversionToStockingUnit` | optional | operational | ordering terms |
| `contractStart`, `contractEnd` | optional dates | operational | |
| `availability` | enum | operational | AVAILABLE/… |
| `preferred` | boolean | **decision authority** | ≤1 ACTIVE preferred per Part (invariant) |
| `lastVerifiedAt` | optional date | operational | |
| `status` | ACTIVE/INACTIVE | lifecycle | inactive retained, non-selectable |

**Three visibility tiers** (drives §2/§3): **relationship** (who supplies this part, sku, lead time,
availability, preferred flag) · **operational terms** (order quantities/units/contract) · **cost**
(`cost`+`currency`). Cost is business-sensitive and MUST be separable from relationship visibility.

## 2. Read / projection model

`part_supplier_items` read stays **Rules-closed**; there is **no new legacy `isAdminOrDispatcher` read
site** (Owner catalog-read policy). Reads are served by **governed projections**, not raw collection
reads:

- **Relationship projection** — partId, supplierId (+ resolved supplier name), supplierSku, leadTimeDays,
  availability, `preferred`, status. **No cost.** Gated on the governed catalog-read capability
  (`inventory.catalog.read`, per the R-1 requirement) once it exists.
- **Cost projection** — the relationship projection **plus** `cost`/`currency` and the sensitive ordering
  terms. Gated on a **distinct** cost-read authority (§4).

Projections are produced by a trusted read service (Admin-SDK / a read callable), never a client-direct
`part_supplier_items` read — so field-level exposure is enforced server-side, not by hiding fields in the
client. Until R-1's catalog-read model lands, both projections **fail closed** (same posture as
Manufacturer). This capability is therefore **gated on the R-1 catalog-read requirement**
(`docs/assessments/r1-catalog-read-authority-requirement.md`).

## 3. Persona visibility matrix (proposed; separates relationship vs cost)

Personas evaluated **separately** (Owner direction). "Relationship" = who supplies + sku + lead time +
preferred; "Cost" = procurement cost/terms.

| Persona | Relationship read | Cost read | Write (terms) | Preferred |
|---|---|---|---|---|
| Catalog administrator | ✓ | ✓ | ✓ (`inventory.catalog.manage`) | ✓ (`.activate`) |
| Purchasing / procurement operator | ✓ | ✓ (needs cost to buy) | — (or scoped, TBD) | consumes (not sets) |
| Parts room manager | ✓ | — (default) | — | — |
| Warehouse manager | ✓ | — | — | — |
| Dispatcher | ✓ (relationship only) | — | — | — |
| Technician | — (or minimal) | — | — | — |
| Sales | relationship? (future) | **✗ never by default** | — | — |
| Finance / accounting | ✓ | ✓ (future) | — | — |
| Executive / Owner | ✓ | ✓ | — | — |

**Do NOT invent Sales/Finance permissions now.** Those personas/capabilities do not yet exist; this matrix
**records the future requirement** (relationship-vs-cost split will matter for them) rather than
manufacturing authority. The concrete near-term grants are: catalog administrator (full) and purchasing
operator (relationship + cost, read-only) — both **via R-1's governed catalog-read + a cost-read
capability**, not legacy roles.

## 4. Procurement-cost exposure model

**Principle (Owner):** a user may be allowed to know *"Supplier X supplies Part Y"* without being allowed
to know *"our cost from Supplier X is $Z."* Therefore:

- **Relationship visibility ≠ cost visibility.** They are different authorities and different projections
  (§2).
- Cost read is a **distinct capability** — proposed **`inventory.catalog.cost.read`** (or a field-scoped
  attribute of the catalog-read model, if R-1 prefers field-level scoping). Recommend a **separate
  capability** so cost can be granted to procurement/finance without widening general catalog visibility.
- The cost projection is server-enforced (trusted read service omits `cost`/`currency` for non-cost
  personas). No client ever receives cost it isn't authorized for.
- This is a **material governance decision for the Owner**: confirm cost is a separate capability
  (recommended) vs a field-scope of catalog-read, and confirm the near-term cost-authorized personas
  (catalog admin + purchasing operator; finance later).

## 5. Write authority

- **Terms** (create/update the item, all fields except status/preferred) → `inventory.catalog.manage`
  (the existing catalog write authority; `createPartSupplierItem`/`updatePartSupplierItem`).
- **Status** (ACTIVE/INACTIVE) → `inventory.catalog.activate` (`changePartSupplierItemStatus`).
- **No client Firestore writes**; all mutation via the trusted commands (reuse the callable-adapter
  pattern proven for Supplier/Part/Manufacturer). Callables to add (inert, repo-only):
  `createPartSupplierItem` / `updatePartSupplierItem` / `changePartSupplierItemStatus` /
  `setPreferredSupplier`.

## 6. Preferred-supplier semantics

- **Invariant preserved:** **at most one ACTIVE preferred supplier per Part** (enforced by the trusted
  `setPreferredSupplier` transaction, which clears the prior preferred atomically). The design does NOT
  reimplement this client-side.
- Preferred is **operational decision data**, not display metadata → set only via `setPreferredSupplier`
  (its own capability/audit), never an arbitrary client update.
- **Preferred is governed DECISION SUPPORT, not auto-select.** The Purchasing flow (§7) surfaces the
  preferred/eligible supplier(s) + cost/lead-time to the authorized persona; it does **not** auto-pick a
  supplier merely because one is preferred (current business semantics — revisit only if repository
  authority later supports automatic selection).

## 7. Purchasing integration target

```
shortage / reorder -> Part -> governed part_supplier_items terms -> preferred/eligible Supplier(s)
  -> cost + lead-time (to AUTHORIZED persona only) -> Purchase Order -> Receiving -> stock
```

- The reorder/PO flow (`domain/reorderPurchaseOrders.recordPurchaseOrder`) evolves from **free-form
  `supplierName`** to **consuming the governed relationship**: at PO time, surface the Part's preferred +
  ACTIVE eligible suppliers (relationship projection), and — for cost-authorized personas — the cost +
  lead time (cost projection). The operator chooses; preferred is highlighted, not auto-selected.
- This reuses the S4 Supplier-Master migration seam (`supplierId` + `supplierNameSnapshot` on
  reorder POs) — the PO records the chosen governed `supplierId`, closing the loop to Supplier Master.
- Purchasing does not reimplement preferred-supplier selection; it consumes `setPreferredSupplier`'s
  authority.

## 8. Rules implications

- `part_supplier_items` stays **`read,write: if false`** (no client writes; no new legacy read site).
- Reads via governed projections gated on R-1's catalog-read (relationship) + cost-read (cost)
  capabilities — **deploying those Rules/grants is protected** and gated on the R-1 model existing.
- No legacy-surface growth (R-1 convergence preserved) — this design is **blocked on R-1** exactly as
  Manufacturer is, by explicit intent.

## 9. Sandbox scenario

Realistic synthetic catalog: Parts + Suppliers + several `part_supplier_items` (one preferred/part;
multiple eligible; an INACTIVE item; a distinct-cost pair). Exercise: create/update terms · set preferred
(observe the ≤1-ACTIVE handover) · relationship projection (no cost) for a non-cost persona · cost
projection for a cost-authorized persona · denial (a non-cost persona never receives cost) · idempotency ·
the PO flow consuming preferred/eligible + cost for the purchasing operator · no orphan relationships.
Via the governed projections + test personas (catalog admin, purchasing operator). Part of the full
integrated product; no PSI-specific environment.

## 10. Rollback / promotion boundaries

Repo-only build (when ratified): callables (inert) + trusted read/projection service + Purchasing UI seam
+ tests + docs. **Protected promotion (each separately authorized):** Functions deploy · catalog-read +
cost-read capability + grants (R-1-owned) · any Rules deploy · `part_supplier_items` read/projection
activation · production term/preferred writes · Purchasing flow frontend promotion. Rollback: callables
additive (redeploy prior estate); grants revocable; projections/readiness flags revert; no destructive
data change (status is deactivate-not-delete; preferred handover is versioned/audited).

---

## Modularity (Enterprise requirement)

- **Supplier Master works without procurement terms** — a Supplier exists and is manageable without any
  `part_supplier_items`.
- **Part Master works without Supplier/terms** — a Part is created/operated without a supplier relationship.
- **Procurement terms are enabled when purchasing is** — `part_supplier_items` connects Part↔Supplier
  without collapsing them into one monolithic subsystem. Optional downstream (procurement/cost) is never a
  prerequisite for basic catalog operation.

## Open decisions for the Owner (ratify before build)

1. **Cost authority shape:** a separate `inventory.catalog.cost.read` capability (recommended) vs a
   field-scope of the catalog-read model.
2. **Near-term cost-authorized personas:** catalog admin + purchasing operator (+ finance later)?
3. **Purchasing auto-select:** confirm preferred stays decision-support (no auto-select) initially.
4. **Dependency:** this capability is gated on R-1's governed catalog-read model
   (`r1-catalog-read-authority-requirement.md`) — confirm sequencing (design now; build when R-1's read
   model is available, or build the write/callable layer repo-only first with reads fail-closed like
   Manufacturer).
