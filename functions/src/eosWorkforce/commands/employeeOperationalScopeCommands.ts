// Step C: the governed PostgreSQL OPERATIONAL SCOPE writers -- which warehouses an Employee is authorized for.
//
// A scope answers ONE question: "is this Employee explicitly scoped to THIS warehouse?" It is NOT a Security Role,
// NOT a capability, NOT a permission, NOT a Job Role, NOT a work-eligibility qualification, NOT ownership, NOT an
// assignment, NOT a manager/reporting fact and NOT an operating-company fact. A scope GRANTS NO APPLICATION ACCESS.
//
// SCOPE NEVER SUBSTITUTES FOR QUALIFICATION, AND QUALIFICATION NEVER SUBSTITUTES FOR SCOPE. A governed consumer that
// needs both must check both, separately, on top of the security capability.
//
//   assignEmployeeOperationalScope  { employeeId, scopeType, scopeId, reason? }   open a current warehouse scope
//   endEmployeeOperationalScope     { employeeId, scopeType, scopeId, reason? }   end the current warehouse scope
//
// Both require admin.employeeOperationalScope.write -- SEPARATE from admin.employeeWorkEligibility.write by Owner
// ruling, because deciding WHICH warehouses an Employee covers is not the authority that decides WHAT KIND of work
// they are qualified for. An ACTIVE Principal and ACTIVE tenant membership are re-read inside the transaction.
//
// WHY THE ACTIVE CHECK LIVES HERE. The table's composite foreign key already guarantees the warehouse EXISTS IN THE
// SAME TENANT -- a cross-tenant or unknown id cannot be stored at all. What a foreign key cannot express is that the
// warehouse is currently ACTIVE, so the command reads its status FOR SHARE and refuses an INACTIVE target. The two
// refusals are deliberately distinct: WAREHOUSE_NOT_FOUND (unknown, or another tenant's -- indistinguishable by
// design, since a foreign warehouse must not be confirmed to exist) and WAREHOUSE_INACTIVE.
//
// ASSIGNMENT TIME ONLY. An existing scope whose warehouse LATER goes INACTIVE is a remediation finding for the step
// D/E tooling, never a silent revocation here: this command never ends a scope it was not asked to end.
//
// WAREHOUSE IS THE ONLY SCOPE TYPE, and `scopeType` is still required explicitly -- a caller must say what kind of
// scope it means, so adding a second type later cannot silently reinterpret existing calls. Operating Company is NOT
// a scope type: that authority already exists as eos_workforce.employees.operating_company_id and is not duplicated.
//
// MULTIPLE CONCURRENT WAREHOUSE SCOPES ARE NORMAL. Re-assigning a warehouse the Employee already covers currently is
// NO_CHANGE. Nothing is inferred -- not from WAREHOUSE_ASSOCIATE, Job Role, title, manager, Security Role or
// operating company. `assignedWarehouseIds` is migration EVIDENCE for step D/E, never an input to this command.
//
// ONE transaction per command: lock the Employee -> resolve + status-check the warehouse -> lock the current scope
// row -> decide -> write -> ONE audit event -> commit. Any failure rolls back every effect, the audit row included.
import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import {
  EmployeeCommandError, acceptOnly, appendEmployeeAudit, lockEmployee, optionalReason, refuse, requireId,
  runEmployeeCommand, type EmployeeCommandDeps, type EmployeeCommandActor,
} from "./employeeCommandKernel";
import {
  EMPLOYEE_OPERATIONAL_SCOPE_WRITE, OPERATIONAL_SCOPE_ASSIGN_ACTION, OPERATIONAL_SCOPE_END_ACTION,
  OPERATIONAL_SCOPE_TYPES, isOperationalScopeType, type OperationalScopeType,
} from "../operationalScopeVocabulary";

function requireScopeType(value: unknown): OperationalScopeType {
  if (!isOperationalScopeType(value)) {
    refuse("OPERATIONAL_SCOPE_TYPE_INVALID", "INVALID_INPUT", `scopeType must be one of ${OPERATIONAL_SCOPE_TYPES.join(", ")}`);
  }
  return value as OperationalScopeType;
}

const scopeConflict = (_err: { constraint?: string }) =>
  new EmployeeCommandError("OPERATIONAL_SCOPE_CONCURRENT_CHANGE", "CONFLICT", "the Employee's operational scopes changed concurrently; retry");

/**
 * Resolve the scope target in the ACTOR's tenant and require it to be governed and ACTIVE.
 *
 * An unknown id and another tenant's id are the SAME refusal on purpose: confirming that a foreign warehouse exists
 * would leak across the tenant boundary. Valid only while WAREHOUSE is the sole scope type -- a second type must
 * bring its own resolver here and revisit the table's warehouse foreign key.
 */
async function requireActiveScopeTarget(
  db: PoolClient, tenantId: string, scopeType: OperationalScopeType, scopeId: string,
): Promise<void> {
  if (scopeType !== "WAREHOUSE") refuse("OPERATIONAL_SCOPE_TYPE_INVALID", "INVALID_INPUT", "WAREHOUSE is the only supported scope type");
  const { rows } = await db.query(
    `SELECT status::text AS status FROM eos_ops.warehouses WHERE tenant_id = $1 AND id = $2 FOR SHARE`, [tenantId, scopeId],
  );
  if (rows.length === 0) refuse("WAREHOUSE_NOT_FOUND", "NOT_FOUND", "the warehouse does not exist in this tenant");
  if (rows[0].status !== "ACTIVE") refuse("WAREHOUSE_INACTIVE", "PRECONDITION_FAILED", "an inactive warehouse cannot receive a new operational scope");
}

