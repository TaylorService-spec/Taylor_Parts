"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WORK_ORDER_QUARANTINED_MESSAGE = exports.WORK_ORDER_QUARANTINED = void 0;
exports.notQuarantined = notQuarantined;
exports.isQuarantined = isQuarantined;
exports.WORK_ORDER_QUARANTINED = "WORK_ORDER_QUARANTINED";
exports.WORK_ORDER_QUARANTINED_MESSAGE = "this Work Order is quarantined (a pinned OBSOLETE/BAD_COPY migrated record) and is preserved for migration evidence only";
/** SQL: the Work Order aliased `alias` is NOT quarantined. */
function notQuarantined(alias) {
    if (!/^[a-z_][a-z0-9_]*$/.test(alias))
        throw new Error("notQuarantined: alias must be a plain SQL identifier");
    return `NOT EXISTS (SELECT 1 FROM eos_ops.work_order_quarantine wq WHERE wq.tenant_id = ${alias}.tenant_id AND wq.work_order_id = ${alias}.id)`;
}
/** Is this Work Order quarantined? The CALLER refuses with its own governed error class and WORK_ORDER_QUARANTINED. */
async function isQuarantined(db, tenantId, workOrderId) {
    const { rows } = await db.query(`SELECT 1 FROM eos_ops.work_order_quarantine WHERE tenant_id = $1 AND work_order_id = $2`, [tenantId, workOrderId]);
    return rows.length > 0;
}
//# sourceMappingURL=workOrderQuarantine.js.map