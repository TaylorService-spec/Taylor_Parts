// INV-1 Phase 1, PR 1.2 -- trusted Part Master write service (ADR-008
// Accepted / Decision #40). INTERNAL trusted services only: nothing here is
// exported from functions/src/index.ts, no callable/HTTP surface exists,
// and "export is not deployment" applies throughout.
//
// Every mutation: server-derived actor -> capability check via the REAL
// Enterprise Access resolver (inventory.catalog.manage / .activate --
// registered-but-ungranted, so real resolution DENIES today) -> PR 1.1 pure
// domain validation -> one db.runTransaction covering read + version check
// + idempotency check + mutation + atomically staged Audit Event (the
// savedDefinitionCommands.ts pattern). Denials emit standalone "denied"
// audit events. Idempotency uses the house mechanism: the Audit Event under
// a DETERMINISTIC id derived from the caller's idempotency key is the
// "already applied" source of truth; a request fingerprint embedded in its
// summary rejects same-key-different-request replays.
//
// PartStatus transitions (accepted 5-value enum; descriptive lifecycle, no
// workflow side effects): DRAFT->ACTIVE; ACTIVE<->INACTIVE; ACTIVE|INACTIVE
// ->DISCONTINUED; ACTIVE|INACTIVE->SUPERSEDED (the SUPERSEDED_BY
// relationship record itself is PR 1.4's authority -- documented
// dependency, not enforced here); DISCONTINUED and SUPERSEDED are terminal.
// internalPartNumber IS mutable under governance (spec sec1); the change is
// audited, and historical-lookup alias creation is a documented PR 1.3
// dependency (no alias persistence exists in PR 1.2).

import { createHash } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { COMPATIBILITY_ROLES } from "../access/compatibilityRoles";
import { GOVERNED_BUSINESS_ROLES } from "../access/governedBusinessRoles";
import { resolveEffectivePermission, type TargetContext } from "../access/resolveEffectivePermission";
import type { Role } from "../types/access";
import { isValidAccessVersionValue } from "../access/compactClaims";
import { stageAuditEventWithId, recordStandaloneAuditEvent } from "../access/auditEventWriter";
import type { AuditAction } from "../types/access";
import {
  buildFirestoreManufacturerRepository,
  buildFirestorePartRepository,
  INITIAL_VERSION,
  type StoredManufacturer,
  type StoredPart,
} from "./partMasterRepository";
import { parseManufacturerId, parsePartId, validatePart, type PartInput } from "./validation";
import { MANUFACTURER_STATUSES, PART_STATUSES } from "./types";
import type { Manufacturer, ManufacturerStatus, Part, PartStatus } from "./types";

export const CAP_CATALOG_MANAGE = "inventory.catalog.manage";
export const CAP_CATALOG_ACTIVATE = "inventory.catalog.activate";

// Typed error taxonomy (house class-per-reason convention).
export class InvalidInputError extends Error {}
export class UnauthorizedActorError extends Error {}
export class NotFoundError extends Error {}
export class AlreadyExistsError extends Error {}
export class VersionConflictError extends Error {}
export class IdempotencyConflictError extends Error {}
export class InvalidStatusTransitionError extends Error {}

export const PART_STATUS_TRANSITIONS: Readonly<Record<PartStatus, readonly PartStatus[]>> = {
  DRAFT: ["ACTIVE"],
  ACTIVE: ["INACTIVE", "DISCONTINUED", "SUPERSEDED"],
  INACTIVE: ["ACTIVE", "DISCONTINUED", "SUPERSEDED"],
  DISCONTINUED: [],
  SUPERSEDED: [],
};

export interface PartMasterDeps {
  db?: Firestore;
  roles?: Readonly<Record<string, Role>>;
  /** TEST-ONLY atomicity seam (savedDefinitionCommands precedent): thrown inside the transaction after all writes are staged, proving nothing commits. */
  __simulateFailureAfterStage?: Error;
  /** TEST-ONLY clock seam -- deterministic tests; real callers use the default. */
  now?: () => Date;
}

