// The governed PostgreSQL EQUIPMENT MODEL writer -- the cutover target for the Firestore
// equipmentCompatibility/commands.ts `importEquipmentModel` action (equipmentModelRepository.ts stageCreate /
// stageUpdate). eos_ops.equipment_models (migration 008) is its table; nothing else writes it.
//
// Identity and validation are the merged D1 contract's, reused, never restated:
// equipmentCompatibility/domain/equipmentModel.ts#validateEquipmentModel (pure, no Firebase) decides what a model
// is, and its canonical `{manufacturerId}--{modelNumber}` id is carried verbatim -- no remapping.
//
// Deliberate tightenings against the Firestore command, each because the governed PostgreSQL contract is stated
// once and a caller cannot reach around it:
//   * `version` is REPOSITORY authority. The Firestore import takes it from the payload; here a create is version 1
//     and an update is expectedVersion + 1. A payload `version` is refused as an unknown field.
//   * An update that changes nothing is NO_CHANGES rather than a version bump.
//   * Idempotency is content-addressed (catalogMasterKernel.ts header).
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
  type CanonicalEquipmentModel,
  EQUIPMENT_MODEL_MASTER_FIELDS,
  EQUIPMENT_MODEL_SELECT,
  differingFields,
  equipmentModelFromRow,
  INSERT_EQUIPMENT_MODEL_SQL,
  insertEquipmentModelValues,
  isoMicros,
} from "./catalogRows";
import { isCanonicalEquipmentModelId, validateEquipmentModel } from "../equipmentCompatibility/domain/equipmentModel";

/** The caller-writable fields. `version` is absent on purpose (repository authority). */
const MODEL_INPUT_FIELDS: ReadonlySet<string> = new Set([
  "equipmentModelId", "manufacturerId", "manufacturerName", "modelNumber", "displayName", "family", "subtype", "revision", "status", "sourceAuthority",
]);
/** Identity is immutable; everything else on the governed record may be corrected. */
const MODEL_UPDATABLE_FIELDS: ReadonlySet<string> = new Set([
  "manufacturerName", "modelNumber", "displayName", "family", "subtype", "revision", "status", "sourceAuthority",
]);

export interface EquipmentModelWriteResult {
  readonly equipmentModelId: string;
  readonly version: number;
}

type ModelFields = Omit<CanonicalEquipmentModel, "version" | "createdAt" | "updatedAt">;

function validatedModel(input: Record<string, unknown>): ModelFields {
  // D1 requires a version; the value is irrelevant to the fields it normalizes and is never persisted from input.
  const v = validateEquipmentModel({ ...input, version: 1 });
  if (!v.valid) refuse("EQUIPMENT_MODEL_INVALID", "INVALID_INPUT", `the equipment model is invalid: ${v.reason}`);
  const m = v.value;
  return {
    id: m.equipmentModelId, manufacturerId: m.manufacturerId, manufacturerName: m.manufacturerName, modelNumber: m.modelNumber,
    displayName: m.displayName, family: m.family, subtype: m.subtype, revision: m.revision, status: m.status, sourceAuthority: m.sourceAuthority,
  };
}

