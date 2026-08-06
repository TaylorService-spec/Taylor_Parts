// Supplier Master (S2) -- trusted command service for the governed Supplier business object
// (DECISIONS #78). REUSES the established Part Master trusted-command machinery (capability check,
// idempotency, versioning, fingerprint, single-transaction, server-authored audit, bounded errors,
// fail-closed) via the exported __pm_internal_* helpers -- nothing reimplemented. Supplier is a
// catalog-governed object: create/update gate on inventory.catalog.manage, activate/deactivate on
// inventory.catalog.activate (the SAME capabilities parts/manufacturers/part_supplier_items use).
// No client-direct writes (suppliers Rules stay write-closed); these run Admin-SDK-only server-side.

import { Timestamp } from "firebase-admin/firestore";
import { isNonEmptyString } from "../inventoryLedger/operationalMovementValidation.js";
import { stageAuditEventWithId } from "../access/auditEventWriter.js";
import { INITIAL_VERSION } from "../partMaster/partMasterRepository.js";
import {
  CAP_CATALOG_MANAGE,
  CAP_CATALOG_ACTIVATE,
  InvalidInputError,
  NotFoundError,
  AlreadyExistsError,
  VersionConflictError,
  InvalidStatusTransitionError,
  type PartMasterDeps,
  type MutationOutcome,
  __pm_internal_resolveDeps,
  __pm_internal_assertActorUid,
  __pm_internal_assertIdempotencyKey,
  __pm_internal_requireCapabilityOrAudit,
  __pm_internal_fingerprint,
  __pm_internal_auditDocId,
  __pm_internal_checkIdempotency,
} from "../partMaster/partMasterCommands.js";
import { buildFirestoreSupplierRepository } from "./supplierMasterRepository.js";
import { normalizeSupplierName } from "./supplierMasterValidation.js";
import {
  SUPPLIER_ID_PATTERN,
  SUPPLIER_OPTIONAL_STRING_FIELDS,
  type GovernedSupplier,
  type SupplierStatus,
} from "./supplierMasterTypes.js";

// Deps/outcome/error surface reuse the Part Master types verbatim (one machinery).
export type SupplierMasterDeps = PartMasterDeps;

const UPDATABLE_FIELDS: ReadonlySet<string> = new Set<string>(["name", ...SUPPLIER_OPTIONAL_STRING_FIELDS]);

function assertSupplierId(supplierId: unknown): asserts supplierId is string {
  if (typeof supplierId !== "string" || !SUPPLIER_ID_PATTERN.test(supplierId)) {
    throw new InvalidInputError("supplierId must match [A-Za-z0-9_-]{1,64}");
  }
}

// Validate the optional business fields on an input map: each own-present must be a non-blank string.
function assertOptionalFields(src: Record<string, unknown>): void {
  for (const f of SUPPLIER_OPTIONAL_STRING_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(src, f) && !isNonEmptyString(src[f])) {
      throw new InvalidInputError(`optional field "${f}" must be a non-blank string when present`);
    }
  }
}

export interface CreateSupplierInput {
  actorUid: string;
  idempotencyKey: string;
  supplierId: string;
  name: string;
  vendorNumber?: string;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
  paymentTermsRef?: string;
  notes?: string;
}

export interface CreateSupplierOutcome extends MutationOutcome {
  supplierId: string;
  // Governed dedup DETECTION: ids of ACTIVE suppliers sharing the normalized name. The supplier is
  // still CREATED (flag, not block) -- these are surfaced for governed human review (never auto-merge).
  suspectedDuplicateOf: string[];
}

