// Commercial Coverage & Territory — governed WRITE callables (capability #15 persistence). Thin onCall adapters
// over the pure command core. Supply only I/O + auth:
//   • actor identity from request.auth.uid;
//   • authorization = capability `coverage.write`, fail-closed via the trusted effective-access feed;
//     registered active:false ⇒ hard DENY until a separate Owner grant;
//   • writes go to `sales_territories` / `commercial_coverage_assignments` via the Admin SDK; firestore.rules
//     denies ALL direct client access; idempotent via a deterministic audit id + append-only AUDIT event.
// Records only — NO precedence/credit/commission. EXPORT != DEPLOY, REGISTER != GRANT, MERGE != ACTIVATION.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed";
import { SALES_TERRITORIES_COLLECTION, COMMERCIAL_COVERAGE_ASSIGNMENTS_COLLECTION } from "../constants/collections";
import { stageAuditEventWithId, auditEventDocRef } from "../access/auditEventWriter";
import { buildTerritory, buildCoverageAssignment, CoverageCommandError, type TerritoryInput, type CoverageAssignmentInput } from "./coverageCommands";

export const COVERAGE_WRITE_CAPABILITY = "coverage.write";

function mapCommandError(err: unknown): HttpsError {
  if (err instanceof HttpsError) return err;
  if (err instanceof CoverageCommandError) return new HttpsError("invalid-argument", err.message);
  return new HttpsError("internal", "Coverage command failed.");
}

async function requireCoverageWrite(uid: string): Promise<void> {
  let allowed = false;
  try {
    const { decisions } = await resolveEffectiveAccess({ principalUid: uid, permissionIds: [COVERAGE_WRITE_CAPABILITY] });
    allowed = decisions[COVERAGE_WRITE_CAPABILITY] === true;
  } catch (err) {
    console.error(`[requireCoverageWrite] capability resolution failed for ${COVERAGE_WRITE_CAPABILITY}`, err);
    allowed = false;
  }
  if (!allowed) throw new HttpsError("permission-denied", "You are not authorized to write commercial coverage.");
}

const mkAuditId = (action: string, actorUid: string, key: string): string =>
  `${action}_${createHash("sha256").update(`${actorUid}|${key}`).digest("hex").slice(0, 40)}`;

// Create a durable Sales Territory (a coverage object independent of any salesperson).
export const createSalesTerritory = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
  await requireCoverageWrite(request.auth.uid);
  const data = (request.data ?? {}) as TerritoryInput & { idempotencyKey?: string };
  if (typeof data.idempotencyKey !== "string" || data.idempotencyKey.trim().length === 0) throw new HttpsError("invalid-argument", "idempotencyKey is required.");
  const actorUid = request.auth.uid;
  const aid = mkAuditId("createSalesTerritory", actorUid, data.idempotencyKey);
  const db = getFirestore();
  try {
    let record;
    try { record = buildTerritory(data, { nowMillis: Date.now() }); } catch (err) { throw mapCommandError(err); }
    return await db.runTransaction(async (tx) => {
      const prior = await tx.get(auditEventDocRef(aid));
      if (prior.exists) return { success: true as const, replayed: true as const, territoryId: ((prior.data() ?? {}).targetId as string) ?? null };
      const ref = db.collection(SALES_TERRITORIES_COLLECTION).doc();
      tx.set(ref, { ...record, createdBy: actorUid, createdAt: FieldValue.serverTimestamp() });
      stageAuditEventWithId(tx, aid, { actorUid, action: "createSalesTerritory", targetType: "salesTerritory", targetId: ref.id, outcome: "applied", summary: `created ${record.kind} territory ${record.name}` });
      return { success: true as const, replayed: false as const, territoryId: ref.id };
    });
  } catch (err) { throw mapCommandError(err); }
});

// Create a Coverage Assignment (a person assigned to a scope, effective-dated). Overlapping/split coverage is
// expected — this never replaces an existing assignment.
export const createCoverageAssignment = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
  await requireCoverageWrite(request.auth.uid);
  const data = (request.data ?? {}) as CoverageAssignmentInput & { idempotencyKey?: string };
  if (typeof data.idempotencyKey !== "string" || data.idempotencyKey.trim().length === 0) throw new HttpsError("invalid-argument", "idempotencyKey is required.");
  const actorUid = request.auth.uid;
  const aid = mkAuditId("createCoverageAssignment", actorUid, data.idempotencyKey);
  const db = getFirestore();
  try {
    let record;
    try { record = buildCoverageAssignment(data, { nowMillis: Date.now() }); } catch (err) { throw mapCommandError(err); }
    return await db.runTransaction(async (tx) => {
      const prior = await tx.get(auditEventDocRef(aid));
      if (prior.exists) return { success: true as const, replayed: true as const, assignmentId: ((prior.data() ?? {}).targetId as string) ?? null };
      const ref = db.collection(COMMERCIAL_COVERAGE_ASSIGNMENTS_COLLECTION).doc();
      tx.set(ref, { ...record, createdBy: actorUid, createdAt: FieldValue.serverTimestamp() });
      stageAuditEventWithId(tx, aid, { actorUid, action: "createCoverageAssignment", targetType: "coverageAssignment", targetId: ref.id, outcome: "applied", summary: `assigned ${record.assignee.assignedToEmployeeId} to ${record.scope.kind} coverage (company ${record.companyId})` });
      return { success: true as const, replayed: false as const, assignmentId: ref.id };
    });
  } catch (err) { throw mapCommandError(err); }
});
