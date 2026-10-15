"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readWorkOrderFieldContext = exports.INVENTORY_NOT_YET_ACTIVATED = void 0;
exports.readAuthorizedWorkOrderRow = readAuthorizedWorkOrderRow;
exports.readPlannedPartLines = readPlannedPartLines;
const workOrderLifecycle_1 = require("./workOrderLifecycle");
const workOrderQuarantine_1 = require("./workOrderQuarantine");
const workOrderRecordRead_1 = require("./workOrderRecordRead");
const workOrderExecution_1 = require("./workOrderExecution");
const postgresCatalogReads_1 = require("../catalogMaster/postgresCatalogReads");
const catalogRows_1 = require("../catalogMaster/catalogRows");
const SCHEMA = "eos_ops";
/** The inventory boundary, stated identically wherever it appears. Nothing behind it is read or invented. */
exports.INVENTORY_NOT_YET_ACTIVATED = Object.freeze({
    state: "NOT_YET_ACTIVATED",
    boundary: "INVENTORY_BALANCE",
    message: "Inventory readiness is not activated yet: no stock balance, reservation or truck quantity is read.",
});
const refuse = (code, category, message) => {
    throw new workOrderLifecycle_1.WorkOrderLifecycleError(code, category, message);
};
const text = (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const iso = (v) => (v === null || v === undefined ? null : new Date(v).toISOString());
const dateOnly = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);
const personName = (r) => {
    if (text(r.preferred_name))
        return text(r.preferred_name);
    if (text(r.display_name))
        return text(r.display_name);
    const joined = [r.first_name, r.last_name].filter((v) => typeof v === "string" && v !== "").join(" ");
    return joined === "" ? null : joined;
};
/**
 * The shared front half of both field reads: the input shape, the entitled per-record decision, and the governed
 * Work Order row (with its assignment, customer and site). Refuses before anything is read for a caller the
 * decision does not allow; a real id and a guessed one refuse identically.
 */
async function readAuthorizedWorkOrderRow(deps, actor, input) {
    const extra = Object.keys(input ?? {}).filter((k) => k !== "workOrderId");
    if (extra.length > 0)
        refuse("INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT", `this read does not accept: ${extra.sort().join(", ")}`);
    const workOrderId = input?.workOrderId;
    const decision = await (0, workOrderRecordRead_1.authorizeWorkOrderRecordRead)(deps.reader, actor, workOrderId);
    if (!decision.allowed)
        refuse(String(decision.outcome), "FORBIDDEN", "this Work Order may not be read by this caller");
    const { rows } = await deps.pool.query(`SELECT w.id, w.work_order_number, w.status::text AS status, w.work_order_type::text AS work_order_type, w.priority,
            w.severity::text AS severity, w.complaint, w.diagnosis, w.resolution, w.scheduled_start, w.scheduled_end,
            w.estimated_duration_minutes, w.customer_id, w.location_id, w.equipment_id,
            w.accepted_at, w.en_route_at, w.arrived_at, w.work_started_at, w.completed_at,
            acct.id AS acct_id, acct.name AS acct_name,
            loc.id AS loc_id, loc.name AS loc_name, loc.address_street, loc.address_city, loc.address_state,
            loc.address_postal_code, loc.access_notes,
            a.assignee_employee_id, e.preferred_name, e.display_name, e.first_name, e.last_name
       FROM ${SCHEMA}.work_orders w
       LEFT JOIN ${SCHEMA}.work_order_assignments a ON a.tenant_id = w.tenant_id AND a.work_order_id = w.id AND a.effective_to IS NULL
       LEFT JOIN eos_workforce.employees e ON e.tenant_id = a.tenant_id AND e.id = a.assignee_employee_id
       LEFT JOIN eos_crm.accounts acct ON acct.tenant_id = w.tenant_id AND acct.id = w.customer_id
       LEFT JOIN eos_crm.account_locations loc ON loc.tenant_id = w.tenant_id AND loc.id = w.location_id
      WHERE w.tenant_id = $1 AND w.id = $2`, [actor.tenantId, workOrderId]);
    if (rows.length === 0)
        refuse("WORK_ORDER_NOT_FOUND", "NOT_FOUND", "the Work Order does not exist in this tenant");
    if (await (0, workOrderQuarantine_1.isQuarantined)(deps.pool, actor.tenantId, workOrderId))
        refuse(workOrderQuarantine_1.WORK_ORDER_QUARANTINED, "PRECONDITION_FAILED", workOrderQuarantine_1.WORK_ORDER_QUARANTINED_MESSAGE);
    return { workOrderId, row: rows[0] };
}
/**
 * The planned Parts with their recorded actuals, named by the PostgreSQL Catalog through its governed by-id read.
 * A plan line whose Part the Catalog cannot name is UNRESOLVED, never given a guessed name.
 */
