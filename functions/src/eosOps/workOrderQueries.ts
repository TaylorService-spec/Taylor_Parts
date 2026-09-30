// THE GOVERNED WORK ORDER READS: one Work Order's detail, the office list, the technician's own list, and the
// technicians eligible for one Work Order.
//
// ════════════════════ TWO READ QUESTIONS, TWO GATES ════════════════════
//
// "May I read THIS Work Order?" is the entitled per-record decision (workOrderRecordRead.ts): the capability,
// then -- when Administration has conditioned the grant (DQ-016: Employee + RECORD_ASSIGNMENT for technicians) --
// the record relation. Detail and the technician's own list ask exactly that, per record.
//
// "May I see the QUEUE?" is a different question with no record to evaluate a condition against, so the office
// list requires workOrder.record.read held UNCONDITIONALLY. A holder reached only through a conditioned grant is
// withheld from the queue by capabilitiesWithoutUnevaluatedConditions at the transport, and reads their own work
// through listMyAssignedWorkOrders instead. A condition is never evaluated as "true for the whole tenant".
//
// Nothing here writes, and nothing here reads Firestore.
import type { Pool } from "pg";
import type { ContextualReader } from "./contextualAuthorization";
import type { OperationalActor } from "./entitledActionAuthority";
import { WORK_ORDER_RECORD_READ, authorizeWorkOrderRecordRead, readWorkOrderTransitionHistoryGoverned } from "./workOrderRecordRead";
import { WorkOrderLifecycleError, WORK_ORDER_LIFECYCLE_DISPATCH, WORK_ORDER_LIFECYCLE_SCHEDULE,
  WORK_ORDER_STATUSES, TERMINAL_STATUSES, type LifecycleActor } from "./workOrderLifecycle";
import { readWorkOrderExecution } from "./workOrderExecution";
import { WORK_ORDER_ASSIGNABLE_EMPLOYMENT_STATUSES, WORK_ORDER_ASSIGNMENT_QUALIFICATION } from "./workOrderAssignmentAuthority";
import { OperatingCompanyBindingError, resolveActiveOperatingCompanyId } from "./operatingCompanyBinding";
import { EMPLOYEE_DIRECTORY_COLUMNS, directoryItemOf, type EmployeeDirectoryItem } from "../eosWorkforce/reads/employeeRecordProjection";

const SCHEMA = "eos_ops";
export const WORK_ORDER_LIST_MAX = 200;

type Category = WorkOrderLifecycleError["category"];
const refuse = (code: string, category: Category, message: string): never => {
  throw new WorkOrderLifecycleError(code, category, message);
};
const ID_SHAPE = (v: unknown): v is string =>
  typeof v === "string" && v !== "" && v.trim() === v && v.length <= 200 && !v.includes("/");

