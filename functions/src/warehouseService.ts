// Epic 4 Warehouse + Fulfillment System.
//
// Physical stock-location state management: bin-level quantities and
// transfer orders between warehouses. This file NEVER writes
// inventory_transactions and NEVER touches fieldops_wos -- moving
// physical stock between bins/warehouses has no bearing on the
// ledger's RESERVED/RELEASED/CONSUMED accounting, and vice versa. See
// docs/CLAUDE_CONTEXT.md's Epic 4 section for the full boundary.
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import type { Transaction } from "firebase-admin/firestore";
import {
  STOCK_LOCATIONS_COLLECTION,
  TRANSFER_ORDERS_COLLECTION,
} from "./constants/collections";
import type { StockLocation, TransferOrder } from "./types/warehouse";

const db = () => getFirestore();

// Deterministic doc id from the composite key -- makes
// updateStockLocation's read-modify-write a single-doc transaction
// instead of a query, and gives callers a stable id to re-derive
// without needing to look one up first.
function stockLocationDocId(warehouseId: string, partId: string, binCode: string): string {
  return `${warehouseId}__${partId}__${binCode}`;
}

export async function getWarehouseStock(warehouseId: string): Promise<StockLocation[]> {
  const snap = await db()
    .collection(STOCK_LOCATIONS_COLLECTION)
    .where("warehouseId", "==", warehouseId)
    .get();
  return snap.docs.map((doc) => doc.data() as StockLocation);
}

async function applyStockDelta(
  tx: Transaction,
  warehouseId: string,
  partId: string,
  binCode: string,
  deltaQuantity: number
): Promise<void> {
  const ref = db().collection(STOCK_LOCATIONS_COLLECTION).doc(stockLocationDocId(warehouseId, partId, binCode));
  const snap = await tx.get(ref);
  const current = snap.exists ? (snap.data() as StockLocation).quantity : 0;
  const next: StockLocation = {
    id: ref.id,
    warehouseId,
    partId,
    binCode,
    quantity: current + deltaQuantity,
    updatedAt: FieldValue.serverTimestamp() as unknown as StockLocation["updatedAt"],
  };
  tx.set(ref, next);
}

// Applies a delta to one bin's quantity, creating the StockLocation
// doc on first write. NOTE on idempotency: this primitive takes a
// relative delta with no idempotency key, so calling it twice with the
// same arguments applies the delta twice -- it cannot be idempotent on
// its own. Callers that need retry-safety (e.g. completeTransferOrder
// below) get it by guarding on the caller's own status inside a
// transaction, not by making this primitive idempotent.
export async function updateStockLocation(
  warehouseId: string,
  partId: string,
  binCode: string,
  deltaQuantity: number
): Promise<void> {
  await db().runTransaction((tx) => applyStockDelta(tx, warehouseId, partId, binCode, deltaQuantity));
}

// TransferOrder's bin is fixed at "TRANSFER" -- this system tracks
// bin-level detail for stock at rest, but a transfer in flight isn't
// sitting in a named bin at either warehouse. Refining transfers to a
// specific destination bin is a real gap, not silently solved here;
// left for a future iteration since nothing in this epic's spec asked
// for bin-level transfer routing.
const TRANSFER_BIN_CODE = "TRANSFER";

export async function createTransferOrder(input: {
  partId: string;
  quantity: number;
  fromWarehouseId: string;
  toWarehouseId: string;
}): Promise<TransferOrder> {
  const ref = db().collection(TRANSFER_ORDERS_COLLECTION).doc();
  const now = FieldValue.serverTimestamp();
  const order: TransferOrder = {
    id: ref.id,
    partId: input.partId,
    quantity: input.quantity,
    fromWarehouseId: input.fromWarehouseId,
    toWarehouseId: input.toWarehouseId,
    status: "REQUESTED",
    createdAt: now as unknown as TransferOrder["createdAt"],
    updatedAt: now as unknown as TransferOrder["updatedAt"],
  };
  await ref.set(order);
  return order;
}

// Idempotent: guards on the TransferOrder's own status inside the same
// transaction that applies the stock deltas, so a retried/duplicate
// call for an already-COMPLETED transfer is a no-op rather than a
// double-move.
export async function completeTransferOrder(transferOrderId: string): Promise<void> {
  const ref = db().collection(TRANSFER_ORDERS_COLLECTION).doc(transferOrderId);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error(`No TransferOrder with id ${transferOrderId}`);
    const order = snap.data() as TransferOrder;
    if (order.status === "COMPLETED") return;
    if (order.status === "CANCELLED") throw new Error(`TransferOrder ${transferOrderId} is CANCELLED, cannot complete`);

    await applyStockDelta(tx, order.fromWarehouseId, order.partId, TRANSFER_BIN_CODE, -order.quantity);
    await applyStockDelta(tx, order.toWarehouseId, order.partId, TRANSFER_BIN_CODE, order.quantity);

    tx.set(ref, { status: "COMPLETED", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
}
