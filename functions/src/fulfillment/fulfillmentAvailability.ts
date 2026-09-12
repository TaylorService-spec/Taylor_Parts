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

import { isPhysicalMovementType, resolveCustodyWarehouseId, signedQuantity } from "../inventoryLedger/locationOnHand.js";
import type { BinParentage } from "../inventoryLedger/locationOnHand.js";
import type { Availability } from "./allocationProjection";

const num0 = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

// sumEligibleOnHand() WAS HERE, and is deleted.
//
// It was the SUPERSEDED stock_locations derivation: it read a flat `warehouseId` string off a seeded
// legacy projection that nothing in this platform ever writes, and it had no notion of the typed
// location pair, of Model-A bin custody, of movement sign, or of SERIAL/LOT rows. The Owner-ratified
// amendment of 2026-08-17 replaced it with sumLedgerEligibleOnHand() below, and allocateSalesOrder.ts
// (:69), inventoryService.ts (:121), partBalanceReadService.ts (:144) and inventoryAnalyticsCallables.ts
// (:78) have all read the ledger derivation since.
//
// Nothing in src/ has called it since that amendment. Its ONLY remaining caller was
// test/allocateSalesOrderAllocation.test.mjs -- the gate for this very command -- whose header claimed
// to replay "the production pipeline line for line" while actually replaying the derivation production
// had stopped using. A gate that proves a function no caller runs is worse than no gate: it reports
// green over the untested path. That suite is RETARGETED onto sumLedgerEligibleOnHand (typed
// `location` rows, Model-A `binParentage`, the `${kind}:${ref}` pool key production uses), so its
// coverage is not lost -- it now lands on the code that actually runs.
//
// This is the same disposal DECISIONS #165 applied to inventoryService.ts's sumGovernedLedger(): two
// functions answering "how much is there" is the duplication that ruling exists to remove, so the
// redundant one goes rather than lingering for a future caller to pick up.

