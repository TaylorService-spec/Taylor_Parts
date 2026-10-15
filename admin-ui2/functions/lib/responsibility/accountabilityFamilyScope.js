"use strict";
// ACCOUNTABILITY FAMILY APPLICABILITY — Owner ruling #189 (`OD-16`).
//
// PURE. This module imports NOTHING — no storage, no clock, no Firebase, no `node:` module. It is
// one governed fact expressed as code: which record families carry ACCOUNTABLE PERSON semantics.
//
// ════════════════════ WHY A THIRD STATE IS NOT ADDED ════════════════════
//
// #189 `OD-16` is explicit that a family outside the governed scope is **NOT APPLICABLE** and that
// this is not the same as a defect:
//
//     "Out-of-scope families: accountability is NOT APPLICABLE — not MISSING, not OWNERLESS, not
//      DEFECTIVE. Reference and master-data objects must not acquire fake personal accountability."
//
// So `accountabilityFamilyScope` returns NOT_APPLICABLE and never anything that reads as a finding
// about the record. A caller that mapped NOT_APPLICABLE onto "no accountable person → defect" would
// be inventing the fake accountability the ruling forbids, and the vocabulary here gives it no word
// for that.
//
// ════════════════════ WHY THE LIST IS A LITERAL, NOT DERIVED FROM THE OWNERSHIP MATRIX ════════════════════
//
// #187 §1 (`MI-Y`, option ii) rules that accountability gets its OWN measurement and that
// "`accountablePerson` must NOT be placed into `ownershipMatrix.ownerFields`", and #186 §9 adds that
// "the `ownershipMatrix.ownerFields` mechanism must not be made to carry this multi-axis model".
// Deriving this list from the ownership matrix — "every PERSON-owned family" — would make the two
// axes one axis with two readers, which is exactly the collapse both rulings refuse. The three
// families are therefore named, from the ruling, by literal.
//
// ════════════════════ ADMISSION IS A RULING, NOT AN EDIT ════════════════════
//
// #189 `OD-16`: "A family enters accountability enforcement ONLY when governed authority defines
// that family as requiring Accountable Person semantics", and lists the eight facts a family must
// establish first. Adding a member here without that ruling is the "do not infer" case the ruling
// names, so the list is frozen and the guard test asserts its exact membership.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACCOUNTABILITY_FAMILIES = void 0;
exports.accountabilityFamilyScope = accountabilityFamilyScope;
/**
 * The INITIAL GOVERNED SCOPE, verbatim from #189 `OD-16`: OPPORTUNITY · SALES AGREEMENT · SALES
 * ORDER — "the three commercial families #181 already rules to separately carry an accountable
 * person."
 *
 * The keys are the ownership matrix's family keys (`functions/src/ownership/ownershipMatrix.ts`) so
 * that one command can name one family once. That is a NAMING agreement and not a data dependency:
 * nothing here reads the matrix, and the accountability axis is not derived from the ownership axis.
 */
exports.ACCOUNTABILITY_FAMILIES = Object.freeze([
    "opportunity",
    "salesAgreement",
    "salesOrder",
]);
/** Total, and never throws — a caller passing junk gets NOT_APPLICABLE, which is fail-closed here. */
function accountabilityFamilyScope(family) {
    return typeof family === "string" && exports.ACCOUNTABILITY_FAMILIES.includes(family)
        ? "IN_SCOPE"
        : "NOT_APPLICABLE";
}
//# sourceMappingURL=accountabilityFamilyScope.js.map