// Epic 2D Inventory Trigger System (see docs/architecture/ADR-003).
//
// Backend-only, ledger-based inventory side effects driven by Work
// Order state transitions -- a deterministic ledger mutation layer
// tied to Work Orders, not a workflow/staging system. Exactly 3
// primitives exist: reserveParts/releaseParts/consumeParts. No
// intermediate "confirmed on site"/"prepared for consumption" stages
// -- those aren't part of system truth (see STATE_TRIGGERS below).
//
// Truth boundary (load-bearing, don't blur this):
// - data/partsCatalog.ts is METADATA ONLY -- name/category/unit. It has NO stock authority, is
//   never written to, and as of DECISIONS #165 its static `warehouseQty` NO LONGER PARTICIPATES IN
//   ANY OPERATIONAL AVAILABILITY DECISION. It used to be the baseline this file's
//   getAvailableQuantity() added the ledger to, which meant a fixture number decided whether a real
//   Work Order dispatch succeeded -- against the same catalogue whose own header says
//   "NO STOCK AUTHORITY", and against the figure ND-25 ruled non-authoritative for display.
// - inventory_transactions (this file's ledger) is the ONLY source of truth for stock movement AND
//   for commitment. No mutable "current stock" document exists anywhere -- availability is always
//   computed by summing this append-only ledger (see getAvailableQuantity() below), consistent with
//   this project's "derive aggregates on read, never cache a second mutable total" default
//   (docs/architecture/ADR-001-retired-operational-core-branch.md).
//
// ONE ON-HAND, AND ONE COMMITMENT POOL IT CAN SEE (DECISIONS #165, PARTIAL).
//
// LANDED: this file and the Sales Order path now derive physical on-hand from the SAME function
// (sumLedgerEligibleOnHand) over the same eligible warehouses, so they can no longer disagree about
// how much stock exists. Availability here nets EVERY commitment in this ledger regardless of which
// demand family wrote it -- so the moment Sales Order commitments become ledger events, a Work
// Order dispatch sees them with no further change to this file.
//
// NOT LANDED, AND DELIBERATELY SO: Sales Order commitments are still sales_orders.lines[].
// allocatedQty rather than ledger events, so the pool is not yet literally shared. Completing that
// is blocked on a defect this unification surfaced -- NOTHING REMOVES CONSUMED STOCK FROM PHYSICAL
// ON-HAND (see openCommitment() below), which must be ruled before a second demand family starts
// writing commitments here. Until then salesOrder.fulfill stays inactive, which is what keeps the
// over-commit path latent rather than live.
//
// This file NEVER writes to fieldops_wos and NEVER touches Work Order
// state -- it is called strictly AFTER a Work Order transition has
// already committed (see transitionWorkOrder.ts's post-commit call to
// triggerInventoryEffects()), and a failure here never rolls back or
// blocks that already-successful transition.
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import type { Transaction } from "firebase-admin/firestore";
import {
  WORK_ORDERS_COLLECTION,
  INVENTORY_TRANSACTIONS_COLLECTION,
  INVENTORY_SYNC_STATUS_COLLECTION,
  WAREHOUSES_COLLECTION,
} from "./constants/collections";
// The ONE on-hand and ONE commitment derivation, shared with the Sales Order path so the two
// families cannot drift into disagreeing about the same physical stock (DECISIONS #165).
import { sumLedgerEligibleOnHand } from "./fulfillment/fulfillmentAvailability";
import type { WorkOrder, WorkOrderStatus } from "./types/workOrder";
import type { InventoryTransaction, InventorySyncStatus } from "./types/inventoryTransaction";

const db = () => getFirestore();
const RESERVATION_LOCKS_COLLECTION = "inventory_reservation_locks";

// A per-part transaction sentinel serializes reservation attempts for that
// part. The ledger remains the stock authority: this document contains no
// quantity and is never read for availability. It is deliberately read and
// written in the same transaction so a competing reserve invalidates the
// transaction's ledger query result and forces Firestore to retry it.
const reservationLockRef = (partId: string) => db().collection(RESERVATION_LOCKS_COLLECTION).doc(partId);

