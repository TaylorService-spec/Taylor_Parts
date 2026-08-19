// Fulfillment — governed `allocateSalesOrder` command (Cycle 5 live). Computes AUTHORITATIVE availability from
// canonical read-only sources and records allocation ENTIRELY on the Sales Order (allocatedQty [+ selected
// serials]) inside a transaction — non-forking: no write to the WO-keyed inventory ledger or the Equipment
// authority; other active Sales Orders' commitments are netted so the same on-hand/serial is never
// double-allocated (SO-vs-SO races prevented by re-reading commitments in the transaction).
//
// Authorization = capability `salesOrder.fulfill`, resolved fail-closed via the trusted effective-access feed;
// registered active:false ⇒ DENY for everyone until a separate Owner grant. EXPORT != DEPLOY, REGISTER != GRANT.
//
// PARTS availability (Owner-ratified 2026-08-17, superseding the stock_locations rule): ledger-derived
// eligible physical ON_HAND (inventory_transactions at status==ACTIVE warehouses) − open
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
import { SALES_ORDERS_COLLECTION, WAREHOUSES_COLLECTION, INVENTORY_TRANSACTIONS_COLLECTION, WORK_ORDERS_COLLECTION } from "../constants/collections";
import { buildAllocationPlan, type Availability } from "./allocationProjection";
import { computePartAvailability, openWorkOrderReserved, sumOtherSoCommitments, sumLedgerEligibleOnHand } from "./fulfillmentAvailability";
import { readEquipmentAvailability } from "./equipmentAvailabilityContract";

export const SALES_ORDER_FULFILL_CAPABILITY = "salesOrder.fulfill";

const ACTIVE_SO_STATES = ["CONFIRMED", "IN_FULFILLMENT"] as const;

