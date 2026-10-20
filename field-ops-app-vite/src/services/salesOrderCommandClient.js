// Sales Order commands -- over the governed PostgreSQL Commercial transport (Pass 11 Retail Sales journey) and, for stock allocation, the
// EOS Operations transport (S1c).
//
// transitionSalesOrder (ADVANCE / CANCEL) was the Firebase callable of the same name; it is now POST /commercial/sales
// `transitionSalesOrder` (functions/src/eosCommercial/commands/salesOrderCommandService.ts), decided by the caller's
// governed capability, idempotent on the caller's key. Never throws: `{ result }` or `{ errorStatus }` in the error
// vocabulary domain/salesOrderActions.js already renders.
//
// ALLOCATE / RELEASE / READ ALLOCATIONS (S1c; DECISIONS #S1c) are POST /operations/inventory `allocateSalesOrderLine` /
// `releaseSalesOrderAllocation` / `readSalesOrderAllocations` (functions/src/eosOps/salesOrderAllocation.ts): a hard stock reservation of
// ONE line's quantity at a warehouse and company the caller STATES. The client names no capability and decides nothing; the server re-decides
// every call and the screen offers exactly what the read states. A GOVERNED refusal (denied / not found / invalid / conflict / precondition)
// carries the server's own sentence in `message`; any other failure is a bounded status with NO server text.
//
// CREATE SERVICE is still the HELD downstream boundary (Owner ruling D2): PostgreSQL governs no service Work Order lineage yet.
import { commercialApiClient } from "./commercialApiClient.js";
import { legacyErrorStatus } from "./commercialEosAdapters.js";

// idempotencyKey is REQUIRED and is carried through VERBATIM -- the caller (hooks/useSalesOrderActions.js) generates it
// once per user intent and reuses it across a retry.
export async function transitionSalesOrder({ salesOrderId, transition, idempotencyKey }, { client = commercialApiClient } = {}) {
  const answer = await client.call("transitionSalesOrder", { input: { salesOrderId, transition, idempotencyKey } });
  return answer.ok ? { result: answer.result } : { errorStatus: legacyErrorStatus(answer) };
}

const HELD = Object.freeze({ errorStatus: "failed-precondition" });

// The Operations transport is imported LAZILY, on the first real call (reorderApiClient.js reaches the Firebase-era token seam); this module
// stays importable and unit-testable without initializing anything.
const callOperationsApi = async (...args) => (await import("./reorderApiClient.js")).callReorderApi(...args);

const GOVERNED = new Set(["FORBIDDEN", "NOT_FOUND", "INVALID_INPUT", "CONFLICT", "PRECONDITION_FAILED"]);
const isNonBlank = (v) => typeof v === "string" && v.trim() !== "";

async function callOp(operation, input, call) {
  try {
    const res = await call(operation, input);
    if (res?.ok) return { result: res.result };
    const errorStatus = legacyErrorStatus(res);
    const governed = GOVERNED.has(res?.code) && isNonBlank(res?.message);
    return governed ? { errorStatus, message: res.message } : { errorStatus };
  } catch {
    return { errorStatus: "unavailable" };
  }
}

/**
 * Allocate stock to ONE Sales Order line: a hard reservation of `quantity` of `partId` at `warehouseId`, in company `operatingCompanyId`.
 * Company and warehouse are STATED by the caller, never derived. `{ result }` or `{ errorStatus, message? }`; never throws.
 * A call missing the line, company, warehouse, Part, quantity or key is refused here (invalid-argument) without a request.
 */
export async function allocateSalesOrder(
  { salesOrderId, lineNumber, operatingCompanyId, warehouseId, partId, quantity, idempotencyKey } = {},
  { call = callOperationsApi } = {},
) {
  if (!isNonBlank(salesOrderId) || !Number.isInteger(lineNumber) || !isNonBlank(operatingCompanyId) || !isNonBlank(warehouseId)
      || !isNonBlank(partId) || !Number.isInteger(quantity) || quantity <= 0 || !isNonBlank(idempotencyKey)) {
    return { errorStatus: "invalid-argument" };
  }
  return callOp("allocateSalesOrderLine", { salesOrderId, lineNumber, operatingCompanyId, warehouseId, partId, quantity, idempotencyKey }, call);
}

/**
 * Release a line's allocation at a warehouse (all of it, or `quantity` of it). A reason is required. Same shape and refusals as allocate.
 */
export async function releaseSalesOrderAllocation(
  { salesOrderId, lineNumber, operatingCompanyId, warehouseId, quantity, reason, idempotencyKey } = {},
  { call = callOperationsApi } = {},
) {
  if (!isNonBlank(salesOrderId) || !Number.isInteger(lineNumber) || !isNonBlank(operatingCompanyId) || !isNonBlank(warehouseId)
      || !isNonBlank(reason) || !isNonBlank(idempotencyKey) || (quantity !== undefined && (!Number.isInteger(quantity) || quantity <= 0))) {
    return { errorStatus: "invalid-argument" };
  }
  return callOp("releaseSalesOrderAllocation", {
    salesOrderId, lineNumber, operatingCompanyId, warehouseId, reason: reason.trim(), idempotencyKey, ...(quantity === undefined ? {} : { quantity }),
  }, call);
}

/** The allocations on one order: per line, what is allocated (and where, within the caller's scope), the warehouses the caller may allocate from, and what they may do. */
export async function readSalesOrderAllocations({ salesOrderId } = {}, { call = callOperationsApi } = {}) {
  if (!isNonBlank(salesOrderId)) return { errorStatus: "invalid-argument" };
  const answer = await callOp("readSalesOrderAllocations", { salesOrderId }, call);
  // A malformed answer is UNAVAILABLE, never a partially trusted list.
  if (answer.result !== undefined && !Array.isArray(answer.result?.lines)) return { errorStatus: "unavailable" };
  return answer;
}

/** Held downstream boundary: service Work Order creation waits for the governed Work Order lane (D2). */
export async function createServiceForSalesOrder() {
  return HELD;
}

export const salesOrderCommandClient = Object.freeze({
  transitionSalesOrder,
  allocateSalesOrder,
  releaseSalesOrderAllocation,
  readSalesOrderAllocations,
  createServiceForSalesOrder,
});
