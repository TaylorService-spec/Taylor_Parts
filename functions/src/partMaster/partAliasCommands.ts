// INV-1 Phase 1, PR 1.3 -- trusted Part alias commands + deterministic
// lookup (ADR-008 Accepted / Decision #40). INTERNAL services only (no
// callable/HTTP surface; nothing exported from functions/src/index.ts).
// Same contract as partMasterCommands.ts: server-derived actor ->
// capability (inventory.catalog.manage -- reused per O-gate direction, no
// new capability) -> validation -> one transaction covering Part existence
// + alias read + conflict + idempotency + mutation + atomically staged
// audit. Structural uniqueness: the deterministic doc id makes "one active
// canonical resolution per alias identity" a create-collision fact, not a
// query race. No physical delete; deactivation preserves history.
// Reassignment between Parts is NOT implemented -- an active or inactive
// alias owned by another Part always rejects (a governed reassignment
// operation would be its own later gate).
//
// SENSITIVE IDENTIFIERS: audit summaries never carry raw external
// identifier values -- only the aliasType + a 16-hex fingerprint of the
// normalized value (customer/vendor references especially must not leak
// through audit surfaces).

import { createHash } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { stageAuditEventWithId, recordStandaloneAuditEvent } from "../access/auditEventWriter";
import { ALIAS_TYPES } from "./types";
import type { AliasType, ManufacturerId, PartAliasId, PartId } from "./types";
import { parseManufacturerId, parsePartId } from "./validation";
import { buildFirestorePartRepository } from "./partMasterRepository";
import {
  buildFirestorePartAliasRepository,
  deriveAliasDocId,
  type StoredPartAlias,
} from "./partAliasRepository";
import {
  AlreadyExistsError,
  CAP_CATALOG_MANAGE,
  IdempotencyConflictError,
  InvalidInputError,
  NotFoundError,
  VersionConflictError,
  type MutationOutcome,
  type PartMasterDeps,
} from "./partMasterCommands";
// Re-exported guts of partMasterCommands used here (kept in that module to
// avoid a second capability/idempotency implementation).
import {
  __pm_internal_checkIdempotency,
  __pm_internal_fingerprint,
  __pm_internal_auditDocId,
  __pm_internal_requireCapabilityOrAudit,
  __pm_internal_resolveDeps,
  __pm_internal_assertActorUid,
  __pm_internal_assertIdempotencyKey,
} from "./partMasterCommands";

export const valueFingerprint = (normalizedValue: string): string =>
  createHash("sha256").update(normalizedValue).digest("hex").slice(0, 16);

function assertAliasType(v: unknown): asserts v is AliasType {
  if (typeof v !== "string" || !(ALIAS_TYPES as readonly string[]).includes(v)) {
    throw new InvalidInputError(`aliasType must be one of ${ALIAS_TYPES.join("/")}`);
  }
}

export interface CreatePartAliasInput {
  actorUid: string;
  idempotencyKey: string;
  partId: string;
  aliasType: string;
  rawValue: string;
  source?: string;
  manufacturerId?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
}

