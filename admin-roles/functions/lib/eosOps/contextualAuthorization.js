"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GOVERNED_QUALIFICATION_CODES = exports.CONTEXT_PREDICATE_KINDS = void 0;
exports.authorizeObjectAction = authorizeObjectAction;
exports.authorizeAnyPath = authorizeAnyPath;
exports.ownRecordsPredicate = ownRecordsPredicate;
exports.postgresContextualReader = postgresContextualReader;
exports.postgresPrincipalDimensionReader = postgresPrincipalDimensionReader;
exports.snapshotContextualReader = snapshotContextualReader;
const employmentAccessEligibility_1 = require("../adminPolicy/employmentAccessEligibility");
/** The predicate kinds this evaluator can prove. Each is a DIFFERENT authority, not a scope string. */
exports.CONTEXT_PREDICATE_KINDS = Object.freeze([
    "WORK_ELIGIBILITY", "OPERATIONAL_SCOPE", "RECORD_ASSIGNMENT",
]);
const ALLOW = Object.freeze({ allowed: true, reason: "ALLOWED" });
const deny = (reason, predicate, detail) => Object.freeze({ allowed: false, reason, predicate, detail });
/**
 * The governed Work Eligibility vocabulary, mirrored so an unmappable legacy qualification is
 * REFUSED rather than silently treated as satisfied.
 *
 * `PARTS_ASSOCIATE` is now here, registered in its own right by migration 1761696000000 rather than
 * mapped onto WAREHOUSE_OPERATIONS. Until that ruling it was refused as WORK_ELIGIBILITY_UNMAPPED,
 * which was the correct answer while the platform genuinely could not decide.
 */
exports.GOVERNED_QUALIFICATION_CODES = Object.freeze(new Set(["SERVICE_TECHNICIAN", "WAREHOUSE_OPERATIONS", "PARTS_OPERATIONS"]));
/**
 * Evaluate one action, in order, checking only the predicates that action declares.
 *
 * NOTHING HERE IS CALLER-SUPPLIED except the record id. The Employee, the eligibility, the scope
 * and the assignment are all read server-side from governed tables. A caller cannot assert that a
 * record is theirs.
 */
