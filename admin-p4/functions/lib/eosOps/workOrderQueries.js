"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WORK_ORDER_LIST_MAX = void 0;
exports.readWorkOrderDetail = readWorkOrderDetail;
exports.listWorkOrders = listWorkOrders;
exports.listMyAssignedWorkOrders = listMyAssignedWorkOrders;
exports.listWorkOrderTechnicians = listWorkOrderTechnicians;
exports.listWorkOrderOperatingCompanies = listWorkOrderOperatingCompanies;
const workOrderRecordRead_1 = require("./workOrderRecordRead");
const workOrderLifecycle_1 = require("./workOrderLifecycle");
const workOrderExecution_1 = require("./workOrderExecution");
const workOrderQuarantine_1 = require("./workOrderQuarantine");
const workOrderCreateCommand_1 = require("./workOrderCreateCommand");
const workOrderAssignmentAuthority_1 = require("./workOrderAssignmentAuthority");
const operatingCompanyBinding_1 = require("./operatingCompanyBinding");
const SCHEMA = "eos_ops";
exports.WORK_ORDER_LIST_MAX = 200;
const TECHNICIAN_COLUMNS = `e.id, e.employment_status::text AS employment_status, e.operating_company_id, e.employee_number,
  e.preferred_name, e.display_name, e.first_name, e.last_name, e.job_title`;
const personName = (r) => {
    if (r.preferred_name)
        return String(r.preferred_name);
    if (r.display_name)
        return String(r.display_name);
    const joined = [r.first_name, r.last_name].filter((v) => typeof v === "string" && v !== "").join(" ");
    return joined === "" ? null : joined;
};
const technicianOf = (r) => Object.freeze({
    employeeId: String(r.id), displayName: personName(r), employeeNumber: r.employee_number ?? null,
    employmentStatus: String(r.employment_status), operatingCompanyId: String(r.operating_company_id),
    jobTitle: r.job_title ?? null,
});
const refuse = (code, category, message) => {
    throw new workOrderLifecycle_1.WorkOrderLifecycleError(code, category, message);
};
const ID_SHAPE = (v) => typeof v === "string" && v !== "" && v.trim() === v && v.length <= 200 && !v.includes("/");
const iso = (v) => (v === null || v === undefined ? null : new Date(v).toISOString());
const SUMMARY_SELECT = `
  SELECT w.id, w.work_order_number, w.status::text AS status, w.work_order_type::text AS work_order_type, w.priority,
         w.severity::text AS severity, w.operating_company_key, w.customer_id, acct.name AS customer_name, w.location_id,
         loc.name AS location_name, w.equipment_id, w.sales_order_id, w.scheduled_start, w.scheduled_end,
         a.assignee_employee_id, e.preferred_name AS assignee_preferred_name, e.display_name AS assignee_display_name, e.first_name AS assignee_first_name,
         e.last_name AS assignee_last_name, w.complaint, w.provenance::text AS provenance, w.created_at, w.updated_at,
         w.dispatched_at, w.accepted_at, w.en_route_at, w.arrived_at, w.work_started_at, w.completed_at, w.closed_at,
         w.diagnosis, w.resolution, w.estimated_duration_minutes
    FROM ${SCHEMA}.work_orders w
    LEFT JOIN ${SCHEMA}.work_order_assignments a
      ON a.tenant_id = w.tenant_id AND a.work_order_id = w.id AND a.effective_to IS NULL
    LEFT JOIN eos_workforce.employees e ON e.tenant_id = a.tenant_id AND e.id = a.assignee_employee_id
    LEFT JOIN eos_crm.accounts acct ON acct.tenant_id = w.tenant_id AND acct.id = w.customer_id
    LEFT JOIN eos_crm.account_locations loc ON loc.tenant_id = w.tenant_id AND loc.id = w.location_id`;
