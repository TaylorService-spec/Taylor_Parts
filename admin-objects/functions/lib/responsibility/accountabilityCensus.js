"use strict";
// THE ACCOUNTABILITY CENSUS — dedicated, per Owner ruling #187 §1 (`MI-Y`, option ii).
//
// ════════════════════ WHY THIS IS A SECOND CENSUS AND NOT A COLUMN IN THE FIRST ════════════════════
//
// #187 §1 ruled the choice #182 §6 had reserved:
//
//     "Ruled: (ii). Do NOT expand the ownership census into a generic mega-census. OWNERSHIP ·
//      ACCOUNTABILITY · ASSIGNMENT · APPROVAL · ESCALATION are distinct business axes. Ownership
//      integrity remains ownership integrity; accountability integrity gets its own measurement."
//
//         OWNERSHIP CENSUS + ACCOUNTABILITY CENSUS + other required governed integrity facts
//             → RESPONSIBILITY / ENFORCEMENT GATE
//
// So this module is the second box, not a widening of the first. `accountablePerson` is NOT in
// `ownershipMatrix.ownerFields` and nothing here puts it there; #186 §9 says the same thing from the
// other direction — "the `ownershipMatrix.ownerFields` mechanism must not be made to carry this
// multi-axis model."
//
// `functions/src/responsibility/responsibilityEnforcementGate.ts` is the third box, and it COMPOSES
// the two without collapsing them.
//
// ════════════════════ WHAT IT MEASURES, PER APPLICABLE ACTIONABLE RECORD ════════════════════
//
// Six facts, kept separate because the rulings keep them separate:
//
//   IS AN ACCOUNTABLE PERSON PRESENT      the stored field — present, absent, or unreadable
//   IS THE REFERENCE VALID                the authoritative Employee answer (#182 §1, layer 1)
//   IS THE PERSON CURRENTLY ELIGIBLE      a governed policy's verdict (#182 §4, layer 2)
//   WAS AN AUTHORITATIVE ANSWER OBTAINED  #187 §2, and it is NEVER folded into the two above
//   HISTORICAL OR ACTIONABLE              #186 §7 vs §8 — history is preserved, current work is not
//   EXPLICIT GOVERNED EXCEPTION           #180's "unless an explicit, separately Owner-approved
//                                         exception defines otherwise"
//
// ════════════════════ THE THREE THINGS THIS CENSUS MUST NEVER DO ════════════════════
//
//   1. NEVER CONVERT `AUTHORITY_UNAVAILABLE` INTO `INVALID` OR `MISSING`. #187 §2: they "mean
//      different things" — one is the authority answering no, the other is EOS failing to ask. It is
//      its own bucket here, it is ALWAYS blocking, and no code path assigns a record to any other
//      bucket when the lookup failed.
//   2. NEVER REPORT AN OUT-OF-SCOPE FAMILY AS A FINDING. #189 `OD-16`: accountability for those
//      families is "NOT APPLICABLE — not MISSING, not OWNERLESS, not DEFECTIVE". They get a report
//      that carries no counts at all, so there is no number that could be summed into a backlog.
//   3. NEVER TREAT A HISTORICAL RECORD'S INELIGIBLE PERSON AS A DEFECT. #186 §7: "Historical
//      ownership and accountability references remain valid when the Employee later becomes
//      INACTIVE, TERMINATED or former. Do not rewrite history." It is COUNTED — the census can see
//      it — and it does not block.
//
// READ-ONLY BY CONSTRUCTION: this module has no write of any kind. It takes documents and an
// authority port and returns counts. It imports no storage client, no Firebase and no `node:` module.
Object.defineProperty(exports, "__esModule", { value: true });
exports.AccountabilityCensusConfigurationError = exports.isMeasured = exports.isCensusError = exports.isNotApplicable = exports.emptyAccountabilityCounts = exports.ACCOUNTABILITY_BUCKETS = exports.MAX_SAMPLE_IDS = void 0;
exports.classifyAccountabilityRecord = classifyAccountabilityRecord;
exports.accountabilityNotApplicable = accountabilityNotApplicable;
exports.censusAccountabilityFamily = censusAccountabilityFamily;
exports.accountabilityCensusVerdict = accountabilityCensusVerdict;
const employeeAuthority_1 = require("../employeeIdentity/employeeAuthority");
const accountabilityFamilyScope_1 = require("./accountabilityFamilyScope");
const accountablePersonStorage_1 = require("./accountablePersonStorage");
/** Sample ids per bucket, matching the ownership census's own ceiling so the two reports read alike. */
exports.MAX_SAMPLE_IDS = 10;
/**
 * The buckets. SEVEN, and every applicable record lands in exactly one.
 *
 * The names say which of the six facts produced them, and the two that are most often collapsed are
 * deliberately the furthest apart in this list:
 *
 *   presentValidEligible              #182 state A. The only healthy state for actionable work.
 *   presentValidNotCurrentlyEligible  #182 state B / #186 cases B and C. A VALID reference. Blocks on
 *                                     an ACTIONABLE record (#189 MI-ε) and does NOT block on history.
 *   presentInvalid                    #182 state C. The authority ANSWERED and nothing resolves.
 *   presentUnreadable                 #189 MI-λ. A stored value that could never be an id. Quarantine.
 *   missing                           No accountable person at all. #180 prohibits this for actionable
 *                                     work absent a governed exception.
 *   authorityUnavailable              #187 §2. NOT a verdict about the person. Always blocks.
 *   governedException                 #180's explicit, separately Owner-approved exception. Counted,
 *                                     never blocking, and nothing in EOS writes one yet.
 */