// sumGovernedLedger() WAS HERE, and is deleted (DECISIONS #165).
//
// It was a second on-hand derivation: quantity-summed across ALL locations, with no notion of
// warehouse eligibility, feeding a formula that also added the static catalogue baseline. Its whole
// job is now done by sumLedgerEligibleOnHand(), which additionally distinguishes warehouse from
// truck stock and returns UNKNOWN instead of a confident zero. Two functions answering "how much is
// there" is exactly the duplication this unification exists to remove, so the redundant one goes
// rather than lingering for a future caller to pick up.
//
// Its H7/H7b coverage (SERIAL rows excluded from quantity math; RETURNED/SCRAPPED counted) was not
// lost: test/woAvailabilityGovernedLedger.test.mjs was RETARGETED onto sumLedgerEligibleOnHand,
// which had no direct coverage of those cases before.

/**
 * THE ONE OPERATIONAL AVAILABILITY ANSWER — `null` means UNKNOWN, and UNKNOWN is not zero.
 *
 * available = eligible physical on-hand − every open commitment
 *
 * BOTH HALVES ARE THE CANONICAL SHARED DERIVATIONS, not a second opinion:
 *   `sumLedgerEligibleOnHand`  physical stock at status==ACTIVE warehouses (Owner-ratified
 *                              2026-08-07, ledger amendment 2026-08-17). MOBILE/truck stock is
 *                              deliberately excluded — it is real inventory, but it is not
 *                              sellable/committable warehouse stock, and conflating the two is
 *                              how a van's contents get promised to a second job.
 *   `openCommitment` (below)   RESERVED − RELEASED over the SAME rows. Source-agnostic: it nets
 *                              EVERY claim in the ledger regardless of which demand family raised
 *                              it. No exclusion set is applied — a Work Order must respect every
 *                              claim on the stock, including ones raised by the Sales Order it
 *                              belongs to.
 *
 * WHAT CHANGED AND WHY (DECISIONS #165). This used to be
 * `staticCatalogWarehouseQty + governedLedgerAcrossAllLocations − netReserved`. Two defects in one
 * line: a fixture quantity decided real dispatches, and "all locations" counted truck stock as
 * committable. Both are gone. CONSUMED is still not subtracted twice — it converts an existing
 * reservation into a permanent removal, and that quantity left availability when it was RESERVED;
 * `openCommitment` below encodes exactly that, and its docblock explains why it cannot simply be
 * `openWorkOrderReserved`.
 *
 * UNKNOWN IS RETURNED, NEVER COERCED. `sumLedgerEligibleOnHand` returns null when a part has no
 * physical movement evidence at all — a data gap, which is a different fact from an empty shelf
 * (evidence that nets to 0). Callers must fail closed on null rather than read it as "none
 * available" or "plenty available"; both are claims the evidence does not support.
 */
async function getAvailableQuantity(tx: Transaction, partId: string): Promise<number | null> {
  const whSnap = await tx.get(db().collection(WAREHOUSES_COLLECTION).where("status", "==", "ACTIVE"));
  const eligibleWarehouseIds = new Set(whSnap.docs.map((d) => d.id));

  const snap = await tx.get(db().collection(INVENTORY_TRANSACTIONS_COLLECTION).where("partId", "==", partId));
  const rows = snap.docs.map((doc) => doc.data() as InventoryTransaction);

  const onHand = sumLedgerEligibleOnHand(rows, eligibleWarehouseIds);
  if (onHand === null) return null; // UNKNOWN — no physical evidence for this part anywhere.
  return Math.max(0, onHand - openCommitment(rows));
}

