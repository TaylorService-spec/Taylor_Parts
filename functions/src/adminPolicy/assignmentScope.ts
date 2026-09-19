// Authorization v2 parity, part B: SECURITY ROLE ASSIGNMENT SCOPE.
//
// Pure: no database, no Firebase, no I/O. It answers exactly one question:
//
//   does THIS assignment's scope admit THIS decision?
//
// ════════════════════ WHAT THIS IS NOT ════════════════════
//
// Security Role assignment scope is WHERE A PRINCIPAL'S SECURITY GRANT APPLIES. It is NOT Employee Operational
// Scope, which is where an EMPLOYEE is operationally eligible to work (eos_workforce.employee_operational_scopes).
// They are different authorities over different subjects and must never substitute for one another: a Principal
// scoped to a location does not thereby become an Employee scoped to a warehouse, and an Employee's warehouse scope
// grants no security authority anywhere. Nothing in this file reads, imports or names the Employee scope authority.
//
// ════════════════════ WHY ADDING THIS CANNOT WIDEN ANYTHING ════════════════════
//
// `loadPrincipalPolicy` previously reduced every qualifying assignment to its `roleId` and discarded
// `scope_type`/`scope_value` entirely, so a scoped grant was silently evaluated as though it were global. That is
// precisely why the migration-only Security Role assignment census refuses to migrate a scoped legacy
// assignment (MIGRATION_REFUSED_UNTIL_EVALUATOR_PARITY): copying one in would have WIDENED it.
//
// This module only ever REMOVES an assignment from a decision. Every rule below is a refusal, and the one admitting
// rule -- `global` admits everything -- is the behaviour the evaluator already had for every assignment. The only
// non-global assignment the product creates today is none at all (`tenantBootstrap.ts` creates `global`), so
// turning this on changes no current decision while making a scoped grant expressible for the first time.
//
// ════════════════════ THE RULES ════════════════════
//
//   global            admits every decision. The current, and only, shape the product creates.
//   ownAssignment     admits NOTHING here. It is a per-RECORD question about the target, which a scope check has no
//                     target to answer; `conditionedCapability.ts` answers it against the governed record instead.
//                     Admitting it here would answer a record question without a record.
//   tenant            admits NOTHING. Spec 5.4 reserves it as inert "until Issue #140 defines it; it must never
//                     widen access". Inert therefore means refuse, not "behave like global".
//   domain / location / operatingCompany / businessUnit
//                     admit only a decision that states a scope of the SAME type whose value matches EXACTLY.
//
// An unknown scope type, a scoped assignment with no value, and a decision that states no scope at all are all
// refusals. A decision with no scope is the common case and is exactly why the refusal matters: an unscoped decision
// must not silently collect a scoped grant.
import type { ScopeType } from "../types/access";

/** The scope facts of one qualifying assignment, exactly as stored. */
export interface AssignmentScope {
  readonly scopeType: string;
  readonly scopeValue: string | null;
}

/**
 * The scope a DECISION is being made in, resolved server-side.
 *
 * It is never caller-supplied: a request that could state its own scope could widen its own authority by naming the
 * scope its grant happens to carry. Callers resolve it from the governed record or the governed operation.
 */
export interface DecisionScope {
  readonly scopeType: ScopeType;
  readonly scopeValue: string;
}

/** Scope types matched by exact value. Everything else is admitted globally, refused, or answered elsewhere. */
export const VALUE_MATCHED_SCOPE_TYPES = Object.freeze(["domain", "location", "operatingCompany", "businessUnit"] as const);

const VALUE_MATCHED = new Set<string>(VALUE_MATCHED_SCOPE_TYPES);

const exactValue = (v: unknown): v is string => typeof v === "string" && v !== "" && v.trim() === v;

/**
 * Does this assignment's scope admit this decision?
 *
 * Fail-closed in every direction: an unknown type, a missing value, a type mismatch, a value mismatch and a decision
 * with no stated scope all return false. Only `global`, and an exact same-type same-value match, return true.
 */
export function assignmentAdmitsDecision(assignment: AssignmentScope, decision: DecisionScope | null): boolean {
  const type = assignment?.scopeType;
  if (typeof type !== "string" || type === "") return false;
  if (type === "global") return true;
  // Reserved-and-inert, and a record question with no record here. Both refuse rather than fall through.
  if (type === "tenant" || type === "ownAssignment") return false;
  if (!VALUE_MATCHED.has(type)) return false;
  if (!exactValue(assignment.scopeValue)) return false;
  if (!decision || !exactValue(decision.scopeValue) || decision.scopeType !== type) return false;
  return decision.scopeValue === assignment.scopeValue;
}

/** True when the assignment applies everywhere. The only shape that survives a decision stating no scope. */
export const isGlobalAssignment = (assignment: AssignmentScope): boolean => assignment?.scopeType === "global";

/**
 * Narrow a set of qualifying assignments to those whose scope admits this decision.
 *
 * Passing `null` keeps GLOBAL assignments only -- which is what "this decision has no scope" must mean. Treating an
 * unscoped decision as admitting every scope is the exact widening this lane exists to prevent.
 */
export function assignmentsInScope<T extends AssignmentScope>(
  assignments: readonly T[], decision: DecisionScope | null,
): readonly T[] {
  return assignments.filter((a) => assignmentAdmitsDecision(a, decision));
}
