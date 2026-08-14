import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getCallerContext } from "./callerContext";
import { INVENTORY_TRANSACTIONS_COLLECTION, STOCK_LOCATIONS_COLLECTION } from "./constants/collections";
import { normalizeLedgerTransactions } from "./ledgerNormalizer";
import { generateInventoryHealthDashboard } from "./inventoryAnalyticsService";
import type { InventoryTransaction } from "./types/inventoryTransaction";
import type { StockLocation } from "./types/warehouse";
export const getInventoryAnalytics = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
  const caller = await getCallerContext(request.auth.uid);
  if (caller.role !== "admin" && caller.role !== "dispatcher") throw new HttpsError("permission-denied", "Not authorized to read inventory analytics.");
  const db = getFirestore(); const [ledger, stock] = await Promise.all([db.collection(INVENTORY_TRANSACTIONS_COLLECTION).get(), db.collection(STOCK_LOCATIONS_COLLECTION).get()]);
  const transactions = normalizeLedgerTransactions(ledger.docs.map((d) => ({ ...(d.data() as Omit<InventoryTransaction, "id">), id: d.id })));
  // Physical bin total per part -- the warehouse-wide baseline this
  // callable reads from real STOCK_LOCATIONS_COLLECTION documents
  // (more current than data/partsCatalog.ts's static warehouseQty
  // baseline, which inventoryService.ts's getAvailableQuantity() uses
  // as its baseline instead). availableStock must still be netted
  // against outstanding reservations on top of that baseline -- same
  // "warehouseQty - (grossReserved - released)" definition as
  // getAvailableQuantity() / computeAvailableStockByPart() -- so this
  // callable's figure agrees with every other availableStock consumer
  // instead of overstating it with raw bin totals that ignore
  // outstanding RESERVED transactions.
  const binTotals = new Map<string, number>(); stock.docs.forEach((d) => { const s = d.data() as StockLocation; binTotals.set(s.partId, (binTotals.get(s.partId) ?? 0) + s.quantity); });
  const netReservedByPart = new Map<string, number>();
  transactions.forEach((t) => {
    const delta = t.type === "RESERVED" ? t.quantity : t.type === "RELEASED" ? -t.quantity : 0;
    if (delta !== 0) netReservedByPart.set(t.partId, (netReservedByPart.get(t.partId) ?? 0) + delta);
  });
  const stockSnapshots = [...binTotals].map(([partId, binQty]) => ({ partId, availableStock: binQty - (netReservedByPart.get(partId) ?? 0) }));
  return { health: generateInventoryHealthDashboard(transactions, stockSnapshots) };
});
