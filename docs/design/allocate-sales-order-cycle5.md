# Live Allocation — `allocateSalesOrder` (Cycle 5)

Status: **BUILT (repo-only, fail-closed, undeployed/ungranted).** Implements the Owner-ratified fulfillment
availability semantics (2026-08-07) as a governed transactional command. Capability `salesOrder.fulfill`
registered `active:false`; the callable is exported, not deployed.

## Non-forking architecture
Allocation is recorded **entirely on `sales_orders`** (line `allocatedQty` [+ selected serials later]).
Inventory (`stock_locations` / `inventory_transactions`), `warehouses`, and `equipment` are **read-only**
sources of truth for availability. **No write** to the WO-keyed inventory ledger (ADR-003) or to the Equipment
authority — so no second inventory/reservation model. The real operational reservation happens downstream when
a Work Order is dispatched (Cycle 7); the Sales Order allocation is the commercial commitment, which future
ATP computations net.

## Parts availability (fully implemented, Owner §1–§2, §4)
Inside a transaction: `AVAILABLE_TO_PROMISE = eligible ON_HAND − open WO reservations − other active SO
allocations`, floored at 0.
- **eligible ON_HAND** = Σ `stock_locations.quantity` for the part at warehouses with `status == "ACTIVE"`
  (trucks/mobile/customer are separate collections, naturally excluded). No stock-location evidence ⇒
  **UNKNOWN** (never 0). Stock exists but none at an eligible ACTIVE warehouse ⇒ known 0 (backorder).
- **open WO reservations** = `inventory_transactions` `RESERVED − RELEASED − CONSUMED` for the part, floored 0.
- **other active SO allocations** = Σ `allocatedQty` for the ref across other `CONFIRMED`/`IN_FULFILLMENT`
  Sales Orders — re-read **in the transaction**, so the same on-hand is never double-allocated (SO-vs-SO race).
- SERVICE lines need no inventory ⇒ fully allocatable.

## Serialized equipment — UNKNOWN / fail-closed this slice (Owner §3, §9)
A serial is allocatable only once EOS can establish company control + eligible location + operational
eligibility + no active SO allocation + not installed/customer-custody + **no active temporary-placement /
loaner / evaluation conflict** (§9). That **equipment-availability contract** — a confident read over the
canonical `equipment` authority plus the #12 temporary-placement conflict seam — is the **next slice**. Until
it exists, equipment lines resolve to **UNKNOWN and fail closed** (exactly the ratified behavior for
missing/contradictory evidence). The pure `computeEquipmentAvailability` (serial netting across SOs +
temp-placement conflicts) is already built and tested, ready for that slice to wire the canonical read.

## Behavior (Owner §5–§8)
Shortfall ⇒ line `PARTIAL`, overall readiness `PARTIAL`/`BLOCKED`; shortage stays explicit (never "READY").
Known-zero ⇒ `BACKORDERED` (explicit unfulfilled qty). **No** auto-PO, no SO change, **no substitution**, no
promised date — those are separate governed workflows. Next-best-action recommendation stays a future seam
(recommend ≠ authority). The command writes `fulfillmentReadiness` + counts on the SO for observation.

## Files
`functions/src/fulfillment/fulfillmentAvailability.ts` (pure) · `allocateSalesOrder.ts` (callable) ·
`allocationProjection.ts` (Cycle-5 seam, reused) · index export · permissionCatalog (both mirrors)
`salesOrder.fulfill` active:false · resolver A3 allowlist · tests `fulfillmentAvailability` (4) +
`allocationProjection` (6) · CI `fulfillment-allocation-tests.yml`. No Rules change (reuses existing
collections). Protected activation (`salesOrder.fulfill` grant · deploy) stays Owner/operator-gated.
