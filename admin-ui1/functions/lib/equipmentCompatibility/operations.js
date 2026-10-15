"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TIMESTAMP_MAX_SECONDS = exports.TIMESTAMP_MIN_SECONDS = exports.compareTimestamps = exports.readTimestamp = exports.OPERATION_RECORD_FIELDS = exports.ACTION_TARGET_TYPES = exports.OPERATION_TARGET_TYPES = exports.OPERATION_ACTIONS = exports.OPERATION_STATES = void 0;
exports.isAllowedActionTarget = isAllowedActionTarget;
exports.isValidOperationTargetId = isValidOperationTargetId;
exports.validateOperationRecord = validateOperationRecord;
exports.isAllowedOperationTransition = isAllowedOperationTransition;
exports.assertOperationTransition = assertOperationTransition;
exports.assertOperationRecordTransition = assertOperationRecordTransition;
exports.isSameOperationCommand = isSameOperationCommand;
// D4 operation STATE MACHINE for Part–Equipment Compatibility trusted commands.
// A durable, client-closed record keyed by idempotencyKey with STRICTLY validated transitions:
//   absent → initiated → applied | denied
// Deletion, arbitrary updates, terminal-state rewrites, fingerprint/key changes, and any
// applied ↔ denied transition are prohibited. Every persisted operation record is runtime-validated
// (the TS interface is not enough for Firestore data): a malformed operation document fails closed and
// is NEVER treated as absent, replayable, denied, or applied. Exact replay reads the terminal record
// without mutating it. This is NOT an append-only log; it is a one-way terminal state machine.
// Target identity is NEVER re-stated here: every target-ID shape is decided by the authoritative D1/D2
// contracts (server mirrors of the merged client domain modules), so operations.ts cannot drift into a
// third interpretation of what a canonical Equipment Model / alias key / compatibility / source ID is.
const errors_1 = require("./errors");
const equipmentModel_1 = require("./domain/equipmentModel");
const compatibility_1 = require("./domain/compatibility");
exports.OPERATION_STATES = ["initiated", "applied", "denied"];
// The command verbs an operation may carry (the internal command name; the audited terminal action is
// a separate AUDIT_ACTIONS entry). Bounded, explicit allowlist — a foreign action fails closed.
exports.OPERATION_ACTIONS = ["importEquipmentModel", "importEquipmentModelAlias", "importCompatibility", "importCompatibilitySource", "verifyCompatibility", "correctCompatibility"];
// The four authorities an operation may target (the operation ledger itself is never a target).
exports.OPERATION_TARGET_TYPES = ["equipment_models", "equipment_model_aliases", "equipment_part_compatibility", "equipment_compatibility_sources"];
// The ONE authority an action is allowed to write. A structurally valid action and a structurally valid
// targetType are NOT sufficient: the pair must appear here. Frozen so the coherence rule cannot be
// mutated at runtime, and each action maps to exactly one authority (no action writes two collections).
exports.ACTION_TARGET_TYPES = Object.freeze({
    importEquipmentModel: "equipment_models",
    importEquipmentModelAlias: "equipment_model_aliases",
    importCompatibility: "equipment_part_compatibility",
    importCompatibilitySource: "equipment_compatibility_sources",
    verifyCompatibility: "equipment_part_compatibility",
    correctCompatibility: "equipment_part_compatibility",
});
// Is this action authorized to target this authority? Own-property lookup only — an inherited key
// (constructor, __proto__, toString) can never resolve to an authorized pair.
function isAllowedActionTarget(action, targetType) {
    if (typeof action !== "string" || typeof targetType !== "string")
        return false;
    if (!Object.prototype.hasOwnProperty.call(exports.ACTION_TARGET_TYPES, action))
        return false;
    return exports.ACTION_TARGET_TYPES[action] === targetType;
}
exports.OPERATION_RECORD_FIELDS = new Set(["idempotencyKey", "actorUid", "action", "targetType", "targetId", "commandFingerprint", "expectedVersion", "resultVersion", "status", "initiatedAt", "terminalAt"]);
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,200}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const MAX_VERSION = Number.MAX_SAFE_INTEGER;
const isBoundedString = (v, max) => typeof v === "string" && v.length > 0 && v.length <= max;
const isNonNegInt = (v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= MAX_VERSION;
// The governed Timestamp contract lives in timestamps.ts so the repository envelope shares EXACTLY
// this interpretation. Re-exported here because the operation state machine is its primary consumer.
var timestamps_1 = require("./timestamps");
Object.defineProperty(exports, "readTimestamp", { enumerable: true, get: function () { return timestamps_1.readTimestamp; } });
Object.defineProperty(exports, "compareTimestamps", { enumerable: true, get: function () { return timestamps_1.compareTimestamps; } });
Object.defineProperty(exports, "TIMESTAMP_MIN_SECONDS", { enumerable: true, get: function () { return timestamps_1.TIMESTAMP_MIN_SECONDS; } });
Object.defineProperty(exports, "TIMESTAMP_MAX_SECONDS", { enumerable: true, get: function () { return timestamps_1.TIMESTAMP_MAX_SECONDS; } });
const timestamps_2 = require("./timestamps");
const isTimestamp = (v) => (0, timestamps_2.readTimestamp)(v) !== null;
// Canonical target-id shape appropriate to the authority — DELEGATED to the D1/D2 contracts. The alias
// key in particular is validated by D1's canonical-alias-key predicate (round-trip agreement, no control
// characters, NFKC-stable, canonical manufacturer), not by a permissive local pattern.
function isValidOperationTargetId(targetType, targetId) {
    switch (targetType) {
        case "equipment_models": return (0, equipmentModel_1.isCanonicalEquipmentModelId)(targetId);
        case "equipment_model_aliases": return (0, equipmentModel_1.isCanonicalModelAliasKey)(targetId);
        case "equipment_part_compatibility": return (0, compatibility_1.isCanonicalCompatibilityId)(targetId);
        case "equipment_compatibility_sources": return (0, compatibility_1.isCanonicalCompatibilitySourceId)(targetId);
        default: return false;
    }
}
// Strict runtime validation of a persisted operation document. Fail-closed with a structured reason;
// a malformed record is NEVER interpretable as absent/replayable/applied/denied by callers. TOTAL: it
// always RETURNS a structured result and never throws, even for adversarial data whose property getters
// or Timestamp methods throw (an escaping exception would otherwise bypass the caller's fail-closed
// branch entirely). Any unexpected throw is itself an invalid record.
function validateOperationRecord(data) {
    try {
        return validateOperationRecordUnsafe(data);
    }
    catch {
        return { valid: false, reason: "validation_error" };
    }
}
function validateOperationRecordUnsafe(data) {
    if (data === null || typeof data !== "object" || Array.isArray(data) || ![Object.prototype, null].includes(Object.getPrototypeOf(data)))
        return { valid: false, reason: "not_object" };
    const keys = Object.keys(data);
    if (keys.some((k) => !exports.OPERATION_RECORD_FIELDS.has(k)))
        return { valid: false, reason: "unknown_field" };
    // OWN properties only. `k in data` would let a polluted Object.prototype.actorUid satisfy a governed
    // field that the record does not actually carry, so an inherited field can never complete the schema.
    for (const k of exports.OPERATION_RECORD_FIELDS)
        if (!Object.prototype.hasOwnProperty.call(data, k))
            return { valid: false, reason: `missing_field:${k}` };
    if (!IDEMPOTENCY_KEY_PATTERN.test(data.idempotencyKey))
        return { valid: false, reason: "idempotency_key_invalid" };
    if (!isBoundedString(data.actorUid, 128))
        return { valid: false, reason: "actor_uid_invalid" };
    if (!exports.OPERATION_ACTIONS.includes(data.action))
        return { valid: false, reason: "action_invalid" };
    if (!exports.OPERATION_TARGET_TYPES.includes(data.targetType))
        return { valid: false, reason: "target_type_invalid" };
    // Action↔target coherence: both halves valid individually is not enough — the PAIR must be authorized.
    if (!isAllowedActionTarget(data.action, data.targetType))
        return { valid: false, reason: "action_target_mismatch" };
    if (!isValidOperationTargetId(data.targetType, data.targetId))
        return { valid: false, reason: "target_id_invalid" };
    if (typeof data.commandFingerprint !== "string" || !HEX64.test(data.commandFingerprint))
        return { valid: false, reason: "command_fingerprint_invalid" };
    if (!(data.expectedVersion === null || isNonNegInt(data.expectedVersion)))
        return { valid: false, reason: "expected_version_invalid" };
    if (!exports.OPERATION_STATES.includes(data.status))
        return { valid: false, reason: "status_invalid" };
    // Each timestamp is read and validated EXACTLY ONCE, and the validated tuple is reused for the
    // ordering check below — a record is never re-read, so no value can differ between inspections.
    const initiatedAt = (0, timestamps_2.readTimestamp)(data.initiatedAt);
    if (initiatedAt === null)
        return { valid: false, reason: "initiated_at_invalid" };
    const terminalAt = (0, timestamps_2.readTimestamp)(data.terminalAt);
    // status/field invariants (internal consistency).
    if (data.status === "initiated") {
        if (data.resultVersion !== null)
            return { valid: false, reason: "result_version_must_be_null" };
        if (data.terminalAt !== null)
            return { valid: false, reason: "terminal_at_must_be_null" };
    }
    else if (data.status === "denied") {
        if (data.resultVersion !== null)
            return { valid: false, reason: "result_version_must_be_null" };
        if (terminalAt === null)
            return { valid: false, reason: "terminal_at_invalid" };
    }
    else { // applied
        if (!isNonNegInt(data.resultVersion))
            return { valid: false, reason: "result_version_invalid" };
        if (terminalAt === null)
            return { valid: false, reason: "terminal_at_invalid" };
    }
    if (terminalAt !== null && (0, timestamps_2.compareTimestamps)(terminalAt, initiatedAt) < 0)
        return { valid: false, reason: "terminal_before_initiated" };
    return { valid: true, reason: null };
}
function isAllowedOperationTransition(from, to) {
    if (from === null)
        return to === "initiated";
    if (from === "initiated")
        return to === "applied" || to === "denied";
    return false; // applied and denied are terminal: no rewrite, no denied↔applied
}
function assertOperationTransition(from, to) {
    if (!isAllowedOperationTransition(from, to)) {
        throw new errors_1.IllegalOperationTransitionError(`illegal operation transition ${from ?? "absent"} -> ${to}`);
    }
}
const binding = (r) => ({ actorUid: r.actorUid, action: r.action, targetType: r.targetType, targetId: r.targetId, expectedVersion: r.expectedVersion, commandFingerprint: r.commandFingerprint });
// Full-record transition guard. Validates BOTH predecessor (if any) and successor records, proves the
// immutable binding is unchanged, and enforces the terminal-field invariants. Throws on any violation.
function assertOperationRecordTransition(prev, next) {
    const nv = validateOperationRecord(next);
    if (!nv.valid)
        throw new errors_1.IllegalOperationTransitionError(`invalid successor operation record: ${nv.reason}`);
    if (prev === null) {
        // absent → initiated only, and no terminal fields may be present.
        if (next.status !== "initiated")
            throw new errors_1.IllegalOperationTransitionError(`absent must transition to initiated, not ${next.status}`);
        return; // validateOperationRecord already proved resultVersion/terminalAt are null for initiated
    }
    const pv = validateOperationRecord(prev);
    if (!pv.valid)
        throw new errors_1.IllegalOperationTransitionError(`malformed predecessor operation record: ${pv.reason}`);
    assertOperationTransition(prev.status, next.status); // rejects terminal predecessors + denied↔applied
    // Immutable binding + identity + initiatedAt must be unchanged.
    const pb = binding(prev), nb = binding(next);
    if (prev.idempotencyKey !== next.idempotencyKey || pb.actorUid !== nb.actorUid || pb.action !== nb.action || pb.targetType !== nb.targetType || pb.targetId !== nb.targetId || pb.expectedVersion !== nb.expectedVersion || pb.commandFingerprint !== nb.commandFingerprint) {
        throw new errors_1.IllegalOperationTransitionError("immutable operation binding changed across transition");
    }
    // Both records are already validated, so both initiatedAt values read cleanly. Compared as EXACT
    // (seconds, nanoseconds) tuples — a one-nanosecond rewrite of initiatedAt is a binding change.
    const prevInitiated = (0, timestamps_2.readTimestamp)(prev.initiatedAt), nextInitiated = (0, timestamps_2.readTimestamp)(next.initiatedAt);
    if (prevInitiated === null || nextInitiated === null || (0, timestamps_2.compareTimestamps)(prevInitiated, nextInitiated) !== 0) {
        throw new errors_1.IllegalOperationTransitionError("initiatedAt changed across transition");
    }
    // Successor terminal-field invariants are already enforced by validateOperationRecord(next):
    //   initiated→applied requires a non-negative resultVersion + terminalAt; initiated→denied requires
    //   resultVersion=null + terminalAt; terminalAt >= initiatedAt.
}
// Does a reused idempotencyKey carry the SAME governed command? ALL binding fields — including
// actorUid and expectedVersion — are compared explicitly, and the fingerprint is verified. A reused
// key from a different actor (or different expected version, action, target, or payload) is NOT a match
// and the orchestrator raises IdempotencyConflictError.
function isSameOperationCommand(existing, incoming) {
    return existing.actorUid === incoming.actorUid
        && existing.action === incoming.action
        && existing.targetType === incoming.targetType
        && existing.targetId === incoming.targetId
        && existing.expectedVersion === incoming.expectedVersion
        && existing.commandFingerprint === incoming.commandFingerprint;
}
//# sourceMappingURL=operations.js.map