// CONTEXTUAL AUTHORIZATION -- "may this Principal act on THIS record, in THIS business context?"
//
// ════════════════════ SCOPE DOES NOT LIVE ON THE GRANT ════════════════════
//
// A capability grant answers ONE question: may this Principal perform this TYPE of action? It is a
// row in `role_capabilities` or `principal_capabilities` and it carries no scope, no ownOnly, no
// warehouseId and no assignmentRequired -- by Owner ruling and by schema. Everything about WHICH
// records is answered here, by separate governed authorities, and the two must never be merged:
// the moment a grant row carries a scope, "who may do this" and "to what" become one unreadable
// fact and every Administration screen has to explain a compound.
//
// ════════════════════ THE LAYERS, KEPT SEPARATE ════════════════════
//
//   1  PRINCIPAL            the authenticated actor
//   2  SECURITY CAPABILITY  role_capabilities + principal_capabilities   -- checked FIRST, always
//   3  WORK ELIGIBILITY     eos_workforce.employee_work_eligibility      -- what work an EMPLOYEE may be given
//   4  OPERATIONAL SCOPE    eos_workforce.employee_operational_scopes    -- where they may do it
//   5  RECORD RELATIONSHIP  assignment / ownership / requester           -- this record, specifically
//   6  DOMAIN PRECONDITION  lifecycle, inventory, approvals              -- NOT decided here
//
// These are different authorities answering different questions. A shared evaluator may process
// them; it may not collapse them. Operational Scope is not Record Assignment: "may work in
// warehouse 3" and "is assigned THIS request" are unrelated facts, and a model that conflates them
// gives everyone in the warehouse everyone else's work.
//
// ════════════════════ ORDER IS AN AUTHORIZATION PROPERTY ════════════════════
//
// CAPABILITY FIRST, ALWAYS. A caller without the capability is told exactly that and nothing else.
// Evaluating record context first would leak business facts -- "that request is not yours" tells an
// unauthorized caller the request exists, who it belongs to, and that they guessed a real id.
// LIVES IN eosOps, NOT adminPolicy, and the architecture test is why. `src/adminPolicy` has a
// strict DAL port: exactly two files may import the postgres driver, and everything else reaches
// storage through the injected repository. This evaluator is not policy STORAGE -- it composes a
// capability set the policy subsystem produced with relation tables in eos_ops and eos_workforce,
// which the policy port neither owns nor should learn about. It belongs beside
// eosOps/capabilityAuthority.ts, the runtime resolver it partners with.
import type { PoolClient } from "pg";

/** The predicate kinds this evaluator can prove. Each is a DIFFERENT authority, not a scope string. */
export const CONTEXT_PREDICATE_KINDS = Object.freeze([
  "WORK_ELIGIBILITY", "OPERATIONAL_SCOPE", "RECORD_ASSIGNMENT",
] as const);
export type ContextPredicateKind = (typeof CONTEXT_PREDICATE_KINDS)[number];

export type ContextPredicate =
  | { readonly kind: "WORK_ELIGIBILITY"; readonly qualificationCode: string }
  | { readonly kind: "OPERATIONAL_SCOPE"; readonly scopeType: string }
  | { readonly kind: "RECORD_ASSIGNMENT"; readonly relation: "ASSIGNED_EMPLOYEE" };

export type AuthorizationReason =
  | "ALLOWED"
  | "CAPABILITY_MISSING"
  | "EMPLOYEE_LINK_REQUIRED"
  | "WORK_ELIGIBILITY_MISSING"
  | "OUTSIDE_OPERATIONAL_SCOPE"
  | "NOT_ASSIGNED"
  /**
   * The policy names a qualification the governed vocabulary cannot express. FAIL CLOSED and say so
   * distinctly: this is not "you are not eligible", it is "this platform cannot yet decide whether
   * you are". Collapsing the two would report a migration gap as an ordinary denial.
   */
  | "WORK_ELIGIBILITY_UNMAPPED";

export interface AuthorizationDecision {
  readonly allowed: boolean;
  readonly reason: AuthorizationReason;
  /** Which predicate refused, for audit. Absent when the capability itself was missing. */
  readonly predicate?: ContextPredicateKind;
  readonly detail?: string;
}

const ALLOW: AuthorizationDecision = Object.freeze({ allowed: true, reason: "ALLOWED" });
const deny = (reason: AuthorizationReason, predicate?: ContextPredicateKind, detail?: string): AuthorizationDecision =>
  Object.freeze({ allowed: false, reason, predicate, detail });

