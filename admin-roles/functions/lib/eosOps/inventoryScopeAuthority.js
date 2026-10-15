"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TRANSFER_ACT_SCOPE_END = exports.TRANSFER_ACTS = exports.InventoryScopeError = void 0;
exports.resolveScopeLocation = resolveScopeLocation;
exports.requiredTransferScope = requiredTransferScope;
class InventoryScopeError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "InventoryScopeError";
    }
}
exports.InventoryScopeError = InventoryScopeError;
/** Resolve one inventory location to the warehouse whose scope governs it. Fails closed; never guesses. */
async function resolveScopeLocation(db, tenantId, ref) {
    if (ref.type === "WAREHOUSE") {
        const { rows } = await db.query(`SELECT status::text AS status, operating_company_key FROM eos_ops.warehouses WHERE tenant_id = $1 AND id = $2`, [tenantId, ref.locationId]);
        if (!rows[0])
            throw new InventoryScopeError("LOCATION_NOT_FOUND", "no warehouse with that id");
        return { type: "WAREHOUSE", locationId: ref.locationId, scopeWarehouseId: ref.locationId,
            operatingCompanyKey: rows[0].operating_company_key, active: rows[0].status === "ACTIVE" };
    }
    if (ref.type === "BIN") {
        const { rows } = await db.query(`SELECT b.status::text AS bin_status, b.warehouse_id, w.status::text AS warehouse_status, w.operating_company_key
         FROM eos_ops.bins b JOIN eos_ops.warehouses w ON w.tenant_id = b.tenant_id AND w.id = b.warehouse_id
        WHERE b.tenant_id = $1 AND b.id = $2`, [tenantId, ref.locationId]);
        if (!rows[0])
            throw new InventoryScopeError("LOCATION_NOT_FOUND", "no bin with that id");
        const r = rows[0];
        return { type: "BIN", locationId: ref.locationId, scopeWarehouseId: r.warehouse_id, operatingCompanyKey: r.operating_company_key,
            active: r.bin_status === "ACTIVE" && r.warehouse_status === "ACTIVE" };
    }
    if (ref.type === "MOBILE") {
        const { rows: loc } = await db.query(`SELECT active, operating_company_key FROM eos_ops.mobile_locations
        WHERE tenant_id = $1 AND location_type = 'MOBILE' AND location_id = $2`, [tenantId, ref.locationId]);
        if (!loc[0])
            throw new InventoryScopeError("LOCATION_NOT_FOUND", "no truck location with that id");
        const { rows: bound } = await db.query(`SELECT warehouse_id FROM eos_ops.mobile_location_scope_bindings
        WHERE tenant_id = $1 AND location_type = 'MOBILE' AND location_id = $2 AND effective_to IS NULL`, [tenantId, ref.locationId]);
        if (!bound[0]) {
            throw new InventoryScopeError("MOBILE_SCOPE_BINDING_MISSING", "this truck location has no governed warehouse scope binding, so no one's warehouse scope reaches it");
        }
        return { type: "MOBILE", locationId: ref.locationId, scopeWarehouseId: bound[0].warehouse_id,
            operatingCompanyKey: loc[0].operating_company_key, active: loc[0].active === true };
    }
    throw new InventoryScopeError("LOCATION_TYPE_INVALID", "location type must be WAREHOUSE, BIN or MOBILE");
}
// ════════════════════ Transfer: which end each act is scoped by ════════════════════
exports.TRANSFER_ACTS = Object.freeze(["create", "cancel", "dispatch", "receive", "putAway"]);
/** DQ-024: the ORIGIN for initiate/remove/ship, the DESTINATION for receive/put-away. Exactly one end each. */
exports.TRANSFER_ACT_SCOPE_END = Object.freeze({
    create: "ORIGIN",
    cancel: "ORIGIN",
    dispatch: "ORIGIN",
    receive: "DESTINATION",
    putAway: "DESTINATION",
});
/**
 * The warehouse scope a Transfer act requires: resolve ONLY the end the act works on. The other end is
 * not resolved at all -- so a missing binding on the far end neither blocks nor grants anything.
 */
async function requiredTransferScope(db, tenantId, act, transfer) {
    const end = exports.TRANSFER_ACT_SCOPE_END[act];
    if (!end)
        throw new InventoryScopeError("LOCATION_TYPE_INVALID", `unknown transfer act ${String(act)}`);
    return resolveScopeLocation(db, tenantId, end === "ORIGIN" ? transfer.origin : transfer.destination);
}
//# sourceMappingURL=inventoryScopeAuthority.js.map