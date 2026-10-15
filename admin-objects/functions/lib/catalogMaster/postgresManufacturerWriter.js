"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MANUFACTURER_INITIAL_STATUS = exports.NATIVE_MANUFACTURER_PROVENANCE = void 0;
exports.createManufacturer = createManufacturer;
exports.updateManufacturer = updateManufacturer;
exports.changeManufacturerStatus = changeManufacturerStatus;
const catalogMasterKernel_1 = require("./catalogMasterKernel");
const catalogRows_1 = require("./catalogRows");
const validation_1 = require("../partMaster/validation");
const types_1 = require("../partMaster/types");
// The source's own normalization, stated once and reused -- never restated here.
const manufacturerMigration_1 = require("../eosOps/migration/manufacturerMigration");
/** A live command writes NATIVE. MIGRATED is the one-time copy's, and is never minted here. */
exports.NATIVE_MANUFACTURER_PROVENANCE = "NATIVE";
/** partMasterCommands.ts createManufacturer: a new manufacturer is ACTIVE, and the status is not an input. */
exports.MANUFACTURER_INITIAL_STATUS = "ACTIVE";
/**
 * partMasterCommands.ts's own name rule, restated exactly: a non-empty string once trimmed, and at most 200
 * characters BEFORE trimming (`input.name.length > 200`, not the trimmed length). The bound is on what the
 * caller sent, which is the check the Firestore command makes.
 */
const MAX_NAME_LENGTH = 200;
/** The caller-writable fields of a create. Everything else about the row is repository authority. */
const CREATE_FIELDS = new Set(["manufacturerId", "name"]);
function requireManufacturerId(value) {
    const parsed = (0, validation_1.parseManufacturerId)(value);
    if (!parsed.valid)
        (0, catalogMasterKernel_1.refuse)("INVALID_INPUT", "INVALID_INPUT", "manufacturerId must be a valid manufacturer id");
    return parsed.value;
}
function requireName(value) {
    if (typeof value !== "string" || value.trim().length === 0 || value.length > MAX_NAME_LENGTH) {
        (0, catalogMasterKernel_1.refuse)("INVALID_INPUT", "INVALID_INPUT", `name is required and must be at most ${MAX_NAME_LENGTH} characters`);
    }
    return value.trim();
}
/**
 * The token a caller must echo back. A non-empty string is all this layer can assert about it: whether it is THE
 * token is decided against the stored row, under the lock, and never by its shape.
 */
