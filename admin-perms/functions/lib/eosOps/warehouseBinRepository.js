"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BIN_LIST_LIMIT = exports.LocationAuthorityError = exports.OPS_BIN_CLAIM_STATES = exports.OPS_LOCATION_PROVENANCES = exports.OPS_LOCATION_STATUSES = void 0;
exports.createWarehouse = createWarehouse;
exports.readWarehouse = readWarehouse;
exports.setWarehouseStatus = setWarehouseStatus;
exports.createBin = createBin;
exports.renameBin = renameBin;
exports.setBinStatus = setBinStatus;
exports.readBin = readBin;
exports.listBinsForWarehouse = listBinsForWarehouse;
exports.resolveBinCode = resolveBinCode;
exports.resolveOpsLocation = resolveOpsLocation;
const binRegistry_js_1 = require("../inventoryLocation/binRegistry.js");
const operatingCompanyCustody_js_1 = require("./operatingCompanyCustody.js");
const SCHEMA = "eos_ops";
/** `eos_ops.ops_location_status`. Warehouses and bins share it: both are ACTIVE or INACTIVE. */
exports.OPS_LOCATION_STATUSES = ["ACTIVE", "INACTIVE"];
/** `eos_ops.ops_location_provenance`. Carried verbatim from the governed §3A warehouse record. */
exports.OPS_LOCATION_PROVENANCES = ["NATIVE", "MIGRATED"];
/** `eos_ops.ops_bin_claim_state`. Neither state is ever released. */
exports.OPS_BIN_CLAIM_STATES = ["HELD", "SUPERSEDED"];
class LocationAuthorityError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "LocationAuthorityError";
    }
}
exports.LocationAuthorityError = LocationAuthorityError;
// ═══════════════════════════════════ shared guards ═══════════════════════════════════
function requireSafeSegment(value, what) {
    if (!(0, binRegistry_js_1.isSafeIdSegment)(value)) {
        throw new LocationAuthorityError("ID_INVALID", `${what} is not a safe identity segment`);
    }
    return value;
}
function requireStatus(value) {
    if (typeof value !== "string" || !exports.OPS_LOCATION_STATUSES.includes(value)) {
        throw new LocationAuthorityError("STATUS_INVALID", "status must be ACTIVE or INACTIVE");
    }
    return value;
}
function requireNonBlank(value, what) {
    if (typeof value !== "string" || value.trim() === "") {
        throw new LocationAuthorityError("FIELD_INVALID", `${what} is required`);
    }
    return value;
}
// The bin and warehouse status vocabularies are the same two labels in two modules. If one ever
// grows a third, this fails loudly at import rather than letting a bin be stored with a status the
// warehouse table cannot express.
const STATUS_VOCABULARIES_AGREE = binRegistry_js_1.BIN_STATUSES.length === exports.OPS_LOCATION_STATUSES.length
    && binRegistry_js_1.BIN_STATUSES.every((s) => exports.OPS_LOCATION_STATUSES.includes(s));
if (!STATUS_VOCABULARIES_AGREE) {
    throw new Error("BIN_STATUSES and OPS_LOCATION_STATUSES have diverged; eos_ops cannot store a bin status it has no label for");
}
// ═══════════════════════════════════ warehouses ═══════════════════════════════════
/**
 * Run `fn` in a transaction: the repository's own, or the CALLER's when it hands in a client it already opened
 * (a PoolClient carries `release`, a Pool does not). The governed Administration commands
 * (warehouseBinAdministration.ts) pass their client so the master-data write and its audit event commit together;
 * every other caller is unchanged.
 */
