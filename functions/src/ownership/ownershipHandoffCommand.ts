// EOS Ownership Model v1 — the OWNERSHIP HANDOFF command (Owner ruling D-5, 2026-08-30).
//
// "Every ownership change is an explicit, auditable handoff." This module is that explicitness:
// a pure builder that turns a handoff request into a validated Audit Event input, refusing
// everything the ruling forbids before anything is written.
//
// INERT. Deliberately, and in two separate ways:
//
//   1. It is NOT exported from functions/src/index.ts, so no callable reaches it. Ownership writes
//      continue through the existing governed paths (ruling D-1) until the write authority is
//      activated at the census/backfill gate.
//   2. It STAGES an audit event onto a caller-supplied transaction or batch, exactly as every
//      other governed command does -- it does not commit. There is no code path in this repo that
//      calls it, which is the point: the authority exists and is testable before it is live.
//
// WHAT IT REFUSES, and why each refusal is here rather than left to a caller:
//
//   - an unknown record family                 -> the matrix is the allow-list, not a hint
//   - an IMMUTABLE family                       -> historical ownership remains historical
//   - an owner whose type contradicts the family -> a person cannot own `parts`, a company cannot
//                                                  own an Opportunity
//   - a no-op handoff                           -> enforced in the audit writer, restated here so
//                                                  the caller gets the error before staging
//   - a cascade                                 -> see buildOwnershipHandoff's contract below
//
// NO CASCADE. The command takes ONE record and produces ONE event. There is no list input and no
// "and its children" flag, because ruling D-1's "existing ownership never changes implicitly" and
// the ruling's "do not cascade ownership changes" are the same requirement seen from two sides.
// Handing off an Account leaves its Opportunities exactly where they were -- moving them is a
// separate, separately-audited decision, made one record at a time.

import { isTypedOwner, type TypedOwner } from "./typedOwner";
import { ownershipFamily } from "./ownershipMatrix";
import {
  OWNERSHIP_HANDOFF_SOURCES,
  stageAuditEvent,
  type AuditEventWriter,
  type OwnershipHandoffSource,
  type RecordAuditEventInput,
} from "../access/auditEventWriter";

export class OwnershipHandoffError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "OwnershipHandoffError";
  }
}

export interface OwnershipHandoffInput {
  /** A family key from the ownership matrix -- e.g. "account", "opportunity", "equipment". */
  family: string;
  /** The id of the single record being handed off. */
  recordId: string;
  /** The owner the record has right now. `null` when it genuinely had none -- never a placeholder. */
  previousOwner: TypedOwner | null;
  /** The owner it is moving to. */
  newOwner: TypedOwner;
  /** Which authority this handoff came from. */
  source: OwnershipHandoffSource;
  /** Optional free text. Held to the same length and secret guards as `summary`. */
  reason?: string;
}

export interface OwnershipHandoffContext {
  actorUid: string;
}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/**
 * Validate a handoff and produce the Audit Event input for it. Pure: no Firestore, no I/O, no
 * clock. The event is the whole output because in v1 the event IS the record of the change --
 * there is no owner field to write to yet on most families, and the ones that have storage keep
 * writing through their existing governed paths.
 */
