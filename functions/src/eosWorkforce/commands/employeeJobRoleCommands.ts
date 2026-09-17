// EMP-RT-08: the governed PostgreSQL JOB ROLE writers -- the tenant catalog and an Employee's current Job Role.
//
// A Job Role is an Employee's BUSINESS FUNCTION only. Nothing here grants, changes or reads a Security Role, permission,
// Account/customer ownership, accountability, assignment, manager/reporting relationship or operating company.
// Retail Sales and National Accounts Sales are distinct catalog entries; nothing collapses them.
//
//   createJobRole          { jobRoleId, displayName }                 ACTIVE catalog entry in the actor's tenant
//   updateJobRole          { jobRoleId, displayName?, status? }       rename, or ACTIVE <-> INACTIVE; never deleted
//   assignEmployeeJobRole  { employeeId, jobRoleId, reason? }         one current primary Job Role, history kept
//
// Every writer requires admin.employeeJobRole.write (Owner ruling: NOT admin.employeeProfile.write), an ACTIVE Principal
// and ACTIVE tenant membership re-checked in the transaction. Caller-supplied tenant, actor, role, capability, ownership
// or audit identity is refused as unknown input. No generic patch.
//
// ASSIGNMENT, one transaction: lock the Employee (actor tenant) -> the Job Role must exist in the SAME tenant and be
// ACTIVE (read FOR SHARE) -> lock the current assignment -> same role is NO_CHANGE -> end the prior current row
// (effective_to, ended_by, ended_at) -> insert the new current row -> one audit event -> commit. Any failure rolls back
// everything. An Employee may have no Job Role; none is fabricated, and nothing is inferred from operationalRoles,
// Security Role, uid, ownership, manager, assignment, activity, permissions or title.
import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import {
  EmployeeCommandError, acceptOnly, appendEmployeeAudit, lockEmployee, optionalReason, refuse, requireId,
  runEmployeeCommand, type EmployeeCommandActor, type EmployeeCommandDeps,
} from "./employeeCommandKernel";

/** The Job Role catalog and assignment capability. Separate from admin.employeeProfile.write by Owner ruling. */
export const EMPLOYEE_JOB_ROLE_WRITE = "admin.employeeJobRole.write";

export const JOB_ROLE_STATUSES = Object.freeze(["ACTIVE", "INACTIVE"] as const);
export const JOB_ROLE_ASSIGN_ACTION = "employee.jobRole.assign";
export const JOB_ROLE_CATALOG_CREATE_ACTION = "jobRole.catalog.create";
export const JOB_ROLE_CATALOG_UPDATE_ACTION = "jobRole.catalog.update";

const JOB_ROLE_ID_SHAPE = /^[a-z][a-z0-9-]{1,62}$/;
const MAX_DISPLAY_NAME = 100;

function requireJobRoleId(value: unknown): string {
  if (typeof value !== "string" || !JOB_ROLE_ID_SHAPE.test(value)) {
    refuse("JOB_ROLE_ID_INVALID", "INVALID_INPUT", "jobRoleId must be a stable Job Role id (lowercase letters, digits and hyphens)");
  }
  return value as string;
}

function requireDisplayName(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "" || value.trim() !== value || value.length > MAX_DISPLAY_NAME) {
    refuse("JOB_ROLE_DISPLAY_NAME_INVALID", "INVALID_INPUT", `displayName must be a trimmed, non-empty name of at most ${MAX_DISPLAY_NAME} characters`);
  }
  return value as string;
}

async function auditCatalog(db: PoolClient, actor: EmployeeCommandActor, action: string, jobRoleId: string, before: unknown, after: unknown, at: Date) {
  await db.query(
    `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at, reason)
     VALUES ($1, $2, $3, $4, 'jobRole', $5, $6, $7, $8, NULL)`,
    [`audit_${randomUUID()}`, actor.tenantId, action, actor.principalId, jobRoleId, before === null ? null : JSON.stringify(before), JSON.stringify(after), at],
  );
}

