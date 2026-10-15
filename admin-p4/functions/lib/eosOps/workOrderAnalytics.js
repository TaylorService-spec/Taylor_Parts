"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readTechnicianVolumeBreakdown = exports.readWorkOrderConsumptionSnapshot = exports.readTechnicianExecutionStats = void 0;
exports.activeWorkOrderPredicate = activeWorkOrderPredicate;
// THE GOVERNED WORK ORDER OPERATIONAL AGGREGATES -- the three reads that replace the last Firestore Work Order
// aggregate reads in the browser (field-ops-app-vite/src/analytics/executionAnalyticsService.ts):
//
//   readTechnicianExecutionStats      <- getTechnicianExecutionStats(technicianId)   (PerformanceSnapshot)
//   readWorkOrderConsumptionSnapshot  <- getInventoryConsumptionSnapshot()           (ExecutionInsightsPanel)
//   readTechnicianVolumeBreakdown     <- getTechnicianVolumeBreakdown()              (ExecutionInsightsPanel)
//
// Owner ruling (Work Order cutover completion pass, 2026-09-30): "Replace the three remaining Firestore Work Order
// aggregate reads with PostgreSQL queries over the active, non-quarantined Work Order set. Quarantined rows must
// not affect operational KPIs. Do not redesign Reporting." These are the Service surfaces' operational figures,
// nothing more: each keeps its Firebase definition wherever that definition is recoverable, and says where not.
//
// ════════════════════ THE POPULATION: ONE PREDICATE ════════════════════
//
// Every aggregate below counts only Work Orders that satisfy `activeWorkOrderPredicate(alias)` -- the ONE place the
// active set is defined. No query here states its own population rule, so the quarantine exclusion is wired once
// and reaches every KPI together.
//
// ════════════════════ WHO A TECHNICIAN IS ════════════════════
//
// An EMPLOYEE (eos_workforce.employees.id), never a fieldops_technicians id and never a uid. A Work Order is a
// technician's when its OPEN governed assignment (effective_to IS NULL) names that Employee -- the PostgreSQL
// equivalent of Firestore's `assignedTechId`, which is likewise the current assignee (the governed assignment is
// not closed by completion or close; only a reassignment or unschedule ends it).
//
// ════════════════════ CONSUMPTION IS RECORDED ACTUALS ════════════════════
//
// "Parts consumed" is the technician's recorded execution actuals (eos_ops.work_order_execution_records,
// kind PART_USAGE: the SUM of applied deltas per Work Order and Part -- workOrderExecution.ts). It is NOT stock
// movement: no stock moves on the governed route (NO_STOCK_MOVEMENT / CONSUME_NOT_APPLIED), and nothing here reads
// an Inventory ledger. Firebase read the same fact (inventorySnapshot[].qtyUsed, qtyUsed > 0 only).
//
// ════════════════════ AUTHORITY ════════════════════
//
//   * The office aggregates (consumption, volume, and any named Employee's stats) require workOrder.record.read
//     held UNCONDITIONALLY -- the flat set the transport passes with conditioned keys withheld, exactly the
//     listWorkOrders queue gate. A condition is never evaluated as "true for the whole tenant".
//   * A caller without the unconditioned holding may read ONLY their own stats: their ACTIVE employee_principal_link
//     names the Employee, and each of that Employee's Work Orders still passes the entitled per-record read decision
//     (authorizeWorkOrderRecordRead) before it is counted -- the listMyAssignedWorkOrders shape.
//
// Nothing here writes, and nothing here reads Firestore.
const workOrderQuarantine_1 = require("./workOrderQuarantine");
const workOrderLifecycle_1 = require("./workOrderLifecycle");
const workOrderRecordRead_1 = require("./workOrderRecordRead");
const SCHEMA = "eos_ops";
const refuse = (code, category, message) => {
    throw new workOrderLifecycle_1.WorkOrderLifecycleError(code, category, message);
};
const ID_SHAPE = (v) => typeof v === "string" && v !== "" && v.trim() === v && v.length <= 200 && !v.includes("/");
const SQL_ALIAS = /^[a-z_][a-z0-9_]*$/;
/**
 * THE ACTIVE WORK ORDER SET, as a SQL boolean over the eos_ops.work_orders row aliased `alias`.
 *
 * The single definition every aggregate in this module uses: every Work Order NOT under the pinned quarantine
 * (Owner DECISION 3) -- quarantined rows never affect an operational KPI. Delegated to the ONE quarantine predicate.
 */
