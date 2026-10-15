"use strict";
// Sales Order — PURE governed write core (framework-independent; unit-tested). Builds the field maps the
// callable persists; enforces the ratified invariants. No Firestore/firebase-functions imports.
//
// INVARIANTS: product-level lines only (a serialized-asset reference is FORBIDDEN — assigned at fulfillment);
// quantity model orderedQty >= allocatedQty >= fulfilledQty >= 0; canonical refs reused (accountId,
// ownerEmployeeId, salesChannel, locationId?, sourceOpportunityId?); `unitPrice` is an OPTIONAL passive
// pricing SNAPSHOT — this command invents no pricing/discount/tax authority. Created CONFIRMED.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SalesOrderCommandError = void 0;
exports.buildCreateSalesOrder = buildCreateSalesOrder;
exports.buildTransitionPatch = buildTransitionPatch;
const salesOrderLifecycle_1 = require("./salesOrderLifecycle");
class SalesOrderCommandError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "SalesOrderCommandError";
    }
}
exports.SalesOrderCommandError = SalesOrderCommandError;
const nonEmpty = (v) => typeof v === "string" && v.trim().length > 0;
const finiteNum = (v) => typeof v === "number" && Number.isFinite(v);
const posInt = (v) => finiteNum(v) && v > 0 && Number.isInteger(v);
// Validate + normalize one line. The ONE identity mistake that corrupts commercial↔physical separation is a
// serialized-asset reference on a line — reject it. Quantities initialize allocated/fulfilled to 0.
function validateLine(line, index) {
    if (!line || typeof line !== "object")
        throw new SalesOrderCommandError("LINE_INVALID", `Line ${index} is not an object`);
    const l = line;
    if (!salesOrderLifecycle_1.SALES_ORDER_LINE_KINDS.includes(l.kind)) {
        throw new SalesOrderCommandError("LINE_INVALID", `Line ${index} has an invalid kind`);
    }
    if ("serial" in l || "serialNumber" in l || "serializedAssetId" in l || "equipmentId" in l) {
        throw new SalesOrderCommandError("SERIALIZED_LINE_FORBIDDEN", `Line ${index} references a serialized asset; Sales Order lines are product-level (serialized assets are assigned at fulfillment)`);
    }
    if (!nonEmpty(l.ref))
        throw new SalesOrderCommandError("LINE_INVALID", `Line ${index} is missing a product reference`);
    if (!posInt(l.orderedQty))
        throw new SalesOrderCommandError("QTY_INVALID", `Line ${index} orderedQty must be a positive integer`);
    if (l.unitPrice !== undefined && !finiteNum(l.unitPrice)) {
        throw new SalesOrderCommandError("LINE_INVALID", `Line ${index} unitPrice must be a number when present`);
    }
    const out = {
        lineId: `line-${index + 1}`,
        kind: l.kind,
        ref: l.ref.trim(),
        orderedQty: l.orderedQty,
        allocatedQty: 0,
        fulfilledQty: 0,
        billedQty: 0,
    };
    if (l.unitPrice !== undefined)
        out.unitPrice = l.unitPrice;
    return out;
}
// Build a NEW Sales Order (CONFIRMED = the commercial commitment following a WON Opportunity). Reuses
// canonical refs; never assigns serialized assets. `actorUid`/`nowMillis` come from the callable.
function buildCreateSalesOrder(input, ctx) {
    if (!input || typeof input !== "object")
        throw new SalesOrderCommandError("INVALID", "Missing input");
    if (!nonEmpty(input.accountId))
        throw new SalesOrderCommandError("ACCOUNT_REQUIRED", "accountId is required");
    if (!nonEmpty(input.ownerEmployeeId))
        throw new SalesOrderCommandError("OWNER_REQUIRED", "ownerEmployeeId (canonical Employee) is required");
    if (!(0, salesOrderLifecycle_1.isSalesChannel)(input.salesChannel))
        throw new SalesOrderCommandError("CHANNEL_INVALID", "salesChannel is invalid");
    if (!Array.isArray(input.lines) || input.lines.length === 0)
        throw new SalesOrderCommandError("NO_LINES", "A Sales Order requires at least one line");
    const lines = input.lines.map((l, i) => validateLine(l, i));
    return {
        accountId: input.accountId.trim(),
        ownerEmployeeId: input.ownerEmployeeId.trim(),
        salesChannel: input.salesChannel,
        currency: "USD",
        locationId: nonEmpty(input.locationId) ? input.locationId.trim() : null,
        sourceOpportunityId: nonEmpty(input.sourceOpportunityId) ? input.sourceOpportunityId.trim() : null,
        customerPO: nonEmpty(input.customerPO) ? input.customerPO.trim() : null,
        notes: nonEmpty(input.notes) ? input.notes.trim() : null,
        state: "CONFIRMED",
        lines,
        createdByUid: ctx.actorUid,
        createdAtMillis: ctx.nowMillis,
        updatedAtMillis: ctx.nowMillis,
    };
}
// Build the field patch for a lifecycle transition, after validating legality (FULFILLED requires every line
// fully fulfilled). Throws fail-closed on any illegal transition; the callable maps the code to an HttpsError.
function buildTransitionPatch(current, transition, ctx) {
    if (!current || !(0, salesOrderLifecycle_1.isSalesOrderState)(current.state))
        throw new SalesOrderCommandError("INVALID", "Invalid current state");
    const fulfilledAll = (0, salesOrderLifecycle_1.allLinesFulfilled)(Array.isArray(current.lines) ? current.lines : []);
    const check = (0, salesOrderLifecycle_1.checkTransition)(current.state, transition, { allLinesFulfilled: fulfilledAll });
    if (!check.ok) {
        const msg = check.code === "TERMINAL"
            ? "Sales Order is closed or cancelled"
            : check.code === "NOT_FULFILLABLE"
                ? "Cannot mark FULFILLED while quantity remains unfulfilled"
                : check.code === "ILLEGAL_TRANSITION"
                    ? "Illegal Sales Order transition"
                    : "Invalid transition";
        throw new SalesOrderCommandError(check.code, msg);
    }
    return { state: check.to, updatedByUid: ctx.actorUid, updatedAtMillis: ctx.nowMillis };
}
//# sourceMappingURL=salesOrderCommands.js.map