exports.ACCOUNTABILITY_BUCKETS = Object.freeze([
    "presentValidEligible",
    "presentValidNotCurrentlyEligible",
    "presentInvalid",
    "presentUnreadable",
    "missing",
    "authorityUnavailable",
    "governedException",
]);
const emptyAccountabilityCounts = () => {
    const counts = {};
    for (const bucket of exports.ACCOUNTABILITY_BUCKETS)
        counts[bucket] = 0;
    return counts;
};
exports.emptyAccountabilityCounts = emptyAccountabilityCounts;
/**
 * Classify ONE record. PURE, TOTAL, and it never throws.
 *
 * Order is the ruling's order, and each step's precedence is a decision:
 *
 *   1. A GOVERNED EXCEPTION WINS FIRST. #180 makes the exception an exemption from the one-accountable-
 *      person requirement itself, so a record carrying one is not measured against that requirement.
 *   2. THE STORED VALUE, before any lookup. `UNREADABLE` and `ABSENT` are answerable without asking
 *      the authority, and asking it about an unusable id would produce a `presentInvalid` that
 *      misdescribes the finding.
 *   3. THE COMPOSED PERSON STATE, which is where validity and eligibility stay separate.
 */
function classifyAccountabilityRecord(family, data, resolved) {
    const context = (0, accountablePersonStorage_1.accountabilityRecordContext)(family, data);
    const exception = (0, accountablePersonStorage_1.accountabilityExceptionId)(data);
    if (exception !== null) {
        return {
            bucket: "governedException",
            context,
            reason: `explicit governed accountability exception ${exception} (#180)`,
            composed: null,
        };
    }
    const stored = (0, accountablePersonStorage_1.readStoredAccountablePerson)(data);
    if (stored.state === "ABSENT") {
        return { bucket: "missing", context, reason: "no accountable person is recorded", composed: null };
    }
    if (stored.state === "UNREADABLE") {
        return {
            bucket: "presentUnreadable",
            context,
            reason: stored.detail ?? `stored ${accountablePersonStorage_1.ACCOUNTABLE_PERSON_FIELD} is not a usable Employee id`,
            composed: null,
        };
    }
    const composed = resolved.get(stored.accountableEmployeeId);
    if (composed === undefined) {
        return {
            bucket: "authorityUnavailable",
            context,
            reason: `no authoritative answer was obtained for ${stored.accountableEmployeeId}. This is NOT a ` +
                "finding that the person is missing or invalid (#187 s2).",
            composed: null,
        };
    }
    switch (composed.state) {
        case "VALID_CURRENT":
            return { bucket: "presentValidEligible", context, reason: null, composed };
        case "VALID_NOT_CURRENTLY_ELIGIBLE":
            return {
                bucket: "presentValidNotCurrentlyEligible",
                context,
                reason: `${stored.accountableEmployeeId} is a VALID reference (lifecycle status ` +
                    `${composed.eligibility?.employmentStatus ?? "unknown"}) that is NOT currently eligible ` +
                    `under governed policy ${composed.eligibility?.policyId ?? "unknown"}`,
                composed,
            };
        case "MISSING_OR_INVALID_REFERENCE":
            return {
                bucket: "presentInvalid",
                context,
                reason: `no governed Employee resolves ${stored.accountableEmployeeId}`,
                composed,
            };
        case "AUTHORITY_UNAVAILABLE":
            return {
                bucket: "authorityUnavailable",
                context,
                reason: `the Employee authority could not answer for ${stored.accountableEmployeeId}. NOT a finding ` +
                    "about the person (#187 s2).",
                composed,
            };
        default:
            // An unrecognised composed state is not a healthy record. Fail closed rather than default-pass.
            return {
                bucket: "authorityUnavailable",
                context,
                reason: `unrecognised composed person state for ${stored.accountableEmployeeId}`,
                composed: null,
            };
    }
}
const isNotApplicable = (entry) => "scope" in entry && entry.scope === "NOT_APPLICABLE";
exports.isNotApplicable = isNotApplicable;
const isCensusError = (entry) => "error" in entry;
exports.isCensusError = isCensusError;
const isMeasured = (entry) => "scope" in entry && entry.scope === "IN_SCOPE";
exports.isMeasured = isMeasured;
/** The answer for a family outside the governed scope. The ONLY thing this census says about one. */
function accountabilityNotApplicable(family) {
    return {
        family,
        scope: "NOT_APPLICABLE",
        why: `${family} carries no governed ACCOUNTABLE PERSON semantics (#189 OD-16). Accountability is NOT ` +
            "APPLICABLE to it — not MISSING, not OWNERLESS, not DEFECTIVE. A family enters scope only when " +
            "governed authority admits it, and this census must not manufacture a backlog for one that has not.",
    };
}
class AccountabilityCensusConfigurationError extends Error {
    code = "ELIGIBILITY_POLICY_REQUIRED";
    constructor(message) {
        super(message);
        this.name = "AccountabilityCensusConfigurationError";
    }
}
exports.AccountabilityCensusConfigurationError = AccountabilityCensusConfigurationError;
/**
 * Resolve every DISTINCT present reference in one family, once each, and compose each with the policy.
 *
 * A reference whose lookup THROWS is recorded as `AUTHORITY_UNAVAILABLE` rather than omitted, because
 * omitting it would send the classifier down its map-miss branch, which reports the same thing but
 * loses the reason the authority gave.
 */
