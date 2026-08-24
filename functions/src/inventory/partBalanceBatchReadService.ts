// PART BALANCES, FOR A PAGE OF PARTS — the batched sibling of the single-part balance read.
//
// GOVERNANCE: docs/architecture/inventory-health-projection.md.
//
// ============================ WHAT THIS IS, AND IS NOT ============================
//
// NOT a second balance authority. Every number here comes from `composePartBalance` — the same pure
// function `readPartBalance` uses, unchanged — over the same ratified inputs. This module owns the
// READ SHAPE and nothing else: it fetches once what the per-part path fetches N times.
//
// NOT a materialized projection. Nothing is stored, so nothing can go stale, drift from source, or
// need rebuilding — the same reasoning `financeReadProjection.ts` states for AR, where a possibly
// stale stored balance is deliberately never trusted and the position is derived from durable facts
// on every read. A cached health number is a number somebody will believe after it stops being true.
//
// ============================ WHY BATCHING IS THE WHOLE POINT ============================
//
// `readPartBalance` issues, PER PART: one ledger query, one warehouses query, one purchase-orders
// query, and one receipts query per open order. Three of those four answers are IDENTICAL for every
// part in a page — the ACTIVE warehouse set, the open purchase orders and their receipts do not vary
// by part — so a page of 50 re-reads the same data 50 times.
//
//   per-part, 50 parts   50 ledger + 50 warehouse + 50 PO + (50 x R) receipts
//   batched,  50 parts    2 ledger +  1 warehouse +  1 PO + R receipts
//
// The ledger read is the only genuinely per-part input, and Firestore's `in` operator takes 30
// values, so 50 parts is two queries rather than fifty.
//
// ============================ NO WRITES, ENFORCED ============================
//
// A balance read must never mutate. The sibling service carries a source guard that forbids every
// write and transaction token by name, and this module is held to the same one — which is why the
// receipt map below is constructed from entries rather than assembled entry by entry: a text guard
// cannot tell a Map mutator from a DocumentReference mutator, and restructuring the code is the
// right answer to that rather than loosening a real protection.
//
// This comment deliberately spells none of those tokens out. The guard reads SOURCE, so prose
// describing it would trip it — which is the guard working, not a false positive.

import { getFirestore } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { RECEIVING_ORDERS_COLLECTION } from "../inventoryReceiving/receivingTypes";
import type { CommittedReceipt } from "../purchasing/purchaseOrderNormalization";
import {
  INVENTORY_TRANSACTIONS_COLLECTION,
  WAREHOUSES_COLLECTION,
  PURCHASE_ORDERS_COLLECTION,
} from "../constants/collections.js";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed.js";
import { isSerialTracked } from "../partMaster/controlTypeTrackingMode.js";
import { buildFirestorePartRepository } from "../partMaster/partMasterRepository.js";
import type { PartId } from "../partMaster/types.js";
import {
  INVENTORY_BALANCE_READ_CAPABILITY,
  OPEN_PURCHASE_ORDER_STATUSES,
  composePartBalance,
  sumOpenOrderedQuantity,
  type PartBalanceProjection,
} from "./partBalanceReadService.js";

/**
 * How many parts one batch answers for.
 *
 * A page of the Parts list is 50, and this is deliberately no larger: an unbounded batch would be
 * the fetch-all pattern wearing a callable's clothes, and a caller that wants 5,000 balances wants a
 * different question answered.
 */
export const PART_BALANCE_BATCH_LIMIT = 50;

/** Firestore's ceiling on an `in` clause. Not a preference — the query either fits or it does not. */
const IN_CLAUSE_LIMIT = 30;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Read and compose balances for MANY parts, with the shared inputs read once.
 *
 * @param serialTrackedByPartId whether each Part's control type means its units are individually
 *        tracked. A FACT THE SERVER OWNS: the single-part callable was once willing to take this
 *        from the caller, and that let a request answer `{ KNOWN, 0 }` for PRT-2001 — a confident
 *        zero for a shelf holding two serialized units. Resolved from the Part Master here for the
 *        same reason, and a part that cannot be resolved is OMITTED rather than assumed.
 *
 * Returns one projection per part, in the order requested, for the parts that resolved.
 */
