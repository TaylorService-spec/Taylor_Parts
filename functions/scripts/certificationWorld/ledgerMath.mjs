// LEDGER ARITHMETIC — one implementation, mirroring the product's.
//
// ============================ WHY THIS FILE EXISTS ============================
//
// Five separate certification tools had each grown their own copy of "add up the ledger": the
// applied-inventory verifier, the demand invariants, the G03 snapshot, the Golden manifest, and the
// question seed. Each had its own IN/OUT sets, written from whatever movement types existed the day
// it was written.
//
// When opening balances became ADJUSTED, four of the five silently returned zero for every part --
// ADJUSTED was in nobody's IN set -- and the fifth was right only because it called the product.
// The world was correct; readPartBalance agreed; the tools that CHECK the world all disagreed with
// it in the same direction, which is the most dangerous shape a test suite can take.
//
// So there is one copy here, and it mirrors sumLedgerEligibleOnHand deliberately and visibly:
//
//   RECEIVED / TRANSFER_IN / RETURNED    add
//   TRANSFER_OUT / SCRAPPED              subtract
//   ADJUSTED                             add its OWN SIGN -- a reconciled shortage is negative
//   COUNTED                              nothing. A count is an observation, not a movement.
//
// COUNTED being excluded is not an omission. Counting is not adjusting: a blind count records what
// somebody saw, and only a reconciliation by a separate authority changes what the business holds.
// Summing COUNTED rows into a balance would make the act of looking at stock change it.
//
// EMULATOR ONLY.

const ADDS = new Set(["RECEIVED", "TRANSFER_IN", "RETURNED"]);
const SUBTRACTS = new Set(["TRANSFER_OUT", "SCRAPPED"]);

/**
 * The signed contribution of one ledger row.
 *
 * Returns 0 for anything that does not move stock, including COUNTED and any type added later that
 * this file has not been taught about -- unknown movement types contribute nothing rather than
 * being guessed at as inbound.
 */
export function signedQuantity(row) {
  const q = Number(row?.quantity);
  if (!Number.isFinite(q)) return 0;
  if (row.type === "ADJUSTED") return q;          // carries its own sign
  if (ADDS.has(row.type)) return Math.abs(q);
  if (SUBTRACTS.has(row.type)) return -Math.abs(q);
  return 0;
}

/** Rows are stored FLAT. `value.partId` matches nothing -- a query on it silently returns none. */
export async function allLedgerRows(db) {
  const snap = await db.collection("inventory_transactions").get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function ledgerRowsForPart(db, partId) {
  const snap = await db.collection("inventory_transactions").where("partId", "==", partId).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Mobile (truck) stock per part. The scope the warehouse projection excludes BY DESIGN. */
export function mobileByPart(rows) {
  const out = new Map();
  for (const r of rows) {
    if (r.location?.type !== "MOBILE") continue;
    out.set(r.partId, (out.get(r.partId) ?? 0) + signedQuantity(r));
  }
  return out;
}

/** Mobile stock for one part, split by truck. */
export function mobileByTruck(rows, partId) {
  const byTruck = new Map();
  let total = 0;
  for (const r of rows) {
    if (r.partId !== partId || r.location?.type !== "MOBILE") continue;
    const q = signedQuantity(r);
    byTruck.set(r.location.locationId, (byTruck.get(r.location.locationId) ?? 0) + q);
    total += q;
  }
  return { total, byTruck: [...byTruck].filter(([, q]) => q !== 0).sort((a, b) => b[1] - a[1]) };
}

/** Warehouse stock per part, counting only the named eligible warehouses. */
export function warehouseByPart(rows, eligibleWarehouseIds) {
  const out = new Map();
  for (const r of rows) {
    if (r.location?.type !== "WAREHOUSE") continue;
    if (eligibleWarehouseIds && !eligibleWarehouseIds.has(r.location.locationId)) continue;
    out.set(r.partId, (out.get(r.partId) ?? 0) + signedQuantity(r));
  }
  return out;
}