async function resolveReferences(deps, tenantId, ids) {
    const resolved = new Map();
    for (const employeeId of ids) {
        const reference = { tenantId, employeeId };
        let composed;
        try {
            const resolution = await deps.employeeAuthority.resolveEmployeeReference(reference);
            composed = (0, employeeAuthority_1.composePersonReferenceState)(resolution, deps.eligibilityPolicy);
        }
        catch (err) {
            composed = (0, employeeAuthority_1.composePersonReferenceState)({
                outcome: "AUTHORITY_UNAVAILABLE",
                reference,
                reason: "AUTHORITY_READ_FAILED",
                detail: err instanceof Error ? err.message : String(err),
            }, deps.eligibilityPolicy);
        }
        resolved.set(employeeId, composed);
    }
    return resolved;
}
/**
 * Measure ONE family.
 *
 * A family outside the governed scope returns the NOT APPLICABLE report WITHOUT reading a single
 * document — the applicability question is about the family, so answering it needs no records, and
 * scanning them would produce the fake backlog #189 `OD-16` forbids.
 */
async function censusAccountabilityFamily(deps, family, tenantId, documents, truncated = false) {
    if (!deps?.eligibilityPolicy || !deps.eligibilityPolicy.policyId) {
        throw new AccountabilityCensusConfigurationError("the accountability census requires a governed eligibility policy stating its author. #189 " +
            "MI-epsilon: the gate consumes the governed eligibility result and must not flatten the " +
            "six-value employment vocabulary into a hidden boolean policy.");
    }
    if ((0, accountabilityFamilyScope_1.accountabilityFamilyScope)(family) !== "IN_SCOPE")
        return accountabilityNotApplicable(family);
    const storage = (0, accountablePersonStorage_1.accountablePersonStorage)(family);
    if (storage === null) {
        // Unreachable while the scope module and the storage declaration agree, and asserted in the
        // tests. Fail closed rather than measure a family whose storage nobody declared.
        return accountabilityNotApplicable(family);
    }
    // DISTINCT ids only — one authority call per person, not per record.
    const ids = new Set();
    for (const doc of documents) {
        if ((0, accountablePersonStorage_1.accountabilityExceptionId)(doc.data) !== null)
            continue;
        const stored = (0, accountablePersonStorage_1.readStoredAccountablePerson)(doc.data);
        if (stored.state === "PRESENT")
            ids.add(stored.accountableEmployeeId);
    }
    const resolved = await resolveReferences(deps, tenantId, [...ids]);
    const counts = (0, exports.emptyAccountabilityCounts)();
    const actionable = (0, exports.emptyAccountabilityCounts)();
    const historical = (0, exports.emptyAccountabilityCounts)();
    const reasons = {};
    const samples = {};
    for (const bucket of exports.ACCOUNTABILITY_BUCKETS)
        samples[bucket] = [];
    for (const doc of documents) {
        const classification = classifyAccountabilityRecord(family, doc.data, resolved);
        counts[classification.bucket] += 1;
        (classification.context === "ACTIONABLE" ? actionable : historical)[classification.bucket] += 1;
        if (classification.bucket === "presentValidEligible")
            continue;
        const reason = classification.reason ?? "(no reason given)";
        reasons[reason] = (reasons[reason] ?? 0) + 1;
        if (samples[classification.bucket].length < exports.MAX_SAMPLE_IDS) {
            samples[classification.bucket].push(doc.id);
        }
    }
    return {
        family,
        collection: storage.collection,
        scope: "IN_SCOPE",
        scanned: documents.length,
        truncated,
        counts,
        actionable,
        historical,
        reasons,
        samples,
        eligibilityPolicyId: deps.eligibilityPolicy.policyId,
    };
}
/**
 * Reduce the family reports to the gate's input.
 *
 * ════════════════════ WHAT BLOCKS, AND WHY EACH ONE ════════════════════
 *
 * ON AN ACTIONABLE RECORD: `missing` (#180 — exactly one accountable person, absent a governed
 * exception) · `presentInvalid` (#182 state C) · `presentUnreadable` (#189 `MI-λ` — a legacy
 * unresolved reference "cannot satisfy current responsibility integrity") · and
 * `presentValidNotCurrentlyEligible`, which is the one that is easiest to get wrong in the lenient
 * direction. #189 `MI-ε`: "the actionable record may become RESPONSIBILITY DEFECT — ACCOUNTABLE PERSON
 * NOT CURRENTLY ELIGIBLE... the census must detect the defect."
 *
 * IN EITHER CONTEXT: `authorityUnavailable`. It blocks on a HISTORICAL record too, and that is not an
 * oversight — we do not know what the record holds, so we cannot know that it is history we are
 * looking at rather than a current defect. #187 §2's fail-closed means the unknown blocks.
 *
 * WHAT DOES NOT BLOCK: every finding on a HISTORICAL record other than an unobtainable answer (#186
 * §7 — "Do not rewrite history. Do not invalidate historical audit solely because the employee is not
 * currently eligible"), and `governedException` in either context (#180).
 *
 * ════════════════════ ZERO MEASURED FAMILIES IS NEVER ASSESSABLE ════════════════════
 *
 * `measuredFamilies === 0` makes `assessable` false even with nothing blocking, because a gate that
 * passed on an empty report would pass hardest when the census was misconfigured. The ownership
 * census's own `censusGate` has the same property by a different route — a family it could not read
 * lands in `unreadable` — and this is the accountability axis's version of it.
 */