/**
 * Open commitment against a part: RESERVED − RELEASED. Source-agnostic, floored at 0.
 *
 * WHY THIS IS NOT `openWorkOrderReserved`, WHICH ALSO SUBTRACTS CONSUMED.
 *
 * Nothing in this platform removes consumed stock from physical on-hand. `sumLedgerEligibleOnHand`
 * counts RECEIVED / TRANSFER_IN / TRANSFER_OUT / ADJUSTED / RETURNED / SCRAPPED; CONSUMED is not a
 * physical movement type and legacy commitment rows carry no `location`, so a consumption is
 * invisible to it. On-hand therefore never drops when parts are fitted to a machine.
 *
 * This file has always compensated, which is what its long-standing "CONSUMED is deliberately NOT
 * subtracted" invariant is for: the consumed quantity stays counted as committed, so it stays out
 * of availability. Wrong reason, right number.
 *
 * `openWorkOrderReserved` does subtract CONSUMED, and does not compensate — so the Sales Order
 * path currently reports 5 available after 5 were received and 2 consumed, when 3 physically
 * remain. That is a REAL PRE-EXISTING OVER-AVAILABILITY DEFECT in a ratified derivation, proven in
 * `inventoryConsumptionOnHandGap.test.mjs`, and it is NOT fixed here: the fix is either a physical
 * removal movement at consumption or a change to that ratified derivation, both of which are
 * inventory-semantics decisions this package is not authorised to make (DECISIONS #165 records it
 * as the blocking open question).
 *
 * Adopting `openWorkOrderReserved` here would have imported that defect into the live Work Order
 * dispatch path — conjuring consumed stock back into availability. So the unification takes the
 * ONE on-hand source (the real convergence) and keeps this file's correct commitment arithmetic
 * until consumption is ruled.
 */
function openCommitment(rows: Array<{ type: string; quantity: number }>): number {
  let committed = 0;
  for (const r of rows) {
    const q = typeof r.quantity === "number" && Number.isFinite(r.quantity) && r.quantity > 0 ? r.quantity : 0;
    if (r.type === "RESERVED") committed += q;
    else if (r.type === "RELEASED") committed -= q;
  }
  return Math.max(0, committed);
}

// Outstanding (still-active) reservation for one Work Order + part --
// grossReserved - released - consumed, scoped to this WO only. Used by
// releaseParts()/consumeParts() to know how much is left to act on for
// this specific WO (as opposed to getAvailableQuantity(), which is
// warehouse-wide across all Work Orders).
async function getOutstandingReservation(
  tx: Transaction,
  workOrderId: string,
  partId: string
): Promise<number> {
  const snap = await tx.get(
    db()
      .collection(INVENTORY_TRANSACTIONS_COLLECTION)
      .where("workOrderId", "==", workOrderId)
      .where("partId", "==", partId)
  );
  let reserved = 0;
  let released = 0;
  let consumed = 0;
  snap.forEach((doc) => {
    const t = doc.data() as InventoryTransaction;
    if (t.type === "RESERVED") reserved += t.quantity;
    else if (t.type === "RELEASED") released += t.quantity;
    else if (t.type === "CONSUMED") consumed += t.quantity;
  });
  return reserved - released - consumed;
}

function writeLedgerEntry(
  tx: Transaction,
  entry: Omit<InventoryTransaction, "id" | "timestamp">
): void {
  const ref = db().collection(INVENTORY_TRANSACTIONS_COLLECTION).doc();
  tx.set(ref, { ...entry, timestamp: FieldValue.serverTimestamp() });
}

async function getWorkOrderInventorySnapshot(
  tx: Transaction,
  workOrderId: string
): Promise<Array<{ sku: string; qtyPlanned: number; qtyUsed?: number }>> {
  const snap = await tx.get(db().collection(WORK_ORDERS_COLLECTION).doc(workOrderId));
  if (!snap.exists) throw new Error(`No Work Order with id ${workOrderId}`);
  const wo = snap.data() as WorkOrder;
  return (wo.inventorySnapshot ?? [])
    .filter((item) => (item.qtyPlanned ?? 0) > 0)
    .map((item) => ({ sku: item.sku, qtyPlanned: item.qtyPlanned as number, qtyUsed: item.qtyUsed }));
}

