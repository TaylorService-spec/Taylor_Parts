"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.INSERT_MANUFACTURER_SQL = exports.INSERT_EQUIPMENT_MODEL_SQL = exports.INSERT_PART_SQL = exports.MANUFACTURER_MASTER_FIELDS = exports.EQUIPMENT_MODEL_MASTER_FIELDS = exports.PART_MASTER_FIELDS = exports.MANUFACTURER_SELECT = exports.EQUIPMENT_MODEL_SELECT = exports.PART_SELECT = exports.MANUFACTURER_FIELDS = exports.EQUIPMENT_MODEL_FIELDS = exports.PART_FIELDS = void 0;
exports.isoMicros = isoMicros;
exports.partFromRow = partFromRow;
exports.equipmentModelFromRow = equipmentModelFromRow;
exports.manufacturerFromRow = manufacturerFromRow;
exports.canonicalPartOf = canonicalPartOf;
exports.partInputOf = partInputOf;
exports.differingFields = differingFields;
exports.insertPartValues = insertPartValues;
exports.insertEquipmentModelValues = insertEquipmentModelValues;
exports.insertManufacturerValues = insertManufacturerValues;
exports.PART_FIELDS = Object.freeze([
    "id", "internalPartNumber", "name", "description", "category", "status", "stockingUnit", "controlType", "stockingClass",
    "expiryTracked", "consumable", "returnableCore", "primaryManufacturerId", "primaryManufacturerPartNumber", "oemStatus",
    "wholeUnit", "equipmentModelId", "version", "createdAt", "updatedAt",
]);
exports.EQUIPMENT_MODEL_FIELDS = Object.freeze([
    "id", "manufacturerId", "manufacturerName", "modelNumber", "displayName", "family", "subtype", "revision", "status",
    "sourceAuthority", "version", "createdAt", "updatedAt",
]);
exports.MANUFACTURER_FIELDS = Object.freeze([
    "id", "name", "normalizedName", "status", "provenance", "createdAt", "updatedAt",
]);
/** A JS Date (millisecond) as the canonical microsecond ISO string. */
function isoMicros(date) {
    const iso = date.toISOString(); // YYYY-MM-DDTHH:MM:SS.sssZ
    return `${iso.slice(0, 23)}000Z`;
}
const TS = (column) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
exports.PART_SELECT = `
SELECT id, internal_part_number, name, description, category, status::text AS status, stocking_unit::text AS stocking_unit,
       control_type::text AS control_type, stocking_class::text AS stocking_class, expiry_tracked, consumable, returnable_core,
       primary_manufacturer_id, primary_manufacturer_part_number, oem_status::text AS oem_status, whole_unit, equipment_model_id,
       version, ${TS("created_at")} AS created_at, ${TS("updated_at")} AS updated_at
  FROM eos_ops.parts`;
exports.EQUIPMENT_MODEL_SELECT = `
SELECT id, manufacturer_id, manufacturer_name, model_number, display_name, family, subtype, revision, status::text AS status,
       source_authority, version, ${TS("created_at")} AS created_at, ${TS("updated_at")} AS updated_at
  FROM eos_ops.equipment_models`;
exports.MANUFACTURER_SELECT = `
SELECT id, name, normalized_name, status, provenance,
       ${TS("created_at")} AS created_at, ${TS("updated_at")} AS updated_at
  FROM eos_ops.manufacturers`;
