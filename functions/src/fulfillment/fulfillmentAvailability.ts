// Fulfillment — PURE authoritative-availability computation (Owner-ratified semantics, 2026-08-07). Turns
// canonical READ-ONLY inputs into an Availability determination per line. No Firestore imports; the callable
// (allocateSalesOrder) supplies the reads. This never trusts a client-supplied availability.
//
// NON-FORKING architecture: the Sales Order is the SOLE allocation-commitment record. Inventory
// (stock_locations / inventory_transactions), Equipment, and Warehouses are read-only sources of truth for
// availability; we record allocation ONLY on sales_orders (allocatedQty + selected serials) and NET other
// active Sales Orders' commitments. We do NOT write to the WO-keyed inventory ledger or the Equipment
// authority. The real operational inventory reservation happens downstream at Work-Order dispatch (Cycle 7).
//
// Owner semantics enforced here:
//  • Parts AVAILABLE_TO_PROMISE = eligible ON_HAND (ACTIVE warehouses) − open WO reservations − other active
//    Sales Order allocations. Never below 0. UNKNOWN stays UNKNOWN (missing evidence is never treated as 0).
//  • Serialized equipment is allocated individually; a serial is allocatable only if the canonical read says
//    it is company-controlled/at an eligible location/operationally available AND it is not already selected
//    by another active Sales Order AND it has no active temporary-placement conflict. Missing/contradictory
//    evidence ⇒ UNKNOWN, fail closed.

import type { Availability } from "./allocationProjection";

const num0 = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

// Sum eligible ON_HAND for a part from its stock_locations rows, restricted to eligible (status==ACTIVE)
// warehouses. `rows` are the stock_locations docs already filtered by partId (the callable supplies the read).
// Returns null (UNKNOWN) when there is no stock_locations evidence for the part at all — never treated as 0.
// Returns a known 0 when rows exist but none sit at an eligible warehouse (a real backorder, not missing
// evidence). Extracted as a pure function so eligible-warehouse filtering is directly regression-tested
// without the Firestore emulator (site-work #9).
export function sumEligibleOnHand(rows: Array<{ warehouseId?: string; quantity?: number }>, eligibleWarehouseIds: Set<string>): number | null {
  if (rows.length === 0) return null;
  let onHand = 0;
  let sawEligible = false;
  for (const r of rows) {
    if (typeof r.warehouseId === "string" && eligibleWarehouseIds.has(r.warehouseId)) {
      sawEligible = true;
      if (typeof r.quantity === "number" && Number.isFinite(r.quantity)) onHand += Math.max(0, r.quantity);
    }
  }
  return sawEligible ? onHand : 0;
}

// Net open Work-Order reservations for a part from the append-only ledger rows: RESERVED − RELEASED −
// CONSUMED, floored at 0. `rows` are the inventory_transactions for the part (already filtered by partId).
//
// DEMAND LINEAGE (C7): a Work Order created to fulfill a Sales Order carries that lineage; the parts it
// reserves are the SAME underlying demand already counted via the Sales Order's allocation. To avoid
// double-counting, `excludeWorkOrderIds` (the set of WO ids linked to an active Sales Order) drops those
// reservations here — SO-origin demand is counted ONCE, by the Sales Order; standalone WO reservations are
// counted here. A unit is thus never both an SO allocation and a WO reservation.
export function openWorkOrderReserved(
  rows: Array<{ type: string; quantity: number; workOrderId?: string }>,
  excludeWorkOrderIds: Set<string> = new Set()
): number {
  let reserved = 0;
  for (const r of rows) {
    if (r.workOrderId && excludeWorkOrderIds.has(r.workOrderId)) continue; // counted via the Sales Order
    const q = num0(r.quantity);
    if (r.type === "RESERVED") reserved += q;
    else if (r.type === "RELEASED" || r.type === "CONSUMED") reserved -= q;
  }
  return Math.max(0, reserved);
}

// Part AVAILABLE_TO_PROMISE. `onHandEligible === null` means the on-hand evidence was missing/untrusted ⇒
// UNKNOWN (never 0). Otherwise KNOWN with ATP = onHand − openWoReserved − otherSoAllocated − selfAllocated,
// floored at 0.
//
// IDEMPOTENCY (fix for site-work #1, so-alloc-overallocation-rerun): stock_locations.quantity is never
// decremented by an SO allocation (non-forking — allocation lives ONLY on the Sales Order). `otherSoAllocated`
// already nets every OTHER active Sales Order's claim on this same pool, but THIS Sales Order's own prior
// allocatedQty for this ref is equally a claim on that same physical pool and MUST also be netted here —
// otherwise a re-run (retry, or a second legitimate call before the SO leaves CONFIRMED/IN_FULFILLMENT) sees
// the exact same undiminished on-hand figure and additively grants more than physically exists. Netting
// `selfAllocated` here makes the remaining-ATP shrink by exactly what this SO already holds, so
// already-allocated + newly-allocatable converges to (and never exceeds) the true available pool.
export function computePartAvailability(input: {
  onHandEligible: number | null;
  openWoReserved: number;
  otherSoAllocated: number;
  selfAllocated?: number;
}): Availability {
  if (input.onHandEligible === null || input.onHandEligible === undefined) return { kind: "UNKNOWN" };
  const atp = Math.max(
    0,
    num0(input.onHandEligible) - num0(input.openWoReserved) - num0(input.otherSoAllocated) - num0(input.selfAllocated)
  );
  return { kind: "KNOWN", quantity: atp };
}

// Equipment availability for a model. `availableSerials === null` means the equipment evidence was missing/
// contradictory ⇒ UNKNOWN (fail closed). Otherwise the free serials are the canonical-available serials minus
// those already selected by another active Sales Order minus those with an active temporary-placement
// conflict; KNOWN quantity is their count, and `freeSerials` are the specific assets this SO may select.
export function computeEquipmentAvailability(input: {
  availableSerials: string[] | null;
  otherSoSelectedSerials: string[];
  tempPlacementConflictSerials: string[];
}): { availability: Availability; freeSerials: string[] } {
  if (!Array.isArray(input.availableSerials)) return { availability: { kind: "UNKNOWN" }, freeSerials: [] };
  const taken = new Set([...(input.otherSoSelectedSerials ?? []), ...(input.tempPlacementConflictSerials ?? [])]);
  const freeSerials = input.availableSerials.filter((s) => !taken.has(s));
  return { availability: { kind: "KNOWN", quantity: freeSerials.length }, freeSerials };
}

// Sum other active Sales Orders' commitments for one ref: allocatedQty (parts) and selected serials
// (equipment). `otherSoLines` is the flattened set of lines from OTHER active sales_orders.
export function sumOtherSoCommitments(
  otherSoLines: Array<{ ref: string; allocatedQty?: number; selectedSerialIds?: string[] }>,
  ref: string
): { allocatedQty: number; selectedSerials: string[] } {
  let allocatedQty = 0;
  const selectedSerials: string[] = [];
  for (const l of otherSoLines) {
    if (l.ref !== ref) continue;
    allocatedQty += num0(l.allocatedQty);
    if (Array.isArray(l.selectedSerialIds)) selectedSerials.push(...l.selectedSerialIds);
  }
  return { allocatedQty, selectedSerials };
}