export interface MutationOutcome {
  readonly outcome: "applied" | "replayed";
  readonly version: number;
}

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,200}$/;

function allRoles(): Readonly<Record<string, Role>> {
  return { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
}
function resolveDeps(deps: PartMasterDeps | undefined) {
  return {
    db: deps?.db ?? getFirestore(),
    roles: deps?.roles ?? allRoles(),
    now: deps?.now ?? (() => new Date()),
    failAfterStage: deps?.__simulateFailureAfterStage,
  };
}

function assertActorUid(actorUid: unknown): asserts actorUid is string {
  if (typeof actorUid !== "string" || actorUid.length === 0) throw new InvalidInputError("actorUid is required");
}
function assertIdempotencyKey(key: unknown): asserts key is string {
  if (typeof key !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new InvalidInputError("idempotencyKey must match [A-Za-z0-9_-]{8,200}");
  }
}

function readAccessVersion(data: Record<string, unknown> | undefined): number {
  if (!data || data.accessVersion === undefined || data.accessVersion === null) return 0;
  return isValidAccessVersionValue(data.accessVersion) ? (data.accessVersion as number) : 0;
}

const GLOBAL_TARGET: TargetContext = { scope: { type: "global" }, condition: {} };

async function hasCapability(db: Firestore, roles: Readonly<Record<string, Role>>, actorUid: string, capabilityId: string): Promise<boolean> {
  const [userSnap, assignmentsSnap] = await Promise.all([
    db.collection("users").doc(actorUid).get(),
    db.collection("roleAssignments").where("principalUid", "==", actorUid).where("status", "==", "active").get(),
  ]);
  return (
    resolveEffectivePermission({
      permissionId: capabilityId,
      assignments: assignmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as never[],
      roles,
      currentAccessVersion: readAccessVersion(userSnap.data()),
      target: GLOBAL_TARGET,
    }).decision === "ALLOW"
  );
}

async function requireCapabilityOrAudit(
  db: Firestore,
  roles: Readonly<Record<string, Role>>,
  actorUid: string,
  capabilityId: string,
  action: AuditAction,
  targetType: string,
  targetId: string,
): Promise<void> {
  if (await hasCapability(db, roles, actorUid, capabilityId)) return;
  await recordStandaloneAuditEvent({
    actorUid,
    action,
    targetType,
    targetId,
    outcome: "denied",
    summary: `denied: actor lacks ${capabilityId}`,
  });
  throw new UnauthorizedActorError(`actor is not authorized for "${capabilityId}"`);
}

function fingerprint(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}
function auditDocId(operation: string, actorUid: string, targetId: string, key: string): string {
  return "pm_" + createHash("sha256").update(`${operation}|${actorUid}|${targetId}|${key}`).digest("hex").slice(0, 40);
}
const FP_TAG = /fp=([0-9a-f]{16})/;

// Shared transactional idempotency guard: returns "replayed" outcome if the
// deterministic audit doc already exists with a MATCHING fingerprint;
// throws IdempotencyConflictError on mismatch; returns null when the
// operation should proceed.
async function checkIdempotency(
  db: Firestore,
  txn: Transaction,
  auditId: string,
  fp: string,
): Promise<MutationOutcome | null> {
  const snap = await txn.get(db.collection("auditEvents").doc(auditId));
  if (!snap.exists) return null;
  const summary = String((snap.data() ?? {}).summary ?? "");
  const stored = FP_TAG.exec(summary)?.[1];
  if (stored !== fp) throw new IdempotencyConflictError("idempotencyKey was already used for a different request");
  const versionMatch = /v=(\d+)/.exec(summary);
  return { outcome: "replayed", version: versionMatch ? Number(versionMatch[1]) : INITIAL_VERSION };
}

// ---------------------------------------------------------------------------
// Part commands
// ---------------------------------------------------------------------------
export interface CreatePartInput {
  actorUid: string;
  idempotencyKey: string;
  part: PartInput;
}

export async function createPart(input: CreatePartInput, deps?: PartMasterDeps): Promise<MutationOutcome> {
  const { db, roles, now, failAfterStage } = resolveDeps(deps);
  assertActorUid(input.actorUid);
  assertIdempotencyKey(input.idempotencyKey);
  const validated = validatePart(input.part);
  if (!validated.valid) {
    throw new InvalidInputError(`invalid part: ${validated.errors.map((e) => `${e.path}:${e.code}`).join(",")}`);
  }
  const part = validated.value;
  await requireCapabilityOrAudit(db, roles, input.actorUid, CAP_CATALOG_MANAGE, "createPart", "part", part.partId);

  const repo = buildFirestorePartRepository(db);
  const fp = fingerprint(["createPart", part]);
  const auditId = auditDocId("createPart", input.actorUid, part.partId, input.idempotencyKey);

  return db.runTransaction(async (txn) => {
    const replay = await checkIdempotency(db, txn, auditId, fp);
    if (replay) return replay;
    const existing = await repo.getById(txn, part.partId);
    if (existing !== null) throw new AlreadyExistsError(`part ${part.partId} already exists`);
    const at = now();
    const stored: StoredPart = {
      part,
      version: INITIAL_VERSION,
      createdAt: at,
      createdBy: input.actorUid,
      updatedAt: at,
      updatedBy: input.actorUid,
    };
    repo.stageCreate(txn, stored);
    stageAuditEventWithId(txn, auditId, {
      actorUid: input.actorUid,
      action: "createPart",
      targetType: "part",
      targetId: part.partId,
      outcome: "applied",
      summary: `created part ${part.partId} (${part.internalPartNumber}) v=${INITIAL_VERSION} fp=${fp}`,
    });
    if (failAfterStage) throw failAfterStage;
    return { outcome: "applied", version: INITIAL_VERSION };
  });
}

// Explicit update allowlist (descriptive authority only). partId/createdAt/
// createdBy/version/audit metadata are never updatable; identity mutation is
// structurally impossible (partId comes from the stored record).
export interface UpdatePartInput {
  actorUid: string;
  idempotencyKey: string;
  partId: string;
  expectedVersion: number;
  changes: Partial<Pick<Part, "internalPartNumber" | "name" | "description" | "category" | "stockingUnit" | "controlType" | "stockingClass" | "flags" | "manufacturerId" | "manufacturerPartNumber" | "oemStatus">>;
}

const UPDATABLE_FIELDS = new Set(["internalPartNumber", "name", "description", "category", "stockingUnit", "controlType", "stockingClass", "flags", "manufacturerId", "manufacturerPartNumber", "oemStatus"]);

export async function updatePart(input: UpdatePartInput, deps?: PartMasterDeps): Promise<MutationOutcome> {
  const { db, roles, now, failAfterStage } = resolveDeps(deps);
  assertActorUid(input.actorUid);
  assertIdempotencyKey(input.idempotencyKey);
  const partId = parsePartId(input.partId);
  if (!partId.valid) throw new InvalidInputError("invalid partId");
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < INITIAL_VERSION) {
    throw new InvalidInputError("expectedVersion must be a positive integer");
  }
  const changeKeys = Object.keys(input.changes ?? {});
  if (changeKeys.length === 0) throw new InvalidInputError("changes must not be empty");
  for (const k of changeKeys) {
    if (!UPDATABLE_FIELDS.has(k)) throw new InvalidInputError(`field "${k}" is not updatable`);
  }
  await requireCapabilityOrAudit(db, roles, input.actorUid, CAP_CATALOG_MANAGE, "updatePart", "part", partId.value);

  const repo = buildFirestorePartRepository(db);
  const fp = fingerprint(["updatePart", partId.value, input.expectedVersion, input.changes]);
  const auditId = auditDocId("updatePart", input.actorUid, partId.value, input.idempotencyKey);

  return db.runTransaction(async (txn) => {
    const replay = await checkIdempotency(db, txn, auditId, fp);
    if (replay) return replay;
    const existing = await repo.getById(txn, partId.value);
    if (existing === null) throw new NotFoundError(`part ${partId.value} not found`);
    if (existing.version !== input.expectedVersion) {
      throw new VersionConflictError(`expectedVersion ${input.expectedVersion}, stored ${existing.version}`);
    }
    // Re-validate the merged domain object through PR 1.1 (status unchanged here).
    const merged = validatePart({ ...existing.part, ...input.changes, partId: partId.value, status: existing.part.status });
    if (!merged.valid) {
      throw new InvalidInputError(`invalid update: ${merged.errors.map((e) => `${e.path}:${e.code}`).join(",")}`);
    }
    const newVersion = existing.version + 1;
    repo.stageUpdate(txn, {
      part: merged.value,
      version: newVersion,
      createdAt: existing.createdAt,
      createdBy: existing.createdBy,
      updatedAt: now(),
      updatedBy: input.actorUid,
    });
    stageAuditEventWithId(txn, auditId, {
      actorUid: input.actorUid,
      action: "updatePart",
      targetType: "part",
      targetId: partId.value,
      outcome: "applied",
      summary: `updated part ${partId.value} fields=[${changeKeys.sort().join(",")}] v=${newVersion} fp=${fp}`,
    });
    if (failAfterStage) throw failAfterStage;
    return { outcome: "applied", version: newVersion };
  });
}