export interface WorkOrderSummary {
  readonly workOrderId: string;
  readonly workOrderNumber: string | null;
  readonly status: string;
  readonly workOrderType: string;
  readonly priority: number;
  readonly severity: string | null;
  readonly operatingCompanyKey: string;
  readonly customerId: string;
  readonly customerName: string | null;
  readonly locationId: string;
  readonly locationName: string | null;
  readonly equipmentId: string | null;
  readonly salesOrderId: string | null;
  readonly scheduledStart: string | null;
  readonly scheduledEnd: string | null;
  readonly assigneeEmployeeId: string | null;
  readonly assigneeDisplayName: string | null;
  readonly complaint: string | null;
  readonly provenance: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const iso = (v: unknown): string | null => (v === null || v === undefined ? null : new Date(v as string).toISOString());

const SUMMARY_SELECT = `
  SELECT w.id, w.work_order_number, w.status::text AS status, w.work_order_type::text AS work_order_type, w.priority,
         w.severity::text AS severity, w.operating_company_key, w.customer_id, acct.name AS customer_name, w.location_id,
         loc.name AS location_name, w.equipment_id, w.sales_order_id, w.scheduled_start, w.scheduled_end,
         a.assignee_employee_id, e.display_name AS assignee_display_name, e.first_name AS assignee_first_name,
         e.last_name AS assignee_last_name, w.complaint, w.provenance::text AS provenance, w.created_at, w.updated_at,
         w.dispatched_at, w.accepted_at, w.en_route_at, w.arrived_at, w.work_started_at, w.completed_at, w.closed_at,
         w.diagnosis, w.resolution, w.estimated_duration_minutes
    FROM ${SCHEMA}.work_orders w
    LEFT JOIN ${SCHEMA}.work_order_assignments a
      ON a.tenant_id = w.tenant_id AND a.work_order_id = w.id AND a.effective_to IS NULL
    LEFT JOIN eos_workforce.employees e ON e.tenant_id = a.tenant_id AND e.id = a.assignee_employee_id
    LEFT JOIN eos_crm.accounts acct ON acct.tenant_id = w.tenant_id AND acct.id = w.customer_id
    LEFT JOIN eos_crm.account_locations loc ON loc.tenant_id = w.tenant_id AND loc.id = w.location_id`;

function summaryOf(r: Record<string, unknown>): WorkOrderSummary {
  const assigneeName = (r.assignee_display_name as string | null)
    ?? ([r.assignee_first_name, r.assignee_last_name].filter(Boolean).join(" ") || null);
  return Object.freeze({
    workOrderId: String(r.id), workOrderNumber: (r.work_order_number as string | null) ?? null,
    status: String(r.status), workOrderType: String(r.work_order_type), priority: Number(r.priority),
    severity: (r.severity as string | null) ?? null, operatingCompanyKey: String(r.operating_company_key),
    customerId: String(r.customer_id), customerName: (r.customer_name as string | null) ?? null,
    locationId: String(r.location_id), locationName: (r.location_name as string | null) ?? null,
    equipmentId: (r.equipment_id as string | null) ?? null, salesOrderId: (r.sales_order_id as string | null) ?? null,
    scheduledStart: iso(r.scheduled_start), scheduledEnd: iso(r.scheduled_end),
    assigneeEmployeeId: (r.assignee_employee_id as string | null) ?? null, assigneeDisplayName: r.assignee_employee_id ? assigneeName : null,
    complaint: (r.complaint as string | null) ?? null, provenance: String(r.provenance),
    createdAt: iso(r.created_at) as string, updatedAt: iso(r.updated_at) as string,
  });
}

export interface WorkOrderDetail extends WorkOrderSummary {
  readonly timestamps: Readonly<Record<string, string | null>>;
  readonly diagnosis: string | null;
  readonly resolution: string | null;
  readonly estimatedDurationMinutes: number | null;
  readonly location: { readonly street: string | null; readonly city: string | null; readonly state: string | null; readonly postalCode: string | null; readonly accessNotes: string | null } | null;
  readonly equipment: { readonly equipmentId: string; readonly name: string; readonly status: string; readonly serialNumber: string | null; readonly assetTag: string | null; readonly equipmentModelId: string | null; readonly installedOn: string | null; readonly warrantyExpiresOn: string | null } | null;
  readonly execution: Awaited<ReturnType<typeof readWorkOrderExecution>>;
  readonly transitions: Awaited<ReturnType<typeof readWorkOrderTransitionHistoryGoverned>>;
  readonly assignmentHistory: readonly { readonly employeeId: string; readonly source: string; readonly reason: string | null; readonly effectiveFrom: string; readonly effectiveTo: string | null; readonly endSource: string | null; readonly endReason: string | null }[];
}

/**
 * One Work Order, after the entitled per-record decision allows it. The Equipment on the Work Order is part of
 * the Work Order's own record (its equipment_id), read through THIS gate -- not a tenant-wide Equipment read.
 */
export async function readWorkOrderDetail(
  deps: { readonly pool: Pool; readonly reader: ContextualReader },
  actor: OperationalActor,
  input: { readonly workOrderId?: unknown },
): Promise<WorkOrderDetail> {
  const workOrderId = input?.workOrderId;
  const decision = await authorizeWorkOrderRecordRead(deps.reader, actor, workOrderId as string);
  if (!decision.allowed) refuse(String(decision.outcome), "FORBIDDEN", "this Work Order may not be read by this caller");
  const { rows } = await deps.pool.query(`${SUMMARY_SELECT} WHERE w.tenant_id = $1 AND w.id = $2`, [actor.tenantId, workOrderId]);
  if (rows.length === 0) refuse("WORK_ORDER_NOT_FOUND", "NOT_FOUND", "the Work Order does not exist in this tenant");
  const r = rows[0];
  const loc = await deps.pool.query(
    `SELECT address_street, address_city, address_state, address_postal_code, access_notes
       FROM eos_crm.account_locations WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, r.location_id]);
  const eq = r.equipment_id ? await deps.pool.query(
    `SELECT id, name, status::text AS status, serial_number, asset_tag, equipment_model_id, installed_on, warranty_expires_on
       FROM ${SCHEMA}.equipment WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, r.equipment_id]) : { rows: [] };
  const history = await deps.pool.query(
    `SELECT assignee_employee_id, source, reason, effective_from, effective_to, end_source, end_reason
       FROM ${SCHEMA}.work_order_assignments WHERE tenant_id = $1 AND work_order_id = $2 ORDER BY effective_from, id`,
    [actor.tenantId, workOrderId]);
  const e = eq.rows[0];
  const l = loc.rows[0];
  const dateOnly = (v: unknown) => (v ? new Date(v as string).toISOString().slice(0, 10) : null);
  return Object.freeze({
    ...summaryOf(r),
    timestamps: Object.freeze({
      dispatchedAt: iso(r.dispatched_at), acceptedAt: iso(r.accepted_at), enRouteAt: iso(r.en_route_at),
      arrivedAt: iso(r.arrived_at), workStartedAt: iso(r.work_started_at), completedAt: iso(r.completed_at), closedAt: iso(r.closed_at),
    }),
    diagnosis: r.diagnosis ?? null, resolution: r.resolution ?? null,
    estimatedDurationMinutes: r.estimated_duration_minutes === null ? null : Number(r.estimated_duration_minutes),
    location: l ? Object.freeze({ street: l.address_street ?? null, city: l.address_city ?? null, state: l.address_state ?? null,
      postalCode: l.address_postal_code ?? null, accessNotes: l.access_notes ?? null }) : null,
    equipment: e ? Object.freeze({ equipmentId: e.id, name: e.name, status: e.status, serialNumber: e.serial_number ?? null,
      assetTag: e.asset_tag ?? null, equipmentModelId: e.equipment_model_id ?? null, installedOn: dateOnly(e.installed_on),
      warrantyExpiresOn: dateOnly(e.warranty_expires_on) }) : null,
    execution: await readWorkOrderExecution(deps.pool, actor.tenantId, workOrderId as string),
    transitions: await readWorkOrderTransitionHistoryGoverned({ db: deps.pool, reader: deps.reader }, actor, workOrderId as string),
    assignmentHistory: Object.freeze(history.rows.map((h) => Object.freeze({
      employeeId: h.assignee_employee_id, source: h.source, reason: h.reason ?? null, effectiveFrom: iso(h.effective_from) as string,
      effectiveTo: iso(h.effective_to), endSource: h.end_source ?? null, endReason: h.end_reason ?? null,
    }))),
  });
}

