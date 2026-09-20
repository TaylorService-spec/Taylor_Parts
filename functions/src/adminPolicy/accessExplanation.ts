// WHY DOES THIS PRINCIPAL HAVE THIS ACCESS?
//
// Pure: no database, no Firebase, no I/O, no clock. Every fact arrives as an input, so an
// explanation is a function of the evidence and two runs over the same evidence explain it the same
// way. It DECIDES nothing -- the resolvers decide; this says why they decided it.
//
// ════════════════════ TWO AXES, NEVER CONFLATED ════════════════════
//
// THE SECURITY AXIS -- what a PRINCIPAL may do in the system:
//
//   External Identity -> Principal -> Tenant Membership -> Security Role Assignment
//                     -> Capability / governed evaluator
//
// THE BUSINESS-PERSON AXIS -- who an EMPLOYEE is and what work they may be given:
//
//   Principal <-> Employee -> Job Role -> Work Eligibility -> Operational Scope
//
// They meet at exactly ONE point: the Principal <-> Employee link. Nowhere else. A Job Role is not
// a permission; Work Eligibility is not a permission; an Operational Scope is not a Security Role
// scope; and a legacy `users/{uid}.role` string is not an authority at all.
//
// THIS MODULE ENFORCES THAT STRUCTURALLY. An explanation may cite only SECURITY-axis reasons, and
// `explainAccess` REFUSES to emit a business-axis one. That refusal is the point: the easiest way to
// ship a conflation is to let it appear in an explanation first, where it reads like a helpful
// detail rather than the authority it is quietly becoming.
export const SECURITY_AXIS_REASONS = Object.freeze([
  /** A Security Role assignment that is active and not stale. */
  "ROLE_ASSIGNMENT",
  /** That Role's capability grant. */
  "ROLE_CAPABILITY",
  /** That Role's object permission. */
  "ROLE_OBJECT_PERMISSION",
  /** A field-level override on that Role. */
  "ROLE_FIELD_OVERRIDE",
  /** The assignment's own scope narrowed or permitted the decision. */
  "ASSIGNMENT_SCOPE",
  /** Tenant membership -- the precondition for every other reason above. */
  "TENANT_MEMBERSHIP",
] as const);
export type SecurityAxisReason = (typeof SECURITY_AXIS_REASONS)[number];

/**
 * Reasons access is REFUSED. A refusal explained is a refusal someone can act on; an unexplained
 * one sends them to ask an administrator who also cannot see why.
 */
export const REFUSAL_REASONS = Object.freeze([
  "NO_TENANT_MEMBERSHIP",
  "NO_QUALIFYING_ROLE_ASSIGNMENT",
  /** A Role is held, but it grants nothing for this question. */
  "ROLE_GRANTS_NOTHING_HERE",
  /** A Role would grant it, but only in a scope this decision is not in. */
  "OUT_OF_ASSIGNMENT_SCOPE",
  /** An assignment existed but the principal's access version moved past it. */
  "ASSIGNMENT_STALE",
  /** FAIL CLOSED: the capability, object or scope type is not in the governed vocabulary. */
  "UNKNOWN_TO_THE_GOVERNED_VOCABULARY",
] as const);
export type RefusalReason = (typeof REFUSAL_REASONS)[number];

/**
 * Business-axis facts. Present so they can be SHOWN beside an explanation and never inside one.
 *
 * An administrator genuinely needs to see that a Principal is linked to an Employee who holds a Job
 * Role and a qualification -- it is how they understand the person. What must never happen is one of
 * these appearing as a REASON, which is why they live in a separate field with a separate type.
 */
export interface BusinessPersonContext {
  readonly employeeId: string | null;
  readonly employmentStatus: string | null;
  readonly jobRoleKey: string | null;
  readonly workEligibilityCodes: readonly string[];
  readonly operationalScopes: readonly { readonly scopeType: string; readonly scopeId: string }[];
}

export interface ExplanationStep {
  readonly reason: SecurityAxisReason;
  /** The governed record this step rests on: a role id, an assignment id, a capability key. */
  readonly evidenceId: string;
  /** One line a person can read. Never a raw record dump. */
  readonly detail: string;
}

export interface AccessExplanation {
  readonly question: string;
  readonly granted: boolean;
  /** Ordered from the precondition outwards. Empty exactly when `granted` is false. */
  readonly steps: readonly ExplanationStep[];
  /** Why not. Empty exactly when `granted` is true. */
  readonly refusals: readonly RefusalReason[];
  /**
   * Shown BESIDE the explanation, never as part of it. Null when the Principal is not a linked
   * Employee, which is a perfectly ordinary state for a Principal that is not a person's login.
   */
  readonly businessContext: BusinessPersonContext | null;
  /** True when anything in the question was outside the governed vocabulary. Fail closed. */
  readonly failedClosed: boolean;
}

export interface ExplainAccessInput {
  readonly question: string;
  readonly hasTenantMembership: boolean;
  /** Assignments that qualified: active, not stale, with their scope. */
  readonly qualifyingAssignments: readonly {
    readonly assignmentId: string;
    readonly roleId: string;
    readonly roleKey: string;
    readonly scopeType: string;
    readonly scopeValue: string | null;
  }[];
  /** Capability keys each qualifying Role grants, keyed by role id. */
  readonly capabilitiesByRoleId: ReadonlyMap<string, readonly string[]>;
  /** The capability being asked about. */
  readonly capabilityKey: string;
  /** The governed capability vocabulary. A key outside it fails closed. */
  readonly knownCapabilityKeys: ReadonlySet<string>;
  /** True when an assignment was excluded as stale. */
  readonly hadStaleAssignment: boolean;
  /** Shown beside the explanation. Never consulted when deciding. */
  readonly businessContext?: BusinessPersonContext | null;
}

