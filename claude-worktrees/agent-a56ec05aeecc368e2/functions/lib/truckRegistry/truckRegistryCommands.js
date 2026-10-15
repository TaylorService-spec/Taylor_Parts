"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reassignDriver = exports.assignDriver = void 0;
exports.createTruck = createTruck;
exports.unassignDriver = unassignDriver;
exports.changeStatus = changeStatus;
exports.changeHomeWarehouse = changeHomeWarehouse;
exports.deactivateTruck = deactivateTruck;
exports.reactivateTruck = reactivateTruck;
exports.deleteTruckCreatedInError = deleteTruckCreatedInError;
// EI Truck Registry -- trusted internal write service (ADR-010 / Decision #60). INTERNAL
// trusted service only: nothing here is exported from functions/src/index.ts, there is no
// callable/HTTP surface, and "export is not deployment" applies throughout. A future callable
// (separate gate) is the ONLY thing that derives actorUid from request.auth.uid; these
// commands receive a TRUSTED actorUid.
//
// Every mutation: trusted actorUid -> admin/dispatcher security-role check (users/{uid}.role,
// NOT an Enterprise Access capability -- no capabilities are introduced) -> pure input
// validation -> ONE db.runTransaction covering the idempotency check + all reads + version CAS
// + mutation + an atomically-staged Audit Event (the partMasterCommands pattern). Denials emit
// a standalone "denied" Audit Event. Idempotency uses the house mechanism: a DETERMINISTIC
// auditEvents doc id is the "already applied" source of truth; a request fingerprint embedded
// in its summary rejects same-key-different-request replays.
//
// Invariants honored: the business record is NOT custody authority; driver assignment writes
// ONLY the driver field (never claim/location/ledger -> inventory custody provably unchanged);
// truck.locationId is IMMUTABLE (no relink op); inventory moves only via the ledger/Transfers
// (not here); deactivation is fail-closed when governed inventory presence is UNKNOWN.
const node_crypto_1 = require("node:crypto");
const firestore_1 = require("firebase-admin/firestore");
const auditEventWriter_1 = require("../access/auditEventWriter");
const truckRegistryRepository_1 = require("./truckRegistryRepository");
const validation_1 = require("./validation");
const types_1 = require("./types");
const UNKNOWN_INVENTORY = async () => "UNKNOWN";
const UNKNOWN_REFERENCES = async () => "UNKNOWN";
function resolveDeps(deps) {
    const db = deps?.db ?? (0, firestore_1.getFirestore)();
    return {
        db,
        repo: deps?.repo ?? (0, truckRegistryRepository_1.buildFirestoreTruckRegistryRepository)(db),
        probe: deps?.hasGovernedInventoryAtLocation ?? UNKNOWN_INVENTORY,
        referenceProbe: deps?.hasOperationalReferences ?? UNKNOWN_REFERENCES,
        now: deps?.now ?? (() => new Date()),
        failAfterStage: deps?.__simulateFailureAfterStage,
        afterAuthReadHook: deps?.__afterAuthReadHook,
    };
}
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,200}$/;
function assertActorUid(actorUid) {
    if (typeof actorUid !== "string" || actorUid.length === 0)
        throw new types_1.InvalidInputError("actorUid is required");
}
function assertIdempotencyKey(key) {
    if (typeof key !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(key))
        throw new types_1.InvalidInputError("idempotencyKey must match [A-Za-z0-9_-]{8,200}");
}
function assertExpectedVersion(v) {
    if (!Number.isInteger(v) || v < truckRegistryRepository_1.INITIAL_VERSION)
        throw new types_1.InvalidInputError("expectedVersion must be a positive integer");
}
function fingerprint(payload) {
    return (0, node_crypto_1.createHash)("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}
function auditDocId(operation, actorUid, targetId, key) {
    return "tr_" + (0, node_crypto_1.createHash)("sha256").update(`${operation}|${actorUid}|${targetId}|${key}`).digest("hex").slice(0, 40);
}
const FP_TAG = /fp=([0-9a-f]{16})/;
async function checkIdempotency(db, txn, auditId, fp) {
    const snap = await txn.get(db.collection("auditEvents").doc(auditId));
    if (!snap.exists)
        return null;
    const summary = String((snap.data() ?? {}).summary ?? "");
    const stored = FP_TAG.exec(summary)?.[1];
    if (stored !== fp)
        throw new types_1.IdempotencyConflictError("idempotencyKey was already used for a different request");
    const v = /v=(\d+)/.exec(summary);
    return { outcome: "replayed", version: v ? Number(v[1]) : truckRegistryRepository_1.INITIAL_VERSION };
}
// admin/dispatcher security-role authorization (mirrors firestore.rules isAdminOrDispatcher();
// NOT an Enterprise Access capability). Denials emit a standalone "denied" audit event.
async function requireAdminOrDispatcherOrAudit(db, actorUid, action, targetType, targetId) {
    const snap = await db.collection("users").doc(actorUid).get();
    const role = snap.exists ? snap.data()?.role : undefined;
    if (role === "admin" || role === "dispatcher")
        return;
    await (0, auditEventWriter_1.recordStandaloneAuditEvent)({ actorUid, action, targetType, targetId, outcome: "denied", summary: `denied: actor is not admin/dispatcher for ${action}` });
    throw new types_1.UnauthorizedActorError(`actor is not authorized for ${action}`);
}
// Deletion reason: required, trimmed, bounded, and restricted to a safe printable charset that
// DELIBERATELY excludes "=" so the reason can never inject an "fp=" / "v=" tag into the audit
// summary the idempotency parser reads (checkIdempotency). Also excludes the "]" delimiter used
// around it in the summary.
const DELETION_REASON_PATTERN = /^[A-Za-z0-9 .,:;()'#/_-]{1,200}$/;
function assertDeletionReason(reason) {
    const r = typeof reason === "string" ? reason.trim() : "";
    if (r.length === 0 || !DELETION_REASON_PATTERN.test(r)) {
        throw new types_1.InvalidInputError("deletionReason is required (1-200 chars, letters/digits/spaces/.,:;()'#/_- only)");
    }
}
async function createTruck(input, deps) {
    const { db, repo, now, failAfterStage } = resolveDeps(deps);
    assertActorUid(input.actorUid);
    assertIdempotencyKey(input.idempotencyKey);
    const validated = (0, validation_1.validateCreateInput)(input);
    if (!validated.valid)
        throw new types_1.InvalidInputError(`invalid create input: ${validated.errors.map((e) => `${e.path}:${e.code}`).join(",")}`);
    const { location, truck } = validated.value;
    await requireAdminOrDispatcherOrAudit(db, input.actorUid, "createTruck", "truck", truck.truckId);
    const fp = fingerprint(["createTruck", truck, location]);
    const auditId = auditDocId("createTruck", input.actorUid, truck.truckId, input.idempotencyKey);
    return db.runTransaction(async (txn) => {
        const replay = await checkIdempotency(db, txn, auditId, fp);
        if (replay)
            return replay;
        // All reads first.
        if (await repo.getTruck(txn, truck.truckId))
            throw new types_1.TruckAlreadyExistsError(`truck ${truck.truckId} already exists`);
        if (await repo.getClaim(txn, location.locationId))
            throw new types_1.LocationClaimedError(`location ${location.locationId} is already claimed`);
        if (await repo.getLocation(txn, location.locationId))
            throw new types_1.LocationClaimedError(`location ${location.locationId} already exists`);
        if (!(await repo.isWarehouseActive(txn, truck.homeWarehouseId)))
            throw new types_1.WarehouseInvalidError("home warehouse is missing or inactive");
        if (truck.assignedDriverEmployeeId !== null && !(await repo.isEmployeeActive(txn, truck.assignedDriverEmployeeId))) {
            throw new types_1.EmployeeInvalidError("assigned driver is missing or not active");
        }
        const at = now();
        const meta = { version: truckRegistryRepository_1.INITIAL_VERSION, createdAt: at, createdBy: input.actorUid, updatedAt: at, updatedBy: input.actorUid };
        repo.stageCreateLocation(txn, { location, active: true, ...meta });
        repo.stageCreateTruck(txn, { truck, active: true, ...meta });
        repo.stageCreateClaim(txn, { locationId: location.locationId, truckId: truck.truckId, version: truckRegistryRepository_1.INITIAL_VERSION, createdAt: at, createdBy: input.actorUid });
        (0, auditEventWriter_1.stageAuditEventWithId)(txn, auditId, {
            actorUid: input.actorUid, action: "createTruck", targetType: "truck", targetId: truck.truckId, outcome: "applied",
            summary: `created truck ${truck.truckId} at location ${location.locationId} v=${truckRegistryRepository_1.INITIAL_VERSION} fp=${fp}`,
        });
        if (failAfterStage)
            throw failAfterStage;
        return { outcome: "applied", version: truckRegistryRepository_1.INITIAL_VERSION };
    });
}
async function mutateTruck(args, deps) {
    const { db, repo, now, failAfterStage } = resolveDeps(deps);
    assertActorUid(args.actorUid);
    assertIdempotencyKey(args.idempotencyKey);
    const tid = (0, validation_1.parseTruckId)(args.truckId);
    if (!tid.valid)
        throw new types_1.InvalidInputError("invalid truckId");
    assertExpectedVersion(args.expectedVersion);
    await requireAdminOrDispatcherOrAudit(db, args.actorUid, args.action, "truck", tid.value);
    const fp = fingerprint([args.operation, tid.value, args.expectedVersion, args.fpPayload]);
    const auditId = auditDocId(args.operation, args.actorUid, tid.value, args.idempotencyKey);
    return db.runTransaction(async (txn) => {
        const replay = await checkIdempotency(db, txn, auditId, fp);
        if (replay)
            return replay;
        const current = await repo.getTruck(txn, tid.value);
        if (current === null)
            throw new types_1.TruckNotFoundError(`truck ${tid.value} not found`);
        if (current.version !== args.expectedVersion)
            throw new types_1.VersionConflictError(`expectedVersion ${args.expectedVersion}, stored ${current.version}`);
        const result = await args.apply(current, txn, repo); // may perform more txn reads (before writes)
        const at = now();
        const nextVersion = current.version + 1;
        repo.stageUpdateTruck(txn, {
            truck: result.nextTruck, active: result.nextActive,
            version: nextVersion, createdAt: current.createdAt, createdBy: current.createdBy, updatedAt: at, updatedBy: args.actorUid,
        });
        if (result.alsoLocation) {
            const loc = result.alsoLocation.location;
            repo.stageUpdateLocation(txn, {
                location: loc.location, active: result.alsoLocation.nextActive,
                version: loc.version + 1, createdAt: loc.createdAt, createdBy: loc.createdBy, updatedAt: at, updatedBy: args.actorUid,
            });
        }
        (0, auditEventWriter_1.stageAuditEventWithId)(txn, auditId, {
            actorUid: args.actorUid, action: args.action, targetType: "truck", targetId: tid.value, outcome: "applied",
            summary: args.summary(nextVersion, fp),
        });
        if (failAfterStage)
            throw failAfterStage;
        return { outcome: "applied", version: nextVersion };
    });
}
async function setDriver(input, deps) {
    const eid = (0, validation_1.parseEmployeeId)(input.employeeId);
    if (!eid.valid)
        throw new types_1.InvalidInputError("invalid employeeId");
    return mutateTruck({
        actorUid: input.actorUid, idempotencyKey: input.idempotencyKey, truckId: input.truckId, expectedVersion: input.expectedVersion,
        operation: "assignTruckDriver", action: "assignTruckDriver", fpPayload: { employeeId: eid.value },
        apply: async (current, txn, repo) => {
            if (!(await repo.isEmployeeActive(txn, eid.value)))
                throw new types_1.EmployeeInvalidError("employee is missing or not active");
            return { nextTruck: { ...current.truck, assignedDriverEmployeeId: eid.value }, nextActive: current.active };
        },
        summary: (v, fp) => `assigned driver ${eid.value} to truck ${input.truckId} v=${v} fp=${fp}`,
    }, deps);
}
const assignDriver = (input, deps) => setDriver(input, deps);
exports.assignDriver = assignDriver;
const reassignDriver = (input, deps) => setDriver(input, deps);
exports.reassignDriver = reassignDriver;
function unassignDriver(input, deps) {
    return mutateTruck({
        actorUid: input.actorUid, idempotencyKey: input.idempotencyKey, truckId: input.truckId, expectedVersion: input.expectedVersion,
        operation: "unassignTruckDriver", action: "unassignTruckDriver", fpPayload: null,
        apply: async (current) => ({ nextTruck: { ...current.truck, assignedDriverEmployeeId: null }, nextActive: current.active }),
        summary: (v, fp) => `unassigned driver from truck ${input.truckId} v=${v} fp=${fp}`,
    }, deps);
}
async function changeStatus(input, deps) {
    if (!(0, validation_1.isTruckStatus)(input.status))
        throw new types_1.InvalidInputError("invalid status");
    return mutateTruck({
        actorUid: input.actorUid, idempotencyKey: input.idempotencyKey, truckId: input.truckId, expectedVersion: input.expectedVersion,
        operation: "changeTruckStatus", action: "changeTruckStatus", fpPayload: { status: input.status },
        apply: async (current) => {
            if (current.truck.status === input.status)
                throw new types_1.InvalidStatusTransitionError("status is unchanged");
            return { nextTruck: { ...current.truck, status: input.status }, nextActive: current.active };
        },
        summary: (v, fp) => `changed truck ${input.truckId} status to ${input.status} v=${v} fp=${fp}`,
    }, deps);
}
async function changeHomeWarehouse(input, deps) {
    const wid = (0, validation_1.parseWarehouseId)(input.homeWarehouseId);
    if (!wid.valid)
        throw new types_1.InvalidInputError("invalid homeWarehouseId");
    return mutateTruck({
        actorUid: input.actorUid, idempotencyKey: input.idempotencyKey, truckId: input.truckId, expectedVersion: input.expectedVersion,
        operation: "changeTruckHomeWarehouse", action: "changeTruckHomeWarehouse", fpPayload: { homeWarehouseId: wid.value },
        apply: async (current, txn, repo) => {
            if (!(await repo.isWarehouseActive(txn, wid.value)))
                throw new types_1.WarehouseInvalidError("warehouse is missing or inactive");
            return { nextTruck: { ...current.truck, homeWarehouseId: wid.value }, nextActive: current.active };
        },
        summary: (v, fp) => `changed truck ${input.truckId} home warehouse to ${wid.value} v=${v} fp=${fp}`,
    }, deps);
}
function deactivateTruck(input, deps) {
    const { probe } = resolveDeps(deps);
    return mutateTruck({
        actorUid: input.actorUid, idempotencyKey: input.idempotencyKey, truckId: input.truckId, expectedVersion: input.expectedVersion,
        operation: "deactivateTruck", action: "deactivateTruck", fpPayload: null,
        apply: async (current, txn, repo) => {
            const location = await repo.getLocation(txn, current.truck.locationId);
            if (location === null)
                throw new types_1.LocationNotFoundError(`location ${current.truck.locationId} not found`);
            const presence = await probe(current.truck.locationId, txn); // reads through the txn
            if (presence === "PRESENT")
                throw new types_1.InventoryPresentError("governed inventory remains at the location");
            if (presence !== "ABSENT")
                throw new types_1.InventoryStateUnknownError("governed inventory presence is unknown");
            return {
                nextTruck: { ...current.truck, status: types_1.DEACTIVATED_STATUS },
                nextActive: false,
                alsoLocation: { location, nextActive: false },
            };
        },
        summary: (v, fp) => `deactivated truck ${input.truckId} (status ${types_1.DEACTIVATED_STATUS}, location inactive) v=${v} fp=${fp}`,
    }, deps);
}
async function reactivateTruck(input, deps) {
    if (!(0, validation_1.isReactivationStatus)(input.targetStatus))
        throw new types_1.InvalidInputError("targetStatus must be ACTIVE or IDLE");
    return mutateTruck({
        actorUid: input.actorUid, idempotencyKey: input.idempotencyKey, truckId: input.truckId, expectedVersion: input.expectedVersion,
        operation: "reactivateTruck", action: "reactivateTruck", fpPayload: { targetStatus: input.targetStatus },
        apply: async (current, txn, repo) => {
            const location = await repo.getLocation(txn, current.truck.locationId);
            if (location === null)
                throw new types_1.LocationNotFoundError(`location ${current.truck.locationId} not found`);
            const claim = await repo.getClaim(txn, current.truck.locationId);
            if (claim === null || claim.truckId !== current.truck.truckId)
                throw new types_1.ClaimIntegrityError("location_truck_claim is missing or mismatched");
            return {
                nextTruck: { ...current.truck, status: input.targetStatus },
                nextActive: true,
                alsoLocation: { location, nextActive: true },
            };
        },
        summary: (v, fp) => `reactivated truck ${input.truckId} (status ${input.targetStatus}, location active) v=${v} fp=${fp}`,
    }, deps);
}
async function deleteTruckCreatedInError(input, deps) {
    const { db, repo, referenceProbe, failAfterStage, afterAuthReadHook } = resolveDeps(deps);
    assertActorUid(input.actorUid);
    assertIdempotencyKey(input.idempotencyKey);
    const tid = (0, validation_1.parseTruckId)(input.truckId);
    if (!tid.valid)
        throw new types_1.InvalidInputError("invalid truckId");
    assertExpectedVersion(input.expectedVersion);
    assertDeletionReason(input.deletionReason);
    const reason = input.deletionReason.trim();
    // The reason is part of the request -> in the fingerprint, so a same-key/different-reason retry
    // is rejected as an idempotency conflict.
    const fp = fingerprint(["deleteTruckCreatedInError", tid.value, input.expectedVersion, reason]);
    const auditId = auditDocId("deleteTruckCreatedInError", input.actorUid, tid.value, input.idempotencyKey);
    try {
        return await db.runTransaction(async (txn) => {
            // (0) COMMIT-TIME AUTHORITATIVE admin authorization. Read the actor's CURRENT role THROUGH the
            // transaction, FIRST -- before idempotency/replay, reference checks, and any write. This puts
            // users/{actorUid} in the transaction's read set, so a concurrent role change (revocation)
            // conflicts the commit and Firestore RETRIES; the retried callback re-reads the current role.
            // A former admin therefore can neither delete nor receive/execute an idempotent replay. This
            // in-txn read -- NOT any pre-transaction helper -- is the authoritative gate.
            const actorSnap = await txn.get(db.collection("users").doc(input.actorUid));
            if (!actorSnap.exists || actorSnap.data()?.role !== "admin") {
                throw new types_1.UnauthorizedActorError("actor is not admin for deleteTruckCreatedInError");
            }
            if (afterAuthReadHook)
                await afterAuthReadHook(); // TEST-ONLY: perturb the role mid-transaction
            const replay = await checkIdempotency(db, txn, auditId, fp);
            if (replay)
                return replay; // tombstone exists -> already deleted -> idempotent
            // ----- remaining reads (Firestore transaction rule: all reads before writes) -----
            const truck = await repo.getTruck(txn, tid.value);
            if (truck === null)
                throw new types_1.TruckNotFoundError(`truck ${tid.value} not found`);
            if (truck.version !== input.expectedVersion) {
                throw new types_1.VersionConflictError(`expectedVersion ${input.expectedVersion}, stored ${truck.version}`);
            }
            const locationId = truck.truck.locationId;
            const location = await repo.getLocation(txn, locationId);
            if (location === null)
                throw new types_1.LocationNotFoundError(`location ${locationId} not found`);
            if (location.location.locationId !== locationId)
                throw new types_1.ClaimIntegrityError("truck/location identity is not reciprocal");
            const claim = await repo.getClaim(txn, locationId);
            if (claim === null || claim.truckId !== tid.value || claim.locationId !== locationId) {
                throw new types_1.ClaimIntegrityError("location_truck_claim is missing or does not match the truck+location");
            }
            // Conclusive in-truck assignment check -- a truck with a driver is not an unused error record.
            if (truck.truck.assignedDriverEmployeeId !== null) {
                throw new types_1.TruckReferencedError("truck has an active driver assignment");
            }
            // Cross-collection operational history -- fail closed on UNKNOWN.
            const refs = await referenceProbe({ truckId: tid.value, locationId }, txn);
            if (refs === "REFERENCED")
                throw new types_1.TruckReferencedError("operational history references the truck or its MOBILE location");
            if (refs !== "CLEAR")
                throw new types_1.ReferenceStateUnknownError("operational reference state could not be conclusively determined");
            // ----- atomic delete + immutable tombstone (never partial) -----
            repo.stageDeleteTruck(txn, tid.value);
            repo.stageDeleteLocation(txn, locationId);
            repo.stageDeleteClaim(txn, locationId);
            (0, auditEventWriter_1.stageAuditEventWithId)(txn, auditId, {
                actorUid: input.actorUid, action: "deleteTruckCreatedInError", targetType: "truck", targetId: tid.value, outcome: "applied",
                // reason has no "=" or "]" (assertDeletionReason), so the v=/fp= tags stay unambiguous.
                // Concise (truckId + reason only) to stay under the 500-char audit-summary bound even with
                // max-length ids; the atomic MOBILE-location + claim removal is implied by the action.
                summary: `deleted-in-error truck ${tid.value} reason:[${reason}] v=${truck.version} fp=${fp}`,
            });
            if (failAfterStage)
                throw failAfterStage;
            return { outcome: "applied", version: truck.version };
        });
    }
    catch (err) {
        // Preserve denied auditing WITHOUT it being the authoritative gate: on a commit-time
        // authorization failure (e.g. admin revoked mid-transaction), record a best-effort standalone
        // "denied" audit outside the aborted transaction, then rethrow. Never masks the original error.
        if (err instanceof types_1.UnauthorizedActorError) {
            await (0, auditEventWriter_1.recordStandaloneAuditEvent)({
                actorUid: input.actorUid, action: "deleteTruckCreatedInError", targetType: "truck", targetId: tid.value,
                outcome: "denied", summary: "denied: actor is not admin for deleteTruckCreatedInError",
            }).catch(() => { });
        }
        throw err;
    }
}
//# sourceMappingURL=truckRegistryCommands.js.map