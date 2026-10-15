"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_IN_FILTER_VALUES = exports.GOVERNED_OPERATING_COMPANY_IDS = void 0;
exports.companyFieldForFamily = companyFieldForFamily;
exports.reportRowScopeForCollection = reportRowScopeForCollection;
exports.operatingCompanyScope = operatingCompanyScope;
exports.resolveCompanyReach = resolveCompanyReach;
exports.documentSatisfiesCompanyBound = documentSatisfiesCompanyBound;
// ENG-E -- the OPERATING-COMPANY reach and ROW-LEVEL bound for the trusted
// report execution path (functions/src/reporting/reportExecutionService.ts).
// Reimplemented against main @ 64008d5ae0bdd9532909671b15a91122400accf1.
//
// ====================== WHAT THIS CLOSES, AND WHY NOW ======================
//
// At 64008d5a the report runner had no tenancy axis and no row bound. Four
// independent unbounded axes, all measured rather than reasoned (the query
// predicates were recorded from a test double, not inferred from the source):
//
//   1. reportExecutionService.ts:420 built ONE hardcoded capability target,
//      `{ scope: { type: "global" }, condition: {} }`, reused for every
//      object/field/traversal gate in the run. The Scope axis therefore
//      contributed no narrowing at all.
//   2. reportExecutionService.ts:500 fetched with
//      `db.collection(c).limit(n).get()` -- no `where()` of any kind. A
//      recorded run issued `query equipment predicates=[] limit=51`: every
//      document of every operating company, PLUS documents carrying no
//      company at all.
//   3. joinRelatedDocs() fetched one-hop related documents by id with no
//      company check whatsoever. A recorded run issued six extra reads --
//      `locations/loc-2`, `accounts/acc-2` (the OTHER company's rows) and
//      `locations/loc-3`, `accounts/acc-3` (the ownerless row's parents).
//      Closing axis 2 alone leaves this route open for every base row that
//      survives the predicate.
//   4. loadRunnerAccessState() returned `{accessVersion, assignments}` and no
//      company identity at all -- the ROOT CAUSE. There was nothing in the run
//      to bound anything with.
//
// The defect's true shape is worth stating exactly, because it is the opposite
// of what "unbounded scope" usually means. `scopeMatches()` in
// access/resolveEffectivePermission.ts value-matches `operatingCompany`
// EXACTLY, so an operatingCompany-scoped assignment could never satisfy a
// `global` target -- it was DENIED. There was no such thing as a
// company-bounded report runner: the only way to run a report at all was a
// GLOBAL grant, and a global grant returned everything. This module's fix
// therefore both narrows (a row predicate now exists) and enables (a
// company-scoped runner now works at all) in the same change.
//
// This is NOT a pre-activation defect. `config/environments.json` declares
// `productionCapabilityActivations` on `taylor-parts-production` -- a field
// deliberately DISTINCT from `capabilityActivationOverrides`
// (environmentCapabilityOverrides.ts:306) -- carrying 25 ids, all of them
// `report.*`, and `resolveProductionCapabilityActivations()` honours them in
// production. The reproduction above was recorded with GCLOUD_PROJECT set to
// the real production project id and the real activation resolver: the scan
// was issued. The reporting family is production-activated today.
//
// ====================== WHY THIS INVENTS NO VOCABULARY ======================
//
// Both halves of the bound are read from authorities that already exist and are
// already under Owner ruling. Ruling D-1 forbids standing up a second authority
// for a question that already has one.
//
//   WHICH COMPANIES MAY THIS RUNNER REACH?
//     Exactly the pattern finance/financeReadCallables.ts:119-123 established:
//     enumerate the governed value set (OPERATING_COMPANY_IDS) and probe the
//     canonical resolver once per candidate with a value-matched
//     `{ type: "operatingCompany", value }` target. Never inferred from an
//     employee profile, a warehouse, a job title or a display name --
//     `operatingCompanyId` is a governed ACCESS-SCOPE fact, and there is no
//     uid->company resolver in this codebase to misuse. A held-but-unbound
//     capability confers nothing ("a valueless grant confers no reach"),
//     exactly as finance treats it.
//
//   IS THIS OBJECT'S COLLECTION COMPANY-PARTITIONED, AND BY WHICH FIELD?
//     ownership/ownershipMatrix.ts -- the ownership matrix, reconciled against
//     the measured sandbox census under Owner rulings D-8..D-16 and R-15. Its
//     `companyScope` column already answers the question for every governed
//     family and its `companyScopeField`/`ownerFields` columns already name the
//     storage.
//
// ====================== FAIL CLOSED, ALWAYS ======================
//
// Every unknown answers "refuse", never "global":
//   * a collection with no family in the matrix            -> unsupported
//   * two families claiming one collection                 -> unsupported
//     (picking one of two competing declarations silently is how a wrong bound
//      ships looking like a right one)
//   * ownerClass EXCLUDED                                  -> unsupported
//   * companyScope CROSS_COMPANY_CAPABLE                   -> unsupported
//     (its bound is a participating PAIR, not a single field; a single-field
//      `where` would be the WRONG bound, and a wrong bound is worse than none
//      because it reads as one)
//   * SINGLE_COMPANY whose company field cannot be named   -> unsupported
//
// PURE. No firebase-admin import, no Firestore read, no authorization decision
// of its own -- it only says WHAT the bound is and WHICH companies are reached.
// reportExecutionService.ts applies it.
const operatingCompanyAuthority_1 = require("../ownership/operatingCompanyAuthority");
const ownershipMatrix_1 = require("../ownership/ownershipMatrix");
const resolveEffectivePermission_1 = require("../access/resolveEffectivePermission");
/** The governed company id set, in a stable order, as the probe enumerates it. */
exports.GOVERNED_OPERATING_COMPANY_IDS = Object.freeze(Object.values(operatingCompanyAuthority_1.OPERATING_COMPANY_IDS));
// Collection -> family, built once at module load. A duplicate collection is
// NOT resolved by "first wins": it is recorded as ambiguous so
// reportRowScopeForCollection() refuses it.
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
 * Two storage shapes exist in the matrix and BOTH are read here rather than
 * assumed:
 *   - COMPANY-owned families, where the company IS the owner: the id lives in
 *     `ownerFields` (equipment -> ["operatingCompanyId"]).
 *   - PERSON-owned families carrying an orthogonal commercial company axis: the
 *     field is declared separately as `companyScopeField`.
 *
 * `companyScopeField` is checked FIRST: when both are present it is the more
 * specific declaration of "which field answers the company question". Returns
 * null when the family names no single company field -- which the caller turns
 * into a REFUSAL, never into an unbounded read.
 */
