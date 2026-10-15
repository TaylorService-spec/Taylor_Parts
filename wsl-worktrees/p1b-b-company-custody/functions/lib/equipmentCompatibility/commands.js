"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EquipmentAuditValidationError = exports.DENIAL_REASONS = exports.TERMINAL_AUDIT_ACTION = exports.INITIATION_AUDIT_ACTION = exports.EQUIPMENT_AUDIT_ACTIONS = exports.COMMAND_CAPABILITIES = void 0;
exports.stageEquipmentAuditEvent = stageEquipmentAuditEvent;
exports.runEquipmentCompatibilityCommand = runEquipmentCompatibilityCommand;
const commandFingerprint_1 = require("./commandFingerprint");
const compatibility_1 = require("./domain/compatibility");
const errors_1 = require("./errors");
const operations_1 = require("./operations");
const compatibilityRepository_1 = require("./compatibilityRepository");
const equipmentModelRepository_1 = require("./equipmentModelRepository");
const operationRepository_1 = require("./operationRepository");
const repository_1 = require("./repository");
// The governed capability each command requires (design §5). D4 registers these INACTIVE in Stage D;
// the resolver seam below is what decides, so this module never inspects a role or a grant itself.
exports.COMMAND_CAPABILITIES = Object.freeze({
    importEquipmentModel: "equipment.model.manage",
    importEquipmentModelAlias: "equipment.model.manage",
    importCompatibility: "equipment.compatibility.import",
    importCompatibilitySource: "equipment.compatibility.import",
    verifyCompatibility: "equipment.compatibility.verify",
    correctCompatibility: "equipment.compatibility.correct",
});
// Every lifecycle audit action (design §3). The AuditAction REGISTRY entries land in Stage D; the seam
// below must nevertheless represent all of them, so C.2 cannot quietly omit a governed event.
exports.EQUIPMENT_AUDIT_ACTIONS = Object.freeze([
    "initiateEquipmentCompatibilityCommand", // TX1: initiation was durably recorded
    "equipmentCompatibilityCommand", // TX2: the terminal outcome
    "equipmentCompatibilityVerification", // staged with a verificationStatus transition
    "equipmentCompatibilityCorrection", // staged with a governed correction
    "equipmentCompatibilityConflict", // staged when contradicting evidence forces CONFLICT
]);
exports.INITIATION_AUDIT_ACTION = "initiateEquipmentCompatibilityCommand";
exports.TERMINAL_AUDIT_ACTION = "equipmentCompatibilityCommand";
// STABLE SANITIZED DENIAL REASONS. An audit summary is composed only from these codes and the action
// name — never from an exception message, a resolver's text, a client-supplied value, or a raw payload.
// A denial therefore cannot smuggle attacker-controlled text (or a secret) into an append-only record,
// and the reasons stay stable enough to alert on.
exports.DENIAL_REASONS = Object.freeze({
    UNAUTHORIZED: "unauthorized",
    INVALID_INPUT: "invalid_input",
    IDEMPOTENCY_CONFLICT: "idempotency_conflict",
    VERSION_CONFLICT: "version_conflict",
    REFERENTIAL_INTEGRITY: "referential_integrity",
    NOT_FOUND: "not_found",
    ALREADY_EXISTS: "already_exists",
    EVIDENCE_LIMIT_EXCEEDED: "evidence_limit_exceeded",
    INTERNAL_ERROR: "internal_error",
});
const DENIAL_REASON_VALUES = new Set(Object.values(exports.DENIAL_REASONS));
// Mirrors the shared writer's structural guard (auditEventWriter.ts). The real guarantee is that a
// summary is BUILT from an allowlist rather than interpolated, so this is defence in depth against a
// future edit that forgets that.
const SECRET_LIKE_PATTERN = /\b(bearer\s+[a-z0-9._-]{10,}|eyj[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}|sk_[a-z0-9]{16,}|password\s*[:=]\s*\S+)/i;
// Only these actions target a record that carries a governed `version` (D1 model, D2 relationship).
const VERSIONED_ACTIONS = new Set(["importEquipmentModel", "importCompatibility", "correctCompatibility", "verifyCompatibility"]);
const MAX_SUMMARY = 500;
const MAX_ACTOR_UID = 128;
const MAX_TARGET_ID = 1500;
const UNSAFE_TEXT = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const UNKNOWN = "unknown";
class EquipmentAuditValidationError extends Error {
}
exports.EquipmentAuditValidationError = EquipmentAuditValidationError;
// Validate the assembled event before it can be staged. Bounded actor/target/summary, an action from
// the allowlist, a governed outcome, no control characters, no secret-shaped text.
function assertAuditEvent(event) {
    const bounded = (v, max) => typeof v === "string" && v.length > 0 && v.length <= max && !UNSAFE_TEXT.test(v);
    if (!bounded(event.actorUid, MAX_ACTOR_UID))
        throw new EquipmentAuditValidationError("audit actorUid is invalid");
    if (!exports.EQUIPMENT_AUDIT_ACTIONS.includes(event.action)) {
        throw new EquipmentAuditValidationError("audit action is not a governed equipment action");
    }
    if (!bounded(event.targetType, 128))
        throw new EquipmentAuditValidationError("audit targetType is invalid");
    if (!bounded(event.targetId, MAX_TARGET_ID))
        throw new EquipmentAuditValidationError("audit targetId is invalid");
    if (event.outcome !== "applied" && event.outcome !== "denied") {
        throw new EquipmentAuditValidationError("audit outcome must be applied or denied");
    }
    if (!bounded(event.summary, MAX_SUMMARY))
        throw new EquipmentAuditValidationError("audit summary is invalid");
    if (SECRET_LIKE_PATTERN.test(event.summary)) {
        throw new EquipmentAuditValidationError("audit summary appears to contain a secret -- refusing to persist");
    }
    return event;
}
// Summaries are COMPOSED from allowlisted tokens, never interpolated from untrusted input.
const appliedSummary = (action, note) => `${action} applied: ${note}`.slice(0, MAX_SUMMARY);
const deniedSummary = (action, reason) => `${action} denied: ${DENIAL_REASON_VALUES.has(reason) ? reason : exports.DENIAL_REASONS.INTERNAL_ERROR}`;
// Map a typed error to a STABLE reason code. The message itself is never persisted.
function denialReasonFor(error) {
    if (error instanceof errors_1.UnauthorizedActorError)
        return exports.DENIAL_REASONS.UNAUTHORIZED;
    if (error instanceof errors_1.IdempotencyConflictError)
        return exports.DENIAL_REASONS.IDEMPOTENCY_CONFLICT;
    if (error instanceof errors_1.VersionConflictError)
        return exports.DENIAL_REASONS.VERSION_CONFLICT;
    if (error instanceof errors_1.ReferentialIntegrityError)
        return exports.DENIAL_REASONS.REFERENTIAL_INTEGRITY;
    if (error instanceof errors_1.NotFoundError)
        return exports.DENIAL_REASONS.NOT_FOUND;
    if (error instanceof errors_1.AlreadyExistsError)
        return exports.DENIAL_REASONS.ALREADY_EXISTS;
    if (error instanceof errors_1.EvidenceCapExceededError)
        return exports.DENIAL_REASONS.EVIDENCE_LIMIT_EXCEEDED;
    if (error instanceof errors_1.InvalidInputError)
        return exports.DENIAL_REASONS.INVALID_INPUT;
    return exports.DENIAL_REASONS.INTERNAL_ERROR;
}
// An action name is only ever echoed into an audit if it is one of ours.
const safeActionName = (action) => typeof action === "string" && Object.prototype.hasOwnProperty.call(exports.COMMAND_CAPABILITIES, action) ? action : UNKNOWN;
// Exported so the audit safety contract can be exercised directly by tests.
function stageEquipmentAuditEvent(txn, deps, event, at) {
    const validated = assertAuditEvent(event);
    txn.create(deps.newAuditRef(), {
        actorUid: validated.actorUid,
        action: validated.action,
        targetType: validated.targetType,
        targetId: validated.targetId,
        outcome: validated.outcome,
        summary: validated.summary,
        at,
    });
}
// The SPECIALIZED terminal event a command family also emits, staged atomically with its governed
// record transition (§3a). The generic terminal `equipmentCompatibilityCommand` is always written too.
const SPECIALIZED_TERMINAL_AUDIT = Object.freeze({
    verifyCompatibility: "equipmentCompatibilityVerification",
    correctCompatibility: "equipmentCompatibilityCorrection",
});
// ---------------------------------------------------------------------------
// Command envelope snapshot -- the FIRST thing that touches caller input
// ---------------------------------------------------------------------------
// The envelope is read EXACTLY ONCE into a detached, prototype-free object, and every later step
// (including the denial-audit path) uses only that snapshot. Reading the caller's object a second time
// while building its own denial audit is what let a throwing getter escape the governed denial path
// entirely; a hostile input must produce a sanitized denied audit, not an exception from the handler.
const ENVELOPE_FIELDS = new Set(["actorUid", "action", "idempotencyKey", "payload", "expectedVersion"]);
// TOTAL: a hostile Proxy trap or getter that throws is a MALFORMED ENVELOPE, not an internal fault and
// not the caller's exception to propagate. Its message never escapes -- it could carry attacker-chosen
// text into a caller's logs -- so every failure surfaces as the same governed InvalidInputError.
function snapshotCommandEnvelope(input) {
    try {
        return readCommandEnvelope(input);
    }
    catch (error) {
        if (error instanceof errors_1.InvalidInputError)
            throw error;
        throw new errors_1.InvalidInputError("command input could not be read safely");
    }
}
function readCommandEnvelope(input) {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
        throw new errors_1.InvalidInputError("command input must be an object");
    }
    // getPrototypeOf / getOwnPropertyNames / getOwnPropertySymbols can all be trapped by a Proxy; the
    // caller of this function keeps it inside a try, so a throwing trap becomes a governed denial.
    const proto = Object.getPrototypeOf(input);
    if (proto !== Object.prototype && proto !== null)
        throw new errors_1.InvalidInputError("command input must be a plain object");
    if (Object.getOwnPropertySymbols(input).length > 0)
        throw new errors_1.InvalidInputError("command input carries own symbol keys");
    for (const key of Object.getOwnPropertyNames(input)) {
        if (!ENVELOPE_FIELDS.has(key))
            throw new errors_1.InvalidInputError(`unexpected command field ${key}`);
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        // Accessors are refused, never invoked: a getter could return one value to validation and another
        // to execution, and a throwing one must not run at all.
        if (typeof descriptor.get === "function" || typeof descriptor.set === "function") {
            throw new errors_1.InvalidInputError(`command field ${key} must be a plain data property`);
        }
    }
    for (const key of ENVELOPE_FIELDS) {
        if (key in input && !Object.prototype.hasOwnProperty.call(input, key)) {
            throw new errors_1.InvalidInputError(`command field ${key} is inherited, not an own property`);
        }
    }
    const record = input;
    return Object.freeze({
        actorUid: record.actorUid,
        action: record.action,
        idempotencyKey: record.idempotencyKey,
        payload: record.payload,
        expectedVersion: record.expectedVersion,
    });
}
// Bounded, control-free actor or "unknown". Never converts a non-string.
const safeActorUid = (v) => typeof v === "string" && v.length > 0 && v.length <= MAX_ACTOR_UID && !UNSAFE_TEXT.test(v) ? v : UNKNOWN;
// ---------------------------------------------------------------------------
// Pre-acceptance gate
// ---------------------------------------------------------------------------
// Everything that must be settled BEFORE an operation record may exist. A failure here is a terminal
// `denied` audit with NO operation record, per §9.8.
async function acceptForExecution(envelope, deps) {
    const { actorUid, action, idempotencyKey, payload } = envelope;
    if (typeof actorUid !== "string" || actorUid.length === 0 || actorUid.length > 128) {
        throw new errors_1.InvalidInputError("actorUid is required and is server-derived");
    }
    if (typeof action !== "string" || !Object.prototype.hasOwnProperty.call(exports.COMMAND_CAPABILITIES, action)) {
        throw new errors_1.InvalidInputError("unknown command action");
    }
    if (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9_-]{8,200}$/.test(idempotencyKey)) {
        throw new errors_1.InvalidInputError("idempotencyKey is malformed");
    }
    const expectedVersion = (envelope.expectedVersion ?? null);
    if (expectedVersion !== null && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0)) {
        throw new errors_1.InvalidInputError("expectedVersion must be a non-negative integer or null");
    }
    // Aliases and evidence carry NO version by governed contract, so an expectedVersion on them cannot be
    // enforced. Accepting it and silently ignoring it would give a caller a false concurrency guarantee,
    // so it is refused outright rather than dropped.
    if (expectedVersion !== null && !VERSIONED_ACTIONS.has(action)) {
        throw new errors_1.InvalidInputError(`action ${action} targets a non-versioned record; expectedVersion must be null`);
    }
    // PREPARE FIRST -- before the first asynchronous yield.
    //
    // Preparation is pure: it performs no repository read or write and activates no capability, so doing
    // it first costs nothing and closes the last time-of-check window. If the capability were resolved
    // first, the caller could mutate its retained payload or serialSchemes registry while that promise was
    // pending, and the MUTATED command would be the one prepared, fingerprinted and persisted. After this
    // line the submitted command has exactly one governed interpretation and neither the caller's payload
    // nor deps.serialSchemes is ever read again.
    const governedAction = action;
    const targetType = operations_1.ACTION_TARGET_TYPES[governedAction];
    const targetId = commandTargetId(governedAction, payload);
    const prepared = (0, commandFingerprint_1.prepareCommand)({
        action: governedAction, targetType, targetId, payload, serialSchemes: deps.serialSchemes,
    });
    // Capability resolution happens on the ALREADY-SNAPSHOTTED actor and action, and still before any
    // repository read or write. A throwing resolver denies.
    let granted = false;
    try {
        granted = await deps.resolvePermission({ actorUid, capabilityId: exports.COMMAND_CAPABILITIES[governedAction] });
    }
    catch {
        granted = false;
    }
    if (granted !== true) {
        throw new errors_1.UnauthorizedActorError(`actor is not authorized for "${exports.COMMAND_CAPABILITIES[governedAction]}"`);
    }
    return { prepared, expectedVersion, actorUid };
}
// The identity the command is filed under, read from the payload's own governed identity field. The
// fingerprint contract re-derives and re-checks this, so a disagreement cannot survive.
function commandTargetId(action, payload) {
    if (payload === null || typeof payload !== "object")
        throw new errors_1.InvalidInputError("command payload must be an object");
    const p = payload;
    const field = action === "importEquipmentModel" ? "equipmentModelId"
        : action === "importEquipmentModelAlias" ? "aliasKey"
            : action === "importCompatibilitySource" ? "sourceId"
                : "compatibilityId";
    const value = Object.prototype.hasOwnProperty.call(p, field) ? p[field] : undefined;
    if (typeof value !== "string" || value.length === 0) {
        throw new errors_1.InvalidInputError(`command payload is missing its ${field} identity`);
    }
    return value;
}
// ---------------------------------------------------------------------------
// The lifecycle
// ---------------------------------------------------------------------------
async function runEquipmentCompatibilityCommand(input, deps) {
    const { db, now } = deps;
    // The caller's object is touched ONCE, here. Everything after this -- including the denial audit --
    // reads only the detached snapshot, so a hostile getter or Proxy trap cannot fire twice or escape
    // from the handler that is supposed to record its denial.
    let envelope = null;
    let accepted;
    try {
        envelope = snapshotCommandEnvelope(input);
        accepted = await acceptForExecution(envelope, deps);
    }
    catch (error) {
        // Pre-acceptance denial: terminal audit only, NO operation record. If the snapshot itself failed,
        // there is nothing safe to report and every field degrades to "unknown" -- the input is never
        // re-read to find out more.
        const safeAction = envelope === null ? UNKNOWN : safeActionName(envelope.action);
        const targetType = safeAction === UNKNOWN ? UNKNOWN : operations_1.ACTION_TARGET_TYPES[safeAction];
        const actorUid = envelope === null ? UNKNOWN : safeActorUid(envelope.actorUid);
        const at = now();
        await db.runTransaction(async (txn) => {
            stageEquipmentAuditEvent(txn, deps, {
                actorUid, action: exports.TERMINAL_AUDIT_ACTION, targetType, targetId: UNKNOWN, outcome: "denied",
                summary: deniedSummary(safeAction, denialReasonFor(error)),
            }, at);
        });
        throw error;
    }
    const { prepared, expectedVersion, actorUid } = accepted;
    const { action, targetId, fingerprint: commandFingerprint } = prepared;
    const targetType = prepared.targetType;
    const idempotencyKey = envelope.idempotencyKey;
    const operations = (0, operationRepository_1.buildFirestoreOperationRepository)(db);
    // ---- TX1: durable initiation, or an idempotent replay decision ----
    const initiation = await db.runTransaction(async (txn) => {
        const existing = await operations.getByIdempotencyKey(txn, idempotencyKey);
        if (existing !== null) {
            // A reused key MUST carry the same governed command. Every binding field is compared.
            if (existing.actorUid !== actorUid || existing.action !== action || existing.targetType !== targetType ||
                existing.targetId !== targetId || existing.expectedVersion !== expectedVersion ||
                existing.commandFingerprint !== commandFingerprint) {
                throw new errors_1.IdempotencyConflictError(`idempotencyKey ${idempotencyKey} was used for a different command`);
            }
            // Exact replay of a TERMINAL operation: read it, never mutate it.
            if (existing.status !== "initiated")
                return { resume: false, replayed: true, record: existing };
            // Crash after TX1: resume this initiation rather than creating a second one.
            return { resume: true, replayed: true, record: existing };
        }
        const initiatedAt = now();
        const record = {
            idempotencyKey, actorUid, action, targetType, targetId, commandFingerprint,
            expectedVersion, resultVersion: null, status: "initiated", initiatedAt, terminalAt: null,
        };
        operations.stageInitiate(txn, record);
        stageEquipmentAuditEvent(txn, deps, {
            actorUid, action: exports.INITIATION_AUDIT_ACTION, targetType, targetId, outcome: "applied",
            summary: appliedSummary(action, "initiation recorded"),
        }, initiatedAt);
        return { resume: true, replayed: false, record };
    });
    if (!initiation.resume) {
        const terminal = initiation.record;
        return terminal.status === "applied"
            ? { status: "applied", targetId, resultVersion: terminal.resultVersion, replayed: true }
            : { status: "denied", targetId, reason: "previously denied", replayed: true };
    }
    // ---- TX2: mutation + terminal transition + terminal audit, atomically ----
    return db.runTransaction(async (txn) => {
        // ALL READS FIRST — Firestore requires it, and the terminal authorization needs its own read.
        let mutation;
        let denial = null;
        try {
            mutation = await planMutation(txn, { prepared, expectedVersion, actorUid, now }, deps);
        }
        catch (error) {
            if (error instanceof errors_1.VersionConflictError || error instanceof errors_1.ReferentialIntegrityError ||
                error instanceof errors_1.NotFoundError || error instanceof errors_1.AlreadyExistsError ||
                error instanceof errors_1.EvidenceCapExceededError) {
                // A governed denial: a terminal `denied` outcome, recorded as a STABLE CODE. The underlying
                // message is never persisted -- it is returned to the caller only.
                denial = denialReasonFor(error);
            }
            else {
                throw error;
            }
        }
        const terminalAt = now();
        const terminalRecord = {
            ...initiation.record,
            status: denial === null ? "applied" : "denied",
            resultVersion: denial === null ? mutation.resultVersion : null,
            terminalAt,
        };
        const authorization = await operations.prepareTerminal(txn, terminalRecord);
        // WRITES second.
        if (denial === null)
            mutation.stage(txn);
        operations.stageTerminal(txn, authorization);
        const outcome = denial === null ? "applied" : "denied";
        stageEquipmentAuditEvent(txn, deps, {
            actorUid, action: exports.TERMINAL_AUDIT_ACTION, targetType, targetId, outcome,
            summary: denial === null ? appliedSummary(action, `version ${mutation.resultVersion}`) : deniedSummary(action, denial),
        }, terminalAt);
        // The specialized lifecycle event for this command family, staged atomically with the same
        // transition (§3a). It is ADDITIONAL to the terminal command event, not a replacement.
        const specialized = SPECIALIZED_TERMINAL_AUDIT[action];
        if (specialized !== undefined) {
            stageEquipmentAuditEvent(txn, deps, {
                actorUid, action: specialized, targetType, targetId, outcome,
                summary: denial === null ? appliedSummary(action, `version ${mutation.resultVersion}`) : deniedSummary(action, denial),
            }, terminalAt);
        }
        // Conflict surfacing carries its own append-only event.
        if (denial === null) {
            for (const extra of mutation.extraAudits ?? []) {
                stageEquipmentAuditEvent(txn, deps, { actorUid, targetType: extra.targetType, targetId: extra.targetId, action: extra.action, outcome: "applied", summary: extra.summary }, terminalAt);
            }
        }
        return denial === null
            ? { status: "applied", targetId, resultVersion: mutation.resultVersion, replayed: initiation.replayed }
            : { status: "denied", targetId, reason: denial, replayed: initiation.replayed };
    });
}
async function planMutation(txn, cmd, deps) {
    const { db } = deps;
    // The DETACHED registry captured during acceptance, never deps.serialSchemes, which the caller may
    // have mutated since.
    const serialSchemes = cmd.prepared.serialSchemes;
    const models = (0, equipmentModelRepository_1.buildFirestoreEquipmentModelRepository)(db);
    const aliases = (0, equipmentModelRepository_1.buildFirestoreEquipmentModelAliasRepository)(db);
    const compatibility = (0, compatibilityRepository_1.buildFirestoreCompatibilityRepository)(db, { serialSchemes });
    const sources = (0, compatibilityRepository_1.buildFirestoreCompatibilitySourceRepository)(db);
    // The prepared, deep-frozen governed value -- the exact thing that was fingerprinted.
    const payload = cmd.prepared.value;
    const stamp = cmd.now();
    // Expected-version check against the record's OWN version (D2/D1), inside this transaction.
    const checkVersion = (existingVersion) => {
        if (cmd.expectedVersion === null) {
            if (existingVersion !== null) {
                throw new errors_1.VersionConflictError(`record already exists at version ${existingVersion}; expectedVersion is required`);
            }
            return;
        }
        if (existingVersion === null)
            throw new errors_1.NotFoundError(`no existing record to update at version ${cmd.expectedVersion}`);
        if (existingVersion !== cmd.expectedVersion) {
            throw new errors_1.VersionConflictError(`expected version ${cmd.expectedVersion}, found ${existingVersion}`);
        }
    };
    const meta = (existing) => ({
        createdAt: existing?.createdAt ?? stamp,
        createdBy: existing?.createdBy ?? cmd.actorUid,
        updatedAt: stamp,
        updatedBy: cmd.actorUid,
    });
    switch (cmd.prepared.action) {
        case "importEquipmentModel": {
            const existing = await models.getById(txn, cmd.prepared.targetId);
            checkVersion(existing?.model.version ?? null);
            const stored = { model: payload, ...meta(existing) };
            return {
                resultVersion: payload.version,
                stage: (t) => (existing === null ? models.stageCreate(t, stored) : models.stageUpdate(t, stored)),
            };
        }
        case "importEquipmentModelAlias": {
            // REFERENTIAL INTEGRITY: an alias may never create or imply a model.
            const model = await models.getById(txn, String(payload.equipmentModelId));
            if (model === null)
                throw new errors_1.ReferentialIntegrityError(`equipment model ${String(payload.equipmentModelId)} does not exist`);
            const existing = await aliases.getByAliasKey(txn, cmd.prepared.targetId);
            // Aliases carry no version; a conflicting owner fails closed for review (D1 conflict contract).
            if (existing !== null && existing.alias.equipmentModelId !== payload.equipmentModelId) {
                throw new errors_1.ReferentialIntegrityError(`alias ${cmd.prepared.targetId} already resolves to ${existing.alias.equipmentModelId}`);
            }
            const stored = { alias: payload, ...meta(existing) };
            return {
                resultVersion: 1,
                stage: (t) => (existing === null ? aliases.stageCreate(t, stored) : aliases.stageUpdate(t, stored)),
            };
        }
        case "importCompatibility":
        case "correctCompatibility": {
            const model = await models.getById(txn, String(payload.equipmentModelId));
            if (model === null)
                throw new errors_1.ReferentialIntegrityError(`equipment model ${String(payload.equipmentModelId)} does not exist`);
            const existing = await compatibility.getById(txn, cmd.prepared.targetId);
            checkVersion(existing?.compatibility.version ?? null);
            if (cmd.prepared.action === "correctCompatibility" && existing === null) {
                throw new errors_1.NotFoundError(`compatibility ${cmd.prepared.targetId} does not exist to correct`);
            }
            const stored = { compatibility: payload, ...meta(existing) };
            return {
                resultVersion: payload.version,
                stage: (t) => (existing === null ? compatibility.stageCreate(t, stored) : compatibility.stageUpdate(t, stored)),
            };
        }
        case "importCompatibilitySource": {
            // Evidence may never create the relationship it cites.
            const relationship = await compatibility.getById(txn, String(payload.compatibilityId));
            if (relationship === null) {
                throw new errors_1.ReferentialIntegrityError(`compatibility ${String(payload.compatibilityId)} does not exist`);
            }
            const existing = await sources.getById(txn, cmd.prepared.targetId);
            if (existing !== null)
                throw new errors_1.AlreadyExistsError(`source ${cmd.prepared.targetId} already exists and evidence is immutable`);
            const stored = { source: payload, ...meta(null) };
            // CONFLICT SURFACING (design §8/§9), delegated to the GOVERNED D2 analyzer.
            //
            // Conflict is a property of the COMPLETE evidence set -- supporting AND contradicting -- not of
            // the incoming record. Judging it from `observedClaim === "CONTRADICTS"` alone is wrong in both
            // directions: the first and only CONTRADICTS is merely CONTRADICTED, not a conflict, and a
            // SUPPORTS arriving after an existing CONTRADICTS IS one. The relationship's own VERIFIED status
            // is not a CompatibilitySource and cannot stand in for supporting evidence.
            //
            // So the full evidence set is read in THIS transaction, the proposed record is included, and
            // analyzeCompatibilityEvidence decides. The outcome is therefore independent of insertion order.
            const existingEvidence = await sources.listByCompatibilityId(txn, String(payload.compatibilityId));
            const evidenceSet = [...existingEvidence.map((e) => e.source), payload];
            const analysis = (0, compatibility_1.analyzeCompatibilityEvidence)(evidenceSet, { expectedCompatibilityId: String(payload.compatibilityId) });
            // Fail closed: the repository already validated every stored record, so anything the analyzer
            // still calls invalid means the evidence set cannot be trusted to decide a conflict.
            if (analysis.invalid.length > 0) {
                throw new errors_1.ReferentialIntegrityError(`evidence set for ${String(payload.compatibilityId)} contains ${analysis.invalid.length} unusable record(s)`);
            }
            const current = relationship.compatibility.verificationStatus;
            // Already CONFLICT: the evidence is recorded, but there is no transition to repeat and no second
            // conflict event to emit.
            if (!analysis.hasConflict || current === "CONFLICT") {
                return { resultVersion: 1, stage: (t) => sources.stageCreate(t, stored) };
            }
            const conflicted = { ...relationship.compatibility, verificationStatus: "CONFLICT", version: relationship.compatibility.version + 1 };
            const conflictedStored = { compatibility: conflicted, ...meta(relationship) };
            return {
                resultVersion: 1,
                stage: (t) => { sources.stageCreate(t, stored); compatibility.stageUpdate(t, conflictedStored); },
                extraAudits: [{
                        action: "equipmentCompatibilityConflict",
                        targetType: "equipment_part_compatibility",
                        targetId: relationship.compatibility.compatibilityId,
                        summary: appliedSummary("importCompatibilitySource", "governed evidence analysis surfaced CONFLICT"),
                    }],
            };
        }
        case "verifyCompatibility": {
            const existing = await compatibility.getById(txn, cmd.prepared.targetId);
            if (existing === null)
                throw new errors_1.NotFoundError(`compatibility ${cmd.prepared.targetId} does not exist to verify`);
            checkVersion(existing.compatibility.version);
            const nextVersion = existing.compatibility.version + 1;
            const updated = { ...existing.compatibility, verificationStatus: payload.verificationStatus, version: nextVersion };
            const stored = { compatibility: updated, ...meta(existing) };
            return { resultVersion: nextVersion, stage: (t) => compatibility.stageUpdate(t, stored) };
        }
        default:
            throw new repository_1.MalformedStoredRecordError(`no mutation plan for ${String(cmd.prepared.action)}`);
    }
}
//# sourceMappingURL=commands.js.map