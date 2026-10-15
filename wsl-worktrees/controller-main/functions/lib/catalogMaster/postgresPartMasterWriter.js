"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PART_UPDATABLE_FIELDS = exports.PART_STATUS_TRANSITIONS = void 0;
exports.createPart = createPart;
exports.updatePart = updatePart;
exports.changePartStatus = changePartStatus;
const catalogMasterKernel_1 = require("./catalogMasterKernel");
const catalogRows_1 = require("./catalogRows");
const validation_1 = require("../partMaster/validation");
const types_1 = require("../partMaster/types");
/** partMasterCommands.ts PART_STATUS_TRANSITIONS, restated (parity asserted by test). */
exports.PART_STATUS_TRANSITIONS = Object.freeze({
    DRAFT: ["ACTIVE"],
    ACTIVE: ["INACTIVE", "DISCONTINUED", "SUPERSEDED"],
    INACTIVE: ["ACTIVE", "DISCONTINUED", "SUPERSEDED"],
    DISCONTINUED: [],
    SUPERSEDED: [],
});
/** partMasterCommands.ts UPDATABLE_FIELDS, restated (parity asserted by test). */
exports.PART_UPDATABLE_FIELDS = new Set([
    "internalPartNumber", "name", "description", "category", "stockingUnit", "controlType", "stockingClass", "flags",
    "manufacturerId", "manufacturerPartNumber", "oemStatus", "wholeUnit", "equipmentModelId",
]);
const PART_CREATE_FIELDS = new Set(["partId", "status", ...exports.PART_UPDATABLE_FIELDS]);
function validated(input) {
    const v = (0, validation_1.validatePart)(input);
    if (!v.valid)
        (0, catalogMasterKernel_1.refuse)("PART_INVALID", "INVALID_INPUT", `the part is invalid: ${v.errors.map((e) => `${e.path}:${e.code}`).join(",")}`);
    const { version: _v, createdAt: _c, updatedAt: _u, ...fields } = (0, catalogRows_1.canonicalPartOf)(v.value, { version: 1, createdAt: "", updatedAt: "" });
    return fields;
}
async function lockPart(client, tenantId, id) {
    const { rows } = await client.query(`${catalogRows_1.PART_SELECT} WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, id]);
    return rows.length === 0 ? null : (0, catalogRows_1.partFromRow)(rows[0]);
}
/** assertEquipmentModelExists, against the tenant's PostgreSQL catalog. */
async function requireEquipmentModel(client, tenantId, id) {
    if (id === null)
        return;
    const { rows } = await client.query(`SELECT 1 FROM eos_ops.equipment_models WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
    if (rows.length === 0)
        (0, catalogMasterKernel_1.refuse)("EQUIPMENT_MODEL_NOT_FOUND", "NOT_FOUND", `equipmentModelId ${id} is not an equipment model of this tenant`);
}
const sameMaster = (a, fields) => (0, catalogRows_1.differingFields)(catalogRows_1.PART_MASTER_FIELDS, a, { ...a, ...fields }).length === 0;
async function createPart(deps, actor, input) {
    return (0, catalogMasterKernel_1.runCatalogCommand)(deps, actor, catalogMasterKernel_1.CATALOG_CAPABILITIES.PART_MANAGE, async (client, now) => {
        const raw = (0, catalogMasterKernel_1.requirePlainObject)((0, catalogMasterKernel_1.requirePlainObject)(input, "input").part, "part");
        for (const k of Object.keys(raw))
            if (!PART_CREATE_FIELDS.has(k))
                (0, catalogMasterKernel_1.refuse)("FIELD_NOT_WRITABLE", "INVALID_INPUT", `field "${k}" is not writable`);
        const fields = validated(raw);
        const existing = await lockPart(client, actor.tenantId, fields.id);
        if (existing !== null) {
            if (sameMaster(existing, fields))
                return { result: { partId: existing.id, version: existing.version }, replayed: true, audit: null };
            (0, catalogMasterKernel_1.refuse)("PART_ALREADY_EXISTS", "CONFLICT", `part ${fields.id} already exists`);
        }
        await requireEquipmentModel(client, actor.tenantId, fields.equipmentModelId);
        const at = (0, catalogRows_1.isoMicros)(now);
        const record = { ...fields, version: 1, createdAt: at, updatedAt: at };
        await client.query(catalogRows_1.INSERT_PART_SQL, (0, catalogRows_1.insertPartValues)(actor.tenantId, record, actor.principalId, actor.principalId));
        return {
            result: { partId: record.id, version: 1 }, replayed: false,
            audit: { action: "catalog.part.create", targetKind: "part", targetId: record.id, before: null, after: record },
        };
    });
}
const UPDATE_PART_SQL = `
UPDATE eos_ops.parts
   SET internal_part_number = $3, name = $4, description = $5, category = $6, status = $7, stocking_unit = $8,
       control_type = $9, stocking_class = $10, expiry_tracked = $11, consumable = $12, returnable_core = $13,
       primary_manufacturer_id = $14, primary_manufacturer_part_number = $15, oem_status = $16, whole_unit = $17,
       equipment_model_id = $18, version = $19, updated_by = $20, updated_at = $21
 WHERE tenant_id = $1 AND id = $2 AND version = $22`;
async function writeUpdate(client, tenantId, after, actorId, expectedVersion) {
    await client.query(UPDATE_PART_SQL, [tenantId, after.id, after.internalPartNumber, after.name, after.description, after.category,
        after.status, after.stockingUnit, after.controlType, after.stockingClass, after.expiryTracked, after.consumable,
        after.returnableCore, after.primaryManufacturerId, after.primaryManufacturerPartNumber, after.oemStatus, after.wholeUnit,
        after.equipmentModelId, after.version, actorId, after.updatedAt, expectedVersion]);
}
function requirePartId(value) {
    const id = (0, validation_1.parsePartId)(value);
    // parsePartId trims; an id is carried verbatim, so a value that needed trimming is not this id.
    if (!id.valid || id.value !== value)
        (0, catalogMasterKernel_1.refuse)("INVALID_INPUT", "INVALID_INPUT", "partId must be a canonical part id");
    return value;
}
async function updatePart(deps, actor, input) {
    return (0, catalogMasterKernel_1.runCatalogCommand)(deps, actor, catalogMasterKernel_1.CATALOG_CAPABILITIES.PART_MANAGE, async (client, now) => {
        const envelope = (0, catalogMasterKernel_1.requirePlainObject)(input, "input");
        const id = requirePartId(envelope.partId);
        const expectedVersion = (0, catalogMasterKernel_1.requireExpectedVersion)(envelope.expectedVersion);
        const changes = (0, catalogMasterKernel_1.requirePlainObject)(envelope.changes, "changes");
        const keys = Object.keys(changes);
        if (keys.length === 0)
            (0, catalogMasterKernel_1.refuse)("NO_CHANGES", "PRECONDITION_FAILED", "changes must not be empty");
        for (const k of keys)
            if (!exports.PART_UPDATABLE_FIELDS.has(k))
                (0, catalogMasterKernel_1.refuse)("FIELD_NOT_UPDATABLE", "INVALID_INPUT", `field "${k}" is not updatable`);
        const stored = await lockPart(client, actor.tenantId, id);
        if (stored === null)
            (0, catalogMasterKernel_1.refuse)("PART_NOT_FOUND", "NOT_FOUND", `no part ${id} in this tenant`);
        const merged = validated({ ...(0, catalogRows_1.partInputOf)(stored), ...changes, partId: id, status: stored.status });
        const effective = (0, catalogRows_1.differingFields)(catalogRows_1.PART_MASTER_FIELDS, stored, { ...stored, ...merged });
        if (stored.version === expectedVersion + 1 && effective.length === 0) {
            return { result: { partId: id, version: stored.version }, replayed: true, audit: null };
        }
        if (stored.version !== expectedVersion)
            (0, catalogMasterKernel_1.refuse)("VERSION_CONFLICT", "CONFLICT", "the record changed since it was loaded; reload and retry");
        if (effective.length === 0)
            (0, catalogMasterKernel_1.refuse)("NO_CHANGES", "PRECONDITION_FAILED", "the requested changes are already the stored values");
        // P1B R2 (partMasterCommands.ts assertControlTypeImmutable): a real change refuses; a same-value resend does not.
        if (merged.controlType !== stored.controlType)
            (0, catalogMasterKernel_1.refuse)("CONTROL_TYPE_IMMUTABLE", "PRECONDITION_FAILED", "a part's control type cannot be changed after it is created");
        if (merged.internalPartNumber !== stored.internalPartNumber) {
            (0, catalogMasterKernel_1.refuse)("INTERNAL_PART_NUMBER_ALIAS_AUTHORITY_UNAVAILABLE", "UNAVAILABLE", "changing internalPartNumber requires preserving the prior number as an alias, and the alias authority is not in PostgreSQL");
        }
        await requireEquipmentModel(client, actor.tenantId, merged.equipmentModelId);
        const after = { ...stored, ...merged, version: stored.version + 1, updatedAt: (0, catalogRows_1.isoMicros)(now) };
        await writeUpdate(client, actor.tenantId, after, actor.principalId, expectedVersion);
        return {
            result: { partId: id, version: after.version }, replayed: false,
            audit: { action: "catalog.part.update", targetKind: "part", targetId: id, before: stored, after },
        };
    });
}
async function changePartStatus(deps, actor, input) {
    return (0, catalogMasterKernel_1.runCatalogCommand)(deps, actor, catalogMasterKernel_1.CATALOG_CAPABILITIES.PART_ACTIVATE, async (client, now) => {
        const envelope = (0, catalogMasterKernel_1.requirePlainObject)(input, "input");
        const id = requirePartId(envelope.partId);
        const expectedVersion = (0, catalogMasterKernel_1.requireExpectedVersion)(envelope.expectedVersion);
        if (!types_1.PART_STATUSES.includes(envelope.newStatus))
            (0, catalogMasterKernel_1.refuse)("INVALID_INPUT", "INVALID_INPUT", `newStatus must be one of ${types_1.PART_STATUSES.join("/")}`);
        const to = envelope.newStatus;
        const stored = await lockPart(client, actor.tenantId, id);
        if (stored === null)
            (0, catalogMasterKernel_1.refuse)("PART_NOT_FOUND", "NOT_FOUND", `no part ${id} in this tenant`);
        if (stored.version === expectedVersion + 1 && stored.status === to) {
            return { result: { partId: id, version: stored.version }, replayed: true, audit: null };
        }
        if (stored.version !== expectedVersion)
            (0, catalogMasterKernel_1.refuse)("VERSION_CONFLICT", "CONFLICT", "the record changed since it was loaded; reload and retry");
        if (!exports.PART_STATUS_TRANSITIONS[stored.status].includes(to)) {
            (0, catalogMasterKernel_1.refuse)("ILLEGAL_TRANSITION", "PRECONDITION_FAILED", `transition ${stored.status} -> ${to} is not allowed`);
        }
        const after = { ...stored, status: to, version: stored.version + 1, updatedAt: (0, catalogRows_1.isoMicros)(now) };
        await writeUpdate(client, actor.tenantId, after, actor.principalId, expectedVersion);
        return {
            result: { partId: id, version: after.version }, replayed: false,
            audit: { action: "catalog.part.changeStatus", targetKind: "part", targetId: id, before: stored, after },
        };
    });
}
//# sourceMappingURL=postgresPartMasterWriter.js.map