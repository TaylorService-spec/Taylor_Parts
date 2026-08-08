# Sales Order Foundation (Cycle 4)

Status: **BUILT (repo-only, fail-closed, undeployed/ungranted).** The committed commercial order authority
following a WON Opportunity — the first vertical increment of the Sales→Fulfillment runway (see
`docs/assessments/sales-order-fulfillment-assessment.md`).

## What it establishes
- **New authority `sales_orders`** (Owner-directed): Admin-SDK-only, client deny-all Rules (unchanged posture
  — `firestore.rules` gains a fail-closed block, both mirrors, hash re-pinned; **no deploy**). The only write
  path is the trusted `salesOrder` command.
- **Governed write** (`functions/src/salesOrder/`): pure `salesOrderLifecycle.ts` (states + transition graph +
  quantity helpers) + `salesOrderCommands.ts` (`buildCreateSalesOrder` / `buildTransitionPatch`) + onCall
  `createSalesOrder` / `transitionSalesOrder`. Capability **`salesOrder.write`** registered `active:false`
  (fail-closed); callables exported, **not deployed**.

## Ratified invariants
- **Commercial ≠ physical cardinality:** `C713 × 5` = ONE line, `orderedQty 5` — never five lines, never a
  serialized asset (a serialized-asset reference on a line is rejected). Serialized `equipment` is assigned at
  **fulfillment** (Cycle 5+).
- **Quantity model:** `orderedQty ≥ allocatedQty ≥ fulfilledQty ≥ 0`; partial fulfillment is first-class.
- **Lifecycle:** `CONFIRMED → IN_FULFILLMENT → FULFILLED → CLOSED` (+ `CANCELLED` before FULFILLED). `FULFILLED`
  is gated on every line fully fulfilled — an order can't be marked fulfilled while quantity remains.
- **Authority reuse (no forks):** `accountId` (Account), `locationId?` (Location), `ownerEmployeeId`
  (Employee), `salesChannel`, product/model/part `ref`, optional `sourceOpportunityId`. `unitPrice` is an
  **optional passive pricing snapshot** — no pricing/discount/tax authority invented. Money concepts stay
  distinct (order amount ≠ invoice ≠ payment ≠ revenue ≠ cost ≠ commission).

## Files
`functions/src/salesOrder/{salesOrderLifecycle,salesOrderCommands,salesOrderCallables}.ts` · `index.ts` export
· `constants/collections.ts` `SALES_ORDERS_COLLECTION` · permissionCatalog (both mirrors) `salesOrder.write`
active:false · resolver A3 + catalog allowlists · `firestore.rules` (+ mirror) `sales_orders` deny-all + hash
re-pin · `functions/test/salesOrderCommands.test.mjs` (8) · CI `sales-order-command-tests.yml`.

## Not built here (later cycles / gated)
Fulfillment/allocation seam (C5), warehouse pick/prep (C6), SO→Service/Dispatch via the WO command (C7),
multi-equipment coordination (C8, register #14), field execution (C9), finance seam. Protected activation
(`salesOrder.write` grant · callable deploy · Rules deploy) stays Owner/operator-gated.