/**
 * The office list: filter by status, scheduled window, assignee, customer, Equipment, a planned Part, or a search
 * over the Work Order number and customer name. Requires workOrder.record.read held UNCONDITIONALLY (the
 * transport passes the flat set with conditioned keys withheld). Bounded: at most WORK_ORDER_LIST_MAX rows, and
 * `truncated` says when there were more -- never a silent partial list.
 */
export async function listWorkOrders(
  deps: { readonly pool: Pool },
  actor: LifecycleActor,
  input: unknown,
): Promise<{ readonly items: readonly WorkOrderSummary[]; readonly truncated: boolean }> {
  if (!(actor?.capabilities instanceof Set) || !actor.capabilities.has(WORK_ORDER_RECORD_READ)) {
    refuse("CAPABILITY_MISSING", "FORBIDDEN", `the Work Order list requires ${WORK_ORDER_RECORD_READ}`);
  }
  const i = (input ?? {}) as Record<string, unknown>;
  const extra = Object.keys(i).filter((k) => !["statuses", "scheduledFrom", "scheduledTo", "assigneeEmployeeId", "customerId",
    "equipmentId", "plannedPartId", "search", "limit"].includes(k));
  if (extra.length > 0) refuse("INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT", `this read does not accept: ${extra.sort().join(", ")}`);
  const statuses = i.statuses === undefined ? null : i.statuses;
  if (statuses !== null && (!Array.isArray(statuses) || statuses.some((s) => !(WORK_ORDER_STATUSES as readonly string[]).includes(s as string)))) {
    refuse("STATUSES_INVALID", "INVALID_INPUT", "statuses must be governed Work Order statuses");
  }
  const bound = (v: unknown, name: string): Date | null => {
    if (v === undefined || v === null) return null;
    const d = new Date(v as string);
    if (typeof v !== "string" || Number.isNaN(d.getTime())) refuse("WINDOW_INVALID", "INVALID_INPUT", `${name} must be an ISO-8601 instant`);
    return d;
  };
  const from = bound(i.scheduledFrom, "scheduledFrom");
  const to = bound(i.scheduledTo, "scheduledTo");
  const optionalId = (k: string): string | null => {
    if (i[k] === undefined || i[k] === null) return null;
    if (!ID_SHAPE(i[k])) refuse("FILTER_INVALID", "INVALID_INPUT", `${k} must be a governed id`);
    return i[k] as string;
  };
  const assignee = optionalId("assigneeEmployeeId");
  const customerId = optionalId("customerId");
  const equipmentId = optionalId("equipmentId");
  const plannedPartId = optionalId("plannedPartId");
  let search: string | null = null;
  if (i.search !== undefined && i.search !== null) {
    if (typeof i.search !== "string" || i.search.trim() === "" || i.search.length > 100) {
      refuse("SEARCH_INVALID", "INVALID_INPUT", "search is a non-empty string of at most 100 characters");
    }
    search = `%${(i.search as string).trim().replace(/[\\%_]/g, "\\$&")}%`;
  }
  const limit = i.limit === undefined ? 100 : Number(i.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > WORK_ORDER_LIST_MAX) refuse("LIMIT_INVALID", "INVALID_INPUT", `limit is 1..${WORK_ORDER_LIST_MAX}`);
  const { rows } = await deps.pool.query(
    `${SUMMARY_SELECT}
      WHERE w.tenant_id = $1
        AND ($2::text[] IS NULL OR w.status::text = ANY($2::text[]))
        AND ($3::timestamptz IS NULL OR w.scheduled_end > $3)
        AND ($4::timestamptz IS NULL OR w.scheduled_start < $4)
        AND ($5::text IS NULL OR a.assignee_employee_id = $5)
        AND ($6::text IS NULL OR w.customer_id = $6)
        AND ($7::text IS NULL OR w.equipment_id = $7)
        AND ($8::text IS NULL OR EXISTS (SELECT 1 FROM ${SCHEMA}.work_order_parts_plan pp
                                          WHERE pp.tenant_id = w.tenant_id AND pp.work_order_id = w.id AND pp.part_id = $8))
        AND ($9::text IS NULL OR w.work_order_number ILIKE $9 OR acct.name ILIKE $9)
      ORDER BY w.scheduled_start NULLS LAST, w.priority, w.created_at DESC, w.id
      LIMIT ${limit + 1}`,
    [actor.tenantId, statuses, from, to, assignee, customerId, equipmentId, plannedPartId, search]);
  return Object.freeze({ items: Object.freeze(rows.slice(0, limit).map(summaryOf)), truncated: rows.length > limit });
}