// DISPATCHED trigger. All-or-nothing: if ANY planned part lacks enough
// available quantity, the whole transaction aborts (atomic -- no
// partial reservations ever land), and the caller (triggerInventoryEffects)
// records this as a failure for later retry rather than a Work Order
// state rollback (the Work Order stays DISPATCHED regardless -- see
// this epic's failure model).
export async function reserveParts(workOrderId: string): Promise<void> {
  await db().runTransaction(async (tx) => {
    const items = await getWorkOrderInventorySnapshot(tx, workOrderId);
    if (items.length === 0) return;

    // A WO's inventorySnapshot can carry more than one row for the same sku
    // (e.g. two duplicate-ref PART SO lines) -- a supported scenario. Sum
    // qtyPlanned per sku FIRST so the availability/insufficiency check and
    // the resulting ledger write are sized against the sku's TOTAL demand,
    // not evaluated per-row against the same un-decremented availability
    // figure (which would let each row separately pass and together
    // over-reserve past what's actually on hand).
    const plannedBySku = new Map<string, number>();
    for (const item of items) {
      plannedBySku.set(item.sku, (plannedBySku.get(item.sku) ?? 0) + item.qtyPlanned);
    }

    const availabilityByPart = new Map<string, number | null>();
    for (const sku of plannedBySku.keys()) {
      availabilityByPart.set(sku, await getAvailableQuantity(tx, sku));
    }
    // Firestore requires every transaction read before its first write.
    const locks = [...plannedBySku.keys()].map(reservationLockRef);
    await Promise.all(locks.map((ref) => tx.get(ref)));
    for (const ref of locks) tx.set(ref, { partId: ref.id, touchedAt: FieldValue.serverTimestamp() }, { merge: true });

    // UNKNOWN AND INSUFFICIENT ARE DIFFERENT REFUSALS, and they are reported separately.
    // "no evidence this part exists anywhere" is a data gap an operator fixes by receiving or
    // counting stock; "3 available, 5 needed" is a real shortage. Collapsing them into one message
    // would send someone hunting for stock that was never recorded. Both still fail closed, and
    // both still abort the WHOLE transaction — no partial reservation may land.
    const unknown: string[] = [];
    const insufficient: string[] = [];
    for (const [sku, totalPlanned] of plannedBySku) {
      const available = availabilityByPart.get(sku);
      if (available === null || available === undefined) {
        unknown.push(sku);
      } else if (totalPlanned > available) {
        insufficient.push(`${sku} (need ${totalPlanned}, ${available} available)`);
      }
    }
    if (unknown.length > 0) {
      throw new Error(
        `Unknown stock: no governed inventory evidence for ${unknown.join(", ")} — ` +
          `availability is UNKNOWN, which is not zero and not permission to commit`,
      );
    }
    if (insufficient.length > 0) {
      throw new Error(`Insufficient stock: ${insufficient.join("; ")}`);
    }

    for (const [sku, totalPlanned] of plannedBySku) {
      writeLedgerEntry(tx, { workOrderId, partId: sku, type: "RESERVED", quantity: totalPlanned });
    }
  });
}

/**
 * Every still-outstanding reservation this Work Order holds, keyed by part: RESERVED − RELEASED −
 * CONSUMED, per part, scoped to this WO.
 *
 * READ FROM THE LEDGER, NOT FROM THE PLAN. This is the difference that closes the orphan gap: a
 * requirement deleted from `inventorySnapshot` still has ledger entries, so a plan-driven loop
 * cannot see the reservation it left behind. The ledger can.
 */
