// Enterprise Access & Administration Platform (Issue #226) -- the
// immutable Audit Event trusted writer + read model. Fixed by docs/
// specifications/enterprise-access-and-administration-platform.md
// sec5.8/sec14 and sequenced by docs/implementation-plans/enterprise-
// access-and-administration-platform.md (Row 5 / Task 10).
//
// Server-side ONLY -- this module is not mirrored to field-ops-app-vite
// (unlike the pure-logic access/ modules): clients never call it
// directly. firestore.rules already denies ALL client read/write on
// auditEvents (Implementation Plan Row 3, merged) -- the only path to
// this collection is this trusted-writer module, called INTERNALLY by
// Row 7's future trusted-writer commands (grantRole/revokeRole/
// setUserStatus/approveAccessRequest/rejectAccessRequest). Nothing
// calls this module yet (Row 7 + the commands themselves are #15-gated,
// ADR-005 sec2.6/Spec sec17) -- exporting it is not itself a deployment
// or activation action.
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import type { Query } from "firebase-admin/firestore";
import type { AuditAction, AuditOutcome, Scope } from "../types/access";

const AUDIT_EVENTS_COLLECTION = "auditEvents";
const MAX_SUMMARY_LENGTH = 500;

// Defense-in-depth (Spec sec5.8/sec14: an Audit Event must "never
// contain secrets, tokens, raw credentials, full permission graphs, or
// PII beyond the minimal targetId"). The real guarantee is structural
// -- RecordAuditEventInput has no field shaped to carry a secret -- this
// pattern guard catches an obviously-wrong `summary` string before it
// is ever persisted. Not exhaustive; a human-readable summary should
// never need to look like this in the first place.
const SECRET_LIKE_PATTERN =
  /\b(bearer\s+[a-z0-9._-]{10,}|eyj[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}|sk_[a-z0-9]{16,}|password\s*[:=]\s*\S+)/i;

export class AuditEventValidationError extends Error {}

export interface RecordAuditEventInput {
  actorUid: string;
  action: AuditAction;
  targetType: string;
  targetId: string;
  outcome: AuditOutcome;
  summary: string;
  scope?: Scope;
  approverUid?: string;
  accessVersionAfter?: number;
}

function assertValid(input: RecordAuditEventInput): void {
  if (!input || typeof input !== "object") {
    throw new AuditEventValidationError("input must be an object");
  }
  if (!input.actorUid || typeof input.actorUid !== "string") {
    throw new AuditEventValidationError("actorUid is required");
  }
  if (!input.action || typeof input.action !== "string") {
    throw new AuditEventValidationError("action is required");
  }
  if (!input.targetType || typeof input.targetType !== "string") {
    throw new AuditEventValidationError("targetType is required");
  }
  if (!input.targetId || typeof input.targetId !== "string") {
    throw new AuditEventValidationError("targetId is required");
  }
  if (input.outcome !== "applied" && input.outcome !== "denied") {
    throw new AuditEventValidationError('outcome must be "applied" or "denied"');
  }
  if (!input.summary || typeof input.summary !== "string") {
    throw new AuditEventValidationError("summary is required");
  }
  if (input.summary.length > MAX_SUMMARY_LENGTH) {
    throw new AuditEventValidationError(`summary exceeds ${MAX_SUMMARY_LENGTH} characters`);
  }
  if (SECRET_LIKE_PATTERN.test(input.summary)) {
    throw new AuditEventValidationError(
      "summary appears to contain a secret/token/credential -- refusing to persist",
    );
  }
}

// Append-only (Spec sec14): this module exposes no update/delete
// function for auditEvents, by design -- there is no code path in this
// repo, trusted or otherwise, that mutates an existing Audit Event.
export async function recordAuditEvent(input: RecordAuditEventInput): Promise<string> {
  assertValid(input);
  const db = getFirestore();
  const docRef = db.collection(AUDIT_EVENTS_COLLECTION).doc();
  const doc: Record<string, unknown> = {
    at: FieldValue.serverTimestamp(),
    actorUid: input.actorUid,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    outcome: input.outcome,
    summary: input.summary,
  };
  if (input.scope !== undefined) doc.scope = input.scope;
  if (input.approverUid !== undefined) doc.approverUid = input.approverUid;
  if (input.accessVersionAfter !== undefined) doc.accessVersionAfter = input.accessVersionAfter;
  await docRef.set(doc);
  return docRef.id;
}

export interface ListAuditEventsOptions {
  limit?: number;
  targetType?: string;
  targetId?: string;
}

// Read model (Spec sec16: "read-only immutable audit history" in the
// Admin Portal MVP). Server-side (Admin SDK) only -- there is no
// client Rules read path for auditEvents (Row 3 denies it); an
// Admin-only trusted read endpoint is a later, separately-authorized
// row (Row 11), gated the same way as every other Admin Portal surface.
export async function listRecentAuditEvents(
  options: ListAuditEventsOptions = {},
): Promise<Array<Record<string, unknown>>> {
  const db = getFirestore();
  let query: Query = db.collection(AUDIT_EVENTS_COLLECTION).orderBy("at", "desc");
  if (options.targetType) query = query.where("targetType", "==", options.targetType);
  if (options.targetId) query = query.where("targetId", "==", options.targetId);
  const snapshot = await query.limit(options.limit ?? 50).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}
