// Opportunity detail read -- over the governed PostgreSQL Commercial transport (Pass 11 Retail Sales journey).
//
// Was the Firebase `getOpportunityContext` callable. The Opportunity now lives in eos_commercial, read through
// POST /commercial/sales `getOpportunityDetail` (the server's governed Commercial read layer) with the
// caller's own identity; the EOS projection is translated to the page's existing context shape by
// services/commercialEosAdapters.js. Same contract as before: `{ result }` ("ready" | "not-found") or
// `{ errorStatus: "denied" | "unavailable" }`, never throws, no fallback to Firestore.
import { commercialApiClient } from "./commercialApiClient.js";
import { readErrorStatus, toOpportunityContextResult } from "./commercialEosAdapters.js";

export async function fetchOpportunityContext(opportunityId, { client = commercialApiClient } = {}) {
  const answer = await client.call("getOpportunityDetail", { input: { opportunityId } });
  if (answer.ok) return { result: toOpportunityContextResult(answer.result) };
  const status = readErrorStatus(answer);
  if (status === "not-found") return { result: toOpportunityContextResult(null) };
  return { errorStatus: status };
}
