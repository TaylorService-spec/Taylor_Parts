"use strict";
// EOS Data Import -- portable import-job model.
//
// PORTABILITY BOUNDARY. Pure: no firebase-admin, no Firestore. An import job is a
// governed record of a decision -- what file, what mapping, what the preview said, who
// approved it, and what actually happened -- and none of that is storage-shaped.
// importJobStore.ts is the Firestore implementation of persisting it; a customer-hosted
// data plane would supply a different one and reuse everything here unchanged.
//
// WHY A PERSISTED JOB AT ALL, rather than a single upload-and-write callable. Three
// reasons, and only the third is about history:
//
//   1. APPROVAL IS A SEPARATE ACT FROM STAGING. The brief requires an explicit admin
//      approval between the preview and the write. An approval that travels in the same
//      request as the data is not an approval of anything -- it is a flag. Staging the
//      job first is what makes "the admin approved THIS preview" a checkable claim: the
//      execute request names a job id, and the drafts it executes are the ones that were
//      previewed, not whatever the client re-sends.
//   2. IT MAKES REPLAY SAFE. Status is the guard: only a STAGED job may execute, and the
//      transition to EXECUTING is what a retry collides with. Without a stored job the
//      only defence against a double-click is the per-row idempotency key, which is a
//      good second line and a poor first one.
//   3. HISTORY. Which is genuinely required, and is a consequence of the first two rather
//      than a reason to build something separate.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImportJobError = exports.IMPORT_JOB_STATUSES = exports.IMPORT_JOB_MODEL_VERSION = void 0;
exports.jobImportableRows = jobImportableRows;
exports.stageImportJob = stageImportJob;
exports.assertExecutable = assertExecutable;
exports.beginExecution = beginExecution;
exports.finishExecution = finishExecution;
exports.IMPORT_JOB_MODEL_VERSION = 1;
/**
 * Job lifecycle.
 *
 * STAGED                  the file is parsed, mapped, validated and previewed. NOTHING
 *                         has been written. This is the only status that may execute.
 * EXECUTING               execution has begun. Not a resting state: a job found here on a
 *                         later read either finished and failed to record it, or the
 *                         runtime died mid-import. Either way it must NOT re-execute --
 *                         see assertExecutable, which refuses it.
 * COMPLETED               every importable row was written.
 * COMPLETED_WITH_ERRORS   some rows were written and some were not. A real outcome, not a
 *                         failure: a partial import that reports honestly is better than
 *                         one that rolls back work the admin wanted.
 * FAILED                  execution wrote nothing.
 */
exports.IMPORT_JOB_STATUSES = [
    "STAGED",
    "EXECUTING",
    "COMPLETED",
    "COMPLETED_WITH_ERRORS",
    "FAILED",
];
class ImportJobError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "ImportJobError";
    }
}
exports.ImportJobError = ImportJobError;
/** The rows a staged job would write. Mirrors importableRows over the STORED preview. */
function jobImportableRows(job) {
    return job.rows.filter((r) => r.classification !== "ERROR" && r.draft !== null);
}
function stageImportJob(input) {
    return Object.freeze({
        jobId: input.jobId,
        modelVersion: exports.IMPORT_JOB_MODEL_VERSION,
        entityType: input.preview.entityType,
        status: "STAGED",
        fileName: input.fileName,
        targetProjectId: input.targetProjectId,
        headerSignature: input.headerSignature,
        sourceColumns: Object.freeze([...input.sourceColumns]),
        mapping: Object.freeze({ ...input.mapping }),
        summary: input.preview.summary,
        rows: input.preview.rows,
        stagedBy: input.stagedBy,
        stagedAt: input.stagedAt,
        approvedBy: null,
        approvedAt: null,
        result: null,
    });
}
/**
 * May this job execute, here, now?
 *
 * Fail-closed, and deliberately unforgiving about EXECUTING. A job in that state is either
 * finished-but-unrecorded or dead mid-run, and this module cannot tell which. Re-running it
 * would be safe ONLY if every row's idempotency held; treating that as a reason to allow it
 * would promote the per-row key from backstop to primary guard. An operator can stage the
 * same file again -- and the already-exists rule will then correctly reject every row that
 * did land, which is the honest way to find out what happened.
 */
function assertExecutable(job, targetProjectId) {
    if (!job)
        throw new ImportJobError("JOB_NOT_FOUND", "No such import job.");
    if (job.status !== "STAGED") {
        throw new ImportJobError("JOB_NOT_STAGED", `This import is ${job.status.toLowerCase().replace(/_/g, " ")} and cannot be run again.`);
    }
    if (job.targetProjectId !== targetProjectId) {
        throw new ImportJobError("JOB_TARGET_MISMATCH", "This import was prepared against a different environment and will not be run here.");
    }
    if (jobImportableRows(job).length === 0) {
        throw new ImportJobError("JOB_EMPTY", "This import has no rows that can be written.");
    }
    return job;
}
/** Approval and the move to EXECUTING, as ONE transition -- see the header's reason 1. */
function beginExecution(job, approvedBy, approvedAt) {
    return Object.freeze({ ...job, status: "EXECUTING", approvedBy, approvedAt });
}
function finishExecution(job, rows) {
    const created = rows.filter((r) => r.outcome === "created").length;
    const replayed = rows.filter((r) => r.outcome === "replayed").length;
    const failed = rows.filter((r) => r.outcome === "failed").length;
    // Everything attempted and nothing written is a FAILED import, not a partial one.
    const status = failed === 0 ? "COMPLETED" : created + replayed === 0 ? "FAILED" : "COMPLETED_WITH_ERRORS";
    return Object.freeze({
        ...job,
        status,
        result: Object.freeze({ created, replayed, failed, rows: Object.freeze([...rows]) }),
    });
}
//# sourceMappingURL=importJob.js.map