export async function readPartBalances(
  db: Firestore,
  partIds: readonly string[],
  serialTrackedByPartId: ReadonlyMap<string, boolean>,
): Promise<PartBalanceProjection[]> {
  if (partIds.length === 0) return [];

  // ── the three shared reads, once for the whole page ─────────────────────────────────────────
  const [warehouseSnap, poSnap, ...ledgerSnaps] = await Promise.all([
    db.collection(WAREHOUSES_COLLECTION).where("status", "==", "ACTIVE").get(),
    db.collection(PURCHASE_ORDERS_COLLECTION).get(),
    ...chunk(partIds, IN_CLAUSE_LIMIT).map((ids) =>
      db.collection(INVENTORY_TRANSACTIONS_COLLECTION).where("partId", "in", ids).get()),
  ]);

  const eligibleWarehouseIds = new Set(warehouseSnap.docs.map((d) => d.id));

  // Ledger rows GROUPED BY PART, so each part is composed from exactly its own rows. Built by
  // accumulating into arrays rather than by a per-part filter pass, so cost is linear in the rows
  // read rather than parts x rows.
  const ledgerByPart = new Map<string, Array<{
    type: string; quantity: number; location?: { type?: string; locationId?: string }; trackingMode?: string; workOrderId?: string;
  }>>(partIds.map((id) => [id, []] as const));
  for (const snap of ledgerSnaps) {
    for (const doc of snap.docs) {
      const row = doc.data() as {
        partId?: string; type: string; quantity: number;
        location?: { type?: string; locationId?: string }; trackingMode?: string; workOrderId?: string;
      };
      const bucket = typeof row.partId === "string" ? ledgerByPart.get(row.partId) : undefined;
      // A row whose partId is not one we asked for cannot appear (the query filtered on it), and a
      // row without one is not attributable to any part — dropping it is the only honest option.
      if (bucket) bucket.push(row);
    }
  }

  const openOrders = poSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as Record<string, unknown> & { id: string })
    .filter((po) => typeof po.status === "string" && OPEN_PURCHASE_ORDER_STATUSES.includes(po.status));

  // COMMITTED RECEIPTS, so canonical outstanding can be netted. A canonical purchase order stores no
  // receivedQuantity — progress lives in the receipts — so without them a partially received order
  // reports its FULL quantity as still inbound, overstating supply and making a live shortage look
  // handled. Read once for the page, not once per part.
  const receiptSnaps = openOrders.length === 0 ? [] : await Promise.all(
    openOrders.map((po) =>
      db.collection(RECEIVING_ORDERS_COLLECTION).where("source.purchaseOrderId", "==", po.id).get()),
  );
  const receiptsByPurchaseOrder: ReadonlyMap<string, readonly CommittedReceipt[]> = new Map(
    receiptSnaps.map((snap, i) => [
      openOrders[i].id,
      snap.docs.map((d) => {
        const data = d.data() ?? {};
        const lines = Array.isArray(data.lines) ? data.lines : [];
        return {
          receivingId: d.id,
          lines: lines.map((l: Record<string, unknown>) => ({
            lineId: String(l?.lineId ?? ""),
            receivedQuantity: typeof l?.receivedQuantity === "number" ? l.receivedQuantity : 0,
          })),
        };
      }),
    ] as const),
  );

  // ── compose, per part, through the SAME pure function the single-part read uses ──────────────
  const out: PartBalanceProjection[] = [];
  for (const partId of partIds) {
    const serialTracked = serialTrackedByPartId.get(partId);
    // A part the Part Master could not resolve is OMITTED. Assuming quantity-tracked would
    // reintroduce the confident zero by a different route.
    if (serialTracked === undefined) continue;
    out.push(composePartBalance({
      partId,
      ledgerRows: ledgerByPart.get(partId) ?? [],
      eligibleWarehouseIds,
      openOrderedQuantity: sumOpenOrderedQuantity(openOrders, partId, receiptsByPurchaseOrder),
      serialTracked,
    }));
  }
  return out;
}

/**
 * The trusted batched callable.
 *
 * SAME CAPABILITY as the single-part read — `inventory.balance.read`. Asking about fifty parts is
 * the same question asked fifty times, and minting a second capability for it would create an
 * audience split the domain does not have. §27: no new business role or capability.
 *
 * Inherits that capability's gate exactly: registered `active: false`, resolved per environment, and
 * still requiring a qualifying Role grant. It denies for every principal until activation, grant and
 * deploy are separately authorized.
 */
export const getPartBalancesCallable = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Must be signed in.");

  let allowed = false;
  try {
    const { decisions } = await resolveEffectiveAccess({
      principalUid: request.auth.uid,
      permissionIds: [INVENTORY_BALANCE_READ_CAPABILITY],
    });
    allowed = decisions[INVENTORY_BALANCE_READ_CAPABILITY] === true;
  } catch (err) {
    // A THROWING resolver is a denial, never an allow.
    console.error(`[getPartBalances] capability resolution failed for ${INVENTORY_BALANCE_READ_CAPABILITY}`, err);
    allowed = false;
  }
  if (!allowed) throw new HttpsError("permission-denied", "You are not authorized to read inventory balances.");

  const data = (request.data ?? {}) as Record<string, unknown>;
  const raw = Array.isArray(data.partIds) ? data.partIds : null;
  if (raw === null) throw new HttpsError("invalid-argument", "partIds must be an array.");

  // De-duplicated before the limit is applied, so a caller repeating one id fifty times asks for one
  // part rather than being refused for asking about fifty.
  const partIds = [...new Set(raw.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter((v) => v !== ""))];
  if (partIds.length === 0) throw new HttpsError("invalid-argument", "At least one partId is required.");
  if (partIds.length > PART_BALANCE_BATCH_LIMIT) {
    // REFUSED, not silently truncated. Returning the first fifty of a larger request would answer a
    // question nobody asked and look like a complete answer to the one they did.
    throw new HttpsError(
      "invalid-argument",
      `At most ${PART_BALANCE_BATCH_LIMIT} parts may be requested at once; this asked for ${partIds.length}.`,
    );
  }

  try {
    const db = getFirestore();
    const repository = buildFirestorePartRepository(db);
    const stored = await Promise.all(partIds.map((id) => repository.getById(null, id as PartId)));

    const serialTrackedByPartId = new Map<string, boolean>(
      stored
        .map((record, i) => (record === null ? null : [partIds[i], isSerialTracked(record.part.controlType)] as const))
        .filter((entry): entry is readonly [string, boolean] => entry !== null),
    );

    const balances = await readPartBalances(db, partIds, serialTrackedByPartId);
    return {
      balances,
      // WHICH PARTS HAD NO ANSWER, said explicitly. A caller that asked about fifty and received
      // forty-eight must be able to tell WHICH two are missing — silently short results are how a
      // list ends up rendering a blank cell that looks like a zero.
      unresolvedPartIds: partIds.filter((id) => !serialTrackedByPartId.has(id)),
    };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    console.error("[getPartBalances] read failed", err);
    throw new HttpsError("internal", "The request could not be completed.");
  }
});
