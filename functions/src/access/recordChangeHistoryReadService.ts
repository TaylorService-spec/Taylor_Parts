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
 * ONE PERSON'S EVENTS, gathered from the several places the trail records them.
 *
 * THE PROBLEM THIS SOLVES (Owner ruling 2026-09-06 §7). Access events are NOT written against the
 * employee record, so a person's Change History showed profile edits and nothing about their
 * access. Measured from the commands rather than assumed, the three shapes are:
 *
 *   assignApprovedRole   targetType "roleAssignment"   targetId = principalUid
 *   setUserStatus        targetType "user"             targetId = principalUid
 *   revokeRole           targetType "roleAssignment"   targetId = ASSIGNMENT id
 *
 * The third is the awkward one and the reason this is not a two-line union: a revocation is
 * recorded against the assignment, and the audit event carries no principalUid field to query by,
 * so the assignment ids have to be looked up first. That lookup reads roleAssignments at EVERY
 * status -- unlike readPrincipalAccessState, which returns only active ones -- because a revoked
 * assignment is precisely the one whose revocation we are trying to show.
 *
 * NO NEW AUDIT EVENTS ARE WRITTEN, here or anywhere. The immutable records stay exactly as the
 * commands wrote them; this is a read that gathers them. Writing a second, employee-targeted copy
 * of each access event would double the trail and create two records that can disagree.
 *
 * `in` takes at most 30 values per query, so the assignment ids are chunked. The per-query limit is
 * the caller's full limit rather than a share of it: each query is independently ordered by time,
 * and slicing after the merge is what makes "the most recent N events about this person" true.
 */
async function listEventsForRecordAndItsPrincipal(
  db: Firestore,
  targetType: string,
  targetId: string,
  limit: number,
): Promise<Array<Record<string, unknown>>> {
  const own = await listAuditEventsForRecord(targetType, targetId, { limit }, db);
  if (targetType !== "employee") return own;

  // The linked principal. No link means no access events exist to gather, which is a complete
  // answer rather than a partial one.
  const employeeSnap = await db.collection("employees").doc(targetId).get();
  const principalUid = employeeSnap.exists
    ? (employeeSnap.data() as Record<string, unknown>).userId
    : undefined;
  if (typeof principalUid !== "string" || principalUid.length === 0) return own;

  const assignmentsSnap = await db
    .collection("roleAssignments")
    .where("principalUid", "==", principalUid)
    .get();
  const assignmentIds = assignmentsSnap.docs.map((d) => d.id);

  const queries: Array<Promise<Array<Record<string, unknown>>>> = [
    listAuditEventsForRecord("user", principalUid, { limit }, db),
    listAuditEventsForRecord("roleAssignment", principalUid, { limit }, db),
  ];
  for (let i = 0; i < assignmentIds.length; i += 30) {
    const chunk = assignmentIds.slice(i, i + 30);
    queries.push(
      db
        .collection("auditEvents")
        .where("targetType", "==", "roleAssignment")
        .where("targetId", "in", chunk)
        .orderBy("at", "desc")
        .limit(limit)
        .get()
        .then((snap) => snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))),
    );
  }

  // ROLE NAMES WITHOUT PARSING PROSE. An access event records only a summary sentence, so the
  // obvious way to show WHICH Role was added is to parse that sentence -- which breaks the day the
  // wording changes, silently and in a record of who has access to what.
  //
  // It is unnecessary, because the ids line up by construction: runAccessMutationCommand writes
  // the audit document under the idempotencyKey, and assignApprovedRole creates the assignment
  // under that same key. So for an ADD the audit event's own id IS the assignment id, and for a
  // REMOVE the assignment id is the event's targetId. Both resolve through this map to the roleId
  // the assignment itself records -- structured data, not text.
  const roleIdByAssignmentId = new Map(
    assignmentsSnap.docs.map((d) => [d.id, (d.data() as Record<string, unknown>).roleId]),
  );
  const withRoleNames = (events: Array<Record<string, unknown>>) =>
    events.map((event) => {
      const action = event.action;
      if (action !== "assignApprovedRole" && action !== "revokeRole" && action !== "grantRole") {
        return event;
      }
      const assignmentId = action === "revokeRole" ? String(event.targetId) : String(event.id);
      const roleId = roleIdByAssignmentId.get(assignmentId);
      if (typeof roleId !== "string") return event;
      // fieldKey makes this a FIELD row rather than a bare event row, so it renders in the
      // record's own Field/Previous/New shape: a removal shows the Role leaving, an addition shows
      // it arriving. The client maps "governedRole" to its words.
      return {
        ...event,
        fieldKey: "governedRole",
        ...(action === "revokeRole" ? { previousValue: roleId } : { newValue: roleId }),
      };
    });

  const merged = [...own, ...withRoleNames((await Promise.all(queries)).flat())];
  // Deduplicated by document id: an assignment-id chunk query and the principalUid query can both
  // return the same event, and the same event twice in a history reads as two things happening.
  const byId = new Map(merged.map((e) => [String(e.id), e]));
  return [...byId.values()]
    .sort((a, b) => (toEpochMillis(b.at) ?? 0) - (toEpochMillis(a.at) ?? 0))
    .slice(0, limit);
}

/**
 * One record's change history, newest first.
 *
 * Returns applied AND denied events: a refused attempt to change somebody's employment status is
 * part of that record's history, and hiding it would make the trail read as though nobody ever
 * tried.
 *
 * For an `employee` target this includes the ACCESS events recorded against their linked principal
 * -- Role added, Role removed, account enabled/disabled -- which live under different targetTypes
 * and were previously invisible on the page that shows the person. See
 * listEventsForRecordAndItsPrincipal.
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

  const events = await listEventsForRecordAndItsPrincipal(db, input.targetType, input.targetId, limit);
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
