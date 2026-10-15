"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EOS_ACQUIRE_OPERATIONS = exports.AcquireOperationError = exports.ACQUISITION_MOVEMENT_SOURCE_KIND = exports.EOS_ACQUISITION_REASONS = exports.EOS_SERIALIZED_ASSET_ACQUIRE_CAPABILITY = void 0;
exports.validateEosAcquireRequest = validateEosAcquireRequest;
exports.acquirePredicates = acquirePredicates;
exports.acquireEosSerializedAsset = acquireEosSerializedAsset;
const node_crypto_1 = require("node:crypto");
const contextualAuthorization_js_1 = require("./contextualAuthorization.js");
const postgresPartPolicyAuthority_js_1 = require("../catalogAuthority/postgresPartPolicyAuthority.js");
const inventoryScopeAuthority_js_1 = require("./inventoryScopeAuthority.js");
const operatingCompanyBinding_js_1 = require("./operatingCompanyBinding.js");
const serializedAssetRegistration_js_1 = require("../serializedAsset/serializedAssetRegistration.js");
const locationOnHand_js_1 = require("../inventoryLedger/locationOnHand.js");
const inventoryBaselineGate_js_1 = require("./inventoryBaselineGate.js");
exports.EOS_SERIALIZED_ASSET_ACQUIRE_CAPABILITY = "inventory.serializedAsset.acquire";
/** Mirrors ACQUISITION_REASONS. */
exports.EOS_ACQUISITION_REASONS = Object.freeze(["OPENING_BALANCE", "LEGACY_MIGRATION", "EXISTING_COMPANY_ASSET"]);
exports.ACQUISITION_MOVEMENT_SOURCE_KIND = "SERIALIZED_ASSET_ACQUISITION";
class AcquireOperationError extends Error {
    code;
    category;
    constructor(code, category, message) {
        super(message);
        this.code = code;
        this.category = category;
        this.name = "AcquireOperationError";
    }
}
exports.AcquireOperationError = AcquireOperationError;
const refuse = (code, category, message) => {
    throw new AcquireOperationError(code, category, message);
};
const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v) => (typeof v === "string" && v.trim() !== "" ? v : null);
const ALLOWED_KEYS = new Set(["partId", "serialNo", "locationId", "reason", "provenanceNote", "idempotencyKey"]);
/** The Firestore validator's decisions and messages, as a value rather than a throw (acquireParity compares them). */
function validateEosAcquireRequest(input) {
    if (!isPlainObject(input))
        return { valid: false, message: "request is not an object" };
    for (const k of Object.keys(input))
        if (!ALLOWED_KEYS.has(k))
            return { valid: false, message: `unknown field ${k}` };
    const partId = str(input.partId);
    const serialNo = str(input.serialNo);
    const locationId = str(input.locationId);
    const idempotencyKey = str(input.idempotencyKey);
    if (!partId)
        return { valid: false, message: "partId required" };
    if (!serialNo)
        return { valid: false, message: "serialNo required" };
    if (!locationId)
        return { valid: false, message: "locationId required" };
    if (!idempotencyKey)
        return { valid: false, message: "idempotencyKey required" };
    const reason = input.reason;
    if (typeof reason !== "string" || !exports.EOS_ACQUISITION_REASONS.includes(reason)) {
        return { valid: false, message: `reason must be one of ${exports.EOS_ACQUISITION_REASONS.join("/")}` };
    }
    const provenanceNote = input.provenanceNote === undefined ? null : str(input.provenanceNote);
    if (input.provenanceNote !== undefined && provenanceNote === null) {
        return { valid: false, message: "provenanceNote must be a non-empty string when present" };
    }
    return { valid: true, value: { partId, serialNo, locationId, idempotencyKey, reason: reason, provenanceNote } };
}
async function inTransaction(pool, fn) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const out = await fn(client);
        await client.query("COMMIT");
        return out;
    }
    catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
    }
    finally {
        client.release();
    }
}
/** Acquisition's contextual authority: the WAREHOUSE operational scope over the receiving warehouse -- nothing more. */
function acquirePredicates(warehouseId) {
    return Object.freeze([Object.freeze({ kind: "OPERATIONAL_SCOPE", scopeType: "WAREHOUSE", scopeId: warehouseId })]);
}
async function acquireEosSerializedAsset(deps, actor, input) {
    if (deps.postgresState !== "ACTIVE") {
        refuse("NOT_ACTIVATED", "NOT_ACTIVATED", "EOS serialized asset acquisition is not activated in this environment; units are still acquired on the current system");
    }
    // The cutover fails closed until the tenant's legacy baseline is CERTIFIED (inventoryBaselineGate.ts).
    if (!(await (0, inventoryBaselineGate_js_1.isInventoryBaselineCertified)(deps.pool, actor.tenantId)))
        refuse("NOT_ACTIVATED", "NOT_ACTIVATED", inventoryBaselineGate_js_1.INVENTORY_BASELINE_NOT_CERTIFIED_MESSAGE);
    const validated = validateEosAcquireRequest(input);
    if (!validated.valid)
        return refuse("REQUEST_INVALID", "INVALID_INPUT", validated.message);
    const req = validated.value;
    const serializedAssetId = (0, serializedAssetRegistration_js_1.serializedAssetDocId)(req.partId, req.serialNo);
    return inTransaction(deps.pool, async (db) => {
        // ---- 1. AUTHORITY: the capability, then the receiving warehouse's scope ----
        if (!actor.capabilities.has(exports.EOS_SERIALIZED_ASSET_ACQUIRE_CAPABILITY)) {
            refuse("PERMISSION_DENIED", "FORBIDDEN", "actor is not authorized to acquire serialized assets");
        }
        let warehouse;
        try {
            // Acquisition admits exactly one kind of place: a WAREHOUSE (ACQUIRED_LOCATION_TYPE). Never a bin, truck or customer.
            warehouse = await (0, inventoryScopeAuthority_js_1.resolveScopeLocation)(db, actor.tenantId, { type: "WAREHOUSE", locationId: req.locationId });
        }
        catch (err) {
            if (err instanceof inventoryScopeAuthority_js_1.InventoryScopeError)
                return refuse("LOCATION_INVALID", "PRECONDITION_FAILED", `${req.locationId} is not an active governed company location`);
            throw err;
        }
        // THE ACQUIRE PREDICATE IS THE WAREHOUSE SCOPE ONLY (Controller INVENTORY/WAREHOUSE FINAL CORRECTION, 2026-10-01).
        // DQ-036b rules inventory.serializedAsset.acquire for the Parts AND Warehouse personas. Acquisition used to borrow the
        // sheet-level warehousePredicates (WORK_ELIGIBILITY WAREHOUSE_OPERATIONS + scope), which no Parts persona holds -- so
        // the ruled grant could never be exercised by them. The governed authority here is the Administration-grant-only
        // capability plus OPERATIONAL_SCOPE WAREHOUSE over the warehouse the unit enters (which also requires a linked
        // Employee). Every other warehouse act (placement, relocation, transfer, cycle count) keeps warehousePredicates.
        const decision = await (0, contextualAuthorization_js_1.authorizeObjectAction)((0, contextualAuthorization_js_1.postgresContextualReader)(db), {
            actor, capabilityKey: exports.EOS_SERIALIZED_ASSET_ACQUIRE_CAPABILITY, predicates: acquirePredicates(warehouse.scopeWarehouseId),
        });
        if (!decision.allowed) {
            refuse(decision.reason, "FORBIDDEN", decision.reason === "OUTSIDE_OPERATIONAL_SCOPE" ? "this warehouse is outside your operational scope"
                : decision.reason === "EMPLOYEE_LINK_REQUIRED" ? "only an Employee can acquire a unit" : "not authorized");
        }
        // ---- 2. THE UNIT FIRST: identity -> replay -> gates ----
        //
        // ONE ACQUISITION PER UNIT AT A TIME. A transaction-scoped advisory lock on (tenant, part, serial) serializes
        // every acquisition of the same unit BEFORE anything is read: a concurrent duplicate waits here, then reads the
        // winner's committed custody + provenance + ledger fact and is replayed (same intent) or refused (different
        // intent). Without it both would pass the "nothing exists yet" reads -- a FOR UPDATE on a row that does not exist
        // locks nothing -- and the loser would die on a unique index with a raw database error.
        await db.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`eos_ops.serializedAssetAcquire:${actor.tenantId}:${req.partId}:${req.serialNo}`]);
        const ledgerIdempotencyKey = `serializedAssetAcquisition:${serializedAssetId}`;
        const { rows: custody } = await db.query(`SELECT status::text AS status, location_type::text AS location_type, location_id FROM eos_ops.serialized_custody
        WHERE tenant_id = $1 AND part_id = $2 AND serial_number = $3 FOR UPDATE`, [actor.tenantId, req.partId, req.serialNo]);
        const { rows: acquired } = await db.query(`SELECT id, reason::text AS reason, note, idempotency_key, ledger_movement_id FROM eos_ops.serialized_asset_acquisitions
        WHERE tenant_id = $1 AND part_id = $2 AND serial_number = $3`, [actor.tenantId, req.partId, req.serialNo]);
        const { rows: ledger } = await db.query(`SELECT id, movement_type::text AS movement_type, quantity_delta, tracking_mode::text AS tracking_mode, part_id, serial_number,
              location_id, source_kind, source_id
         FROM eos_ops.inventory_movements WHERE tenant_id = $1 AND idempotency_key = $2`, [actor.tenantId, ledgerIdempotencyKey]);
        if (custody[0] || acquired[0] || ledger[0]) {
            // Evidence that does not form ONE whole acquisition is never repaired or guessed at here (DQ-019): it fails
            // closed. Provenance without custody, a ledger fact without provenance, or provenance whose ledger fact is
            // missing or is not exactly the +1 ADJUSTED serial movement of THIS unit at THIS warehouse.
            if (acquired[0] && !custody[0])
                refuse("ACQUIRE_INTEGRITY", "CONFLICT", "an acquisition is recorded for this unit but it has no custody");
            if (ledger[0] && !acquired[0])
                refuse("ACQUIRE_INTEGRITY", "CONFLICT", "an acquisition ledger fact exists for this unit but no acquisition is recorded");
            if (!acquired[0]) {
                refuse("ALREADY_EXISTS_CONFLICT", "CONFLICT", "this unit already exists from a receipt; acquisition must not overwrite purchasing history");
            }
            const a = acquired[0];
            const c = custody[0];
            const m = ledger[0];
            if (ledger.length !== 1 || !m || m.id !== a.ledger_movement_id || m.movement_type !== "ADJUSTED" || Number(m.quantity_delta) !== 1
                || m.tracking_mode !== "SERIAL" || m.part_id !== req.partId || m.serial_number !== req.serialNo
                || m.source_kind !== exports.ACQUISITION_MOVEMENT_SOURCE_KIND || m.source_id !== a.id) {
                refuse("ACQUIRE_INTEGRITY", "CONFLICT", "this unit's acquisition is not backed by exactly one +1 ADJUSTED serial ledger movement");
            }
            if (a.idempotency_key === req.idempotencyKey && (a.note ?? null) !== req.provenanceNote) {
                refuse("ALREADY_EXISTS_CONFLICT", "CONFLICT", "this request id already acquired this unit with a different note");
            }
            if (a.reason !== req.reason || c.location_type !== "WAREHOUSE" || c.location_id !== req.locationId) {
                refuse("ALREADY_EXISTS_CONFLICT", "CONFLICT", `this unit was already acquired as ${a.reason} at ${c.location_id}`);
            }
            return { outcome: "replayed", serializedAssetId, partId: req.partId, serialNo: req.serialNo, locationId: c.location_id, state: c.status, reason: req.reason };
        }
        // ---- 3. CATALOG IDENTITY: eos_ops.parts, ACTIVE and SERIAL ----
        const [part] = await (0, postgresPartPolicyAuthority_js_1.createPostgresPartPolicyAuthority)().readPartPolicies(db, actor.tenantId, [req.partId]);
        if (!part.found)
            refuse("PART_NOT_FOUND", "NOT_FOUND", `part ${req.partId} not found`);
        if (part.status !== "ACTIVE")
            refuse("PART_NOT_FOUND", "NOT_FOUND", `part ${req.partId} is not active`);
        if (part.trackingMode !== "SERIAL") {
            refuse("PART_NOT_SERIALIZED", "PRECONDITION_FAILED", `part ${req.partId} is ${part.trackingMode}; only SERIAL parts have individually identified units`);
        }
        // ---- 4. CUSTODY: an ACTIVE governed warehouse of a governed company ----
        if (!warehouse.active)
            refuse("LOCATION_INVALID", "PRECONDITION_FAILED", `${req.locationId} is not an active governed company location`);
        try {
            await (0, operatingCompanyBinding_js_1.resolveActiveOperatingCompanyId)(db, actor.tenantId, warehouse.operatingCompanyKey);
        }
        catch (err) {
            if (err instanceof operatingCompanyBinding_js_1.OperatingCompanyBindingError)
                return refuse("COMPANY_NOT_GOVERNED", "PRECONDITION_FAILED", `the warehouse's operating company is not governed: ${err.message}`);
            throw err;
        }
        // ---- 5. CREATE, ALL OR NOTHING: custody -> provenance -> the +1 ledger fact -> audit, in THIS transaction ----
        // Any failure -- a constraint, a trigger, the connection, the COMMIT itself -- rolls every one of them back
        // (inTransaction). A unique violation means another writer (a receipt, which does not take this lock) got the
        // unit first: that is a conflict, never a partial acquisition.
        const acquisitionId = `acq_${(0, node_crypto_1.randomUUID)()}`;
        const movementId = `mov_${(0, node_crypto_1.randomUUID)()}`;
        const uniqueViolation = (err) => err.code === "23505";
        try {
            await db.query(`INSERT INTO eos_ops.serialized_custody (id, tenant_id, operating_company_key, part_id, serial_number, status, location_type, location_id, updated_by)
         VALUES ($1, $2, $3, $4, $5, 'AVAILABLE', 'WAREHOUSE', $6, $7)`, [`ser_${(0, node_crypto_1.randomUUID)()}`, actor.tenantId, warehouse.operatingCompanyKey, req.partId, req.serialNo, req.locationId, actor.principalId]);
            await db.query(`INSERT INTO eos_ops.serialized_asset_acquisitions (id, tenant_id, part_id, serial_number, warehouse_id, operating_company_key,
            reason, note, idempotency_key, ledger_movement_id, acquired_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`, [acquisitionId, actor.tenantId, req.partId, req.serialNo, req.locationId, warehouse.operatingCompanyKey,
                req.reason, req.provenanceNote, req.idempotencyKey, movementId, actor.principalId]);
            await db.query(`INSERT INTO eos_ops.inventory_movements
           (id, tenant_id, operating_company_key, part_id, tracking_mode, location_type, location_id,
            movement_type, quantity_delta, serial_number, source_kind, source_id, idempotency_key, created_by)
         VALUES ($1, $2, $3, $4, 'SERIAL', 'WAREHOUSE', $5, 'ADJUSTED', $6, $7, $8, $9, $10, $11)`, [movementId, actor.tenantId, warehouse.operatingCompanyKey, req.partId, req.locationId,
                (0, locationOnHand_js_1.signedQuantity)({ type: "ADJUSTED", quantity: 1 }), req.serialNo, exports.ACQUISITION_MOVEMENT_SOURCE_KIND, acquisitionId,
                ledgerIdempotencyKey, actor.principalId]);
        }
        catch (err) {
            if (uniqueViolation(err))
                refuse("ALREADY_EXISTS_CONFLICT", "CONFLICT", "this unit was brought into custody concurrently");
            throw err;
        }
        await db.query(`INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, reason)
       VALUES ($1, $2, 'serializedAsset.acquire', $3, 'serializedAsset', $4, NULL, $5, $6)`, [`audit_${(0, node_crypto_1.randomUUID)()}`, actor.tenantId, actor.principalId, serializedAssetId,
            JSON.stringify({ partId: req.partId, serialNo: req.serialNo, locationId: req.locationId, reason: req.reason,
                provenance: "NON_PO_ACQUISITION", acquisitionId, ledgerMovementId: movementId }), req.provenanceNote]);
        return { outcome: "acquired", serializedAssetId, partId: req.partId, serialNo: req.serialNo, locationId: req.locationId, state: "AVAILABLE", reason: req.reason };
    });
}
exports.EOS_ACQUIRE_OPERATIONS = Object.freeze({
    acquireSerializedAsset: acquireEosSerializedAsset,
});
//# sourceMappingURL=serializedAssetAcquireOperations.js.map