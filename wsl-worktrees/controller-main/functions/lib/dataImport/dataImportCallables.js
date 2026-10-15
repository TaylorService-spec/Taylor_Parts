"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.listImportedServiceHistoryCallable = exports.listDataImportJobsCallable = exports.executeDataImportCallable = exports.stageDataImportCallable = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const resolveEffectivePermission_js_1 = require("../access/resolveEffectivePermission.js");
const environmentCapabilityOverrides_js_1 = require("../access/environmentCapabilityOverrides.js");
const compatibilityRoles_js_1 = require("../access/compatibilityRoles.js");
const governedBusinessRoles_js_1 = require("../access/governedBusinessRoles.js");
const compactClaims_js_1 = require("../access/compactClaims.js");
const importTargetGuard_js_1 = require("./importTargetGuard.js");
const importIntake_js_1 = require("./importIntake.js");
const importPreview_js_1 = require("./importPreview.js");
const importJob_js_1 = require("./importJob.js");
const importExecution_js_1 = require("./importExecution.js");
const firestoreDataImportAdapters_js_1 = require("./firestoreDataImportAdapters.js");
const entityContract_js_1 = require("./contracts/entityContract.js");
const firestoreInventoryImportAdapters_js_1 = require("./firestoreInventoryImportAdapters.js");
const firestoreServiceHistoryAdapters_js_1 = require("./firestoreServiceHistoryAdapters.js");
const importedServiceHistoryReadService_js_1 = require("./importedServiceHistoryReadService.js");
const crmWriterState_js_1 = require("../crm/crmWriterState.js");
const REGION = { region: "us-central1" };
const CAP_STAGE = "admin.dataImport.stage";
const CAP_EXECUTE = "admin.dataImport.execute";
const USERS_COLLECTION = "users";
const ROLE_ASSIGNMENTS_COLLECTION = "roleAssignments";
const GLOBAL_TARGET = { scope: { type: "global" }, condition: {} };
const ROLE_CATALOG = { ...compatibilityRoles_js_1.COMPATIBILITY_ROLES, ...governedBusinessRoles_js_1.GOVERNED_BUSINESS_ROLES };
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
const ENTITY_DATA_PLANE = {
    PARTS: { loadExisting: firestoreDataImportAdapters_js_1.loadExistingPartIdentities, writer: firestoreDataImportAdapters_js_1.firestorePartWriter },
    CUSTOMERS: { loadExisting: firestoreDataImportAdapters_js_1.loadExistingCustomerIdentities, writer: firestoreDataImportAdapters_js_1.firestoreCustomerWriter },
    EQUIPMENT: {
        loadExisting: firestoreDataImportAdapters_js_1.loadExistingEquipmentSerials,
        loadReferences: firestoreDataImportAdapters_js_1.loadEquipmentReferences,
        writer: firestoreDataImportAdapters_js_1.firestoreEquipmentWriter,
    },
    INVENTORY: {
        loadExisting: firestoreInventoryImportAdapters_js_1.loadExistingOpeningBalances,
        loadReferences: firestoreInventoryImportAdapters_js_1.loadInventoryReferences,
        // The ONLY writer that needs the job id: an opening balance's ledger movement records
        // which import produced it, so a movement can be traced back to the file and the
        // approval that authorized it.
        writer: (actorUid, db, jobId) => (0, firestoreInventoryImportAdapters_js_1.firestoreOpeningBalanceWriter)(actorUid, db, jobId),
    },
    SERVICE_HISTORY: {
        loadExisting: firestoreServiceHistoryAdapters_js_1.loadExistingServiceHistoryIdentities,
        loadReferences: firestoreServiceHistoryAdapters_js_1.loadServiceHistoryReferences,
        writer: (actorUid, db, jobId) => (0, firestoreServiceHistoryAdapters_js_1.firestoreServiceHistoryWriter)(actorUid, db, jobId),
    },
};
function requireAuth(request) {
    if (!request.auth || typeof request.auth.uid !== "string" || request.auth.uid.length === 0) {
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    }
    return request.auth.uid;
}
function asObject(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new https_1.HttpsError("invalid-argument", "Request data must be an object.");
    }
    return data;
}
/**
 * Gate 2. Refuses the production project by name, using the runtime's own identity.
 *
 * Returns the resolved project id so the job can record which environment it was staged
 * against -- a job carrying its target is what lets execution refuse one prepared elsewhere.
 */