async function outstandingByPart(tx: Transaction, workOrderId: string): Promise<Map<string, number>> {
  const snap = await tx.get(
    db().collection(INVENTORY_TRANSACTIONS_COLLECTION).where("workOrderId", "==", workOrderId),
  );
  const byPart = new Map<string, number>();
  snap.forEach((doc) => {
    const t = doc.data() as InventoryTransaction;
    const current = byPart.get(t.partId) ?? 0;
    if (t.type === "RESERVED") byPart.set(t.partId, current + t.quantity);
    else if (t.type === "RELEASED" || t.type === "CONSUMED") byPart.set(t.partId, current - t.quantity);
  });
  return byPart;
}

// CANCELLED trigger. Releases whatever is still outstanding for this WO, per part.
//
// ORPHAN FIX (DECISIONS #165): this used to iterate the CURRENT inventorySnapshot, so a requirement
// REMOVED from the plan after dispatch kept its reservation forever — the loop had nothing to
// iterate for it. It now iterates the LEDGER's outstanding-by-part instead, which is the record of
// what was actually committed rather than what is currently planned. Still safe to call when
// nothing was ever reserved: the map is empty and no entry is written.
export async function releaseParts(workOrderId: string): Promise<void> {
  await db().runTransaction(async (tx) => {
    const outstanding = await outstandingByPart(tx, workOrderId);
    for (const [partId, quantity] of outstanding) {
      if (quantity > 0) {
        writeLedgerEntry(tx, { workOrderId, partId, type: "RELEASED", quantity });
      }
    }
  });
}

/**
 * RESERVATION FOLLOWS CURRENT DEMAND (DECISIONS #165, ruling 3).
 *
 * A reservation made at DISPATCH used to be frozen at that moment's `qtyPlanned`. Change the plan
 * afterwards and the commitment stayed stale until a terminal state repaired it: a decrease left
 * stock over-committed and invisible to everyone else, an increase left it under-committed, and a
 * removed requirement orphaned its reservation entirely.
 *
 * This reconciles the ledger to the CURRENT plan, per part, in ONE transaction:
 *   target > outstanding → reserve only the positive DELTA (never re-reserve the whole line)
 *   target < outstanding → release exactly the excess
 *   part no longer planned → release everything outstanding for it
 *
 * ALL-OR-NOTHING IS PRESERVED for the newly-requested part: if any delta cannot be covered, the
 * whole transaction aborts and NO adjustment lands — the same rule reserveParts() already applies,
 * for the same reason. Releases are not gated on availability (giving stock back always succeeds).
 *
 * CALLED ONLY WHEN A COMMITMENT ALREADY EXISTS. Before dispatch there is nothing to reconcile and
 * planning must stay free of inventory side effects — PLAN PARTS != RESERVE PARTS. The caller
 * decides that; this function does not reserve for an un-dispatched Work Order because such a WO
 * has no outstanding reservation and no target above zero to chase... which is exactly why the
 * caller must gate it, and does.
 */
