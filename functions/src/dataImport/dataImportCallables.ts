// EOS Data Import -- the onCall trust boundary.
//
// Thin adapters, in the house pattern (partMasterCallables.ts / supplierMasterCallables.ts):
// actorUid comes ONLY from request.auth.uid and never from request.data, the real logic
// lives in the modules below, and thrown errors are mapped to a sanitized taxonomy.
//
// THREE GATES, IN THIS ORDER, ON EVERY CALL.
//
//   1. AUTHENTICATION      -- request.auth.uid or nothing happens.
//   2. TARGET              -- assertNonProductionImportTarget refuses the production
//                             project BY NAME, from the runtime's own GCLOUD_PROJECT and
//                             never from client input. This runs BEFORE the capability
//                             check on purpose: whether import may run HERE is a property
//                             of the environment, not of who is asking, and answering it
//                             second would mean a production principal's authority was
//                             evaluated at all.
//   3. CAPABILITY          -- the governed resolver, with per-environment activation.
//
// STAGING AND EXECUTION ARE SEPARATE CAPABILITIES because they are separate acts. Staging
// cannot write -- the modules behind it have no write path -- so its gate protects reading
// a file and seeing a preview. Execution's gate protects creating governed records.
//
// TWO FORMATS, ONE PIPELINE. A CSV arrives as text and an .xlsx arrives base64-encoded;
// both become the same validated grid before anything else looks at them, so the mapping,
// preview, approval and write cannot behave differently for a spreadsheet.
//
// NO FIREBASE STORAGE IN P1. The file arrives as text in the callable payload, bounded by
// IMPORT_LIMITS.maxFileBytes. A Storage bucket would add an object-lifecycle, a second set
// of Rules and a place for customer data to sit unowned, in exchange for a larger file
// limit nobody has asked for yet.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";

import { resolveEffectivePermission, type TargetContext } from "../access/resolveEffectivePermission.js";
import { resolveRuntimeCapabilityOverrides } from "../access/environmentCapabilityOverrides.js";
import { COMPATIBILITY_ROLES } from "../access/compatibilityRoles.js";
import { GOVERNED_BUSINESS_ROLES } from "../access/governedBusinessRoles.js";
import { isValidAccessVersionValue } from "../access/compactClaims.js";
import type { Role } from "../types/access.js";

import { assertNonProductionImportTarget, ImportTargetRefusedError } from "./importTargetGuard.js";
import {
  parseSourceFile,
  parseWorkbookFile,
  detectEntityType,
  suggestMapping,
  validateMapping,
  projectRows,
  headerSignature,
  IntakeError,
  IMPORT_LIMITS,
  type ColumnMapping,
  type ImportEntityType,
} from "./importIntake.js";
import { buildEntityPreview } from "./importPreview.js";
import {
  stageImportJob,
  assertExecutable,
  beginExecution,
  finishExecution,
  ImportJobError,
} from "./importJob.js";
import { executeImportJob } from "./importExecution.js";
import {
  firestoreImportJobStore,
  firestorePartWriter,
  firestoreCustomerWriter,
  loadExistingPartIdentities,
  loadExistingCustomerIdentities,
} from "./firestoreDataImportAdapters.js";
import { entityContractFor } from "./contracts/entityContract.js";
import type { RowWriter } from "./importExecution.js";

const REGION = { region: "us-central1" } as const;
const CAP_STAGE = "admin.dataImport.stage";
const CAP_EXECUTE = "admin.dataImport.execute";
const USERS_COLLECTION = "users";
const ROLE_ASSIGNMENTS_COLLECTION = "roleAssignments";
const GLOBAL_TARGET: TargetContext = { scope: { type: "global" }, condition: {} };
const ROLE_CATALOG: Readonly<Record<string, Role>> = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
const HISTORY_LIMIT = 25;

/**
 * The ONE place an entity is bound to its data plane.
 *
 * Two functions per entity and nothing else: how existing identity is looked up, and how
 * one record is written. Everything between -- parsing, mapping, validation, preview,
 * approval, per-row accounting -- is entity-agnostic and shared, so adding an entity is a
 * contract plus a row in this table rather than a second pipeline.
 *
 * An entity ABSENT from this table cannot be executed even if a contract exists for it,
 * which is the fail-closed direction: a half-wired entity refuses rather than staging a job
 * that would write through a writer nobody chose.
 */
const ENTITY_DATA_PLANE: Partial<
  Record<
    ImportEntityType,
    {
      loadExisting(values: readonly string[], db: Firestore): Promise<ReadonlySet<string>>;
      writer(actorUid: string, db: Firestore): RowWriter;
    }
  >
> = {
  PARTS: { loadExisting: loadExistingPartIdentities, writer: firestorePartWriter },
  CUSTOMERS: { loadExisting: loadExistingCustomerIdentities, writer: firestoreCustomerWriter },
};

