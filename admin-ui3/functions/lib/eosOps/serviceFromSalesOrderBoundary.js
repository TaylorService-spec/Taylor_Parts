"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServiceBoundaryError = exports.SERVICEABLE_SALES_ORDER_STATES = exports.SALES_ORDER_LINE_KINDS = exports.SALES_ORDER_SERVICE = void 0;
exports.readSalesOrderHandoff = readSalesOrderHandoff;
exports.buildServiceWorkOrderSeed = buildServiceWorkOrderSeed;
/** Already in the Role catalog; this boundary does not invent a capability. */
exports.SALES_ORDER_SERVICE = "salesOrder.service";
/** The line kinds eos_commercial.sales_order_lines can carry. */
exports.SALES_ORDER_LINE_KINDS = Object.freeze(["EQUIPMENT_MODEL", "PART", "SERVICE"]);
/**
 * The states a Sales Order may raise service from.
 *
 * CANCELLED and CLOSED are excluded for the reason the parts-plan terminal rule gives: dispatching a
 * technician for an order that is finished or called off is not a handoff, it is a mistake with a van.
 */
exports.SERVICEABLE_SALES_ORDER_STATES = Object.freeze([
    "CONFIRMED", "IN_FULFILLMENT", "FULFILLED",
]);
class ServiceBoundaryError extends Error {
    code;
    category;
    constructor(code, category, message) {
        super(message);
        this.code = code;
        this.category = category;
        this.name = "ServiceBoundaryError";
    }
}
exports.ServiceBoundaryError = ServiceBoundaryError;
const refuse = (code, category, message) => {
    throw new ServiceBoundaryError(code, category, message);
};
const ID_SHAPE = (v) => typeof v === "string" && v !== "" && v.trim() === v && v.length <= 200 && !v.includes("/");
/**
 * Read one Sales Order's handoff from PostgreSQL Commercial, on the caller's client.
 *
 * DIRECT COMPOSITION, not a bridge: same database, same runtime, same transaction as whatever the caller
 * goes on to write, so the Work Order cannot be created from a Sales Order that changed underneath it.
 */
async function readSalesOrderHandoff(db, tenantId, salesOrderId) {
    if (!ID_SHAPE(tenantId) || !ID_SHAPE(salesOrderId)) {
        refuse("INPUT_INVALID", "INVALID_INPUT", "a Sales Order is only readable by id within a tenant");
    }
    const order = await db.query(`SELECT id, sales_order_number, state::text AS state, account_id, location_id, operating_company_key
       FROM eos_commercial.sales_orders
      WHERE tenant_id = $1 AND id = $2`, [tenantId, salesOrderId]);
    if (order.rows.length === 0) {
        refuse("SALES_ORDER_NOT_FOUND", "NOT_FOUND", `no sales order ${salesOrderId} in this tenant`);
    }
    const o = order.rows[0];
    const lines = await db.query(`SELECT line_number, kind::text AS kind, ref, ordered_qty
       FROM eos_commercial.sales_order_lines
      WHERE tenant_id = $1 AND sales_order_id = $2
      ORDER BY line_number`, [tenantId, salesOrderId]);
    return Object.freeze({
        salesOrderId: String(o.id),
        salesOrderNumber: String(o.sales_order_number),
        state: o.state === null || o.state === undefined ? null : String(o.state),
        accountId: String(o.account_id),
        locationId: o.location_id === null || o.location_id === undefined ? null : String(o.location_id),
        operatingCompanyKey: String(o.operating_company_key),
        lines: Object.freeze(lines.rows.map((r) => Object.freeze({
            lineNumber: Number(r.line_number),
            kind: String(r.kind),
            ref: String(r.ref),
            orderedQty: Number(r.ordered_qty),
        }))),
    });
}
/**
 * Compute the service Work Order seed for a Sales Order. PURE -- no database, no writes.
 *
 * `partPolicies` is the Catalog's answer for every PART line's ref, from the PostgreSQL Part policy
 * authority. It is passed in rather than fetched so this stays pure and so the Part facts and the Sales
 * Order facts come from the SAME transaction as the caller's write.
 */
function buildServiceWorkOrderSeed(handoff, partPolicies) {
    if (handoff.state !== null && !exports.SERVICEABLE_SALES_ORDER_STATES.includes(handoff.state)) {
        refuse("SALES_ORDER_NOT_SERVICEABLE", "PRECONDITION_FAILED", `a ${handoff.state} sales order cannot raise service`);
    }
    // work_orders.location_id is NOT NULL, and PostgreSQL sales_orders.location_id is nullable. An unsited
    // order cannot become a visit: refusing is the only honest answer, because there is nowhere to send anyone.
    if (!ID_SHAPE(handoff.locationId)) {
        refuse("SALES_ORDER_HAS_NO_LOCATION", "PRECONDITION_FAILED", `sales order ${handoff.salesOrderId} has no service location; a Work Order must have somewhere to go`);
    }
    const partLines = handoff.lines.filter((l) => l.kind === "PART");
    const byRef = new Map(partPolicies.map((p) => [p.partId, p]));
    for (const line of partLines) {
        const policy = byRef.get(line.ref);
        // Fail closed on identity, exactly as the legacy seam does: never fabricate a Part.
        if (!policy || !policy.found) {
            refuse("PART_NOT_FOUND", "NOT_FOUND", `sales order line ${line.lineNumber} references part ${line.ref}, which is not a Part of this tenant's catalog`);
        }
    }
    // THE GATE. Not "allocation has not run" -- the authority that would run it does not exist here.
    if (partLines.length > 0) {
        refuse("ALLOCATION_AUTHORITY_UNAVAILABLE", "UNAVAILABLE", `sales order ${handoff.salesOrderId} has ${partLines.length} PART line(s), and PostgreSQL Commercial carries no `
            + "allocated quantity (a D2 execution field). Seeding a parts plan from ordered quantity would plan "
            + "unbacked demand, so service from a Sales Order with PART lines is refused until the allocation authority exists");
    }
    return Object.freeze({
        salesOrderId: handoff.salesOrderId,
        customerId: handoff.accountId,
        locationId: handoff.locationId,
        complaint: `Service for Sales Order ${handoff.salesOrderNumber}`,
        lineRefs: Object.freeze(handoff.lines.map((l) => Object.freeze({
            salesOrderId: handoff.salesOrderId,
            salesOrderLineId: String(l.lineNumber),
        }))),
        // Empty by construction while the gate above stands. Stated rather than omitted so the shape of the
        // finished handoff is visible and testable now.
        plannedParts: Object.freeze([]),
    });
}
//# sourceMappingURL=serviceFromSalesOrderBoundary.js.map