function activeWorkOrderPredicate(alias) {
    if (!SQL_ALIAS.test(alias))
        throw new Error(`activeWorkOrderPredicate: "${alias}" is not a SQL alias`);
    return (0, workOrderQuarantine_1.notQuarantined)(alias);
}
function only(input, allowed) {
    const i = (input ?? {});
    if (typeof i !== "object" || Array.isArray(i))
        refuse("INPUT_INVALID", "INVALID_INPUT", "input must be an object");
    const extra = Object.keys(i).filter((k) => !allowed.includes(k));
    if (extra.length > 0)
        refuse("INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT", `this read does not accept: ${extra.sort().join(", ")}`);
    return i;
}
const holdsFlat = (caps) => caps instanceof Set && caps.has(workOrderRecordRead_1.WORK_ORDER_RECORD_READ);
const requireOfficeRead = (caps, what) => {
    if (!holdsFlat(caps))
        refuse("CAPABILITY_MISSING", "FORBIDDEN", `${what} requires ${workOrderRecordRead_1.WORK_ORDER_RECORD_READ}`);
};
const personName = (r) => {
    if (r.preferred_name)
        return String(r.preferred_name);
    if (r.display_name)
        return String(r.display_name);
    const joined = [r.first_name, r.last_name].filter((v) => typeof v === "string" && v !== "").join(" ");
    return joined === "" ? null : joined;
};
/** Each Work Order's recorded actual per Part: SUM(applied_delta), kept only where it is > 0 (Firebase: qtyUsed > 0). */
const ACTUALS_BY_WORK_ORDER_PART = `
  SELECT r.tenant_id, r.work_order_id, r.part_id, SUM(r.applied_delta)::bigint AS qty_used
    FROM ${SCHEMA}.work_order_execution_records r
   WHERE r.kind = 'PART_USAGE'
   GROUP BY r.tenant_id, r.work_order_id, r.part_id
  HAVING SUM(r.applied_delta) > 0`;
async function activeEmployeeLink(pool, tenantId, principalId) {
    const { rows } = await pool.query(`SELECT employee_id FROM eos_policy.employee_principal_links WHERE tenant_id = $1 AND principal_id = $2 AND status = 'active'`, [tenantId, principalId]);
    return rows.length === 0 ? null : String(rows[0].employee_id);
}
const holdsAtAll = (op) => holdsFlat(op.capabilities)
    || (op.conditionallyHeld instanceof Set && op.conditionallyHeld.has(workOrderRecordRead_1.WORK_ORDER_RECORD_READ))
    || (Array.isArray(op.scopedHeld) && op.scopedHeld.some((h) => h.capabilityKey === workOrderRecordRead_1.WORK_ORDER_RECORD_READ));
/**
 * One Employee's execution figures, with getTechnicianExecutionStats' definitions:
 *   * workOrderVolumeByStatus -- every Work Order in the population, counted by current status;
 *   * totalWorkOrdersCompleted -- those whose completed_at was ever set (a since-CLOSED one still counts);
 *   * totalPartsConsumed -- the sum of recorded actuals (qty > 0) across the population;
 *   * averageCompletionTimeMs -- mean(completed_at - work_started_at) over Work Orders carrying both, WITHDRAWN
 *     (null) when any pair is inverted; completionEvidence counts valid / inverted / completed-but-missing-start.
 */
