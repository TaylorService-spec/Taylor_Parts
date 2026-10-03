// PASS 11 RETAIL SALES: the Sales Agreement commands and reads moved from the Firebase callables to the governed
// PostgreSQL Commercial transport (POST /commercial/sales -- functions/src/eosCommercial/commands/
// salesAgreementCommandService.ts and reads/the server's Sales Agreement read), because the Opportunity they belong to now
// lives in eos_commercial. Same `{ result } | { errorStatus }` contract; reads return the same { status, salesAgreement }
// envelope through services/commercialEosAdapters.js. No fallback to the callables.
// Never throws: { result } on success or { errorStatus } in the callable-era vocabulary the domain layer renders.
// The product picker (searchProductReferences, below) reads the governed PostgreSQL Catalog through the Render Catalog
// transport since the Catalog activation (2026-09-30); there is no Firebase call left in this module.
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
// Owner ruling #204: an approver (Owner / General Manager) decides a PROPOSED trade-in -- approving assigns the value.
export const approveSalesAgreementTradeIn = ({ salesAgreementId, itemNumber, approvedCreditMinor, reason, idempotencyKey }, { client } = {}) =>
  command("approveSalesAgreementTradeIn", { salesAgreementId, itemNumber, approvedCreditMinor, ...(reason ? { reason } : {}), idempotencyKey }, client);
export const declineSalesAgreementTradeIn = ({ salesAgreementId, itemNumber, reason, idempotencyKey }, { client } = {}) =>
  command("declineSalesAgreementTradeIn", { salesAgreementId, itemNumber, reason, idempotencyKey }, client);
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
//   EQUIPMENT_MODEL  -> the governed Render Catalog read `listEquipmentModels` (DQ-030): eos_ops.equipment_models,
//                       bounded, listed whole up to its cap because models are reference data.
//
// BOTH reads are authorized SERVER-SIDE on `inventory.catalog.read` (DQ-031). A refusal renders as the picker's
// DENIED state and an unreachable/failed service as UNAVAILABLE -- never as an empty catalogue.
//
// Same `{ result } | { errorStatus }` contract and the same result shape the picker renders
// ({ status, kind, results: [{ ref, kind, displayName, status }], truncated }). No Firebase fallback.

// THE CATALOG SEAM IS IMPORTED LAZILY, exactly as commercialApiClient imports its auth seam: catalogApiClient.js
// pulls adminPolicyApiClient.js, which imports firebase/firebase.js at module scope (build-time config +
// initializeApp). An eager import made this module -- and every domain test of a hook that reaches it -- unloadable
// outside a Vite build. Resolved at CALL time; the transport reached is the identical one.
const catalogApiClient = Object.freeze({
  call: async (operation, input) => (await import("./catalogApiClient.js")).catalogApiClient.call(operation, input),
});

/** The picker's page size, and the ceiling a caller may ask for. Mirrors the retired callable's bounds. */
export const PRODUCT_SEARCH_DEFAULT_LIMIT = 20;
export const PRODUCT_SEARCH_MAX_LIMIT = 50;

const catalogErrorStatus = (res) =>
  res?.code === "FORBIDDEN" || res?.code === "NOT_SIGNED_IN" || res?.code === "UNAUTHENTICATED"
    ? "permission-denied"
    : "unavailable";

export async function searchProductReferences({ kind, query, limit }, { client = catalogApiClient } = {}) {
  if (kind === "EQUIPMENT_MODEL") return listEquipmentModelReferences(client);
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

/**
 * The Equipment Model picker's list (DQ-030). One bounded read; `truncated` is the server's own statement that
 * more models exist than one page, so the picker can say so rather than imply the list is complete.
 */
async function listEquipmentModelReferences(client) {
  const res = await client.call("listEquipmentModels", {});
  if (!res?.ok) return { errorStatus: catalogErrorStatus(res) };
  const models = Array.isArray(res.result?.models) ? res.result.models : null;
  if (models === null) return { errorStatus: "unavailable" };
  const text = (v) => (typeof v === "string" && v.trim() !== "" ? v : null);
  const results = models
    .filter((m) => m && typeof m.id === "string" && m.id !== "")
    .map((m) => ({
      ref: m.id,
      kind: "EQUIPMENT_MODEL",
      // Display only; never the identity. modelNumber is the fallback a human still recognises.
      displayName: text(m.displayName) ?? text(m.modelNumber),
      status: typeof m.status === "string" ? m.status : null,
    }));
  return { result: { status: "ready", kind: "EQUIPMENT_MODEL", results, truncated: res.result?.nextCursor != null } };
}
