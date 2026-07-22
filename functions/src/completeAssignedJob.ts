// F-RULES-1 final gap -- trusted technician job completion (Decision #39,
// docs/specifications/technician-self-write.md). Relocates the client-side
// completion cascade (field-ops-app-vite/src/domain/jobActions.js
// updateJobStatus(COMPLETE): job.status -> complete AND own technician
// status -> available) into a trusted callable, so the technician's interim
// direct write grant on fieldops_technicians can later be removed (PR-C).
//
// Deliberately NARROW: this is technician-initiated completion of the
// caller's OWN in_progress legacy job -- not a general transition endpoint,
// not a Work Order engine surface (fieldops_wos has its own deployed
// createWorkOrder/transitionWorkOrder callables), and not an admin/
// dispatcher path (they keep their existing operational flows; Owner O-2).
//
// Naming note (gate-vs-spec reconciliation): the authorizing gate's template
// says `workOrderId`, but the approved Specification section 1.D fixes the
// input as `jobId` -- and legacy fieldops_jobs documents already carry a
// DIFFERENT `workOrderId` field (their upward link to fieldops_wos), so
// reusing that name for the job's own id would be actively misleading here.
//
// Same structural pattern as updateWorkOrderExecutionData.ts: onCall +
// HttpsError + getCallerContext + a single runTransaction doing
// read-verify-write. Idempotency + audit follow the trusted-writer
// convention (functions/src/access/trustedWriterCommands.ts): the
// caller-supplied idempotencyKey IS the auditEvents document id, so the
// Audit Event doubles as the idempotency record and commits atomically
// WITH the cascade -- no completion without audit, no audit without
// completion, no duplicate completion.
import { createHash } from "node:crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getCallerContext } from "./callerContext";
import {
  auditEventDocRef,
  stageAuditEventWithId,
  type RecordAuditEventInput,
} from "./access/auditEventWriter";

// Legacy Field Ops demo collections -- mirrored at
// field-ops-app-vite/src/domain/constants.js (same string values). The
// lifecycle enums mirror JOB_STATUS / TECH_STATUS there; PR-2's Firestore
// Rules (isTechnicianJobTransition/isTechnicianStatus) enforce the same
// values for direct-client writes.
const JOBS_COLLECTION = "fieldops_jobs";
const TECHNICIANS_COLLECTION = "fieldops_technicians";
const JOB_STATUS_IN_PROGRESS = "in_progress";
const JOB_STATUS_COMPLETE = "complete";
const TECH_STATUS_AVAILABLE = "available";

const REGION = "us-central1";
const AUDIT_ACTION = "completeAssignedJob" as const;
// Fingerprint targetType for the idempotency/audit record (singular of the
// collection name, unambiguous against the Work Order engine's surfaces).
const AUDIT_TARGET_TYPE = "fieldops_job";
const MAX_JOB_ID_LENGTH = 400;

interface CompleteAssignedJobInput {
  jobId: string;
  idempotencyKey: string;
}

