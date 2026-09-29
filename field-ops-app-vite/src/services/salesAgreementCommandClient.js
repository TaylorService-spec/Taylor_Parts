// PASS 11 RETAIL SALES: the Sales Agreement commands and reads moved from the Firebase callables to the governed
// PostgreSQL Commercial transport (POST /commercial/sales -- functions/src/eosCommercial/commands/
// salesAgreementCommandService.ts and reads/the server's Sales Agreement read), because the Opportunity they belong to now
// lives in eos_commercial. Same `{ result } | { errorStatus }` contract; reads return the same { status, salesAgreement }
// envelope through services/commercialEosAdapters.js. No fallback to the callables.
// Never throws: { result } on success or { errorStatus } in the callable-era vocabulary the domain layer renders.
// The ONE remaining Firebase call below (searchProductReferences, the product picker) is the held catalog boundary: it
// moves when the PostgreSQL catalog authority is activated (Catalog lane), not before.
import { commercialApiClient } from "./commercialApiClient.js";
import { legacyErrorStatus, readErrorStatus, toSalesAgreementReadResult } from "./commercialEosAdapters.js";

const command = async (operation, input, client = commercialApiClient) => {
  const answer = await client.call(operation, { input });
  return answer.ok ? { result: answer.result } : { errorStatus: legacyErrorStatus(answer) };
};

const readAgreement = async (salesAgreementId, client) => {
  const answer = await client.call("getSalesAgreementDetail", { input: { salesAgreementId } });
  if (answer.ok) return { result: toSalesAgreementReadResult(answer.result) };
  const status = readErrorStatus(answer);
  return status === "not-found" ? { result: toSalesAgreementReadResult(null) } : { errorStatus: status === "denied" ? "permission-denied" : "unavailable" };
};

export const createSalesAgreement = (payload, { client } = {}) => command("createSalesAgreement", payload, client);
export const updateSalesAgreementDraft = (payload, { client } = {}) => command("updateSalesAgreementDraft", payload, client);
export const acceptSalesAgreement = ({ salesAgreementId, idempotencyKey }, { client } = {}) =>
  command("acceptSalesAgreement", { salesAgreementId, idempotencyKey }, client);
export const getSalesAgreementContext = ({ salesAgreementId }, { client = commercialApiClient } = {}) =>
  readAgreement(salesAgreementId, client);

/** By Opportunity: the Agreement is DERIVED from its own foreign key, reached through the Opportunity's lineage. */
export async function getSalesAgreementForOpportunity({ opportunityId }, { client = commercialApiClient } = {}) {
  const opp = await client.call("getOpportunityDetail", { input: { opportunityId } });
  if (!opp.ok) {
    const status = readErrorStatus(opp);
    return status === "not-found" ? { result: toSalesAgreementReadResult(null) } : { errorStatus: status === "denied" ? "permission-denied" : "unavailable" };
  }
  const agreementId = opp.result?.salesAgreement?.id ?? null;
  if (!agreementId) return { result: toSalesAgreementReadResult(null) };
  return readAgreement(agreementId, client);
}

// Product reference search for Agreement lines stays on its existing Firebase catalog read UNTIL the PostgreSQL catalog
// authority is governed: the EOS Commercial commands refuse PART / EQUIPMENT_MODEL lines with
// CATALOG_AUTHORITY_UNAVAILABLE until then, so this picker cannot yet feed a governed write (recorded for Controller).
async function invokeCatalogSearch(payload) {
  const [{ httpsCallable }, { functions }] = await Promise.all([
    import("firebase/functions"),
    import("../firebase/firebase.js"),
  ]);
  try {
    const res = await httpsCallable(functions, "searchProductReferences")(payload);
    return { result: res?.data };
  } catch (err) {
    const raw = err && typeof err.code === "string" ? err.code : "";
    return { errorStatus: (raw.startsWith("functions/") ? raw.slice("functions/".length) : raw) || "internal" };
  }
}
export const searchProductReferences = ({ kind, query, limit }) => invokeCatalogSearch({ kind, query, limit });
