// Fulfillment — governed `allocateSalesOrder` command (Cycle 5 live). Computes AUTHORITATIVE availability from
// canonical read-only sources and records allocation ENTIRELY on the Sales Order (allocatedQty [+ selected
// serials]) inside a transaction — non-forking: no write to the WO-keyed inventory ledger or the Equipment
// authority; other active Sales Orders' commitments are netted so the same on-hand/serial is never
// double-allocated (SO-vs-SO races prevented by re-reading commitments in the transaction).
//
// Authorization = capability `salesOrder.fulfill`, resolved fail-closed via the trusted effective-access feed;
// registered active:false ⇒ DENY for everyone until a separate Owner grant. EXPORT != DEPLOY, REGISTER != GRANT.
//
// PARTS availability (Owner-ratified): eligible ON_HAND (stock_locations at status==ACTIVE warehouses) − open
// WO reservations (inventory_transactions RESERVED−RELEASED−CONSUMED) − other active SO allocations. Missing
// on-hand evidence ⇒ UNKNOWN (never 0). SERVICE lines need no inventory ⇒ always allocatable.
//
// SERIALIZED EQUIPMENT availability is deliberately UNKNOWN / fail-closed in this slice: per Owner §3 a serial
// is allocatable only once EOS can establish company control + eligible location + operational eligibility +
// no active SO allocation + not installed/customer-custody + no active temporary-placement/loaner conflict.
// That equipment-availability CONTRACT (a confident read over the canonical `equipment` authority + the #12
// temporary-placement conflict seam) is the next slice; until it exists, equipment ⇒ UNKNOWN, fail closed.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue, type Transaction } from "firebase-admin/firestore";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed";
import { SALES_ORDERS_COLLECTION, WAREHOUSES_COLLECTION, STOCK_LOCATIONS_COLLECTION, INVENTORY_TRANSACTIONS_COLLECTION } from "../constants/collections";
import { buildAllocationPlan, type Availability } from "./allocationProjection";
import { computePartAvailability, openWorkOrderReserved, sumOtherSoCommitments } from "./fulfillmentAvailability";

export const SALES_ORDER_FULFILL_CAPABILITY = "salesOrder.fulfill";

const ACTIVE_SO_STATES = ["CONFIRMED", "IN_FULFILLMENT"] as const;

async function requireFulfill(uid: string): Promise<void> {
  let allowed = false;
  try {
    const { decisions } = await resolveEffectiveAccess({ principalUid: uid, permissionIds: [SALES_ORDER_FULFILL_CAPABILITY] });
    allowed = decisions[SALES_ORDER_FULFILL_CAPABILITY] === true;
  } catch {
    allowed = false;
  }
  if (!allowed) throw new HttpsError("permission-denied", "You are not authorized to allocate Sales Orders.");
}

interface SoLine {
  kind: string;
  ref: string;
  orderedQty: number;
  allocatedQty?: number;
  fulfilledQty?: number;
  selectedSerialIds?: string[];
}

// Read the eligible ON_HAND for a part: sum stock_locations.quantity for partId at eligible (status==ACTIVE)
// warehouses. Returns null (UNKNOWN) if the read yields no usable evidence. All reads via the transaction.
async function readPartOnHand(tx: Transaction, ref: string, eligibleWarehouseIds: Set<string>): Promise<number | null> {
  const db = getFirestore();
  const snap = await tx.get(db.collection(STOCK_LOCATIONS_COLLECTION).where("partId", "==", ref));
  if (snap.empty) return null; // no stock-location evidence for this part ⇒ UNKNOWN, not 0
  let onHand = 0;
  let sawEligible = false;
  for (const d of snap.docs) {
    const data = d.data() as { warehouseId?: string; quantity?: number };
    if (typeof data.warehouseId === "string" && eligibleWarehouseIds.has(data.warehouseId)) {
      sawEligible = true;
      if (typeof data.quantity === "number" && Number.isFinite(data.quantity)) onHand += Math.max(0, data.quantity);
    }
  }
  return sawEligible ? onHand : 0; // stock exists but none at an eligible ACTIVE warehouse ⇒ known 0 (backorder)
}

async function readOpenWoReserved(tx: Transaction, ref: string): Promise<number> {
  const db = getFirestore();
  const snap = await tx.get(db.collection(INVENTORY_TRANSACTIONS_COLLECTION).where("partId", "==", ref));
  return openWorkOrderReserved(snap.docs.map((d) => d.data() as { type: string; quantity: number }));
}

