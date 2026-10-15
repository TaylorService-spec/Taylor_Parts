"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEquipmentModel = createEquipmentModel;
exports.updateEquipmentModel = updateEquipmentModel;
const catalogMasterKernel_1 = require("./catalogMasterKernel");
const catalogRows_1 = require("./catalogRows");
const equipmentModel_1 = require("../equipmentCompatibility/domain/equipmentModel");
/** The caller-writable fields. `version` is absent on purpose (repository authority). */
const MODEL_INPUT_FIELDS = new Set([
    "equipmentModelId", "manufacturerId", "manufacturerName", "modelNumber", "displayName", "family", "subtype", "revision", "status", "sourceAuthority",
]);
/** Identity is immutable; everything else on the governed record may be corrected. */
const MODEL_UPDATABLE_FIELDS = new Set([
    "manufacturerName", "modelNumber", "displayName", "family", "subtype", "revision", "status", "sourceAuthority",
]);
function validatedModel(input) {
    // D1 requires a version; the value is irrelevant to the fields it normalizes and is never persisted from input.
    const v = (0, equipmentModel_1.validateEquipmentModel)({ ...input, version: 1 });
    if (!v.valid)
        (0, catalogMasterKernel_1.refuse)("EQUIPMENT_MODEL_INVALID", "INVALID_INPUT", `the equipment model is invalid: ${v.reason}`);
    const m = v.value;
    return {
        id: m.equipmentModelId, manufacturerId: m.manufacturerId, manufacturerName: m.manufacturerName, modelNumber: m.modelNumber,
        displayName: m.displayName, family: m.family, subtype: m.subtype, revision: m.revision, status: m.status, sourceAuthority: m.sourceAuthority,
    };
}
async function lockModel(client, tenantId, id) {
    const { rows } = await client.query(`${catalogRows_1.EQUIPMENT_MODEL_SELECT} WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, id]);
    return rows.length === 0 ? null : (0, catalogRows_1.equipmentModelFromRow)(rows[0]);
}
/** Create one Equipment Model at its canonical id, version 1. Replays when the row already says exactly this. */
async function createEquipmentModel(deps, actor, input) {
    return (0, catalogMasterKernel_1.runCatalogCommand)(deps, actor, catalogMasterKernel_1.CATALOG_CAPABILITIES.EQUIPMENT_MODEL_MANAGE, async (client, now) => {
        const raw = (0, catalogMasterKernel_1.requirePlainObject)((0, catalogMasterKernel_1.requirePlainObject)(input, "input").model, "model");
        for (const k of Object.keys(raw))
            if (!MODEL_INPUT_FIELDS.has(k))
                (0, catalogMasterKernel_1.refuse)("FIELD_NOT_WRITABLE", "INVALID_INPUT", `field "${k}" is not writable`);
        const fields = validatedModel(raw);
        const existing = await lockModel(client, actor.tenantId, fields.id);
        if (existing !== null) {
            if ((0, catalogRows_1.differingFields)(catalogRows_1.EQUIPMENT_MODEL_MASTER_FIELDS, existing, { ...existing, ...fields }).length === 0) {
                return { result: { equipmentModelId: existing.id, version: existing.version }, replayed: true, audit: null };
            }
            (0, catalogMasterKernel_1.refuse)("EQUIPMENT_MODEL_ALREADY_EXISTS", "CONFLICT", `equipment model ${fields.id} already exists`);
        }
        const at = (0, catalogRows_1.isoMicros)(now);
        const record = { ...fields, version: 1, createdAt: at, updatedAt: at };
        await client.query(catalogRows_1.INSERT_EQUIPMENT_MODEL_SQL, (0, catalogRows_1.insertEquipmentModelValues)(actor.tenantId, record, actor.principalId, actor.principalId));
        return {
            result: { equipmentModelId: record.id, version: 1 }, replayed: false,
            audit: { action: "catalog.equipmentModel.create", targetKind: "equipment_model", targetId: record.id, before: null, after: record },
        };
    });
}
/** Correct an Equipment Model's governed fields under optimistic concurrency. Identity never changes. */
async function updateEquipmentModel(deps, actor, input) {
    return (0, catalogMasterKernel_1.runCatalogCommand)(deps, actor, catalogMasterKernel_1.CATALOG_CAPABILITIES.EQUIPMENT_MODEL_MANAGE, async (client, now) => {
        const envelope = (0, catalogMasterKernel_1.requirePlainObject)(input, "input");
        if (!(0, equipmentModel_1.isCanonicalEquipmentModelId)(envelope.equipmentModelId))
            (0, catalogMasterKernel_1.refuse)("INVALID_INPUT", "INVALID_INPUT", "equipmentModelId must be a canonical equipment model id");
        const id = envelope.equipmentModelId;
        const expectedVersion = (0, catalogMasterKernel_1.requireExpectedVersion)(envelope.expectedVersion);
        const changes = (0, catalogMasterKernel_1.requirePlainObject)(envelope.changes, "changes");
        const keys = Object.keys(changes);
        if (keys.length === 0)
            (0, catalogMasterKernel_1.refuse)("NO_CHANGES", "PRECONDITION_FAILED", "changes must not be empty");
        for (const k of keys)
            if (!MODEL_UPDATABLE_FIELDS.has(k))
                (0, catalogMasterKernel_1.refuse)("FIELD_NOT_UPDATABLE", "INVALID_INPUT", `field "${k}" is not updatable`);
        const existing = await lockModel(client, actor.tenantId, id);
        if (existing === null)
            (0, catalogMasterKernel_1.refuse)("EQUIPMENT_MODEL_NOT_FOUND", "NOT_FOUND", `no equipment model ${id} in this tenant`);
        const stored = existing;
        const { version: _v, createdAt: _c, updatedAt: _u, id: _id, ...storedInput } = stored;
        const merged = validatedModel({ equipmentModelId: id, ...storedInput, ...changes });
        const effective = (0, catalogRows_1.differingFields)(catalogRows_1.EQUIPMENT_MODEL_MASTER_FIELDS, stored, { ...stored, ...merged });
        if (stored.version === expectedVersion + 1 && effective.length === 0) {
            return { result: { equipmentModelId: id, version: stored.version }, replayed: true, audit: null };
        }
        if (stored.version !== expectedVersion)
            (0, catalogMasterKernel_1.refuse)("VERSION_CONFLICT", "CONFLICT", "the record changed since it was loaded; reload and retry");
        if (effective.length === 0)
            (0, catalogMasterKernel_1.refuse)("NO_CHANGES", "PRECONDITION_FAILED", "the requested changes are already the stored values");
        const version = stored.version + 1;
        const updatedAt = (0, catalogRows_1.isoMicros)(now);
        await client.query(`UPDATE eos_ops.equipment_models
          SET manufacturer_name = $3, model_number = $4, display_name = $5, family = $6, subtype = $7, revision = $8,
              status = $9, source_authority = $10, version = $11, updated_by = $12, updated_at = $13
        WHERE tenant_id = $1 AND id = $2 AND version = $14`, [actor.tenantId, id, merged.manufacturerName, merged.modelNumber, merged.displayName, merged.family, merged.subtype,
            merged.revision, merged.status, merged.sourceAuthority, version, actor.principalId, updatedAt, expectedVersion]);
        const after = { ...stored, ...merged, version, updatedAt };
        return {
            result: { equipmentModelId: id, version }, replayed: false,
            audit: { action: "catalog.equipmentModel.update", targetKind: "equipment_model", targetId: id, before: stored, after },
        };
    });
}
//# sourceMappingURL=postgresEquipmentModelWriter.js.map