async function readPlannedPartLines(deps, actor, workOrderId) {
    const plan = await (0, workOrderRecordRead_1.readWorkOrderPartsPlanGoverned)({ db: deps.pool, reader: deps.reader }, actor, workOrderId);
    const execution = await (0, workOrderExecution_1.readWorkOrderExecution)(deps.pool, actor.tenantId, workOrderId);
    const usedByPart = new Map(execution.parts.map((p) => [p.partId, p.qtyUsed]));
    const ids = plan.map((l) => l.partId);
    const parts = new Map();
    for (let i = 0; i < ids.length; i += postgresCatalogReads_1.PART_BY_IDS_MAX) {
        for (const p of await (0, postgresCatalogReads_1.readPartsByIds)(deps.pool, actor.tenantId, ids.slice(i, i + postgresCatalogReads_1.PART_BY_IDS_MAX)))
            parts.set(p.id, p);
    }
    return Object.freeze(plan.map((l) => {
        const part = parts.get(l.partId);
        return Object.freeze({
            partId: l.partId, name: part?.name ?? null, internalPartNumber: part?.internalPartNumber ?? null,
            catalog: part ? "RESOLVED" : "UNRESOLVED",
            qtyPlanned: l.qtyPlanned, qtyUsed: usedByPart.get(l.partId) ?? 0,
        });
    }));
}
/** The site label: the location's own name, qualified by city/state when present (the F1 rule). */
function siteLabel(r) {
    const name = text(r.loc_name);
    if (!name)
        return null;
    const place = [text(r.address_city), text(r.address_state)].filter(Boolean).join(", ");
    return place ? `${name} — ${place}` : name;
}
async function assembleFieldContext(deps, actor, input) {
    const { workOrderId, row: r } = await readAuthorizedWorkOrderRow(deps, actor, input);
    const customerName = text(r.acct_name);
    const label = siteLabel(r);
    let equipment;
    if (!r.equipment_id) {
        equipment = { state: "NOT_APPLICABLE", equipment: null, model: null };
    }
    else {
        // The Equipment on the Work Order is part of the Work Order's own record, read through THIS gate -- not a
        // tenant-wide Equipment read. Its model is named by the PostgreSQL Catalog's equipment model row.
        const eq = (await deps.pool.query(`SELECT id, name, status::text AS status, serial_number, asset_tag, equipment_model_id, installed_on, warranty_expires_on
         FROM ${SCHEMA}.equipment WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, r.equipment_id])).rows[0];
        const modelRow = eq?.equipment_model_id
            ? (await deps.pool.query(`${catalogRows_1.EQUIPMENT_MODEL_SELECT} WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, eq.equipment_model_id])).rows[0]
            : undefined;
        const model = modelRow ? (0, catalogRows_1.equipmentModelFromRow)(modelRow) : null;
        equipment = eq ? {
            state: "AVAILABLE",
            equipment: Object.freeze({
                equipmentId: String(eq.id), name: String(eq.name), status: String(eq.status), serialNumber: eq.serial_number ?? null,
                assetTag: eq.asset_tag ?? null, equipmentModelId: eq.equipment_model_id ?? null,
                installedOn: dateOnly(eq.installed_on), warrantyExpiresOn: dateOnly(eq.warranty_expires_on),
            }),
            model: model ? Object.freeze({ equipmentModelId: model.id, displayName: model.displayName, manufacturerName: model.manufacturerName,
                modelNumber: model.modelNumber }) : null,
        } : { state: "AVAILABLE", equipment: null, model: null, reference: "UNRESOLVED" };
    }
    const execution = await (0, workOrderExecution_1.readWorkOrderExecution)(deps.pool, actor.tenantId, workOrderId);
    const callerEmployeeId = await deps.reader.linkedEmployeeId(actor.tenantId, actor.principalId);
    const assigneeEmployeeId = r.assignee_employee_id ?? null;
    return Object.freeze({
        schemaVersion: 1,
        workOrderId,
        workOrder: Object.freeze({
            state: "AVAILABLE",
            workOrderNumber: r.work_order_number ?? null, status: String(r.status),
            workOrderType: String(r.work_order_type), priority: Number(r.priority), severity: r.severity ?? null,
            complaint: r.complaint ?? null, diagnosis: r.diagnosis ?? null,
            resolution: r.resolution ?? null,
            scheduledStart: iso(r.scheduled_start), scheduledEnd: iso(r.scheduled_end),
            estimatedDurationMinutes: r.estimated_duration_minutes === null || r.estimated_duration_minutes === undefined
                ? null : Number(r.estimated_duration_minutes),
            timestamps: Object.freeze({ acceptedAt: iso(r.accepted_at), enRouteAt: iso(r.en_route_at), arrivedAt: iso(r.arrived_at),
                workStartedAt: iso(r.work_started_at), completedAt: iso(r.completed_at) }),
        }),
        // ABSENT (no reference) and UNRESOLVED (reference present, no usable canonical value) stay different facts.
        customer: Object.freeze({
            state: (!r.customer_id ? "ABSENT" : customerName ? "RESOLVED" : "UNRESOLVED"),
            displayName: customerName,
        }),
        site: Object.freeze({
            state: (!r.location_id ? "ABSENT" : label ? "RESOLVED" : "UNRESOLVED"),
            displayLabel: label,
            address: r.loc_id ? Object.freeze({ street: r.address_street ?? null, city: r.address_city ?? null,
                state: r.address_state ?? null, postalCode: r.address_postal_code ?? null }) : null,
            accessNotes: r.access_notes ?? null,
        }),
        assignment: Object.freeze({
            state: "AVAILABLE",
            assigneeEmployeeId,
            assigneeDisplayName: assigneeEmployeeId ? personName(r) : null,
            assignedToCaller: assigneeEmployeeId !== null && assigneeEmployeeId === callerEmployeeId,
        }),
        equipment: Object.freeze({
            ...equipment,
            // Serialized custody and installation stay behind the Inventory boundary: the PostgreSQL custody authority
            // is not activated, so nothing about where a serialized unit IS is read or implied.
            custody: Object.freeze({ state: "NOT_YET_ACTIVATED" }),
        }),
        parts: Object.freeze({ state: "AVAILABLE", lines: await readPlannedPartLines(deps, actor, workOrderId) }),
        execution: Object.freeze({ state: "AVAILABLE", notes: execution.notes }),
        inventory: exports.INVENTORY_NOT_YET_ACTIVATED,
    });
}
/** readWorkOrderFieldContext: the governed field context for ONE Work Order, behind the entitled record read. */
const readWorkOrderFieldContext = (deps, caller, input) => assembleFieldContext({ pool: deps.pool, reader: deps.reader }, caller.operational, (input ?? {}));
exports.readWorkOrderFieldContext = readWorkOrderFieldContext;
//# sourceMappingURL=workOrderFieldContext.js.map