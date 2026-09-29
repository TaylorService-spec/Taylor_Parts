// Sales Order detail read -- over the governed PostgreSQL Commercial transport (Pass 11 Retail Sales journey).
//
// Was the Firebase `getSalesOrderContext` callable. The Sales Order now lives in eos_commercial, read through
// POST /commercial/sales `getSalesOrderDetail` (the server's governed Commercial read layer). Same
// contract as before: `{ result }` ({status, salesOrder}, "ready" | "not-found") or `{ errorStatus: "denied" |
// "unavailable" }`, never throws, no fallback to Firestore. Downstream execution facts (allocation, fulfillment,
// billing, service Work Orders) are not carried -- that boundary is held (Owner ruling D2).
import { commercialApiClient } from "./commercialApiClient.js";
import { readErrorStatus, toSalesOrderContextResult } from "./commercialEosAdapters.js";

export async function fetchSalesOrderContext(salesOrderId, { client = commercialApiClient } = {}) {
  const answer = await client.call("getSalesOrderDetail", { input: { salesOrderId } });
  if (answer.ok) return { result: toSalesOrderContextResult(answer.result) };
  const status = readErrorStatus(answer);
  if (status === "not-found") return { result: toSalesOrderContextResult(null) };
  return { errorStatus: status };
}
