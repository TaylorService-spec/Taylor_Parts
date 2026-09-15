// The governed PostgreSQL PART MASTER writer -- the cutover target for the Firestore
// partMaster/partMasterCommands.ts createPart / updatePart / changePartStatus (partMasterRepository.ts stageCreate /
// stageUpdate), exported as the `createPart` / `updatePart` / `changePartStatus` callables and used by
// dataImport/firestoreDataImportAdapters.ts.
//
// ════════════════════ DEPENDS ON #1911 AND DEFERRED MIGRATION 027 ════════════════════
//
// Its table is eos_ops.parts: the identity row migration 025 (PR #1911) creates, extended with the descriptive
// columns in functions/migrations/deferred/1759881600000_catalog-master-descriptive-authority.sql. This module
// compiles without either; it cannot run until both are applied (a missing column is COMMAND_FAILED, never a
// partial write).
//
// Domain rules are REUSED from the pure Part Master modules, never restated: validation.ts#validatePart decides
// what a Part is. The two rules that live in the Firebase-importing partMasterCommands.ts (the status transition
// table and controlType immutability) are restated here, and catalogMaster tests assert equality with the Firestore
// originals so the two cannot drift while both exist.
//
// Differences from the Firestore command, each deliberate:
//   * internalPartNumber CHANGE is refused with INTERNAL_PART_NUMBER_ALIAS_AUTHORITY_UNAVAILABLE. The Firestore
//     command preserves the old number as an INTERNAL_PN alias in `part_aliases` atomically with the update; that
//     alias authority has not moved to PostgreSQL, and changing the number without the alias would silently break
//     historical lookup. Fail closed until part_aliases moves (CATALOG_AUTHORITY_GAP, catalog-cutover-plan.md).
//   * idempotency is content-addressed (catalogMasterKernel.ts header); a whole no-op update is NO_CHANGES.
import type { PoolClient } from "pg";
import {
  CATALOG_CAPABILITIES,
  type CatalogActorContext,
  type CatalogCommandDeps,
  type CatalogCommandResult,
  refuse,
  requireExpectedVersion,
  requirePlainObject,
  runCatalogCommand,
} from "./catalogMasterKernel";
import {
  type CanonicalPart,
  canonicalPartOf,
  differingFields,
  INSERT_PART_SQL,
  insertPartValues,
  isoMicros,
  PART_MASTER_FIELDS,
  PART_SELECT,
  partFromRow,
  partInputOf,
} from "./catalogRows";
import { parsePartId, validatePart, type PartInput } from "../partMaster/validation";
import { PART_STATUSES, type PartStatus } from "../partMaster/types";

/** partMasterCommands.ts PART_STATUS_TRANSITIONS, restated (parity asserted by test). */
export const PART_STATUS_TRANSITIONS: Readonly<Record<PartStatus, readonly PartStatus[]>> = Object.freeze({
  DRAFT: ["ACTIVE"],
  ACTIVE: ["INACTIVE", "DISCONTINUED", "SUPERSEDED"],
  INACTIVE: ["ACTIVE", "DISCONTINUED", "SUPERSEDED"],
  DISCONTINUED: [],
  SUPERSEDED: [],
});

/** partMasterCommands.ts UPDATABLE_FIELDS, restated (parity asserted by test). */
export const PART_UPDATABLE_FIELDS: ReadonlySet<string> = new Set([
  "internalPartNumber", "name", "description", "category", "stockingUnit", "controlType", "stockingClass", "flags",
  "manufacturerId", "manufacturerPartNumber", "oemStatus", "wholeUnit", "equipmentModelId",
]);

const PART_CREATE_FIELDS: ReadonlySet<string> = new Set(["partId", "status", ...PART_UPDATABLE_FIELDS]);

export interface PartWriteResult {
  readonly partId: string;
  readonly version: number;
}

type PartFields = Omit<CanonicalPart, "version" | "createdAt" | "updatedAt">;

function validated(input: Record<string, unknown>): PartFields {
  const v = validatePart(input as unknown as PartInput);
  if (!v.valid) refuse("PART_INVALID", "INVALID_INPUT", `the part is invalid: ${v.errors.map((e) => `${e.path}:${e.code}`).join(",")}`);
  const { version: _v, createdAt: _c, updatedAt: _u, ...fields } = canonicalPartOf(v.value, { version: 1, createdAt: "", updatedAt: "" });
  return fields;
}

