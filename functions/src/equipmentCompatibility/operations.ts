// D4 operation STATE MACHINE for Part–Equipment Compatibility trusted commands.
// A durable, client-closed record keyed by idempotencyKey with STRICTLY validated transitions:
//   absent → initiated → applied | denied
// Deletion, arbitrary updates, terminal-state rewrites, fingerprint/key changes, and any
// applied ↔ denied transition are prohibited — enforced by the transition guard below (the only path
// that mutates an operation record) plus client-closed Firestore Rules. Exact replay reads the terminal
// record without mutating it. This is NOT an append-only log; it is a one-way terminal state machine.
import { IllegalOperationTransitionError } from "./errors";

export const OPERATION_STATES = ["initiated", "applied", "denied"] as const;
export type OperationState = (typeof OPERATION_STATES)[number];

// The immutable identity/command binding of an operation, fixed at initiation and never changed.
export interface OperationRecord {
  idempotencyKey: string;
  actorUid: string;
  action: string;            // the terminal command action (e.g. "importCompatibility")
  targetType: string;        // one of the four authorities
  targetId: string;          // opaque id (canonical model id / cmp_… / src_…)
  commandFingerprint: string; // sha256 over (action, normalized value, expectedVersion)
  expectedVersion: number | null;
  resultVersion: number | null; // set only on the terminal `applied` transition
  status: OperationState;
  initiatedAt: unknown;      // Firestore Timestamp
  terminalAt: unknown | null;
}

// True only for the three legal transitions; `from === null` means the record is absent.
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

// Does a reused idempotencyKey carry the SAME command? A mismatch is a fail-closed conflict, never a
// silent overwrite (the command orchestrator throws IdempotencyConflictError on false).
export function isSameOperationCommand(existing: Pick<OperationRecord, "action" | "targetType" | "targetId" | "commandFingerprint">, incoming: Pick<OperationRecord, "action" | "targetType" | "targetId" | "commandFingerprint">): boolean {
  return existing.action === incoming.action
    && existing.targetType === incoming.targetType
    && existing.targetId === incoming.targetId
    && existing.commandFingerprint === incoming.commandFingerprint;
}
