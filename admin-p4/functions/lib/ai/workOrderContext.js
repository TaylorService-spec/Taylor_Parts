"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertWorkOrderContextReadable = assertWorkOrderContextReadable;
exports.resolveWorkOrderContextAccess = resolveWorkOrderContextAccess;
exports.sanitizeWorkOrderFacts = sanitizeWorkOrderFacts;
const types_1 = require("./types");
const partBalanceReadService_1 = require("../inventory/partBalanceReadService");
/**
 * Prove the caller may read this Work Order under the same predicate as firestore.rules.
 * Throws before downstream context sources are consulted.
 */
function assertWorkOrderContextReadable(actor, workOrder) {
    if (!actor.authenticated) {
        throw new types_1.AIError("AI_CAPABILITY_DENIED", "The caller is not authorized to read this Work Order.");
    }
    if (actor.role === "admin" || actor.role === "dispatcher")
        return;
    if (actor.role === "technician"
        && typeof actor.technicianId === "string"
        && actor.technicianId.length > 0
        && typeof workOrder.assignedTechId === "string"
        && workOrder.assignedTechId === actor.technicianId)
        return;
    throw new types_1.AIError("AI_CAPABILITY_DENIED", "The caller is not authorized to read this Work Order.");
}
/**
 * Compose source-level authority after Work Order visibility is proven.
 *
 * Crucial rule: reading a Work Order does NOT grant inventory.balance.read. If the caller lacks that
 * existing capability, balance facts are omitted and the downstream readiness projection remains
 * UNKNOWN. AI is not an authority amplifier.
 */
function resolveWorkOrderContextAccess(params) {
    assertWorkOrderContextReadable(params.actor, params.workOrder);
    const inventoryBalanceReadable = params.capabilityDecisions?.[partBalanceReadService_1.INVENTORY_BALANCE_READ_CAPABILITY] === true;
    return Object.freeze({
        workOrderReadable: true,
        inventoryBalanceReadable,
        limitations: Object.freeze(inventoryBalanceReadable ? [] : ["INVENTORY_BALANCE_NOT_AUTHORIZED"]),
    });
}
/**
 * Model-safe/source-safe projection of the Work Order itself.
 *
 * Raw Firestore ids are intentionally absent. The internal assembler may use partId/customerId/etc.
 * to join governed sources, but those join keys do not cross the intelligence boundary merely
 * because they were useful to the server.
 */
function sanitizeWorkOrderFacts(workOrder) {
    const snapshot = Array.isArray(workOrder.inventorySnapshot)
        ? workOrder.inventorySnapshot
        : [];
    return Object.freeze({
        schemaVersion: 1,
        subject: Object.freeze({
            type: "WORK_ORDER",
            reference: cleanString(workOrder.woNumber),
            status: cleanString(workOrder.status),
            typeLabel: cleanString(workOrder.type),
            priority: cleanString(workOrder.priority),
        }),
        partsPlan: Object.freeze(snapshot
            .filter((line) => positiveNumber(line.qtyPlanned) > 0)
            .map((line) => Object.freeze({
            name: cleanString(line.name),
            sku: cleanString(line.sku),
            qtyPlanned: positiveNumber(line.qtyPlanned),
        }))),
    });
}
function cleanString(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function positiveNumber(value) {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}
//# sourceMappingURL=workOrderContext.js.map