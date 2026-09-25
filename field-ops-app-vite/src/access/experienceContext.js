// THE EOS PRINCIPAL EXPERIENCE CONTEXT, PROJECTED FOR THE CLIENT.
//
// Pure. No React, no network, no Firebase. It turns the server's `resolveMyExperienceContext` answer
// into the one value navigation reads, and it decides NOTHING about access -- the granted surface
// list arrives already decided by functions/src/eosOps/experienceAuthority.ts, which composed it
// from eos_policy.role_capabilities, eos_workforce.employee_work_eligibility and
// eos_workforce.employee_operational_scopes.
//
// ════════════════════ WHY THE VOCABULARY IS MIRRORED HERE ════════════════════
//
// EXPERIENCE_SURFACE_KEYS is the client-side copy of the server's catalog keys. It exists for one
// reason: a surface key the client does not recognise must be DROPPED rather than trusted, so a
// server that starts naming something this bundle has never heard of cannot silently light up a
// destination whose screen was never built for it. Parity with the server list is asserted by
// functions/test/personaNavigationProjection.test.mjs, so the mirror cannot drift unnoticed.
//
// ════════════════════ FAIL CLOSED, AND SAY WHICH KIND OF CLOSED ════════════════════
//
// There are three different "you see nothing" states and they must never be collapsed:
//
//   LOADING    the answer has not arrived. Show nothing yet; do not show a refusal.
//   REFUSED    the server answered and this principal holds no surface. That is an ANSWER.
//   UNAVAILABLE the server could not be reached, is not configured, or replied with something this
//              bundle cannot read. NOT an answer -- and specifically NOT permission to fall back to
//              `users/{uid}.role`. A silent degrade to the legacy role is the defect, not the cure.
//
// All three grant nothing. Only READY grants anything, and only what the server listed.

/** Mirrors functions/src/eosOps/experienceAuthority.ts EXPERIENCE_SURFACE_KEYS. */
export const EXPERIENCE_SURFACE_KEYS = Object.freeze([
  "administration.auditLogs",
  "administration.dataImport",
  // The governed-configuration half of Administration. `administration.overview` is the CONTAINER
  // over the others (server-side it declares no grant path of its own and is derived from them), and
  // it is mirrored here like any other key: the client still only ever projects what the server
  // listed, so nothing about how it was earned is re-decided on this side.
  "administration.objects",
  "administration.overview",
  "administration.permissionPreview",
  "administration.rolesPermissions",
  "administration.users",
  "administration.workflows",
  // Sales Agreements. Mirrored like every other key -- the client still only ever projects what the
  // server listed, and `salesAgreement.read` is decided in one place (experienceAuthority.ts), never
  // here. It joined the catalog in the same change that built its door (Wave 16 / Lane BQ); before
  // that it was a declared DESTINATION gap precisely because no destination showed it.
  "commercial.agreements",
  "commercial.opportunities",
  "commercial.salesOrders",
  "crm.accounts",
  "equipment.register",
  "field.myWorkOrders",
  "financials.invoices",
  "financials.payments",
  "inventory.balances",
  "inventory.catalog",
  "inventory.catalogAdmin",
  "inventory.cycleCount.count",
  "inventory.cycleCount.review",
  "inventory.reorderQueue",
  "inventory.transfers",
  "purchasing.purchaseOrders",
  "receiving.checkIn",
  "service.coordinatedVisits",
  "service.dispatch",
  "service.workOrders",
  "warehouse.management",
  "warehouse.picking",
]);

const KNOWN_SURFACES = new Set(EXPERIENCE_SURFACE_KEYS);

export const EXPERIENCE_STATE = Object.freeze({
  LOADING: "LOADING",
  READY: "READY",
  REFUSED: "REFUSED",
  UNAVAILABLE: "UNAVAILABLE",
});

/** The sentence a person reads when the EOS source cannot answer. One place, so it cannot drift. */
export const EXPERIENCE_UNAVAILABLE_REASON =
  "Your access could not be read from the governed source, so nothing is being shown. This is not a sign-in problem and it is not a permission decision -- retry, and report it if it persists.";

/**
 * Turn one `resolveMyExperienceContext` result into the projection, or null if it is unreadable.
 *
 * MALFORMED IS NOT EMPTY. A body that is not the expected shape returns null, which the caller must
 * treat as UNAVAILABLE -- never as "this principal holds nothing". Silently reading a broken payload
 * as an empty grant would report a transport fault as an authorization outcome.
 */
