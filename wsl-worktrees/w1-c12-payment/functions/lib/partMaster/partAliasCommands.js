"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.reactivatePartAlias = exports.deactivatePartAlias = exports.valueFingerprint = void 0;
exports.createPartAlias = createPartAlias;
exports.resolvePartAlias = resolvePartAlias;
const node_crypto_1 = require("node:crypto");
const firestore_1 = require("firebase-admin/firestore");
const auditEventWriter_1 = require("../access/auditEventWriter");
const types_1 = require("./types");
const validation_1 = require("./validation");
const partMasterRepository_1 = require("./partMasterRepository");
const partAliasRepository_1 = require("./partAliasRepository");
const partMasterCommands_1 = require("./partMasterCommands");
// Re-exported guts of partMasterCommands used here (kept in that module to
// avoid a second capability/idempotency implementation).
const partMasterCommands_2 = require("./partMasterCommands");
const valueFingerprint = (normalizedValue) => (0, node_crypto_1.createHash)("sha256").update(normalizedValue).digest("hex").slice(0, 16);
exports.valueFingerprint = valueFingerprint;
function assertAliasType(v) {
    if (typeof v !== "string" || !types_1.ALIAS_TYPES.includes(v)) {
        throw new partMasterCommands_1.InvalidInputError(`aliasType must be one of ${types_1.ALIAS_TYPES.join("/")}`);
    }
}
async function createPartAlias(input, deps) {
    const { db, roles, now, failAfterStage } = (0, partMasterCommands_2.__pm_internal_resolveDeps)(deps);
    (0, partMasterCommands_2.__pm_internal_assertActorUid)(input.actorUid);
    (0, partMasterCommands_2.__pm_internal_assertIdempotencyKey)(input.idempotencyKey);
    assertAliasType(input.aliasType);
    const partId = (0, validation_1.parsePartId)(input.partId);
    if (!partId.valid)
        throw new partMasterCommands_1.InvalidInputError("invalid partId");
    let manufacturerId;
    if (input.manufacturerId !== undefined) {
        const m = (0, validation_1.parseManufacturerId)(input.manufacturerId);
        if (!m.valid)
            throw new partMasterCommands_1.InvalidInputError("invalid manufacturerId");
        manufacturerId = m.value;
    }
    if (typeof input.effectiveFrom === "string" && typeof input.effectiveTo === "string" &&
        input.effectiveFrom > input.effectiveTo) {
        throw new partMasterCommands_1.InvalidInputError("effectiveTo must not precede effectiveFrom");
    }
    const derived = (0, partAliasRepository_1.deriveAliasDocId)(input.aliasType, input.rawValue, manufacturerId);
    if (derived === null)
        throw new partMasterCommands_1.InvalidInputError(`invalid ${input.aliasType} value`);
    const fpv = (0, exports.valueFingerprint)(derived.normalizedValue);
    await (0, partMasterCommands_2.__pm_internal_requireCapabilityOrAudit)(db, roles, input.actorUid, partMasterCommands_1.CAP_CATALOG_MANAGE, "createPartAlias", "part_alias", derived.docId);
    const partRepo = (0, partMasterRepository_1.buildFirestorePartRepository)(db);
    const aliasRepo = (0, partAliasRepository_1.buildFirestorePartAliasRepository)(db);
    const fp = (0, partMasterCommands_2.__pm_internal_fingerprint)(["createPartAlias", partId.value, derived.docId, input.effectiveFrom ?? null, input.effectiveTo ?? null]);
    const auditId = (0, partMasterCommands_2.__pm_internal_auditDocId)("createPartAlias", input.actorUid, partId.value, input.idempotencyKey);
    return db.runTransaction(async (txn) => {
        const replay = await (0, partMasterCommands_2.__pm_internal_checkIdempotency)(db, txn, auditId, fp);
        if (replay)
            return { ...replay, aliasId: derived.docId };
        const part = await partRepo.getById(txn, partId.value);
        if (part === null)
            throw new partMasterCommands_1.NotFoundError(`part ${partId.value} not found`);
        const existing = await aliasRepo.getByAliasId(txn, derived.docId);
        if (existing !== null) {
            if (existing.partId === partId.value && existing.status === "ACTIVE") {
                // Equivalent active alias for the SAME part: idempotent-equivalent success.
                return { outcome: "replayed", version: existing.version, aliasId: derived.docId };
            }
            // Active or inactive alias owned by ANOTHER part, or inactive for the
            // same part: explicit conflict -- never silent reassignment/reactivation.
            await (0, auditEventWriter_1.recordStandaloneAuditEvent)({
                actorUid: input.actorUid,
                action: "createPartAlias",
                targetType: "part_alias",
                targetId: derived.docId,
                outcome: "denied",
                summary: `conflict: alias ${input.aliasType} fpv=${fpv} already ${existing.status} for part ${existing.partId}`,
            });
            throw new partMasterCommands_1.AlreadyExistsError(existing.partId === partId.value
                ? `alias exists INACTIVE for this part -- use reactivatePartAlias`
                : `alias identity is owned by another part`);
        }
        const at = now();
        const stored = {
            aliasId: derived.docId,
            partId: partId.value,
            aliasType: input.aliasType,
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
        (0, auditEventWriter_1.stageAuditEventWithId)(txn, auditId, {
            actorUid: input.actorUid,
            action: "createPartAlias",
            targetType: "part_alias",
            targetId: derived.docId,
            outcome: "applied",
            summary: `created ${input.aliasType} alias for part ${partId.value} fpv=${fpv} v=1 fp=${fp}`,
        });
        if (failAfterStage)
            throw failAfterStage;
        return { outcome: "applied", version: 1, aliasId: derived.docId };
    });
}
async function changeAliasStatus(input, target, action, deps) {
    const { db, roles, now, failAfterStage } = (0, partMasterCommands_2.__pm_internal_resolveDeps)(deps);
    (0, partMasterCommands_2.__pm_internal_assertActorUid)(input.actorUid);
    (0, partMasterCommands_2.__pm_internal_assertIdempotencyKey)(input.idempotencyKey);
    if (typeof input.aliasId !== "string" || input.aliasId.length === 0)
        throw new partMasterCommands_1.InvalidInputError("aliasId is required");
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1)
        throw new partMasterCommands_1.InvalidInputError("expectedVersion must be a positive integer");
    await (0, partMasterCommands_2.__pm_internal_requireCapabilityOrAudit)(db, roles, input.actorUid, partMasterCommands_1.CAP_CATALOG_MANAGE, action, "part_alias", input.aliasId);
    const aliasRepo = (0, partAliasRepository_1.buildFirestorePartAliasRepository)(db);
    const fp = (0, partMasterCommands_2.__pm_internal_fingerprint)([action, input.aliasId, input.expectedVersion]);
    const auditId = (0, partMasterCommands_2.__pm_internal_auditDocId)(action, input.actorUid, input.aliasId, input.idempotencyKey);
    return db.runTransaction(async (txn) => {
        const replay = await (0, partMasterCommands_2.__pm_internal_checkIdempotency)(db, txn, auditId, fp);
        if (replay)
            return replay;
        const existing = await aliasRepo.getByAliasId(txn, input.aliasId);
        if (existing === null)
            throw new partMasterCommands_1.NotFoundError(`alias ${input.aliasId} not found`);
        if (existing.version !== input.expectedVersion) {
            throw new partMasterCommands_1.VersionConflictError(`expectedVersion ${input.expectedVersion}, stored ${existing.version}`);
        }
        if (existing.status === target)
            throw new partMasterCommands_1.InvalidInputError(`alias is already ${target}`);
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
        (0, auditEventWriter_1.stageAuditEventWithId)(txn, auditId, {
            actorUid: input.actorUid,
            action,
            targetType: "part_alias",
            targetId: input.aliasId,
            outcome: "applied",
            summary: `alias ${existing.aliasType} for part ${existing.partId} ${existing.status}->${target} fpv=${(0, exports.valueFingerprint)(existing.normalizedValue)} v=${newVersion} fp=${fp}`,
        });
        if (failAfterStage)
            throw failAfterStage;
        return { outcome: "applied", version: newVersion };
    });
}
const deactivatePartAlias = (input, deps) => changeAliasStatus(input, "INACTIVE", "deactivatePartAlias", deps);
exports.deactivatePartAlias = deactivatePartAlias;
/** Reactivation is explicit and conflict-safe: only the OWNING part's
 * inactive alias can be reactivated (ownership never transfers). */