export async function reconcileReservation(workOrderId: string): Promise<void> {
  await db().runTransaction(async (tx) => {
    const items = await getWorkOrderInventorySnapshot(tx, workOrderId);
    const target = new Map<string, number>();
    for (const item of items) target.set(item.sku, (target.get(item.sku) ?? 0) + item.qtyPlanned);

    const outstanding = await outstandingByPart(tx, workOrderId);
    // The union: parts currently planned, plus parts that hold a reservation and no longer are.
    const parts = new Set<string>([...target.keys(), ...outstanding.keys()]);

    const increases = new Map<string, number>();
    const decreases = new Map<string, number>();
    for (const partId of parts) {
      const delta = (target.get(partId) ?? 0) - Math.max(0, outstanding.get(partId) ?? 0);
      if (delta > 0) increases.set(partId, delta);
      else if (delta < 0) decreases.set(partId, -delta);
    }
    if (increases.size === 0 && decreases.size === 0) return;

    // Reads before writes, and availability only for parts we intend to commit more of.
    const availability = new Map<string, number | null>();
    for (const partId of increases.keys()) availability.set(partId, await getAvailableQuantity(tx, partId));

    const locks = [...new Set([...increases.keys(), ...decreases.keys()])].map(reservationLockRef);
    await Promise.all(locks.map((ref) => tx.get(ref)));

    const unknown: string[] = [];
    const insufficient: string[] = [];
    for (const [partId, delta] of increases) {
      const available = availability.get(partId);
      if (available === null || available === undefined) unknown.push(partId);
      else if (delta > available) insufficient.push(`${partId} (need ${delta} more, ${available} available)`);
    }
    if (unknown.length > 0) {
      throw new Error(
        `Unknown stock: no governed inventory evidence for ${unknown.join(", ")} — ` +
          `availability is UNKNOWN, which is not zero and not permission to commit`,
      );
    }
    if (insufficient.length > 0) {
      throw new Error(`Insufficient stock: ${insufficient.join("; ")}`);
    }

    for (const ref of locks) tx.set(ref, { partId: ref.id, touchedAt: FieldValue.serverTimestamp() }, { merge: true });
    for (const [partId, delta] of increases) {
      writeLedgerEntry(tx, { workOrderId, partId, type: "RESERVED", quantity: delta });
    }
    for (const [partId, delta] of decreases) {
      writeLedgerEntry(tx, { workOrderId, partId, type: "RELEASED", quantity: delta });
    }
  });
}

/** True once this Work Order's DISPATCHED commitment has actually been applied. */
export async function hasAppliedReservation(workOrderId: string): Promise<boolean> {
  const snap = await db().collection(INVENTORY_SYNC_STATUS_COLLECTION).doc(workOrderId).get();
  if (!snap.exists) return false;
  const status = snap.data() as InventorySyncStatus | undefined;
  return status?.processedStates?.DISPATCHED === true;
}

// COMPLETED trigger. Consumes the governed ACTUAL usage (qtyUsed --
// InventorySnapshotItem's field, see types/workOrder.ts), populated by
// updateWorkOrderExecutionData() (PartsScanner/ExecutionCapture) via
// mergeQtyUsed(), which clamps it to [0, qtyPlanned]. Falls back to
// qtyPlanned only when qtyUsed hasn't been recorded yet (preserves the
// pre-actuals behavior for WOs with no field usage data). The repair
// step still tops up the reservation to qtyPlanned first (so
// getOutstandingReservation() ends up exactly qtyPlanned per item),
// then consumes actual usage and RELEASES the remainder
// (qtyPlanned - actual) so no reservation is left stranded -- see
// Sales->Cash Lifecycle Build Plan P0.1. Because mergeQtyUsed() clamps
// qtyUsed <= qtyPlanned, actual usage can never exceed qtyPlanned here;
// the governed overage/additional-part path (used > planned) is a
// separate build (P1), not handled by this function. Validates each
// part's outstanding reservation actually covers qtyPlanned; throws
// (whole transaction aborts) rather than silently over-consuming if not.
export async function consumeParts(workOrderId: string): Promise<void> {
  await db().runTransaction(async (tx) => {
    const items = await getWorkOrderInventorySnapshot(tx, workOrderId);
    if (items.length === 0) return;

    const outstandingByPart = new Map<string, number>();
    for (const item of items) {
      outstandingByPart.set(item.sku, await getOutstandingReservation(tx, workOrderId, item.sku));
    }
    const availableByPart = new Map<string, number | null>();
    for (const item of items) {
      availableByPart.set(item.sku, await getAvailableQuantity(tx, item.sku));
    }
    const locks = [...new Set(items.map((item) => item.sku))].map(reservationLockRef);
    await Promise.all(locks.map((ref) => tx.get(ref)));

    // A top-up only needs availability when there IS a top-up to make. A WO whose reservation
    // already covers qtyPlanned consumes what it holds and never consults availability — so an
    // UNKNOWN part that was legitimately reserved earlier can still be completed. UNKNOWN blocks
    // only the part of consumption that would COMMIT MORE STOCK.
    const shortfalls: string[] = [];
    for (const item of items) {
      const missing = item.qtyPlanned - (outstandingByPart.get(item.sku) ?? 0);
      if (missing <= 0) continue;
      const available = availableByPart.get(item.sku);
      if (available === null || available === undefined) {
        shortfalls.push(`${item.sku} (need ${missing} additional, availability UNKNOWN)`);
      } else if (missing > available) {
        shortfalls.push(`${item.sku} (need ${missing} additional, ${available} available)`);
      }
    }
    if (shortfalls.length > 0) throw new Error(`Cannot consume, reservation shortfall: ${shortfalls.join("; ")}`);

    for (const ref of locks) tx.set(ref, { partId: ref.id, touchedAt: FieldValue.serverTimestamp() }, { merge: true });
    for (const item of items) {
      const missing = item.qtyPlanned - (outstandingByPart.get(item.sku) ?? 0);
      if (missing > 0) writeLedgerEntry(tx, { workOrderId, partId: item.sku, type: "RESERVED", quantity: missing });
    }

    for (const item of items) {
      // Governed actual usage: qtyUsed when recorded (mergeQtyUsed() already
      // clamped it to [0, qtyPlanned]), else fall back to qtyPlanned so a WO
      // with no field-usage data yet behaves exactly as before.
      const actual = item.qtyUsed ?? item.qtyPlanned;
      writeLedgerEntry(tx, { workOrderId, partId: item.sku, type: "CONSUMED", quantity: actual });

      // Release whatever of the (now-repaired-to-qtyPlanned) reservation
      // wasn't actually used, so the unused remainder isn't stranded and
      // available stock reflects real consumption.
      const remainder = item.qtyPlanned - actual;
      if (remainder > 0) {
        writeLedgerEntry(tx, { workOrderId, partId: item.sku, type: "RELEASED", quantity: remainder });
      }
    }
  });
}