function requireAuth(request: { auth?: { uid: string } | null }): string {
  if (!request.auth || typeof request.auth.uid !== "string" || request.auth.uid.length === 0) {
    throw new HttpsError("unauthenticated", "Must be signed in.");
  }
  return request.auth.uid;
}

function asObject(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new HttpsError("invalid-argument", "Request data must be an object.");
  }
  return data as Record<string, unknown>;
}

/**
 * Gate 2. Refuses the production project by name, using the runtime's own identity.
 *
 * Returns the resolved project id so the job can record which environment it was staged
 * against -- a job carrying its target is what lets execution refuse one prepared elsewhere.
 */
function requireImportableTarget(): string {
  const projectId = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? null;
  try {
    assertNonProductionImportTarget(projectId);
  } catch (err) {
    if (err instanceof ImportTargetRefusedError) {
      throw new HttpsError("failed-precondition", "Data Import is not available in this environment.");
    }
    throw err;
  }
  return projectId as string;
}

/**
 * Gate 3. The governed resolver, non-transactional (nothing is being written yet).
 *
 * `activationOverrides` is required, not optional: both ids are registered active:false,
 * which the resolver denies AHEAD of any Role grant, so omitting it would make the feature
 * unreachable for every principal in every environment.
 */
async function requireCapability(db: Firestore, actorUid: string, capability: string): Promise<void> {
  const userSnap = await db.collection(USERS_COLLECTION).doc(actorUid).get();
  const assignmentsSnap = await db
    .collection(ROLE_ASSIGNMENTS_COLLECTION)
    .where("principalUid", "==", actorUid)
    .where("status", "==", "active")
    .get();

  let accessVersion = 0;
  if (userSnap.exists) {
    const av = (userSnap.data() ?? {}).accessVersion;
    if (av !== undefined && av !== null) {
      if (!isValidAccessVersionValue(av)) throw new HttpsError("permission-denied", "You are not authorized to perform this action.");
      accessVersion = av as number;
    }
  }

  const result = resolveEffectivePermission({
    permissionId: capability,
    assignments: assignmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as never[],
    roles: ROLE_CATALOG,
    currentAccessVersion: accessVersion,
    target: GLOBAL_TARGET,
    activationOverrides: resolveRuntimeCapabilityOverrides(),
  });

  if (result.decision !== "ALLOW") {
    throw new HttpsError("permission-denied", "You are not authorized to perform this action.");
  }
}

function mapError(err: unknown): HttpsError {
  if (err instanceof HttpsError) return err;
  // Intake failures are the ONE class surfaced with their own message: they describe the
  // caller's own file ("row 4 has 7 values, the header has 6") and are useless generically.
  if (err instanceof IntakeError) return new HttpsError("invalid-argument", err.message, { code: err.code });
  if (err instanceof ImportJobError) return new HttpsError("failed-precondition", err.message, { code: err.code });
  if (err instanceof ImportTargetRefusedError) {
    return new HttpsError("failed-precondition", "Data Import is not available in this environment.");
  }
  return new HttpsError("internal", "The request could not be completed.");
}

/** Job ids are embedded in per-row idempotency keys, so they use that alphabet. */
function newJobId(now: Date): string {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `IMP-${stamp}-${rand}`;
}

/**
 * Normalize the client's mapping. A client may send null (deliberately unmapped) for a
 * column; anything that is not a non-empty string becomes null rather than being trusted.
 */
function asMapping(value: unknown): ColumnMapping | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new HttpsError("invalid-argument", "mapping must be an object keyed by source column.");
  }
  const out: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
  }
  return Object.freeze(out);
}

/**
 * STAGE. Parse, detect, map, validate, preview, and persist the job. Writes NO operational
 * record: the only document it creates is the import job itself, which is the record of a
 * proposal, not of a Part.
 */
