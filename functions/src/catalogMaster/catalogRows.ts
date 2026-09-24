// The CANONICAL catalog records and their one PostgreSQL row shape -- shared by the governed writers
// (postgresPartMasterWriter.ts, postgresEquipmentModelWriter.ts) and the one-time copy / verify
// (catalogCutover.ts), so "what a Part is" and "what reconciles" are stated once.
//
// A canonical record is exactly the governed field set the Firestore repository adapters read back
// (partMaster/partMasterRepository.ts#partFromFirestore, equipmentCompatibility/equipmentModelRepository.ts
// #modelFromFirestore) plus version and the two timestamps. Actor columns are provenance, not master data, and are
// deliberately NOT part of the canonical record (the copy records its own operator; see catalog-cutover-plan.md).
//
// Timestamps are carried as UTC ISO-8601 strings with EXACTLY six fractional digits: PostgreSQL TIMESTAMPTZ is
// microsecond-precise, so that is the precision at which "identical" is decidable in both directions.
import type { Part } from "../partMaster/types";

export interface CanonicalPart {
  readonly id: string;
  readonly internalPartNumber: string;
  readonly name: string;
  readonly description: string | null;
  readonly category: string | null;
  readonly status: string;
  readonly stockingUnit: string;
  readonly controlType: string;
  readonly stockingClass: string;
  readonly expiryTracked: boolean;
  readonly consumable: boolean;
  readonly returnableCore: boolean;
  readonly primaryManufacturerId: string | null;
  readonly primaryManufacturerPartNumber: string | null;
  readonly oemStatus: string | null;
  readonly wholeUnit: boolean;
  readonly equipmentModelId: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CanonicalEquipmentModel {
  readonly id: string;
  readonly manufacturerId: string;
  readonly manufacturerName: string;
  readonly modelNumber: string;
  readonly displayName: string;
  readonly family: string | null;
  readonly subtype: string | null;
  readonly revision: string | null;
  readonly status: string;
  readonly sourceAuthority: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * A Manufacturer as eos_ops.manufacturers records it.
 *
 * NO `version`. Migration 1761782400000 gives this table no version column -- unlike `parts` and
 * `equipment_models`, both of which have one -- so `updatedAt` IS this record's optimistic-concurrency
 * token. It is microsecond-precise, server-authored and, by the writer's own UPDATE, strictly increasing,
 * which is everything a version integer was being used for.
 *
 * `normalizedName` is DERIVED, never accepted: manufacturerMigration.ts#normalizeName is the one statement
 * of that derivation and this record reuses it.
 */
export interface CanonicalManufacturer {
  readonly id: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly status: string;
  readonly provenance: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const PART_FIELDS = Object.freeze([
  "id", "internalPartNumber", "name", "description", "category", "status", "stockingUnit", "controlType", "stockingClass",
  "expiryTracked", "consumable", "returnableCore", "primaryManufacturerId", "primaryManufacturerPartNumber", "oemStatus",
  "wholeUnit", "equipmentModelId", "version", "createdAt", "updatedAt",
] as const);

export const EQUIPMENT_MODEL_FIELDS = Object.freeze([
  "id", "manufacturerId", "manufacturerName", "modelNumber", "displayName", "family", "subtype", "revision", "status",
  "sourceAuthority", "version", "createdAt", "updatedAt",
] as const);

export const MANUFACTURER_FIELDS = Object.freeze([
  "id", "name", "normalizedName", "status", "provenance", "createdAt", "updatedAt",
] as const);

/** A JS Date (millisecond) as the canonical microsecond ISO string. */
export function isoMicros(date: Date): string {
  const iso = date.toISOString(); // YYYY-MM-DDTHH:MM:SS.sssZ
  return `${iso.slice(0, 23)}000Z`;
}

const TS = (column: string) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export const PART_SELECT = `
SELECT id, internal_part_number, name, description, category, status::text AS status, stocking_unit::text AS stocking_unit,
       control_type::text AS control_type, stocking_class::text AS stocking_class, expiry_tracked, consumable, returnable_core,
       primary_manufacturer_id, primary_manufacturer_part_number, oem_status::text AS oem_status, whole_unit, equipment_model_id,
       version, ${TS("created_at")} AS created_at, ${TS("updated_at")} AS updated_at
  FROM eos_ops.parts`;

export const EQUIPMENT_MODEL_SELECT = `
SELECT id, manufacturer_id, manufacturer_name, model_number, display_name, family, subtype, revision, status::text AS status,
       source_authority, version, ${TS("created_at")} AS created_at, ${TS("updated_at")} AS updated_at
  FROM eos_ops.equipment_models`;

export const MANUFACTURER_SELECT = `
SELECT id, name, normalized_name, status, provenance,
       ${TS("created_at")} AS created_at, ${TS("updated_at")} AS updated_at
  FROM eos_ops.manufacturers`;

type Row = Record<string, unknown>;
const text = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export function partFromRow(r: Row): CanonicalPart {
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

export function equipmentModelFromRow(r: Row): CanonicalEquipmentModel {
  return {
    id: String(r.id), manufacturerId: String(r.manufacturer_id), manufacturerName: String(r.manufacturer_name),
    modelNumber: String(r.model_number), displayName: String(r.display_name), family: text(r.family), subtype: text(r.subtype),
    revision: text(r.revision), status: String(r.status), sourceAuthority: String(r.source_authority),
    version: Number(r.version), createdAt: String(r.created_at), updatedAt: String(r.updated_at),
  };
}

export function manufacturerFromRow(r: Row): CanonicalManufacturer {
  return {
    id: String(r.id), name: String(r.name), normalizedName: String(r.normalized_name),
    status: String(r.status), provenance: String(r.provenance),
    createdAt: String(r.created_at), updatedAt: String(r.updated_at),
  };
}

/** A validated domain Part (validatePart's output) with its version and timestamps, as a canonical record. */
export function canonicalPartOf(part: Part, meta: { version: number; createdAt: string; updatedAt: string }): CanonicalPart {
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
export function partInputOf(p: CanonicalPart): Record<string, unknown> {
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
export function differingFields<T extends object>(fields: readonly (keyof T & string)[], a: T, b: T): string[] {
  return fields.filter((f) => a[f] !== b[f]);
}

/** Master-data fields only (no version, no timestamps): does a stored record already say exactly this? */
export const PART_MASTER_FIELDS = PART_FIELDS.filter((f) => f !== "version" && f !== "createdAt" && f !== "updatedAt");
export const EQUIPMENT_MODEL_MASTER_FIELDS = EQUIPMENT_MODEL_FIELDS.filter((f) => f !== "version" && f !== "createdAt" && f !== "updatedAt");
// Master data only. `provenance` is IN the set: NATIVE and MIGRATED are not the same record, and a
// create that would silently reclassify a migrated row is a conflict, not a replay.
export const MANUFACTURER_MASTER_FIELDS = MANUFACTURER_FIELDS.filter((f) => f !== "createdAt" && f !== "updatedAt");

export const INSERT_PART_SQL = `
INSERT INTO eos_ops.parts
  (tenant_id, id, internal_part_number, name, description, category, status, stocking_unit, control_type, stocking_class,
   expiry_tracked, consumable, returnable_core, primary_manufacturer_id, primary_manufacturer_part_number, oem_status,
   whole_unit, equipment_model_id, version, created_by, created_at, updated_by, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)`;

export function insertPartValues(tenantId: string, p: CanonicalPart, createdBy: string, updatedBy: string): unknown[] {
  return [tenantId, p.id, p.internalPartNumber, p.name, p.description, p.category, p.status, p.stockingUnit, p.controlType,
    p.stockingClass, p.expiryTracked, p.consumable, p.returnableCore, p.primaryManufacturerId, p.primaryManufacturerPartNumber,
    p.oemStatus, p.wholeUnit, p.equipmentModelId, p.version, createdBy, p.createdAt, updatedBy, p.updatedAt];
}

export const INSERT_EQUIPMENT_MODEL_SQL = `
INSERT INTO eos_ops.equipment_models
  (tenant_id, id, manufacturer_id, manufacturer_name, model_number, display_name, family, subtype, revision, status,
   source_authority, version, created_by, created_at, updated_by, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`;

export function insertEquipmentModelValues(tenantId: string, m: CanonicalEquipmentModel, createdBy: string, updatedBy: string): unknown[] {
  return [tenantId, m.id, m.manufacturerId, m.manufacturerName, m.modelNumber, m.displayName, m.family, m.subtype, m.revision,
    m.status, m.sourceAuthority, m.version, createdBy, m.createdAt, updatedBy, m.updatedAt];
}

export const INSERT_MANUFACTURER_SQL = `
INSERT INTO eos_ops.manufacturers
  (tenant_id, id, name, normalized_name, status, provenance, created_by, created_at, updated_by, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`;

export function insertManufacturerValues(tenantId: string, m: CanonicalManufacturer, createdBy: string, updatedBy: string): unknown[] {
  return [tenantId, m.id, m.name, m.normalizedName, m.status, m.provenance, createdBy, m.createdAt, updatedBy, m.updatedAt];
}