async function inTransactionOf(pool, fn) {
    if (typeof pool.release === "function")
        return fn(pool);
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const out = await fn(client);
        await client.query("COMMIT");
        return out;
    }
    catch (err) {
        await client.query("ROLLBACK");
        throw err;
    }
    finally {
        client.release();
    }
}
async function createWarehouse(pool, tenantId, actorId, draft) {
    const id = requireSafeSegment(draft.warehouseId, "warehouseId");
    // Refused HERE as well as by the NOT NULL column, so a caller that omitted it gets the reason
    // rather than a constraint name. `requireOperatingCompanyKey` throws its own typed error.
    const operatingCompanyKey = (0, operatingCompanyCustody_js_1.requireOperatingCompanyKey)(draft.operatingCompanyKey);
    const name = requireNonBlank(draft.name, "name");
    const siteLabel = requireNonBlank(draft.siteLabel, "siteLabel");
    const status = requireStatus(draft.status);
    if (!exports.OPS_LOCATION_PROVENANCES.includes(draft.provenance)) {
        throw new LocationAuthorityError("PROVENANCE_INVALID", "provenance must be NATIVE or MIGRATED");
    }
    await pool.query(`INSERT INTO ${SCHEMA}.warehouses
       (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`, [id, tenantId, operatingCompanyKey, name, siteLabel, status, draft.provenance, actorId]);
    return { id, tenantId, operatingCompanyKey, name, siteLabel, status, provenance: draft.provenance };
}
async function readWarehouse(pool, tenantId, warehouseId) {
    if (!(0, binRegistry_js_1.isSafeIdSegment)(warehouseId))
        return null;
    const { rows } = await pool.query(`SELECT id, operating_company_key, name, site_label, status, provenance
       FROM ${SCHEMA}.warehouses WHERE tenant_id = $1 AND id = $2`, [tenantId, warehouseId]);
    const row = rows[0];
    if (!row)
        return null;
    return {
        id: row.id, tenantId, operatingCompanyKey: row.operating_company_key,
        name: row.name, siteLabel: row.site_label, status: row.status, provenance: row.provenance,
    };
}
/**
 * ACTIVE <-> INACTIVE only. There is no method that moves a warehouse between operating companies:
 * the company is the boundary a warehouse's whole movement history was recorded under, and
 * reassigning it would silently restate who owned every past receipt.
 */
async function setWarehouseStatus(pool, tenantId, actorId, warehouseId, status) {
    const id = requireSafeSegment(warehouseId, "warehouseId");
    const next = requireStatus(status);
    const { rowCount } = await pool.query(`UPDATE ${SCHEMA}.warehouses SET status = $3, updated_by = $4, updated_at = now()
      WHERE tenant_id = $1 AND id = $2`, [tenantId, id, next, actorId]);
    if (!rowCount)
        throw new LocationAuthorityError("WAREHOUSE_NOT_FOUND", "warehouse not found");
    const record = await readWarehouse(pool, tenantId, id);
    if (!record)
        throw new LocationAuthorityError("WAREHOUSE_NOT_FOUND", "warehouse disappeared after update");
    return record;
}
function assertNoCompanyOnBin(draft) {
    if (draft.operatingCompanyKey !== undefined) {
        throw new operatingCompanyCustody_js_1.OperatingCompanyAuthorityError("a bin never states its own operating company; it is the parent warehouse's and is read from there");
    }
}
function normalizeRacking(draft, policy) {
    const area = requireNonBlank(draft.area, "area").trim().replace(/\s+/g, "_").toUpperCase();
    const aisle = requireNonBlank(draft.aisle, "aisle").trim().replace(/\s+/g, "").toUpperCase();
    if (!Number.isInteger(draft.bay) || draft.bay < 0)
        throw new LocationAuthorityError("BAY_INVALID", "bay must be a non-negative integer");
    if (!Number.isInteger(draft.position) || draft.position < 0)
        throw new LocationAuthorityError("POSITION_INVALID", "position must be a non-negative integer");
    // ONE code-derivation authority. Reused from binRegistry.ts rather than restated, so a change of
    // formatter policy can never mean two different things in two persistence layers.
    const code = (0, binRegistry_js_1.formatBinCode)({ aisle, bay: draft.bay, position: draft.position }, policy);
    if (!code.valid)
        throw new LocationAuthorityError("CODE_INVALID", code.reason);
    return { area, aisle, bay: draft.bay, position: draft.position, code: code.value };
}
/**
 * Create a bin and reserve its code, in ONE transaction.
 *
 * The bin row and its HELD claim are a single fact expressed in two tables: a bin with no claim
 * would have a code nothing reserved, and a claim with no bin would reserve a code for nothing. A
 * crash between the two would produce exactly one of those, so they are never two round trips.
 */