export async function createPartAlias(input: CreatePartAliasInput, deps?: PartMasterDeps): Promise<MutationOutcome & { aliasId: PartAliasId }> {
  const { db, roles, now, failAfterStage } = __pm_internal_resolveDeps(deps);
  __pm_internal_assertActorUid(input.actorUid);
  __pm_internal_assertIdempotencyKey(input.idempotencyKey);
  assertAliasType(input.aliasType);
  const partId = parsePartId(input.partId);
  if (!partId.valid) throw new InvalidInputError("invalid partId");
  let manufacturerId: ManufacturerId | undefined;
  if (input.manufacturerId !== undefined) {
    const m = parseManufacturerId(input.manufacturerId);
    if (!m.valid) throw new InvalidInputError("invalid manufacturerId");
    manufacturerId = m.value;
  }
  if (
    typeof input.effectiveFrom === "string" && typeof input.effectiveTo === "string" &&
    input.effectiveFrom > input.effectiveTo
  ) {
    throw new InvalidInputError("effectiveTo must not precede effectiveFrom");
  }
  const derived = deriveAliasDocId(input.aliasType, input.rawValue, manufacturerId);
  if (derived === null) throw new InvalidInputError(`invalid ${input.aliasType} value`);
  const fpv = valueFingerprint(derived.normalizedValue);
  await __pm_internal_requireCapabilityOrAudit(
    db, roles, input.actorUid, CAP_CATALOG_MANAGE, "createPartAlias", "part_alias", derived.docId
  );

  const partRepo = buildFirestorePartRepository(db);
  const aliasRepo = buildFirestorePartAliasRepository(db);
  const fp = __pm_internal_fingerprint(["createPartAlias", partId.value, derived.docId, input.effectiveFrom ?? null, input.effectiveTo ?? null]);
  const auditId = __pm_internal_auditDocId("createPartAlias", input.actorUid, partId.value, input.idempotencyKey);

  return db.runTransaction(async (txn) => {
    const replay = await __pm_internal_checkIdempotency(db, txn, auditId, fp);
    if (replay) return { ...replay, aliasId: derived.docId };
    const part = await partRepo.getById(txn, partId.value);
    if (part === null) throw new NotFoundError(`part ${partId.value} not found`);
    const existing = await aliasRepo.getByAliasId(txn, derived.docId);
    if (existing !== null) {
      if (existing.partId === partId.value && existing.status === "ACTIVE") {
        // Equivalent active alias for the SAME part: idempotent-equivalent success.
        return { outcome: "replayed", version: existing.version, aliasId: derived.docId };
      }
      // Active or inactive alias owned by ANOTHER part, or inactive for the
      // same part: explicit conflict -- never silent reassignment/reactivation.
      await recordStandaloneAuditEvent({
        actorUid: input.actorUid,
        action: "createPartAlias",
        targetType: "part_alias",
        targetId: derived.docId,
        outcome: "denied",
        summary: `conflict: alias ${input.aliasType} fpv=${fpv} already ${existing.status} for part ${existing.partId}`,
      });
      throw new AlreadyExistsError(
        existing.partId === partId.value
          ? `alias exists INACTIVE for this part -- use reactivatePartAlias`
          : `alias identity is owned by another part`
      );
    }
    const at = now();
    const stored: StoredPartAlias = {
      aliasId: derived.docId,
      partId: partId.value,
      aliasType: input.aliasType as AliasType,
      originalValue: input.rawValue,
      normalizedValue: derived.normalizedValue,
      status: "ACTIVE",
      source: typeof input.source === "string" && input.source.length > 0 ? input.source : "manual",
      ...(manufacturerId !== undefined ? { manufacturerId } : {}),
      ...(typeof input.effectiveFrom === "string" ? { effectiveFrom: input.effectiveFrom } : {}),
      ...(typeof input.effectiveTo === "string" ? { effectiveTo: input.effectiveTo } : {}),
      version: 1,
      createdAt: at,
      createdBy: input.actorUid,
      updatedAt: at,
      updatedBy: input.actorUid,
    };
    aliasRepo.stageCreate(txn, stored);
    stageAuditEventWithId(txn, auditId, {
      actorUid: input.actorUid,
      action: "createPartAlias",
      targetType: "part_alias",
      targetId: derived.docId,
      outcome: "applied",
      summary: `created ${input.aliasType} alias for part ${partId.value} fpv=${fpv} v=1 fp=${fp}`,
    });
    if (failAfterStage) throw failAfterStage;
    return { outcome: "applied", version: 1, aliasId: derived.docId };
  });
}

export interface ChangeAliasStatusInput {
  actorUid: string;
  idempotencyKey: string;
  aliasId: string;
  expectedVersion: number;
}

