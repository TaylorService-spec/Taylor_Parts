"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSalesDiscountAuthorityOperation = exports.SALES_DISCOUNT_AUTHORITY_OPERATIONS = void 0;
exports.discountAuthorityOf = discountAuthorityOf;
exports.discountWithinAuthority = discountWithinAuthority;
exports.createSalesDiscountAuthorityAdministration = createSalesDiscountAuthorityAdministration;
const node_crypto_1 = require("node:crypto");
const configurationOperations_1 = require("../adminPolicy/configurationOperations");
exports.SALES_DISCOUNT_AUTHORITY_OPERATIONS = Object.freeze(["listSalesDiscountAuthorities", "setSalesDiscountAuthority"]);
const isSalesDiscountAuthorityOperation = (op) => exports.SALES_DISCOUNT_AUTHORITY_OPERATIONS.includes(op);
exports.isSalesDiscountAuthorityOperation = isSalesDiscountAuthorityOperation;
/** The actor's discount authority, read inside the caller's transaction. */
async function discountAuthorityOf(db, tenantId, principalId) {
    const { rows } = await db.query(`SELECT max_discount_basis_points FROM eos_commercial.sales_discount_authorities WHERE tenant_id = $1 AND principal_id = $2`, [tenantId, principalId]);
    return rows[0] ? { state: "CONFIGURED", maxBasisPoints: Number(rows[0].max_discount_basis_points) } : { state: "NOT_CONFIGURED" };
}
/**
 * Does `authority` admit a discount of `discountMinor` against the pre-discount `sellingMinor` (or, for a percentage, its
 * basis points)? Integer arithmetic only: amount * 10000 <= max * selling. A fixed amount against an undetermined selling
 * price cannot be measured, so it is not admitted (fail closed).
 */
function discountWithinAuthority(authority, discount) {
    if (authority.state !== "CONFIGURED" || authority.maxBasisPoints === 0)
        return false;
    if (discount.basisPoints !== undefined)
        return discount.basisPoints <= authority.maxBasisPoints;
    if (discount.amountMinor === undefined || discount.sellingMinor === null || discount.sellingMinor === undefined || discount.sellingMinor <= 0)
        return false;
    return BigInt(discount.amountMinor) * 10000n <= BigInt(authority.maxBasisPoints) * BigInt(discount.sellingMinor);
}
const refuse = (code, category, message) => {
    throw new configurationOperations_1.ConfigurationRefusal(code, category, message);
};
const only = (i, allowed) => {
    for (const k of Object.keys(i))
        if (!allowed.includes(k))
            refuse("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `not accepted: ${k}`);
};
async function listSalesDiscountAuthorities(pool, actor, i) {
    only(i, []);
    const { rows } = await pool.query(`SELECT m.principal_id, p.display_name, a.max_discount_basis_points, a.updated_by, a.updated_at
       FROM eos_policy.tenant_memberships m JOIN eos_policy.principals p ON p.id = m.principal_id
       LEFT JOIN eos_commercial.sales_discount_authorities a ON a.tenant_id = m.tenant_id AND a.principal_id = m.principal_id
      WHERE m.tenant_id = $1 AND m.status = 'active' ORDER BY p.display_name NULLS LAST, m.principal_id`, [actor.tenantId]);
    return Object.freeze({ items: rows.map((r) => Object.freeze(r.max_discount_basis_points === null
            ? { principalId: r.principal_id, displayName: r.display_name ?? null, state: "NOT_CONFIGURED", maxDiscountBasisPoints: null }
            : { principalId: r.principal_id, displayName: r.display_name ?? null, state: "CONFIGURED", maxDiscountBasisPoints: Number(r.max_discount_basis_points),
                updatedBy: r.updated_by, updatedAt: new Date(r.updated_at).toISOString() })) });
}
async function setSalesDiscountAuthority(pool, actor, i, reason) {
    only(i, ["principalId", "maxDiscountBasisPoints"]);
    if (typeof reason !== "string" || reason.trim() === "")
        refuse("REASON_REQUIRED", "INVALID_INPUT", "a discount authority change states its reason");
    if (typeof i.principalId !== "string" || i.principalId.trim() === "")
        refuse("INVALID_INPUT", "INVALID_INPUT", "principalId is required");
    const bp = i.maxDiscountBasisPoints;
    if (!Number.isSafeInteger(bp) || bp < 0 || bp > 10000) {
        refuse("DISCOUNT_AUTHORITY_INVALID", "INVALID_INPUT", "maxDiscountBasisPoints is a whole number of basis points, 0 (no discount authority) to 10000 (100%)");
    }
    const principalId = i.principalId.trim();
    const c = await pool.connect();
    try {
        await c.query("BEGIN");
        const { rowCount } = await c.query(`SELECT 1 FROM eos_policy.tenant_memberships WHERE tenant_id = $1 AND principal_id = $2 AND status = 'active'`, [actor.tenantId, principalId]);
        if (!rowCount)
            refuse("PRINCIPAL_NOT_FOUND", "NOT_FOUND", "the Sales user is not an active member of this tenant");
        const { rows: before } = await c.query(`SELECT max_discount_basis_points FROM eos_commercial.sales_discount_authorities WHERE tenant_id = $1 AND principal_id = $2 FOR UPDATE`, [actor.tenantId, principalId]);
        const previous = before[0] ? Number(before[0].max_discount_basis_points) : null;
        await c.query(`INSERT INTO eos_commercial.sales_discount_authorities (tenant_id, principal_id, max_discount_basis_points, updated_by) VALUES ($1,$2,$3,$4)
      ON CONFLICT (tenant_id, principal_id) DO UPDATE SET max_discount_basis_points = EXCLUDED.max_discount_basis_points, updated_by = EXCLUDED.updated_by, updated_at = now()`, [actor.tenantId, principalId, bp, actor.principalId]);
        await c.query(`INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at, reason)
                   VALUES ($1,$2,'sales.discountAuthority.set',$3,'sales_discount_authority',$4,$5::jsonb,$6::jsonb,now(),$7)`, [`audit_${(0, node_crypto_1.randomUUID)()}`, actor.tenantId, actor.principalId, principalId,
            JSON.stringify(previous === null ? { state: "NOT_CONFIGURED" } : { state: "CONFIGURED", maxDiscountBasisPoints: previous }),
            JSON.stringify({ state: "CONFIGURED", maxDiscountBasisPoints: bp }), reason.trim()]);
        await c.query("COMMIT");
        return Object.freeze({ principalId, previousMaxDiscountBasisPoints: previous, maxDiscountBasisPoints: bp });
    }
    catch (err) {
        await c.query("ROLLBACK").catch(() => undefined);
        throw err;
    }
    finally {
        c.release();
    }
}
function createSalesDiscountAuthorityAdministration(pool) {
    return async (operation, actor, input, reason) => {
        const { reason: _stated, ...i } = input && typeof input === "object" && !Array.isArray(input) ? input : {};
        void _stated;
        switch (operation) {
            case "listSalesDiscountAuthorities": return listSalesDiscountAuthorities(pool, actor, i);
            case "setSalesDiscountAuthority": return setSalesDiscountAuthority(pool, actor, i, reason);
            default: throw new Error(`not a sales discount authority operation: ${String(operation)}`);
        }
    };
}
//# sourceMappingURL=salesDiscountAuthority.js.map