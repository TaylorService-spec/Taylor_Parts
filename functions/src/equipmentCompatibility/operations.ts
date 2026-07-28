// D4 operation STATE MACHINE for Part–Equipment Compatibility trusted commands.
// A durable, client-closed record keyed by idempotencyKey with STRICTLY validated transitions:
//   absent → initiated → applied | denied
// Deletion, arbitrary updates, terminal-state rewrites, fingerprint/key changes, and any
// applied ↔ denied transition are prohibited. Every persisted operation record is runtime-validated
// (the TS interface is not enough for Firestore data): a malformed operation document fails closed and
// is NEVER treated as absent, replayable, denied, or applied. Exact replay reads the terminal record
// without mutating it. This is NOT an append-only log; it is a one-way terminal state machine.
import { IllegalOperationTransitionError } from "./errors";

export const OPERATION_STATES = ["initiated", "applied", "denied"] as const;
export type OperationState = (typeof OPERATION_STATES)[number];

// The command verbs an operation may carry (the internal command name; the audited terminal action is
// a separate AUDIT_ACTIONS entry). Bounded, explicit allowlist — a foreign action fails closed.
export const OPERATION_ACTIONS = ["importEquipmentModel", "importEquipmentModelAlias", "importCompatibility", "importCompatibilitySource", "verifyCompatibility", "correctCompatibility"] as const;
export type OperationAction = (typeof OPERATION_ACTIONS)[number];

// The four authorities an operation may target (the operation ledger itself is never a target).
export const OPERATION_TARGET_TYPES = ["equipment_models", "equipment_model_aliases", "equipment_part_compatibility", "equipment_compatibility_sources"] as const;
export type OperationTargetType = (typeof OPERATION_TARGET_TYPES)[number];

export const OPERATION_RECORD_FIELDS = new Set(["idempotencyKey", "actorUid", "action", "targetType", "targetId", "commandFingerprint", "expectedVersion", "resultVersion", "status", "initiatedAt", "terminalAt"]);

export interface OperationRecord {
  idempotencyKey: string;
  actorUid: string;
  action: OperationAction;
  targetType: OperationTargetType;
  targetId: string;
  commandFingerprint: string;
  expectedVersion: number | null;
  resultVersion: number | null;
  status: OperationState;
  initiatedAt: unknown; // Firestore Timestamp
  terminalAt: unknown | null;
}

// The immutable command binding fixed at initiation — used for reused-key idempotency comparison.
export interface OperationBinding {
  actorUid: string;
  action: string;
  targetType: string;
  targetId: string;
  expectedVersion: number | null;
  commandFingerprint: string;
}

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,200}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const ALIAS_KEY_PATTERN = /^[A-Z0-9_]+\|[A-Z0-9-]+\|.{1,256}$/;
const MAX_VERSION = Number.MAX_SAFE_INTEGER;