async function lockPart(client: Pick<PoolClient, "query">, tenantId: string, id: string): Promise<CanonicalPart | null> {
  const { rows } = await client.query(`${PART_SELECT} WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, id]);
  return rows.length === 0 ? null : partFromRow(rows[0]);
}

/** assertEquipmentModelExists, against the tenant's PostgreSQL catalog. */
async function requireEquipmentModel(client: Pick<PoolClient, "query">, tenantId: string, id: string | null): Promise<void> {
  if (id === null) return;
  const { rows } = await client.query(`SELECT 1 FROM eos_ops.equipment_models WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  if (rows.length === 0) refuse("EQUIPMENT_MODEL_NOT_FOUND", "NOT_FOUND", `equipmentModelId ${id} is not an equipment model of this tenant`);
}

const sameMaster = (a: CanonicalPart, fields: PartFields): boolean => differingFields(PART_MASTER_FIELDS, a, { ...a, ...fields }).length === 0;

export async function createPart(
  deps: CatalogCommandDeps,
  actor: CatalogActorContext,
  input: { part: unknown },
): Promise<CatalogCommandResult<PartWriteResult>> {
  return runCatalogCommand(deps, actor, CATALOG_CAPABILITIES.PART_MANAGE, async (client, now) => {
    const raw = requirePlainObject(requirePlainObject(input, "input").part, "part");
    for (const k of Object.keys(raw)) if (!PART_CREATE_FIELDS.has(k)) refuse("FIELD_NOT_WRITABLE", "INVALID_INPUT", `field "${k}" is not writable`);
    const fields = validated(raw);
    const existing = await lockPart(client, actor.tenantId, fields.id);
    if (existing !== null) {
      if (sameMaster(existing, fields)) return { result: { partId: existing.id, version: existing.version }, replayed: true, audit: null };
      refuse("PART_ALREADY_EXISTS", "CONFLICT", `part ${fields.id} already exists`);
    }
    await requireEquipmentModel(client, actor.tenantId, fields.equipmentModelId);
    const at = isoMicros(now);
    const record: CanonicalPart = { ...fields, version: 1, createdAt: at, updatedAt: at };
    await client.query(INSERT_PART_SQL, insertPartValues(actor.tenantId, record, actor.principalId, actor.principalId));
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

async function writeUpdate(client: Pick<PoolClient, "query">, tenantId: string, after: CanonicalPart, actorId: string, expectedVersion: number) {
  await client.query(UPDATE_PART_SQL, [tenantId, after.id, after.internalPartNumber, after.name, after.description, after.category,
    after.status, after.stockingUnit, after.controlType, after.stockingClass, after.expiryTracked, after.consumable,
    after.returnableCore, after.primaryManufacturerId, after.primaryManufacturerPartNumber, after.oemStatus, after.wholeUnit,
    after.equipmentModelId, after.version, actorId, after.updatedAt, expectedVersion]);
}

function requirePartId(value: unknown): string {
  const id = parsePartId(value);
  // parsePartId trims; an id is carried verbatim, so a value that needed trimming is not this id.
  if (!id.valid || id.value !== value) refuse("INVALID_INPUT", "INVALID_INPUT", "partId must be a canonical part id");
  return value as string;
}

export async function updatePart(
  deps: CatalogCommandDeps,
  actor: CatalogActorContext,
  input: { partId: unknown; expectedVersion: unknown; changes: unknown },
): Promise<CatalogCommandResult<PartWriteResult>> {
  return runCatalogCommand(deps, actor, CATALOG_CAPABILITIES.PART_MANAGE, async (client, now) => {
    const envelope = requirePlainObject(input, "input");
    const id = requirePartId(envelope.partId);
    const expectedVersion = requireExpectedVersion(envelope.expectedVersion);
    const changes = requirePlainObject(envelope.changes, "changes");
    const keys = Object.keys(changes);
    if (keys.length === 0) refuse("NO_CHANGES", "PRECONDITION_FAILED", "changes must not be empty");
    for (const k of keys) if (!PART_UPDATABLE_FIELDS.has(k)) refuse("FIELD_NOT_UPDATABLE", "INVALID_INPUT", `field "${k}" is not updatable`);

    const stored = await lockPart(client, actor.tenantId, id);
    if (stored === null) refuse("PART_NOT_FOUND", "NOT_FOUND", `no part ${id} in this tenant`);
    const merged = validated({ ...partInputOf(stored), ...changes, partId: id, status: stored.status });
    const effective = differingFields(PART_MASTER_FIELDS, stored, { ...stored, ...merged });

    if (stored.version === expectedVersion + 1 && effective.length === 0) {
      return { result: { partId: id, version: stored.version }, replayed: true, audit: null };
    }
    if (stored.version !== expectedVersion) refuse("VERSION_CONFLICT", "CONFLICT", "the record changed since it was loaded; reload and retry");
    if (effective.length === 0) refuse("NO_CHANGES", "PRECONDITION_FAILED", "the requested changes are already the stored values");
    // P1B R2 (partMasterCommands.ts assertControlTypeImmutable): a real change refuses; a same-value resend does not.
    if (merged.controlType !== stored.controlType) refuse("CONTROL_TYPE_IMMUTABLE", "PRECONDITION_FAILED", "a part's control type cannot be changed after it is created");
    if (merged.internalPartNumber !== stored.internalPartNumber) {
      refuse("INTERNAL_PART_NUMBER_ALIAS_AUTHORITY_UNAVAILABLE", "UNAVAILABLE",
        "changing internalPartNumber requires preserving the prior number as an alias, and the alias authority is not in PostgreSQL");
    }
    await requireEquipmentModel(client, actor.tenantId, merged.equipmentModelId);
    const after: CanonicalPart = { ...stored, ...merged, version: stored.version + 1, updatedAt: isoMicros(now) };
    await writeUpdate(client, actor.tenantId, after, actor.principalId, expectedVersion);
    return {
      result: { partId: id, version: after.version }, replayed: false,
      audit: { action: "catalog.part.update", targetKind: "part", targetId: id, before: stored, after },
    };
  });
}

export async function changePartStatus(
  deps: CatalogCommandDeps,
  actor: CatalogActorContext,
  input: { partId: unknown; expectedVersion: unknown; newStatus: unknown },
): Promise<CatalogCommandResult<PartWriteResult>> {
  return runCatalogCommand(deps, actor, CATALOG_CAPABILITIES.PART_ACTIVATE, async (client, now) => {
    const envelope = requirePlainObject(input, "input");
    const id = requirePartId(envelope.partId);
    const expectedVersion = requireExpectedVersion(envelope.expectedVersion);
    if (!(PART_STATUSES as readonly unknown[]).includes(envelope.newStatus)) refuse("INVALID_INPUT", "INVALID_INPUT", `newStatus must be one of ${PART_STATUSES.join("/")}`);
    const to = envelope.newStatus as PartStatus;

    const stored = await lockPart(client, actor.tenantId, id);
    if (stored === null) refuse("PART_NOT_FOUND", "NOT_FOUND", `no part ${id} in this tenant`);
    if (stored.version === expectedVersion + 1 && stored.status === to) {
      return { result: { partId: id, version: stored.version }, replayed: true, audit: null };
    }
    if (stored.version !== expectedVersion) refuse("VERSION_CONFLICT", "CONFLICT", "the record changed since it was loaded; reload and retry");
    if (!PART_STATUS_TRANSITIONS[stored.status as PartStatus].includes(to)) {
      refuse("ILLEGAL_TRANSITION", "PRECONDITION_FAILED", `transition ${stored.status} -> ${to} is not allowed`);
    }
    const after: CanonicalPart = { ...stored, status: to, version: stored.version + 1, updatedAt: isoMicros(now) };
    await writeUpdate(client, actor.tenantId, after, actor.principalId, expectedVersion);
    return {
      result: { partId: id, version: after.version }, replayed: false,
      audit: { action: "catalog.part.changeStatus", targetKind: "part", targetId: id, before: stored, after },
    };
  });
}