const readTechnicianExecutionStats = async (deps, caller, input) => {
    const i = only(input, ["employeeId"]);
    if (i.employeeId !== undefined && i.employeeId !== null && !ID_SHAPE(i.employeeId)) {
        refuse("EMPLOYEE_ID_INVALID", "INVALID_INPUT", "employeeId must be a governed Employee id");
    }
    const { tenantId, principalId } = caller.actor;
    const office = holdsFlat(caller.actor.capabilities);
    // CAPABILITY FIRST: a caller holding no workOrder.record.read at all learns nothing, not even its own link.
    if (!office && !holdsAtAll(caller.operational)) {
        refuse("CAPABILITY_MISSING", "FORBIDDEN", `execution stats require ${workOrderRecordRead_1.WORK_ORDER_RECORD_READ}`);
    }
    const own = await activeEmployeeLink(deps.pool, tenantId, principalId);
    const stated = (i.employeeId ?? null);
    let employeeId;
    if (office) {
        if (stated === null && own === null) {
            refuse("EMPLOYEE_REQUIRED", "INVALID_INPUT", "state employeeId, or sign in with a login linked to an Employee");
        }
        employeeId = (stated ?? own);
    }
    else {
        if (own === null)
            refuse("EMPLOYEE_LINK_REQUIRED", "FORBIDDEN", "this login is not linked to an Employee; only a linked technician reads their own stats");
        if (stated !== null && stated !== own) {
            refuse("NOT_OWN_EMPLOYEE", "FORBIDDEN", `another Employee's stats require ${workOrderRecordRead_1.WORK_ORDER_RECORD_READ} held without a condition`);
        }
        employeeId = own;
    }
    const emp = await deps.pool.query(`SELECT id, preferred_name, display_name, first_name, last_name FROM eos_workforce.employees WHERE tenant_id = $1 AND id = $2`, [tenantId, employeeId]);
    if (emp.rows.length === 0)
        refuse("EMPLOYEE_NOT_FOUND", "NOT_FOUND", "the Employee does not exist in this tenant");
    const { rows } = await deps.pool.query(`SELECT w.id, w.status::text AS status, w.work_started_at, w.completed_at,
            COALESCE((SELECT SUM(u.qty_used) FROM (${ACTUALS_BY_WORK_ORDER_PART}) u
                       WHERE u.tenant_id = w.tenant_id AND u.work_order_id = w.id), 0)::bigint AS parts_used
       FROM ${SCHEMA}.work_orders w
       JOIN ${SCHEMA}.work_order_assignments a
         ON a.tenant_id = w.tenant_id AND a.work_order_id = w.id AND a.effective_to IS NULL
      WHERE w.tenant_id = $1 AND a.assignee_employee_id = $2 AND ${activeWorkOrderPredicate("w")}
      ORDER BY w.id`, [tenantId, employeeId]);
    // A non-office caller counts only what the entitled per-record decision lets them read -- never widened.
    const population = [];
    for (const r of rows) {
        if (office) {
            population.push(r);
            continue;
        }
        const d = await (0, workOrderRecordRead_1.authorizeWorkOrderRecordRead)(deps.reader, caller.operational, String(r.id));
        if (d.allowed)
            population.push(r);
    }
    const volume = {};
    let completed = 0;
    let parts = 0;
    let valid = 0;
    let inverted = 0;
    let missing = 0;
    let totalMs = 0;
    for (const r of population) {
        volume[r.status] = (volume[r.status] ?? 0) + 1;
        parts += Number(r.parts_used);
        const done = r.completed_at !== null && r.completed_at !== undefined;
        if (done)
            completed += 1;
        const started = r.work_started_at === null || r.work_started_at === undefined ? NaN : new Date(r.work_started_at).getTime();
        const ended = done ? new Date(r.completed_at).getTime() : NaN;
        if (Number.isFinite(started) && Number.isFinite(ended)) {
            const ms = ended - started;
            if (ms < 0)
                inverted += 1;
            else {
                valid += 1;
                totalMs += ms;
            }
        }
        else if (done) {
            missing += 1;
        }
    }
    const sortedVolume = Object.fromEntries(Object.entries(volume).sort(([a], [b]) => a.localeCompare(b)));
    return Object.freeze({
        employeeId,
        displayName: personName(emp.rows[0]),
        totalWorkOrdersCompleted: completed,
        totalPartsConsumed: parts,
        averageCompletionTimeMs: inverted > 0 || valid === 0 ? null : totalMs / valid,
        completionEvidence: Object.freeze({ valid, inverted, missing }),
        workOrderVolumeByStatus: Object.freeze(sortedVolume),
    });
};
exports.readTechnicianExecutionStats = readTechnicianExecutionStats;
/**
 * Recorded actuals per Part across the active set (getInventoryConsumptionSnapshot): the total used, and on how many
 * Work Orders. Sorted most-consumed first; ties by partId so the order is stable (Firestore document order, which
 * broke ties before, is not a fact PostgreSQL has).
 */
