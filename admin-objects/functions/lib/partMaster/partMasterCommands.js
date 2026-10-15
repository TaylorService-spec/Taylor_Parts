"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.PART_STATUS_TRANSITIONS = exports.ControlTypeImmutableError = exports.InvalidStatusTransitionError = exports.IdempotencyConflictError = exports.VersionConflictError = exports.AlreadyExistsError = exports.NotFoundError = exports.UnauthorizedActorError = exports.InvalidInputError = exports.CAP_CATALOG_ACTIVATE = exports.CAP_CATALOG_MANAGE = void 0;
exports.assertEquipmentModelExists = assertEquipmentModelExists;
exports.assertControlTypeImmutable = assertControlTypeImmutable;
exports.createPart = createPart;
exports.updatePart = updatePart;
exports.changePartStatus = changePartStatus;
exports.createManufacturer = createManufacturer;
exports.updateManufacturer = updateManufacturer;
exports.changeManufacturerStatus = changeManufacturerStatus;
exports.__pm_internal_resolveDeps = resolveDeps;
exports.__pm_internal_assertActorUid = assertActorUid;
exports.__pm_internal_assertIdempotencyKey = assertIdempotencyKey;
exports.__pm_internal_requireCapabilityOrAudit = requireCapabilityOrAudit;
exports.__pm_internal_fingerprint = fingerprint;
exports.__pm_internal_auditDocId = auditDocId;
exports.__pm_internal_checkIdempotency = checkIdempotency;
const node_crypto_1 = require("node:crypto");
const firestore_1 = require("firebase-admin/firestore");
const compatibilityRoles_1 = require("../access/compatibilityRoles");
const governedBusinessRoles_1 = require("../access/governedBusinessRoles");
const resolveEffectivePermission_1 = require("../access/resolveEffectivePermission");
const compactClaims_1 = require("../access/compactClaims");
const auditEventWriter_1 = require("../access/auditEventWriter");
const partMasterRepository_1 = require("./partMasterRepository");
const validation_1 = require("./validation");
const repository_1 = require("../equipmentCompatibility/repository");
const types_1 = require("./types");
// Catalog cutover: the catalog writer authority state (OPEN today; see catalogMaster/catalogWriterState.ts).
const catalogWriterState_1 = require("../catalogMaster/catalogWriterState");
exports.CAP_CATALOG_MANAGE = "inventory.catalog.manage";
exports.CAP_CATALOG_ACTIVATE = "inventory.catalog.activate";
// Typed error taxonomy (house class-per-reason convention).
class InvalidInputError extends Error {
}
exports.InvalidInputError = InvalidInputError;
class UnauthorizedActorError extends Error {
}
exports.UnauthorizedActorError = UnauthorizedActorError;
class NotFoundError extends Error {
}
exports.NotFoundError = NotFoundError;
class AlreadyExistsError extends Error {
}
exports.AlreadyExistsError = AlreadyExistsError;
class VersionConflictError extends Error {
}
exports.VersionConflictError = VersionConflictError;
class IdempotencyConflictError extends Error {
}
exports.IdempotencyConflictError = IdempotencyConflictError;
class InvalidStatusTransitionError extends Error {
}
exports.InvalidStatusTransitionError = InvalidStatusTransitionError;
class ControlTypeImmutableError extends Error {
}
exports.ControlTypeImmutableError = ControlTypeImmutableError;
exports.PART_STATUS_TRANSITIONS = {
    DRAFT: ["ACTIVE"],
    ACTIVE: ["INACTIVE", "DISCONTINUED", "SUPERSEDED"],
    INACTIVE: ["ACTIVE", "DISCONTINUED", "SUPERSEDED"],
    DISCONTINUED: [],
    SUPERSEDED: [],
};
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,200}$/;
function allRoles() {
    return { ...compatibilityRoles_1.COMPATIBILITY_ROLES, ...governedBusinessRoles_1.GOVERNED_BUSINESS_ROLES };
}
function resolveDeps(deps) {
    return {
        db: deps?.db ?? (0, firestore_1.getFirestore)(),
        roles: deps?.roles ?? allRoles(),
        now: deps?.now ?? (() => new Date()),
        failAfterStage: deps?.__simulateFailureAfterStage,
    };
}
function assertActorUid(actorUid) {
    if (typeof actorUid !== "string" || actorUid.length === 0)
        throw new InvalidInputError("actorUid is required");
}
function assertIdempotencyKey(key) {
    if (typeof key !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
        throw new InvalidInputError("idempotencyKey must match [A-Za-z0-9_-]{8,200}");
    }
}
function readAccessVersion(data) {
    if (!data || data.accessVersion === undefined || data.accessVersion === null)
        return 0;
    return (0, compactClaims_1.isValidAccessVersionValue)(data.accessVersion) ? data.accessVersion : 0;
}
const GLOBAL_TARGET = { scope: { type: "global" }, condition: {} };
async function hasCapability(db, roles, actorUid, capabilityId) {
    const [userSnap, assignmentsSnap] = await Promise.all([
        db.collection("users").doc(actorUid).get(),
        db.collection("roleAssignments").where("principalUid", "==", actorUid).where("status", "==", "active").get(),
    ]);
    return ((0, resolveEffectivePermission_1.resolveEffectivePermission)({
        permissionId: capabilityId,
        assignments: assignmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        roles,
        currentAccessVersion: readAccessVersion(userSnap.data()),
        target: GLOBAL_TARGET,
    }).decision === "ALLOW");
}
async function requireCapabilityOrAudit(db, roles, actorUid, capabilityId, action, targetType, targetId) {
    if (await hasCapability(db, roles, actorUid, capabilityId))
        return;
    await (0, auditEventWriter_1.recordStandaloneAuditEvent)({
        actorUid,
        action,
        targetType,
        targetId,
        outcome: "denied",
        summary: `denied: actor lacks ${capabilityId}`,
    });
    throw new UnauthorizedActorError(`actor is not authorized for "${capabilityId}"`);
}
function fingerprint(payload) {
    return (0, node_crypto_1.createHash)("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}
function auditDocId(operation, actorUid, targetId, key) {
    return "pm_" + (0, node_crypto_1.createHash)("sha256").update(`${operation}|${actorUid}|${targetId}|${key}`).digest("hex").slice(0, 40);
}
const FP_TAG = /fp=([0-9a-f]{16})/;
// Shared transactional idempotency guard: returns "replayed" outcome if the
// deterministic audit doc already exists with a MATCHING fingerprint;
// throws IdempotencyConflictError on mismatch; returns null when the
// operation should proceed.
async function checkIdempotency(db, txn, auditId, fp) {
    const snap = await txn.get(db.collection("auditEvents").doc(auditId));
    if (!snap.exists)
        return null;
    const summary = String((snap.data() ?? {}).summary ?? "");
    const stored = FP_TAG.exec(summary)?.[1];
    if (stored !== fp)
        throw new IdempotencyConflictError("idempotencyKey was already used for a different request");
    const versionMatch = /v=(\d+)/.exec(summary);
    return { outcome: "replayed", version: versionMatch ? Number(versionMatch[1]) : partMasterRepository_1.INITIAL_VERSION };
}
// Referential integrity for the equipment-model FK (Option A, Owner §5: "do not allow arbitrary unknown model
// ids"). PURE + injectable: given the FK (or undefined) and an existence reader, it throws when the id does not
// resolve to a real equipment_models document. The command supplies a transaction-scoped reader; tests supply a
// stub. A part with no FK is a no-op. The FORMAT is already validated (validatePart → isCanonicalEquipmentModelId).
async function assertEquipmentModelExists(equipmentModelId, exists) {
    if (equipmentModelId === undefined)
        return;
    if (!(await exists(equipmentModelId))) {
        throw new InvalidInputError(`equipmentModelId "${equipmentModelId}" does not reference a known equipment_models identity`);
    }
}
// ---------------------------------------------------------------------------
// P1B R2 -- `controlType` is IMMUTABLE after Part creation (TRANSITION RULE).
//
// A Movement's `tracking_mode` is historical EVIDENCE: it records how a given
// quantity was actually controlled at the moment it moved. `Part.controlType`
// is POLICY for FUTURE operations. The two must never be conflated, because
// re-reading history through today's policy silently reinterprets movements
// that were recorded under a different one -- a STANDARD receipt would become
// a serial-tracked receipt with no serials, or a SERIALIZED issue would become
// countable stock.
//
// The safe-looking alternative -- "allow the change only when no history
// exists" -- is DELIBERATELY NOT IMPLEMENTED. It would require a ledger query
// (inventory movements / serialized assets) from this command, which grows the
// very Firebase dependency the exit ratchet is shrinking, and it answers a
// question that is ambiguous during migration anyway: "no history" in Firestore
// does not mean "no history", because the ledger is mid-cutover to Postgres.
// A blanket refusal is the only answer that is correct under BOTH authorities.
//
// This is a TRANSITION rule, not a permanent one: a future GOVERNED conversion
// command (explicit actor, explicit reason, its own audit action, and a
// migration-complete ledger to interrogate) may relax it. Until that command
// exists, the answer is no.
//
// PURE + exported so the rule is testable without Firestore (the
// assertEquipmentModelExists precedent). Same-value is NOT a change: an update
// that re-sends the stored controlType, or omits it entirely, is idempotent and
// must not refuse.
function assertControlTypeImmutable(stored, requested) {
    if (requested === stored)
        return;
    throw new ControlTypeImmutableError(`controlType is immutable after part creation (stored "${stored}", requested "${requested}")`);
}
async function createPart(input, deps) {
    (0, catalogWriterState_1.assertFirestoreCatalogWriterOpen)("part.create");
    const { db, roles, now, failAfterStage } = resolveDeps(deps);
    assertActorUid(input.actorUid);
    assertIdempotencyKey(input.idempotencyKey);
    const validated = (0, validation_1.validatePart)(input.part);
    if (!validated.valid) {
        throw new InvalidInputError(`invalid part: ${validated.errors.map((e) => `${e.path}:${e.code}`).join(",")}`);
    }
    const part = validated.value;
    await requireCapabilityOrAudit(db, roles, input.actorUid, exports.CAP_CATALOG_MANAGE, "createPart", "part", part.partId);
    const repo = (0, partMasterRepository_1.buildFirestorePartRepository)(db);
    const fp = fingerprint(["createPart", part]);
    const auditId = auditDocId("createPart", input.actorUid, part.partId, input.idempotencyKey);
    return db.runTransaction(async (txn) => {
        const replay = await checkIdempotency(db, txn, auditId, fp);
        if (replay)
            return replay;
        const existing = await repo.getById(txn, part.partId);
        if (existing !== null)
            throw new AlreadyExistsError(`part ${part.partId} already exists`);
        // Referential integrity: the equipment-model FK (whole-unit Parts only) must resolve to a real catalog doc.
        // Read inside the transaction, before any staged write.
        await assertEquipmentModelExists(part.equipmentModelId, async (id) => (await txn.get(db.collection(repository_1.EQUIPMENT_MODELS_COLLECTION).doc(id))).exists);
        const at = now();
        const stored = {
            part,
            version: partMasterRepository_1.INITIAL_VERSION,
            createdAt: at,
            createdBy: input.actorUid,
            updatedAt: at,
            updatedBy: input.actorUid,
        };
        repo.stageCreate(txn, stored);
        (0, auditEventWriter_1.stageAuditEventWithId)(txn, auditId, {
            actorUid: input.actorUid,
            action: "createPart",
            targetType: "part",
            targetId: part.partId,
            outcome: "applied",
            summary: `created part ${part.partId} (${part.internalPartNumber}) v=${partMasterRepository_1.INITIAL_VERSION} fp=${fp}`,
        });
        if (failAfterStage)
            throw failAfterStage;
        return { outcome: "applied", version: partMasterRepository_1.INITIAL_VERSION };
    });
}
const UPDATABLE_FIELDS = new Set(["internalPartNumber", "name", "description", "category", "stockingUnit", "controlType", "stockingClass", "flags", "manufacturerId", "manufacturerPartNumber", "oemStatus", "wholeUnit", "equipmentModelId"]);
async function updatePart(input, deps) {
    (0, catalogWriterState_1.assertFirestoreCatalogWriterOpen)("part.update");
    const { db, roles, now, failAfterStage } = resolveDeps(deps);
    assertActorUid(input.actorUid);
    assertIdempotencyKey(input.idempotencyKey);
    const partId = (0, validation_1.parsePartId)(input.partId);
    if (!partId.valid)
        throw new InvalidInputError("invalid partId");
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < partMasterRepository_1.INITIAL_VERSION) {
        throw new InvalidInputError("expectedVersion must be a positive integer");
    }
    const changeKeys = Object.keys(input.changes ?? {});
    if (changeKeys.length === 0)
        throw new InvalidInputError("changes must not be empty");
    for (const k of changeKeys) {
        if (!UPDATABLE_FIELDS.has(k))
            throw new InvalidInputError(`field "${k}" is not updatable`);
    }
    await requireCapabilityOrAudit(db, roles, input.actorUid, exports.CAP_CATALOG_MANAGE, "updatePart", "part", partId.value);
    const repo = (0, partMasterRepository_1.buildFirestorePartRepository)(db);
    const fp = fingerprint(["updatePart", partId.value, input.expectedVersion, input.changes]);
    const auditId = auditDocId("updatePart", input.actorUid, partId.value, input.idempotencyKey);
    return db.runTransaction(async (txn) => {
        const replay = await checkIdempotency(db, txn, auditId, fp);
        if (replay)
            return replay;
        const existing = await repo.getById(txn, partId.value);
        if (existing === null)
            throw new NotFoundError(`part ${partId.value} not found`);
        if (existing.version !== input.expectedVersion) {
            throw new VersionConflictError(`expectedVersion ${input.expectedVersion}, stored ${existing.version}`);
        }
        // Re-validate the merged domain object through PR 1.1 (status unchanged here).
        const merged = (0, validation_1.validatePart)({ ...existing.part, ...input.changes, partId: partId.value, status: existing.part.status });
        if (!merged.valid) {
            throw new InvalidInputError(`invalid update: ${merged.errors.map((e) => `${e.path}:${e.code}`).join(",")}`);
        }
        // P1B R2 -- controlType is immutable after creation. Checked on the MERGED value, so an omitted
        // controlType (which inherits the stored one) and a same-value resend both pass untouched, while a
        // real change refuses BEFORE any read or staged write. Deliberately AFTER validatePart, so an
        // unknown controlType still refuses through the existing domain-validation path (INVALID_ENUM)
        // rather than being reported as an immutability violation. No ledger query: see
        // assertControlTypeImmutable.
        assertControlTypeImmutable(existing.part.controlType, merged.value.controlType);
        // Referential integrity for the (possibly changed) equipment-model FK — read before any staged write.
        await assertEquipmentModelExists(merged.value.equipmentModelId, async (id) => (await txn.get(db.collection(repository_1.EQUIPMENT_MODELS_COLLECTION).doc(id))).exists);
        // INV-1 PR 1.3 -- internalPartNumber historical-alias backfill (the
        // documented PR 1.2 -> 1.3 dependency). When the governed business
        // number changes: the OLD value is preserved as an ACTIVE INTERNAL_PN
        // alias resolving to this same part, atomically with the Part update;
        // a conflicting alias identity (old OR new value owned by another
        // part) rejects the ENTIRE update before any write. All reads happen
        // before any staged write (Firestore transaction rule).
        const ipnChanged = merged.value.internalPartNumber !== existing.part.internalPartNumber;
        let backfill = null;
        if (ipnChanged) {
            const { deriveAliasDocId: deriveId, buildFirestorePartAliasRepository: aliasRepoFor } = await import("./partAliasRepository.js");
            const aliasRepo = aliasRepoFor(db);
            const oldD = deriveId("INTERNAL_PN", existing.part.internalPartNumber);
            const newD = deriveId("INTERNAL_PN", merged.value.internalPartNumber);
            if (oldD === null || newD === null)
                throw new InvalidInputError("internalPartNumber failed alias derivation");
            const [oldAlias, newAlias] = [
                await aliasRepo.getByAliasId(txn, oldD.docId),
                await aliasRepo.getByAliasId(txn, newD.docId),
            ];
            if (newAlias !== null && newAlias.partId !== partId.value) {
                throw new AlreadyExistsError("new internalPartNumber is an alias identity owned by another part");
            }
            if (oldAlias !== null && oldAlias.partId !== partId.value) {
                throw new AlreadyExistsError("previous internalPartNumber is an alias identity owned by another part");
            }
            if (oldAlias === null) {
                const at = now();
                backfill = {
                    stage: () => {
                        aliasRepo.stageCreate(txn, {
                            aliasId: oldD.docId,
                            partId: partId.value,
                            aliasType: "INTERNAL_PN",
                            originalValue: existing.part.internalPartNumber,
                            normalizedValue: oldD.normalizedValue,
                            status: "ACTIVE",
                            source: "internalPartNumber-backfill",
                            version: 1,
                            createdAt: at,
                            createdBy: input.actorUid,
                            updatedAt: at,
                            updatedBy: input.actorUid,
                        });
                        (0, auditEventWriter_1.stageAuditEventWithId)(txn, `${auditId}a`, {
                            actorUid: input.actorUid,
                            action: "preserveInternalPartNumberAlias",
                            targetType: "part_alias",
                            targetId: oldD.docId,
                            outcome: "applied",
                            summary: `preserved prior internalPartNumber of part ${partId.value} as INTERNAL_PN alias v=1 fp=${fp}`,
                        });
                    },
                };
            }
            // oldAlias !== null && same part: already preserved -- no duplicate.
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
        if (backfill)
            backfill.stage();
        (0, auditEventWriter_1.stageAuditEventWithId)(txn, auditId, {
            actorUid: input.actorUid,
            action: "updatePart",
            targetType: "part",
            targetId: partId.value,
            outcome: "applied",
            summary: `updated part ${partId.value} fields=[${changeKeys.sort().join(",")}] v=${newVersion} fp=${fp}`,
        });
        if (failAfterStage)
            throw failAfterStage;
        return { outcome: "applied", version: newVersion };
    });
}
async function changePartStatus(input, deps) {
    (0, catalogWriterState_1.assertFirestoreCatalogWriterOpen)("part.changeStatus");
    const { db, roles, now, failAfterStage } = resolveDeps(deps);
    assertActorUid(input.actorUid);
    assertIdempotencyKey(input.idempotencyKey);
    const partId = (0, validation_1.parsePartId)(input.partId);
    if (!partId.valid)
        throw new InvalidInputError("invalid partId");
    if (!types_1.PART_STATUSES.includes(input.newStatus)) {
        throw new InvalidInputError(`newStatus must be one of ${types_1.PART_STATUSES.join("/")}`);
    }
    await requireCapabilityOrAudit(db, roles, input.actorUid, exports.CAP_CATALOG_ACTIVATE, "changePartStatus", "part", partId.value);
    const repo = (0, partMasterRepository_1.buildFirestorePartRepository)(db);
    const fp = fingerprint(["changePartStatus", partId.value, input.expectedVersion, input.newStatus]);
    const auditId = auditDocId("changePartStatus", input.actorUid, partId.value, input.idempotencyKey);
    return db.runTransaction(async (txn) => {
        const replay = await checkIdempotency(db, txn, auditId, fp);
        if (replay)
            return replay;
        const existing = await repo.getById(txn, partId.value);
        if (existing === null)
            throw new NotFoundError(`part ${partId.value} not found`);
        if (existing.version !== input.expectedVersion) {
            throw new VersionConflictError(`expectedVersion ${input.expectedVersion}, stored ${existing.version}`);
        }
        const from = existing.part.status;
        const to = input.newStatus;
        if (!exports.PART_STATUS_TRANSITIONS[from].includes(to)) {
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
        (0, auditEventWriter_1.stageAuditEventWithId)(txn, auditId, {
            actorUid: input.actorUid,
            action: "changePartStatus",
            targetType: "part",
            targetId: partId.value,
            outcome: "applied",
            summary: `part ${partId.value} status ${from}->${to} v=${newVersion} fp=${fp}`,
        });
        if (failAfterStage)
            throw failAfterStage;
        return { outcome: "applied", version: newVersion };
    });
}
async function createManufacturer(input, deps) {
    (0, catalogWriterState_1.assertFirestoreCatalogWriterOpen)("manufacturer.create");
    const { db, roles, now, failAfterStage } = resolveDeps(deps);
    assertActorUid(input.actorUid);
    assertIdempotencyKey(input.idempotencyKey);
    const mid = (0, validation_1.parseManufacturerId)(input.manufacturerId);
    if (!mid.valid)
        throw new InvalidInputError("invalid manufacturerId");
    if (typeof input.name !== "string" || input.name.trim().length === 0 || input.name.length > 200) {
        throw new InvalidInputError("name is required (max 200 chars)");
    }
    await requireCapabilityOrAudit(db, roles, input.actorUid, exports.CAP_CATALOG_MANAGE, "createManufacturer", "manufacturer", mid.value);
    const repo = (0, partMasterRepository_1.buildFirestoreManufacturerRepository)(db);
    const manufacturer = { manufacturerId: mid.value, name: input.name.trim(), status: "ACTIVE" };
    const fp = fingerprint(["createManufacturer", manufacturer]);
    const auditId = auditDocId("createManufacturer", input.actorUid, mid.value, input.idempotencyKey);
    return db.runTransaction(async (txn) => {
        const replay = await checkIdempotency(db, txn, auditId, fp);
        if (replay)
            return replay;
        const existing = await repo.getById(txn, mid.value);
        if (existing !== null)
            throw new AlreadyExistsError(`manufacturer ${mid.value} already exists`);
        const at = now();
        repo.stageCreate(txn, {
            manufacturer,
            version: partMasterRepository_1.INITIAL_VERSION,
            createdAt: at,
            createdBy: input.actorUid,
            updatedAt: at,
            updatedBy: input.actorUid,
        });
        (0, auditEventWriter_1.stageAuditEventWithId)(txn, auditId, {
            actorUid: input.actorUid,
            action: "createManufacturer",
            targetType: "manufacturer",
            targetId: mid.value,
            outcome: "applied",
            summary: `created manufacturer ${mid.value} v=${partMasterRepository_1.INITIAL_VERSION} fp=${fp}`,
        });
        if (failAfterStage)
            throw failAfterStage;
        return { outcome: "applied", version: partMasterRepository_1.INITIAL_VERSION };
    });
}
async function updateManufacturer(input, deps) {
    (0, catalogWriterState_1.assertFirestoreCatalogWriterOpen)("manufacturer.update");
    const { db, roles, now, failAfterStage } = resolveDeps(deps);
    assertActorUid(input.actorUid);
    assertIdempotencyKey(input.idempotencyKey);
    const mid = (0, validation_1.parseManufacturerId)(input.manufacturerId);
    if (!mid.valid)
        throw new InvalidInputError("invalid manufacturerId");
    if (typeof input.name !== "string" || input.name.trim().length === 0 || input.name.length > 200) {
        throw new InvalidInputError("name is required (max 200 chars)");
    }
    await requireCapabilityOrAudit(db, roles, input.actorUid, exports.CAP_CATALOG_MANAGE, "updateManufacturer", "manufacturer", mid.value);
    const repo = (0, partMasterRepository_1.buildFirestoreManufacturerRepository)(db);
    const fp = fingerprint(["updateManufacturer", mid.value, input.expectedVersion, input.name.trim()]);
    const auditId = auditDocId("updateManufacturer", input.actorUid, mid.value, input.idempotencyKey);
    return db.runTransaction(async (txn) => {
        const replay = await checkIdempotency(db, txn, auditId, fp);
        if (replay)
            return replay;
        const existing = await repo.getById(txn, mid.value);
        if (existing === null)
            throw new NotFoundError(`manufacturer ${mid.value} not found`);
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
        (0, auditEventWriter_1.stageAuditEventWithId)(txn, auditId, {
            actorUid: input.actorUid,
            action: "updateManufacturer",
            targetType: "manufacturer",
            targetId: mid.value,
            outcome: "applied",
            summary: `updated manufacturer ${mid.value} v=${newVersion} fp=${fp}`,
        });
        if (failAfterStage)
            throw failAfterStage;
        return { outcome: "applied", version: newVersion };
    });
}
async function changeManufacturerStatus(input, deps) {
    (0, catalogWriterState_1.assertFirestoreCatalogWriterOpen)("manufacturer.changeStatus");
    const { db, roles, now, failAfterStage } = resolveDeps(deps);
    assertActorUid(input.actorUid);
    assertIdempotencyKey(input.idempotencyKey);
    const mid = (0, validation_1.parseManufacturerId)(input.manufacturerId);
    if (!mid.valid)
        throw new InvalidInputError("invalid manufacturerId");
    if (!types_1.MANUFACTURER_STATUSES.includes(input.newStatus)) {
        throw new InvalidInputError(`newStatus must be one of ${types_1.MANUFACTURER_STATUSES.join("/")}`);
    }
    await requireCapabilityOrAudit(db, roles, input.actorUid, exports.CAP_CATALOG_ACTIVATE, "changeManufacturerStatus", "manufacturer", mid.value);
    const repo = (0, partMasterRepository_1.buildFirestoreManufacturerRepository)(db);
    const fp = fingerprint(["changeManufacturerStatus", mid.value, input.expectedVersion, input.newStatus]);
    const auditId = auditDocId("changeManufacturerStatus", input.actorUid, mid.value, input.idempotencyKey);
    return db.runTransaction(async (txn) => {
        const replay = await checkIdempotency(db, txn, auditId, fp);
        if (replay)
            return replay;
        const existing = await repo.getById(txn, mid.value);
        if (existing === null)
            throw new NotFoundError(`manufacturer ${mid.value} not found`);
        if (existing.version !== input.expectedVersion) {
            throw new VersionConflictError(`expectedVersion ${input.expectedVersion}, stored ${existing.version}`);
        }
        const from = existing.manufacturer.status;
        const to = input.newStatus;
        if (from === to)
            throw new InvalidStatusTransitionError(`manufacturer already ${to}`);
        const newVersion = existing.version + 1;
        repo.stageUpdate(txn, {
            manufacturer: { ...existing.manufacturer, status: to },
            version: newVersion,
            createdAt: existing.createdAt,
            createdBy: existing.createdBy,
            updatedAt: now(),
            updatedBy: input.actorUid,
        });
        (0, auditEventWriter_1.stageAuditEventWithId)(txn, auditId, {
            actorUid: input.actorUid,
            action: "changeManufacturerStatus",
            targetType: "manufacturer",
            targetId: mid.value,
            outcome: "applied",
            summary: `manufacturer ${mid.value} status ${from}->${to} v=${newVersion} fp=${fp}`,
        });
        if (failAfterStage)
            throw failAfterStage;
        return { outcome: "applied", version: newVersion };
    });
}
//# sourceMappingURL=partMasterCommands.js.map