function summaryOf(r) {
    const assigneeName = personName({ preferred_name: r.assignee_preferred_name, display_name: r.assignee_display_name,
        first_name: r.assignee_first_name, last_name: r.assignee_last_name });
    return Object.freeze({
        workOrderId: String(r.id), workOrderNumber: r.work_order_number ?? null,
        status: String(r.status), workOrderType: String(r.work_order_type), priority: Number(r.priority),
        severity: r.severity ?? null, operatingCompanyKey: String(r.operating_company_key),
        customerId: String(r.customer_id), customerName: r.customer_name ?? null,
        locationId: String(r.location_id), locationName: r.location_name ?? null,
        equipmentId: r.equipment_id ?? null, salesOrderId: r.sales_order_id ?? null,
        scheduledStart: iso(r.scheduled_start), scheduledEnd: iso(r.scheduled_end),
        assigneeEmployeeId: r.assignee_employee_id ?? null, assigneeDisplayName: r.assignee_employee_id ? assigneeName : null,
        complaint: r.complaint ?? null, provenance: String(r.provenance),
        createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
    });
}
/**
 * One Work Order, after the entitled per-record decision allows it. The Equipment on the Work Order is part of
 * the Work Order's own record (its equipment_id), read through THIS gate -- not a tenant-wide Equipment read.
 */