function requireExpectedUpdatedAt(value) {
    if (typeof value !== "string" || value.trim() === "") {
        (0, catalogMasterKernel_1.refuse)("INVALID_INPUT", "INVALID_INPUT", "expectedUpdatedAt must be the updatedAt token the record was read at");
    }
    return value;
}
async function lockManufacturer(client, tenantId, id) {
    const { rows } = await client.query(`${catalogRows_1.MANUFACTURER_SELECT} WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, id]);
    return rows.length === 0 ? null : (0, catalogRows_1.manufacturerFromRow)(rows[0]);
}
/**
 * Write the changed columns and return the row's NEW token.
 *
 * `updated_at` is GREATEST(now, stored + 1µs) so the token is strictly increasing even if two commands land
 * inside the same microsecond -- a token that could repeat is not a concurrency token. The WHERE clause carries
 * the expected token too, so a row that moved between the lock and the write updates nothing and is refused.
 */
async function applyManufacturerUpdate(client, tenantId, stored, changes, actorPrincipalId, now) {
    const { rows } = await client.query(`UPDATE eos_ops.manufacturers
        SET name            = COALESCE($4, name),
            normalized_name = COALESCE($5, normalized_name),
            status          = COALESCE($6, status),
            updated_by      = $7,
            updated_at      = GREATEST($8::timestamptz, updated_at + interval '1 microsecond')
      WHERE tenant_id = $1 AND id = $2
        AND to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') = $3
  RETURNING to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at`, [tenantId, stored.id, stored.updatedAt, changes.name ?? null, changes.normalizedName ?? null,
        changes.status ?? null, actorPrincipalId, (0, catalogRows_1.isoMicros)(now)]);
    if (rows.length !== 1) {
        (0, catalogMasterKernel_1.refuse)("CONCURRENT_MODIFICATION", "CONFLICT", "the record changed while the command was running; retry it");
    }
    return String(rows[0].updated_at);
}
/**
 * Create one manufacturer at the id the caller names -- ACTIVE, NATIVE, version-free.
 *
 * Replays when the row already says exactly this; refuses when a row at that id says something else. The id is
 * the caller's, not minted here, because the Firestore command takes one and a copy must carry source ids across
 * unchanged.
 */
async function createManufacturer(deps, actor, input) {
    return (0, catalogMasterKernel_1.runCatalogCommand)(deps, actor, catalogMasterKernel_1.CATALOG_CAPABILITIES.MANUFACTURER_MANAGE, async (client, now) => {
        const raw = (0, catalogMasterKernel_1.requirePlainObject)((0, catalogMasterKernel_1.requirePlainObject)(input, "input").manufacturer, "manufacturer");
        for (const k of Object.keys(raw)) {
            if (!CREATE_FIELDS.has(k))
                (0, catalogMasterKernel_1.refuse)("FIELD_NOT_WRITABLE", "INVALID_INPUT", `field "${k}" is not writable`);
        }
        const id = requireManufacturerId(raw.manufacturerId);
        const name = requireName(raw.name);
        const fields = {
            id, name, normalizedName: (0, manufacturerMigration_1.normalizeName)(name),
            status: exports.MANUFACTURER_INITIAL_STATUS, provenance: exports.NATIVE_MANUFACTURER_PROVENANCE,
        };
        const existing = await lockManufacturer(client, actor.tenantId, id);
        if (existing !== null) {
            if ((0, catalogRows_1.differingFields)(catalogRows_1.MANUFACTURER_MASTER_FIELDS, existing, { ...existing, ...fields }).length === 0) {
                return { result: { manufacturerId: existing.id, updatedAt: existing.updatedAt }, replayed: true, audit: null };
            }
            (0, catalogMasterKernel_1.refuse)("MANUFACTURER_ALREADY_EXISTS", "CONFLICT", `manufacturer ${id} already exists`);
        }
        const at = (0, catalogRows_1.isoMicros)(now);
        const record = { ...fields, createdAt: at, updatedAt: at };
        await client.query(catalogRows_1.INSERT_MANUFACTURER_SQL, (0, catalogRows_1.insertManufacturerValues)(actor.tenantId, record, actor.principalId, actor.principalId));
        return {
            result: { manufacturerId: id, updatedAt: at }, replayed: false,
            audit: { action: "catalog.manufacturer.create", targetKind: "manufacturer", targetId: id, before: null, after: record },
        };
    });
}
/**
 * Correct a manufacturer's NAME. Identity, status and provenance are not updatable here -- exactly the Firestore
 * command's surface, which takes a name and nothing else.
 */
async function updateManufacturer(deps, actor, input) {
    return (0, catalogMasterKernel_1.runCatalogCommand)(deps, actor, catalogMasterKernel_1.CATALOG_CAPABILITIES.MANUFACTURER_MANAGE, async (client, now) => {
        const envelope = (0, catalogMasterKernel_1.requirePlainObject)(input, "input");
        const id = requireManufacturerId(envelope.manufacturerId);
        const expectedUpdatedAt = requireExpectedUpdatedAt(envelope.expectedUpdatedAt);
        const name = requireName(envelope.name);
        const normalizedName = (0, manufacturerMigration_1.normalizeName)(name);
        const stored = await lockManufacturer(client, actor.tenantId, id);
        if (stored === null)
            (0, catalogMasterKernel_1.refuse)("MANUFACTURER_NOT_FOUND", "NOT_FOUND", `no manufacturer ${id} in this tenant`);
        const current = stored;
        const already = current.name === name && current.normalizedName === normalizedName;
        // THE REPLAY, decided the same way the sibling writers decide theirs: the record has MOVED PAST the token the
        // caller holds and already says exactly what was asked for. A first attempt that committed and lost its reply
        // is therefore not re-applied, and never double-counted.
        if (already && current.updatedAt > expectedUpdatedAt) {
            return { result: { manufacturerId: id, updatedAt: current.updatedAt }, replayed: true, audit: null };
        }
        if (current.updatedAt !== expectedUpdatedAt) {
            (0, catalogMasterKernel_1.refuse)("VERSION_CONFLICT", "CONFLICT", "the record changed since it was loaded; reload and retry");
        }
        if (already)
            (0, catalogMasterKernel_1.refuse)("NO_CHANGES", "PRECONDITION_FAILED", "the requested name is already the stored name");
        const updatedAt = await applyManufacturerUpdate(client, actor.tenantId, current, { name, normalizedName }, actor.principalId, now);
        const after = { ...current, name, normalizedName, updatedAt };
        return {
            result: { manufacturerId: id, updatedAt }, replayed: false,
            audit: { action: "catalog.manufacturer.update", targetKind: "manufacturer", targetId: id, before: current, after },
        };
    });
}
/**
 * ACTIVE <-> INACTIVE, under `inventory.catalog.activate`.
 *
 * The Firestore command's transition rule is the whole of it: the two statuses are the only ones, and changing to
 * the status the record already has is a REFUSAL there (InvalidStatusTransitionError, "manufacturer already X"),
 * not a no-op. That refusal is preserved -- but only for a caller whose token is current. A caller replaying its
 * own committed change holds a stale token and gets the replay, which is the honest answer to a retry.
 */
async function changeManufacturerStatus(deps, actor, input) {
    return (0, catalogMasterKernel_1.runCatalogCommand)(deps, actor, catalogMasterKernel_1.CATALOG_CAPABILITIES.MANUFACTURER_ACTIVATE, async (client, now) => {
        const envelope = (0, catalogMasterKernel_1.requirePlainObject)(input, "input");
        const id = requireManufacturerId(envelope.manufacturerId);
        const expectedUpdatedAt = requireExpectedUpdatedAt(envelope.expectedUpdatedAt);
        if (typeof envelope.newStatus !== "string" || !types_1.MANUFACTURER_STATUSES.includes(envelope.newStatus)) {
            (0, catalogMasterKernel_1.refuse)("INVALID_INPUT", "INVALID_INPUT", `newStatus must be one of ${types_1.MANUFACTURER_STATUSES.join("/")}`);
        }
        const newStatus = envelope.newStatus;
        const stored = await lockManufacturer(client, actor.tenantId, id);
        if (stored === null)
            (0, catalogMasterKernel_1.refuse)("MANUFACTURER_NOT_FOUND", "NOT_FOUND", `no manufacturer ${id} in this tenant`);
        const current = stored;
        if (current.status === newStatus && current.updatedAt > expectedUpdatedAt) {
            return { result: { manufacturerId: id, updatedAt: current.updatedAt }, replayed: true, audit: null };
        }
        if (current.updatedAt !== expectedUpdatedAt) {
            (0, catalogMasterKernel_1.refuse)("VERSION_CONFLICT", "CONFLICT", "the record changed since it was loaded; reload and retry");
        }
        if (current.status === newStatus) {
            (0, catalogMasterKernel_1.refuse)("INVALID_STATUS_TRANSITION", "PRECONDITION_FAILED", `manufacturer is already ${newStatus}`);
        }
        const updatedAt = await applyManufacturerUpdate(client, actor.tenantId, current, { status: newStatus }, actor.principalId, now);
        const after = { ...current, status: newStatus, updatedAt };
        return {
            result: { manufacturerId: id, updatedAt }, replayed: false,
            audit: { action: "catalog.manufacturer.changeStatus", targetKind: "manufacturer", targetId: id, before: current, after },
        };
    });
}
//# sourceMappingURL=postgresManufacturerWriter.js.map