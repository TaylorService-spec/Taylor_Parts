// The browser's route to the governed PostgreSQL COMMERCIAL reads.
//
//   browser -> THIS -> POST /commercial/sales (EOS trusted API, functions/src/eosCommercial/commercialHttp.ts)
//           -> verified bearer -> EOS Principal + tenant membership + Role capabilities
//           -> the exact C3 read, each one requiring its own capability -> PostgreSQL
//
// ════════════════════ WHY THIS FILE EXISTS (Wave 16 / Lane BQ) ════════════════════
//
// The C4 Commercial transport has been deployed and capability-scoped since wave C4, and no client
// could reach it: the browser's only governed Commercial reads were Firebase callables, and the
// metadata list runtime (metadata/callableListSource.js) can serve nothing else. That is the reason
// `listSalesAgreements` existed, correct and unreachable, while the server catalog carried
// `commercial.agreements` as a DESTINATION gap.
//
// ════════════════════ ONE AUTH SCHEME, REUSED -- AGAIN ════════════════════
//
// Base URL (VITE_EOS_API_BASE_URL) and the signed-in user's ID token come from the SAME seam the
// Administration, Workforce and Operations clients use (services/adminPolicyApiClient.js). The
// token is transitional session identity only: no claim in it is read, and nothing here states a
// tenant, a principal, a role or a capability. The server resolves all of that, and refuses a body
// that tries to state any of it.
//
// ════════════════════ NO FALLBACK. NOT ANYWHERE IN THIS FILE ════════════════════
//
// A refused, misconfigured or unreachable read is RETURNED as a value the caller renders. It is
// never retried against Firestore, never softened into an empty list, and never allowed to mean
// "assume the legacy role". An empty list and a refusal are different answers and this file never
// turns one into the other -- which matters especially here, because eos_commercial.sales_agreements
// is genuinely EMPTY in nonprod, so "no rows" is a state the screen must be able to state honestly
// without it ever being able to mean "we could not ask".
//
// ════════════════════ READS ONLY ════════════════════
//
// The closed list below is the server's READ_RUNNERS, mirrored so a typo fails here rather than as a
// 404. The C2 MUTATION runners are deliberately absent: Sales Agreement writes already have a
// client (services/salesAgreementCommandClient.js, over the Firebase command callables), and a
// second write path to the same object through a different transport is how two surfaces start
// disagreeing about what was committed. Nothing in this lane writes anything.
// ════════════════════ THE AUTH SEAM IS IMPORTED LAZILY ════════════════════
//
// `services/adminPolicyApiClient.js` imports `firebase/firebase.js` at module scope, which reads the
// build-time `__APP_FIREBASE_CONFIG__` and calls initializeApp. Importing it eagerly here would make
// this module -- and therefore domain-level tests of anything that touches it -- unloadable outside
// a Vite build, which is the same import-time side effect `services/salesAgreementCommandClient.js`
// already avoids and says so about itself.
//
// IT CHANGES NO BEHAVIOUR. The seam resolved is the identical one; it is resolved at CALL time, and
// only when the caller did not inject `baseUrl` / `getIdToken`. Nothing about which token is used or
// which base URL is reached moves.
const authSeam = () => import("./adminPolicyApiClient.js");

/** The one route the Commercial transport serves. Mirrors commercialHttp.ts COMMERCIAL_ROUTE. */
export const COMMERCIAL_ROUTE = "/commercial/sales";

/** Mirrors functions/src/eosCommercial/commercialHttp.ts READ_RUNNERS. Reads only -- see the header. */
export const COMMERCIAL_READ_OPERATIONS = Object.freeze([
  "getAccountCommercialProjection",
  "getOpportunityDetail",
  "getSalesAgreementDetail",
  "getSalesOrderDetail",
  "listOpportunities",
  "listSalesAgreements",
  "listSalesOrders",
]);

const READ_OPERATION_SET = new Set(COMMERCIAL_READ_OPERATIONS);

export const isCommercialReadOperation = (name) =>
  typeof name === "string" && READ_OPERATION_SET.has(name);

/** Every failure category a screen renders differently. Same vocabulary as the Operations client. */
export const COMMERCIAL_FAILURES = Object.freeze([
  "NOT_CONFIGURED",
  "NOT_SIGNED_IN",
  "UNKNOWN_OPERATION",
  "INVALID_INPUT",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "INTERNAL",
  "UNREACHABLE",
]);

const CATEGORY_BY_STATUS = Object.freeze({
  400: "INVALID_INPUT",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  405: "UNKNOWN_OPERATION",
  409: "INVALID_INPUT",
  413: "INVALID_INPUT",
});

const failure = (code, message, extra = {}) =>
  Object.freeze({ ok: false, code, message, reason: extra.reason ?? null, status: extra.status ?? null });

/** Map an HTTP status and the server's body code to one failure category. Pure; exported for tests. */
export function commercialFailureCategory(status, serverCode) {
  if (serverCode === "UNKNOWN_OPERATION") return "UNKNOWN_OPERATION";
  if (serverCode === "FORBIDDEN") return "FORBIDDEN";
  return CATEGORY_BY_STATUS[status] ?? "INTERNAL";
}

/**
 * Call one named Commercial READ.
 *
 * Returns `{ ok: true, operation, result }` or `{ ok: false, code, reason, status, message }`. It
 * never throws. `options`: baseUrl, getIdToken, tenantId, signal, fetchImpl, input -- all injectable
 * so the envelope can be proven without a network or a browser.
 */
export async function callCommercialApi(operation, options = {}) {
  if (!isCommercialReadOperation(operation)) {
    return failure("UNKNOWN_OPERATION", `"${operation}" is not a Commercial read operation`);
  }
  let rawBase = options.baseUrl;
  if (rawBase === undefined) {
    try {
      rawBase = (await authSeam()).policyApiBaseUrl();
    } catch {
      rawBase = null;
    }
  }
  const base = typeof rawBase === "string" && rawBase.trim().length > 0 ? rawBase.trim().replace(/\/+$/, "") : null;
  if (!base) {
    return failure("NOT_CONFIGURED", "no EOS API is configured for this environment (VITE_EOS_API_BASE_URL)");
  }

  let token;
  try {
    token = await (options.getIdToken ? options.getIdToken() : (await authSeam()).currentIdToken());
  } catch {
    token = null;
  }
  if (!token) return failure("NOT_SIGNED_IN", "sign in to reach the Commercial service");

  const doFetch = options.fetchImpl ?? (typeof fetch === "function" ? fetch : null);
  if (!doFetch) return failure("UNREACHABLE", "no network transport is available");

  let response;
  try {
    response = await doFetch(`${base}${COMMERCIAL_ROUTE}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        ...(options.tenantId ? { "x-eos-tenant": options.tenantId } : {}),
      },
      // `input` carries only the read's own options (limit, state, cursor). A tenant, principal,
      // capability or identity field here is REFUSED by the server rather than adopted, so there is
      // nothing a caller of this function could put in it that would widen anything.
      body: JSON.stringify({ operation, input: options.input ?? {} }),
      signal: options.signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") return failure("UNREACHABLE", "the request was cancelled");
    return failure("UNREACHABLE", "the Commercial service could not be reached");
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
    commercialFailureCategory(response.status, serverCode),
    body && typeof body.message === "string" ? body.message : `the Commercial service returned ${response.status}`,
    { reason: serverCode, status: response.status },
  );
}

/** The injectable seam hooks take. */
export const commercialApiClient = Object.freeze({ call: callCommercialApi });
