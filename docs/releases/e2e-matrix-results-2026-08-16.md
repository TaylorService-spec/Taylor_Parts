# #1041 E2E matrix — first live run

Environment: `eos-platform-sandbox`, Hosting `e45abad1`, all 82 Functions reachable
(invoker bindings repaired by the Owner; re-verified 82/82 preflight 204).

Verdicts use the #1041 vocabulary. VERIFIED requires live environment, live commit, and BOTH
positive and negative evidence. Everything gathered while the 16 services were unreachable was
discarded as STALE and re-run.

## Persona access matrix (live, signed in)

Console errors: **0 for every persona on every route.**

| Persona | Roles held | Result |
|---|---|---|
| admin | admin (compatibility) | Full content on all 9 routes |
| dispatcher | dispatcher + workOrderPartsPlanner + crmActivityContributor | Full content on all 9 routes |
| technician | technician (compatibility) | Correctly reduced: governed routes redirect to Dashboard; others render minimal shells |
| restricted | none | **DENY on all 9 routes** — the negative baseline holds |
| warehouseManager | inventoryTransferOperator | Empty shells everywhere (see gap below) |
| partsAssociate | inventoryCycleCountCounter | Empty shells everywhere (see gap below) |
| partsManager | inventoryCycleCountReconciler + inventoryCatalogAdministrator | Empty shells everywhere (see gap below) |

## VERIFIED

- **Opportunity stage progression on pipeline rows** — renders against real governed data:
  `"Identified, stage 1 of 6"`, 6 bars, 1 row matching the 1 open Opportunity in Firestore.
- **Synthetic-data banner honesty** — absent on real governed rows after the fix, present on fixture
  sources (unit-pinned both directions, and the positive test verified to FAIL against the old code).
- **Authorization negative path** — `restricted` (no Roles) is denied every route.
- **Authorization positive path** — `dispatcher` reaches CRM/Sales with its granted Roles.
- **Segregation of duties** (resolver-level, against the live stored assignments): counter is denied
  `cycleCount.reconcile`; reconciler is denied `cycleCount.create`/`submit`.

## OPEN GAP — governed Roles grant capability but no surface

`warehouseManager`, `partsAssociate` and `partsManager` hold governed business Roles that carry
`inventory.transfer.*` / `inventory.cycleCount.*` / `inventory.catalog.manage`, and the resolver
confirms those capabilities ALLOW. But in the live app all three see an essentially empty product,
and `inventory/transfers` redirects them to Dashboard — the surface their Role authorises is
unreachable.

Cause: navigation and route access are still gated on the COMPATIBILITY roles (admin/dispatcher/
technician, via `legacyKey`), not on the governed capabilities. A principal holding only a governed
business Role therefore has authority with nowhere to exercise it.

This is the same defect family as the two already fixed upstream of it — a capability carried by no
Role (#1052), and a Role reachable by no grant path (#1054). This is the third link: a Role granted
to a principal with no surface. It is NOT a small fix: binding nav/route visibility to governed
capabilities is a design change to the navigation model, so it is recorded here rather than
improvised during an E2E run.

Until it is closed, the operational Roles are verifiable only at the resolver/command layer, not
through the UI.

## Not yet run

Deeper per-surface flows (Transfer create→dispatch→receive, Cycle Count submit→reconcile, Receiving,
Purchasing, Truck Inventory) are blocked from UI verification by the gap above for exactly the
personas that should exercise them. They remain NOT_VERIFIED rather than FAILED.