async function createBin(pool, tenantId, actorId, draft, policy = binRegistry_js_1.DEFAULT_BIN_CODE_FORMAT) {
    assertNoCompanyOnBin(draft);
    const warehouseId = requireSafeSegment(draft.warehouseId, "warehouseId");
    const idempotencyKey = requireNonBlank(draft.idempotencyKey, "idempotencyKey");
    const racking = normalizeRacking(draft, policy);
    const id = (0, binRegistry_js_1.deriveBinId)(idempotencyKey);
    const name = draft.name === undefined || draft.name === null || draft.name.trim() === "" ? null : draft.name.trim();
    await inTransactionOf(pool, async (client) => {
        // Scope validation is not optional: a bin in a warehouse that does not exist is a place nobody
        // can go. The composite foreign key would refuse it anyway; this makes the refusal legible.
        const parent = await readWarehouse(client, tenantId, warehouseId);
        if (!parent)
            throw new LocationAuthorityError("WAREHOUSE_UNKNOWN", "parent warehouse does not exist");
        await client.query(`INSERT INTO ${SCHEMA}.bins
         (id, tenant_id, warehouse_id, area, aisle, bay, "position", code, name, status,
          idempotency_key, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ACTIVE', $10, $11, $11)`, [id, tenantId, warehouseId, racking.area, racking.aisle, racking.bay, racking.position,
            racking.code, name, idempotencyKey, actorId]);
        await client.query(`INSERT INTO ${SCHEMA}.bin_code_claims
         (tenant_id, warehouse_id, code, bin_id, claim_state, claimed_by)
       VALUES ($1, $2, $3, $4, 'HELD', $5)`, [tenantId, warehouseId, racking.code, id, actorId]);
    });
    return {
        id, tenantId, warehouseId, area: racking.area, aisle: racking.aisle, bay: racking.bay,
        position: racking.position, code: racking.code, name, status: "ACTIVE", idempotencyKey,
    };
}
/**
 * Correct a mislabelled rack. The BIN ID DOES NOT CHANGE — that is the whole point of ruling O-3,
 * and it is why every movement ever recorded at this bin survives the correction.
 *
 * The old claim is marked SUPERSEDED and STAYS RESERVED to this same bin, permanently. Nothing
 * releases it, so a label still reading the old code can only ever resolve back here.
 *
 * The warehouse is not a parameter. A rename never moves a bin.
 */