/**
 * The technician's own work: the Work Orders whose OPEN assignment is the Employee the caller's ACTIVE governed
 * login resolves to (Employee against Employee -- never a uid or technician id). Each row still passes the
 * entitled per-record read decision, so a caller without workOrder.record.read sees nothing.
 */
export async function listMyAssignedWorkOrders(
  deps: { readonly pool: Pool; readonly reader: ContextualReader },
  actor: OperationalActor,
  input: unknown,
): Promise<{ readonly employeeId: string | null; readonly items: readonly WorkOrderSummary[] }> {
  const i = (input ?? {}) as Record<string, unknown>;
  const extra = Object.keys(i).filter((k) => k !== "includeCompleted");
  if (extra.length > 0) refuse("INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT", `this read does not accept: ${extra.sort().join(", ")}`);
  const link = await deps.pool.query(
    `SELECT employee_id FROM eos_policy.employee_principal_links WHERE tenant_id = $1 AND principal_id = $2 AND status = 'active'`,
    [actor.tenantId, actor.principalId]);
  if (link.rows.length === 0) return Object.freeze({ employeeId: null, items: Object.freeze([]) });
  const employeeId = String(link.rows[0].employee_id);
  const excluded = i.includeCompleted === true ? ["CLOSED", "CANCELLED"] : [...TERMINAL_STATUSES];
  const { rows } = await deps.pool.query(
    `${SUMMARY_SELECT}
      WHERE w.tenant_id = $1 AND a.assignee_employee_id = $2 AND NOT (w.status::text = ANY($3::text[]))
      ORDER BY w.scheduled_start NULLS LAST, w.priority, w.id
      LIMIT ${WORK_ORDER_LIST_MAX}`,
    [actor.tenantId, employeeId, excluded]);
  const items: WorkOrderSummary[] = [];
  for (const r of rows) {
    const d = await authorizeWorkOrderRecordRead(deps.reader, actor, String(r.id));
    if (d.allowed) items.push(summaryOf(r));
  }
  return Object.freeze({ employeeId, items: Object.freeze(items) });
}