export interface ChangePartStatusInput {
  actorUid: string;
  idempotencyKey: string;
  partId: string;
  expectedVersion: number;
  newStatus: string;
}

export async function changePartStatus(input: ChangePartStatusInput, deps?: PartMasterDeps): Promise<MutationOutcome> {
  const { db, roles, now, failAfterStage } = resolveDeps(deps);
  assertActorUid(input.actorUid);
  assertIdempotencyKey(input.idempotencyKey);
  const partId = parsePartId(input.partId);
  if (!partId.valid) throw new InvalidInputError("invalid partId");
  if (!(PART_STATUSES as readonly string[]).includes(input.newStatus)) {
    throw new InvalidInputError(`newStatus must be one of ${PART_STATUSES.join("/")}`);
  }
  await requireCapabilityOrAudit(db, roles, input.actorUid, CAP_CATALOG_ACTIVATE, "changePartStatus", "part", partId.value);

  const repo = buildFirestorePartRepository(db);
  const fp = fingerprint(["changePartStatus", partId.value, input.expectedVersion, input.newStatus]);
  const auditId = auditDocId("changePartStatus", input.actorUid, partId.value, input.idempotencyKey);

  return db.runTransaction(async (txn) => {
    const replay = await checkIdempotency(db, txn, auditId, fp);
    if (replay) return replay;
    const existing = await repo.getById(txn, partId.value);
    if (existing === null) throw new NotFoundError(`part ${partId.value} not found`);
    if (existing.version !== input.expectedVersion) {
      throw new VersionConflictError(`expectedVersion ${input.expectedVersion}, stored ${existing.version}`);
    }
    const from = existing.part.status;
    const to = input.newStatus as PartStatus;
    if (!PART_STATUS_TRANSITIONS[from].includes(to)) {
      throw new InvalidStatusTransitionError(`transition ${from} -> ${to} is not allowed`);
    }
    const newVersion = existing.version + 1;
    repo.stageUpdate(txn, {
      part: { ...existing.part, status: to },
      version: newVersion,
      createdAt: existing.createdAt,
      createdBy: existing.createdBy,
      updatedAt: now(),
      updatedBy: input.actorUid,
    });
    stageAuditEventWithId(txn, auditId, {
      actorUid: input.actorUid,
      action: "changePartStatus",
      targetType: "part",
      targetId: partId.value,
      outcome: "applied",
      summary: `part ${partId.value} status ${from}->${to} v=${newVersion} fp=${fp}`,
    });
    if (failAfterStage) throw failAfterStage;
    return { outcome: "applied", version: newVersion };
  });
}

