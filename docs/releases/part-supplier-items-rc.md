# Part↔Supplier Procurement Terms (`part_supplier_items`) — RC (repo-side)

**Status:** WRITE layer + projection contract **repo-complete**; READ service + Purchasing UI **gated on
R-1** (governed `inventory.catalog.read` + `inventory.catalog.cost.read`). Repo-only and inert. Design:
`docs/architecture/part-supplier-items-procurement-terms-design.md`.

## Status matrix

| Aspect | State |
|---|---|
| Trusted write commands | pre-existing (`functions/src/partMaster/partSupplierItems.ts`) |
| Write callable adapters | COMPLETE / NOT DEPLOYED (PR #629) — create/update/changeStatus/setPreferred |
| Projection contract (relationship / cost tiers) | COMPLETE (pure, tested) — read SERVICE NOT built/activated |
| Read authority (catalog.read / cost.read) | **WAITING ON R-1** (`docs/assessments/r1-catalog-read-authority-requirement.md`) |
| Purchasing integration UI | **BLOCKED on read authority** (consumes the projections) |
| Production promotion | PROTECTED / HELD |

## What's built (repo-only)

- **Callables** (`partSupplierItemCallables.ts`, exported frozen names, not deployed): actor from
  `request.auth.uid` only; capability inside the command (`.manage` create/update/setPreferred,
  `.activate` status); sanitized errors; atomic ≤1-ACTIVE-preferred stays in `setPreferredSupplier`.
- **Projection contract** (`partSupplierItemProjections.ts`, pure): the RELATIONSHIP projection
  (relationship+operational, NO cost) and the COST projection (adds cost/commercial) with the
  Owner-ratified field tiers; fails closed without `catalog.read`; `cost.read` alone never bypasses; cost
  can never leak through the relationship projection. **The read SERVICE (Firestore read + capability
  resolution) is deliberately NOT built** — it is gated on R-1 supplying the two capabilities.

## Verification

13 emulator (callables incl. atomic preferred handover) + 4 projection (cost-leak/fail-closed) + 2
export tests. Build clean. Independent design-code review (one HIGH cost-tier drift fixed; 4 legibility
fixes). `part_supplier_items` stays `read,write: if false` (no new legacy read site).

## Exact production/enablement delta (all protected / gated; none done)

1. **R-1 delivers** `inventory.catalog.read` + `inventory.catalog.cost.read` (+ the cost-authorized
   persona grants — catalog admin + purchasing operator near-term; finance future). *R-1-owned.*
2. **Build the trusted read/projection SERVICE** (repo-only, once R-1's capabilities exist) that resolves
   the caller's catalog.read/cost.read → the relationship/cost projection. Then wire the Purchasing UI seam.
3. Deploy the four callables (Functions deploy) · capability grants · Purchasing frontend promotion.

## Rollback

Callables deploy → redeploy prior estate (additive). Grants revocable. No data migration; status is
deactivate-not-delete; preferred handover is versioned/audited. Read service not built → nothing to roll
back there.

## Sandbox scenario (once R-1 read authority is available)

Part with multiple Suppliers · one ACTIVE preferred + alternate eligible · different lead times/costs ·
catalog admin sees cost · purchasing operator sees cost · parts/warehouse persona sees relationship but
NOT cost · technician denied cost · atomic preferred handoff · inactive relationship handling · cost
cannot be inferred through the relationship projection · the purchasing flow records the governed
`supplierId` into the canonical `reorder_purchase_orders`. Synthetic commercial values only. No
PSI-specific environment.

## Modularity / canonical authorities

Part Master works without Supplier Master; Supplier Master works without procurement terms; terms enable
when purchasing is; cost is an independently governed layer (never a hidden prerequisite for basic
catalog operation). `part_supplier_items` is the ONE Part↔Supplier authority; `reorder_purchase_orders`
is the ONE operational PO authority. Do not revive `supplier_catalog` / `purchase_orders`.