async function renameBin(pool, tenantId, actorId, binId, attrs, policy = binRegistry_js_1.DEFAULT_BIN_CODE_FORMAT) {
    assertNoCompanyOnBin(attrs);
    if (attrs.warehouseId !== undefined) {
        throw new LocationAuthorityError("WAREHOUSE_NOT_MOVABLE", "a bin's parent warehouse is immutable");
    }
    const id = requireSafeSegment(binId, "binId");
    await inTransactionOf(pool, async (client) => {
        const existing = await selectBin(client, tenantId, id);
        if (!existing)
            throw new LocationAuthorityError("BIN_NOT_FOUND", "bin not found");
        const racking = normalizeRacking({ ...attrs, warehouseId: existing.warehouseId, idempotencyKey: existing.idempotencyKey }, policy);
        if (racking.code !== existing.code) {
            // The old claim is SUPERSEDED, never deleted, and never repointed.
            const superseded = await client.query(`UPDATE ${SCHEMA}.bin_code_claims
            SET claim_state = 'SUPERSEDED', superseded_at = now()
          WHERE tenant_id = $1 AND warehouse_id = $2 AND code = $3 AND bin_id = $4 AND claim_state = 'HELD'`, [tenantId, existing.warehouseId, existing.code, id]);
            if (superseded.rowCount !== 1) {
                // A rename's own claim is missing, points elsewhere, or is already superseded. Never
                // repaired: a bin whose reservation history cannot be read is not one to keep renaming.
                throw new LocationAuthorityError("CLAIM_INTEGRITY", "the bin's held code claim is missing or does not point at it");
            }
            await client.query(`INSERT INTO ${SCHEMA}.bin_code_claims
           (tenant_id, warehouse_id, code, bin_id, claim_state, claimed_by)
         VALUES ($1, $2, $3, $4, 'HELD', $5)`, [tenantId, existing.warehouseId, racking.code, id, actorId]);
        }
        const name = attrs.name === undefined ? existing.name
            : (attrs.name === null || attrs.name.trim() === "" ? null : attrs.name.trim());
        await client.query(`UPDATE ${SCHEMA}.bins
          SET area = $3, aisle = $4, bay = $5, "position" = $6, code = $7, name = $8,
              updated_by = $9, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`, [tenantId, id, racking.area, racking.aisle, racking.bay, racking.position, racking.code, name, actorId]);
    });
    const result = await selectBin(pool, tenantId, id);
    if (!result)
        throw new LocationAuthorityError("BIN_NOT_FOUND", "bin disappeared after commit");
    return result;
}
async function setBinStatus(pool, tenantId, actorId, binId, status) {
    const id = requireSafeSegment(binId, "binId");
    const next = requireStatus(status);
    const { rowCount } = await pool.query(`UPDATE ${SCHEMA}.bins SET status = $3, updated_by = $4, updated_at = now()
      WHERE tenant_id = $1 AND id = $2`, [tenantId, id, next, actorId]);
    if (!rowCount)
        throw new LocationAuthorityError("BIN_NOT_FOUND", "bin not found");
    const record = await selectBin(pool, tenantId, id);
    if (!record)
        throw new LocationAuthorityError("BIN_NOT_FOUND", "bin disappeared after update");
    return record;
}
async function selectBin(pool, tenantId, binId) {
    const { rows } = await pool.query(`SELECT id, warehouse_id, area, aisle, bay, "position", code, name, status, idempotency_key
       FROM ${SCHEMA}.bins WHERE tenant_id = $1 AND id = $2`, [tenantId, binId]);
    const row = rows[0];
    if (!row)
        return null;
    return {
        id: row.id, tenantId, warehouseId: row.warehouse_id, area: row.area, aisle: row.aisle,
        bay: row.bay, position: row.position, code: row.code, name: row.name, status: row.status,
        idempotencyKey: row.idempotency_key,
    };
}
async function readBin(pool, tenantId, binId) {
    if (!(0, binRegistry_js_1.isSafeIdSegment)(binId))
        return null;
    return selectBin(pool, tenantId, binId);
}
exports.BIN_LIST_LIMIT = 500;
/** The warehouse -> bin hierarchy, read through the foreign key rather than by parsing a code. */
async function listBinsForWarehouse(pool, tenantId, warehouseId, limit = exports.BIN_LIST_LIMIT) {
    if (!(0, binRegistry_js_1.isSafeIdSegment)(warehouseId))
        return [];
    const bounded = Math.min(Math.max(1, Math.trunc(limit)), exports.BIN_LIST_LIMIT);
    const { rows } = await pool.query(`SELECT id, warehouse_id, area, aisle, bay, "position", code, name, status, idempotency_key
       FROM ${SCHEMA}.bins WHERE tenant_id = $1 AND warehouse_id = $2
      ORDER BY area, aisle, bay, "position" LIMIT $3`, [tenantId, warehouseId, bounded]);
    return rows.map((row) => ({
        id: row.id, tenantId, warehouseId: row.warehouse_id, area: row.area, aisle: row.aisle,
        bay: row.bay, position: row.position, code: row.code, name: row.name, status: row.status,
        idempotencyKey: row.idempotency_key,
    }));
}
/**
 * Resolve a scanned or typed code WITHIN ONE WAREHOUSE.
 *
 * There is deliberately no WRONG_WAREHOUSE answer: the lookup is scoped to the warehouse the caller
 * named, so it cannot observe that another warehouse holds the same code and must not pretend to
 * (ruling O-7). A SUPERSEDED code resolves to its original bin and reports that bin's CURRENT code,
 * so an operator can be told the label is out of date.
 */
