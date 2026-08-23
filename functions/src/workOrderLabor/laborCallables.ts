// TECHNICIAN LABOR — the onCall adapters, and the production seams behind them.
//
// All authority lives in the command. This authenticates, resolves who the caller IS (principal plus
// technician identity, both from the server, never from a payload), and translates refusals into
// codes a phone can branch on.
//
// `work_order_labor_entries` has no firestore.rules match block, so it is deny-all to every client
// including admin -- the established posture for `bins`, `inventory_returns` and `part_aliases`. A
// technician's hours cannot be written from a browser at all, which is why these exist.
//
// EXPORT != DEPLOY. Both capabilities are registered active:false and carried by no Role yet.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import {
  recordWorkOrderLabor,
  correctWorkOrderLabor,
  projectWorkOrderLabor,
  LaborCommandError,
  LABOR_RECORD_CAPABILITY,
  LABOR_CORRECT_CAPABILITY,
  LABOR_ENTRIES_COLLECTION,
  LABOR_TYPES,
  LABOR_ENTRY_KINDS,
  LABOR_RECORDABLE_WO_STATUSES,
  MAX_LABOR_MINUTES,
  type LaborAuditInput,
  type LaborFailureCode,
} from "./workOrderLaborCommand.js";
import { resolveEffectivePermission, type TargetContext } from "../access/resolveEffectivePermission.js";
import { COMPATIBILITY_ROLES } from "../access/compatibilityRoles.js";
import { GOVERNED_BUSINESS_ROLES } from "../access/governedBusinessRoles.js";
import { resolveRuntimeCapabilityOverrides } from "../access/environmentCapabilityOverrides.js";
import { isValidAccessVersionValue } from "../access/compactClaims.js";
import { stageAuditEvent } from "../access/auditEventWriter.js";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed.js";
import { getCallerContext } from "../callerContext.js";
import type { Role } from "../types/access.js";

const REGION = { region: "us-central1" } as const;
const USERS_COLLECTION = "users";
const ROLE_ASSIGNMENTS_COLLECTION = "roleAssignments";
const GLOBAL_TARGET: TargetContext = { scope: { type: "global" }, condition: {} };
const LABOR_ROLE_CATALOG: Readonly<Record<string, Role>> = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };

/** How many entries one technician-day read may return. A day is not a payroll history. */
const LABOR_READ_CAP = 100;

// Read THROUGH the transaction so a revocation mid-flight conflicts the commit rather than being
// missed. Labor is a durable business record; a race that records an hour under a revoked authority
// is not something an audit can undo.
function resolveThroughTxn(capability: string) {
  return async function resolve(txn: Transaction, db: Firestore, actorId: string): Promise<boolean> {
    if (typeof actorId !== "string" || actorId.trim() === "") return false;
    const userSnap = await txn.get(db.collection(USERS_COLLECTION).doc(actorId));
    const assignmentsSnap = await txn.get(
      db.collection(ROLE_ASSIGNMENTS_COLLECTION).where("principalUid", "==", actorId).where("status", "==", "active"),
    );
    let accessVersion = 0;
    if (userSnap.exists) {
      const av = (userSnap.data() ?? {}).accessVersion;
      if (av !== undefined && av !== null) {
        if (!isValidAccessVersionValue(av)) return false;
        accessVersion = av as number;
      }
    }
    return resolveEffectivePermission({
      permissionId: capability,
      assignments: assignmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as never[],
      roles: LABOR_ROLE_CATALOG,
      currentAccessVersion: accessVersion,
      target: GLOBAL_TARGET,
      activationOverrides: resolveRuntimeCapabilityOverrides(),
    }).decision === "ALLOW";
  };
}

/** A THROWING resolver is a denial, never an allow. */
async function allows(uid: string, capability: string): Promise<boolean> {
  try {
    const { decisions } = await resolveEffectiveAccess({ principalUid: uid, permissionIds: [capability] });
    return decisions[capability] === true;
  } catch (err) {
    console.error(`[workOrderLabor] capability resolution failed for ${capability}`, err);
    return false;
  }
}

const authorizeFor = (capability: string, db: Firestore) =>
  (txn: Transaction | null, actorId: string) =>
    (txn === null ? allows(actorId, capability) : resolveThroughTxn(capability)(txn, db, actorId));

/** One audit event per labor act, saying what it was and — for a correction — what it replaced. */
function stageLaborAudit(txn: Transaction, a: LaborAuditInput): void {
  const replaced = a.correctsLaborEntryId ? ` replacing ${a.correctsLaborEntryId}` : "";
  const summary = `${a.action === "correct" ? "correctWorkOrderLabor" : "recordWorkOrderLabor"} `
    + `${a.durationMinutes}min ${a.laborType} on ${a.workDate} for technician ${a.technicianId} `
    + `against work order ${a.workOrderId}${replaced}`;
  stageAuditEvent(txn, {
    actorUid: a.actorId,
    action: a.action === "correct" ? "correctWorkOrderLabor" : "recordWorkOrderLabor",
    targetType: "workOrderLabor",
    targetId: a.laborEntryId,
    outcome: "applied",
    summary: summary.slice(0, 500),
  });
}