async function changeAliasStatus(
  input: ChangeAliasStatusInput,
  target: "ACTIVE" | "INACTIVE",
  action: "deactivatePartAlias" | "reactivatePartAlias",
  deps?: PartMasterDeps
): Promise<MutationOutcome> {
  const { db, roles, now, failAfterStage } = __pm_internal_resolveDeps(deps);
  __pm_internal_assertActorUid(input.actorUid);
  __pm_internal_assertIdempotencyKey(input.idempotencyKey);
  if (typeof input.aliasId !== "string" || input.aliasId.length === 0) throw new InvalidInputError("aliasId is required");
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) throw new InvalidInputError("expectedVersion must be a positive integer");
  await __pm_internal_requireCapabilityOrAudit(db, roles, input.actorUid, CAP_CATALOG_MANAGE, action, "part_alias", input.aliasId);

  const aliasRepo = buildFirestorePartAliasRepository(db);
  const fp = __pm_internal_fingerprint([action, input.aliasId, input.expectedVersion]);
  const auditId = __pm_internal_auditDocId(action, input.actorUid, input.aliasId, input.idempotencyKey);

  return db.runTransaction(async (txn) => {
    const replay = await __pm_internal_checkIdempotency(db, txn, auditId, fp);
    if (replay) return replay;
    const existing = await aliasRepo.getByAliasId(txn, input.aliasId as PartAliasId);
    if (existing === null) throw new NotFoundError(`alias ${input.aliasId} not found`);
    if (existing.version !== input.expectedVersion) {
      throw new VersionConflictError(`expectedVersion ${input.expectedVersion}, stored ${existing.version}`);
    }
    if (existing.status === target) throw new InvalidInputError(`alias is already ${target}`);
    const at = now();
    const newVersion = existing.version + 1;
    aliasRepo.stageUpdate(txn, {
      ...existing,
      status: target,
      ...(target === "INACTIVE" ? { deactivatedAt: at, deactivatedBy: input.actorUid } : {}),
      version: newVersion,
      updatedAt: at,
      updatedBy: input.actorUid,
    });
    stageAuditEventWithId(txn, auditId, {
      actorUid: input.actorUid,
      action,
      targetType: "part_alias",
      targetId: input.aliasId,
      outcome: "applied",
      summary: `alias ${existing.aliasType} for part ${existing.partId} ${existing.status}->${target} fpv=${valueFingerprint(existing.normalizedValue)} v=${newVersion} fp=${fp}`,
    });
    if (failAfterStage) throw failAfterStage;
    return { outcome: "applied", version: newVersion };
  });
}

export const deactivatePartAlias = (input: ChangeAliasStatusInput, deps?: PartMasterDeps) =>
  changeAliasStatus(input, "INACTIVE", "deactivatePartAlias", deps);
/** Reactivation is explicit and conflict-safe: only the OWNING part's
 * inactive alias can be reactivated (ownership never transfers). */
export const reactivatePartAlias = (input: ChangeAliasStatusInput, deps?: PartMasterDeps) =>
  changeAliasStatus(input, "ACTIVE", "reactivatePartAlias", deps);

// ---------------------------------------------------------------------------
// Deterministic lookup (internal read service; no audit per current
// governance -- reads are not audited anywhere in this platform's model).
// ---------------------------------------------------------------------------
export type AliasResolution =
  | { readonly result: "FOUND"; readonly partId: PartId; readonly aliasId: PartAliasId; readonly aliasType: AliasType; readonly status: "ACTIVE" }
  | { readonly result: "INACTIVE"; readonly partId: PartId; readonly aliasId: PartAliasId; readonly aliasType: AliasType }
  | { readonly result: "NOT_FOUND" }
  | { readonly result: "MALFORMED"; readonly detail: string }
  | { readonly result: "CONFLICT"; readonly detail: string }; // structurally unreachable today (unique doc id); reserved

export async function resolvePartAlias(
  input: { aliasType: string; rawValue: string; manufacturerId?: string },
  deps?: PartMasterDeps
): Promise<AliasResolution> {
  const db = deps?.db ?? getFirestore();
  assertAliasType(input.aliasType);
  let manufacturerId: ManufacturerId | undefined;
  if (input.manufacturerId !== undefined) {
    const m = parseManufacturerId(input.manufacturerId);
    if (!m.valid) return { result: "MALFORMED", detail: "invalid manufacturerId" };
    manufacturerId = m.value;
  }
  const derived = deriveAliasDocId(input.aliasType, input.rawValue, manufacturerId);
  if (derived === null) return { result: "MALFORMED", detail: `invalid ${input.aliasType} value` };
  try {
    const alias = await buildFirestorePartAliasRepository(db).getByAliasId(null, derived.docId);
    if (alias === null) return { result: "NOT_FOUND" };
    if (alias.status !== "ACTIVE") {
      return { result: "INACTIVE", partId: alias.partId, aliasId: alias.aliasId, aliasType: alias.aliasType };
    }
    return { result: "FOUND", partId: alias.partId, aliasId: alias.aliasId, aliasType: alias.aliasType, status: "ACTIVE" };
  } catch (err) {
    return { result: "MALFORMED", detail: err instanceof Error ? err.message : String(err) };
  }
}