/**
 * The Employees who may be scheduled or dispatched: the assignment rule set (ACTIVE or CONTRACTOR, an active
 * governed login, the current SERVICE_TECHNICIAN eligibility). With `workOrderId`, ALSO the Work Order's own
 * governed operating company (DQ-013) -- the picker for one job. Without it, the dispatch board's roster: every
 * eligible technician, each carrying their operatingCompanyId so the board never offers one across companies.
 * A picker is discovery; the command re-checks every predicate.
 */
export async function listWorkOrderTechnicians(
  deps: { readonly pool: Pool },
  actor: LifecycleActor,
  input: unknown,
): Promise<{ readonly workOrderId: string | null; readonly operatingCompanyId: string | null; readonly items: readonly EmployeeDirectoryItem[] }> {
  if (!(actor?.capabilities instanceof Set)
    || !(actor.capabilities.has(WORK_ORDER_LIFECYCLE_SCHEDULE) || actor.capabilities.has(WORK_ORDER_LIFECYCLE_DISPATCH))) {
    refuse("CAPABILITY_MISSING", "FORBIDDEN",
      `choosing a technician requires ${WORK_ORDER_LIFECYCLE_SCHEDULE} or ${WORK_ORDER_LIFECYCLE_DISPATCH}`);
  }
  const workOrderId = (input as { workOrderId?: unknown } | null)?.workOrderId;
  if (workOrderId !== undefined && workOrderId !== null && !ID_SHAPE(workOrderId)) {
    refuse("WORK_ORDER_ID_INVALID", "INVALID_INPUT", "workOrderId must be a governed Work Order id");
  }
  let companyId: string | null = null;
  if (ID_SHAPE(workOrderId)) {
    const wo = await deps.pool.query(`SELECT operating_company_key FROM ${SCHEMA}.work_orders WHERE tenant_id = $1 AND id = $2`,
      [actor.tenantId, workOrderId]);
    if (wo.rows.length === 0) refuse("WORK_ORDER_NOT_FOUND", "NOT_FOUND", "the Work Order does not exist in this tenant");
    const client = await deps.pool.connect();
    try {
      companyId = await resolveActiveOperatingCompanyId(client, actor.tenantId, wo.rows[0].operating_company_key);
    } catch (err) {
      if (err instanceof OperatingCompanyBindingError) {
        refuse("WORK_ORDER_OPERATING_COMPANY_NOT_GOVERNED", "PRECONDITION_FAILED",
          "the Work Order's operating company is not bound to an ACTIVE governed company; nothing is inferred");
      }
      throw err;
    } finally {
      client.release();
    }
  }
  const { rows } = await deps.pool.query(
    `SELECT ${EMPLOYEE_DIRECTORY_COLUMNS} FROM eos_workforce.employees e
      WHERE e.tenant_id = $1 AND ($2::text IS NULL OR e.operating_company_id = $2) AND e.employment_status::text = ANY($3::text[])
        AND EXISTS (SELECT 1 FROM eos_policy.employee_principal_links l
                     WHERE l.tenant_id = e.tenant_id AND l.employee_id = e.id AND l.status = 'active')
        AND EXISTS (SELECT 1 FROM eos_workforce.employee_work_eligibility q
                     WHERE q.tenant_id = e.tenant_id AND q.employee_id = e.id AND q.qualification_code = $4 AND q.effective_to IS NULL)
      ORDER BY e.display_name NULLS LAST, e.id LIMIT ${WORK_ORDER_LIST_MAX}`,
    [actor.tenantId, companyId, [...WORK_ORDER_ASSIGNABLE_EMPLOYMENT_STATUSES], WORK_ORDER_ASSIGNMENT_QUALIFICATION]);
  return Object.freeze({ workOrderId: ID_SHAPE(workOrderId) ? workOrderId : null, operatingCompanyId: companyId,
    items: Object.freeze(rows.map(directoryItemOf)) });
}
