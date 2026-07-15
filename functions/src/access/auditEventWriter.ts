// Enterprise Access & Administration Platform (Issue #226) -- the
// immutable Audit Event trusted writer + read model. Fixed by docs/
// specifications/enterprise-access-and-administration-platform.md
// sec5.8/sec14 and sequenced by docs/implementation-plans/enterprise-
// access-and-administration-platform.md (Row 5 / Task 10).
//
// Server-side ONLY -- this module is not mirrored to field-ops-app-vite
// (unlike the pure-logic access/ modules): clients never call it
// directly. firestore.rules already denies ALL client read/write on
// auditEvents (Implementation Plan Row 3, merged PR #276) -- the only
// path to this collection is this trusted-writer module, called
// INTERNALLY by Row 7's future trusted-writer commands
// (grantRole/revokeRole/setUserStatus/approveAccessRequest/
// rejectAccessRequest). Nothing calls this module yet (Row 7 + the
// commands themselves are #15-gated, ADR-005 sec2.6/Spec sec17) --
// exporting it is not itself a deployment or activation action.
//
// ATOMICITY (corrected per Customer review round 2): the governing
// Implementation Plan requires each applied access mutation and its
// Audit Event to commit atomically -- an audit-only entry with no
// accompanying business mutation is the exception, not the rule. This
// module therefore exposes `stageAuditEvent(writer, input)` as its
// PRIMARY entry point: it stages exactly one Audit Event write onto a
// caller-supplied Transaction or WriteBatch that ALSO carries the
// business mutation's own writes, so a single `.commit()` (batch) or
// transaction-callback return (transaction) commits both or neither.
// `recordStandaloneAuditEvent` is a thin convenience wrapper for the
// audit-only case (e.g. a denied-access record with no state change) --
// it still goes through the identical validation + document-shape path,
// just via a batch of one.
import {
  getFirestore,
  FieldValue,
  type DocumentReference,
  type DocumentData,
} from "firebase-admin/firestore";
import type { AuditAction, AuditOutcome, Scope, ScopeType } from "../types/access";

const AUDIT_EVENTS_COLLECTION = "auditEvents";
const MAX_SUMMARY_LENGTH = 500;
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

// Runtime mirror of the AuditAction union (types/access.ts) -- TypeScript
// unions have no runtime representation, so the allowed-values check
// (Customer review round 2 requirement) needs its own explicit list.
// Kept in the same file as the writer that enforces it, immediately
// next to the type it mirrors, to minimize drift risk.
const AUDIT_ACTIONS: readonly AuditAction[] = [
  "grantRole",
  "revokeRole",
  "assignApprovedRole",
  "setUserStatus",
  "approveAccessRequest",
  "rejectAccessRequest",
  "breakGlassRestore",
];

const SCOPE_TYPES: readonly ScopeType[] = [
  "global",
  "tenant",
  "domain",
  "location",
  "ownAssignment",
];

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertValidScope(scope: unknown): asserts scope is Scope {
  if (!isPlainObject(scope)) {
    throw new AuditEventValidationError("scope must be an object");
  }
  if (typeof scope.type !== "string" || !SCOPE_TYPES.includes(scope.type as ScopeType)) {
    throw new AuditEventValidationError(`scope.type must be one of: ${SCOPE_TYPES.join(", ")}`);
  }
  if (scope.value !== undefined && typeof scope.value !== "string") {
    throw new AuditEventValidationError("scope.value must be a string when present");
  }
}