export function experienceContextFrom(result) {
  if (!result || typeof result !== "object") return null;
  const { tenantId, principalId, securityRoleKeys, employeeId, workEligibility, operationalScopes, surfaces } = result;
  if (typeof tenantId !== "string" || tenantId.length === 0) return null;
  if (typeof principalId !== "string" || principalId.length === 0) return null;
  if (!Array.isArray(surfaces) || !Array.isArray(securityRoleKeys)) return null;
  if (!Array.isArray(workEligibility) || !Array.isArray(operationalScopes)) return null;
  if (employeeId !== null && typeof employeeId !== "string") return null;

  // An unrecognised surface key is dropped, not trusted. Recorded separately so the drop is
  // observable rather than silent -- a client that is simply too old should be able to say so.
  const granted = [];
  const unrecognised = [];
  for (const key of surfaces) {
    if (typeof key !== "string") return null;
    (KNOWN_SURFACES.has(key) ? granted : unrecognised).push(key);
  }

  return Object.freeze({
    tenantId,
    principalId,
    securityRoleKeys: Object.freeze(securityRoleKeys.filter((k) => typeof k === "string")),
    employeeId: employeeId ?? null,
    workEligibility: Object.freeze(workEligibility.filter((k) => typeof k === "string")),
    operationalScopes: Object.freeze(
      operationalScopes
        .filter((s) => s && typeof s.scopeType === "string" && typeof s.scopeId === "string")
        .map((s) => Object.freeze({ scopeType: s.scopeType, scopeId: s.scopeId })),
    ),
    surfaces: Object.freeze(granted.sort()),
    unrecognisedSurfaces: Object.freeze(unrecognised.sort()),
  });
}

/**
 * The value navigation reads: `{ state, grants(surfaceKey), context, reason }`.
 *
 * `grants` returns true ONLY in READY and ONLY for a surface the server listed. Every other state --
 * loading, refused, unavailable, a missing context, a malformed one -- returns false without a
 * branch, because there is no branch: nothing but a positive, current, server-issued grant opens a
 * door.
 */
export function buildNavigationAuthority({ state, context = null, reason = null } = {}) {
  const ready = state === EXPERIENCE_STATE.READY && context !== null;
  const granted = ready ? new Set(context.surfaces) : new Set();
  return Object.freeze({
    source: "EOS",
    state: state ?? EXPERIENCE_STATE.LOADING,
    context: ready ? context : null,
    reason,
    grants: (surfaceKey) => granted.has(surfaceKey),
    grantedSurfaces: Object.freeze([...granted].sort()),
  });
}

/**
 * Is this value a navigation authority produced by buildNavigationAuthority? Used to fail closed on junk.
 *
 * ════ IT DOES NOT INSPECT `state`, AND IT MUST NOT (Wave 16 / Lane BQ, examined and kept) ════
 *
 * This predicate answers WHICH SOURCE IS ANSWERING, not WHAT IT ANSWERED. LOADING, REFUSED and
 * UNAVAILABLE all pass it, and that is the property that makes the EOS source TOTAL: navConfig's
 * `isNavItemVisible` returns `eosGrantsSurface(...)` the moment this is true, and the very next line
 * of that function is the legacy path. Adding `state === READY` here would therefore not make
 * anything stricter -- it would make a LOADING, REFUSED or UNAVAILABLE EOS session fall THROUGH to
 * `ROLE_NAV_ACCESS[users/{uid}.role]`, which is precisely the silent degrade Owner ruling F forbids
 * and this whole seam exists to remove. The stricter-looking change is the insecure one.
 *
 * FAIL-CLOSED IS ALREADY HERE, IN `grants`. `buildNavigationAuthority` builds an EMPTY grant set for
 * every state but READY, so a non-READY authority is a source that answers "nothing" -- an answer,
 * and the right one. Nothing depends on the caller remembering to check a state.
 *
 * THE CONTAINMENT LIVING IN ANOTHER FILE WAS THE REAL FINDING, AND IT IS ANSWERED HERE RATHER THAN
 * BY WEAKENING THIS. App.jsx early-returns on LOADING and UNAVAILABLE before navigation renders, so
 * a reader of this line could not see why a LOADING authority was harmless. Two things now say so
 * without leaving this file's vocabulary: `navigationAuthorityGrantsAnything()` below, which is the
 * "did it actually answer with something" question stated where the predicate is, and
 * `navigationAuthoritySourceState()`, which lets a caller render the RIGHT refusal instead of
 * guessing from an empty grant set. Neither is an input to visibility.
 */
export const isNavigationAuthority = (value) =>
  !!value && value.source === "EOS" && typeof value.grants === "function";

/**
 * The state an EOS navigation authority is in, or null if this is not one.
 *
 * For PRESENTATION only -- which refusal to show, never whether a door opens. App.jsx uses it to
 * tell a governed REFUSED persona ("the governed source answered, and you hold no surfaces") apart
 * from a legacy no-access session ("no role is assigned"), which used to be one sentence blaming
 * roles for both.
 */
export const navigationAuthoritySourceState = (value) =>
  (isNavigationAuthority(value) ? value.state ?? EXPERIENCE_STATE.LOADING : null);

/** Did the EOS source actually grant anything? Non-READY is always false, with no state test needed. */
export const navigationAuthorityGrantsAnything = (value) =>
  isNavigationAuthority(value) && value.grantedSurfaces.length > 0;