// COMPLETED trigger, second step (after consumeParts). Not a ledger
// write -- just marks this Work Order's inventory processing as fully
// wrapped up in inventory_sync_status, for anything that might later
// want to know "is this WO's inventory story fully closed out."
export async function finalizeInventoryTransaction(workOrderId: string): Promise<void> {
  const ref = db().collection(INVENTORY_SYNC_STATUS_COLLECTION).doc(workOrderId);
  await ref.set({ workOrderId, finalized: true }, { merge: true });
}

// Strict mapping, exactly 3 real operations -- no ARRIVED/
// WORK_IN_PROGRESS entries. Those states have no ledger-writeable
// meaning yet (the ledger's type enum is RESERVED/RELEASED/CONSUMED
// only); rather than tracking phantom "confirmed on site"/"prepared
// for consumption" stages with no operational effect,
// triggerInventoryEffects() simply no-ops for any state not listed
// here (see its `if (!trigger) return;` below) -- so ARRIVED/
// WORK_IN_PROGRESS never appear in inventory_sync_status at all,
// rather than appearing as a no-op "processed" entry.
const STATE_TRIGGERS: Partial<Record<WorkOrderStatus, (workOrderId: string) => Promise<void>>> = {
  DISPATCHED: reserveParts,
  COMPLETED: async (workOrderId) => {
    await consumeParts(workOrderId);
    await finalizeInventoryTransaction(workOrderId);
  },
  CANCELLED: releaseParts,
};

// Atomically claims (workOrderId, state) for processing so a state can
// only ever be claimed by one in-flight caller at a time. Mirrors the
// reservationLockRef pattern above: the claim is read and (conditionally)
// written in the same transaction, so a second concurrent call racing the
// first is forced by Firestore to retry its transaction and re-observe
// the first call's write -- it then correctly sees processedStates[state]
// or claims[state] already set and returns false without ever invoking
// the underlying trigger. This is what closes the check-then-act gap
// a plain "read processedStates, later write processedStates" guard
// would otherwise have.
async function claimStateForProcessing(workOrderId: string, state: WorkOrderStatus): Promise<boolean> {
  const ref = db().collection(INVENTORY_SYNC_STATUS_COLLECTION).doc(workOrderId);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const status = snap.data() as InventorySyncStatus | undefined;
    if (status?.processedStates?.[state] === true) return false;
    if (status?.claims?.[state] === true) return false;
    tx.set(ref, { workOrderId, claims: { [state]: true } }, { merge: true });
    return true;
  });
}