const text = (v) => (v === null || v === undefined ? null : String(v));
function partFromRow(r) {
    return {
        id: String(r.id), internalPartNumber: String(r.internal_part_number), name: String(r.name),
        description: text(r.description), category: text(r.category), status: String(r.status),
        stockingUnit: String(r.stocking_unit), controlType: String(r.control_type), stockingClass: String(r.stocking_class),
        expiryTracked: r.expiry_tracked === true, consumable: r.consumable === true, returnableCore: r.returnable_core === true,
        primaryManufacturerId: text(r.primary_manufacturer_id), primaryManufacturerPartNumber: text(r.primary_manufacturer_part_number),
        oemStatus: text(r.oem_status), wholeUnit: r.whole_unit === true, equipmentModelId: text(r.equipment_model_id),
        version: Number(r.version), createdAt: String(r.created_at), updatedAt: String(r.updated_at),
    };
}
function equipmentModelFromRow(r) {
    return {
        id: String(r.id), manufacturerId: String(r.manufacturer_id), manufacturerName: String(r.manufacturer_name),
        modelNumber: String(r.model_number), displayName: String(r.display_name), family: text(r.family), subtype: text(r.subtype),
        revision: text(r.revision), status: String(r.status), sourceAuthority: String(r.source_authority),
        version: Number(r.version), createdAt: String(r.created_at), updatedAt: String(r.updated_at),
    };
}
function manufacturerFromRow(r) {
    return {
        id: String(r.id), name: String(r.name), normalizedName: String(r.normalized_name),
        status: String(r.status), provenance: String(r.provenance),
        createdAt: String(r.created_at), updatedAt: String(r.updated_at),
    };
}
/** A validated domain Part (validatePart's output) with its version and timestamps, as a canonical record. */
function canonicalPartOf(part, meta) {
    return {
        id: part.partId, internalPartNumber: part.internalPartNumber, name: part.name,
        description: part.description ?? null, category: part.category ?? null, status: part.status,
        stockingUnit: part.stockingUnit, controlType: part.controlType, stockingClass: part.stockingClass,
        expiryTracked: part.flags.expiryTracked, consumable: part.flags.consumable, returnableCore: part.flags.returnableCore,
        primaryManufacturerId: part.manufacturerId ?? null, primaryManufacturerPartNumber: part.manufacturerPartNumber ?? null,
        oemStatus: part.oemStatus ?? null, wholeUnit: part.wholeUnit === true, equipmentModelId: part.equipmentModelId ?? null,
        version: meta.version, createdAt: meta.createdAt, updatedAt: meta.updatedAt,
    };
}
/** The domain PartInput a canonical record re-validates as (the inverse of canonicalPartOf). */
function partInputOf(p) {
    return {
        partId: p.id, internalPartNumber: p.internalPartNumber, name: p.name,
        ...(p.description !== null ? { description: p.description } : {}),
        ...(p.category !== null ? { category: p.category } : {}),
        status: p.status, stockingUnit: p.stockingUnit, controlType: p.controlType, stockingClass: p.stockingClass,
        flags: { expiryTracked: p.expiryTracked, consumable: p.consumable, returnableCore: p.returnableCore },
        ...(p.primaryManufacturerId !== null ? { manufacturerId: p.primaryManufacturerId } : {}),
        ...(p.primaryManufacturerPartNumber !== null ? { manufacturerPartNumber: p.primaryManufacturerPartNumber } : {}),
        ...(p.oemStatus !== null ? { oemStatus: p.oemStatus } : {}),
        ...(p.wholeUnit ? { wholeUnit: true } : {}),
        ...(p.equipmentModelId !== null ? { equipmentModelId: p.equipmentModelId } : {}),
    };
}
/** Field names on which two canonical records differ, in declared order. Empty = identical. */
function differingFields(fields, a, b) {
    return fields.filter((f) => a[f] !== b[f]);
}
/** Master-data fields only (no version, no timestamps): does a stored record already say exactly this? */
exports.PART_MASTER_FIELDS = exports.PART_FIELDS.filter((f) => f !== "version" && f !== "createdAt" && f !== "updatedAt");
exports.EQUIPMENT_MODEL_MASTER_FIELDS = exports.EQUIPMENT_MODEL_FIELDS.filter((f) => f !== "version" && f !== "createdAt" && f !== "updatedAt");
// Master data only. `provenance` is IN the set: NATIVE and MIGRATED are not the same record, and a
// create that would silently reclassify a migrated row is a conflict, not a replay.
exports.MANUFACTURER_MASTER_FIELDS = exports.MANUFACTURER_FIELDS.filter((f) => f !== "createdAt" && f !== "updatedAt");
exports.INSERT_PART_SQL = `
INSERT INTO eos_ops.parts
  (tenant_id, id, internal_part_number, name, description, category, status, stocking_unit, control_type, stocking_class,
   expiry_tracked, consumable, returnable_core, primary_manufacturer_id, primary_manufacturer_part_number, oem_status,
   whole_unit, equipment_model_id, version, created_by, created_at, updated_by, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)`;
function insertPartValues(tenantId, p, createdBy, updatedBy) {
    return [tenantId, p.id, p.internalPartNumber, p.name, p.description, p.category, p.status, p.stockingUnit, p.controlType,
        p.stockingClass, p.expiryTracked, p.consumable, p.returnableCore, p.primaryManufacturerId, p.primaryManufacturerPartNumber,
        p.oemStatus, p.wholeUnit, p.equipmentModelId, p.version, createdBy, p.createdAt, updatedBy, p.updatedAt];
}
exports.INSERT_EQUIPMENT_MODEL_SQL = `
INSERT INTO eos_ops.equipment_models
  (tenant_id, id, manufacturer_id, manufacturer_name, model_number, display_name, family, subtype, revision, status,
   source_authority, version, created_by, created_at, updated_by, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`;
function insertEquipmentModelValues(tenantId, m, createdBy, updatedBy) {
    return [tenantId, m.id, m.manufacturerId, m.manufacturerName, m.modelNumber, m.displayName, m.family, m.subtype, m.revision,
        m.status, m.sourceAuthority, m.version, createdBy, m.createdAt, updatedBy, m.updatedAt];
}
exports.INSERT_MANUFACTURER_SQL = `
INSERT INTO eos_ops.manufacturers
  (tenant_id, id, name, normalized_name, status, provenance, created_by, created_at, updated_by, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`;
function insertManufacturerValues(tenantId, m, createdBy, updatedBy) {
    return [tenantId, m.id, m.name, m.normalizedName, m.status, m.provenance, createdBy, m.createdAt, updatedBy, m.updatedAt];
}
//# sourceMappingURL=catalogRows.js.map