function requireImportableTarget() {
    const projectId = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? null;
    try {
        (0, importTargetGuard_js_1.assertNonProductionImportTarget)(projectId);
    }
    catch (err) {
        if (err instanceof importTargetGuard_js_1.ImportTargetRefusedError) {
            throw new https_1.HttpsError("failed-precondition", "Data Import is not available in this environment.");
        }
        throw err;
    }
    return projectId;
}
/**
 * Gate 3. The governed resolver, non-transactional (nothing is being written yet).
 *
 * `activationOverrides` is required, not optional: both ids are registered active:false,
 * which the resolver denies AHEAD of any Role grant, so omitting it would make the feature
 * unreachable for every principal in every environment.
 */
async function requireCapability(db, actorUid, capability) {
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
            if (!(0, compactClaims_js_1.isValidAccessVersionValue)(av))
                throw new https_1.HttpsError("permission-denied", "You are not authorized to perform this action.");
            accessVersion = av;
        }
    }
    const result = (0, resolveEffectivePermission_js_1.resolveEffectivePermission)({
        permissionId: capability,
        assignments: assignmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        roles: ROLE_CATALOG,
        currentAccessVersion: accessVersion,
        target: GLOBAL_TARGET,
        activationOverrides: (0, environmentCapabilityOverrides_js_1.resolveRuntimeCapabilityOverrides)(),
    });
    if (result.decision !== "ALLOW") {
        throw new https_1.HttpsError("permission-denied", "You are not authorized to perform this action.");
    }
}
function mapError(err) {
    if (err instanceof https_1.HttpsError)
        return err;
    // Intake failures are the ONE class surfaced with their own message: they describe the
    // caller's own file ("row 4 has 7 values, the header has 6") and are useless generically.
    if (err instanceof importIntake_js_1.IntakeError)
        return new https_1.HttpsError("invalid-argument", err.message, { code: err.code });
    if (err instanceof importJob_js_1.ImportJobError)
        return new https_1.HttpsError("failed-precondition", err.message, { code: err.code });
    if (err instanceof crmWriterState_js_1.FirestoreCrmWriterClosedError)
        return new https_1.HttpsError("failed-precondition", err.message, { code: err.code });
    if (err instanceof importTargetGuard_js_1.ImportTargetRefusedError) {
        return new https_1.HttpsError("failed-precondition", "Data Import is not available in this environment.");
    }
    return new https_1.HttpsError("internal", "The request could not be completed.");
}
/** Job ids are embedded in per-row idempotency keys, so they use that alphabet. */
function newJobId(now) {
    const stamp = now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `IMP-${stamp}-${rand}`;
}
/**
 * Normalize the client's mapping. A client may send null (deliberately unmapped) for a
 * column; anything that is not a non-empty string becomes null rather than being trusted.
 */
function asMapping(value) {
    if (value === undefined || value === null)
        return null;
    if (typeof value !== "object" || Array.isArray(value)) {
        throw new https_1.HttpsError("invalid-argument", "mapping must be an object keyed by source column.");
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) {
        out[k] = typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
    }
    return Object.freeze(out);
}
/**
 * STAGE. Parse, detect, map, validate, preview, and persist the job. Writes NO operational
 * record: the only document it creates is the import job itself, which is the record of a
 * proposal, not of a Part.
 */
