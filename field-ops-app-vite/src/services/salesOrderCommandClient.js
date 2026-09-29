// Sales Order commands -- over the governed PostgreSQL Commercial transport (Pass 11 Retail Sales journey).
//
// transitionSalesOrder (ADVANCE / CANCEL) was the Firebase callable of the same name; it is now POST /commercial/sales
// `transitionSalesOrder` (functions/src/eosCommercial/commands/salesOrderCommandService.ts), decided by the caller's
// governed capability, idempotent on the caller's key. Never throws: `{ result }` or `{ errorStatus }` in the error
// vocabulary domain/salesOrderActions.js already renders.
//
// ALLOCATE and CREATE SERVICE are the HELD downstream boundary (Owner ruling D2): PostgreSQL governs no allocation,
// reservation or service Work Order lineage yet, and a Sales Order in eos_commercial is not a Firestore order the
// legacy commands could act on. They refuse honestly here ("failed-precondition") and the screen does not offer them
// for an order whose downstream execution is not tracked (view.downstreamTracked === false).
import { commercialApiClient } from "./commercialApiClient.js";
import { legacyErrorStatus } from "./commercialEosAdapters.js";

// idempotencyKey is REQUIRED and is carried through VERBATIM -- the caller (hooks/useSalesOrderActions.js) generates it
// once per user intent and reuses it across a retry.
export async function transitionSalesOrder({ salesOrderId, transition, idempotencyKey }, { client = commercialApiClient } = {}) {
  const answer = await client.call("transitionSalesOrder", { input: { salesOrderId, transition, idempotencyKey } });
  return answer.ok ? { result: answer.result } : { errorStatus: legacyErrorStatus(answer) };
}

const HELD = Object.freeze({ errorStatus: "failed-precondition" });

/** Held downstream boundary: allocation is not governed in PostgreSQL yet (D2). */
export async function allocateSalesOrder() {
  return HELD;
}

/** Held downstream boundary: service Work Order creation waits for the governed Work Order lane (D2). */
export async function createServiceForSalesOrder() {
  return HELD;
}

export const salesOrderCommandClient = Object.freeze({
  transitionSalesOrder,
  allocateSalesOrder,
  createServiceForSalesOrder,
});