export function buildOwnershipHandoff(
  input: OwnershipHandoffInput,
  ctx: OwnershipHandoffContext,
): RecordAuditEventInput {
  if (!input || typeof input !== "object") {
    throw new OwnershipHandoffError("INVALID", "Missing input");
  }
  if (!nonEmpty(ctx?.actorUid)) {
    throw new OwnershipHandoffError("ACTOR_REQUIRED", "actorUid is required");
  }

  const family = ownershipFamily(input.family);
  if (family === null) {
    throw new OwnershipHandoffError(
      "FAMILY_UNKNOWN",
      `"${String(input.family)}" is not a governed ownership family`,
    );
  }
  // Ruling D-8: a REFERENCE or EXCLUDED family has no owner, so there is nothing to hand off. This
  // is a DIFFERENT refusal from FAMILY_IMMUTABLE -- that one has an owner it may not move, this one
  // has no owner at all, and collapsing them would tell a caller the wrong thing about the domain.
  if (family.ownerClass !== "PERSON" && family.ownerClass !== "COMPANY") {
    throw new OwnershipHandoffError(
      "FAMILY_NOT_OWNABLE",
      `${family.family} is ${family.ownerClass} -- it has no owner to hand off`,
    );
  }
  if (family.transfer === "IMMUTABLE") {
    throw new OwnershipHandoffError(
      "FAMILY_IMMUTABLE",
      `${family.family} ownership is historical and cannot be handed off`,
    );
  }
  if (!nonEmpty(input.recordId)) {
    throw new OwnershipHandoffError("RECORD_REQUIRED", "recordId is required");
  }

  if (!isTypedOwner(input.newOwner)) {
    throw new OwnershipHandoffError("NEW_OWNER_INVALID", "newOwner must be a typed owner");
  }
  if (input.newOwner.type !== family.ownerType) {
    throw new OwnershipHandoffError(
      "OWNER_TYPE_MISMATCH",
      `${family.family} takes a ${family.ownerType} owner, not ${input.newOwner.type}`,
    );
  }

  // undefined is a caller that forgot. null is a caller stating a fact. They must not be conflated.
  if (input.previousOwner === undefined) {
    throw new OwnershipHandoffError(
      "PREVIOUS_OWNER_REQUIRED",
      "previousOwner is required (use null when the record had no owner)",
    );
  }
  if (input.previousOwner !== null) {
    if (!isTypedOwner(input.previousOwner)) {
      throw new OwnershipHandoffError("PREVIOUS_OWNER_INVALID", "previousOwner must be a typed owner or null");
    }
    if (input.previousOwner.type !== family.ownerType) {
      throw new OwnershipHandoffError(
        "OWNER_TYPE_MISMATCH",
        `${family.family} takes a ${family.ownerType} owner, not ${input.previousOwner.type}`,
      );
    }
    if (input.previousOwner.id === input.newOwner.id) {
      throw new OwnershipHandoffError(
        "NO_OP",
        "previousOwner and newOwner are identical -- a handoff that moves nothing is not an event",
      );
    }
  }

  if (!OWNERSHIP_HANDOFF_SOURCES.includes(input.source)) {
    throw new OwnershipHandoffError(
      "SOURCE_INVALID",
      `source must be one of: ${OWNERSHIP_HANDOFF_SOURCES.join(", ")}`,
    );
  }
  if (input.reason !== undefined && !nonEmpty(input.reason)) {
    throw new OwnershipHandoffError("REASON_INVALID", "reason must be a non-empty string when present");
  }

  const recordId = input.recordId.trim();
  // The summary names the family and the two owner ids and stops. Display names are not authority
  // (the standing invariant) and a resolved name snapshotted here would be a second, staler copy
  // of something the Employee/company authority already owns.
  const from = input.previousOwner === null ? "(none)" : `${input.previousOwner.type}:${input.previousOwner.id}`;
  const to = `${input.newOwner.type}:${input.newOwner.id}`;

  return {
    actorUid: ctx.actorUid,
    action: "OWNERSHIP_HANDOFF",
    targetType: family.family,
    targetId: recordId,
    objectId: recordId,
    outcome: "applied",
    summary: `Ownership of ${family.family} ${recordId} handed off from ${from} to ${to}`,
    previousOwner: input.previousOwner,
    newOwner: input.newOwner,
    handoffSource: input.source,
    ...(input.reason === undefined ? {} : { handoffReason: input.reason.trim() }),
  };
}

/**
 * Stage the handoff event onto a caller-supplied transaction or batch, so it commits WITH whatever
 * business mutation the caller is also staging -- never independently. Returns the event id.
 *
 * Nothing calls this yet. When the write authority is activated, the caller stages its owner-field
 * write onto the same writer, and the record and its audit event become one atomic commit.
 */
export function stageOwnershipHandoff(
  writer: AuditEventWriter,
  input: OwnershipHandoffInput,
  ctx: OwnershipHandoffContext,
): string {
  return stageAuditEvent(writer, buildOwnershipHandoff(input, ctx));
}