function companyFieldForFamily(family) {
    const declared = family.companyScopeField;
    if (typeof declared === "string" && declared.trim() !== "")
        return declared;
    const owned = Array.isArray(family.ownerFields) ? family.ownerFields : [];
    if (family.ownerClass === "COMPANY" &&
        owned.length === 1 &&
        typeof owned[0] === "string" &&
        owned[0].trim() !== "") {
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
            why: `family "${family.family}" is EXCLUDED from the ownership model (identity/access/audit/` +
                "infrastructure), not a reportable business record",
        };
    }
    switch (family.companyScope) {
        case "COMPANY_NEUTRAL":
            return {
                kind: "company-neutral",
                collection,
                family: family.family,
                why: `ownership matrix declares family "${family.family}" COMPANY_NEUTRAL (ruling R-15) and the ` +
                    "documents carry no company field, so no company row predicate exists to apply; a non-empty " +
                    "company reach is still required to run at all",
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
                why: `family "${family.family}" has companyScope "${String(family.companyScope)}", whose bound is a ` +
                    "participating pair rather than a single-field equality; the report path does not implement it " +
                    "and will not approximate it",
            };
    }
}
/**
 * Firestore's hard cap on the number of values in a single `in` filter. Two
 * governed operating companies exist today, but operatingCompanyAuthority.ts
 * states that new ones must be addable without a schema change, so a reach wider
 * than this cap is reachable in principle. It must REFUSE rather than issue an
 * invalid query and surface as an opaque Firestore error -- and refusing is also
 * the only non-widening option, since dropping companies from the predicate to
 * fit would silently under-report and splitting the query is a change of shape
 * this lane is not authorized to make.
 */
exports.MAX_IN_FILTER_VALUES = 30;
/** The value-matched capability target for one governed operating company. */
function operatingCompanyScope(companyId) {
    return { type: "operatingCompany", value: companyId };
}
/**
 * The runner's operating-company REACH for one capability, resolved ONLY through
 * the canonical resolver.
 *
 * A `global`-scoped assignment matches every target by `scopeMatches()`, so it
 * reaches BOTH companies -- which is correct and still narrowing, because the
 * resulting `where(field, "in", [taylor, ventana])` excludes OWNERLESS rows that
 * the predicate-free scan returned.
 */
function resolveCompanyReach(input) {
    const allowsAt = (target) => {
        try {
            return ((0, resolveEffectivePermission_1.resolveEffectivePermission)({
                permissionId: input.capabilityId,
                assignments: input.assignments,
                roles: input.roles,
                currentAccessVersion: input.currentAccessVersion,
                target,
                activationOverrides: input.activationOverrides,
            }).decision === "ALLOW");
        }
        catch {
            return false; // fail closed: an unresolvable probe never widens reach
        }
    };
    const reach = [];
    for (const companyId of exports.GOVERNED_OPERATING_COMPANY_IDS) {
        if (allowsAt({ scope: operatingCompanyScope(companyId), condition: {} }))
            reach.push(companyId);
    }
    // "Held somewhere" is probed against the runner's OWN assignment scopes, so
    // this asks the resolver rather than re-deciding scope semantics here.
    let heldSomewhere = reach.length > 0;
    if (!heldSomewhere) {
        for (const assignment of input.assignments) {
            const scope = assignment?.scope;
            if (!scope || typeof scope.type !== "string")
                continue;
            const condition = scope.type === "ownAssignment" ? { isOwnAssignment: true } : {};
            if (allowsAt({ scope, condition })) {
                heldSomewhere = true;
                break;
            }
        }
    }
    return { reach: Object.freeze(reach), heldSomewhere };
}
/**
 * Does a document satisfy a company-bound row scope for `reach`?
 *
 * Used for the ONE-HOP JOIN (axis 3), where a server-side `where` is not
 * available: a related document is fetched by id, and a `where` on a document-id
 * `in` plus a company field would require a composite index this task must not
 * introduce. The value is therefore verified here and the related document is
 * DROPPED rather than attached when it fails -- so no other company's field
 * value can ever reach the caller. A missing/blank company value fails: an
 * ownerless related document is never attached.
 */
function documentSatisfiesCompanyBound(doc, field, reach) {
    if (!doc)
        return false;
    const value = field.split(".").reduce((acc, key) => {
        if (acc && typeof acc === "object" && !Array.isArray(acc)) {
            return acc[key];
        }
        return undefined;
    }, doc);
    return typeof value === "string" && value !== "" && reach.includes(value);
}
//# sourceMappingURL=reportRowScope.js.map