const isBoundedString = (v: any, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const isNonNegInt = (v: any): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= MAX_VERSION;
const isTimestamp = (v: any): boolean => v !== null && typeof v === "object" && typeof v.toMillis === "function" && Number.isFinite(v.toMillis());

// Canonical target-id shape appropriate to the authority.
export function isValidOperationTargetId(targetType: string, targetId: any): boolean {
  if (typeof targetId !== "string" || targetId.length === 0 || targetId.length > 256) return false;
  switch (targetType) {
    case "equipment_models": {
      const parts = targetId.split("--");
      return parts.length === 2 && /^[A-Z0-9]+(-[A-Z0-9]+)*$/.test(parts[0]) && /^[A-Z0-9]+(-[A-Z0-9]+)*$/.test(parts[1]);
    }
    case "equipment_model_aliases": return ALIAS_KEY_PATTERN.test(targetId);
    case "equipment_part_compatibility": return /^cmp_[0-9a-f]{64}$/.test(targetId);
    case "equipment_compatibility_sources": return /^src_[0-9a-f]{64}$/.test(targetId);
    default: return false;
  }
}

// Strict runtime validation of a persisted operation document. Fail-closed with a structured reason;
// a malformed record is NEVER interpretable as absent/replayable/applied/denied by callers.
export function validateOperationRecord(data: any): { valid: boolean; reason: string | null } {
  if (data === null || typeof data !== "object" || Array.isArray(data) || ![Object.prototype, null].includes(Object.getPrototypeOf(data))) return { valid: false, reason: "not_object" };
  const keys = Object.keys(data);
  if (keys.some((k) => !OPERATION_RECORD_FIELDS.has(k))) return { valid: false, reason: "unknown_field" };
  for (const k of OPERATION_RECORD_FIELDS) if (!(k in data)) return { valid: false, reason: `missing_field:${k}` };
  if (!IDEMPOTENCY_KEY_PATTERN.test(data.idempotencyKey)) return { valid: false, reason: "idempotency_key_invalid" };
  if (!isBoundedString(data.actorUid, 128)) return { valid: false, reason: "actor_uid_invalid" };
  if (!(OPERATION_ACTIONS as readonly string[]).includes(data.action)) return { valid: false, reason: "action_invalid" };
  if (!(OPERATION_TARGET_TYPES as readonly string[]).includes(data.targetType)) return { valid: false, reason: "target_type_invalid" };
  if (!isValidOperationTargetId(data.targetType, data.targetId)) return { valid: false, reason: "target_id_invalid" };
  if (typeof data.commandFingerprint !== "string" || !HEX64.test(data.commandFingerprint)) return { valid: false, reason: "command_fingerprint_invalid" };
  if (!(data.expectedVersion === null || isNonNegInt(data.expectedVersion))) return { valid: false, reason: "expected_version_invalid" };
  if (!(OPERATION_STATES as readonly string[]).includes(data.status)) return { valid: false, reason: "status_invalid" };
  if (!isTimestamp(data.initiatedAt)) return { valid: false, reason: "initiated_at_invalid" };
  // status/field invariants (internal consistency).
  if (data.status === "initiated") {
    if (data.resultVersion !== null) return { valid: false, reason: "result_version_must_be_null" };
    if (data.terminalAt !== null) return { valid: false, reason: "terminal_at_must_be_null" };
  } else if (data.status === "denied") {
    if (data.resultVersion !== null) return { valid: false, reason: "result_version_must_be_null" };
    if (!isTimestamp(data.terminalAt)) return { valid: false, reason: "terminal_at_invalid" };
  } else { // applied
    if (!isNonNegInt(data.resultVersion)) return { valid: false, reason: "result_version_invalid" };
    if (!isTimestamp(data.terminalAt)) return { valid: false, reason: "terminal_at_invalid" };
  }
  if (data.terminalAt !== null && isTimestamp(data.terminalAt) && (data.terminalAt as any).toMillis() < (data.initiatedAt as any).toMillis()) return { valid: false, reason: "terminal_before_initiated" };
  return { valid: true, reason: null };
}

export function isAllowedOperationTransition(from: OperationState | null, to: OperationState): boolean {
  if (from === null) return to === "initiated";
  if (from === "initiated") return to === "applied" || to === "denied";
  return false; // applied and denied are terminal: no rewrite, no denied↔applied
}

export function assertOperationTransition(from: OperationState | null, to: OperationState): void {
  if (!isAllowedOperationTransition(from, to)) {
    throw new IllegalOperationTransitionError(`illegal operation transition ${from ?? "absent"} -> ${to}`);
  }
}

const binding = (r: any): OperationBinding => ({ actorUid: r.actorUid, action: r.action, targetType: r.targetType, targetId: r.targetId, expectedVersion: r.expectedVersion, commandFingerprint: r.commandFingerprint });

// Full-record transition guard. Validates BOTH predecessor (if any) and successor records, proves the
// immutable binding is unchanged, and enforces the terminal-field invariants. Throws on any violation.
export function assertOperationRecordTransition(prev: OperationRecord | null, next: OperationRecord): void {
  const nv = validateOperationRecord(next);
  if (!nv.valid) throw new IllegalOperationTransitionError(`invalid successor operation record: ${nv.reason}`);
  if (prev === null) {
    // absent → initiated only, and no terminal fields may be present.
    if (next.status !== "initiated") throw new IllegalOperationTransitionError(`absent must transition to initiated, not ${next.status}`);
    return; // validateOperationRecord already proved resultVersion/terminalAt are null for initiated
  }
  const pv = validateOperationRecord(prev);
  if (!pv.valid) throw new IllegalOperationTransitionError(`malformed predecessor operation record: ${pv.reason}`);
  assertOperationTransition(prev.status, next.status); // rejects terminal predecessors + denied↔applied
  // Immutable binding + identity + initiatedAt must be unchanged.
  const pb = binding(prev), nb = binding(next);
  if (prev.idempotencyKey !== next.idempotencyKey || pb.actorUid !== nb.actorUid || pb.action !== nb.action || pb.targetType !== nb.targetType || pb.targetId !== nb.targetId || pb.expectedVersion !== nb.expectedVersion || pb.commandFingerprint !== nb.commandFingerprint) {
    throw new IllegalOperationTransitionError("immutable operation binding changed across transition");
  }
  if ((prev.initiatedAt as any).toMillis() !== (next.initiatedAt as any).toMillis()) throw new IllegalOperationTransitionError("initiatedAt changed across transition");
  // Successor terminal-field invariants are already enforced by validateOperationRecord(next):
  //   initiated→applied requires a non-negative resultVersion + terminalAt; initiated→denied requires
  //   resultVersion=null + terminalAt; terminalAt >= initiatedAt.
}

// Does a reused idempotencyKey carry the SAME governed command? ALL binding fields — including
// actorUid and expectedVersion — are compared explicitly, and the fingerprint is verified. A reused
// key from a different actor (or different expected version, action, target, or payload) is NOT a match
// and the orchestrator raises IdempotencyConflictError.
export function isSameOperationCommand(existing: OperationBinding, incoming: OperationBinding): boolean {
  return existing.actorUid === incoming.actorUid
    && existing.action === incoming.action
    && existing.targetType === incoming.targetType
    && existing.targetId === incoming.targetId
    && existing.expectedVersion === incoming.expectedVersion
    && existing.commandFingerprint === incoming.commandFingerprint;
}
