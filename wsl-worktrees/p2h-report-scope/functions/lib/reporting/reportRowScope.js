"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GOVERNED_OPERATING_COMPANY_IDS = void 0;
exports.companyFieldForFamily = companyFieldForFamily;
exports.reportRowScopeForCollection = reportRowScopeForCollection;
exports.operatingCompanyScope = operatingCompanyScope;
exports.resolveCompanyReach = resolveCompanyReach;
exports.documentWithinCompanyReach = documentWithinCompanyReach;
// P2-H -- the ROW-LEVEL and OPERATING-COMPANY bound for the trusted report
// execution path (functions/src/reporting/reportExecutionService.ts).
//
// ============================ WHAT THIS CLOSES ============================
//
// Before this module, reportExecutionService.ts did two things that together
// left the report creator with no tenancy axis and no row bound at all:
//
//   1. it built ONE hardcoded capability target, `{ scope: { type: "global" } }`,
//      for every object/field/traversal gate in the run, so the Scope axis
//      contributed no narrowing whatsoever; and
//   2. it fetched with `db.collection(c).limit(n).get()` -- no `where()` of any
//      kind -- so an authorized run returned every document in the collection
//      regardless of which operating company it belonged to.
//
// That was safe ONLY because every `report.*` capability is registered
// `active: false` (permissionCatalog.ts) outside the sandbox override set. It is
// therefore a PRE-ACTIVATION defect: the first activation, not some later
// regression, is what would have granted cross-company unbounded row access.
//
// ============================ WHY NO NEW VOCABULARY ============================
//
// This repo already suffers from duplicated implementations, so this module
// INVENTS NOTHING. Both halves of the bound are read from authorities that
// already exist and are already under Owner ruling:
//
//   WHICH COMPANIES MAY THIS RUNNER REACH?
//     Exactly the pattern finance/financeReadCallables.ts:119-123 established:
//     enumerate the governed value set (OPERATING_COMPANY_IDS) and probe the
//     canonical resolver once per candidate with a value-matched
//     `{ type: "operatingCompany", value }` target. The company is NEVER
//     inferred from an employee profile, a warehouse, a job title or a display
//     name -- types/access.ts:26-33 and employeePrincipalLink.ts:202-207 forbid
//     precisely that, and there is no uid->company resolver in this codebase to
//     misuse. A held-but-unbound capability confers nothing ("a valueless grant
//     confers no reach"), same as finance.
//
//   IS THIS OBJECT'S COLLECTION COMPANY-PARTITIONED, AND BY WHICH FIELD?
//     ownership/ownershipMatrix.ts -- the OWNERSHIP MATRIX, reconciled against
//     the measured sandbox census under Owner rulings D-8..D-16. Its
//     `companyScope` column already answers this question for every governed
//     family, and its `ownerFields`/`companyScopeField` columns already name the
//     storage. Re-deciding it here would be a second authority for a question
//     that already has one (ruling D-1 forbids exactly that).
//
// ============================ FAIL CLOSED, ALWAYS ============================
//
// Every unknown answers "refuse", never "global":
//   * a collection with no family in the matrix          -> unsupported
//   * two families claiming one collection               -> unsupported
//   * ownerClass EXCLUDED                                -> unsupported
//   * companyScope CROSS_COMPANY_CAPABLE / PARTICIPATING -> unsupported
//     (its bound is a participating PAIR, not a single field; a single-field
//      `where` would be the wrong bound, and a wrong bound is worse than none
//      because it reads as one)
//   * SINGLE_COMPANY whose company field cannot be named -> unsupported
//
// PURE. No firebase-admin import, no Firestore read, no authorization decision
// of its own -- it only says WHAT the bound is. The service applies it.
const operatingCompanyAuthority_1 = require("../ownership/operatingCompanyAuthority");
const ownershipMatrix_1 = require("../ownership/ownershipMatrix");
/** The governed company id set, in a stable order, as the probe enumerates it. */
exports.GOVERNED_OPERATING_COMPANY_IDS = Object.freeze(Object.values(operatingCompanyAuthority_1.OPERATING_COMPANY_IDS));
// Collection -> family, built once. A duplicate collection is not resolved by
// "first wins": it is recorded as ambiguous so reportRowScopeForCollection()
// refuses it, because picking one of two competing declarations silently is how
// a wrong bound gets shipped looking like a right one.
const FAMILY_BY_COLLECTION = (() => {
    const m = new Map();
    for (const fam of ownershipMatrix_1.OWNERSHIP_MATRIX) {
        if (typeof fam.collection !== "string" || fam.collection === "")
            continue;
        m.set(fam.collection, m.has(fam.collection) ? "AMBIGUOUS" : fam);
    }
    return m;
})();
/**
 * Name the field that stores a SINGLE_COMPANY family's operating company.
 *
 * Two storage shapes exist in the matrix and both are read here rather than
 * assumed:
 *   - COMPANY-owned families, where the company IS the owner: the company id
 *     lives in `ownerFields` (e.g. equipment -> ["operatingCompanyId"]).
 *   - PERSON-owned families carrying an orthogonal commercial company axis:
 *     the field is declared separately as `companyScopeField`.
 *
 * `companyScopeField` is checked FIRST because when both are present it is the
 * more specific declaration of "which field answers the company question".
 * Returns null when the family names no single company field -- which the
 * caller turns into a refusal, never into an unbounded read.
 */