async function readWorkOrderDetail(deps, actor, input) {
    const workOrderId = input?.workOrderId;
    const decision = await (0, workOrderRecordRead_1.authorizeWorkOrderRecordRead)(deps.reader, actor, workOrderId);
    if (!decision.allowed)
        refuse(String(decision.outcome), "FORBIDDEN", "this Work Order may not be read by this caller");
    const { rows } = await deps.pool.query(`${SUMMARY_SELECT} WHERE w.tenant_id = $1 AND w.id = $2`, [actor.tenantId, workOrderId]);
    if (rows.length === 0)
        refuse("WORK_ORDER_NOT_FOUND", "NOT_FOUND", "the Work Order does not exist in this tenant");
    if (await (0, workOrderQuarantine_1.isQuarantined)(deps.pool, actor.tenantId, workOrderId)) {
        refuse(workOrderQuarantine_1.WORK_ORDER_QUARANTINED, "PRECONDITION_FAILED", workOrderQuarantine_1.WORK_ORDER_QUARANTINED_MESSAGE);
    }
    const r = rows[0];
    const loc = await deps.pool.query(`SELECT address_street, address_city, address_state, address_postal_code, access_notes
       FROM eos_crm.account_locations WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, r.location_id]);
    const eq = r.equipment_id ? await deps.pool.query(`SELECT id, name, status::text AS status, serial_number, asset_tag, equipment_model_id, installed_on, warranty_expires_on
       FROM ${SCHEMA}.equipment WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, r.equipment_id]) : { rows: [] };
    const history = await deps.pool.query(`SELECT assignee_employee_id, source, reason, effective_from, effective_to, end_source, end_reason
       FROM ${SCHEMA}.work_order_assignments WHERE tenant_id = $1 AND work_order_id = $2 ORDER BY effective_from, id`, [actor.tenantId, workOrderId]);
    const e = eq.rows[0];
    const l = loc.rows[0];
    const dateOnly = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);
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
        execution: await (0, workOrderExecution_1.readWorkOrderExecution)(deps.pool, actor.tenantId, workOrderId),
        transitions: await (0, workOrderRecordRead_1.readWorkOrderTransitionHistoryGoverned)({ db: deps.pool, reader: deps.reader }, actor, workOrderId),
        assignmentHistory: Object.freeze(history.rows.map((h) => Object.freeze({
            employeeId: h.assignee_employee_id, source: h.source, reason: h.reason ?? null, effectiveFrom: iso(h.effective_from),
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
async function listWorkOrders(deps, actor, input) {
    if (!(actor?.capabilities instanceof Set) || !actor.capabilities.has(workOrderRecordRead_1.WORK_ORDER_RECORD_READ)) {
        refuse("CAPABILITY_MISSING", "FORBIDDEN", `the Work Order list requires ${workOrderRecordRead_1.WORK_ORDER_RECORD_READ}`);
    }
    const i = (input ?? {});
    const extra = Object.keys(i).filter((k) => !["statuses", "scheduledFrom", "scheduledTo", "assigneeEmployeeId", "customerId",
        "equipmentId", "plannedPartId", "search", "limit"].includes(k));
    if (extra.length > 0)
        refuse("INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT", `this read does not accept: ${extra.sort().join(", ")}`);
    const statuses = i.statuses === undefined ? null : i.statuses;
    if (statuses !== null && (!Array.isArray(statuses) || statuses.some((s) => !workOrderLifecycle_1.WORK_ORDER_STATUSES.includes(s)))) {
        refuse("STATUSES_INVALID", "INVALID_INPUT", "statuses must be governed Work Order statuses");
    }
    const bound = (v, name) => {
        if (v === undefined || v === null)
            return null;
        const d = new Date(v);
        if (typeof v !== "string" || Number.isNaN(d.getTime()))
            refuse("WINDOW_INVALID", "INVALID_INPUT", `${name} must be an ISO-8601 instant`);
        return d;
    };
    const from = bound(i.scheduledFrom, "scheduledFrom");
    const to = bound(i.scheduledTo, "scheduledTo");
    const optionalId = (k) => {
        if (i[k] === undefined || i[k] === null)
            return null;
        if (!ID_SHAPE(i[k]))
            refuse("FILTER_INVALID", "INVALID_INPUT", `${k} must be a governed id`);
        return i[k];
    };
    const assignee = optionalId("assigneeEmployeeId");
    const customerId = optionalId("customerId");
    const equipmentId = optionalId("equipmentId");
    const plannedPartId = optionalId("plannedPartId");
    let search = null;
    if (i.search !== undefined && i.search !== null) {
        if (typeof i.search !== "string" || i.search.trim() === "" || i.search.length > 100) {
            refuse("SEARCH_INVALID", "INVALID_INPUT", "search is a non-empty string of at most 100 characters");
        }
        search = `%${i.search.trim().replace(/[\\%_]/g, "\\$&")}%`;
    }
    const limit = i.limit === undefined ? 100 : Number(i.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > exports.WORK_ORDER_LIST_MAX)
        refuse("LIMIT_INVALID", "INVALID_INPUT", `limit is 1..${exports.WORK_ORDER_LIST_MAX}`);
    const { rows } = await deps.pool.query(`${SUMMARY_SELECT}
      WHERE w.tenant_id = $1 AND ${(0, workOrderQuarantine_1.notQuarantined)("w")}
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
      LIMIT ${limit + 1}`, [actor.tenantId, statuses, from, to, assignee, customerId, equipmentId, plannedPartId, search]);
    return Object.freeze({ items: Object.freeze(rows.slice(0, limit).map(summaryOf)), truncated: rows.length > limit });
}
/**
 * The technician's own work: the Work Orders whose OPEN assignment is the Employee the caller's ACTIVE governed
 * login resolves to (Employee against Employee -- never a uid or technician id). Each row still passes the
 * entitled per-record read decision, so a caller without workOrder.record.read sees nothing.
 */
async function listMyAssignedWorkOrders(deps, actor, input) {
    const i = (input ?? {});
    const extra = Object.keys(i).filter((k) => k !== "includeCompleted");
    if (extra.length > 0)
        refuse("INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT", `this read does not accept: ${extra.sort().join(", ")}`);
    const link = await deps.pool.query(`SELECT employee_id FROM eos_policy.employee_principal_links WHERE tenant_id = $1 AND principal_id = $2 AND status = 'active'`, [actor.tenantId, actor.principalId]);
    if (link.rows.length === 0)
        return Object.freeze({ employeeId: null, items: Object.freeze([]) });
    const employeeId = String(link.rows[0].employee_id);
    const excluded = i.includeCompleted === true ? ["CLOSED", "CANCELLED"] : [...workOrderLifecycle_1.TERMINAL_STATUSES];
    const { rows } = await deps.pool.query(`${SUMMARY_SELECT}
      WHERE w.tenant_id = $1 AND a.assignee_employee_id = $2 AND ${(0, workOrderQuarantine_1.notQuarantined)("w")} AND NOT (w.status::text = ANY($3::text[]))
      ORDER BY w.scheduled_start NULLS LAST, w.priority, w.id
      LIMIT ${exports.WORK_ORDER_LIST_MAX}`, [actor.tenantId, employeeId, excluded]);
    const items = [];
    for (const r of rows) {
        const d = await (0, workOrderRecordRead_1.authorizeWorkOrderRecordRead)(deps.reader, actor, String(r.id));
        if (d.allowed)
            items.push(summaryOf(r));
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
async function listWorkOrderTechnicians(deps, actor, input) {
    if (!(actor?.capabilities instanceof Set)
        || !(actor.capabilities.has(workOrderLifecycle_1.WORK_ORDER_LIFECYCLE_SCHEDULE) || actor.capabilities.has(workOrderLifecycle_1.WORK_ORDER_LIFECYCLE_DISPATCH))) {
        refuse("CAPABILITY_MISSING", "FORBIDDEN", `choosing a technician requires ${workOrderLifecycle_1.WORK_ORDER_LIFECYCLE_SCHEDULE} or ${workOrderLifecycle_1.WORK_ORDER_LIFECYCLE_DISPATCH}`);
    }
    const workOrderId = input?.workOrderId;
    if (workOrderId !== undefined && workOrderId !== null && !ID_SHAPE(workOrderId)) {
        refuse("WORK_ORDER_ID_INVALID", "INVALID_INPUT", "workOrderId must be a governed Work Order id");
    }
    let companyId = null;
    if (ID_SHAPE(workOrderId)) {
        const wo = await deps.pool.query(`SELECT operating_company_key FROM ${SCHEMA}.work_orders WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, workOrderId]);
        if (wo.rows.length === 0)
            refuse("WORK_ORDER_NOT_FOUND", "NOT_FOUND", "the Work Order does not exist in this tenant");
        const client = await deps.pool.connect();
        try {
            companyId = await (0, operatingCompanyBinding_1.resolveActiveOperatingCompanyId)(client, actor.tenantId, wo.rows[0].operating_company_key);
        }
        catch (err) {
            if (err instanceof operatingCompanyBinding_1.OperatingCompanyBindingError) {
                refuse("WORK_ORDER_OPERATING_COMPANY_NOT_GOVERNED", "PRECONDITION_FAILED", "the Work Order's operating company is not bound to an ACTIVE governed company; nothing is inferred");
            }
            throw err;
        }
        finally {
            client.release();
        }
    }
    const { rows } = await deps.pool.query(`SELECT ${TECHNICIAN_COLUMNS} FROM eos_workforce.employees e
      WHERE e.tenant_id = $1 AND ($2::text IS NULL OR e.operating_company_id = $2) AND e.employment_status::text = ANY($3::text[])
        AND EXISTS (SELECT 1 FROM eos_policy.employee_principal_links l
                     WHERE l.tenant_id = e.tenant_id AND l.employee_id = e.id AND l.status = 'active')
        AND EXISTS (SELECT 1 FROM eos_workforce.employee_work_eligibility q
                     WHERE q.tenant_id = e.tenant_id AND q.employee_id = e.id AND q.qualification_code = $4 AND q.effective_to IS NULL)
      ORDER BY e.display_name NULLS LAST, e.id LIMIT ${exports.WORK_ORDER_LIST_MAX}`, [actor.tenantId, companyId, [...workOrderAssignmentAuthority_1.WORK_ORDER_ASSIGNABLE_EMPLOYMENT_STATUSES], workOrderAssignmentAuthority_1.WORK_ORDER_ASSIGNMENT_QUALIFICATION]);
    return Object.freeze({ workOrderId: ID_SHAPE(workOrderId) ? workOrderId : null, operatingCompanyId: companyId,
        items: Object.freeze(rows.map(technicianOf)) });
}
/**
 * The operating companies a Work Order may be CREATED for, read from governed authority -- never inferred: the
 * tenant's ACTIVE companies that carry an ACTIVE eos_ops key binding (a company authorized but unkeyed cannot hold a
 * native Work Order, so offering it would only lead to OPERATING_COMPANY_KEY_NOT_BOUND). The caller STATES one of
 * these on create; the create command re-validates it. Requires workOrder.create.
 */
async function listWorkOrderOperatingCompanies(deps, actor) {
    if (!(actor?.capabilities instanceof Set) || !actor.capabilities.has(workOrderCreateCommand_1.WORK_ORDER_CREATE)) {
        refuse("CAPABILITY_MISSING", "FORBIDDEN", `choosing a Work Order's operating company requires ${workOrderCreateCommand_1.WORK_ORDER_CREATE}`);
    }
    const { rows } = await deps.pool.query(`SELECT c.operating_company_id, b.operating_company_key
       FROM eos_policy.tenant_operating_companies c
       JOIN eos_policy.tenant_operating_company_keys b
         ON b.tenant_id = c.tenant_id AND b.operating_company_id = c.operating_company_id AND b.status = 'ACTIVE'
      WHERE c.tenant_id = $1 AND c.status = 'ACTIVE'
      ORDER BY c.operating_company_id`, [actor.tenantId]);
    return Object.freeze({ items: Object.freeze(rows.map((r) => Object.freeze({
            operatingCompanyId: String(r.operating_company_id), operatingCompanyKey: String(r.operating_company_key),
        }))) });
}
//# sourceMappingURL=workOrderQueries.js.map