export const stageDataImportCallable = onCall(REGION, async (request) => {
  const actorUid = requireAuth(request);
  const targetProjectId = requireImportableTarget();
  const db = getFirestore();
  await requireCapability(db, actorUid, CAP_STAGE);

  try {
    const d = asObject(request.data);
    const fileName = typeof d.fileName === "string" ? d.fileName : "";
    const fileText = typeof d.fileText === "string" ? d.fileText : "";
    const fileBase64 = typeof d.fileBase64 === "string" ? d.fileBase64 : "";
    if (!fileName || (!fileText && !fileBase64)) {
      throw new HttpsError("invalid-argument", "fileName and either fileText or fileBase64 are required.");
    }

    // WHICH READER IS CHOSEN BY THE CLIENT'S ENCODING, NOT BY THE FILENAME. A .xlsx is
    // binary and arrives base64; a CSV is text. Trusting the extension to pick the reader
    // would mean a renamed file selects a parser -- and the extension is still checked
    // inside both readers, so a mismatch is refused rather than reinterpreted.
    const parsed = fileBase64
      ? parseWorkbookFile(fileName, Buffer.from(fileBase64, "base64"))
      : parseSourceFile(fileName, fileText);

    const detection = detectEntityType(parsed.columns);
    const requested = typeof d.entityType === "string" ? (d.entityType as ImportEntityType) : null;
    const entityType = requested ?? detection.entityType;
    if (!entityType) {
      throw new HttpsError("failed-precondition", "The entity could not be detected from the file. Choose one.", {
        code: "ENTITY_UNDETERMINED",
        detection,
      });
    }
    const contract = entityContractFor(entityType);
    const plane = ENTITY_DATA_PLANE[entityType];
    if (!contract || !plane) {
      // Honest refusal rather than a silent no-op: an entity without BOTH a contract and a
      // data plane would stage a job nothing can execute.
      throw new HttpsError("unimplemented", `Import for ${entityType} is not available yet.`, { code: "ENTITY_NOT_WIRED" });
    }

    const suggestions = suggestMapping(entityType, parsed);
    const provided = asMapping(d.mapping);
    const mapping: ColumnMapping =
      provided ??
      Object.freeze(Object.fromEntries(suggestions.map((s) => [s.sourceColumn, s.canonicalField])));

    const validation = validateMapping(entityType, parsed, mapping);
    if (!validation.valid) {
      // A mapping that cannot produce a Part is not a preview with errors -- there is
      // nothing to preview. Returned as data (not a job) so the UI can show the gaps.
      return {
        staged: false as const,
        entityType,
        detection,
        columns: parsed.columns,
        suggestions,
        mapping,
        validation,
      };
    }

    const rows = projectRows(parsed, mapping);
    // The identity values come from the CONTRACT's identity field, so this line does not
    // need to know which entity it is looking at.
    const existing = await plane.loadExisting(
      rows.map((r) => String(r.values[contract.identityField] ?? "")),
      db,
    );
    const preview = buildEntityPreview(entityType, rows, existing);

    const now = new Date();
    const job = stageImportJob({
      jobId: newJobId(now),
      preview,
      fileName,
      targetProjectId,
      headerSignature: headerSignature(parsed.columns),
      sourceColumns: parsed.columns,
      // Drop the nulls: a stored mapping is the record of what WAS mapped, and keeping the
      // unmapped keys would make a saved profile assert a decision about a column it ignored.
      mapping: Object.fromEntries(Object.entries(mapping).filter(([, v]) => typeof v === "string")) as Record<string, string>,
      stagedBy: actorUid,
      stagedAt: now.toISOString(),
    });
    await firestoreImportJobStore(db).put(job);

    return { staged: true as const, detection, suggestions, validation, job };
  } catch (err) {
    throw mapError(err);
  }
});

/**
 * EXECUTE. Turns an approved staged job into governed Parts.
 *
 * The drafts written are the ones the job STORED at staging -- never anything re-sent by
 * the client. That is what makes the approval an approval of a specific preview.
 */
export const executeDataImportCallable = onCall(REGION, async (request) => {
  const actorUid = requireAuth(request);
  const targetProjectId = requireImportableTarget();
  const db = getFirestore();
  await requireCapability(db, actorUid, CAP_EXECUTE);

  try {
    const d = asObject(request.data);
    const jobId = typeof d.jobId === "string" ? d.jobId : "";
    if (!jobId) throw new HttpsError("invalid-argument", "jobId is required.");
    if (d.approved !== true) {
      throw new HttpsError("failed-precondition", "The import must be explicitly approved before it can run.", {
        code: "NOT_APPROVED",
      });
    }

    const store = firestoreImportJobStore(db);
    const staged = assertExecutable(await store.get(jobId), targetProjectId);
    const claimed = beginExecution(staged, actorUid, new Date().toISOString());
    if (!(await store.claimForExecution(claimed))) {
      // Someone else claimed it between the read and the write. Refusing is correct:
      // an import that ran twice because two admins clicked at once is the exact failure
      // the stored status exists to prevent.
      throw new ImportJobError("JOB_NOT_STAGED", "This import is already running or has already run.");
    }

    const plane = ENTITY_DATA_PLANE[claimed.entityType];
    if (!plane) {
      // A job staged when an entity was wired, executed after it was un-wired. Refusing is
      // correct: the job's drafts were validated against a contract this build may no
      // longer honour, and writing them anyway would be writing on a stale promise.
      throw new ImportJobError("JOB_NOT_STAGED", `Import for ${claimed.entityType} is not available.`);
    }
    const rowResults = await executeImportJob(claimed, plane.writer(actorUid, db));
    const finished = finishExecution(claimed, rowResults);
    await store.put(finished);

    return { job: finished };
  } catch (err) {
    throw mapError(err);
  }
});

/** HISTORY. Read-only; gated on the staging capability, which is the lower of the two. */
export const listDataImportJobsCallable = onCall(REGION, async (request) => {
  const actorUid = requireAuth(request);
  requireImportableTarget();
  const db = getFirestore();
  await requireCapability(db, actorUid, CAP_STAGE);

  try {
    return { jobs: await firestoreImportJobStore(db).listRecent(HISTORY_LIMIT), limits: IMPORT_LIMITS };
  } catch (err) {
    throw mapError(err);
  }
});