function accountabilityCensusVerdict(entries) {
    const unreadable = entries.filter(exports.isCensusError).map((e) => e.family);
    const notApplicable = entries.filter(exports.isNotApplicable).map((e) => e.family);
    const measured = entries.filter(exports.isMeasured);
    const totals = (0, exports.emptyAccountabilityCounts)();
    const actionable = (0, exports.emptyAccountabilityCounts)();
    const historical = (0, exports.emptyAccountabilityCounts)();
    for (const report of measured) {
        for (const bucket of exports.ACCOUNTABILITY_BUCKETS) {
            totals[bucket] += report.counts[bucket];
            actionable[bucket] += report.actionable[bucket];
            historical[bucket] += report.historical[bucket];
        }
    }
    const blocking = actionable.missing +
        actionable.presentInvalid +
        actionable.presentUnreadable +
        actionable.presentValidNotCurrentlyEligible +
        // BOTH contexts. An unobtainable answer is not evidence that the record is historical.
        actionable.authorityUnavailable +
        historical.authorityUnavailable;
    const historicalFindings = historical.missing +
        historical.presentInvalid +
        historical.presentUnreadable +
        historical.presentValidNotCurrentlyEligible;
    const truncated = measured.filter((r) => r.truncated).map((r) => r.family);
    return {
        blocking,
        authorityUnavailable: totals.authorityUnavailable,
        historicalFindings,
        unreadable,
        truncated,
        notApplicable,
        totals,
        actionable,
        historical,
        measuredFamilies: measured.length,
        assessable: blocking === 0 && unreadable.length === 0 && truncated.length === 0 && measured.length > 0,
    };
}
//# sourceMappingURL=accountabilityCensus.js.map