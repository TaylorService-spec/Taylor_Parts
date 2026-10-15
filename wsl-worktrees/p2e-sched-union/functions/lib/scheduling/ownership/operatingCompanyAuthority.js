"use strict";
// EOS Ownership Model v1 — the OPERATING COMPANY authority, trusted-side mirror of the client
// authority field-ops-app-vite/src/domain/operatingCompanyAuthority.js (Owner ruling D-2,
// 2026-08-30). See that file's header for the full statement of what this authority is and,
// more importantly, the six things it is deliberately NOT.
//
// PURE: no firebase-admin / firebase-functions import. Parity with the client mirror is asserted
// by test/operatingCompanyAuthority.test.mjs against the same canonical case table, the same way
// inventoryControlLifecycle.ts is held to its client mirror.
//
// INERT in v1: no Rules enforce company ownership, no writer stamps it, no backfill has run.
//
// RULES POSTURE: `operating_companies` has NO match block in firestore.rules. Firestore denies
// every client read and write to a collection no rule matches, so the collection is already
// fail-closed for clients WITHOUT a Rules change — which is exactly the ruling's "do not make
// company ownership user-editable through generic client writes", achieved without a Tier-2
// firestore.rules edit in this pass. An EXPLICIT `allow read, write: if false` block matching the
// convention the repo uses elsewhere (e.g. the `refunds` block) is a recommended Tier-2 follow-up:
// it changes no behavior, it makes the denial legible to a reader of the Rules file rather than
// implied by absence.
Object.defineProperty(exports, "__esModule", { value: true });
exports.OPERATING_COMPANIES_COLLECTION = exports.OPERATING_COMPANIES = exports.OPERATING_COMPANY_IDS = void 0;
exports.isOperatingCompanyIdShape = isOperatingCompanyIdShape;
exports.resolveOperatingCompany = resolveOperatingCompany;
exports.operatingCompanyDisplayName = operatingCompanyDisplayName;
/** The canonical, stable governed ids. These are the id namespace `owner.id` uses for COMPANY. */
exports.OPERATING_COMPANY_IDS = {
    TAYLOR: "taylor",
    VENTANA: "ventana",
};
// `code` is the stable machine token; `displayName` is DESCRIPTIVE ONLY and never authority.
exports.OPERATING_COMPANIES = Object.freeze([
    Object.freeze({
        id: exports.OPERATING_COMPANY_IDS.TAYLOR,
        code: "TAYLOR",
        displayName: "Taylor Freezer of Arizona",
        active: true,
    }),
    Object.freeze({
        id: exports.OPERATING_COMPANY_IDS.VENTANA,
        code: "VENTANA",
        displayName: "Ventana",
        active: true,
    }),
]);
exports.OPERATING_COMPANIES_COLLECTION = "operating_companies";
const BY_ID = new Map(exports.OPERATING_COMPANIES.map((c) => [c.id, c]));
/**
 * Is `value` a syntactically valid operating-company id? A SHAPE check, not a membership check —
 * the ruling requires new operating companies to be addable without a schema change, so
 * shape-valid-but-unseeded is a distinct answer from malformed.
 */
function isOperatingCompanyIdShape(value) {
    return typeof value === "string" && /^[a-z][a-z0-9_-]{1,62}$/.test(value);
}
/**
 * Resolve a governed operating-company id. Fail-closed and text-blind: never accepts a display
 * name, a code, or a line-of-business token. UNKNOWN is deliberately not collapsed into INVALID.
 */
function resolveOperatingCompany(id) {
    if (!isOperatingCompanyIdShape(id))
        return { state: "INVALID", company: null };
    const company = BY_ID.get(id) ?? null;
    if (company === null)
        return { state: "UNKNOWN", company: null };
    return { state: company.active ? "RESOLVED" : "INACTIVE", company };
}
/** The display name for an id, or null. Presentation only — never branch on this. */
function operatingCompanyDisplayName(id) {
    return typeof id === "string" ? (BY_ID.get(id)?.displayName ?? null) : null;
}