// ---------------------------------------------------------------------------
// Manufacturer commands (same contract; independent status model)
// ---------------------------------------------------------------------------
export interface CreateManufacturerInput {
  actorUid: string;
  idempotencyKey: string;
  manufacturerId: string;
  name: string;
}

export async function createManufacturer(input: CreateManufacturerInput, deps?: PartMasterDeps): Promise<MutationOutcome> {
  const { db, roles, now, failAfterStage } = resolveDeps(deps);
  assertActorUid(input.actorUid);
  assertIdempotencyKey(input.idempotencyKey);
  const mid = parseManufacturerId(input.manufacturerId);
  if (!mid.valid) throw new InvalidInputError("invalid manufacturerId");
  if (typeof input.name !== "string" || input.name.trim().length === 0 || input.name.length > 200) {
    throw new InvalidInputError("name is required (max 200 chars)");
  }
  await requireCapabilityOrAudit(db, roles, input.actorUid, CAP_CATALOG_MANAGE, "createManufacturer", "manufacturer", mid.value);

  const repo = buildFirestoreManufacturerRepository(db);
  const manufacturer: Manufacturer = { manufacturerId: mid.value, name: input.name.trim(), status: "ACTIVE" };
  const fp = fingerprint(["createManufacturer", manufacturer]);
  const auditId = auditDocId("createManufacturer", input.actorUid, mid.value, input.idempotencyKey);

  return db.runTransaction(async (txn) => {
    const replay = await checkIdempotency(db, txn, auditId, fp);
    if (replay) return replay;
    const existing = await repo.getById(txn, mid.value);
    if (existing !== null) throw new AlreadyExistsError(`manufacturer ${mid.value} already exists`);
    const at = now();
    repo.stageCreate(txn, {
      manufacturer,
      version: INITIAL_VERSION,
      createdAt: at,
      createdBy: input.actorUid,
      updatedAt: at,
      updatedBy: input.actorUid,
    });
    stageAuditEventWithId(txn, auditId, {
      actorUid: input.actorUid,
      action: "createManufacturer",
      targetType: "manufacturer",
      targetId: mid.value,
      outcome: "applied",
      summary: `created manufacturer ${mid.value} v=${INITIAL_VERSION} fp=${fp}`,
    });
    if (failAfterStage) throw failAfterStage;
    return { outcome: "applied", version: INITIAL_VERSION };
  });
}