exports.stageDataImportCallable = (0, https_1.onCall)(REGION, async (request) => {
    const actorUid = requireAuth(request);
    const targetProjectId = requireImportableTarget();
    const db = (0, firestore_1.getFirestore)();
    await requireCapability(db, actorUid, CAP_STAGE);
    try {
        const d = asObject(request.data);
        const fileName = typeof d.fileName === "string" ? d.fileName : "";
        const fileText = typeof d.fileText === "string" ? d.fileText : "";
        const fileBase64 = typeof d.fileBase64 === "string" ? d.fileBase64 : "";
        if (!fileName || (!fileText && !fileBase64)) {
            throw new https_1.HttpsError("invalid-argument", "fileName and either fileText or fileBase64 are required.");
        }
        // WHICH READER IS CHOSEN BY THE CLIENT'S ENCODING, NOT BY THE FILENAME. A .xlsx is
        // binary and arrives base64; a CSV is text. Trusting the extension to pick the reader
        // would mean a renamed file selects a parser -- and the extension is still checked
        // inside both readers, so a mismatch is refused rather than reinterpreted.
        const parsed = fileBase64
            ? (0, importIntake_js_1.parseWorkbookFile)(fileName, Buffer.from(fileBase64, "base64"))
            : (0, importIntake_js_1.parseSourceFile)(fileName, fileText);
        const detection = (0, importIntake_js_1.detectEntityType)(parsed.columns);
        const requested = typeof d.entityType === "string" ? d.entityType : null;
        const entityType = requested ?? detection.entityType;
        if (!entityType) {
            throw new https_1.HttpsError("failed-precondition", "The entity could not be detected from the file. Choose one.", {
                code: "ENTITY_UNDETERMINED",
                detection,
            });
        }
        const contract = (0, entityContract_js_1.entityContractFor)(entityType);
        const plane = ENTITY_DATA_PLANE[entityType];
        if (!contract || !plane) {
            // Honest refusal rather than a silent no-op: an entity without BOTH a contract and a
            // data plane would stage a job nothing can execute.
            throw new https_1.HttpsError("unimplemented", `Import for ${entityType} is not available yet.`, { code: "ENTITY_NOT_WIRED" });
        }
        const suggestions = (0, importIntake_js_1.suggestMapping)(entityType, parsed);
        const provided = asMapping(d.mapping);
        const mapping = provided ??
            Object.freeze(Object.fromEntries(suggestions.map((s) => [s.sourceColumn, s.canonicalField])));
        const validation = (0, importIntake_js_1.validateMapping)(entityType, parsed, mapping);
        if (!validation.valid) {
            // A mapping that cannot produce a Part is not a preview with errors -- there is
            // nothing to preview. Returned as data (not a job) so the UI can show the gaps.
            return {
                staged: false,
                entityType,
                detection,
                columns: parsed.columns,
                suggestions,
                mapping,
                validation,
            };
        }
        const rows = (0, importIntake_js_1.projectRows)(parsed, mapping);
        // The identity values come from the CONTRACT's identity field, so this line does not
        // need to know which entity it is looking at.
        const existing = await plane.loadExisting(rows.map((r) => String(r.values[contract.identityField] ?? "")), db);
        // References are loaded only for an entity that declares them, so an entity with no
        // foreign keys pays nothing for the ones that have them.
        const references = plane.loadReferences ? await plane.loadReferences(db) : undefined;
        const preview = (0, importPreview_js_1.buildEntityPreview)(entityType, rows, { existing, references });
        const now = new Date();
        const job = (0, importJob_js_1.stageImportJob)({
            jobId: newJobId(now),
            preview,
            fileName,
            targetProjectId,
            headerSignature: (0, importIntake_js_1.headerSignature)(parsed.columns),
            sourceColumns: parsed.columns,
            // Drop the nulls: a stored mapping is the record of what WAS mapped, and keeping the
            // unmapped keys would make a saved profile assert a decision about a column it ignored.
            mapping: Object.fromEntries(Object.entries(mapping).filter(([, v]) => typeof v === "string")),
            stagedBy: actorUid,
            stagedAt: now.toISOString(),
        });
        await (0, firestoreDataImportAdapters_js_1.firestoreImportJobStore)(db).put(job);
        return { staged: true, detection, suggestions, validation, job };
    }
    catch (err) {
        throw mapError(err);
    }
});
/**
 * EXECUTE. Turns an approved staged job into governed Parts.
 *
 * The drafts written are the ones the job STORED at staging -- never anything re-sent by
 * the client. That is what makes the approval an approval of a specific preview.
 */