const readWorkOrderConsumptionSnapshot = async (deps, caller, input) => {
    requireOfficeRead(caller.actor.capabilities, "the consumption snapshot");
    only(input, []);
    const { rows } = await deps.pool.query(`SELECT u.part_id, SUM(u.qty_used)::bigint AS total, COUNT(*)::int AS frequency
       FROM (${ACTUALS_BY_WORK_ORDER_PART}) u
       JOIN ${SCHEMA}.work_orders w ON w.tenant_id = u.tenant_id AND w.id = u.work_order_id
      WHERE u.tenant_id = $1 AND ${activeWorkOrderPredicate("w")}
      GROUP BY u.part_id
      ORDER BY SUM(u.qty_used) DESC, u.part_id`, [caller.actor.tenantId]);
    const parts = rows.map((r) => Object.freeze({
        partId: String(r.part_id), totalQuantityUsed: Number(r.total), frequency: Number(r.frequency),
    }));
    return Object.freeze({
        parts: Object.freeze(parts),
        mostConsumedPartId: parts[0]?.partId ?? null,
        basis: "RECORDED_EXECUTION_ACTUALS",
    });
};
exports.readWorkOrderConsumptionSnapshot = readWorkOrderConsumptionSnapshot;
/**
 * Per assigned Employee across the active set (getTechnicianVolumeBreakdown): completed (completed_at set) and
 * not-completed counts. Unassigned Work Orders are not counted. Busiest (most completed) first; ties by employeeId.
 */
const readTechnicianVolumeBreakdown = async (deps, caller, input) => {
    requireOfficeRead(caller.actor.capabilities, "the technician volume breakdown");
    only(input, []);
    const { rows } = await deps.pool.query(`SELECT a.assignee_employee_id AS employee_id, e.preferred_name, e.display_name, e.first_name, e.last_name,
            COUNT(*) FILTER (WHERE w.completed_at IS NULL)::int AS active_count,
            COUNT(*) FILTER (WHERE w.completed_at IS NOT NULL)::int AS completed_count
       FROM ${SCHEMA}.work_orders w
       JOIN ${SCHEMA}.work_order_assignments a
         ON a.tenant_id = w.tenant_id AND a.work_order_id = w.id AND a.effective_to IS NULL
       LEFT JOIN eos_workforce.employees e ON e.tenant_id = a.tenant_id AND e.id = a.assignee_employee_id
      WHERE w.tenant_id = $1 AND ${activeWorkOrderPredicate("w")}
      GROUP BY a.assignee_employee_id, e.preferred_name, e.display_name, e.first_name, e.last_name
      ORDER BY completed_count DESC, a.assignee_employee_id`, [caller.actor.tenantId]);
    return Object.freeze({
        items: Object.freeze(rows.map((r) => Object.freeze({
            employeeId: String(r.employee_id), displayName: personName(r),
            activeCount: Number(r.active_count), completedCount: Number(r.completed_count),
        }))),
    });
};
exports.readTechnicianVolumeBreakdown = readTechnicianVolumeBreakdown;
//# sourceMappingURL=workOrderAnalytics.js.map