export const allocateSalesOrder = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
  await requireFulfill(request.auth.uid);

  const salesOrderId = (request.data as { salesOrderId?: string })?.salesOrderId;
  if (typeof salesOrderId !== "string" || salesOrderId.trim().length === 0) {
    throw new HttpsError("invalid-argument", "salesOrderId is required.");
  }

  const db = getFirestore();
  const soRef = db.collection(SALES_ORDERS_COLLECTION).doc(salesOrderId);

  try {
    const result = await db.runTransaction(async (tx) => {
      // ---- READS (all before any write) ----
      const soSnap = await tx.get(soRef);
      if (!soSnap.exists) throw new HttpsError("not-found", `No Sales Order with id ${salesOrderId}`);
      const so = soSnap.data() as { state?: string; lines?: SoLine[] };
      if (so.state !== "CONFIRMED" && so.state !== "IN_FULFILLMENT") {
        throw new HttpsError("failed-precondition", `Sales Order is ${so.state}; only CONFIRMED/IN_FULFILLMENT can be allocated.`);
      }
      const lines = Array.isArray(so.lines) ? so.lines : [];

      // Eligible ON_HAND pool = status==ACTIVE warehouses (trucks/mobile/customer are separate collections and
      // are naturally excluded from stock_locations).
      const whSnap = await tx.get(db.collection(WAREHOUSES_COLLECTION).where("status", "==", "ACTIVE"));
      const eligibleWarehouseIds = new Set(whSnap.docs.map((d) => d.id));

      // Other active Sales Orders' commitments (netted so we never double-allocate).
      const otherSoSnap = await tx.get(db.collection(SALES_ORDERS_COLLECTION).where("state", "in", [...ACTIVE_SO_STATES]));
      const otherSoLines: SoLine[] = [];
      for (const d of otherSoSnap.docs) {
        if (d.id === salesOrderId) continue;
        const data = d.data() as { lines?: SoLine[] };
        if (Array.isArray(data.lines)) otherSoLines.push(...data.lines);
      }

      // Availability per distinct ref.
      const availabilityByRef: Record<string, Availability> = {};
      const distinctPartRefs = [...new Set(lines.filter((l) => l.kind === "PART").map((l) => l.ref))];
      const distinctEquipRefs = [...new Set(lines.filter((l) => l.kind === "EQUIPMENT_MODEL").map((l) => l.ref))];
      for (const ref of distinctPartRefs) {
        const onHandEligible = await readPartOnHand(tx, ref, eligibleWarehouseIds);
        const openWoReserved = onHandEligible === null ? 0 : await readOpenWoReserved(tx, ref);
        const other = sumOtherSoCommitments(otherSoLines, ref);
        availabilityByRef[ref] = computePartAvailability({ onHandEligible, openWoReserved, otherSoAllocated: other.allocatedQty });
      }
      // Equipment availability is fail-closed UNKNOWN this slice (see file header / design doc).
      for (const ref of distinctEquipRefs) availabilityByRef[ref] = { kind: "UNKNOWN" };

      // SERVICE lines need no inventory ⇒ treat as fully available.
      const planLines = lines.map((l) =>
        l.kind === "SERVICE" ? { ...l, __availability: { kind: "KNOWN", quantity: l.orderedQty } as Availability } : l
      );
      const plan = buildAllocationPlan(
        planLines,
        Object.fromEntries(planLines.map((l) => [l.ref, (l as { __availability?: Availability }).__availability ?? availabilityByRef[l.ref] ?? { kind: "UNKNOWN" }]))
      );

      // ---- WRITE (only the Sales Order; allocation is a commitment on the SO, netted by future ATP) ----
      const nextLines = lines.map((l) => {
        const alloc = plan.lines.find((p) => p.ref === l.ref && p.kind === l.kind);
        const already = typeof l.allocatedQty === "number" ? l.allocatedQty : 0;
        return alloc ? { ...l, allocatedQty: already + alloc.allocatableQty } : l;
      });
      tx.update(soRef, {
        lines: nextLines,
        fulfillmentReadiness: plan.readiness,
        fulfillmentReadinessCounts: plan.counts,
        allocatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { readiness: plan.readiness, counts: plan.counts };
    });
    return { success: true as const, salesOrderId, ...result };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    throw new HttpsError("internal", "Allocation failed.");
  }
});