async function authorizeObjectAction(reader, input) {
    const { actor } = input;
    // 2. SECURITY CAPABILITY -- first, and on its own.
    if (!(actor.capabilities instanceof Set) || !actor.capabilities.has(input.capabilityKey)) {
        return deny("CAPABILITY_MISSING", undefined, input.capabilityKey);
    }
    const predicates = input.predicates ?? [];
    if (predicates.length === 0)
        return ALLOW;
    // Employee context is resolved ONCE, and only because a predicate asked for it. An action with no
    // Employee-bearing predicate never touches the workforce authority at all -- which is what keeps
    // purely administrative actions usable by Principals who are not Employees.
    let employeeId;
    const requireEmployee = async () => {
        if (employeeId === undefined)
            employeeId = await reader.linkedEmployeeId(actor.tenantId, actor.principalId);
        return employeeId;
    };
    for (const predicate of predicates) {
        switch (predicate.kind) {
            case "WORK_ELIGIBILITY": {
                if (!exports.GOVERNED_QUALIFICATION_CODES.has(predicate.qualificationCode)) {
                    return deny("WORK_ELIGIBILITY_UNMAPPED", "WORK_ELIGIBILITY", predicate.qualificationCode);
                }
                const id = await requireEmployee();
                if (!id)
                    return deny("EMPLOYEE_LINK_REQUIRED", "WORK_ELIGIBILITY");
                if (!(await reader.hasWorkEligibility(actor.tenantId, id, predicate.qualificationCode))) {
                    return deny("WORK_ELIGIBILITY_MISSING", "WORK_ELIGIBILITY", predicate.qualificationCode);
                }
                break;
            }
            case "OPERATIONAL_SCOPE": {
                const id = await requireEmployee();
                if (!id)
                    return deny("EMPLOYEE_LINK_REQUIRED", "OPERATIONAL_SCOPE");
                if (!(await reader.hasOperationalScope(actor.tenantId, id, predicate.scopeType, predicate.scopeId))) {
                    return deny("OUTSIDE_OPERATIONAL_SCOPE", "OPERATIONAL_SCOPE", predicate.scopeId ? `${predicate.scopeType}:${predicate.scopeId}` : predicate.scopeType);
                }
                break;
            }
            case "RECORD_ASSIGNMENT": {
                if (!input.record)
                    return deny("NOT_ASSIGNED", "RECORD_ASSIGNMENT", "no record supplied");
                const id = await requireEmployee();
                if (!id)
                    return deny("EMPLOYEE_LINK_REQUIRED", "RECORD_ASSIGNMENT");
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
/**
 * ALTERNATIVE CONTEXTUAL PATHS. One action, several legitimate ways to reach a record.
 *
 * Reorder Request Read is the case that required this: the SAME capability reaches OWN records
 * through an active assignment, and the shared QUEUE through an Operational Scope. They are not one
 * ambiguous scope and neither implies the other -- a technician with an assignment gets their own
 * work and no queue, and an Employee with queue scope does not need an assignment.
 *
 * The capability is still checked FIRST and exactly once; only the context paths are alternatives.
 * The returned refusal is the FIRST path's, because that path is the narrowest and its reason is
 * the one a caller can act on: "you are not assigned to this" is useful, "you lack queue scope" is
 * usually not what a technician wanted to hear.
 */
async function authorizeAnyPath(reader, input) {
    const { paths, ...rest } = input;
    if (paths.length === 0)
        return authorizeObjectAction(reader, rest);
    let first;
    for (const predicates of paths) {
        const decision = await authorizeObjectAction(reader, { ...rest, predicates });
        if (decision.allowed)
            return decision;
        // A missing capability is the same answer on every path and is returned immediately: trying the
        // others would only ask the database questions on behalf of a caller with no authority at all.
        if (decision.reason === "CAPABILITY_MISSING")
            return decision;
        first ??= decision;
    }
    return first;
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
function ownRecordsPredicate(recordKind, recordIdColumn) {
    const relation = ASSIGNMENT_RELATIONS[recordKind];
    return Object.freeze({
        sql: `EXISTS (SELECT 1 FROM ${relation.table} a
                   WHERE a.tenant_id = $1 AND a.${relation.recordColumn} = ${recordIdColumn}
                     AND a.${relation.employeeColumn} = $2 AND a.effective_to IS NULL)`,
        params: Object.freeze(["tenantId", "employeeId"]),
    });
}
/** The reader, over the governed tables. No Firestore, no uid, no claims. */
function postgresContextualReader(db) {
    return {
        async linkedEmployeeId(tenantId, principalId) {
            // ONLY AN ACCESS-ELIGIBLE EMPLOYEE (Controller DQ-007): the link must resolve to an Employee of this tenant whose
            // PostgreSQL employment status is ACTIVE or CONTRACTOR. Principal resolution already refuses an ineligible
            // Principal outright; this is the same rule at the predicate layer, so an evaluator reached with a hand-built
            // actor (or a future caller that skips principal resolution) can never satisfy WORK_ELIGIBILITY,
            // OPERATIONAL_SCOPE or RECORD_ASSIGNMENT for an off-boarded Employee -- it answers EMPLOYEE_LINK_REQUIRED.
            const { rows } = await db.query(`SELECT l.employee_id FROM eos_policy.employee_principal_links l
           JOIN eos_workforce.employees e ON e.tenant_id = l.tenant_id AND e.id = l.employee_id
          WHERE l.tenant_id = $1 AND l.principal_id = $2 AND l.status = 'active'
            AND e.employment_status::text = ANY($3::text[])`, [tenantId, principalId, [...employmentAccessEligibility_1.ACCESS_ELIGIBLE_EMPLOYMENT_STATUSES]]);
            return rows.length === 1 ? String(rows[0].employee_id) : null;
        },
        async hasWorkEligibility(tenantId, employeeId, qualificationCode) {
            const { rows } = await db.query(`SELECT 1 FROM eos_workforce.employee_work_eligibility
          WHERE tenant_id = $1 AND employee_id = $2 AND qualification_code = $3 AND effective_to IS NULL`, [tenantId, employeeId, qualificationCode]);
            return rows.length > 0;
        },
        async hasOperationalScope(tenantId, employeeId, scopeType, scopeId) {
            const { rows } = await db.query(`SELECT 1 FROM eos_workforce.employee_operational_scopes
          WHERE tenant_id = $1 AND employee_id = $2 AND scope_type = $3 AND effective_to IS NULL
            AND ($4::text IS NULL OR scope_id = $4)`, [tenantId, employeeId, scopeType, scopeId ?? null]);
            return rows.length > 0;
        },
        async isAssignedEmployee(tenantId, recordKind, recordId, employeeId) {
            const relation = ASSIGNMENT_RELATIONS[recordKind];
            const { rows } = await db.query(`SELECT 1 FROM ${relation.table}
          WHERE tenant_id = $1 AND ${relation.recordColumn} = $2
            AND ${relation.employeeColumn} = $3 AND effective_to IS NULL`, [tenantId, recordId, employeeId]);
            return rows.length > 0;
        },
    };
}
/** The PostgreSQL dimension reader. Same tables, same open-interval rule, as the predicate reader above. */
function postgresPrincipalDimensionReader(db) {
    const predicates = postgresContextualReader(db);
    return {
        linkedEmployeeId: (tenantId, principalId) => predicates.linkedEmployeeId(tenantId, principalId),
        async listWorkEligibility(tenantId, employeeId) {
            const { rows } = await db.query(`SELECT qualification_code FROM eos_workforce.employee_work_eligibility
          WHERE tenant_id = $1 AND employee_id = $2 AND effective_to IS NULL
          ORDER BY qualification_code`, [tenantId, employeeId]);
            return rows.map((r) => String(r.qualification_code));
        },
        async listOperationalScopes(tenantId, employeeId) {
            const { rows } = await db.query(`SELECT scope_type, scope_id FROM eos_workforce.employee_operational_scopes
          WHERE tenant_id = $1 AND employee_id = $2 AND effective_to IS NULL
          ORDER BY scope_type, scope_id`, [tenantId, employeeId]);
            return rows.map((r) => Object.freeze({ scopeType: String(r.scope_type), scopeId: String(r.scope_id) }));
        },
    };
}
/**
 * A `ContextualReader` backed by an ALREADY-READ snapshot of the dimensions.
 *
 * A surface projection asks the same two questions about twenty-odd surfaces. Re-querying per surface
 * would turn one page load into dozens of round trips and -- worse -- could answer two surfaces from
 * two different reads of the same table. One read, one snapshot, one answer.
 *
 * `isAssignedEmployee` THROWS rather than guessing: a projection has no record, and a reader that
 * quietly returned false would make "no record supplied" indistinguishable from "not yours".
 */
function snapshotContextualReader(snapshot) {
    const eligibility = new Set(snapshot.workEligibility);
    return {
        async linkedEmployeeId() { return snapshot.employeeId; },
        async hasWorkEligibility(_tenantId, _employeeId, qualificationCode) { return eligibility.has(qualificationCode); },
        async hasOperationalScope(_tenantId, _employeeId, scopeType, scopeId) {
            return snapshot.operationalScopes.some((s) => s.scopeType === scopeType && (scopeId === undefined || s.scopeId === scopeId));
        },
        async isAssignedEmployee() {
            throw new Error("snapshotContextualReader: RECORD_ASSIGNMENT has no meaning without a record");
        },
    };
}
//# sourceMappingURL=contextualAuthorization.js.map