// The complete Audit Event contract (Spec sec5.8), validated at
// runtime -- every required field, the full AuditAction allow-list
// (not merely "is a string"), and the optional Scope/approverUid/
// accessVersionAfter fields when present.
function assertValid(input: RecordAuditEventInput): void {
  if (!isPlainObject(input)) {
    throw new AuditEventValidationError("input must be an object");
  }
  if (!input.actorUid || typeof input.actorUid !== "string") {
    throw new AuditEventValidationError("actorUid is required");
  }
  if (typeof input.action !== "string" || !AUDIT_ACTIONS.includes(input.action as AuditAction)) {
    throw new AuditEventValidationError(`action must be one of: ${AUDIT_ACTIONS.join(", ")}`);
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
  if (input.scope !== undefined) {
    assertValidScope(input.scope);
  }
  if (input.approverUid !== undefined && typeof input.approverUid !== "string") {
    throw new AuditEventValidationError("approverUid must be a string when present");
  }
  if (input.accessVersionAfter !== undefined) {
    if (
      typeof input.accessVersionAfter !== "number" ||
      !Number.isInteger(input.accessVersionAfter) ||
      input.accessVersionAfter < 0
    ) {
      throw new AuditEventValidationError(
        "accessVersionAfter must be a non-negative integer when present",
      );
    }
  }
}

function buildAuditEventDoc(input: RecordAuditEventInput): DocumentData {
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
  return doc;
}

// The minimal shape both firebase-admin's Transaction and WriteBatch
// satisfy -- a caller passes either one, already holding its own
// business-mutation writes, so this Audit Event write commits (or
// aborts) exactly WITH those writes, never independently.
export interface AuditEventWriter {
  set(documentRef: DocumentReference, data: DocumentData): unknown;
}

// Append-only (Spec sec14): this module exposes no update/delete
// function for auditEvents, by design -- there is no code path in this
// repo, trusted or otherwise, that mutates an existing Audit Event.
// `.doc()` always mints a fresh auto-id -- this can only ever be a
// create, never an overwrite of an existing document.
export function stageAuditEvent(writer: AuditEventWriter, input: RecordAuditEventInput): string {
  assertValid(input);
  const db = getFirestore();
  const docRef = db.collection(AUDIT_EVENTS_COLLECTION).doc();
  writer.set(docRef, buildAuditEventDoc(input));
  return docRef.id;
}

// Convenience wrapper for the audit-only case (no accompanying business
// mutation -- e.g. a denied-access record). Still create-only, still
// goes through the identical validation + document-shape path as
// stageAuditEvent; the batch-of-one is what makes even this single
// write's atomicity guarantee explicit and consistent with the
// multi-write path, rather than a separate ad hoc `.set()` call.
export async function recordStandaloneAuditEvent(
  input: RecordAuditEventInput,
): Promise<string> {
  const db = getFirestore();
  const batch = db.batch();
  const id = stageAuditEvent(batch, input);
  await batch.commit();
  return id;
}

export interface ListAuditEventsOptions {
  limit?: number;
}

function assertValidLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIST_LIMIT;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
    throw new AuditEventValidationError(
      `limit must be an integer between 1 and ${MAX_LIST_LIMIT}`,
    );
  }
  return limit;
}

// Read model (Spec sec16: "read-only immutable audit history" in the
// Admin Portal MVP). Server-side (Admin SDK) only -- there is no client
// Rules read path for auditEvents (Row 3 denies it).
//
// DEFERRED (Customer review round 2): this row's own scope is the
// trusted writer + a minimal read model, not the Admin Portal's actual
// read endpoint (Row 11). Equality-filtered queries (by targetType or
// targetId) COMBINED with `orderBy("at")` require a Firestore composite
// index that this row does not define or deploy -- deploying an index
// is exactly the kind of production-adjacent action this row's
// authorization does not cover. This function therefore intentionally
// supports ONLY the unfiltered `orderBy("at", "desc")` + bounded `limit`
// query, which Firestore serves from its automatic single-field index
// with no additional index deployment required. Filtered/ordered
// queries by targetType/targetId are deferred to Row 11, which will
// define and deploy whatever composite indexes its actual Admin Portal
// audit-history UI needs.
export async function listRecentAuditEvents(
  options: ListAuditEventsOptions = {},
): Promise<Array<Record<string, unknown>>> {
  const limit = assertValidLimit(options.limit);
  const db = getFirestore();
  const snapshot = await db
    .collection(AUDIT_EVENTS_COLLECTION)
    .orderBy("at", "desc")
    .limit(limit)
    .get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}