/**
 * The governed Work Eligibility vocabulary, mirrored so an unmappable legacy qualification is
 * REFUSED rather than silently treated as satisfied.
 *
 * `PARTS_ASSOCIATE` is deliberately absent. It is the qualification technician's seven Reorder
 * grants are gated on, and the Owner ruled exactly two legacy operational roles deterministic
 * migration candidates -- TECHNICIAN and WAREHOUSE_ASSOCIATE. Mapping PARTS_ASSOCIATE onto either
 * would invent an Owner decision and hand technicians an eligibility they were never granted.
 */
export const GOVERNED_QUALIFICATION_CODES: ReadonlySet<string> =
  Object.freeze(new Set(["SERVICE_TECHNICIAN", "WAREHOUSE_OPERATIONS"]));

export interface RecordContext {
  /** Which governed relation table answers "is this mine". */
  readonly recordKind: "reorderRequest" | "workOrder";
  readonly recordId: string;
}

export interface ContextualActor {
  readonly tenantId: string;
  readonly principalId: string;
  /** Effective capability keys -- role-derived, direct, or both. Provenance is irrelevant here. */
  readonly capabilities: ReadonlySet<string>;
}

export interface ContextualReader {
  /**
   * The caller's governed Employee, through the Principal link. NEVER a Firebase uid, never an
   * email, never a name. Returns null when this Principal has no linked Employee -- which is a
   * legitimate state for a service or administrative Principal, not an error by itself.
   */
  linkedEmployeeId(tenantId: string, principalId: string): Promise<string | null>;
  hasWorkEligibility(tenantId: string, employeeId: string, qualificationCode: string): Promise<boolean>;
  hasOperationalScope(tenantId: string, employeeId: string, scopeType: string): Promise<boolean>;
  isAssignedEmployee(tenantId: string, recordKind: RecordContext["recordKind"], recordId: string, employeeId: string): Promise<boolean>;
}

export interface AuthorizeInput {
  readonly actor: ContextualActor;
  readonly capabilityKey: string;
  /** Exactly the predicates this ACTION requires. Policy about the action, never about a grant. */
  readonly predicates?: readonly ContextPredicate[];
  readonly record?: RecordContext;
}

/**
 * Evaluate one action, in order, checking only the predicates that action declares.
 *
 * NOTHING HERE IS CALLER-SUPPLIED except the record id. The Employee, the eligibility, the scope
 * and the assignment are all read server-side from governed tables. A caller cannot assert that a
 * record is theirs.
 */
export async function authorizeObjectAction(
  reader: ContextualReader,
  input: AuthorizeInput,
): Promise<AuthorizationDecision> {
  const { actor } = input;
  // 2. SECURITY CAPABILITY -- first, and on its own.
  if (!(actor.capabilities instanceof Set) || !actor.capabilities.has(input.capabilityKey)) {
    return deny("CAPABILITY_MISSING", undefined, input.capabilityKey);
  }
  const predicates = input.predicates ?? [];
  if (predicates.length === 0) return ALLOW;

  // Employee context is resolved ONCE, and only because a predicate asked for it. An action with no
  // Employee-bearing predicate never touches the workforce authority at all -- which is what keeps
  // purely administrative actions usable by Principals who are not Employees.
  let employeeId: string | null | undefined;
  const requireEmployee = async (): Promise<string | null> => {
    if (employeeId === undefined) employeeId = await reader.linkedEmployeeId(actor.tenantId, actor.principalId);
    return employeeId;
  };

  for (const predicate of predicates) {
    switch (predicate.kind) {
      case "WORK_ELIGIBILITY": {
        if (!GOVERNED_QUALIFICATION_CODES.has(predicate.qualificationCode)) {
          return deny("WORK_ELIGIBILITY_UNMAPPED", "WORK_ELIGIBILITY", predicate.qualificationCode);
        }
        const id = await requireEmployee();
        if (!id) return deny("EMPLOYEE_LINK_REQUIRED", "WORK_ELIGIBILITY");
        if (!(await reader.hasWorkEligibility(actor.tenantId, id, predicate.qualificationCode))) {
          return deny("WORK_ELIGIBILITY_MISSING", "WORK_ELIGIBILITY", predicate.qualificationCode);
        }
        break;
      }
      case "OPERATIONAL_SCOPE": {
        const id = await requireEmployee();
        if (!id) return deny("EMPLOYEE_LINK_REQUIRED", "OPERATIONAL_SCOPE");
        if (!(await reader.hasOperationalScope(actor.tenantId, id, predicate.scopeType))) {
          return deny("OUTSIDE_OPERATIONAL_SCOPE", "OPERATIONAL_SCOPE", predicate.scopeType);
        }
        break;
      }
      case "RECORD_ASSIGNMENT": {
        if (!input.record) return deny("NOT_ASSIGNED", "RECORD_ASSIGNMENT", "no record supplied");
        const id = await requireEmployee();
        if (!id) return deny("EMPLOYEE_LINK_REQUIRED", "RECORD_ASSIGNMENT");
        if (!(await reader.isAssignedEmployee(actor.tenantId, input.record.recordKind, input.record.recordId, id))) {
          return deny("NOT_ASSIGNED", "RECORD_ASSIGNMENT");
        }
        break;
      }
      default:
        // An unknown predicate is a gate this evaluator cannot prove, and an unprovable gate must
        // never open. Same posture as the legacy Condition evaluator, for the same reason.
        return deny("NOT_ASSIGNED", undefined, "unsupported predicate");
    }
  }
  return ALLOW;
}

