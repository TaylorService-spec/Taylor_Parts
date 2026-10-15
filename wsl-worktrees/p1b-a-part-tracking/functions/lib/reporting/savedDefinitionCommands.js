"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_NAME_LENGTH = exports.REPORT_DEFINITIONS_COLLECTION = exports.NotOwnerError = exports.NotFoundError = exports.UnauthorizedActorError = exports.InvalidInputError = exports.InvalidReportDefinitionError = void 0;
exports.createSavedDefinition = createSavedDefinition;
exports.getSavedDefinition = getSavedDefinition;
exports.listSavedDefinitions = listSavedDefinitions;
exports.renameSavedDefinition = renameSavedDefinition;
exports.duplicateSavedDefinition = duplicateSavedDefinition;
exports.deleteSavedDefinition = deleteSavedDefinition;
// Issue #325 / ADR-007 D-RULES, CORRECTED (docs/specifications/governed-
// object-based-report-creator.md sec8/sec9) -- the trusted saved-
// definition CRUD service. Server-side ONLY. This is now the ONLY path
// to the `reportDefinitions` collection: firestore.rules denies ALL
// direct client read/write on it unconditionally (see the collection's
// match block), because Rules cannot (a) check a REAL, live
// RoleAssignment/accessVersion the way resolveEffectivePermission() can,
// (b) atomically pair a mutation with an immutable Audit Event, or (c)
// invoke reportQueryValidation.ts's structural validator before
// persisting.
//
// Authorization is a Role-level gate only: report.definition.{create,
// read,rename,duplicate,delete} (permissionCatalog.ts) answer "may this
// principal use this action on THEIR OWN definitions at all," resolved
// against the caller's REAL RoleAssignments/accessVersion (Admin SDK
// read, same loadCallerAccessState() pattern as reportExecutionService.ts
// D-FN and access/trustedWriterCommands.ts). Per-record OWNERSHIP (does
// this specific document's ownerUid match the trusted, server-derived
// actorUid) is separate application logic below -- NOT a
// resolveEffectivePermission() Scope/Condition (no new ConditionKind).
//
// A saved definition confers NO report-data access (ADR-007 sec2.6):
// holding report.definition.* capabilities, or owning a saved
// definition, says nothing about which report DATA is readable --
// reportExecutionService.ts (D-FN) always independently re-resolves
// every object/field capability at RUN time. This module never reads or
// writes report row data, only the definition envelope (name/objectId/
// filters/fields/etc as an opaque, validated blob) plus its ownerUid/
// timestamps.
//
// Never trusts client-supplied ownerUid, timestamps, role, or
// accessVersion: ownerUid is always the trusted request.auth.uid the
// callable wrapper resolves (never request.data), timestamps are always
// FieldValue.serverTimestamp(), and every authorization decision is
// made from a fresh Admin-SDK read of roleAssignments/users.accessVersion
// (never a client-claimed value).
//
// Mutations (create/rename/duplicate/delete) atomically write the
// definition document AND an immutable "applied" Audit Event in a
// single db.runTransaction() via auditEventWriter.ts's stageAuditEvent
// -- both commit or neither does. A DENIED mutation attempt (no
// capability, or the caller does not own the target document) still
// emits exactly one standalone "denied" Audit Event (mirrors
// reportExecutionService.ts's object-gate denial and access/
// trustedWriterCommands.ts's own "every authorization-relevant denial
// is audited" convention) -- so the audit trail is complete for both
// outcomes, not only successes. Reads (get/list) are not mutations and
// are not audited (no readReportDefinition AuditAction exists -- Spec
// sec11 scopes Audit Events to changes, runs, exports, sharing,
// scheduling).
//
// Fails closed: a structurally invalid definition is refused before any
// Firestore write and before any Audit Event (mirrors D-FN's own "never
// valid" vs "no longer fully authorized" distinction -- there is no
// reliable objectId to attribute an Audit Event to until the definition
// is proven structurally valid). An unavailable/errored Firestore call
// propagates as a rejected Promise -- this module has no fallback path
// that could ever resolve a denial as a success.
const firestore_1 = require("firebase-admin/firestore");
const compatibilityRoles_1 = require("../access/compatibilityRoles");
const governedBusinessRoles_1 = require("../access/governedBusinessRoles");
const resolveEffectivePermission_1 = require("../access/resolveEffectivePermission");
const environmentCapabilityOverrides_1 = require("../access/environmentCapabilityOverrides");
const compactClaims_1 = require("../access/compactClaims");
const auditEventWriter_1 = require("../access/auditEventWriter");
const reportQueryValidation_1 = require("./reportQueryValidation");
// ---------------------------------------------------------------------
// Error taxonomy -- mirrors reportExecutionService.ts / trustedWriterCommands.ts's
// per-reason class-per-error convention.
// ---------------------------------------------------------------------
class InvalidReportDefinitionError extends Error {
    errors;
    constructor(errors) {
        super(`Invalid report definition: ${errors.join("; ")}`);
        this.errors = errors;
    }
}
exports.InvalidReportDefinitionError = InvalidReportDefinitionError;
class InvalidInputError extends Error {
}
exports.InvalidInputError = InvalidInputError;
class UnauthorizedActorError extends Error {
}
exports.UnauthorizedActorError = UnauthorizedActorError;
class NotFoundError extends Error {
}
exports.NotFoundError = NotFoundError;
class NotOwnerError extends Error {
}
exports.NotOwnerError = NotOwnerError;
exports.REPORT_DEFINITIONS_COLLECTION = "reportDefinitions";
const USERS_COLLECTION = "users";
const ROLE_ASSIGNMENTS_COLLECTION = "roleAssignments";
exports.MAX_NAME_LENGTH = 120;
// Independent-review finding (round 1): the capability gate for rename/
// duplicate/delete used to run AFTER an unconditional Admin-SDK
// existence read of the target document (needed to learn its real
// objectId for the audit event) -- so a caller holding NO
// report.definition.* capability at all could still distinguish
// "this id exists" (denied for lacking the capability) from "this id
// doesn't exist" (NotFoundError) via two different HttpsError codes,
// a cross-principal existence oracle reachable by ANY authenticated
// caller regardless of role. Fixed: the capability gate now runs FIRST,
// before any read of the target document, exactly like getSavedDefinition/
// listSavedDefinitions already did. Since the real objectId isn't yet
// known at that point, a capability denial is audited against this
// fixed, non-catalog sentinel instead -- still a complete, honest audit
// trail (every denial is still recorded exactly once), just without
// depending on a read that must not happen yet.
const UNRESOLVED_OBJECT_ID_SENTINEL = "reportDefinition:unresolved";
// Same rationale as reportExecutionService.ts's allRoles(): report.
// definition.* capabilities are eligible on either a compatibility Role
// or a governed business Role (today: Owner only, governedBusinessRoles.ts).
function allRoles() {
    return { ...compatibilityRoles_1.COMPATIBILITY_ROLES, ...governedBusinessRoles_1.GOVERNED_BUSINESS_ROLES };
}
function readAuthoritativeAccessVersion(data) {
    if (!data)
        return 0;
    if (data.accessVersion === undefined || data.accessVersion === null)
        return 0;
    if (!(0, compactClaims_1.isValidAccessVersionValue)(data.accessVersion))
        return 0; // fail closed: never trust a malformed value upward
    return data.accessVersion;
}
// Resolves the caller's REAL access state ONCE per command call (never
// once per capability, never cached across calls -- no module-level
// state exists in this file).
async function loadCallerAccessState(db, callerUid) {
    const [userSnap, assignmentsSnap] = await Promise.all([
        db.collection(USERS_COLLECTION).doc(callerUid).get(),
        db
            .collection(ROLE_ASSIGNMENTS_COLLECTION)
            .where("principalUid", "==", callerUid)
            .where("status", "==", "active")
            .get(),
    ]);
    const accessVersion = readAuthoritativeAccessVersion(userSnap.data());
    const assignments = assignmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return { accessVersion, assignments };
}
const GLOBAL_TARGET = { scope: { type: "global" }, condition: {} };
async function hasCapability(db, roles, actorUid, capabilityId) {
    const caller = await loadCallerAccessState(db, actorUid);
    return ((0, resolveEffectivePermission_1.resolveEffectivePermission)({
        permissionId: capabilityId,
        assignments: caller.assignments,
        roles,
        currentAccessVersion: caller.accessVersion,
        target: GLOBAL_TARGET,
        // 2C.6C (DECISIONS #167): the report.* family is ENVIRONMENT-ACTIVATED. Without the runtime
        // activation set every saved-definition command would deny in EVERY environment, including
        // the sandbox where Reporting is live, because the catalog registers these active:false.
        // Same source as effectiveAccessFeed.ts and reportExecutionService.ts -- the runtime's own
        // trusted project identity. Production carries no overrides, so this stays fail-closed there.
        activationOverrides: (0, environmentCapabilityOverrides_1.resolveRuntimeCapabilityOverrides)(),
    }).decision === "ALLOW");
}
function assertValidActorUid(actorUid) {
    if (typeof actorUid !== "string" || actorUid.length === 0) {
        throw new InvalidInputError("actorUid is required");
    }
}
function assertValidName(name) {
    if (typeof name !== "string" || name.trim().length === 0) {
        throw new InvalidInputError("name is required");
    }
    if (name.length > exports.MAX_NAME_LENGTH) {
        throw new InvalidInputError(`name exceeds ${exports.MAX_NAME_LENGTH} characters`);
    }
}
// Every mutating command (create/rename/duplicate/delete) audits BOTH
// outcomes -- exactly one "applied" Audit Event (staged atomically with
// the mutation, inside the SAME transaction) or exactly one standalone
// "denied" Audit Event (no accompanying mutation exists to pair with).
// This one helper is the ONLY place either audit path is invoked from,
// so the two outcomes can never drift out of shape with each other.
async function requireMutationCapabilityOrAudit(db, roles, actorUid, capabilityId, action, objectId, targetId, denialSummary) {
    const allowed = await hasCapability(db, roles, actorUid, capabilityId);
    if (allowed)
        return;
    await (0, auditEventWriter_1.recordStandaloneAuditEvent)({
        actorUid,
        action,
        targetType: "reportDefinition",
        targetId,
        objectId,
        outcome: "denied",
        summary: denialSummary,
    });
    throw new UnauthorizedActorError(`actor is not authorized for "${capabilityId}"`);
}
// Single fetch shared by every mutating command (rename/duplicate/
// delete) -- returns the doc's ref/data/objectId, or throws NotFoundError
// (no objectId is knowable for a document that doesn't exist, so no
// report AuditAction can be emitted without one; refused without an
// audit trail entry, same as a structurally invalid definition is).
async function loadDefinitionForMutation(db, definitionId) {
    if (typeof definitionId !== "string" || definitionId.length === 0) {
        throw new InvalidInputError("definitionId is required");
    }
    const ref = db.collection(exports.REPORT_DEFINITIONS_COLLECTION).doc(definitionId);
    const snap = await ref.get();
    if (!snap.exists) {
        throw new NotFoundError(`no saved definition exists at "${definitionId}"`);
    }
    const data = snap.data();
    const objectId = data.definition?.objectId;
    return { ref, data, objectId };
}
// Ownership gate, run AFTER the capability gate (so a caller who lacks
// the capability at all is denied for that reason, never for a
// cross-principal ownership reason that would let a capability-less
// caller distinguish "not mine" from "not allowed"). Audits a denial
// exactly like requireMutationCapabilityOrAudit does.
async function requireOwnershipOrAudit(actorUid, action, definitionId, objectId, data) {
    if (data.ownerUid === actorUid)
        return;
    await (0, auditEventWriter_1.recordStandaloneAuditEvent)({
        actorUid,
        action,
        targetType: "reportDefinition",
        targetId: definitionId,
        objectId,
        outcome: "denied",
        summary: `Denied: actor does not own saved definition "${definitionId}".`,
    });
    // Deliberately the same NotOwnerError regardless of whether the caller
    // could otherwise read this id -- never confirms existence of a
    // cross-principal document beyond what the Audit Event (a trusted-
    // server-only record, never returned to the caller) itself captures.
    throw new NotOwnerError(`actor does not own saved definition "${definitionId}"`);
}
async function createSavedDefinition(params, options = {}) {
    const db = options.db ?? (0, firestore_1.getFirestore)();
    const roles = options.roles ?? allRoles();
    assertValidActorUid(params.actorUid);
    assertValidName(params.name);
    // Structural validation FIRST (mirrors reportExecutionService.ts): a
    // malformed definition is refused before any Firestore read/write and
    // before any Audit Event -- there is no reliable objectId to
    // attribute a denial to until the definition is proven valid.
    const validationErrors = (0, reportQueryValidation_1.validateReportDefinition)(params.definition);
    if (validationErrors.length > 0) {
        throw new InvalidReportDefinitionError(validationErrors);
    }
    const definition = params.definition;
    const objectId = definition.objectId;
    const ref = db.collection(exports.REPORT_DEFINITIONS_COLLECTION).doc();
    await requireMutationCapabilityOrAudit(db, roles, params.actorUid, "report.definition.create", "createReportDefinition", objectId, ref.id, `Denied: actor lacks "report.definition.create" for object "${objectId}".`);
    const record = {
        id: ref.id,
        name: params.name,
        ownerUid: params.actorUid,
        definition,
        createdAt: firestore_1.FieldValue.serverTimestamp(),
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
    };
    await db.runTransaction(async (txn) => {
        txn.set(ref, record);
        (0, auditEventWriter_1.stageAuditEvent)(txn, {
            actorUid: params.actorUid,
            action: "createReportDefinition",
            targetType: "reportDefinition",
            targetId: ref.id,
            objectId,
            outcome: "applied",
            summary: `Saved report definition "${params.name}" created for object "${objectId}".`,
        });
        if (options.__simulateFailureAfterStage) {
            throw options.__simulateFailureAfterStage;
        }
    });
    return record;
}
async function getSavedDefinition(params, options = {}) {
    const db = options.db ?? (0, firestore_1.getFirestore)();
    const roles = options.roles ?? allRoles();
    assertValidActorUid(params.actorUid);
    const allowed = await hasCapability(db, roles, params.actorUid, "report.definition.read");
    if (!allowed) {
        throw new UnauthorizedActorError('actor is not authorized for "report.definition.read"');
    }
    if (typeof params.definitionId !== "string" || params.definitionId.length === 0) {
        throw new InvalidInputError("definitionId is required");
    }
    const ref = db.collection(exports.REPORT_DEFINITIONS_COLLECTION).doc(params.definitionId);
    const snap = await ref.get();
    if (!snap.exists) {
        throw new NotFoundError(`no saved definition exists at "${params.definitionId}"`);
    }
    const data = snap.data();
    if (data.ownerUid !== params.actorUid) {
        throw new NotOwnerError(`actor does not own saved definition "${params.definitionId}"`);
    }
    return data;
}
async function listSavedDefinitions(params, options = {}) {
    const db = options.db ?? (0, firestore_1.getFirestore)();
    const roles = options.roles ?? allRoles();
    assertValidActorUid(params.actorUid);
    const allowed = await hasCapability(db, roles, params.actorUid, "report.definition.read");
    if (!allowed) {
        throw new UnauthorizedActorError('actor is not authorized for "report.definition.read"');
    }
    const snap = await db
        .collection(exports.REPORT_DEFINITIONS_COLLECTION)
        .where("ownerUid", "==", params.actorUid)
        .get();
    return snap.docs.map((d) => d.data());
}
async function renameSavedDefinition(params, options = {}) {
    const db = options.db ?? (0, firestore_1.getFirestore)();
    const roles = options.roles ?? allRoles();
    assertValidActorUid(params.actorUid);
    assertValidName(params.name);
    if (typeof params.definitionId !== "string" || params.definitionId.length === 0) {
        throw new InvalidInputError("definitionId is required");
    }
    // Capability check FIRST, before any read of the target document (see
    // UNRESOLVED_OBJECT_ID_SENTINEL's doc comment -- this ordering is
    // what closes the cross-principal existence oracle).
    await requireMutationCapabilityOrAudit(db, roles, params.actorUid, "report.definition.rename", "renameReportDefinition", UNRESOLVED_OBJECT_ID_SENTINEL, params.definitionId, `Denied: actor lacks "report.definition.rename".`);
    const { ref, data, objectId } = await loadDefinitionForMutation(db, params.definitionId);
    await requireOwnershipOrAudit(params.actorUid, "renameReportDefinition", params.definitionId, objectId, data);
    await db.runTransaction(async (txn) => {
        txn.update(ref, { name: params.name, updatedAt: firestore_1.FieldValue.serverTimestamp() });
        (0, auditEventWriter_1.stageAuditEvent)(txn, {
            actorUid: params.actorUid,
            action: "renameReportDefinition",
            targetType: "reportDefinition",
            targetId: ref.id,
            objectId,
            outcome: "applied",
            summary: `Saved report definition "${ref.id}" renamed to "${params.name}".`,
        });
        if (options.__simulateFailureAfterStage) {
            throw options.__simulateFailureAfterStage;
        }
    });
    return { ...data, name: params.name };
}
async function duplicateSavedDefinition(params, options = {}) {
    const db = options.db ?? (0, firestore_1.getFirestore)();
    const roles = options.roles ?? allRoles();
    assertValidActorUid(params.actorUid);
    if (typeof params.definitionId !== "string" || params.definitionId.length === 0) {
        throw new InvalidInputError("definitionId is required");
    }
    await requireMutationCapabilityOrAudit(db, roles, params.actorUid, "report.definition.duplicate", "duplicateReportDefinition", UNRESOLVED_OBJECT_ID_SENTINEL, params.definitionId, `Denied: actor lacks "report.definition.duplicate".`);
    const { data: source, objectId } = await loadDefinitionForMutation(db, params.definitionId);
    await requireOwnershipOrAudit(params.actorUid, "duplicateReportDefinition", params.definitionId, objectId, source);
    const name = params.name !== undefined ? params.name : `${source.name} (copy)`;
    assertValidName(name);
    const ref = db.collection(exports.REPORT_DEFINITIONS_COLLECTION).doc();
    const record = {
        id: ref.id,
        name,
        ownerUid: params.actorUid,
        definition: source.definition,
        createdAt: firestore_1.FieldValue.serverTimestamp(),
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
    };
    await db.runTransaction(async (txn) => {
        txn.set(ref, record);
        (0, auditEventWriter_1.stageAuditEvent)(txn, {
            actorUid: params.actorUid,
            action: "duplicateReportDefinition",
            targetType: "reportDefinition",
            targetId: ref.id,
            objectId,
            outcome: "applied",
            summary: `Saved report definition "${params.definitionId}" duplicated to "${ref.id}".`,
        });
        if (options.__simulateFailureAfterStage) {
            throw options.__simulateFailureAfterStage;
        }
    });
    return record;
}
async function deleteSavedDefinition(params, options = {}) {
    const db = options.db ?? (0, firestore_1.getFirestore)();
    const roles = options.roles ?? allRoles();
    assertValidActorUid(params.actorUid);
    if (typeof params.definitionId !== "string" || params.definitionId.length === 0) {
        throw new InvalidInputError("definitionId is required");
    }
    await requireMutationCapabilityOrAudit(db, roles, params.actorUid, "report.definition.delete", "deleteReportDefinition", UNRESOLVED_OBJECT_ID_SENTINEL, params.definitionId, `Denied: actor lacks "report.definition.delete".`);
    const { ref, data, objectId } = await loadDefinitionForMutation(db, params.definitionId);
    await requireOwnershipOrAudit(params.actorUid, "deleteReportDefinition", params.definitionId, objectId, data);
    await db.runTransaction(async (txn) => {
        txn.delete(ref);
        (0, auditEventWriter_1.stageAuditEvent)(txn, {
            actorUid: params.actorUid,
            action: "deleteReportDefinition",
            targetType: "reportDefinition",
            targetId: ref.id,
            objectId,
            outcome: "applied",
            summary: `Saved report definition "${ref.id}" deleted.`,
        });
        if (options.__simulateFailureAfterStage) {
            throw options.__simulateFailureAfterStage;
        }
    });
}
//# sourceMappingURL=savedDefinitionCommands.js.map