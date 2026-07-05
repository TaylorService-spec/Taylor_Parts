# ADR-003: Inventory Trigger System — a ledger, not a mutable stock document

## Status

Accepted

## Context

`ADR-001` retired a real inventory transaction system (PR #10's `services/inventoryService.js`, `fieldops_inventory` collection with mutable `quantityAvailable`/`quantityReserved` fields) and deferred it explicitly: *"Inventory will be redesigned as a transaction engine."* `ADR-002`/Epic 1.1 then built `data/partsCatalog.ts` (a static, read-only SKU reference table) and `WorkOrder.inventorySnapshot` (planned/used quantities per Work Order) — both explicitly non-authoritative, no stock tracking, no transactions.

This epic (Epic 2D) is that deferred work, taken up deliberately: a real, backend-only inventory system driven by Work Order state transitions, with its own design rigor rather than being folded into a UI phase as a small addition.

## Decision

- **No mutable "current stock" document.** Availability is computed by summing a new, append-only `inventory_transactions` ledger (`RESERVED`/`RELEASED`/`CONSUMED` entries) against `data/partsCatalog.ts`'s static `warehouseQty` baseline: `available = warehouseQty - (grossReserved - released)`. `CONSUMED` doesn't factor into availability separately — consuming a part converts an existing reservation into a permanent removal without changing total availability, since that quantity was already excluded from availability the moment it was reserved. This is more consistent with this project's standing "derive aggregates on read, never cache a second mutable total" default than the retired `fieldops_inventory` design, which had a separately-mutable field that could drift from reality.
- **A parallel server-side mirror of `partsCatalog.ts`** (`functions/src/data/partsCatalog.ts`) — Cloud Functions can't import the client's `src/` tree; same intentional-duplication pattern already established for `types/workOrder.ts` between client and server.
- **Trigger integration point: strictly post-commit.** `functions/src/transitionWorkOrder.ts` calls `triggerInventoryEffects(workOrderId, newState)` only after its own `db.runTransaction(...)` has already resolved successfully. Inventory logic never runs inside that transaction, never blocks the Work Order transition, and a failure inside it is caught and recorded, never thrown back to the client — the Work Order's state is already committed and stays committed regardless of what happens to inventory afterward.
- **State → trigger mapping** (`DISPATCHED` → `reserveParts`, `ARRIVED` → `confirmPartsOnSite`, `WORK_IN_PROGRESS` → `prepareConsumption`, `COMPLETED` → `consumeParts` + `finalizeInventoryTransaction`, `CANCELLED` → `releaseReservedParts`). `confirmPartsOnSite`/`prepareConsumption` are no-op placeholders: the ledger's `type` enum has no entry for "confirmed on site" or "prepared for consumption," and inventing a 4th/5th transaction type not in the given schema was avoided rather than guessed at. They remain idempotency-tracked so a future epic can define real behavior for them without changing the trigger wiring.
- **`consumeParts` consumes `qtyPlanned`, not `qtyUsed`.** `InventorySnapshotItem.qtyUsed` has no populate path anywhere in this app yet (Epic 1.1 explicitly deferred it, and UI inventory integration is out of scope for this epic too) — there is nothing else to consume from.
- **Idempotency + failure/retry state lives in a new, separate `inventory_sync_status` collection** (one doc per Work Order, `processedStates`/`failures` maps) — deliberately kept off the `WorkOrder` document itself, so this internal processing bookkeeping never touches that schema's public contract. Retrying is simply calling `triggerInventoryEffects` again for the same `(workOrderId, state)` — a failed attempt is never marked processed, so it naturally re-attempts. No cron/background system exists or is needed.
- **Both new collections (`inventory_transactions`, `inventory_sync_status`) are Admin-SDK-only** — `firestore.rules` denies all direct client read/write for both, unconditionally, matching the `counters` precedent (no UI reads either collection this epoch; there's no reporting view yet).

## Reasoning

**Why a ledger instead of resurrecting the retired mutable-stock design.** The retired design's core flaw (per `ADR-001`) wasn't "inventory tracking is wrong" — it was introducing a second, independently-mutable source of truth that could drift. A pure ledger avoids that: nothing is ever updated or deleted, availability is always a live computation, and there's exactly one place stock numbers can be wrong (a bug in the summation), not two places that can disagree with each other.

**Why post-commit, not inside the Work Order's own transaction.** Coupling inventory success to Work Order transition success would mean a warehouse-side problem (insufficient stock, a transient failure) could block or roll back an already-valid dispatch decision — the two concerns have different failure tolerances. A dispatcher successfully marking a Work Order `DISPATCHED` should never be silently undone because inventory bookkeeping hiccupped.

**Why this isn't the audit-log pattern `EPIC-2.md` already deferred.** The Work Order Creation Event Log proposal (deferred in `EPIC-2.md`'s Audit & Analytics Strategy section) would have been *redundant* with data already captured — `WorkOrder`'s own immutable timestamp fields. `inventory_transactions` captures something with no existing representation anywhere else: actual stock movements. A ledger isn't an optional audit convenience here — it's the only way to represent "real inventory" at all without a second mutable total.

## Consequences

- **A third client/server-mirrored static data file** (`functions/src/data/partsCatalog.ts` alongside `field-ops-app-vite/src/data/partsCatalog.ts`) — same manual-sync liability already flagged for `types/workOrder.ts` and `transitionEngine.ts`/`workOrderWorkflow.js`. Worth building real shared tooling if a fourth instance of this pattern shows up.
- **`confirmPartsOnSite`/`prepareConsumption` do nothing yet** — real behavior for `ARRIVED`/`WORK_IN_PROGRESS` inventory effects is an open question for a future epic, not resolved here.
- **No UI surfaces any of this** — both new collections are invisible to every role. A future reporting/inspection view is a distinct, later decision.
- **Availability computation reads the entire ledger for a part on every reservation check** — fine at this data volume (MVP scope, matching this epic's own framing), but would need a cached running-balance approach at higher transaction volume — exactly the kind of "second mutable total" this design deliberately avoided introducing prematurely; revisit only if the read cost actually becomes a problem.
