// Account-scoped Sales Order read -- over the governed PostgreSQL Commercial transport (Pass 11 Retail Sales journey).
//
// Was the Firebase `listSalesOrdersForAccount` callable. Now POST /commercial/sales `listSalesOrders` with `accountId`
// (the caller's own governed reach), projected to the same { status, salesOrders, truncated } envelope by
// services/commercialEosAdapters.js. Same contract: { result } or { errorStatus: "denied" | "unavailable" }; never
// throws; no Firestore fallback.
import { commercialApiClient } from "./commercialApiClient.js";
import { readCommercialList, readErrorStatus, toLegacyListPayload } from "./commercialEosAdapters.js";

export async function fetchAccountSalesOrders(accountId, { limit, client = commercialApiClient } = {}) {
  const answer = await readCommercialList(client, "listSalesOrders", { accountId, cap: Number.isInteger(limit) && limit > 0 ? limit : 200 });
  if (answer.ok) return { result: toLegacyListPayload("salesOrder", answer.items, answer.truncated) };
  return { errorStatus: readErrorStatus(answer) === "denied" ? "denied" : "unavailable" };
}