exports.executeDataImportCallable = (0, https_1.onCall)(REGION, async (request) => {
    const actorUid = requireAuth(request);
    const targetProjectId = requireImportableTarget();
    const db = (0, firestore_1.getFirestore)();
    await requireCapability(db, actorUid, CAP_EXECUTE);
    try {
        const d = asObject(request.data);
        const jobId = typeof d.jobId === "string" ? d.jobId : "";
        if (!jobId)
            throw new https_1.HttpsError("invalid-argument", "jobId is required.");
        if (d.approved !== true) {
            throw new https_1.HttpsError("failed-precondition", "The import must be explicitly approved before it can run.", {
                code: "NOT_APPROVED",
            });
        }
        const store = (0, firestoreDataImportAdapters_js_1.firestoreImportJobStore)(db);
        const staged = (0, importJob_js_1.assertExecutable)(await store.get(jobId), targetProjectId);
        // CRM cutover writer freeze: a customer import honours the freeze as a WHOLE, before the job is claimed and before
        // any row is written; a frozen CRM refuses the job rather than failing row by row (crm/crmWriterState.ts).
        if (staged.entityType === "CUSTOMERS")
            (0, crmWriterState_js_1.assertFirestoreCrmWriterOpen)("account.import");
        const claimed = (0, importJob_js_1.beginExecution)(staged, actorUid, new Date().toISOString());
        if (!(await store.claimForExecution(claimed))) {
            // Someone else claimed it between the read and the write. Refusing is correct:
            // an import that ran twice because two admins clicked at once is the exact failure
            // the stored status exists to prevent.
            throw new importJob_js_1.ImportJobError("JOB_NOT_STAGED", "This import is already running or has already run.");
        }
        const plane = ENTITY_DATA_PLANE[claimed.entityType];
        if (!plane) {
            // A job staged when an entity was wired, executed after it was un-wired. Refusing is
            // correct: the job's drafts were validated against a contract this build may no
            // longer honour, and writing them anyway would be writing on a stale promise.
            throw new importJob_js_1.ImportJobError("JOB_NOT_STAGED", `Import for ${claimed.entityType} is not available.`);
        }
        const rowResults = await (0, importExecution_js_1.executeImportJob)(claimed, plane.writer(actorUid, db, claimed.jobId));
        const finished = (0, importJob_js_1.finishExecution)(claimed, rowResults);
        await store.put(finished);
        return { job: finished };
    }
    catch (err) {
        throw mapError(err);
    }
});
/** HISTORY. Read-only; gated on the staging capability, which is the lower of the two. */
exports.listDataImportJobsCallable = (0, https_1.onCall)(REGION, async (request) => {
    const actorUid = requireAuth(request);
    requireImportableTarget();
    const db = (0, firestore_1.getFirestore)();
    await requireCapability(db, actorUid, CAP_STAGE);
    try {
        return { jobs: await (0, firestoreDataImportAdapters_js_1.firestoreImportJobStore)(db).listRecent(HISTORY_LIMIT), limits: importIntake_js_1.IMPORT_LIMITS };
    }
    catch (err) {
        throw mapError(err);
    }
});
/**
 * READ imported historical service for one customer.
 *
 * NOT gated on the import capabilities, and that is the point. Loading data and reading a
 * customer's history afterwards are different acts: gating the read on `admin.dataImport.*`
 * would make imported history visible only to whoever imported it, which is not what a
 * customer's service history is for.
 *
 * NOR is it gated on the import target guard. The other three callables refuse outside the
 * sandbox because IMPORTING is a sandbox-only act; READING records that already exist is not.
 * A record that somehow existed elsewhere should still be readable by someone entitled to see
 * the customer -- refusing would hide data rather than protect it.
 */
exports.listImportedServiceHistoryCallable = (0, https_1.onCall)(REGION, async (request) => {
    const actorUid = requireAuth(request);
    const db = (0, firestore_1.getFirestore)();
    try {
        const d = asObject(request.data);
        const accountId = typeof d.accountId === "string" ? d.accountId : "";
        if (!accountId)
            throw new https_1.HttpsError("invalid-argument", "accountId is required.");
        const limit = typeof d.limit === "number" ? d.limit : undefined;
        return await (0, importedServiceHistoryReadService_js_1.listImportedServiceHistory)(actorUid, accountId, limit, db);
    }
    catch (err) {
        if (err instanceof importedServiceHistoryReadService_js_1.ImportedServiceHistoryReadError) {
            throw err.code === "UNAUTHORIZED"
                ? new https_1.HttpsError("permission-denied", "You are not authorized to perform this action.")
                : new https_1.HttpsError("invalid-argument", "The request is missing or has invalid fields.");
        }
        throw mapError(err);
    }
});
//# sourceMappingURL=dataImportCallables.js.map