// ════════════════════ LIST ENFORCEMENT ════════════════════
//
// A per-record decision cannot answer "show me my requests": fetching the queue and filtering after
// the fact means the queue left the database. For a list, the relation becomes part of the QUERY.

/** The governed relation tables. A record kind maps to exactly one; there is no generic "owner" column. */
const ASSIGNMENT_RELATIONS = Object.freeze({
  // The two tables DISAGREE about the assignee column name -- `assigned_employee_id` in Reorder,
  // `assignee_employee_id` in Work Order. Both are governed Employee ids and both keep an open
  // interval; only the spelling differs. Naming each one explicitly is why this evaluator works
  // against the schema rather than against a guess about it.
  reorderRequest: { table: "eos_ops.reorder_request_assignments", recordColumn: "reorder_request_id", employeeColumn: "assigned_employee_id" },
  workOrder: { table: "eos_ops.work_order_assignments", recordColumn: "work_order_id", employeeColumn: "assignee_employee_id" },
});

/**
 * A SQL fragment restricting a list to records assigned to this Employee, for use in the WHERE
 * clause of the domain's own query. The open interval is part of the predicate: an ENDED assignment
 * is not a current one, and forgetting that is how somebody keeps seeing work they handed over.
 */
export function ownRecordsPredicate(
  recordKind: RecordContext["recordKind"],
  recordIdColumn: string,
): { readonly sql: string; readonly params: readonly string[] } {
  const relation = ASSIGNMENT_RELATIONS[recordKind];
  return Object.freeze({
    sql: `EXISTS (SELECT 1 FROM ${relation.table} a
                   WHERE a.tenant_id = $1 AND a.${relation.recordColumn} = ${recordIdColumn}
                     AND a.${relation.employeeColumn} = $2 AND a.effective_to IS NULL)`,
    params: Object.freeze(["tenantId", "employeeId"]),
  });
}

/** The reader, over the governed tables. No Firestore, no uid, no claims. */
export function postgresContextualReader(db: Pick<PoolClient, "query">): ContextualReader {
  return {
    async linkedEmployeeId(tenantId, principalId) {
      const { rows } = await db.query(
        `SELECT employee_id FROM eos_policy.employee_principal_links
          WHERE tenant_id = $1 AND principal_id = $2 AND status = 'active'`,
        [tenantId, principalId]);
      return rows.length === 1 ? String(rows[0].employee_id) : null;
    },
    async hasWorkEligibility(tenantId, employeeId, qualificationCode) {
      const { rows } = await db.query(
        `SELECT 1 FROM eos_workforce.employee_work_eligibility
          WHERE tenant_id = $1 AND employee_id = $2 AND qualification_code = $3 AND effective_to IS NULL`,
        [tenantId, employeeId, qualificationCode]);
      return rows.length > 0;
    },
    async hasOperationalScope(tenantId, employeeId, scopeType) {
      const { rows } = await db.query(
        `SELECT 1 FROM eos_workforce.employee_operational_scopes
          WHERE tenant_id = $1 AND employee_id = $2 AND scope_type = $3 AND effective_to IS NULL`,
        [tenantId, employeeId, scopeType]);
      return rows.length > 0;
    },
    async isAssignedEmployee(tenantId, recordKind, recordId, employeeId) {
      const relation = ASSIGNMENT_RELATIONS[recordKind];
      const { rows } = await db.query(
        `SELECT 1 FROM ${relation.table}
          WHERE tenant_id = $1 AND ${relation.recordColumn} = $2
            AND ${relation.employeeColumn} = $3 AND effective_to IS NULL`,
        [tenantId, recordId, employeeId]);
      return rows.length > 0;
    },
  };
}
