"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SyntheticAcceptanceWarehouseError = exports.FORBIDDEN_WAREHOUSE_IDS = exports.SYNTHETIC_ACCEPTANCE_PROVENANCE = exports.SYNTHETIC_ACCEPTANCE_WAREHOUSE = void 0;
exports.establishSyntheticAcceptanceWarehouse = establishSyntheticAcceptanceWarehouse;
const node_crypto_1 = require("node:crypto");
const warehouseBinRepository_1 = require("./warehouseBinRepository");
exports.SYNTHETIC_ACCEPTANCE_WAREHOUSE = Object.freeze({
    warehouseId: "synthetic-np-wh-taylor-acceptance",
    operatingCompanyKey: "taylor",
    name: "SYNTHETIC Taylor Acceptance Proof Warehouse (fixture)",
    siteLabel: "SYNTHETIC nonprod acceptance proof -- not a real site",
    status: "ACTIVE",
    provenance: "NATIVE",
});
exports.SYNTHETIC_ACCEPTANCE_PROVENANCE = "NONPROD_SYNTHETIC_ACCEPTANCE";
/** The ids the ruling forbids this warehouse from being or claiming. */
exports.FORBIDDEN_WAREHOUSE_IDS = Object.freeze(["wh-main", "wh-north", "SC-WH-MAIN", "SC-WH-SERVICE"]);
class SyntheticAcceptanceWarehouseError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "SyntheticAcceptanceWarehouseError";
    }
}
exports.SyntheticAcceptanceWarehouseError = SyntheticAcceptanceWarehouseError;
async function preflight(db, tenantId) {
    const w = exports.SYNTHETIC_ACCEPTANCE_WAREHOUSE;
    if (exports.FORBIDDEN_WAREHOUSE_IDS.includes(w.warehouseId))
        throw new SyntheticAcceptanceWarehouseError("FORBIDDEN_IDENTITY", "the pinned id is a forbidden warehouse identity");
    const anyTenant = (await db.query(`SELECT tenant_id FROM eos_ops.warehouses WHERE id = $1`, [w.warehouseId])).rows;
    let existing = "ABSENT";
    if (anyTenant.length > 0) {
        const mine = await (0, warehouseBinRepository_1.readWarehouse)(db, tenantId, w.warehouseId);
        const exact = anyTenant.length === 1 && mine !== null && mine.operatingCompanyKey === w.operatingCompanyKey && mine.name === w.name &&
            mine.siteLabel === w.siteLabel && mine.status === w.status && mine.provenance === w.provenance;
        if (!exact)
            throw new SyntheticAcceptanceWarehouseError("IDENTITY_OCCUPIED", "the pinned warehouse id is occupied by a record that is not the pinned synthetic warehouse");
        existing = "PRESENT_EXACT";
    }
    const columns = (await db.query(`SELECT table_schema, table_name, column_name FROM information_schema.columns
      WHERE table_schema LIKE 'eos\\_%' AND data_type IN ('text', 'character varying')
        AND (column_name LIKE '%warehouse_id' OR column_name IN ('location_id', 'scope_id', 'scope_value'))
        AND NOT (table_schema = 'eos_ops' AND table_name = 'warehouses')
      ORDER BY 1, 2, 3`)).rows;
    let referencingRows = 0;
    for (const c of columns) {
        const r = await db.query(`SELECT count(*)::int AS n FROM "${c.table_schema}"."${c.table_name}" WHERE "${c.column_name}" = $1`, [w.warehouseId]);
        referencingRows += r.rows[0].n;
    }
    if (existing === "ABSENT" && referencingRows > 0) {
        throw new SyntheticAcceptanceWarehouseError("IDENTITY_REFERENCED", "rows already reference the pinned warehouse id before it exists");
    }
    const bindings = (await db.query(`SELECT b.operating_company_id FROM eos_policy.tenant_operating_company_keys b
       JOIN eos_policy.tenant_operating_companies c ON c.tenant_id = b.tenant_id AND c.operating_company_id = b.operating_company_id
      WHERE b.tenant_id = $1 AND b.operating_company_key = $2 AND b.status = 'ACTIVE' AND c.status = 'ACTIVE'`, [tenantId, w.operatingCompanyKey])).rows;
    if (bindings.length !== 1) {
        throw new SyntheticAcceptanceWarehouseError("COMPANY_KEY_NOT_UNIQUE", `operating company key '${w.operatingCompanyKey}' resolves to ${bindings.length} ACTIVE bindings, not exactly one`);
    }
    return Object.freeze({ warehouseId: w.warehouseId, existing, referencingRows, referenceColumnsChecked: columns.length,
        companyKeyBindings: bindings.length, operatingCompanyId: bindings[0].operating_company_id });
}
/** Dry run by default; `apply` creates the pinned warehouse once, audited, in one transaction. */
async function establishSyntheticAcceptanceWarehouse(pool, input) {
    const client = await pool.connect();
    try {
        await client.query(input.apply ? "BEGIN" : "BEGIN READ ONLY");
        await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`synthetic-acceptance-warehouse|${input.tenantId}`]);
        const member = await client.query(`SELECT 1 FROM eos_policy.tenant_memberships m JOIN eos_policy.principals p ON p.id = m.principal_id
        WHERE m.tenant_id = $1 AND m.principal_id = $2 AND m.status = 'active' AND p.status = 'active'`, [input.tenantId, input.actorPrincipalId]);
        if (member.rows.length === 0)
            throw new SyntheticAcceptanceWarehouseError("ACTOR_NOT_TENANT_MEMBER", "the actor is not an active member of the tenant");
        const pre = await preflight(client, input.tenantId);
        if (!input.apply || pre.existing === "PRESENT_EXACT") {
            await client.query(input.apply ? "COMMIT" : "ROLLBACK");
            return Object.freeze({ outcome: pre.existing === "PRESENT_EXACT" ? "ALREADY_PRESENT" : "DRY_RUN", preflight: pre, auditEventId: null });
        }
        // The governed writer, on this transaction's client (it issues a single INSERT through `query`).
        await (0, warehouseBinRepository_1.createWarehouse)(client, input.tenantId, input.actorPrincipalId, { ...exports.SYNTHETIC_ACCEPTANCE_WAREHOUSE });
        const auditEventId = `audit_${(0, node_crypto_1.randomUUID)()}`;
        await client.query(`INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at)
       VALUES ($1, $2, 'warehouse.syntheticAcceptance.create', $3, 'warehouse', $4, NULL, $5, $6)`, [auditEventId, input.tenantId, input.actorPrincipalId, exports.SYNTHETIC_ACCEPTANCE_WAREHOUSE.warehouseId,
            JSON.stringify({ ...exports.SYNTHETIC_ACCEPTANCE_WAREHOUSE, dataProvenance: exports.SYNTHETIC_ACCEPTANCE_PROVENANCE,
                ruling: "Controller 2026-09-30 Option 2(a): nonprod synthetic acceptance infrastructure, not Taylor master data" }),
            input.now ?? new Date()]);
        await client.query("COMMIT");
        return Object.freeze({ outcome: "CREATED", preflight: pre, auditEventId });
    }
    catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
    }
    finally {
        client.release();
    }
}
//# sourceMappingURL=syntheticAcceptanceWarehouse.js.map