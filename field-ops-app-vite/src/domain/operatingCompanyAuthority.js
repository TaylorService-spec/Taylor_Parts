// EOS Ownership Model v1 — the OPERATING COMPANY authority (Owner ruling D-2, 2026-08-30).
//
// This module answers exactly ONE question:
//
//     "Which governed EOS operating company is responsible for this internal business record?"
//
// It deliberately answers NOTHING else. The ruling enumerates what it must never be overloaded
// with, and each of those already has its own authority elsewhere in the repo:
//
//   customer / account identity  -> `accounts` (accountId)
//   legal title holder           -> domain/inventoryControlLifecycle.js OWNERSHIP + explicitTitleHolder
//   line of business             -> domain/constants.js ACCOUNT_LINE_OF_BUSINESS (multi-valued, informational)
//   tenant                       -> types/access.ts ScopeType "tenant" (reserved, inert)
//   inventory location           -> warehouses / stock_locations / mobile_locations
//   legal ownership history      -> auditEvents
//   access scope                 -> types/access.ts Scope
//
// Before this module there was NO authority that could safely answer the question. The
// reconciliation (docs/assessments/eos-ownership-model-reconciliation.md) established that
// `operatingCompanyId` existed only in design prose and was stored nowhere, and that
// ACCOUNT_LINE_OF_BUSINESS cannot serve — it is optional, additive, MULTI-VALUED (an Account may
// legitimately be both Taylor and Ventana), and gates no authorization. A multi-valued
// informational array cannot answer a single-valued responsibility question, which is why the
// ruling forbids inferring one from the other.
//
// PURE: no Firebase import, no persistence, no I/O. Mirrored decision-for-decision by
// functions/src/ownership/operatingCompanyAuthority.ts; parity is asserted by
// test/operatingCompanyAuthority.test.mjs on both sides against the same canonical table.
//
// INERT in v1: nothing enforces company ownership yet. This module supplies identity and
// validation only; the census/backfill gate (Owner ruling, "NEXT GATE") governs activation.

/** The canonical, stable governed ids. These are the id namespace `owner.id` uses for COMPANY. */
export const OPERATING_COMPANY_IDS = Object.freeze({
  TAYLOR: "taylor",
  VENTANA: "ventana",
});

// The seeded governed records. `code` is the stable machine token; `displayName` is DESCRIPTIVE
// ONLY and is never authority — resolution goes through the id, never the text. That separation
// is the reason resolveOperatingCompany() below refuses to look at displayName at all.
//
// Frozen at the element level so a consumer cannot mutate a shared record in place and have the
// change appear authoritative to the next reader.
export const OPERATING_COMPANIES = Object.freeze([
  Object.freeze({
    id: OPERATING_COMPANY_IDS.TAYLOR,
    code: "TAYLOR",
    displayName: "Taylor Freezer of Arizona",
    active: true,
  }),
  Object.freeze({
    id: OPERATING_COMPANY_IDS.VENTANA,
    code: "VENTANA",
    displayName: "Ventana",
    active: true,
  }),
]);

export const OPERATING_COMPANIES_COLLECTION = "operating_companies";

const BY_ID = new Map(OPERATING_COMPANIES.map((c) => [c.id, c]));

/**
 * Is `value` a syntactically valid operating-company id?
 *
 * Deliberately a SHAPE check, not a membership check: the ruling requires that additional
 * operating companies can be added later WITHOUT a schema change, so a shape-valid id that is
 * not one of the two seeded records is well-formed-but-unknown, not malformed. The two are
 * different answers and callers need to tell them apart — see resolveOperatingCompany().
 */
export function isOperatingCompanyIdShape(value) {
  return typeof value === "string" && /^[a-z][a-z0-9_-]{1,62}$/.test(value);
}

/**
 * Resolve a governed operating-company id to its record.
 *
 * Fail-closed and text-blind:
 *   - a non-shape value          -> { state: "INVALID",  company: null }
 *   - shape-valid, not seeded    -> { state: "UNKNOWN",  company: null }
 *   - seeded but active === false-> { state: "INACTIVE", company: <record> }
 *   - seeded and active          -> { state: "RESOLVED", company: <record> }
 *
 * UNKNOWN is NOT collapsed into INVALID. A future seeded company read by an older client must
 * surface as "I do not recognise this id", never as "this id is malformed" — the latter would
 * invite a caller to discard a legitimate governed value.
 *
 * Never accepts a display name, a code, or a line-of-business token. Passing "TAYLOR" (the code)
 * resolves to INVALID by shape, on purpose: one id namespace, and it is the id.
 */
export function resolveOperatingCompany(id) {
  if (!isOperatingCompanyIdShape(id)) return { state: "INVALID", company: null };
  const company = BY_ID.get(id) ?? null;
  if (company === null) return { state: "UNKNOWN", company: null };
  return { state: company.active ? "RESOLVED" : "INACTIVE", company };
}

/** The display name for an id, or null. Presentation only — never branch on this. */
export function operatingCompanyDisplayName(id) {
  return BY_ID.get(id)?.displayName ?? null;
}
