"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readWorkOrderReadiness = exports.WORK_ORDER_READINESS_LIMITATIONS = void 0;
const workOrderFieldContext_1 = require("./workOrderFieldContext");
exports.WORK_ORDER_READINESS_LIMITATIONS = Object.freeze([
    "INVENTORY_BALANCE_NOT_YET_ACTIVATED",
    "RESERVATION_NOT_YET_ACTIVATED",
    "TRUCK_INVENTORY_UNAVAILABLE",
    "PROCUREMENT_SOURCE_UNAVAILABLE",
]);
async function assembleReadiness(deps, actor, input) {
    const { workOrderId, row } = await (0, workOrderFieldContext_1.readAuthorizedWorkOrderRow)(deps, actor, input);
    const lines = await (0, workOrderFieldContext_1.readPlannedPartLines)(deps, actor, workOrderId);
    const plannedParts = lines.filter((l) => l.qtyPlanned > 0).map((l) => Object.freeze({
        partId: l.partId,
        name: l.name,
        sku: l.internalPartNumber,
        catalog: l.catalog,
        qtyPlanned: l.qtyPlanned,
        qtyUsed: l.qtyUsed,
        reservedForJob: null,
        warehouse: Object.freeze({ status: "UNAVAILABLE" }),
        truck: Object.freeze({ status: "UNAVAILABLE" }),
        procurement: Object.freeze({ status: "UNAVAILABLE" }),
    }));
    return Object.freeze({
        schemaVersion: 1,
        workOrderId,
        subject: Object.freeze({
            workOrderId,
            reference: row.work_order_number ?? workOrderId,
            status: String(row.status),
            customerName: row.acct_name ?? null,
        }),
        plannedParts: Object.freeze(plannedParts),
        capabilities: Object.freeze({ warehouse: false, truckInventory: false, purchasing: false, requestReorder: false }),
        sources: Object.freeze({
            workOrder: "AVAILABLE",
            customer: "AVAILABLE",
            catalog: "AVAILABLE",
            inventory: "NOT_YET_ACTIVATED",
            truckInventory: "NOT_YET_ACTIVATED",
            // Not read by this context (Firebase parity), which is not the same as "no procurement exists".
            procurement: "UNAVAILABLE",
        }),
        inventory: workOrderFieldContext_1.INVENTORY_NOT_YET_ACTIVATED,
        limitations: exports.WORK_ORDER_READINESS_LIMITATIONS,
    });
}
/** readWorkOrderReadiness: the readiness source dimensions for ONE Work Order, behind the entitled record read. */
const readWorkOrderReadiness = (deps, caller, input) => assembleReadiness({ pool: deps.pool, reader: deps.reader }, caller.operational, (input ?? {}));
exports.readWorkOrderReadiness = readWorkOrderReadiness;
//# sourceMappingURL=workOrderReadiness.js.map