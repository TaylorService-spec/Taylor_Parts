"use strict";
// Supplier Master (S2) -- trusted command service for the governed Supplier business object
// (DECISIONS #78). REUSES the established Part Master trusted-command machinery (capability check,
// idempotency, versioning, fingerprint, single-transaction, server-authored audit, bounded errors,
// fail-closed) via the exported __pm_internal_* helpers -- nothing reimplemented. Supplier is a
// catalog-governed object: create/update gate on inventory.catalog.manage, activate/deactivate on
// inventory.catalog.activate (the SAME capabilities parts/manufacturers/part_supplier_items use).
// No client-direct writes (suppliers Rules stay write-closed); these run Admin-SDK-only server-side.
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSupplier = createSupplier;
exports.updateSupplier = updateSupplier;
exports.activateSupplier = activateSupplier;
exports.deactivateSupplier = deactivateSupplier;
const firestore_1 = require("firebase-admin/firestore");
const operationalMovementValidation_js_1 = require("../inventoryLedger/operationalMovementValidation.js");
const auditEventWriter_js_1 = require("../access/auditEventWriter.js");
const partMasterRepository_js_1 = require("../partMaster/partMasterRepository.js");
const partMasterCommands_js_1 = require("../partMaster/partMasterCommands.js");
const catalogWriterState_js_1 = require("../catalogMaster/catalogWriterState.js");
const supplierMasterRepository_js_1 = require("./supplierMasterRepository.js");
const supplierMasterValidation_js_1 = require("./supplierMasterValidation.js");
const supplierMasterTypes_js_1 = require("./supplierMasterTypes.js");
const UPDATABLE_FIELDS = new Set(["name", ...supplierMasterTypes_js_1.SUPPLIER_OPTIONAL_STRING_FIELDS]);
function assertSupplierId(supplierId) {
    if (typeof supplierId !== "string" || !supplierMasterTypes_js_1.SUPPLIER_ID_PATTERN.test(supplierId)) {
        throw new partMasterCommands_js_1.InvalidInputError("supplierId must match [A-Za-z0-9_-]{1,64}");
    }
}
// Validate the optional business fields on an input map: each own-present must be a non-blank string.
function assertOptionalFields(src) {
    for (const f of supplierMasterTypes_js_1.SUPPLIER_OPTIONAL_STRING_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(src, f) && !(0, operationalMovementValidation_js_1.isNonEmptyString)(src[f])) {
            throw new partMasterCommands_js_1.InvalidInputError(`optional field "${f}" must be a non-blank string when present`);
        }
    }
}
async function createSupplier(input, deps) {
    (0, catalogWriterState_js_1.assertFirestoreCatalogWriterOpen)("supplier.create");
    const { db, roles, now, failAfterStage } = (0, partMasterCommands_js_1.__pm_internal_resolveDeps)(deps);
    (0, partMasterCommands_js_1.__pm_internal_assertActorUid)(input.actorUid);
    (0, partMasterCommands_js_1.__pm_internal_assertIdempotencyKey)(input.idempotencyKey);
    assertSupplierId(input.supplierId);
    if (!(0, operationalMovementValidation_js_1.isNonEmptyString)(input.name))
        throw new partMasterCommands_js_1.InvalidInputError("name is required");
    assertOptionalFields(input);
    const normalizedKey = (0, supplierMasterValidation_js_1.normalizeSupplierName)(input.name);
    if (normalizedKey === "")
        throw new partMasterCommands_js_1.InvalidInputError("name has no usable content after normalization");
    const { supplierId } = input;
    await (0, partMasterCommands_js_1.__pm_internal_requireCapabilityOrAudit)(db, roles, input.actorUid, partMasterCommands_js_1.CAP_CATALOG_MANAGE, "createSupplier", "supplier", supplierId);
    const repo = (0, supplierMasterRepository_js_1.buildFirestoreSupplierRepository)(db);
    const optionals = {};
    for (const f of supplierMasterTypes_js_1.SUPPLIER_OPTIONAL_STRING_FIELDS) {
        const v = input[f];
        if (v !== undefined)
            optionals[f] = v;
    }
    const fp = (0, partMasterCommands_js_1.__pm_internal_fingerprint)(["createSupplier", supplierId, input.name, normalizedKey, optionals]);
    const auditId = (0, partMasterCommands_js_1.__pm_internal_auditDocId)("createSupplier", input.actorUid, supplierId, input.idempotencyKey);
    return db.runTransaction(async (txn) => {
        const replay = await (0, partMasterCommands_js_1.__pm_internal_checkIdempotency)(db, txn, auditId, fp);
        // On idempotent replay we return [] for suspectedDuplicateOf by design: the flag list is not
        // persisted on the record (it drives human review, not state), so it cannot be recomputed here.
        // The ORIGINAL call's audit summary is the durable record of what was flagged.
        if (replay)
            return { ...replay, supplierId, suspectedDuplicateOf: [] };
        const existing = await repo.getById(txn, supplierId);
        if (existing !== null)
            throw new partMasterCommands_js_1.AlreadyExistsError(`supplier ${supplierId} already exists`);
        const dupes = await repo.findActiveByNormalizedKey(txn, normalizedKey, supplierId);
        const suspectedDuplicateOf = dupes.map((d) => d.id).sort();
        const at = firestore_1.Timestamp.fromDate(now());
        const supplier = {
            id: supplierId,
            name: input.name,
            normalizedKey,
            status: "ACTIVE",
            version: partMasterRepository_js_1.INITIAL_VERSION,
            createdAt: at,
            createdBy: input.actorUid,
            updatedAt: at,
            updatedBy: input.actorUid,
            ...optionals,
        };
        repo.stageCreate(txn, supplier);
        (0, auditEventWriter_js_1.stageAuditEventWithId)(txn, auditId, {
            actorUid: input.actorUid,
            action: "createSupplier",
            targetType: "supplier",
            targetId: supplierId,
            outcome: "applied",
            summary: `created supplier ${supplierId} v=1${suspectedDuplicateOf.length ? ` suspectedDuplicateOf=[${suspectedDuplicateOf.join(",")}]` : ""} fp=${fp}`,
        });
        if (failAfterStage)
            throw failAfterStage;
        return { outcome: "applied", version: partMasterRepository_js_1.INITIAL_VERSION, supplierId, suspectedDuplicateOf };
    });
}
async function updateSupplier(input, deps) {
    (0, catalogWriterState_js_1.assertFirestoreCatalogWriterOpen)("supplier.update");
    const { db, roles, now, failAfterStage } = (0, partMasterCommands_js_1.__pm_internal_resolveDeps)(deps);
    (0, partMasterCommands_js_1.__pm_internal_assertActorUid)(input.actorUid);
    (0, partMasterCommands_js_1.__pm_internal_assertIdempotencyKey)(input.idempotencyKey);
    assertSupplierId(input.supplierId);
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < partMasterRepository_js_1.INITIAL_VERSION) {
        throw new partMasterCommands_js_1.InvalidInputError("expectedVersion must be a positive integer");
    }
    const changes = input.changes ?? {};
    const changeKeys = Object.keys(changes);
    if (changeKeys.length === 0)
        throw new partMasterCommands_js_1.InvalidInputError("changes must not be empty");
    for (const k of changeKeys) {
        if (!UPDATABLE_FIELDS.has(k))
            throw new partMasterCommands_js_1.InvalidInputError(`field "${k}" is not updatable`);
    }
    if (Object.prototype.hasOwnProperty.call(changes, "name") && !(0, operationalMovementValidation_js_1.isNonEmptyString)(changes.name)) {
        throw new partMasterCommands_js_1.InvalidInputError("name must be a non-blank string");
    }
    assertOptionalFields(changes);
    await (0, partMasterCommands_js_1.__pm_internal_requireCapabilityOrAudit)(db, roles, input.actorUid, partMasterCommands_js_1.CAP_CATALOG_MANAGE, "updateSupplier", "supplier", input.supplierId);
    const repo = (0, supplierMasterRepository_js_1.buildFirestoreSupplierRepository)(db);
    const fp = (0, partMasterCommands_js_1.__pm_internal_fingerprint)(["updateSupplier", input.supplierId, input.expectedVersion, changes]);
    const auditId = (0, partMasterCommands_js_1.__pm_internal_auditDocId)("updateSupplier", input.actorUid, input.supplierId, input.idempotencyKey);
    return db.runTransaction(async (txn) => {
        const replay = await (0, partMasterCommands_js_1.__pm_internal_checkIdempotency)(db, txn, auditId, fp);
        if (replay)
            return replay;
        const existing = await repo.getById(txn, input.supplierId);
        if (existing === null)
            throw new partMasterCommands_js_1.NotFoundError(`supplier ${input.supplierId} not found`);
        if (existing.version !== input.expectedVersion) {
            throw new partMasterCommands_js_1.VersionConflictError(`expectedVersion ${input.expectedVersion}, stored ${existing.version}`);
        }
        const newName = Object.prototype.hasOwnProperty.call(changes, "name") ? changes.name : existing.name;
        const normalizedKey = (0, supplierMasterValidation_js_1.normalizeSupplierName)(newName);
        if (normalizedKey === "")
            throw new partMasterCommands_js_1.InvalidInputError("name has no usable content after normalization");
        const newVersion = existing.version + 1;
        const merged = {
            ...existing,
            ...changes,
            name: newName,
            normalizedKey,
            status: existing.status, // status changes go through activate/deactivate only
            version: newVersion,
            createdAt: existing.createdAt,
            createdBy: existing.createdBy,
            updatedAt: firestore_1.Timestamp.fromDate(now()),
            updatedBy: input.actorUid,
        };
        repo.stageUpdate(txn, merged);
        (0, auditEventWriter_js_1.stageAuditEventWithId)(txn, auditId, {
            actorUid: input.actorUid,
            action: "updateSupplier",
            targetType: "supplier",
            targetId: input.supplierId,
            outcome: "applied",
            summary: `updated supplier ${input.supplierId} fields=[${changeKeys.sort().join(",")}] v=${newVersion} fp=${fp}`,
        });
        if (failAfterStage)
            throw failAfterStage;
        return { outcome: "applied", version: newVersion };
    });
}
// Shared status transition (activate: INACTIVE->ACTIVE; deactivate: ACTIVE->INACTIVE). Same-status
// is an invalid transition (never a silent no-op). Never physically deletes.
async function changeSupplierStatus(input, targetStatus, action, deps) {
    (0, catalogWriterState_js_1.assertFirestoreCatalogWriterOpen)(action === "activateSupplier" ? "supplier.activate" : "supplier.deactivate");
    const { db, roles, now, failAfterStage } = (0, partMasterCommands_js_1.__pm_internal_resolveDeps)(deps);
    (0, partMasterCommands_js_1.__pm_internal_assertActorUid)(input.actorUid);
    (0, partMasterCommands_js_1.__pm_internal_assertIdempotencyKey)(input.idempotencyKey);
    assertSupplierId(input.supplierId);
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < partMasterRepository_js_1.INITIAL_VERSION) {
        throw new partMasterCommands_js_1.InvalidInputError("expectedVersion must be a positive integer");
    }
    await (0, partMasterCommands_js_1.__pm_internal_requireCapabilityOrAudit)(db, roles, input.actorUid, partMasterCommands_js_1.CAP_CATALOG_ACTIVATE, action, "supplier", input.supplierId);
    const repo = (0, supplierMasterRepository_js_1.buildFirestoreSupplierRepository)(db);
    const fp = (0, partMasterCommands_js_1.__pm_internal_fingerprint)([action, input.supplierId, input.expectedVersion, targetStatus]);
    const auditId = (0, partMasterCommands_js_1.__pm_internal_auditDocId)(action, input.actorUid, input.supplierId, input.idempotencyKey);
    return db.runTransaction(async (txn) => {
        const replay = await (0, partMasterCommands_js_1.__pm_internal_checkIdempotency)(db, txn, auditId, fp);
        if (replay)
            return replay;
        const existing = await repo.getById(txn, input.supplierId);
        if (existing === null)
            throw new partMasterCommands_js_1.NotFoundError(`supplier ${input.supplierId} not found`);
        if (existing.version !== input.expectedVersion) {
            throw new partMasterCommands_js_1.VersionConflictError(`expectedVersion ${input.expectedVersion}, stored ${existing.version}`);
        }
        if (existing.status === targetStatus) {
            throw new partMasterCommands_js_1.InvalidStatusTransitionError(`supplier ${input.supplierId} is already ${targetStatus}`);
        }
        const newVersion = existing.version + 1;
        repo.stageUpdate(txn, {
            ...existing,
            status: targetStatus,
            version: newVersion,
            updatedAt: firestore_1.Timestamp.fromDate(now()),
            updatedBy: input.actorUid,
        });
        (0, auditEventWriter_js_1.stageAuditEventWithId)(txn, auditId, {
            actorUid: input.actorUid,
            action,
            targetType: "supplier",
            targetId: input.supplierId,
            outcome: "applied",
            summary: `${action === "activateSupplier" ? "activated" : "deactivated"} supplier ${input.supplierId} -> ${targetStatus} v=${newVersion} fp=${fp}`,
        });
        if (failAfterStage)
            throw failAfterStage;
        return { outcome: "applied", version: newVersion };
    });
}
function activateSupplier(input, deps) {
    return changeSupplierStatus(input, "ACTIVE", "activateSupplier", deps);
}
function deactivateSupplier(input, deps) {
    return changeSupplierStatus(input, "INACTIVE", "deactivateSupplier", deps);
}
//# sourceMappingURL=supplierMasterCommands.js.map