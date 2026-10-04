// EMP-RT-05 — WORK ASSIGNED TO AN EMPLOYEE (Administration control plane, DECISIONS #210).
//
// Held while "ASSIGNMENT_AUTHORITY_NOT_IN_POSTGRES" was true. It no longer is: the PostgreSQL Work Order authority records every
// current assignment (eos_ops.work_order_assignments, effective_to IS NULL -- written only by schedule / dispatch / reassign), and
// Reorder assignment is governed the same way (eos_ops.reorder_request_assignments). This read projects those rows for ONE
// Employee, ONE family at a time, so the Employee record states the third responsibility -- ASSIGNED PERSON -- beside Record
// Owner and Accountable Person, never merged with them.
//
// AUTHORITY: employee.record.read to see the Employee at all, AND the family's own record read --
//   WORK_ORDER       workOrder.record.read held UNCONDITIONALLY (an assignment-restricted reader -- a Technician -- reads only
//                    their own work through their own surfaces, never another employee's list here)
//   REORDER_REQUEST  reorder.request.read, narrowed to the caller's REORDER_QUEUE reach (an aggregate never exceeds the reads)
// A refused family is refused on its own; it never hides another. Read-only. Assignment history stays history: only CURRENT
// assignments are listed, and a reassignment never rewrites ownership or accountability.
import { queueReachKeys } from "../../eosOps/reorderLifecycleCommands";
import { acceptOnly, isoOf, refuse, requireEmployeeId, requirePageSize, runEmployeeRead, type EmployeeReadActor, type EmployeeReadDeps } from "./employeeReadKernel";

export const ASSIGNED_WORK_FAMILIES = Object.freeze(["WORK_ORDER", "REORDER_REQUEST"] as const);
type Family = (typeof ASSIGNED_WORK_FAMILIES)[number];
const CAPABILITY: Readonly<Record<Family, string>> = Object.freeze({ WORK_ORDER: "workOrder.record.read", REORDER_REQUEST: "reorder.request.read" });

export interface AssignedWorkItem {
  readonly family: Family; readonly recordId: string; readonly recordNumber: string | null; readonly name: string | null;
  readonly state: string | null; readonly assignedSince: string; readonly scheduledStart: string | null; readonly operatingCompanyId: string | null;
}

export function listAssignedWorkForEmployee(deps: EmployeeReadDeps, actor: EmployeeReadActor, input?: Record<string, unknown>) {
  return runEmployeeRead(deps, actor,
    () => {
      acceptOnly(input, ["employeeId", "family", "limit"]);
      const family = input?.family;
      if (typeof family !== "string" || !(ASSIGNED_WORK_FAMILIES as readonly string[]).includes(family)) {
        refuse("FAMILY_INVALID", "INVALID_INPUT", `family must be one of ${ASSIGNED_WORK_FAMILIES.join(", ")}`);
      }
      return { employeeId: requireEmployeeId(input?.employeeId), family: family as Family, limit: requirePageSize(input?.limit) };
    },
    (p) => ["employee.record.read", CAPABILITY[p.family]],
    async (db, tenantId, principalId, p) => {
      const exists = await db.query(`SELECT 1 FROM eos_workforce.employees WHERE tenant_id = $1 AND id = $2`, [tenantId, p.employeeId]);
      if (exists.rows.length === 0) refuse("EMPLOYEE_NOT_FOUND", "NOT_FOUND", "the Employee does not exist in this tenant");
      let rows: Record<string, any>[];
      if (p.family === "WORK_ORDER") {
        ({ rows } = await db.query(
          `SELECT w.id, w.work_order_number AS number, concat_ws(' · ', a2.name, w.work_order_type::text) AS name, w.status::text AS state,
                  a.effective_from, w.scheduled_start, w.operating_company_id
             FROM eos_ops.work_order_assignments a
             JOIN eos_ops.work_orders w ON w.tenant_id = a.tenant_id AND w.id = a.work_order_id
             LEFT JOIN eos_crm.accounts a2 ON a2.tenant_id = w.tenant_id AND a2.id = w.customer_id
            WHERE a.tenant_id = $1 AND a.assignee_employee_id = $2 AND a.effective_to IS NULL
            ORDER BY w.scheduled_start NULLS LAST, w.work_order_number LIMIT $3`, [tenantId, p.employeeId, p.limit + 1]));
      } else {
        const reach = await queueReachKeys(db, { tenantId, principalId } as never);
        if (reach.length === 0) refuse("OUTSIDE_OPERATIONAL_SCOPE", "FORBIDDEN", "reading Reorder Requests requires the REORDER_QUEUE Operational Scope");
        ({ rows } = await db.query(
          `SELECT r.id, r.reorder_request_number AS number, r.part_id AS name, r.status::text AS state, a.effective_from, NULL::timestamptz AS scheduled_start,
                  r.operating_company_key AS operating_company_id
             FROM eos_ops.reorder_request_assignments a
             JOIN eos_ops.reorder_requests r ON r.tenant_id = a.tenant_id AND r.id = a.reorder_request_id
            WHERE a.tenant_id = $1 AND a.assigned_employee_id = $2 AND a.effective_to IS NULL AND r.operating_company_key = ANY($3::text[])
            ORDER BY r.reorder_request_number LIMIT $4`, [tenantId, p.employeeId, reach, p.limit + 1]));
      }
      const items: AssignedWorkItem[] = rows.slice(0, p.limit).map((r) => ({
        family: p.family, recordId: String(r.id), recordNumber: r.number ?? null, name: r.name ?? null, state: r.state ?? null,
        assignedSince: isoOf(r.effective_from)!, scheduledStart: r.scheduled_start == null ? null : isoOf(r.scheduled_start), operatingCompanyId: r.operating_company_id ?? null,
      }));
      return { employeeId: p.employeeId, family: p.family, axis: "ASSIGNED_PERSON", items, truncated: rows.length > p.limit, nextCursor: null };
    });
}