interface CompleteAssignedJobResult {
  jobId: string;
  status: typeof JOB_STATUS_COMPLETE;
  idempotentReplay: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Narrowest valid request shape (gate section 3): exactly { jobId,
// idempotencyKey }. Unknown fields are REJECTED, not ignored -- a request
// carrying technicianId/role/targetState/etc. must fail loudly rather than
// silently dropping what the caller believed was authoritative.
function assertValidInput(data: unknown): asserts data is CompleteAssignedJobInput {
  if (!isPlainObject(data)) {
    throw new HttpsError("invalid-argument", "Request data must be an object.");
  }
  const unknown = Object.keys(data).filter((k) => k !== "jobId" && k !== "idempotencyKey");
  if (unknown.length > 0) {
    throw new HttpsError(
      "invalid-argument",
      `Unknown field(s): ${unknown.join(", ")} -- only jobId and idempotencyKey are accepted.`,
    );
  }
  const jobId = data.jobId;
  if (
    typeof jobId !== "string" ||
    jobId.length === 0 ||
    jobId.length > MAX_JOB_ID_LENGTH ||
    jobId.trim() !== jobId ||
    jobId.includes("/")
  ) {
    throw new HttpsError(
      "invalid-argument",
      `jobId must be a non-empty normalized string of at most ${MAX_JOB_ID_LENGTH} characters with no "/".`,
    );
  }
  // Exact trusted-writer rule (trustedWriterCommands.ts): the key becomes a
  // literal Firestore document id, so it must be id-safe and long enough to
  // not collide by accident.
  const idempotencyKey = data.idempotencyKey;
  if (
    typeof idempotencyKey !== "string" ||
    idempotencyKey.length < 8 ||
    idempotencyKey.length > 200 ||
    !/^[A-Za-z0-9_-]+$/.test(idempotencyKey)
  ) {
    throw new HttpsError(
      "invalid-argument",
      "idempotencyKey must be an 8-200 character string of letters, digits, underscore, or hyphen",
    );
  }
}

// A denial that is substantive (post-input-validation, authorization- or
// state-relevant) and must therefore leave exactly one "denied" Audit Event
// (trusted-writer convention). Carries the public HttpsError code/message
// separately from the audit reason so neither leaks the other's detail.
class SubstantiveDenial extends Error {
  constructor(
    readonly code: "permission-denied" | "failed-precondition" | "not-found",
    readonly publicMessage: string,
    readonly auditReason: string,
  ) {
    super(publicMessage);
  }
}

function fingerprintMatches(existing: Record<string, unknown>, jobId: string): boolean {
  return (
    existing.action === AUDIT_ACTION &&
    existing.targetType === AUDIT_TARGET_TYPE &&
    existing.targetId === jobId
  );
}

// Mirrors trustedWriterCommands.ts's corrected denied-attempt recording
// (review round 4 there): a denial records exactly one immutable "denied"
// Audit Event, idempotent on the key; a key REUSED for a different
// operation records the conflicting denial at a deterministic derived id
// instead of overwriting the immutable primary record or silently dropping
// the denial. Runs in its own transaction because the business transaction
// that produced the denial has already aborted (no partial writes exist).
async function recordDeniedAttempt(
  idempotencyKey: string,
  input: Omit<RecordAuditEventInput, "outcome">,
): Promise<void> {
  const db = getFirestore();
  try {
    await db.runTransaction(async (txn) => {
      const primaryRef = auditEventDocRef(idempotencyKey);
      const primarySnap = await txn.get(primaryRef);
      if (!primarySnap.exists) {
        stageAuditEventWithId(txn, idempotencyKey, { ...input, outcome: "denied" });
        return;
      }
      const existing = primarySnap.data() as Record<string, unknown>;
      if (
        existing.action === input.action &&
        existing.targetType === input.targetType &&
        existing.targetId === input.targetId
      ) {
        // Same operation already recorded at this key (applied or a prior
        // denial) -- the immutable primary record stays authoritative.
        return;
      }
      const hash = createHash("sha256")
        .update(`${input.action}|${input.targetType}|${input.targetId}`)
        .digest("hex")
        .slice(0, 16);
      const conflictRef = auditEventDocRef(`${idempotencyKey}--conflict--${hash}`);
      const conflictSnap = await txn.get(conflictRef);
      if (conflictSnap.exists) return;
      const conflictNote = " [idempotencyKey reuse conflict -- a different operation already used this id]";
      stageAuditEventWithId(txn, conflictRef.id, {
        ...input,
        outcome: "denied",
        summary: `${input.summary.slice(0, 499 - conflictNote.length)}${conflictNote}`,
      });
    });
  } catch (auditErr) {
    // The denial itself must still propagate to the caller even if the
    // denial RECORD could not be written; log the audit failure safely
    // (no claims, no request payload) rather than masking the real error.
    console.error("completeAssignedJob: failed to record denied Audit Event", auditErr);
  }
}

export const completeAssignedJob = onCall({ region: REGION }, async (request): Promise<CompleteAssignedJobResult> => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be signed in.");
  }

  assertValidInput(request.data);
  const { jobId, idempotencyKey } = request.data;
  // Caller identity comes ONLY from the authenticated context -- the input
  // allowlist above structurally rejects any caller-supplied identity.
  const actorUid = request.auth.uid;

  // Technician-only (Owner O-2): role and technicianId both resolve
  // server-side from users/{uid} via the same getCallerContext the deployed
  // Work Order callables use. admin/dispatcher are rejected here -- they
  // keep their existing operational paths. operationalRoles are never
  // consulted (they are work-eligibility, not authorization).
  const caller = await getCallerContext(actorUid);

  const baseAudit: Omit<RecordAuditEventInput, "outcome" | "summary"> = {
    actorUid,
    action: AUDIT_ACTION,
    targetType: AUDIT_TARGET_TYPE,
    targetId: jobId,
  };

  if (caller.role !== "technician") {
    await recordDeniedAttempt(idempotencyKey, {
      ...baseAudit,
      summary: `denied: caller role "${caller.role ?? "none"}" is not technician for job ${jobId}`,
    });
    throw new HttpsError("permission-denied", "Only technicians may complete an assigned job.");
  }
  if (!caller.technicianId) {
    await recordDeniedAttempt(idempotencyKey, {
      ...baseAudit,
      summary: `denied: caller has no technicianId mapping (job ${jobId})`,
    });
    throw new HttpsError(
      "failed-precondition",
      "This account has no technicianId mapping yet (see PT-001's assignTechnicianToUser.js).",
    );
  }
  const technicianId = caller.technicianId;

  const db = getFirestore();
  let idempotentReplay: boolean;
  try {
    idempotentReplay = await db.runTransaction(async (tx) => {
      // 1. Idempotency gate -- the Audit Event AT this key is the record.
      const primarySnap = await tx.get(auditEventDocRef(idempotencyKey));
      if (primarySnap.exists) {
        const existing = primarySnap.data() as Record<string, unknown>;
        if (!fingerprintMatches(existing, jobId)) {
          throw new HttpsError(
            "already-exists",
            "This idempotencyKey was already used for a different operation -- use a fresh idempotencyKey per logical operation.",
          );
        }
        if (existing.outcome === "denied") {
          throw new HttpsError(
            "already-exists",
            "This idempotencyKey was already used for a denied attempt -- Audit Events are immutable; retry with a fresh idempotencyKey.",
          );
        }
        // Exact replay of the applied operation: no mutation, deterministic
        // success (gate section 9.B / 9.D).
        return true;
      }

      // 2. Read + validate the job.
      const jobRef = db.collection(JOBS_COLLECTION).doc(jobId);
      const jobSnap = await tx.get(jobRef);
      if (!jobSnap.exists) {
        throw new SubstantiveDenial("not-found", `No job with id ${jobId}`, "job not found");
      }
      const job = jobSnap.data() as { status?: unknown; technicianId?: unknown };

      // 3. Ownership: authoritative assignment field vs the SERVER-resolved
      // technicianId -- exact identity comparison, no fallback, no
      // admin/dispatcher override through this endpoint.
      if (job.technicianId !== technicianId) {
        throw new SubstantiveDenial(
          "permission-denied",
          "This job is not assigned to you.",
          "caller is not the assigned technician",
        );
      }

      // 4. Lifecycle: completion requires in_progress (Decision #39 / O-3 --
      // assigned -> in_progress stays a direct client transition; a job
      // completed through some other authorized operation is a
      // precondition failure here, never falsely claimed as this
      // request's success (gate section 9.E)).
      if (job.status === JOB_STATUS_COMPLETE) {
        throw new SubstantiveDenial(
          "failed-precondition",
          "This job is already complete.",
          "job already complete via another operation",
        );
      }
      if (job.status !== JOB_STATUS_IN_PROGRESS) {
        throw new SubstantiveDenial(
          "failed-precondition",
          `Job must be in_progress to complete (currently "${String(job.status)}") -- start work first.`,
          `job not in_progress (status "${String(job.status)}")`,
        );
      }

      // 5. The caller's own technician record must exist (mapping
      // consistency -- fail closed, never a partial cascade).
      const techRef = db.collection(TECHNICIANS_COLLECTION).doc(technicianId);
      const techSnap = await tx.get(techRef);
      if (!techSnap.exists) {
        throw new SubstantiveDenial(
          "failed-precondition",
          "Your technician record is missing -- the technicianId mapping is inconsistent; contact a dispatcher.",
          "mapped technician record missing",
        );
      }

      // 6. The approved cascade -- STATUS-ONLY on both documents, exactly
      // the fields the client transaction wrote (Decision #39). The legacy
      // job model has no completedAt/completedBy fields, and this PR
      // introduces no schema change: the atomic Audit Event below carries
      // the actor, transition, and server timestamp.
      tx.update(jobRef, { status: JOB_STATUS_COMPLETE });
      tx.update(techRef, { status: TECH_STATUS_AVAILABLE });

      // 7. Atomic audit + idempotency record (one write, commits with the
      // cascade or not at all).
      stageAuditEventWithId(tx, idempotencyKey, {
        ...baseAudit,
        outcome: "applied",
        summary: `technician ${technicianId} completed assigned job ${jobId} (job in_progress -> complete; technician -> available)`,
        scope: { type: "ownAssignment", value: technicianId },
      });
      return false;
    });
  } catch (err) {
    if (err instanceof SubstantiveDenial) {
      await recordDeniedAttempt(idempotencyKey, {
        ...baseAudit,
        summary: `denied: ${err.auditReason} (job ${jobId}, technician ${technicianId})`,
      });
      throw new HttpsError(err.code, err.publicMessage);
    }
    throw err;
  }

  return { jobId, status: JOB_STATUS_COMPLETE, idempotentReplay };
});
