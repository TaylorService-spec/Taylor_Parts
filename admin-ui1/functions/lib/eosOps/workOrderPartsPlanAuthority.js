"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkOrderPartsPlanError = exports.TERMINAL_WORK_ORDER_STATUSES = exports.WORK_ORDER_PARTS_PLAN = void 0;
exports.validatePartsPlanLines = validatePartsPlanLines;
exports.readPartsPlan = readPartsPlan;
exports.setPartsPlan = setPartsPlan;
const postgresPartPolicyAuthority_js_1 = require("../catalogAuthority/postgresPartPolicyAuthority.js");
const workOrderQuarantine_js_1 = require("./workOrderQuarantine.js");
const SCHEMA = "eos_ops";
/** Already in the Role catalog; this command does not invent a capability. */
exports.WORK_ORDER_PARTS_PLAN = "workOrder.parts.plan";
/**
 * A finished Work Order's plan is closed. The SAME three statuses as transitionEngine.TERMINAL_STATUSES.
 * Restated here because this module may not import the Firestore engine -- and asserted equal to it by
 * workOrderPartsPlanAuthority.test.mjs, so the two cannot drift.
 */
exports.TERMINAL_WORK_ORDER_STATUSES = Object.freeze(["COMPLETED", "CLOSED", "CANCELLED"]);
class WorkOrderPartsPlanError extends Error {
    code;
    category;
    constructor(code, category, message) {
        super(message);
        this.code = code;
        this.category = category;
        this.name = "WorkOrderPartsPlanError";
    }
}
exports.WorkOrderPartsPlanError = WorkOrderPartsPlanError;
const refuse = (code, category, message) => {
    throw new WorkOrderPartsPlanError(code, category, message);
};
const ID_SHAPE = (v) => typeof v === "string" && v !== "" && v.trim() === v && v.length <= 200 && !v.includes("/");
const POSITIVE_INT = (v) => typeof v === "number" && Number.isInteger(v) && v > 0;
/** Validate the stated plan. Never a partial plan: one bad line refuses all of them. */
function validatePartsPlanLines(lines) {
    if (!Array.isArray(lines))
        refuse("PLAN_INVALID", "INVALID_INPUT", "plan must be a list");
    const seen = new Set();
    return Object.freeze(lines.map((raw, i) => {
        if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
            refuse("PLAN_LINE_INVALID", "INVALID_INPUT", `plan line ${i} must be an object`);
        }
        const line = raw;
        const extra = Object.keys(line).filter((k) => !["partId", "qtyPlanned", "expectedVersion"].includes(k));
        if (extra.length > 0) {
            refuse("PLAN_LINE_FIELD_NOT_ACCEPTED", "INVALID_INPUT", `plan line ${i} does not accept: ${extra.sort().join(", ")}`);
        }
        if (!ID_SHAPE(line.partId))
            refuse("PART_ID_INVALID", "INVALID_INPUT", `plan line ${i} requires a partId`);
        const partId = line.partId;
        // A duplicate would make the plan ambiguous about its own quantity. The table's primary key would
        // refuse it too, but as a constraint violation rather than as a statement about the request.
        if (seen.has(partId))
            refuse("PART_DUPLICATED", "INVALID_INPUT", `part ${partId} appears twice in one plan`);
        seen.add(partId);
        if (!POSITIVE_INT(line.qtyPlanned)) {
            refuse("QUANTITY_INVALID", "INVALID_INPUT", `plan line ${i} requires a positive integer qtyPlanned`);
        }
        if (line.expectedVersion !== undefined && !POSITIVE_INT(line.expectedVersion)) {
            refuse("VERSION_INVALID", "INVALID_INPUT", `plan line ${i} has an invalid expectedVersion`);
        }
        return Object.freeze({
            partId,
            qtyPlanned: line.qtyPlanned,
            ...(line.expectedVersion === undefined ? {} : { expectedVersion: line.expectedVersion }),
        });
    }));
}
const row = (r) => Object.freeze({
    partId: String(r.part_id),
    qtyPlanned: Number(r.qty_planned),
    version: Number(r.version),
    plannedAt: new Date(r.planned_at).toISOString(),
    plannedBy: String(r.planned_by),
    updatedAt: new Date(r.updated_at).toISOString(),
    updatedBy: String(r.updated_by),
});
/** The Work Order's current plan. A read, in Part order, with no side effect. */
async function readPartsPlan(db, tenantId, workOrderId) {
    if (!ID_SHAPE(tenantId) || !ID_SHAPE(workOrderId)) {
        refuse("INPUT_INVALID", "INVALID_INPUT", "a plan is only readable for a stated Work Order within a tenant");
    }
    const { rows } = await db.query(`SELECT part_id, qty_planned, version, planned_at, planned_by, updated_at, updated_by
       FROM ${SCHEMA}.work_order_parts_plan
      WHERE tenant_id = $1 AND work_order_id = $2
      ORDER BY part_id`, [tenantId, workOrderId]);
    return Object.freeze(rows.map(row));
}
/**
 * Set the whole parts plan for one Work Order.
 *
 * ONE TRANSACTION. A plan that added two requirements and failed to remove a third is not the plan anyone
 * stated, and the removal rule (usage) can only be evaluated against the same snapshot as the write.
 */