export async function createSupplier(input: CreateSupplierInput, deps?: SupplierMasterDeps): Promise<CreateSupplierOutcome> {
  const { db, roles, now, failAfterStage } = __pm_internal_resolveDeps(deps);
  __pm_internal_assertActorUid(input.actorUid);
  __pm_internal_assertIdempotencyKey(input.idempotencyKey);
  assertSupplierId(input.supplierId);
  if (!isNonEmptyString(input.name)) throw new InvalidInputError("name is required");
  assertOptionalFields(input as unknown as Record<string, unknown>);
  const normalizedKey = normalizeSupplierName(input.name);
  if (normalizedKey === "") throw new InvalidInputError("name has no usable content after normalization");

  const { supplierId } = input;
  await __pm_internal_requireCapabilityOrAudit(db, roles, input.actorUid, CAP_CATALOG_MANAGE, "createSupplier", "supplier", supplierId);

  const repo = buildFirestoreSupplierRepository(db);
  const optionals: Partial<GovernedSupplier> = {};
  for (const f of SUPPLIER_OPTIONAL_STRING_FIELDS) {
    const v = (input as unknown as Record<string, unknown>)[f];
    if (v !== undefined) optionals[f] = v as string;
  }
  const fp = __pm_internal_fingerprint(["createSupplier", supplierId, input.name, normalizedKey, optionals]);
  const auditId = __pm_internal_auditDocId("createSupplier", input.actorUid, supplierId, input.idempotencyKey);

  return db.runTransaction(async (txn) => {
    const replay = await __pm_internal_checkIdempotency(db, txn, auditId, fp);
    if (replay) return { ...replay, supplierId, suspectedDuplicateOf: [] };
    const existing = await repo.getById(txn, supplierId);
    if (existing !== null) throw new AlreadyExistsError(`supplier ${supplierId} already exists`);
    const dupes = await repo.findActiveByNormalizedKey(txn, normalizedKey, supplierId);
    const suspectedDuplicateOf = dupes.map((d) => d.id).sort();

    const at = Timestamp.fromDate(now());
    const supplier: GovernedSupplier = {
      id: supplierId,
      name: input.name,
      normalizedKey,
      status: "ACTIVE",
      version: INITIAL_VERSION,
      createdAt: at,
      createdBy: input.actorUid,
      updatedAt: at,
      updatedBy: input.actorUid,
      ...optionals,
    };
    repo.stageCreate(txn, supplier);
    stageAuditEventWithId(txn, auditId, {
      actorUid: input.actorUid,
      action: "createSupplier",
      targetType: "supplier",
      targetId: supplierId,
      outcome: "applied",
      summary: `created supplier ${supplierId} v=1${suspectedDuplicateOf.length ? ` suspectedDuplicateOf=[${suspectedDuplicateOf.join(",")}]` : ""} fp=${fp}`,
    });
    if (failAfterStage) throw failAfterStage;
    return { outcome: "applied", version: INITIAL_VERSION, supplierId, suspectedDuplicateOf };
  });
}

export interface UpdateSupplierInput {
  actorUid: string;
  idempotencyKey: string;
  supplierId: string;
  expectedVersion: number;
  changes: Partial<Pick<GovernedSupplier, "name" | "vendorNumber" | "contactName" | "phone" | "email" | "address" | "paymentTermsRef" | "notes">>;
}

export async function updateSupplier(input: UpdateSupplierInput, deps?: SupplierMasterDeps): Promise<MutationOutcome> {
  const { db, roles, now, failAfterStage } = __pm_internal_resolveDeps(deps);
  __pm_internal_assertActorUid(input.actorUid);
  __pm_internal_assertIdempotencyKey(input.idempotencyKey);
  assertSupplierId(input.supplierId);
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < INITIAL_VERSION) {
    throw new InvalidInputError("expectedVersion must be a positive integer");
  }
  const changes = input.changes ?? {};
  const changeKeys = Object.keys(changes);
  if (changeKeys.length === 0) throw new InvalidInputError("changes must not be empty");
  for (const k of changeKeys) {
    if (!UPDATABLE_FIELDS.has(k)) throw new InvalidInputError(`field "${k}" is not updatable`);
  }
  if (Object.prototype.hasOwnProperty.call(changes, "name") && !isNonEmptyString(changes.name)) {
    throw new InvalidInputError("name must be a non-blank string");
  }
  assertOptionalFields(changes as Record<string, unknown>);
  await __pm_internal_requireCapabilityOrAudit(db, roles, input.actorUid, CAP_CATALOG_MANAGE, "updateSupplier", "supplier", input.supplierId);

  const repo = buildFirestoreSupplierRepository(db);
  const fp = __pm_internal_fingerprint(["updateSupplier", input.supplierId, input.expectedVersion, changes]);
  const auditId = __pm_internal_auditDocId("updateSupplier", input.actorUid, input.supplierId, input.idempotencyKey);

  return db.runTransaction(async (txn) => {
    const replay = await __pm_internal_checkIdempotency(db, txn, auditId, fp);
    if (replay) return replay;
    const existing = await repo.getById(txn, input.supplierId);
    if (existing === null) throw new NotFoundError(`supplier ${input.supplierId} not found`);
    if (existing.version !== input.expectedVersion) {
      throw new VersionConflictError(`expectedVersion ${input.expectedVersion}, stored ${existing.version}`);
    }
    const newName = Object.prototype.hasOwnProperty.call(changes, "name") ? (changes.name as string) : existing.name;
    const normalizedKey = normalizeSupplierName(newName);
    if (normalizedKey === "") throw new InvalidInputError("name has no usable content after normalization");
    const newVersion = existing.version + 1;
    const merged: GovernedSupplier = {
      ...existing,
      ...changes,
      name: newName,
      normalizedKey,
      status: existing.status, // status changes go through activate/deactivate only
      version: newVersion,
      createdAt: existing.createdAt,
      createdBy: existing.createdBy,
      updatedAt: Timestamp.fromDate(now()),
      updatedBy: input.actorUid,
    };
    repo.stageUpdate(txn, merged);
    stageAuditEventWithId(txn, auditId, {
      actorUid: input.actorUid,
      action: "updateSupplier",
      targetType: "supplier",
      targetId: input.supplierId,
      outcome: "applied",
      summary: `updated supplier ${input.supplierId} fields=[${changeKeys.sort().join(",")}] v=${newVersion} fp=${fp}`,
    });
    if (failAfterStage) throw failAfterStage;
    return { outcome: "applied", version: newVersion };
  });
}

