// ADMINISTRATION USERS CONSOLIDATION -- the record-scoped Change History read.
//
// ════════════════════ WHY A CALLABLE, AND WHY RECORD-SCOPED ════════════════════
//
// firestore.rules denies every client read of `auditEvents`, unconditionally and by design
// (Implementation Plan Row 3). So a record page cannot query the trail; it asks this callable,
// which re-authorizes on `audit.event.read` and returns a bounded, sanitized projection.
//
// Scoped to ONE record on purpose. auditEventWriter's own listRecentAuditEvents reads the whole
// collection ordered by time -- fine for an audit console, wrong for a record page, which would
// have to load the entire company's history to find the four events about one employee. The
// composite index this needs (auditEvents: targetType ASC, targetId ASC, at DESC) is declared in
// firestore.indexes.json in the same change; no other new index is added, because no other new
// query exists.
//
// ════════════════════ A PROJECTION, NOT THE AUTHORITY ════════════════════
//
// The rows returned here are a READ MODEL. The immutable Audit Event collection remains the
// canonical authority and legitimately holds more than this returns -- denied attempts, access
// events, scope and accessVersion facts. This exists so a person can see what changed on a record,
// and it never becomes the place changes are recorded.
//
// NOTHING IS SYNTHESIZED. Every row corresponds to exactly one stored Audit Event document. There
// is no diffing of a current record against a previous one anywhere in this path -- a "change"
// that no trusted command recorded is not a change this service knows about, and that is correct:
// a history assembled from client state is a history that can be wrong.
import { getFirestore, type Firestore, Timestamp } from "firebase-admin/firestore";
import type { Role } from "../types/access";
import { resolveEffectivePermission, type TargetContext } from "./resolveEffectivePermission";
import { COMPATIBILITY_ROLES } from "./compatibilityRoles";
import { listAuditEventsForRecord } from "./auditEventWriter";

const USERS_COLLECTION = "users";
const ROLE_ASSIGNMENTS_COLLECTION = "roleAssignments";
const EMPLOYEES_COLLECTION = "employees";

export const AUDIT_READ_CAPABILITY = "audit.event.read";

export class InvalidInputError extends Error {}
export class UnauthorizedActorError extends Error {}

/**
 * The record types a client may ask about.
 *
 * A CLOSED list, not a pass-through of whatever `targetType` the caller sends. The trail carries
 * events about principals, access requests and report definitions too, and "give me every event
 * whose targetId is this string" over an open type space is a read primitive rather than a record
 * page's history. New record surfaces are added here deliberately, one at a time.
 */
export const READABLE_TARGET_TYPES: readonly string[] = Object.freeze(["employee"]);

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export interface ListRecordChangeHistoryInput {
  actorUid: string;
  targetType: string;
  targetId: string;
  limit?: number;
}

export interface ChangeHistoryRow {
  id: string;
  /** Epoch milliseconds. null when the server timestamp has not materialized yet. */
  occurredAt: number | null;
  eventType: string;
  outcome: string;
  /** null for an event that is not a field change (a status change, a reset, a denial). */
  fieldKey: string | null;
  previousValue: string | null;
  newValue: string | null;
  changedById: string;
  /** The actor's Employee display name where one resolves; null otherwise -- never a uid. */
  changedByLabel: string | null;
  summary: string;
}

export interface RecordChangeHistoryDeps {
  db?: Firestore;
  roles?: Readonly<Record<string, Role>>;
}

const GLOBAL_TARGET: TargetContext = { scope: { type: "global" }, condition: {} };

function readAccessVersion(data: Record<string, unknown> | undefined): number {
  const raw = data?.accessVersion;
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 ? raw : 0;
}

async function actorHasAuditRead(
  db: Firestore,
  roles: Readonly<Record<string, Role>>,
  actorUid: string,
): Promise<boolean> {
  const [userSnap, assignmentsSnap] = await Promise.all([
    db.collection(USERS_COLLECTION).doc(actorUid).get(),
    db
      .collection(ROLE_ASSIGNMENTS_COLLECTION)
      .where("principalUid", "==", actorUid)
      .where("status", "==", "active")
      .get(),
  ]);
  return (
    resolveEffectivePermission({
      permissionId: AUDIT_READ_CAPABILITY,
      assignments: assignmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as never[],
      roles,
      currentAccessVersion: readAccessVersion(userSnap.data() as Record<string, unknown> | undefined),
      target: GLOBAL_TARGET,
    }).decision === "ALLOW"
  );
}