function companyFieldForFamily(family) {
    const declared = family.companyScopeField;
    if (typeof declared === "string" && declared.trim() !== "")
        return declared;
    const owned = Array.isArray(family.ownerFields) ? family.ownerFields : [];
    if (family.ownerClass === "COMPANY" && owned.length === 1 && typeof owned[0] === "string" && owned[0].trim() !== "") {
        return owned[0];
    }
    return null;
}
/** What row bound applies to a report object's backing Firestore collection. */
function reportRowScopeForCollection(collection) {
    if (typeof collection !== "string" || collection.trim() === "") {
        return { kind: "unsupported", collection: String(collection), why: "no backing collection" };
    }
    const found = FAMILY_BY_COLLECTION.get(collection);
    if (found === undefined) {
        return {
            kind: "unsupported",
            collection,
            why: `collection "${collection}" declares no family in the ownership matrix, so no authority states ` +
                "whether it is partitioned by operating company or by which field",
        };
    }
    if (found === "AMBIGUOUS") {
        return {
            kind: "unsupported",
            collection,
            why: `collection "${collection}" is claimed by more than one ownership-matrix family; the bound is ambiguous`,
        };
    }
    const family = found;
    if (family.ownerClass === "EXCLUDED") {
        return {
            kind: "unsupported",
            collection,
            why: `family "${family.family}" is EXCLUDED from the ownership model (identity/access/audit/infrastructure), not a reportable business record`,
        };
    }
    switch (family.companyScope) {
        case "COMPANY_NEUTRAL":
            return {
                kind: "company-neutral",
                collection,
                family: family.family,
                why: `ownership matrix declares family "${family.family}" COMPANY_NEUTRAL -- both operating companies may ` +
                    "legitimately use the same record, so no company row predicate applies (a company reach is still required)",
            };
        case "SINGLE_COMPANY": {
            const field = companyFieldForFamily(family);
            if (!field) {
                return {
                    kind: "unsupported",
                    collection,
                    why: `family "${family.family}" is SINGLE_COMPANY but names no single company field in the ownership matrix`,
                };
            }
            return {
                kind: "company-bound",
                collection,
                family: family.family,
                field,
                why: `ownership matrix declares family "${family.family}" SINGLE_COMPANY, stored in "${field}"`,
            };
        }
        default:
            return {
                kind: "unsupported",
                collection,
                why: `family "${family.family}" has companyScope "${String(family.companyScope)}", whose bound is a participating ` +
                    "pair rather than a single-field equality; the report path does not implement it and will not approximate it",
            };
    }
}
/** The value-matched capability target for one governed operating company. */
function operatingCompanyScope(companyId) {
    return { type: "operatingCompany", value: companyId };
}
/**
 * The runner's operating-company REACH for one capability.
 *
 * `probe` must be the caller's own resolveEffectivePermission() closure -- this
 * module never authorizes anything itself. Enumerates the governed value set and
 * keeps every company the probe allows, exactly as financeReadCallables.ts does.
 *
 * An empty result is the fail-closed signal: it means "this runner reaches no
 * operating company for this capability", and the caller MUST return nothing.
 * It must never be read as "so use global".
 */
function resolveCompanyReach(probe) {
    return exports.GOVERNED_OPERATING_COMPANY_IDS.filter((id) => probe(operatingCompanyScope(id)));
}
/**
 * Does an already-fetched document satisfy the company bound?
 *
 * Used for the one-hop JOIN, which fetches related documents by id
 * (`collection(c).doc(id).get()`) and so cannot carry a `where`. Without this a
 * company-bounded base row could still drag a foreign-company related record
 * into the result through its reference field -- the same leak by a second
 * route.
 *
 * A `company-bound` document whose company field is missing, malformed, or not
 * in reach does NOT pass. An ownerless record is not "everyone's"; it is a
 * record whose company nobody has stated, and stating it is not this code's job.
 */
function documentWithinCompanyReach(doc, scope, reach) {
    if (scope.kind === "company-neutral")
        return true;
    if (scope.kind !== "company-bound")
        return false;
    if (!doc)
        return false;
    const value = doc[scope.field];
    return typeof value === "string" && reach.includes(value);
}
//# sourceMappingURL=reportRowScope.js.map