export interface OperationalScopeChangeResult {
  readonly outcome: "ASSIGNED" | "ENDED" | "NO_CHANGE";
  readonly employeeId: string;
  readonly scopeType: OperationalScopeType;
  readonly scopeId: string;
  readonly operationalScopeId: string;
}

/** Open a CURRENT warehouse scope. Already covering it currently is NO_CHANGE; an ended scope is never reopened. */
export function assignEmployeeOperationalScope(
  deps: EmployeeCommandDeps, actor: EmployeeCommandActor, input: Record<string, unknown>,
): Promise<OperationalScopeChangeResult> {
  return runEmployeeCommand(deps, actor,
    () => {
      const i = acceptOnly(input, ["employeeId", "scopeType", "scopeId", "reason"]);
      return {
        employeeId: requireId(i.employeeId, "employeeId"),
        scopeType: requireScopeType(i.scopeType),
        scopeId: requireId(i.scopeId, "scopeId"),
        reason: optionalReason(i.reason),
      };
    },
    async (db, p, at) => {
      await lockEmployee(db, actor.tenantId, p.employeeId);
      await requireActiveScopeTarget(db, actor.tenantId, p.scopeType, p.scopeId);
      const { rows } = await db.query(
        `SELECT id FROM eos_workforce.employee_operational_scopes
          WHERE tenant_id = $1 AND employee_id = $2 AND scope_type = $3 AND scope_id = $4 AND effective_to IS NULL FOR UPDATE`,
        [actor.tenantId, p.employeeId, p.scopeType, p.scopeId],
      );
      const current = rows[0] as { id: string } | undefined;
      if (current) {
        return { outcome: "NO_CHANGE", employeeId: p.employeeId, scopeType: p.scopeType, scopeId: p.scopeId, operationalScopeId: current.id };
      }
      const id = `eos_${randomUUID()}`;
      await db.query(
        `INSERT INTO eos_workforce.employee_operational_scopes (id, tenant_id, employee_id, scope_type, scope_id, effective_from, assigned_by, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, actor.tenantId, p.employeeId, p.scopeType, p.scopeId, at, actor.principalId, p.reason],
      );
      await appendEmployeeAudit(db, actor.tenantId, actor.principalId, OPERATIONAL_SCOPE_ASSIGN_ACTION, p.employeeId,
        null, { scopeType: p.scopeType, scopeId: p.scopeId, operationalScopeId: id }, p.reason, at);
      return { outcome: "ASSIGNED", employeeId: p.employeeId, scopeType: p.scopeType, scopeId: p.scopeId, operationalScopeId: id };
    },
    scopeConflict, EMPLOYEE_OPERATIONAL_SCOPE_WRITE);
}

/**
 * End the Employee's CURRENT scope for a target. Not currently covering it is NO_CHANGE.
 *
 * Deliberately NOT status-checked: a warehouse that has since gone INACTIVE must still be REMOVABLE from an
 * Employee's scope. Requiring ACTIVE here would strand exactly the scopes most in need of ending.
 */
export function endEmployeeOperationalScope(
  deps: EmployeeCommandDeps, actor: EmployeeCommandActor, input: Record<string, unknown>,
): Promise<OperationalScopeChangeResult> {
  return runEmployeeCommand(deps, actor,
    () => {
      const i = acceptOnly(input, ["employeeId", "scopeType", "scopeId", "reason"]);
      return {
        employeeId: requireId(i.employeeId, "employeeId"),
        scopeType: requireScopeType(i.scopeType),
        scopeId: requireId(i.scopeId, "scopeId"),
        reason: optionalReason(i.reason),
      };
    },
    async (db, p, at) => {
      await lockEmployee(db, actor.tenantId, p.employeeId);
      const { rows } = await db.query(
        `SELECT id FROM eos_workforce.employee_operational_scopes
          WHERE tenant_id = $1 AND employee_id = $2 AND scope_type = $3 AND scope_id = $4 AND effective_to IS NULL FOR UPDATE`,
        [actor.tenantId, p.employeeId, p.scopeType, p.scopeId],
      );
      const current = rows[0] as { id: string } | undefined;
      if (!current) {
        return { outcome: "NO_CHANGE", employeeId: p.employeeId, scopeType: p.scopeType, scopeId: p.scopeId, operationalScopeId: "" };
      }
      await db.query(
        `UPDATE eos_workforce.employee_operational_scopes SET effective_to = $3, ended_by = $4, ended_at = $3
          WHERE tenant_id = $1 AND id = $2 AND effective_to IS NULL`,
        [actor.tenantId, current.id, at, actor.principalId],
      );
      await appendEmployeeAudit(db, actor.tenantId, actor.principalId, OPERATIONAL_SCOPE_END_ACTION, p.employeeId,
        { scopeType: p.scopeType, scopeId: p.scopeId, operationalScopeId: current.id }, null, p.reason, at);
      return { outcome: "ENDED", employeeId: p.employeeId, scopeType: p.scopeType, scopeId: p.scopeId, operationalScopeId: current.id };
    },
    scopeConflict, EMPLOYEE_OPERATIONAL_SCOPE_WRITE);
}
