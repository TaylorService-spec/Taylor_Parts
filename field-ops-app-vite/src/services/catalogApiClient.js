// The browser's route to the governed PostgreSQL Catalog (Part Master, Part identity, Equipment Model).
//
//   browser -> THIS -> POST /operations/catalog (EOS trusted API, functions/src/catalogMaster/catalogHttp.ts)
//           -> verified bearer -> EOS Principal + tenant membership + capabilities -> PostgreSQL
//
// and NEVER browser -> Firestore for Part business data.
//
// ════════════════════ NO FALLBACK, IN ANY FORM ════════════════════
//
// There is no `catch -> read Firestore`, no "try Render first", no dual write and no retry against
// another authority. A refused or failed call is returned as a VALUE the screen renders. That is not
// defensiveness being omitted -- it is the whole point: a fallback works in every test and, in
// production, quietly keeps the retired authority answering for exactly the requests that failed,
// which is the one failure mode a cutover cannot detect from the inside.
//
// ════════════════════ ONE AUTH SCHEME, REUSED ════════════════════
//
// The base URL (VITE_EOS_API_BASE_URL) and the signed-in user's ID token come from the existing
// Administration API seam, the same way the Workforce client takes them. The token is transitional
// identity only: no claim in it is read here, and the SERVER resolves it to an EOS Principal. The
// tenant may be stated through `x-eos-tenant`, which the server checks against membership and never
// adopts.
//
// ════════════════════ THE CLOSED LIST, AND WHAT IS NOT ON IT ════════════════════
//
// Mirrored from the server's CATALOG_READ_OPERATIONS / CATALOG_MUTATION_OPERATIONS so a typo fails
// here rather than as a 404. There is deliberately NO operation that returns the whole catalogue:
// the Firestore client read it in full from six surfaces, and re-creating that over HTTP would move
// the cost rather than remove it. Every list is a bounded, keyset-paged `searchParts`.
import { currentIdToken, policyApiBaseUrl } from "./adminPolicyApiClient.js";

export const CATALOG_ROUTE = "/operations/catalog";

export const CATALOG_READ_OPERATIONS = Object.freeze([
  "readPart",
  "readPartsByIds",
  "searchParts",
  "countParts",
  "listPartAliases",
  "probePartAlias",
  "lookupScannedPart",
  "listEquipmentModels",
]);

export const CATALOG_MUTATION_OPERATIONS = Object.freeze([
  "createPart",
  "updatePart",
  "changePartStatus",
  "createPartAlias",
  "deactivatePartAlias",
  "reactivatePartAlias",
]);

const ALL = new Set([...CATALOG_READ_OPERATIONS, ...CATALOG_MUTATION_OPERATIONS]);
export const isCatalogOperation = (name) => typeof name === "string" && ALL.has(name);

const CATEGORY_BY_STATUS = Object.freeze({
  400: "INVALID_INPUT",
  401: "NOT_SIGNED_IN",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  412: "PRECONDITION_FAILED",
  503: "UNAVAILABLE",
});

const failure = (code, message, extra = {}) =>
  Object.freeze({ ok: false, code, message, reason: extra.reason ?? null, status: extra.status ?? null });

/** Map an HTTP status and the server's body code to one failure category. Pure; exported for tests. */
export function catalogFailureCategory(status, serverCode) {
  if (serverCode === "UNKNOWN_OPERATION" || serverCode === "METHOD_NOT_ALLOWED") return "UNKNOWN_OPERATION";
  return CATEGORY_BY_STATUS[status] ?? "INTERNAL";
}

export async function callCatalogApi(operation, input = undefined, options = {}) {
  if (!isCatalogOperation(operation)) {
    return failure("UNKNOWN_OPERATION", `"${operation}" is not a Catalog operation`);
  }
  const rawBase = options.baseUrl === undefined ? policyApiBaseUrl() : options.baseUrl;
  const base = typeof rawBase === "string" && rawBase.trim().length > 0 ? rawBase.trim().replace(/\/+$/, "") : null;
  if (!base) {
    return failure("NOT_CONFIGURED", "no EOS API is configured for this environment (VITE_EOS_API_BASE_URL)");
  }

  let token;
  try {
    token = await (options.getIdToken ? options.getIdToken() : currentIdToken());
  } catch {
    token = null;
  }
  if (!token) return failure("NOT_SIGNED_IN", "sign in to reach the Catalog service");

  const envelope = input === undefined ? { operation } : { operation, input };
  const doFetch = options.fetchImpl ?? (typeof fetch === "function" ? fetch : null);
  if (!doFetch) return failure("UNREACHABLE", "no network transport is available");

  let response;
  try {
    response = await doFetch(`${base}${CATALOG_ROUTE}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        ...(options.tenantId ? { "x-eos-tenant": options.tenantId } : {}),
      },
      body: JSON.stringify(envelope),
      signal: options.signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") return failure("UNREACHABLE", "the request was cancelled");
    // AND THAT IS THE END OF IT. No second source is consulted here.
    return failure("UNREACHABLE", "the Catalog service could not be reached");
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (response.ok && body && body.ok === true) {
    return Object.freeze({ ok: true, operation, result: body.result });
  }
  const serverCode = body && typeof body.code === "string" ? body.code : null;
  return failure(
    catalogFailureCategory(response.status, serverCode),
    body && typeof body.message === "string" ? body.message : `the Catalog service returned ${response.status}`,
    { reason: serverCode, status: response.status },
  );
}

/** The injectable seam pages, hooks and services take. */
export const catalogApiClient = Object.freeze({ call: callCatalogApi });
