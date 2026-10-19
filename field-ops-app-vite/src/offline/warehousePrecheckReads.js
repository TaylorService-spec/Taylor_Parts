// THE THREE READS THE WAREHOUSE PRECHECKS NEED, on the governed EOS operations (Firebase exit B3-x).
//
// warehouseCommandBindings.js defaulted readTransfer / readCycleCount / readBin to "cannot read" and no caller injected a real one, so the
// stale-state avoidance its tests prove (a cancelled transfer is spared a dispatch, a receive that reconnects before its dispatch WAITS, a retired
// bin is a conflict) never ran in the app: every doomed request went to the server, and a receive before its dispatch was classified from the
// server's refusal instead of staying pending. These are the real reads.
//
// EACH READ IS AN ORDINARY, SCOPED, READ-ONLY OPERATION -- no new server surface:
//   readTransfer    /operations/inventory  listTransferOrders      transfers whose origin or destination is in the caller's warehouse scope
//   readCycleCount  /operations/cycle-count getCycleCountSheet     the sheet and its lines (blind rule: no expected figure before a line's submit)
//   readBin         /operations/inventory  listInventoryLocations  the caller's warehouses and their bins
//
// A READ THAT CANNOT ANSWER RETURNS null -- a refusal, an outage, a transfer outside the scope, a bin the caller cannot see. The precheck then lets
// the command answer on its own authority, which is the point of "prechecks re-read; they do not decide". Nothing here guesses a state.
//
// `callOp(route, operation, input)` is INJECTED; the default loads the browser transport lazily, so this module is importable in plain node and the
// reads can be run against the real server's answers (functions/test/offlinePrecheckReadsPostgres.test.mjs).
const ROUTES = Object.freeze({ INVENTORY: "/operations/inventory", CYCLE_COUNT: "/operations/cycle-count" });

const defaultCallOp = async (route, operation, input) => (await import("../services/eosOperationsClient.js")).eosOperationOrThrow(route, operation, input);

/** @returns {{ readTransfer, readCycleCount, readBin }} the three reads, each resolving `null` when it cannot answer. */
export function createWarehousePrecheckReads(callOp = defaultCallOp) {
  const orNull = async (fn) => { try { return await fn(); } catch { return null; } };
  return Object.freeze({
    readTransfer: (transferOrderId) => orNull(async () => {
      const out = await callOp(ROUTES.INVENTORY, "listTransferOrders", {});
      const row = (out?.items ?? []).find((t) => t.transferOrderId === transferOrderId);
      return row ? { id: row.transferOrderId, status: row.status } : null;
    }),
    readCycleCount: (payload) => orNull(async () => {
      const out = await callOp(ROUTES.CYCLE_COUNT, "getCycleCountSheet", { sheetId: payload?.sheetId });
      const sheet = out?.sheet ?? null;
      if (!sheet) return null;
      // A sheet that is closed or cancelled has no countable line, whatever the line says.
      if (sheet.status === "CANCELLED" || sheet.status === "CLOSED") return { status: sheet.status };
      const line = (out?.lines ?? []).find((l) => l.partId === payload?.partId);
      return line ? { status: line.status } : null;
    }),
    readBin: (binId) => orNull(async () => {
      const out = await callOp(ROUTES.INVENTORY, "listInventoryLocations", {});
      const bin = (out?.items ?? []).find((i) => i.type === "BIN" && i.locationId === binId);
      return bin ? { id: bin.locationId, status: bin.status } : null;
    }),
  });
}
