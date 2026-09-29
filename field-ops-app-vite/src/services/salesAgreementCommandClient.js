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

// ════════════════════ PRODUCT REFERENCE SEARCH, AFTER THE CATALOG ACTIVATION ════════════════════
//
// This used to call the Firebase `searchProductReferences` callable, which reads the Firestore `parts` and
// `equipment_models` collections. At the Catalog activation (CATALOG_WRITER_AUTHORITY FROZEN/ACTIVE) those
// collections became a FROZEN SNAPSHOT: PostgreSQL is the Catalog authority, and the EOS Commercial commands
// validate a PART / EQUIPMENT_MODEL line reference against PostgreSQL inside their own transaction. A picker
// that kept offering Firestore's copy would present retired data as current, and could offer a reference the
// governed command then refuses. The callable is therefore NOT reached from here any more, for either kind.
//
//   PART             -> the governed Render Catalog read `searchParts` (services/catalogApiClient.js).
//   EQUIPMENT_MODEL  -> REFUSED, with no read at all. The PostgreSQL Catalog transport serves no Equipment
//                       Model list yet, and a governed one is not invented here (its authorization is a
//                       decision, not a port). The picker renders its honest "unavailable" state.
//
// Same `{ result } | { errorStatus }` contract and the same result shape the picker renders
// ({ status, kind, results: [{ ref, kind, displayName, status }], truncated }). No Firebase fallback.
import { catalogApiClient } from "./catalogApiClient.js";

/** The picker's page size, and the ceiling a caller may ask for. Mirrors the retired callable's bounds. */
export const PRODUCT_SEARCH_DEFAULT_LIMIT = 20;
export const PRODUCT_SEARCH_MAX_LIMIT = 50;
/** Stated when a kind has no current authority to search. The hook renders it as UNAVAILABLE. */
export const PRODUCT_SEARCH_AUTHORITY_UNAVAILABLE = "catalog-authority-unavailable";

const catalogErrorStatus = (res) =>
  res?.code === "FORBIDDEN" || res?.code === "NOT_SIGNED_IN" || res?.code === "UNAUTHENTICATED"
    ? "permission-denied"
    : "unavailable";

export async function searchProductReferences({ kind, query, limit }, { client = catalogApiClient } = {}) {
  if (kind === "EQUIPMENT_MODEL") return { errorStatus: PRODUCT_SEARCH_AUTHORITY_UNAVAILABLE };
  if (kind !== "PART") return { errorStatus: "invalid-argument" };
  const requested = Number.isSafeInteger(limit) ? limit : PRODUCT_SEARCH_DEFAULT_LIMIT;
  const bounded = Math.min(Math.max(requested, 1), PRODUCT_SEARCH_MAX_LIMIT);
  const res = await client.call("searchParts", { query: String(query ?? "").trim(), limit: bounded });
  if (!res?.ok) return { errorStatus: catalogErrorStatus(res) };
  const parts = Array.isArray(res.result?.parts) ? res.result.parts : null;
  if (parts === null) return { errorStatus: "unavailable" };
  const results = parts
    .filter((p) => p && typeof p.id === "string" && p.id !== "")
    .map((p) => ({
      ref: p.id,
      kind: "PART",
      // The Part's NAME is display only; the ref is the identity the line stores.
      displayName: typeof p.name === "string" && p.name.trim() !== "" ? p.name : null,
      status: typeof p.status === "string" ? p.status : null,
    }));
  return { result: { status: "ready", kind: "PART", results, truncated: res.result?.nextCursor != null } };
}