const FAILURE: Readonly<Record<LaborFailureCode, { status: "permission-denied" | "invalid-argument" | "failed-precondition" | "not-found"; message: string }>> = Object.freeze({
  PERMISSION_DENIED: { status: "permission-denied", message: "You are not authorized to record labor." },
  WORK_ORDER_NOT_FOUND: { status: "not-found", message: "That work order could not be found." },
  WORK_ORDER_STATE_INVALID: { status: "failed-precondition", message: "This work order is not being executed, so new labor cannot be recorded on it." },
  NOT_ASSIGNED_TECHNICIAN: { status: "permission-denied", message: "Labor can only be recorded on a work order assigned to you." },
  REQUEST_INVALID: { status: "invalid-argument", message: "That labor entry is not valid." },
  INTERVAL_INVALID: { status: "invalid-argument", message: "Those start and end times are not valid." },
  DURATION_INVALID: { status: "invalid-argument", message: "That amount of time is not valid." },
  OVERLAPPING_ENTRY: { status: "failed-precondition", message: "That time overlaps labor you already recorded." },
  IDEMPOTENCY_CONFLICT: { status: "failed-precondition", message: "A different labor entry was already recorded under this request." },
  ENTRY_NOT_FOUND: { status: "not-found", message: "That labor entry could not be found." },
  ENTRY_ALREADY_REVERSED: { status: "failed-precondition", message: "That entry was already corrected. Correct the replacement instead." },
});

function toHttps(err: unknown): HttpsError {
  if (err instanceof LaborCommandError) {
    const m = FAILURE[err.code];
    return new HttpsError(m.status, m.message, err.code);
  }
  console.error("[workOrderLabor] failed", err);
  return new HttpsError("internal", "The request could not be completed.", "INTERNAL");
}

/** Identity from the authenticated session plus users/{uid}. Never from a payload. */
async function resolveActor(uid: string) {
  const ctx = await getCallerContext(uid);
  return { kind: "USER" as const, id: uid, technicianId: ctx.technicianId, role: ctx.role };
}

export const recordWorkOrderLaborCallable = onCall(REGION, async (request) => {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Must be signed in.");
  const db = getFirestore();
  try {
    return await recordWorkOrderLabor(request.data, {
      db,
      actor: await resolveActor(request.auth.uid),
      authorize: authorizeFor(LABOR_RECORD_CAPABILITY, db),
      stageAudit: stageLaborAudit,
      // SERVER time. The device's own reading travels separately and is never mistaken for this.
      now: () => new Date(),
    });
  } catch (err) {
    throw toHttps(err);
  }
});

export const correctWorkOrderLaborCallable = onCall(REGION, async (request) => {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Must be signed in.");
  const db = getFirestore();
  try {
    return await correctWorkOrderLabor(request.data, {
      db,
      actor: await resolveActor(request.auth.uid),
      authorize: authorizeFor(LABOR_CORRECT_CAPABILITY, db),
      stageAudit: stageLaborAudit,
      now: () => new Date(),
    });
  } catch (err) {
    throw toHttps(err);
  }
});

/**
 * The labor on ONE work order, plus its derived totals.
 *
 * Scoped to a work order rather than to an employee: "what time is on this job" is an operational
 * question a technician and their manager both have. "What has this person worked this month" is a
 * payroll question with different authority, and this deliberately cannot answer it.
 *
 * Gated on the RECORD capability -- somebody who may put time on jobs may see the time on them.
 */
export const getWorkOrderLabor = onCall(REGION, async (request) => {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Must be signed in.");
  const db = getFirestore();
  const uid = request.auth.uid;
  try {
    const workOrderId = typeof (request.data ?? {}).workOrderId === "string" ? request.data.workOrderId.trim() : "";
    if (!workOrderId) throw new LaborCommandError("REQUEST_INVALID", "workOrderId required");
    const canRecord = await allows(uid, LABOR_RECORD_CAPABILITY);
    const canCorrect = await allows(uid, LABOR_CORRECT_CAPABILITY);
    if (!canRecord && !canCorrect) {
      throw new LaborCommandError("PERMISSION_DENIED", "not authorized to read labor");
    }
    const snap = await db.collection(LABOR_ENTRIES_COLLECTION)
      .where("workOrderId", "==", workOrderId).limit(LABOR_READ_CAP).get();
    const entries = snap.docs.map((d) => d.data() ?? {});
    return {
      status: "ready",
      workOrderId,
      // REVERSED entries are RETURNED as well as excluded from the totals: "what does this job cost
      // in time" and "what was recorded and later corrected" are different questions.
      entries: entries.map((e) => ({
        laborEntryId: e.laborEntryId, technicianId: e.technicianId, laborType: e.laborType,
        entryKind: e.entryKind, durationMinutes: e.durationMinutes, workDate: e.workDate,
        startedAtMillis: e.startedAtMillis ?? null, endedAtMillis: e.endedAtMillis ?? null,
        status: e.status, correctsLaborEntryId: e.correctsLaborEntryId ?? null,
        notes: e.notes ?? null,
      })),
      totals: projectWorkOrderLabor(entries),
      // The contract, returned so a client never hardcodes a copy of it.
      laborTypes: [...LABOR_TYPES],
      entryKinds: [...LABOR_ENTRY_KINDS],
      recordableStatuses: [...LABOR_RECORDABLE_WO_STATUSES],
      maxMinutes: MAX_LABOR_MINUTES,
      canRecord,
      canCorrect,
    };
  } catch (err) {
    throw toHttps(err);
  }
});
