import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { resolveEffectiveAccess } from "./access/effectiveAccessFeed";
import {
  INVENTORY_TRANSACTIONS_COLLECTION,
  SERIALIZED_ASSETS_COLLECTION,
  WAREHOUSES_COLLECTION,
} from "./constants/collections";
import { normalizeLedgerTransactions } from "./ledgerNormalizer";
import { generateInventoryHealthDashboard } from "./inventoryAnalyticsService";
import { sumLedgerEligibleOnHand } from "./fulfillment/fulfillmentAvailability";
import type { InventoryTransaction } from "./types/inventoryTransaction";
export const INVENTORY_ANALYTICS_READ_CAPABILITY = "inventory.analytics.read";

// X-ANALYTICS-STOCK-AUTHORITY (BIN-P2). This callable used to sum `stock_locations.quantity` per
// part for its physical baseline. Nothing in the repository has ever WRITTEN that collection -- it
// is a seeded legacy projection -- and in the sandbox it diverged from the ledger in BOTH
// directions: a part with three genuinely received units read as 0, and a part with nothing ever
// received read as 40. Decision #160 / ADR-014 ruled it retired.
//
// The replacement is the SAME authority every other inventory surface already uses, with the SAME
// movement semantics Transfer, Cycle Count and Sales-Order allocation encode:
//
//   NONE-tracked   sumLedgerEligibleOnHand over the operational ledger at status==ACTIVE warehouses
//                  (RECEIVED/RETURNED/TRANSFER_IN +, TRANSFER_OUT/SCRAPPED -, ADJUSTED signed;
//                  an unnamed type and a non-WAREHOUSE location both contribute nothing)
//   SERIAL-tracked serialized_assets units that are AVAILABLE at an eligible warehouse -- the same
//                  rule Cycle Count's expected-serial snapshot uses. The ledger deliberately does
//                  not aggregate serial quantity, so counting the registry is what makes a
//                  serialized part's figure truthful rather than zero.
//
// A part with NO physical evidence anywhere is OMITTED, exactly as a part absent from
// stock_locations was omitted before. That preserves the response contract: UNKNOWN is still
// expressed by absence, never fabricated as 0.
//
// Reservations are netted OFF this baseline, unchanged and exactly once. RESERVED/RELEASED are
// logical commitment events, deliberately absent from the physical sum above, so subtracting them
// here does not double-count.

interface RawLedgerRow {
  readonly partId?: unknown;
  readonly type?: unknown;
  readonly quantity?: unknown;
  readonly trackingMode?: unknown;
  readonly location?: { readonly type?: unknown; readonly locationId?: unknown };
}
interface RawSerializedAsset {
  readonly partId?: unknown;
  readonly currentLocationId?: unknown;
  readonly inventoryState?: unknown;
}

/**
 * The physical baseline per part, from governed current sources only. PURE — the callable supplies
 * the reads, so this is unit-testable without the emulator and cannot drift from what the callable
 * would compute.
 */
export function computeAnalyticsOnHandByPart(
  ledgerRows: readonly RawLedgerRow[],
  serializedAssets: readonly RawSerializedAsset[],
  eligibleWarehouseIds: ReadonlySet<string>,
): Map<string, number> {
  const rowsByPart = new Map<string, RawLedgerRow[]>();
  for (const row of ledgerRows) {
    if (typeof row.partId !== "string" || row.partId === "") continue; // malformed rows never inflate
    const list = rowsByPart.get(row.partId);
    if (list) list.push(row);
    else rowsByPart.set(row.partId, [row]);
  }

  const onHand = new Map<string, number>();
  for (const [partId, rows] of rowsByPart) {
    const sum = sumLedgerEligibleOnHand(
      rows as Array<{ type: string; quantity: number; location?: { type?: string; locationId?: string }; trackingMode?: string }>,
      eligibleWarehouseIds as Set<string>,
    );
    // null means NO physical evidence at all. Omit the part rather than asserting a zero it has not
    // earned -- the same distinction the previous stock_locations contract drew.
    if (sum !== null) onHand.set(partId, sum);
  }

  for (const asset of serializedAssets) {
    if (typeof asset.partId !== "string" || asset.partId === "") continue;
    if (asset.inventoryState !== "AVAILABLE") continue;
    if (typeof asset.currentLocationId !== "string" || !eligibleWarehouseIds.has(asset.currentLocationId)) continue;
    onHand.set(asset.partId, (onHand.get(asset.partId) ?? 0) + 1);
  }

  return onHand;
}

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
  } catch (err) {
    console.error(`[getInventoryAnalytics] capability resolution failed for ${INVENTORY_ANALYTICS_READ_CAPABILITY}`, err);
    allowed = false;
  }
  if (!allowed) throw new HttpsError("permission-denied", "Not authorized to read inventory analytics.");
  const db = getFirestore();
  const [ledger, warehouses, serialized] = await Promise.all([
    db.collection(INVENTORY_TRANSACTIONS_COLLECTION).get(),
    // Eligible pool = status==ACTIVE warehouses, the same fence Sales-Order allocation applies.
    // MOBILE/truck and customer-held stock live in their own collections and are deliberately not
    // warehouse stock.
    db.collection(WAREHOUSES_COLLECTION).where("status", "==", "ACTIVE").get(),
    db.collection(SERIALIZED_ASSETS_COLLECTION).where("inventoryState", "==", "AVAILABLE").get(),
  ]);
  const transactions = normalizeLedgerTransactions(ledger.docs.map((d) => ({ ...(d.data() as Omit<InventoryTransaction, "id">), id: d.id })));

  // The physical baseline comes from the RAW ledger rows, not the normalized ones: normalization
  // drops `location` and `trackingMode`, which are exactly the two facts the warehouse fence and the
  // serial exclusion depend on.
  const eligibleWarehouseIds = new Set(warehouses.docs.map((d) => d.id));
  const onHandByPart = computeAnalyticsOnHandByPart(
    ledger.docs.map((d) => d.data() as RawLedgerRow),
    serialized.docs.map((d) => d.data() as RawSerializedAsset),
    eligibleWarehouseIds,
  );

  // availableStock nets outstanding reservations off that baseline -- the same
  // "physical - (grossReserved - released)" definition every other availableStock consumer uses, so
  // this callable's figure agrees with them instead of overstating it.
  const netReservedByPart = new Map<string, number>();
  transactions.forEach((t) => {
    const delta = t.type === "RESERVED" ? t.quantity : t.type === "RELEASED" ? -t.quantity : 0;
    if (delta !== 0) netReservedByPart.set(t.partId, (netReservedByPart.get(t.partId) ?? 0) + delta);
  });
  const stockSnapshots = [...onHandByPart].map(([partId, onHand]) => ({ partId, availableStock: onHand - (netReservedByPart.get(partId) ?? 0) }));
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