export interface SupplierStatusInput {
  actorUid: string;
  idempotencyKey: string;
  supplierId: string;
  expectedVersion: number;
}

// Shared status transition (activate: INACTIVE->ACTIVE; deactivate: ACTIVE->INACTIVE). Same-status
// is an invalid transition (never a silent no-op). Never physically deletes.
async function changeSupplierStatus(
  input: SupplierStatusInput,
  targetStatus: SupplierStatus,
  action: "activateSupplier" | "deactivateSupplier",
  deps?: SupplierMasterDeps,
): Promise<MutationOutcome> {
  const { db, roles, now, failAfterStage } = __pm_internal_resolveDeps(deps);
  __pm_internal_assertActorUid(input.actorUid);
  __pm_internal_assertIdempotencyKey(input.idempotencyKey);
  assertSupplierId(input.supplierId);
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < INITIAL_VERSION) {
    throw new InvalidInputError("expectedVersion must be a positive integer");
  }
  await __pm_internal_requireCapabilityOrAudit(db, roles, input.actorUid, CAP_CATALOG_ACTIVATE, action, "supplier", input.supplierId);

  const repo = buildFirestoreSupplierRepository(db);
  const fp = __pm_internal_fingerprint([action, input.supplierId, input.expectedVersion, targetStatus]);
  const auditId = __pm_internal_auditDocId(action, input.actorUid, input.supplierId, input.idempotencyKey);

  return db.runTransaction(async (txn) => {
    const replay = await __pm_internal_checkIdempotency(db, txn, auditId, fp);
    if (replay) return replay;
    const existing = await repo.getById(txn, input.supplierId);
    if (existing === null) throw new NotFoundError(`supplier ${input.supplierId} not found`);
    if (existing.version !== input.expectedVersion) {
      throw new VersionConflictError(`expectedVersion ${input.expectedVersion}, stored ${existing.version}`);
    }
    if (existing.status === targetStatus) {
      throw new InvalidStatusTransitionError(`supplier ${input.supplierId} is already ${targetStatus}`);
    }
    const newVersion = existing.version + 1;
    repo.stageUpdate(txn, {
      ...existing,
      status: targetStatus,
      version: newVersion,
      updatedAt: Timestamp.fromDate(now()),
      updatedBy: input.actorUid,
    });
    stageAuditEventWithId(txn, auditId, {
      actorUid: input.actorUid,
      action,
      targetType: "supplier",
      targetId: input.supplierId,
      outcome: "applied",
      summary: `${action === "activateSupplier" ? "activated" : "deactivated"} supplier ${input.supplierId} -> ${targetStatus} v=${newVersion} fp=${fp}`,
    });
    if (failAfterStage) throw failAfterStage;
    return { outcome: "applied", version: newVersion };
  });
}

export function activateSupplier(input: SupplierStatusInput, deps?: SupplierMasterDeps): Promise<MutationOutcome> {
  return changeSupplierStatus(input, "ACTIVE", "activateSupplier", deps);
}
export function deactivateSupplier(input: SupplierStatusInput, deps?: SupplierMasterDeps): Promise<MutationOutcome> {
  return changeSupplierStatus(input, "INACTIVE", "deactivateSupplier", deps);
}