async function requireFulfill(uid: string): Promise<void> {
  let allowed = false;
  try {
    const { decisions } = await resolveEffectiveAccess({ principalUid: uid, permissionIds: [SALES_ORDER_FULFILL_CAPABILITY] });
    allowed = decisions[SALES_ORDER_FULFILL_CAPABILITY] === true;
  } catch (err) {
    console.error(`[requireFulfill (allocateSalesOrder)] capability resolution failed for ${SALES_ORDER_FULFILL_CAPABILITY}`, err);
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

// Read the eligible physical ON_HAND for a part from the GOVERNED LEDGER (Owner-ratified 2026-08-17):
// physical movements at eligible (status==ACTIVE) warehouses. Returns null (UNKNOWN) when the part has no
// physical movement evidence. Reads the SAME inventory_transactions collection readOpenWoReserved() already
// uses, so sellable stock and open reservations are derived from one authority rather than two that drift.
async function readPartOnHand(tx: Transaction, ref: string, eligibleWarehouseIds: Set<string>): Promise<number | null> {
  const db = getFirestore();
  const snap = await tx.get(db.collection(INVENTORY_TRANSACTIONS_COLLECTION).where("partId", "==", ref));
  return sumLedgerEligibleOnHand(
    snap.docs.map((d) => d.data() as { type: string; quantity: number; location?: { type?: string; locationId?: string } }),
    eligibleWarehouseIds
  );
}

async function readOpenWoReserved(tx: Transaction, ref: string, excludeWorkOrderIds: Set<string>): Promise<number> {
  const db = getFirestore();
  const snap = await tx.get(db.collection(INVENTORY_TRANSACTIONS_COLLECTION).where("partId", "==", ref));
  return openWorkOrderReserved(
    snap.docs.map((d) => d.data() as { type: string; quantity: number; workOrderId?: string }),
    excludeWorkOrderIds
  );
}

// The set of Work Order ids linked (via salesOrderId lineage) to an active Sales Order — their reservations
// are counted via the Sales Order allocation, not again here (C7 demand lineage). Chunked to respect the
// Firestore `in` limit.
async function readSalesOrderLinkedWorkOrderIds(tx: Transaction, activeSoIds: string[]): Promise<Set<string>> {
  const db = getFirestore();
  const ids = new Set<string>();
  for (let i = 0; i < activeSoIds.length; i += 30) {
    const chunk = activeSoIds.slice(i, i + 30);
    if (chunk.length === 0) continue;
    const snap = await tx.get(db.collection(WORK_ORDERS_COLLECTION).where("salesOrderId", "in", chunk));
    for (const d of snap.docs) ids.add(d.id);
  }
  return ids;
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
      const activeSoSnap = await tx.get(db.collection(SALES_ORDERS_COLLECTION).where("state", "in", [...ACTIVE_SO_STATES]));
      const otherSoLines: SoLine[] = [];
      const activeSoIds: string[] = [];
      for (const d of activeSoSnap.docs) {
        activeSoIds.push(d.id);
        if (d.id === salesOrderId) continue;
        const data = d.data() as { lines?: SoLine[] };
        if (Array.isArray(data.lines)) otherSoLines.push(...data.lines);
      }
      // C7 demand lineage: WO reservations whose WO is linked to an active Sales Order are counted via that
      // SO's allocation, so exclude them from openWoReserved to avoid double-counting the same demand.
      const soLinkedWorkOrderIds = await readSalesOrderLinkedWorkOrderIds(tx, activeSoIds);

      // Availability per distinct ref.
      const availabilityByRef: Record<string, Availability> = {};
      const distinctPartRefs = [...new Set(lines.filter((l) => l.kind === "PART").map((l) => l.ref))];
      const distinctEquipRefs = [...new Set(lines.filter((l) => l.kind === "EQUIPMENT_MODEL").map((l) => l.ref))];
      for (const ref of distinctPartRefs) {
        const onHandEligible = await readPartOnHand(tx, ref, eligibleWarehouseIds);
        const openWoReserved = onHandEligible === null ? 0 : await readOpenWoReserved(tx, ref, soLinkedWorkOrderIds);
        const other = sumOtherSoCommitments(otherSoLines, "PART", ref);
        // This SO's OWN prior allocation for this ref is also a live claim on the same physical on-hand pool
        // (stock_locations is never decremented for an SO allocation — see fulfillmentAvailability.ts). It must
        // be netted here too, or a re-run additively over-allocates against the same undiminished on-hand read.
        const self = sumOtherSoCommitments(lines, "PART", ref);
        availabilityByRef[`PART:${ref}`] = computePartAvailability({
          onHandEligible,
          openWoReserved,
          otherSoAllocated: other.allocatedQty,
          selfAllocated: self.allocatedQty,
        });
      }
      // Equipment availability via the governed contract (equipmentAvailabilityContract). Fail-closed UNKNOWN
      // today per the canonical-read assessment (availability substrate not-yet-connected + ordered-model↔serial
      // mapping unresolved + no #12 Temporary Placement authority); auto-activates when the substrate connects.
      for (const ref of distinctEquipRefs) availabilityByRef[`EQUIPMENT_MODEL:${ref}`] = readEquipmentAvailability(ref);

      // SERVICE lines need no inventory ⇒ treat as fully available.
      const planLines = lines.map((l) =>
        l.kind === "SERVICE" ? { ...l, __availability: { kind: "KNOWN", quantity: l.orderedQty } as Availability } : l
      );
      const plan = buildAllocationPlan(
        planLines,
        Object.fromEntries(planLines.map((l) => [`${l.kind}:${l.ref}`, (l as { __availability?: Availability }).__availability ?? availabilityByRef[`${l.kind}:${l.ref}`] ?? { kind: "UNKNOWN" }]))
      );

      // ---- WRITE (only the Sales Order; allocation is a commitment on the SO, netted by future ATP) ----
      // plan.lines is built by buildAllocationPlan as a 1:1, order-preserving map over `planLines` (itself a
      // 1:1 map over `lines`), so each SO line's own result lives at the SAME index. A bare find(ref+kind)
      // would return the FIRST matching plan-line for every line that shares a ref+kind — mis-writing every
      // sibling line with the first line's result (site-work allocatesalesorder-duplicate-ref-lines-double-
      // allocate). Map by position so each line gets ITS OWN plan-line result.
      const nextLines = lines.map((l, i) => {
        const alloc = plan.lines[i];
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