const step = (s: ExplanationStep): ExplanationStep => Object.freeze(s);

/**
 * Explain one capability question.
 *
 * The evaluation order is the authority chain itself: membership, then a qualifying assignment,
 * then that Role's grant. A reader following the steps is following the model.
 */
export function explainAccess(input: ExplainAccessInput): AccessExplanation {
  const refusals: RefusalReason[] = [];
  const steps: ExplanationStep[] = [];
  const businessContext = input.businessContext ?? null;

  // FAIL CLOSED FIRST. An unknown capability is not "denied because no Role grants it" -- nobody
  // could grant it, and saying so sends an administrator to fix the right thing.
  if (!input.knownCapabilityKeys.has(input.capabilityKey)) {
    return Object.freeze({
      question: input.question, granted: false, steps: Object.freeze([]),
      refusals: Object.freeze(["UNKNOWN_TO_THE_GOVERNED_VOCABULARY" as RefusalReason]),
      businessContext, failedClosed: true,
    });
  }

  if (!input.hasTenantMembership) {
    // Every other reason presupposes this one, so there is nothing further to say.
    return Object.freeze({
      question: input.question, granted: false, steps: Object.freeze([]),
      refusals: Object.freeze(["NO_TENANT_MEMBERSHIP" as RefusalReason]),
      businessContext, failedClosed: false,
    });
  }
  steps.push(step({
    reason: "TENANT_MEMBERSHIP", evidenceId: "membership",
    detail: "the Principal is an active member of this tenant",
  }));

  if (input.qualifyingAssignments.length === 0) {
    refusals.push(input.hadStaleAssignment ? "ASSIGNMENT_STALE" : "NO_QUALIFYING_ROLE_ASSIGNMENT");
    return Object.freeze({
      question: input.question, granted: false, steps: Object.freeze([]),
      refusals: Object.freeze(refusals), businessContext, failedClosed: false,
    });
  }

  const granting = input.qualifyingAssignments.filter((a) =>
    (input.capabilitiesByRoleId.get(a.roleId) ?? []).includes(input.capabilityKey));

  if (granting.length === 0) {
    refusals.push("ROLE_GRANTS_NOTHING_HERE");
    if (input.hadStaleAssignment) refusals.push("ASSIGNMENT_STALE");
    return Object.freeze({
      question: input.question, granted: false, steps: Object.freeze([]),
      refusals: Object.freeze(refusals), businessContext, failedClosed: false,
    });
  }

  for (const a of granting) {
    steps.push(step({
      reason: "ROLE_ASSIGNMENT", evidenceId: a.assignmentId,
      detail: `the Security Role ${a.roleKey} is assigned to this Principal`,
    }));
    steps.push(step({
      reason: "ROLE_CAPABILITY", evidenceId: `${a.roleId}:${input.capabilityKey}`,
      detail: `${a.roleKey} grants ${input.capabilityKey}`,
    }));
    steps.push(step({
      reason: "ASSIGNMENT_SCOPE", evidenceId: a.assignmentId,
      detail: a.scopeValue === null
        ? `that assignment is ${a.scopeType} in scope`
        : `that assignment is scoped to ${a.scopeType} ${a.scopeValue}`,
    }));
  }

  return Object.freeze({
    question: input.question, granted: true, steps: Object.freeze(steps),
    refusals: Object.freeze([]), businessContext, failedClosed: false,
  });
}

/**
 * THE CONFLATION GUARD.
 *
 * Returns every step whose detail cites a BUSINESS-axis fact. A correct explanation returns none.
 *
 * It matches on the vocabulary rather than on types, deliberately: a conflation arrives as a string
 * in a `detail` line long before anyone gives it a type, and by the time it has a type it is a
 * feature. The Administration surface runs this over every explanation it renders.
 */
export const BUSINESS_AXIS_TERMS = Object.freeze([
  "job role", "jobrole", "work eligibility", "workeligibility", "qualification",
  "operational scope", "operationalscope", "operationalroles", "operational role",
  "users.role", "users/{uid}.role", "firebase claim", "custom claim", "technician id",
] as const);

export function businessAxisCitations(explanation: AccessExplanation): readonly ExplanationStep[] {
  return Object.freeze(explanation.steps.filter((s) => {
    const haystack = `${s.detail} ${s.evidenceId}`.toLowerCase();
    return BUSINESS_AXIS_TERMS.some((term) => haystack.includes(term));
  }));
}

/**
 * The access simulator: the same explanation, for a question nobody is actually asking right now.
 *
 * It takes the SAME input shape and calls the SAME function, which is the only way a simulator is
 * worth having -- one that modelled access separately would eventually disagree with the resolver,
 * and the disagreement would show up as an administrator confidently granting the wrong thing.
 */
export function simulateAccess(input: ExplainAccessInput): AccessExplanation {
  return explainAccess(input);
}