const jobRoleConflict = (err: { constraint?: string }) =>
  err.constraint === "employee_job_role_one_current_per_employee"
    ? new EmployeeCommandError("JOB_ROLE_CONCURRENT_CHANGE", "CONFLICT", "the Employee's Job Role changed concurrently; retry")
    : err.constraint === "job_roles_display_name_unique_per_tenant"
      ? new EmployeeCommandError("JOB_ROLE_DISPLAY_NAME_TAKEN", "CONFLICT", "another Job Role of this tenant has that name")
      : new EmployeeCommandError("JOB_ROLE_ALREADY_EXISTS", "CONFLICT", "a Job Role with that id already exists in this tenant");

export interface JobRoleCatalogEntry {
  readonly jobRoleId: string;
  readonly displayName: string;
  readonly status: string;
}

export interface JobRoleCatalogChangeResult {
  readonly outcome: "CREATED" | "UPDATED" | "NO_CHANGE";
  readonly jobRole: JobRoleCatalogEntry;
}

/** Add an ACTIVE Job Role to the actor's tenant catalog. */
export function createJobRole(deps: EmployeeCommandDeps, actor: EmployeeCommandActor, input: Record<string, unknown>): Promise<JobRoleCatalogChangeResult> {
  return runEmployeeCommand(deps, actor,
    () => {
      const i = acceptOnly(input, ["jobRoleId", "displayName"]);
      return { jobRoleId: requireJobRoleId(i.jobRoleId), displayName: requireDisplayName(i.displayName) };
    },
    async (db, p, at) => {
      await db.query(
        `INSERT INTO eos_workforce.job_roles (tenant_id, id, display_name, status, created_by, created_at, updated_by, updated_at)
         VALUES ($1, $2, $3, 'ACTIVE', $4, $5, $4, $5)`,
        [actor.tenantId, p.jobRoleId, p.displayName, actor.principalId, at],
      );
      const jobRole = { jobRoleId: p.jobRoleId, displayName: p.displayName, status: "ACTIVE" };
      await auditCatalog(db, actor, JOB_ROLE_CATALOG_CREATE_ACTION, p.jobRoleId, null, jobRole, at);
      return { outcome: "CREATED", jobRole };
    },
    jobRoleConflict, EMPLOYEE_JOB_ROLE_WRITE);
}