// Releases a claim without marking the state processed -- used when the
// trigger fails, so a later retry (a fresh claimStateForProcessing() call)
// is able to claim the state again.
async function clearClaim(workOrderId: string, state: WorkOrderStatus): Promise<void> {
  const ref = db().collection(INVENTORY_SYNC_STATUS_COLLECTION).doc(workOrderId);
  await ref.set({ workOrderId, claims: { [state]: FieldValue.delete() } }, { merge: true });
}

async function markStateProcessed(workOrderId: string, state: WorkOrderStatus): Promise<void> {
  const ref = db().collection(INVENTORY_SYNC_STATUS_COLLECTION).doc(workOrderId);
  await ref.set(
    {
      workOrderId,
      processedStates: { [state]: true },
      // Clear any prior failure for this state now that it succeeded --
      // Firestore's merge:true keeps sibling fields (other states'
      // failures) untouched, only this state's failure key is removed.
      failures: { [state]: FieldValue.delete() },
      // The claim served its purpose (serializing concurrent attempts);
      // once processed, processedStates[state] alone is authoritative.
      claims: { [state]: FieldValue.delete() },
    },
    { merge: true }
  );
}

async function recordFailure(workOrderId: string, state: WorkOrderStatus, error: unknown): Promise<void> {
  const ref = db().collection(INVENTORY_SYNC_STATUS_COLLECTION).doc(workOrderId);
  const message = error instanceof Error ? error.message : String(error);
  await ref.set(
    {
      workOrderId,
      failures: { [state]: { error: message, at: Timestamp.now(), retryNeeded: true } },
    },
    { merge: true }
  );
}

// The single entry point transitionWorkOrder.ts calls after a Work
// Order transition has already committed. Idempotent (skips if this
// state was already processed for this WO) and never throws -- a
// failure is caught, recorded via recordFailure() (retryNeeded: true),
// and swallowed, since the Work Order's own state is already committed
// and must never be affected by an inventory-side failure (see this
// epic's failure model, section 10).
//
// Retrying is simply calling this function again for the same
// (workOrderId, state) -- claimStateForProcessing() will correctly see
// it hasn't succeeded yet (recordFailure() never marks it processed,
// and a failed attempt's own clearClaim() releases the claim) and
// re-attempt the trigger. No cron/background system exists or is
// needed for this (per section 11's "No continuous background system
// required") -- a future manual/admin retry action would just call
// this same function.
//
// The processed-state guard is claimed atomically via
// claimStateForProcessing() (a transactional create-if-absent against
// inventory_sync_status, same pattern as reservationLockRef elsewhere in
// this file) rather than a plain isStateProcessed() read followed by a
// separate markStateProcessed() write. Two concurrent calls for the same
// (workOrderId, state) -- e.g. a live transition-driven call racing an
// operator retry tool -- can no longer both observe "unprocessed" and
// both run the underlying trigger: only one claims it, the loser returns
// immediately without touching the ledger.
export async function triggerInventoryEffects(workOrderId: string, newState: WorkOrderStatus): Promise<void> {
  const trigger = STATE_TRIGGERS[newState];
  if (!trigger) return;

  const claimed = await claimStateForProcessing(workOrderId, newState);
  if (!claimed) return;

  try {
    await trigger(workOrderId);
    await markStateProcessed(workOrderId, newState);
  } catch (err) {
    await recordFailure(workOrderId, newState, err);
    await clearClaim(workOrderId, newState);
  }
}
