"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isGlobalAssignment = exports.VALUE_MATCHED_SCOPE_TYPES = void 0;
exports.assignmentAdmitsDecision = assignmentAdmitsDecision;
exports.assignmentsInScope = assignmentsInScope;
/** Scope types matched by exact value. Everything else is admitted globally, refused, or answered elsewhere. */
exports.VALUE_MATCHED_SCOPE_TYPES = Object.freeze(["domain", "location", "operatingCompany", "businessUnit", "salesChannel"]);
const VALUE_MATCHED = new Set(exports.VALUE_MATCHED_SCOPE_TYPES);
const exactValue = (v) => typeof v === "string" && v !== "" && v.trim() === v;
/**
 * Does this assignment's scope admit this decision?
 *
 * Fail-closed in every direction: an unknown type, a missing value, a type mismatch, a value mismatch and a decision
 * with no stated scope all return false. Only `global`, and an exact same-type same-value match, return true.
 */
function assignmentAdmitsDecision(assignment, decision) {
    const type = assignment?.scopeType;
    if (typeof type !== "string" || type === "")
        return false;
    if (type === "global")
        return true;
    // Reserved-and-inert, and a record question with no record here. Both refuse rather than fall through.
    if (type === "tenant" || type === "ownAssignment")
        return false;
    if (!VALUE_MATCHED.has(type))
        return false;
    if (!exactValue(assignment.scopeValue))
        return false;
    if (!decision || !exactValue(decision.scopeValue) || decision.scopeType !== type)
        return false;
    return decision.scopeValue === assignment.scopeValue;
}
/** True when the assignment applies everywhere. The only shape that survives a decision stating no scope. */
const isGlobalAssignment = (assignment) => assignment?.scopeType === "global";
exports.isGlobalAssignment = isGlobalAssignment;
/**
 * Narrow a set of qualifying assignments to those whose scope admits this decision.
 *
 * Passing `null` keeps GLOBAL assignments only -- which is what "this decision has no scope" must mean. Treating an
 * unscoped decision as admitting every scope is the exact widening this lane exists to prevent.
 */
function assignmentsInScope(assignments, decision) {
    return assignments.filter((a) => assignmentAdmitsDecision(a, decision));
}
//# sourceMappingURL=assignmentScope.js.map