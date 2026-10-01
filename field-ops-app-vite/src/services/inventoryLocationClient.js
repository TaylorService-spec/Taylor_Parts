// WAREHOUSES AND BINS FOR THE WAREHOUSE SCREENS -- from eos_ops through the EOS operations transport.
//
// Replaces, for the employee warehouse screens, the Firestore `warehouses` read (operationsQueries.fetchWarehouses),
// the Firebase `listStockMovementLocations` callable and the Firebase `resolveBin` / `resolveBinToken` callables
// (Controller INVENTORY / WAREHOUSE COMPLETION RULINGS, 2026-10-01: "the employee-visible real Taylor warehouse must
// come from eos_ops.warehouses; do not merge Firestore and PostgreSQL warehouse lists").
//
//   listInventoryWarehouses {}              -> the caller's WAREHOUSE-scoped governed warehouses (fixtures excluded
//                                              by the SERVER, never here)
//   listInventoryLocations  {warehouseId?}  -> those warehouses and their bins
//
// Bin RESOLUTION is answered from that one governed read: the server already decided which locations this person may
// see, so a scanned code either names one of them or it does not. The answer keeps the bin vocabulary the screens
// already render (domain/putAwaySession.js BIN_RESULT): FOUND / INACTIVE / WRONG_WAREHOUSE / NOT_FOUND / MALFORMED.
// A bin outside the caller's scope is simply not in the answer -- NOT_FOUND, never a guess.
import { EOS_OPERATIONS_ROUTES, eosOperationOrThrow } from "./eosOperationsClient.js";

const INVENTORY = EOS_OPERATIONS_ROUTES.INVENTORY;
const OPTS = Object.freeze({ serviceLabel: "the warehouse service" });

/** Normalize a typed or scanned bin code exactly as the server's normalizeBinCode does (whitespace out, upper case). */
export function normalizeBinCodeText(raw) {
  if (typeof raw !== "string") return null;
  const code = raw.trim().replace(/\s+/g, "").toUpperCase();
  return code === "" ? null : code;
}

export async function listInventoryWarehouses(call = eosOperationOrThrow) {
  const res = await call(INVENTORY, "listInventoryWarehouses", {}, OPTS);
  return Array.isArray(res?.items) ? res.items : [];
}

export async function listInventoryLocations(input = {}, call = eosOperationOrThrow) {
  const res = await call(INVENTORY, "listInventoryLocations", input, OPTS);
  return Array.isArray(res?.items) ? res.items : [];
}

/**
 * Trucks a warehouse operator may send stock to (Truck Inventory activation, 2026-10-01): the ACTIVE MOBILE locations the
 * server returned in listInventoryLocations -- those bound to a warehouse the caller is scoped over. `{ locationId, label }`.
 * Sending to a truck is always a governed Transfer (create + dispatch), never a relocation.
 */
export async function fetchTruckDestinations(call = eosOperationOrThrow) {
  return (await listInventoryLocations({}, call))
    .filter((l) => l.type === "MOBILE" && l.status === "ACTIVE")
    .map((l) => Object.freeze({ locationId: l.locationId, label: l.code ? `${l.name} (${l.code})` : (l.name || l.locationId) }));
}

/** The `{ id, name }` picker shape the warehouse screens use (also exposes status / site for display). */
export async function fetchInventoryWarehouseOptions(call = eosOperationOrThrow) {
  return (await listInventoryWarehouses(call)).map((w) => Object.freeze({
    id: w.warehouseId, name: w.name || w.warehouseId, siteLabel: w.siteLabel ?? null, status: w.status ?? null,
    operatingCompanyId: w.operatingCompanyId ?? null, binCount: w.binCount ?? null,
  }));
}

const binAnswer = (bin, result) => Object.freeze({
  result, binId: bin?.locationId ?? null, code: bin?.code ?? null, warehouseId: bin?.warehouseId ?? null,
  name: bin?.name ?? null, status: bin?.status ?? null,
});

/** Resolve a HUMAN code within one warehouse. */
export async function resolveBin({ warehouseId, code }, call = eosOperationOrThrow) {
  const wanted = normalizeBinCodeText(code);
  if (!wanted || typeof warehouseId !== "string" || warehouseId === "") return binAnswer(null, "MALFORMED");
  const bins = (await listInventoryLocations({ warehouseId }, call)).filter((l) => l.type === "BIN");
  const bin = bins.find((b) => normalizeBinCodeText(b.code) === wanted);
  if (!bin) return binAnswer(null, "NOT_FOUND");
  return binAnswer(bin, bin.status === "ACTIVE" ? "FOUND" : "INACTIVE");
}

/** Resolve a scanned MACHINE token (`bin_<hash>`): the only path that can honestly say WRONG_WAREHOUSE. */
export async function resolveBinToken({ warehouseId, token }, call = eosOperationOrThrow) {
  if (typeof token !== "string" || !token.startsWith("bin_")) return binAnswer(null, "MALFORMED");
  const bin = (await listInventoryLocations({}, call)).find((l) => l.type === "BIN" && l.locationId === token);
  if (!bin) return binAnswer(null, "NOT_FOUND");
  if (warehouseId && bin.warehouseId !== warehouseId) return binAnswer(bin, "WRONG_WAREHOUSE");
  return binAnswer(bin, bin.status === "ACTIVE" ? "FOUND" : "INACTIVE");
}

export const inventoryLocationClient = Object.freeze({
  listInventoryWarehouses: () => listInventoryWarehouses(),
  listInventoryLocations: (input) => listInventoryLocations(input),
  fetchWarehouseOptions: () => fetchInventoryWarehouseOptions(),
  fetchTruckDestinations: () => fetchTruckDestinations(),
  resolveBin: (request) => resolveBin(request),
  resolveBinToken: (request) => resolveBinToken(request),
});

/**
 * Where an existing serialized unit may be acquired: the caller's ACTIVE governed warehouses (acquisition is
 * WAREHOUSE-only on EOS; a bin, truck or customer site is refused by the server). The `{ status, options }` shape the
 * acquire dialog already renders (domain/acquireLocationState.js), with the same RECEIVING_OUTCOME vocabulary --
 * never a call to the canonical-receiving callable.
 */
export async function fetchAcquireWarehouseOptions(call = eosOperationOrThrow) {
  try {
    const rows = await listInventoryWarehouses(call);
    return {
      status: "ready",
      options: rows.filter((w) => w.status === "ACTIVE").map((w) => Object.freeze({ value: w.warehouseId, label: w.name || w.warehouseId })),
    };
  } catch (err) {
    return { status: err?.code === "permission-denied" ? "denied" : err?.code === "unauthenticated" ? "unauthenticated" : "unavailable", options: [] };
  }
}
