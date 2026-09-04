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

import type { ImportEntityType } from "./importIntake.js";
import type { ImportPreview, PreviewRow } from "./importPreview.js";

export const IMPORT_JOB_MODEL_VERSION = 1;

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
export const IMPORT_JOB_STATUSES = [
  "STAGED",
  "EXECUTING",
  "COMPLETED",
  "COMPLETED_WITH_ERRORS",
  "FAILED",
] as const;
export type ImportJobStatus = (typeof IMPORT_JOB_STATUSES)[number];

export type ImportJobErrorCode =
  | "JOB_NOT_FOUND"
  | "JOB_NOT_STAGED"
  | "JOB_EMPTY"
  | "JOB_TARGET_MISMATCH";

export class ImportJobError extends Error {
  constructor(
    readonly code: ImportJobErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ImportJobError";
  }
}

/** What one row's execution did. Recorded per row so a partial import is legible. */
export interface RowResult {
  readonly sourceRowNumber: number;
  readonly identity: string | null;
  readonly outcome: "created" | "replayed" | "failed";
  /** Present only on `failed`. A stable code, never an internal message. */
  readonly failureCode?: string;
  readonly failureMessage?: string;
}

export interface ImportJobResult {
  readonly created: number;
  readonly replayed: number;
  readonly failed: number;
  readonly rows: readonly RowResult[];
}

export interface ImportJob {
  readonly jobId: string;
  readonly modelVersion: number;
  readonly entityType: ImportEntityType;
  readonly status: ImportJobStatus;
  readonly fileName: string;
  /** The environment this job was staged against. Execution refuses a different one. */
  readonly targetProjectId: string;
  readonly headerSignature: string;
  readonly sourceColumns: readonly string[];
  readonly mapping: Readonly<Record<string, string>>;
  readonly summary: ImportPreview["summary"];
  /**
   * Every previewed row, INCLUDING the errored ones.
   *
   * Errors are stored rather than filtered out because "the file had 6 rows and 3 were
   * rejected, for these reasons" is the fact an admin needs afterwards, and a job that
   * kept only what it wrote cannot answer it.
   */
  readonly rows: readonly PreviewRow[];
  readonly stagedBy: string;
  readonly stagedAt: string;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly result: ImportJobResult | null;
}

/** The rows a staged job would write. Mirrors importableRows over the STORED preview. */
export function jobImportableRows(job: ImportJob): readonly PreviewRow[] {
  return job.rows.filter((r) => r.classification !== "ERROR" && r.draft !== null);
}

export interface StageJobInput {
  readonly jobId: string;
  readonly preview: ImportPreview;
  readonly fileName: string;
  readonly targetProjectId: string;
  readonly headerSignature: string;
  readonly sourceColumns: readonly string[];
  readonly mapping: Readonly<Record<string, string>>;
  readonly stagedBy: string;
  readonly stagedAt: string;
}

export function stageImportJob(input: StageJobInput): ImportJob {
  return Object.freeze({
    jobId: input.jobId,
    modelVersion: IMPORT_JOB_MODEL_VERSION,
    entityType: input.preview.entityType,
    status: "STAGED" as const,
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
export function assertExecutable(job: ImportJob | null, targetProjectId: string): ImportJob {
  if (!job) throw new ImportJobError("JOB_NOT_FOUND", "No such import job.");
  if (job.status !== "STAGED") {
    throw new ImportJobError(
      "JOB_NOT_STAGED",
      `This import is ${job.status.toLowerCase().replace(/_/g, " ")} and cannot be run again.`,
    );
  }
  if (job.targetProjectId !== targetProjectId) {
    throw new ImportJobError(
      "JOB_TARGET_MISMATCH",
      "This import was prepared against a different environment and will not be run here.",
    );
  }
  if (jobImportableRows(job).length === 0) {
    throw new ImportJobError("JOB_EMPTY", "This import has no rows that can be written.");
  }
  return job;
}

/** Approval and the move to EXECUTING, as ONE transition -- see the header's reason 1. */
export function beginExecution(job: ImportJob, approvedBy: string, approvedAt: string): ImportJob {
  return Object.freeze({ ...job, status: "EXECUTING" as const, approvedBy, approvedAt });
}

export function finishExecution(job: ImportJob, rows: readonly RowResult[]): ImportJob {
  const created = rows.filter((r) => r.outcome === "created").length;
  const replayed = rows.filter((r) => r.outcome === "replayed").length;
  const failed = rows.filter((r) => r.outcome === "failed").length;
  // Everything attempted and nothing written is a FAILED import, not a partial one.
  const status: ImportJobStatus =
    failed === 0 ? "COMPLETED" : created + replayed === 0 ? "FAILED" : "COMPLETED_WITH_ERRORS";
  return Object.freeze({
    ...job,
    status,
    result: Object.freeze({ created, replayed, failed, rows: Object.freeze([...rows]) }),
  });
}
