// Account-scoped Opportunity read -- over the governed PostgreSQL Commercial transport (Pass 11 Retail Sales journey).
//
// Was the Firebase `listOpportunitiesForAccount` callable. Now POST /commercial/sales `listOpportunities` with
// `accountId` (the caller's own governed reach), projected to the same { status, opportunities, truncated } envelope by
// services/commercialEosAdapters.js. Same contract: { result } or { errorStatus: "denied" | "unavailable" }; never
// throws; no Firestore fallback.
import { commercialApiClient } from "./commercialApiClient.js";
import { readCommercialList, readErrorStatus, toLegacyListPayload } from "./commercialEosAdapters.js";

export async function fetchAccountOpportunities(accountId, { limit, client = commercialApiClient } = {}) {
  const answer = await readCommercialList(client, "listOpportunities", { accountId, cap: Number.isInteger(limit) && limit > 0 ? limit : 200 });
  if (answer.ok) return { result: toLegacyListPayload("opportunity", answer.items, answer.truncated) };
  return { errorStatus: readErrorStatus(answer) === "denied" ? "denied" : "unavailable" };
}