const reactivatePartAlias = (input, deps) => changeAliasStatus(input, "ACTIVE", "reactivatePartAlias", deps);
exports.reactivatePartAlias = reactivatePartAlias;
async function resolvePartAlias(input, deps) {
    const db = deps?.db ?? (0, firestore_1.getFirestore)();
    assertAliasType(input.aliasType);
    let manufacturerId;
    if (input.manufacturerId !== undefined) {
        const m = (0, validation_1.parseManufacturerId)(input.manufacturerId);
        if (!m.valid)
            return { result: "MALFORMED", detail: "invalid manufacturerId" };
        manufacturerId = m.value;
    }
    const derived = (0, partAliasRepository_1.deriveAliasDocId)(input.aliasType, input.rawValue, manufacturerId);
    if (derived === null)
        return { result: "MALFORMED", detail: `invalid ${input.aliasType} value` };
    try {
        const alias = await (0, partAliasRepository_1.buildFirestorePartAliasRepository)(db).getByAliasId(null, derived.docId);
        if (alias === null)
            return { result: "NOT_FOUND" };
        if (alias.status !== "ACTIVE") {
            return { result: "INACTIVE", partId: alias.partId, aliasId: alias.aliasId, aliasType: alias.aliasType };
        }
        return { result: "FOUND", partId: alias.partId, aliasId: alias.aliasId, aliasType: alias.aliasType, status: "ACTIVE" };
    }
    catch (err) {
        return { result: "MALFORMED", detail: err instanceof Error ? err.message : String(err) };
    }
}
//# sourceMappingURL=partAliasCommands.js.map