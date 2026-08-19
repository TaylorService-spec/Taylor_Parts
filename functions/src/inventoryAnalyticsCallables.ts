import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { resolveEffectiveAccess } from "./access/effectiveAccessFeed";
import { INVENTORY_TRANSACTIONS_COLLECTION, STOCK_LOCATIONS_COLLECTION } from "./constants/collections";
import { normalizeLedgerTransactions } from "./ledgerNormalizer";
import { generateInventoryHealthDashboard } from "./inventoryAnalyticsService";
import type { InventoryTransaction } from "./types/inventoryTransaction";
import type { StockLocation } from "./types/warehouse";
export const INVENTORY_ANALYTICS_READ_CAPABILITY = "inventory.analytics.read";

// X-ANALYTICS-WIRE-ENCODING. The analytics engine models "this part has no usage history, so it
// never runs out" as `daysRemaining: Infinity`. That is correct IN PROCESS and is why
// `estimatedStockoutDate` is already `null` for exactly those entries -- the domain has always had a
// way to say "no predicted stockout". It is NOT expressible on the wire: the callable protocol
// encodes its result as JSON, `Infinity` has no JSON representation, and firebase-functions throws
// `Data cannot be encoded in JSON: Infinity` AFTER the handler returns -- so the caller sees a bare
// 500 INTERNAL with no indication which field was at fault.
//
// This is a TRANSPORT-BOUNDARY defect, not a computation defect, so the fix lives at the boundary:
// the engine keeps returning Infinity (every in-process consumer, including the client's own mirror
// engine, is unchanged), and the projection below converts it to `null` -- the same value
// `estimatedStockoutDate` already uses for the same condition, so a consumer reads one consistent
// "unbounded / not predicted" signal rather than two encodings of it.
//
// NaN and -Infinity are NOT silently mapped: only a positive-infinite `daysRemaining` has a defined
// meaning here. Anything else non-finite is a real computation bug, and `assertWireEncodable` below
// fails loudly with the offending path rather than shipping a payload full of quiet nulls. Note that
// JSON.stringify would NOT have caught this -- it turns Infinity into `null` silently, which is why
// a local "it didn't throw" check is not evidence that a payload is wire-safe.
type WireHealthEntry = Record<string, unknown>;

export function projectHealthForWire(entries: readonly unknown[]): WireHealthEntry[] {
  return entries.map((entry) => {
    const e = entry as Record<string, unknown>;
    const rec = e.recommendation as Record<string, unknown> | undefined;
    if (!rec) return e as WireHealthEntry;
    const days = rec.daysRemaining;
    return {
      ...e,
      recommendation: {
        ...rec,
        daysRemaining: days === Infinity ? null : days,
      },
    } as WireHealthEntry;
  });
}

/** Throws with the exact path of the first non-encodable number, instead of a bare 500 after return. */
export function assertWireEncodable(value: unknown, path = "result"): void {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`non-finite number at ${path}: ${String(value)}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertWireEncodable(v, `${path}[${i}]`));
    return;
  }
  if (value && typeof value === "object" && !(value instanceof Date)) {
    for (const [k, v] of Object.entries(value)) assertWireEncodable(v, `${path}.${k}`);
  }
}

export const getInventoryAnalytics = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");

  // AUTHORITY NORMALIZATION. This was the only trusted read in the repo authorizing via
  // a direct role comparison instead of the capability catalog, which meant its audience
  // was invisible to resolveEffectiveAccess, to the permission catalog, and to every tool
  // that reasons about who can read what.
  //
  // inventory.analytics.read is granted through SHARED_ADMIN_DISPATCHER_BASE_PERMISSIONS,
  // so the effective audience is unchanged: admin and dispatcher, exactly as the role
  // check allowed. Fail closed on resolver error, matching every sibling read service.
  let allowed = false;
  try {
    const { decisions } = await resolveEffectiveAccess({
      principalUid: request.auth.uid,
      permissionIds: [INVENTORY_ANALYTICS_READ_CAPABILITY],
    });
    allowed = decisions[INVENTORY_ANALYTICS_READ_CAPABILITY] === true;
  } catch {
    allowed = false;
  }
  if (!allowed) throw new HttpsError("permission-denied", "Not authorized to read inventory analytics.");
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
  const health = projectHealthForWire(generateInventoryHealthDashboard(transactions, stockSnapshots));
  try {
    assertWireEncodable({ health });
  } catch (err) {
    // Server-side detail so the next one is diagnosable from the log; the client message stays
    // generic and carries no field values, paths, or record content.
    console.error("getInventoryAnalytics: refusing to return a non-encodable payload", err);
    throw new HttpsError("internal", "Inventory analytics could not be encoded. Try again shortly.");
  }
  return { health };
});