// Ledger-derived eligible physical ON_HAND for a part (Owner-ratified 2026-08-17, superseding the
// stock_locations rule).
//
// WHY THIS REPLACED stock_locations. Nothing in the codebase ever WRITES stock_locations -- it is a seeded
// legacy projection -- while Receiving, Transfer and reconciled Cycle Counts all write the append-only
// inventory_transactions ledger. The two could therefore only diverge, and in the sandbox they did, in both
// directions: PRT-1001 held 3 genuinely received units and stock_locations said 0 (a real order was
// BACKORDERED), while PRT-1005 said 40 with nothing ever received (36 units were committed that do not
// exist). An availability source that can both refuse real stock and promise imaginary stock is not an
// authority. Physical stock now comes from the same ledger every other inventory surface already uses.
//
// PHYSICAL ONLY. RESERVED / RELEASED / CONSUMED are LOGICAL commitment events and are deliberately NOT
// counted here -- they are subtracted separately by openWorkOrderReserved(). Counting them here would both
// double-count demand and, worse, treat a commitment as a physical receipt.
//
// WAREHOUSE ELIGIBILITY PRESERVED. Only movements at an eligible (status==ACTIVE) WAREHOUSE location count.
// MOBILE/truck stock is deliberately excluded: it is real inventory, but it is not sellable warehouse stock.
//
// SERIAL-TRACKED ROWS ARE EXCLUDED (H7 fix). A SERIAL-tracked Part's unit count is not aggregable
// quantity math -- each serial is exactly one unit, tracked individually by the serialized_assets
// registry, never by summing ledger quantities. A Cycle Count reconciling a MISSING SERIAL-tracked
// unit writes "ADJUSTED, quantity: 1" (SERIAL quantity is always exactly 1 and cannot carry a negative
// sign), which this function used to sum exactly like a NONE-mode receipt -- discovering a unit
// missing INCREASED its reservable availability. The correct pattern already exists in
// inventoryLedger/mobileLocationPresenceProbe.ts's probeNoneStockPresentAtLocation
// (`if (v.trackingMode !== "NONE") continue;`, "SERIAL custody is authoritative via serialized_assets,
// not via quantity math"); this function follows that precedent for the QUANTITY math specifically. A
// SERIAL/LOT row still counts as "physical movement evidence exists" (sawAnyPhysical/sawEligible) --
// it genuinely is a movement, just not one this function aggregates by quantity -- so an eligible
// warehouse with ONLY SERIAL evidence still resolves to a known 0 (a real, if empty, answer) rather
// than a fabricated UNKNOWN. A row with NO trackingMode field is treated as NONE (included) -- safe
// because trackingMode is a REQUIRED, validated field on every governed operational-movement write
// (operationalMovementValidation.ts's isTrackingMode check), so a row carrying a governed type can
// never legitimately lack it; the default only matters for rows predating the field (never a genuine
// SERIAL row).
//
// RETURNED/SCRAPPED are now summed here too (H7 secondary finding): schema-legal operational movement
// types (RMA / Scrap source objects) that transferOrderCommand.ts, cycleCountExpectedQuantity.ts and
// mobileLocationPresenceProbe.ts already sum, but that this consumer previously omitted entirely.
//
// Returns null (UNKNOWN) when the part has no physical movement evidence at all -- never treated as 0, matching
// the previous contract. Floored at 0 so a malformed ledger can never produce negative sellable stock.
export function sumLedgerEligibleOnHand(
  rows: Array<{ type: string; quantity: number; location?: { type?: string; locationId?: string }; trackingMode?: string }>,
  eligibleWarehouseIds: Set<string>,
  // REQUIRED, deliberately. Under Model A (Decision #160 / ADR-014) a Warehouse holds its direct rows
  // PLUS the rows at every Bin inside it. A caller that forgot to resolve parentage would silently drop
  // all binned stock from availability -- so the compiler, not a code review, finds every caller.
  // Resolve it only for the bins these rows reference (binIdsReferenced), from governed bins documents.
  binParentage: BinParentage,
): number | null {
  // Two distinct facts, exactly as the previous stock_locations contract drew them:
  //   sawAnyPhysical    -- the part has physical movement evidence SOMEWHERE (so 0 is a real answer)
  //   sawEligible       -- some of that movement is in the custody of a sellable warehouse
  // No evidence at all => UNKNOWN. Evidence, but none of it sellable => a known 0 (a real backorder).
  //
  // The sign of each movement comes from inventoryLedger/locationOnHand.ts, the ONE place it is
  // decided. This function used to carry its own copy of that rule; so did four other readers, and
  // three of them never learned WORK_ORDER_CONSUMPTION. One rule, one place.
  let sawAnyPhysical = false;
  let sawEligible = false;
  let onHand = 0;
  for (const r of rows) {
    if (!isPhysicalMovementType(r.type)) continue;
    sawAnyPhysical = true;
    const custody = resolveCustodyWarehouseId(r.location, binParentage);
    if (custody === null || !eligibleWarehouseIds.has(custody)) continue;
    sawEligible = true;
    const isNoneModeQuantity = r.trackingMode === undefined || r.trackingMode === "NONE";
    if (!isNoneModeQuantity) continue; // SERIAL/LOT: evidence counted, quantity excluded (H7)
    onHand += signedQuantity(r);
  }
  if (!sawAnyPhysical) return null;
  return sawEligible ? Math.max(0, onHand) : 0;
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
// IDEMPOTENCY (fix for site-work #1, so-alloc-overallocation-rerun): an SO allocation writes NO ledger
// movement at all, so the ledger-derived on-hand this function is handed is never decremented by it
// (non-forking — allocation lives ONLY on the Sales Order). `otherSoAllocated`
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

// Sum other active Sales Orders' commitments for one (kind, ref) pair: allocatedQty (parts) and selected
// serials (equipment). `otherSoLines` is the flattened set of lines from OTHER active sales_orders.
//
// KIND-SCOPING (fix for site-work cross-kind collision, BD-6/BD-10 successor): a bare `ref` match is not
// enough — PART, EQUIPMENT_MODEL, and SERVICE lines can share the same ref string (e.g. a SERVICE line and a
// PART line both referencing "C713" for unrelated reasons). CX-4 (#956) kind-scoped the pool key in
// allocationProjection.ts (`${kind}:${ref}`) but this netting site still matched on bare ref, so an unrelated
// SERVICE/EQUIPMENT_MODEL commitment sharing a ref string with a PART line would be wrongly subtracted from
// that PART's available-to-promise. A line only nets against other commitments of the SAME kind + ref.
export function sumOtherSoCommitments(
  otherSoLines: Array<{ kind: string; ref: string; allocatedQty?: number; selectedSerialIds?: string[] }>,
  kind: string,
  ref: string
): { allocatedQty: number; selectedSerials: string[] } {
  let allocatedQty = 0;
  const selectedSerials: string[] = [];
  for (const l of otherSoLines) {
    if (l.kind !== kind || l.ref !== ref) continue;
    allocatedQty += num0(l.allocatedQty);
    if (Array.isArray(l.selectedSerialIds)) selectedSerials.push(...l.selectedSerialIds);
  }
  return { allocatedQty, selectedSerials };
}
