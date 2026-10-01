// Cycle Count -- the EOS transport (Controller INVENTORY / WAREHOUSE COMPLETION RULINGS, 2026-10-01).
//
// WAS a thin httpsCallable transport over the Firebase sheet / line callables. The authority moved to PostgreSQL:
// POST /operations/cycle-count (functions/src/eosOps/cycleCountOperations.ts). The SAME method names and the SAME
// request shapes (domain/cycleCountCommandRequest.js builds them); the server re-authorizes every call (capability +
// Warehouse Operations eligibility + WAREHOUSE scope) and owns the blind rule, the separation of duties and the
// governed ADJUSTED movement. This module only adapts the EOS projection to the shape the screens already render:
//
//   * createCycleCountSheet answers { outcome, sheet }; the screens read the sheet's own fields (sheetId, location).
//   * getCycleCountSheet answers { sheet, lines } in one read (no cursor).
//   * a SERIAL line's missing / unexpected serials are derived from the expected and counted serials the server
//     revealed for a SUBMITTED line -- the same two lists, never an invented figure.
//
// TRUCKS ARE OUT OF SCOPE (Controller: Truck Inventory is a separate journey). The Firebase
// `getCycleCountAssignedMobileLocation` read is not carried over, so the scan screen's technician-truck branch stays
// dormant (it is optional-chained on the client) and counting is WAREHOUSE / BIN only.
//
// No Firebase fallback: a refusal (NOT_ACTIVATED included) is thrown as the platform's answer.
import { EOS_OPERATIONS_ROUTES, eosOperationOrThrow } from "./eosOperationsClient.js";

export const CYCLE_COUNT_OPERATIONS = Object.freeze({
  createSheet: "createCycleCountSheet",
  openLine: "openCycleCountLine",
  submitLine: "submitCycleCountLine",
  reconcileLine: "reconcileCycleCountLine",
  cancelLine: "cancelCycleCountLine",
  cancelSheet: "cancelCycleCountSheet",
  closeSheet: "closeCycleCountSheet",
  listSheets: "listCycleCountSheets",
  getSheet: "getCycleCountSheet",
});

const call = (operation, input) => eosOperationOrThrow(EOS_OPERATIONS_ROUTES.CYCLE_COUNT, operation, input, { serviceLabel: "the cycle count service" });

/** Missing / unexpected serials of a revealed SERIAL line. Pure; exported for tests. */
export function withSerialVariance(line) {
  if (!line || line.trackingMode !== "SERIAL" || !Array.isArray(line.expectedSerialNumbers)) return line;
  const counted = new Set(line.countedSerialNumbers ?? []);
  const expected = new Set(line.expectedSerialNumbers);
  return Object.freeze({
    ...line,
    serialVariance: Object.freeze({
      missing: line.expectedSerialNumbers.filter((s) => !counted.has(s)),
      unexpected: (line.countedSerialNumbers ?? []).filter((s) => !expected.has(s)),
    }),
  });
}

export const cycleCountCommandClient = Object.freeze({
  createCycleCountSheet: async (request) => {
    const out = await call(CYCLE_COUNT_OPERATIONS.createSheet, request);
    return Object.freeze({ ...(out?.sheet ?? {}), outcome: out?.outcome ?? null });
  },
  openCycleCountLine: async (request) => {
    const out = await call(CYCLE_COUNT_OPERATIONS.openLine, request);
    return Object.freeze({ ...out, line: withSerialVariance(out?.line) });
  },
  submitCycleCountLine: async (request) => {
    const out = await call(CYCLE_COUNT_OPERATIONS.submitLine, request);
    return Object.freeze({ ...out, status: out?.line?.status ?? null, line: withSerialVariance(out?.line) });
  },
  reconcileCycleCountLine: (request) => call(CYCLE_COUNT_OPERATIONS.reconcileLine, request),
  cancelCycleCountLine: (request) => call(CYCLE_COUNT_OPERATIONS.cancelLine, request),
  cancelCycleCountSheet: (request) => call(CYCLE_COUNT_OPERATIONS.cancelSheet, request),
  closeCycleCountSheet: (request) => call(CYCLE_COUNT_OPERATIONS.closeSheet, request),
  // The EOS list is one scope-filtered page (cap 200, `truncated` disclosed); there is no cursor to follow.
  listCycleCountSheets: async (request = {}) => {
    const out = await call(CYCLE_COUNT_OPERATIONS.listSheets, request.status ? { status: request.status } : {});
    return Object.freeze({ sheets: out?.sheets ?? [], nextCursor: null, truncated: out?.truncated === true });
  },
  getCycleCountSheet: async (request) => {
    const out = await call(CYCLE_COUNT_OPERATIONS.getSheet, { sheetId: request.sheetId });
    return Object.freeze({ sheet: out?.sheet ?? null, lines: (out?.lines ?? []).map(withSerialVariance), nextCursor: null });
  },
});