/** Rename a Job Role, or move it between ACTIVE and INACTIVE. Never deletes; history keeps naming it. */
export function updateJobRole(deps: EmployeeCommandDeps, actor: EmployeeCommandActor, input: Record<string, unknown>): Promise<JobRoleCatalogChangeResult> {
  return runEmployeeCommand(deps, actor,
    () => {
      const i = acceptOnly(input, ["jobRoleId", "displayName", "status"]);
      const displayName = i.displayName === undefined ? null : requireDisplayName(i.displayName);
      if (i.status !== undefined && !(JOB_ROLE_STATUSES as readonly unknown[]).includes(i.status)) {
        refuse("JOB_ROLE_STATUS_INVALID", "INVALID_INPUT", `status must be one of ${JOB_ROLE_STATUSES.join(", ")}`);
      }
      if (displayName === null && i.status === undefined) refuse("NO_CHANGES_REQUESTED", "INVALID_INPUT", "name displayName and/or status");
      return { jobRoleId: requireJobRoleId(i.jobRoleId), displayName, status: (i.status as string | undefined) ?? null };
    },
    async (db, p, at) => {
      const { rows } = await db.query(
        `SELECT id, display_name, status FROM eos_workforce.job_roles WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [actor.tenantId, p.jobRoleId],
      );
      if (rows.length === 0) refuse("JOB_ROLE_NOT_FOUND", "NOT_FOUND", "the Job Role does not exist in this tenant");
      const before = { jobRoleId: rows[0].id, displayName: rows[0].display_name, status: rows[0].status };
      const after = { jobRoleId: before.jobRoleId, displayName: p.displayName ?? before.displayName, status: p.status ?? before.status };
      if (after.displayName === before.displayName && after.status === before.status) return { outcome: "NO_CHANGE", jobRole: before };
      await db.query(
        `UPDATE eos_workforce.job_roles SET display_name = $3, status = $4, updated_by = $5, updated_at = $6 WHERE tenant_id = $1 AND id = $2`,
        [actor.tenantId, p.jobRoleId, after.displayName, after.status, actor.principalId, at],
      );
      await auditCatalog(db, actor, JOB_ROLE_CATALOG_UPDATE_ACTION, p.jobRoleId, before, after, at);
      return { outcome: "UPDATED", jobRole: after };
    },
    jobRoleConflict, EMPLOYEE_JOB_ROLE_WRITE);
}

export interface JobRoleAssignmentResult {
  readonly outcome: "ASSIGNED" | "CHANGED" | "NO_CHANGE";
  readonly employeeId: string;
  readonly jobRoleId: string;
  readonly assignmentId: string;
  readonly endedAssignmentId: string | null;
}

/** Make `jobRoleId` the Employee's one current primary Job Role, ending any different current assignment. */
export function assignEmployeeJobRole(deps: EmployeeCommandDeps, actor: EmployeeCommandActor, input: Record<string, unknown>): Promise<JobRoleAssignmentResult> {
  return runEmployeeCommand(deps, actor,
    () => {
      const i = acceptOnly(input, ["employeeId", "jobRoleId", "reason"]);
      return { employeeId: requireId(i.employeeId, "employeeId"), jobRoleId: requireJobRoleId(i.jobRoleId), reason: optionalReason(i.reason) };
    },
    async (db, p, at) => {
      await lockEmployee(db, actor.tenantId, p.employeeId);
      const role = await db.query(
        `SELECT status FROM eos_workforce.job_roles WHERE tenant_id = $1 AND id = $2 FOR SHARE`, [actor.tenantId, p.jobRoleId],
      );
      if (role.rows.length === 0) refuse("JOB_ROLE_NOT_FOUND", "NOT_FOUND", "the Job Role does not exist in this tenant");
      if (role.rows[0].status !== "ACTIVE") refuse("JOB_ROLE_INACTIVE", "PRECONDITION_FAILED", "an inactive Job Role cannot receive a new assignment");
      const { rows } = await db.query(
        `SELECT id, job_role_id FROM eos_workforce.employee_job_role_assignments
          WHERE tenant_id = $1 AND employee_id = $2 AND effective_to IS NULL FOR UPDATE`,
        [actor.tenantId, p.employeeId],
      );
      const current = rows[0] as { id: string; job_role_id: string } | undefined;
      if (current && current.job_role_id === p.jobRoleId) {
        return { outcome: "NO_CHANGE", employeeId: p.employeeId, jobRoleId: p.jobRoleId, assignmentId: current.id, endedAssignmentId: null };
      }
      if (current) {
        await db.query(
          `UPDATE eos_workforce.employee_job_role_assignments SET effective_to = $3, ended_by = $4, ended_at = $3
            WHERE tenant_id = $1 AND id = $2 AND effective_to IS NULL`,
          [actor.tenantId, current.id, at, actor.principalId],
        );
      }
      const id = `ejr_${randomUUID()}`;
      await db.query(
        `INSERT INTO eos_workforce.employee_job_role_assignments (id, tenant_id, employee_id, job_role_id, effective_from, assigned_by, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, actor.tenantId, p.employeeId, p.jobRoleId, at, actor.principalId, p.reason],
      );
      await appendEmployeeAudit(db, actor.tenantId, actor.principalId, JOB_ROLE_ASSIGN_ACTION, p.employeeId,
        current ? { jobRoleId: current.job_role_id, assignmentId: current.id } : null, { jobRoleId: p.jobRoleId, assignmentId: id }, p.reason, at);
      return { outcome: current ? "CHANGED" : "ASSIGNED", employeeId: p.employeeId, jobRoleId: p.jobRoleId, assignmentId: id, endedAssignmentId: current?.id ?? null };
    },
    jobRoleConflict, EMPLOYEE_JOB_ROLE_WRITE);
}
