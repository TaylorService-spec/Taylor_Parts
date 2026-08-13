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
  const totals = new Map<string, number>(); stock.docs.forEach((d) => { const s = d.data() as StockLocation; totals.set(s.partId, (totals.get(s.partId) ?? 0) + s.quantity); });
  return { health: generateInventoryHealthDashboard(normalizeLedgerTransactions(ledger.docs.map((d) => ({ ...(d.data() as Omit<InventoryTransaction, "id">), id: d.id }))), [...totals].map(([partId, availableStock]) => ({ partId, availableStock }))) };
});