function toEpochMillis(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Resolve actor uids to the human names an audit table has to show.
 *
 * ONE query for the whole page of events, not one per row. `users/{uid}.displayName` is the name
 * the reset-candidate listing already reads for the same purpose, and the fallback is null rather
 * than the uid: a raw identifier shown to a person as a name is the defect DECISIONS #106 forbids,
 * and the caller renders "Unknown" for it instead.
 */
async function resolveActorLabels(db: Firestore, uids: string[]): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  const unique = [...new Set(uids)].filter(Boolean);
  if (unique.length === 0) return labels;
  const snaps = await db.getAll(...unique.map((uid) => db.collection(USERS_COLLECTION).doc(uid)));
  const unresolved: string[] = [];
  for (const snap of snaps) {
    const name = asStringOrNull((snap.data() as Record<string, unknown> | undefined)?.displayName);
    if (name) labels.set(snap.id, name);
    else unresolved.push(snap.id);
  }
  // A user document with no displayName may still be linked to an Employee that has one -- the
  // employee record is the authoritative workforce identity, so it is the second place to look
  // rather than the first thing to give up on.
  if (unresolved.length > 0) {
    const empSnaps = await db
      .collection(EMPLOYEES_COLLECTION)
      .where("userId", "in", unresolved.slice(0, 10))
      .get();
    for (const doc of empSnaps.docs) {
      const data = doc.data() as Record<string, unknown>;
      const uid = asStringOrNull(data.userId);
      const name = asStringOrNull(data.displayName);
      if (uid && name && !labels.has(uid)) labels.set(uid, name);
    }
  }
  return labels;
}

/**
 * One record's change history, newest first.
 *
 * Returns applied AND denied events: a refused attempt to change somebody's employment status is
 * part of that record's history, and hiding it would make the trail read as though nobody ever
 * tried.
 */
export async function listRecordChangeHistory(
  input: ListRecordChangeHistoryInput,
  deps: RecordChangeHistoryDeps = {},
): Promise<ChangeHistoryRow[]> {
  const db = deps.db ?? getFirestore();
  const roles = deps.roles ?? COMPATIBILITY_ROLES;

  if (typeof input.actorUid !== "string" || !input.actorUid) {
    throw new InvalidInputError("actorUid is required");
  }
  if (!READABLE_TARGET_TYPES.includes(input.targetType)) {
    throw new InvalidInputError(
      `targetType must be one of: ${READABLE_TARGET_TYPES.join(", ")}`,
    );
  }
  if (typeof input.targetId !== "string" || !input.targetId) {
    throw new InvalidInputError("targetId is required");
  }
  let limit = DEFAULT_LIMIT;
  if (input.limit !== undefined) {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > MAX_LIMIT) {
      throw new InvalidInputError(`limit must be an integer between 1 and ${MAX_LIMIT}`);
    }
    limit = input.limit;
  }

  if (!(await actorHasAuditRead(db, roles, input.actorUid))) {
    // Deliberately NOT audited. Reading the trail is not a mutation, and recording a denied READ
    // of one record's history on the same trail would let an unauthorized caller append to it.
    throw new UnauthorizedActorError(`actor is not authorized for "${AUDIT_READ_CAPABILITY}"`);
  }

  const events = await listAuditEventsForRecord(input.targetType, input.targetId, { limit }, db);
  const labels = await resolveActorLabels(
    db,
    events.map((e) => asStringOrNull(e.actorUid) ?? ""),
  );

  return events.map((event) => {
    const actorUid = asStringOrNull(event.actorUid) ?? "";
    return {
      id: String(event.id),
      occurredAt: toEpochMillis(event.at),
      eventType: asStringOrNull(event.action) ?? "",
      outcome: asStringOrNull(event.outcome) ?? "",
      fieldKey: asStringOrNull(event.fieldKey),
      previousValue: asStringOrNull(event.previousValue),
      newValue: asStringOrNull(event.newValue),
      changedById: actorUid,
      changedByLabel: labels.get(actorUid) ?? null,
      summary: asStringOrNull(event.summary) ?? "",
    };
    // NOTHING ELSE CROSSES. scope, accessVersionAfter, approverUid, the report fields and the
    // ownership fields all stay server-side: they are access-model internals, and a record's
    // change history has no use for them. The projection is an allow-list, so a field added to
    // the Audit Event contract later cannot leak here by default.
  });
}
