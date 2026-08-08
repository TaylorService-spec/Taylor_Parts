# Fulfillment / Allocation Seam (Cycle 5)

Status: **SEAM LOGIC BUILT (pure, repo-only).** Turns a committed Sales Order's remaining demand + an
availability determination into an honest, per-line allocation plan. The live availability computation and the
allocation-writing command are deferred — see the material decision below.

## Authority boundary (Owner §5)
Sales **requests/observes** fulfillment; it is **not** the authority over inventory. So this projection
**consumes** an availability determination — it does not compute inventory truth, and it **never trusts a
client-supplied availability**. Inventory owns inventory state; Equipment owns serialized assets; Service owns
field execution.

## What this slice adds (`functions/src/fulfillment/allocationProjection.ts`, pure + tested)
- **Availability vocabulary** mirroring the readiness model: `KNOWN{quantity}` · `UNAVAILABLE` · `UNKNOWN`
  (an unknown source ⇒ UNKNOWN, never silently 0).
- **Per-line allocation** against remaining-to-allocate (`orderedQty − allocatedQty`), never over-allocating:
  states `ALLOCATED` (full) · `PARTIAL` · `BACKORDERED` (known-zero from an available source) · `UNAVAILABLE`
  (source says can't source) · `UNKNOWN` (no determination).
- **Honest readiness rollup** `READY | PARTIAL | BLOCKED | UNKNOWN` (worst-known wins; a single unknown line
  is not claimed READY).

## Deferred to the next slice
- The **trusted `allocateSalesOrder` command** that computes availability from the **canonical Inventory/
  Equipment authorities** (Admin-SDK reads), applies `buildAllocationPlan`, and records `allocatedQty` back on
  the Sales Order lines + a fulfillment-readiness projection. Capability `salesOrder.fulfill` (or similar),
  active:false, fail-closed.

## ⚠ Candidate material decision (surfaced, NOT guessed — Owner §20)
The **availability computation semantics** are a genuine business decision with more than one legitimate
reading, and I have deliberately **not** invented them:
- **Parts:** is available = on-hand at eligible warehouse(s) minus open reservations? Which locations are
  eligible (warehouse `status==ACTIVE`; exclude trucks/MOBILE)? Do we net against other orders' allocations?
- **Serialized equipment:** available = count of `equipment` of the model in an available/in-stock status
  (not installed / not already allocated / not a temporary placement)? What statuses qualify?
- **Backorder / substitution policy:** does a shortfall auto-backorder, or require a decision? Are governed
  substitutions in scope here?
These map to reserve/backorder semantics across `stock_locations` / `inventory_transactions` / `equipment`.
The **seam structure is settled** (this slice); the **availability determination rules** are the material
decision to confirm before the live `allocateSalesOrder` command is built. Until then the projection accepts
an injected determination so the seam is complete and testable without asserting an interpretation.

## Preserved seams
Temporary-equipment (#12) allocation will reuse this same availability/allocation machinery once its decision
lands; the allocation model does not foreclose it.