export interface UpdateManufacturerInput {
  actorUid: string;
  idempotencyKey: string;
  manufacturerId: string;
  expectedVersion: number;
  name: string;
}

export async function updateManufacturer(input: UpdateManufacturerInput, deps?: PartMasterDeps): Promise<MutationOutcome> {
  const { db, roles, now, failAfterStage } = resolveDeps(deps);
  assertActorUid(input.actorUid);
  assertIdempotencyKey(input.idempotencyKey);
  const mid = parseManufacturerId(input.manufacturerId);
  if (!mid.valid) throw new InvalidInputError("invalid manufacturerId");
  if (typeof input.name !== "string" || input.name.trim().length === 0 || input.name.length > 200) {
    throw new InvalidInputError("name is required (max 200 chars)");
  }
  await requireCapabilityOrAudit(db, roles, input.actorUid, CAP_CATALOG_MANAGE, "updateManufacturer", "manufacturer", mid.value);

  const repo = buildFirestoreManufacturerRepository(db);
  const fp = fingerprint(["updateManufacturer", mid.value, input.expectedVersion, input.name.trim()]);
  const auditId = auditDocId("updateManufacturer", input.actorUid, mid.value, input.idempotencyKey);

  return db.runTransaction(async (txn) => {
    const replay = await checkIdempotency(db, txn, auditId, fp);
    if (replay) return replay;
    const existing = await repo.getById(txn, mid.value);
    if (existing === null) throw new NotFoundError(`manufacturer ${mid.value} not found`);
    if (existing.version !== input.expectedVersion) {
      throw new VersionConflictError(`expectedVersion ${input.expectedVersion}, stored ${existing.version}`);
    }
    const newVersion = existing.version + 1;
    repo.stageUpdate(txn, {
      manufacturer: { ...existing.manufacturer, name: input.name.trim() },
      version: newVersion,
      createdAt: existing.createdAt,
      createdBy: existing.createdBy,
      updatedAt: now(),
      updatedBy: input.actorUid,
    });
    stageAuditEventWithId(txn, auditId, {
      actorUid: input.actorUid,
      action: "updateManufacturer",
      targetType: "manufacturer",
      targetId: mid.value,
      outcome: "applied",
      summary: `updated manufacturer ${mid.value} v=${newVersion} fp=${fp}`,
    });
    if (failAfterStage) throw failAfterStage;
    return { outcome: "applied", version: newVersion };
  });
}