async function resolveBinCode(pool, tenantId, warehouseId, rawCode) {
    if (!(0, binRegistry_js_1.isSafeIdSegment)(warehouseId))
        return { result: "MALFORMED", detail: "warehouse_invalid" };
    const normalized = (0, binRegistry_js_1.normalizeBinCode)(rawCode);
    if (!normalized.valid)
        return { result: "MALFORMED", detail: normalized.reason };
    const { rows } = await pool.query(`SELECT c.bin_id, c.claim_state, b.code AS current_code
       FROM ${SCHEMA}.bin_code_claims c
       JOIN ${SCHEMA}.bins b ON b.tenant_id = c.tenant_id AND b.id = c.bin_id
      WHERE c.tenant_id = $1 AND c.warehouse_id = $2 AND c.code = $3`, [tenantId, warehouseId, normalized.value.code]);
    const row = rows[0];
    if (!row)
        return { result: "NOT_FOUND" };
    if (row.claim_state === "SUPERSEDED") {
        return { result: "FOUND_SUPERSEDED_CODE", binId: row.bin_id, code: row.current_code, supersededCode: normalized.value.code };
    }
    return { result: "FOUND", binId: row.bin_id, code: row.current_code };
}
// ═══════════════════════════════════ the typed pair (R3) ═══════════════════════════════════
/**
 * Resolve `{ location_type, location_id }` against the location authority.
 *
 * THIS IS THE ONLY WAY THIS MODULE HANDS OUT A LOCATION, and it never takes a bare id. Returns the
 * warehouse the location rolls up to (for a BIN, its immutable parent — ADR-014 Model A) and the
 * operating company that warehouse belongs to, READ rather than inferred.
 *
 * MOBILE is refused with its own code, not collapsed into "not found": the Truck/Mobile registry is
 * reference data migration 008 does not import, and the honest answer is "this layer is not its
 * authority yet" rather than "there is no such truck".
 */
async function resolveOpsLocation(
// Pool OR an open transaction client. The governed receipt resolves its destination inside the
// transaction that writes the receipt, so the location it validated cannot be deactivated between
// the check and the commit. `readWarehouse` below already accepts both for the same reason.
pool, tenantId, ref) {
    if (!ref || typeof ref !== "object") {
        throw new LocationAuthorityError("LOCATION_REF_INVALID", "a location is a { type, locationId } pair");
    }
    if (ref.type === "MOBILE") {
        throw new LocationAuthorityError("LOCATION_TYPE_NOT_IN_POSTGRES", "MOBILE location reference data is not held by eos_ops; resolve it through the Truck/Mobile registry");
    }
    if (ref.type !== "WAREHOUSE" && ref.type !== "BIN") {
        throw new LocationAuthorityError("LOCATION_TYPE_INVALID", "location type must be WAREHOUSE, BIN or MOBILE");
    }
    const locationId = requireSafeSegment(ref.locationId, "locationId");
    if (ref.type === "WAREHOUSE") {
        const warehouse = await readWarehouse(pool, tenantId, locationId);
        // A BIN id presented as a WAREHOUSE lands here and is NOT FOUND, because the namespaces are
        // separate tables. The type is what decides which one is consulted -- that is R3 working.
        if (!warehouse)
            throw new LocationAuthorityError("LOCATION_NOT_FOUND", "no warehouse with that id");
        return {
            type: "WAREHOUSE", locationId, warehouseId: warehouse.id,
            operatingCompanyKey: warehouse.operatingCompanyKey, status: warehouse.status,
        };
    }
    const { rows } = await pool.query(`SELECT b.status AS bin_status, b.warehouse_id, w.operating_company_key
       FROM ${SCHEMA}.bins b
       JOIN ${SCHEMA}.warehouses w ON w.tenant_id = b.tenant_id AND w.id = b.warehouse_id
      WHERE b.tenant_id = $1 AND b.id = $2`, [tenantId, locationId]);
    const row = rows[0];
    if (!row)
        throw new LocationAuthorityError("LOCATION_NOT_FOUND", "no bin with that id");
    return {
        type: "BIN", locationId, warehouseId: row.warehouse_id,
        operatingCompanyKey: row.operating_company_key, status: row.bin_status,
    };
}
//# sourceMappingURL=warehouseBinRepository.js.map