async function setPartsPlan(deps, actor, input) {
    if (!ID_SHAPE(actor?.tenantId) || !ID_SHAPE(actor?.principalId)) {
        refuse("ACTOR_INVALID", "INVALID_INPUT", "an actor is a Principal within a tenant");
    }
    if (!(actor.capabilities instanceof Set) || !actor.capabilities.has(exports.WORK_ORDER_PARTS_PLAN)) {
        refuse("CAPABILITY_MISSING", "FORBIDDEN", `planning parts requires ${exports.WORK_ORDER_PARTS_PLAN}`);
    }
    if (!ID_SHAPE(input?.workOrderId))
        refuse("WORK_ORDER_ID_INVALID", "INVALID_INPUT", "a workOrderId is required");
    const lines = validatePartsPlanLines(input.plan);
    const { tenantId, principalId } = actor;
    const workOrderId = input.workOrderId;
    const now = (deps.now ?? (() => new Date()))();
    const client = await deps.pool.connect();
    try {
        await client.query("BEGIN");
        // FOR UPDATE on the Work Order: a concurrent transition to COMPLETED waits here rather than racing the
        // terminal check, which is the only thing that makes that refusal mean anything.
        const wo = await client.query(`SELECT status::text AS status FROM ${SCHEMA}.work_orders
        WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, workOrderId]);
        if (wo.rows.length === 0) {
            refuse("WORK_ORDER_NOT_FOUND", "NOT_FOUND", `no work order ${workOrderId} in this tenant`);
        }
        if (await (0, workOrderQuarantine_js_1.isQuarantined)(client, tenantId, workOrderId))
            refuse(workOrderQuarantine_js_1.WORK_ORDER_QUARANTINED, "PRECONDITION_FAILED", workOrderQuarantine_js_1.WORK_ORDER_QUARANTINED_MESSAGE);
        const status = String(wo.rows[0].status);
        if (exports.TERMINAL_WORK_ORDER_STATUSES.includes(status)) {
            refuse("TERMINAL_WORK_ORDER", "PRECONDITION_FAILED", `cannot change the parts plan on a terminal Work Order (status ${status})`);
        }
        // EXISTENCE FIRST, AND FOR EVERY LINE AT ONCE -- a plan whose fourth line names an unknown Part must
        // not have written the first three.
        if (lines.length > 0) {
            const policies = await (0, postgresPartPolicyAuthority_js_1.createPostgresPartPolicyAuthority)()
                .readPartPolicies(client, tenantId, lines.map((l) => l.partId));
            for (const policy of policies) {
                if (!policy.found) {
                    refuse("PART_NOT_FOUND", "NOT_FOUND", `part ${policy.partId} is not a Part of this tenant's catalog; a plan cannot require what does not exist`);
                }
            }
        }
        const existing = new Map((await readPartsPlan(client, tenantId, workOrderId)).map((r) => [r.partId, r]));
        const stated = new Map(lines.map((l) => [l.partId, l]));
        const removals = [...existing.keys()].filter((partId) => !stated.has(partId)).sort();
        // USAGE IS READ FROM THE COMMITMENT LEDGER, not from this table. A requirement someone has already
        // used parts against is evidence of what happened on site; un-planning it would leave consumption
        // pointing at a requirement that no longer exists.
        if (removals.length > 0) {
            // AND FROM THE RECORDED ACTUALS (workOrderExecution.ts): a Part the technician reported using is on-site
            // evidence even though no stock has been consumed yet -- Firebase refused un-planning a qtyUsed > 0 row.
            const used = await client.query(`SELECT part_id FROM (
           SELECT part_id, SUM(quantity)::bigint AS used
             FROM ${SCHEMA}.inventory_commitments
            WHERE tenant_id = $1 AND work_order_id = $2 AND event_type = 'CONSUMED' AND part_id = ANY($3::text[])
            GROUP BY part_id
           UNION ALL
           SELECT part_id, SUM(applied_delta)::bigint AS used
             FROM ${SCHEMA}.work_order_execution_records
            WHERE tenant_id = $1 AND work_order_id = $2 AND kind = 'PART_USAGE' AND part_id = ANY($3::text[])
            GROUP BY part_id
         ) u WHERE used > 0 GROUP BY part_id`, [tenantId, workOrderId, removals]);
            if (used.rows.length > 0) {
                const names = used.rows.map((r) => String(r.part_id)).sort().join(", ");
                refuse("USED_PART_REMOVAL", "PRECONDITION_FAILED", `cannot un-plan a part with recorded usage: ${names}`);
            }
            await client.query(`DELETE FROM ${SCHEMA}.work_order_parts_plan
          WHERE tenant_id = $1 AND work_order_id = $2 AND part_id = ANY($3::text[])`, [tenantId, workOrderId, removals]);
        }
        const added = [], changed = [], unchanged = [];
        for (const line of [...stated.values()].sort((a, b) => a.partId.localeCompare(b.partId))) {
            const current = existing.get(line.partId);
            if (current && line.expectedVersion !== undefined && line.expectedVersion !== current.version) {
                refuse("VERSION_CONFLICT", "CONFLICT", `part ${line.partId} was planned at version ${current.version}, not ${line.expectedVersion}`);
            }
            if (!current) {
                await client.query(`INSERT INTO ${SCHEMA}.work_order_parts_plan
             (tenant_id, work_order_id, part_id, qty_planned, planned_at, planned_by, updated_at, updated_by, version)
           VALUES ($1, $2, $3, $4, $5, $6, $5, $6, 1)`, [tenantId, workOrderId, line.partId, line.qtyPlanned, now, principalId]);
                added.push(line.partId);
                continue;
            }
            // A RESTATED, IDENTICAL REQUIREMENT WRITES NOTHING. Bumping the version and the timestamp for a
            // quantity that did not change would manufacture an edit history of edits nobody made -- the same
            // reason assignWorkOrderToEmployee answers NO_CHANGE for a reassignment to the same Employee.
            if (current.qtyPlanned === line.qtyPlanned) {
                unchanged.push(line.partId);
                continue;
            }
            await client.query(`UPDATE ${SCHEMA}.work_order_parts_plan
            SET qty_planned = $4, updated_at = $5, updated_by = $6, version = version + 1
          WHERE tenant_id = $1 AND work_order_id = $2 AND part_id = $3`, [tenantId, workOrderId, line.partId, line.qtyPlanned, now, principalId]);
            changed.push(line.partId);
        }
        const plan = await readPartsPlan(client, tenantId, workOrderId);
        await client.query("COMMIT");
        return Object.freeze({
            workOrderId,
            added: Object.freeze(added), changed: Object.freeze(changed),
            removed: Object.freeze(removals), unchanged: Object.freeze(unchanged),
            plan,
        });
    }
    catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        throw err;
    }
    finally {
        client.release();
    }
}
//# sourceMappingURL=workOrderPartsPlanAuthority.js.map