export interface ChangeManufacturerStatusInput {
  actorUid: string;
  idempotencyKey: string;
  manufacturerId: string;
  expectedVersion: number;
  newStatus: string;
}

export async function changeManufacturerStatus(input: ChangeManufacturerStatusInput, deps?: PartMasterDeps): Promise<MutationOutcome> {
  const { db, roles, now, failAfterStage } = resolveDeps(deps);
  assertActorUid(input.actorUid);
  assertIdempotencyKey(input.idempotencyKey);
  const mid = parseManufacturerId(input.manufacturerId);
  if (!mid.valid) throw new InvalidInputError("invalid manufacturerId");
  if (!(MANUFACTURER_STATUSES as readonly string[]).includes(input.newStatus)) {
    throw new InvalidInputError(`newStatus must be one of ${MANUFACTURER_STATUSES.join("/")}`);
  }
  await requireCapabilityOrAudit(db, roles, input.actorUid, CAP_CATALOG_ACTIVATE, "changeManufacturerStatus", "manufacturer", mid.value);

  const repo = buildFirestoreManufacturerRepository(db);
  const fp = fingerprint(["changeManufacturerStatus", mid.value, input.expectedVersion, input.newStatus]);
  const auditId = auditDocId("changeManufacturerStatus", input.actorUid, mid.value, input.idempotencyKey);

  return db.runTransaction(async (txn) => {
    const replay = await checkIdempotency(db, txn, auditId, fp);
    if (replay) return replay;
    const existing = await repo.getById(txn, mid.value);
    if (existing === null) throw new NotFoundError(`manufacturer ${mid.value} not found`);
    if (existing.version !== input.expectedVersion) {
      throw new VersionConflictError(`expectedVersion ${input.expectedVersion}, stored ${existing.version}`);
    }
    const from = existing.manufacturer.status;
    const to = input.newStatus as ManufacturerStatus;
    if (from === to) throw new InvalidStatusTransitionError(`manufacturer already ${to}`);
    const newVersion = existing.version + 1;
    repo.stageUpdate(txn, {
      manufacturer: { ...existing.manufacturer, status: to },
      version: newVersion,
      createdAt: existing.createdAt,
      createdBy: existing.createdBy,
      updatedAt: now(),
      updatedBy: input.actorUid,
    });
    stageAuditEventWithId(txn, auditId, {
      actorUid: input.actorUid,
      action: "changeManufacturerStatus",
      targetType: "manufacturer",
      targetId: mid.value,
      outcome: "applied",
      summary: `manufacturer ${mid.value} status ${from}->${to} v=${newVersion} fp=${fp}`,
    });
    if (failAfterStage) throw failAfterStage;
    return { outcome: "applied", version: newVersion };
  });
}