async function lockModel(client: Pick<PoolClient, "query">, tenantId: string, id: string): Promise<CanonicalEquipmentModel | null> {
  const { rows } = await client.query(`${EQUIPMENT_MODEL_SELECT} WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, id]);
  return rows.length === 0 ? null : equipmentModelFromRow(rows[0]);
}

/** Create one Equipment Model at its canonical id, version 1. Replays when the row already says exactly this. */
export async function createEquipmentModel(
  deps: CatalogCommandDeps,
  actor: CatalogActorContext,
  input: { model: unknown },
): Promise<CatalogCommandResult<EquipmentModelWriteResult>> {
  return runCatalogCommand(deps, actor, CATALOG_CAPABILITIES.EQUIPMENT_MODEL_MANAGE, async (client, now) => {
    const raw = requirePlainObject(requirePlainObject(input, "input").model, "model");
    for (const k of Object.keys(raw)) if (!MODEL_INPUT_FIELDS.has(k)) refuse("FIELD_NOT_WRITABLE", "INVALID_INPUT", `field "${k}" is not writable`);
    const fields = validatedModel(raw);
    const existing = await lockModel(client, actor.tenantId, fields.id);
    if (existing !== null) {
      if (differingFields(EQUIPMENT_MODEL_MASTER_FIELDS, existing, { ...existing, ...fields }).length === 0) {
        return { result: { equipmentModelId: existing.id, version: existing.version }, replayed: true, audit: null };
      }
      refuse("EQUIPMENT_MODEL_ALREADY_EXISTS", "CONFLICT", `equipment model ${fields.id} already exists`);
    }
    const at = isoMicros(now);
    const record: CanonicalEquipmentModel = { ...fields, version: 1, createdAt: at, updatedAt: at };
    await client.query(INSERT_EQUIPMENT_MODEL_SQL, insertEquipmentModelValues(actor.tenantId, record, actor.principalId, actor.principalId));
    return {
      result: { equipmentModelId: record.id, version: 1 }, replayed: false,
      audit: { action: "catalog.equipmentModel.create", targetKind: "equipment_model", targetId: record.id, before: null, after: record },
    };
  });
}

/** Correct an Equipment Model's governed fields under optimistic concurrency. Identity never changes. */
export async function updateEquipmentModel(
  deps: CatalogCommandDeps,
  actor: CatalogActorContext,
  input: { equipmentModelId: unknown; expectedVersion: unknown; changes: unknown },
): Promise<CatalogCommandResult<EquipmentModelWriteResult>> {
  return runCatalogCommand(deps, actor, CATALOG_CAPABILITIES.EQUIPMENT_MODEL_MANAGE, async (client, now) => {
    const envelope = requirePlainObject(input, "input");
    if (!isCanonicalEquipmentModelId(envelope.equipmentModelId)) refuse("INVALID_INPUT", "INVALID_INPUT", "equipmentModelId must be a canonical equipment model id");
    const id = envelope.equipmentModelId as string;
    const expectedVersion = requireExpectedVersion(envelope.expectedVersion);
    const changes = requirePlainObject(envelope.changes, "changes");
    const keys = Object.keys(changes);
    if (keys.length === 0) refuse("NO_CHANGES", "PRECONDITION_FAILED", "changes must not be empty");
    for (const k of keys) if (!MODEL_UPDATABLE_FIELDS.has(k)) refuse("FIELD_NOT_UPDATABLE", "INVALID_INPUT", `field "${k}" is not updatable`);

    const existing = await lockModel(client, actor.tenantId, id);
    if (existing === null) refuse("EQUIPMENT_MODEL_NOT_FOUND", "NOT_FOUND", `no equipment model ${id} in this tenant`);
    const stored = existing;
    const { version: _v, createdAt: _c, updatedAt: _u, id: _id, ...storedInput } = stored;
    const merged = validatedModel({ equipmentModelId: id, ...storedInput, ...changes });
    const effective = differingFields(EQUIPMENT_MODEL_MASTER_FIELDS, stored, { ...stored, ...merged });

    if (stored.version === expectedVersion + 1 && effective.length === 0) {
      return { result: { equipmentModelId: id, version: stored.version }, replayed: true, audit: null };
    }
    if (stored.version !== expectedVersion) refuse("VERSION_CONFLICT", "CONFLICT", "the record changed since it was loaded; reload and retry");
    if (effective.length === 0) refuse("NO_CHANGES", "PRECONDITION_FAILED", "the requested changes are already the stored values");

    const version = stored.version + 1;
    const updatedAt = isoMicros(now);
    await client.query(
      `UPDATE eos_ops.equipment_models
          SET manufacturer_name = $3, model_number = $4, display_name = $5, family = $6, subtype = $7, revision = $8,
              status = $9, source_authority = $10, version = $11, updated_by = $12, updated_at = $13
        WHERE tenant_id = $1 AND id = $2 AND version = $14`,
      [actor.tenantId, id, merged.manufacturerName, merged.modelNumber, merged.displayName, merged.family, merged.subtype,
        merged.revision, merged.status, merged.sourceAuthority, version, actor.principalId, updatedAt, expectedVersion],
    );
    const after: CanonicalEquipmentModel = { ...stored, ...merged, version, updatedAt };
    return {
      result: { equipmentModelId: id, version }, replayed: false,
      audit: { action: "catalog.equipmentModel.update", targetKind: "equipment_model", targetId: id, before: stored, after },
    };
  });
}
