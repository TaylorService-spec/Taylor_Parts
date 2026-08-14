// Fulfillment — PURE allocation-seam projection (framework-independent; unit-tested). This is the seam LOGIC
// that turns a committed Sales Order's remaining demand + an AVAILABILITY determination into an honest,
// per-line allocation plan. No Firestore/firebase-functions imports.
//
// AUTHORITY BOUNDARY (Owner §5): Sales REQUESTS/observes fulfillment; it is NOT the authority over inventory.
// Therefore this projection CONSUMES an availability determination — it does not compute inventory truth. The
// availability determination is produced by the canonical Inventory/Equipment authorities (a later trusted
// command supplies it via Admin-SDK reads); this module never trusts a client-supplied availability.
//
// Availability vocabulary mirrors the readiness model (KNOWN quantity / UNKNOWN / UNAVAILABLE) so the whole
// platform speaks one language: an unknown source ⇒ UNKNOWN (never silently "0"); a known-zero from an
// available source ⇒ BACKORDERED; a source that reports the item unavailable ⇒ UNAVAILABLE.

export const ALLOCATION_STATES = ["ALLOCATED", "PARTIAL", "BACKORDERED", "UNAVAILABLE", "UNKNOWN"] as const;
export type AllocationState = (typeof ALLOCATION_STATES)[number];

// Availability for one product ref, as determined by the canonical authority (injected, never client-trusted):
//   { kind: "KNOWN", quantity }  — a known available quantity (>= 0)
//   { kind: "UNAVAILABLE" }      — the source reports this item cannot be sourced
//   { kind: "UNKNOWN" }          — no determination available (do not assume 0)
export type Availability =
  | { kind: "KNOWN"; quantity: number }
  | { kind: "UNAVAILABLE" }
  | { kind: "UNKNOWN" };

export interface SalesOrderLineLike {
  kind: string;
  ref: string;
  orderedQty: number;
  allocatedQty?: number;
  fulfilledQty?: number;
}

export interface LineAllocation {
  ref: string;
  kind: string;
  requestedQty: number; // remaining-to-allocate = orderedQty - already-allocated
  allocatableQty: number; // how much this determination can allocate now
  shortfallQty: number; // requested - allocatable
  state: AllocationState;
}

const int0 = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

// Allocate one line against its availability determination. `requestedQty` is what still needs allocating
// (orderedQty minus what's already allocated). Never allocates more than requested or more than available.
export function allocateLine(line: SalesOrderLineLike, availability: Availability): LineAllocation {
  const requestedQty = Math.max(0, line.orderedQty - int0(line.allocatedQty));
  const base = { ref: line.ref, kind: line.kind, requestedQty };
  if (requestedQty === 0) {
    return { ...base, allocatableQty: 0, shortfallQty: 0, state: "ALLOCATED" };
  }
  if (!availability || availability.kind === "UNKNOWN") {
    return { ...base, allocatableQty: 0, shortfallQty: requestedQty, state: "UNKNOWN" };
  }
  if (availability.kind === "UNAVAILABLE") {
    return { ...base, allocatableQty: 0, shortfallQty: requestedQty, state: "UNAVAILABLE" };
  }
  const available = Math.max(0, availability.quantity);
  const allocatableQty = Math.min(requestedQty, available);
  const shortfallQty = requestedQty - allocatableQty;
  const state: AllocationState = allocatableQty === requestedQty ? "ALLOCATED" : allocatableQty > 0 ? "PARTIAL" : "BACKORDERED";
  return { ...base, allocatableQty, shortfallQty, state };
}

// Overall fulfillment readiness for the order — the honest rollup. Worst-known state wins so a single
// unavailable/unknown line does not read as "ready". UNKNOWN outranks nothing except READY (we cannot claim
// readiness we haven't determined); UNAVAILABLE/BACKORDERED/PARTIAL are all attention states.
export type FulfillmentReadiness = "READY" | "PARTIAL" | "BLOCKED" | "UNKNOWN";

export interface AllocationPlan {
  lines: LineAllocation[];
  readiness: FulfillmentReadiness;
  counts: Record<AllocationState, number>;
}

// Two or more Sales Order lines can share the same `ref` (site-work
// allocatesalesorder-duplicate-ref-lines-double-allocate): `availabilityByRef` carries ONE pool per ref, but
// each sibling line must draw down that SAME pool rather than each seeing the full undiminished figure. For a
// KNOWN pool we track a running remaining-quantity per ref and decrement it by exactly what each line in turn
// allocates, so total allocatableQty across sibling lines never exceeds that ref's available-to-promise.
// UNAVAILABLE/UNKNOWN determinations have no quantity to share and are applied to every sibling line as-is.
export function buildAllocationPlan(lines: SalesOrderLineLike[], availabilityByRef: Record<string, Availability>): AllocationPlan {
  const remainingByKindRef: Record<string, number> = {};
  const allocations = (Array.isArray(lines) ? lines : []).map((l) => {
    const key = `${l.kind}:${l.ref}`;
    const avail = availabilityByRef[key] ?? availabilityByRef[l.ref] ?? { kind: "UNKNOWN" };
    let effectiveAvail: Availability = avail;
    if (avail.kind === "KNOWN" && l.kind !== "SERVICE") {
      if (!(key in remainingByKindRef)) remainingByKindRef[key] = avail.quantity;
      effectiveAvail = { kind: "KNOWN", quantity: remainingByKindRef[key] };
    }
    const a = allocateLine(l, effectiveAvail);
    if (avail.kind === "KNOWN" && l.kind !== "SERVICE") remainingByKindRef[key] = Math.max(0, remainingByKindRef[key] - a.allocatableQty);
    return a;
  });
  const counts: Record<AllocationState, number> = { ALLOCATED: 0, PARTIAL: 0, BACKORDERED: 0, UNAVAILABLE: 0, UNKNOWN: 0 };
  for (const a of allocations) counts[a.state] += 1;
  let readiness: FulfillmentReadiness;
  if (allocations.length === 0) readiness = "UNKNOWN";
  else if (counts.UNAVAILABLE > 0 || counts.BACKORDERED > 0) readiness = "BLOCKED";
  else if (counts.UNKNOWN > 0) readiness = "UNKNOWN";
  else if (counts.PARTIAL > 0) readiness = "PARTIAL";
  else readiness = "READY";
  return { lines: allocations, readiness, counts };
}
