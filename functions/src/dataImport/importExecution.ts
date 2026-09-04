// EOS Data Import -- portable execution orchestrator.
//
// PORTABILITY BOUNDARY. Pure: no firebase-admin, no Firestore, no knowledge of which
// command writes a Part. It walks the approved rows, asks an INJECTED writer to create
// each one, and turns what comes back into the per-row record the job stores.
//
// THE INJECTED WRITER IS THE WHOLE POINT. This module cannot write, and cannot be made to
// write by editing it: whatever authority exists lives in the function passed in. In the
// Firestore data plane that function calls the SAME governed command a human uses
// (partMaster's createPart), which is what makes "import creates no privileged path" true
// by construction rather than by review. A customer-hosted data plane injects its own
// writer and every rule below -- ordering, isolation, idempotency keying, partial-failure
// accounting -- applies unchanged.
//
// ONE ROW AT A TIME, AND ONE FAILURE DOES NOT STOP THE REST. A spreadsheet is not a
// transaction. The admin who approved 400 rows wants the 397 good ones written and the 3
// bad ones named, not all 400 rolled back because one had a bad unit -- and a governed
// create is already atomic per Part, so there is no half-written record to leave behind.

import type { ImportJob, RowResult } from "./importJob.js";
import { jobImportableRows } from "./importJob.js";

/**
 * What the injected writer reports.
 *
 * `replayed` is distinct from `created` on purpose: a re-run that lands on an existing
 * idempotency record wrote nothing this time, and reporting it as a create would make the
 * numbers in the history lie about what the second run did.
 */
export type WriteOutcome =
  | { readonly kind: "created" }
  | { readonly kind: "replayed" }
  | { readonly kind: "failed"; readonly code: string; readonly message: string };

export interface RowWriter {
  /**
   * Create ONE record from a canonical draft.
   *
   * `idempotencyKey` is supplied by this module and is stable for (job, row), so a retry
   * of the same job row is recognisable to the underlying command. Implementations must
   * not invent their own.
   *
   * Must not throw for an expected domain refusal -- return `failed` with a code. A thrown
   * error is treated as an unexpected fault and still recorded rather than aborting the run.
   */
  write(draft: Readonly<Record<string, unknown>>, idempotencyKey: string): Promise<WriteOutcome>;
}

/**
 * Stable per (job, row). Deterministic so a retry keys identically.
 *
 * Hyphen-separated, not colon-separated: the governed commands accept idempotency keys
 * matching /^[A-Za-z0-9_-]{8,200}$/, and a key the command rejects would turn every row
 * into an invalid-input failure.
 */
export function rowIdempotencyKey(jobId: string, sourceRowNumber: number): string {
  return `dataImport-${jobId}-${sourceRowNumber}`;
}

export async function executeImportJob(job: ImportJob, writer: RowWriter): Promise<readonly RowResult[]> {
  const results: RowResult[] = [];

  for (const row of jobImportableRows(job)) {
    const key = rowIdempotencyKey(job.jobId, row.sourceRowNumber);
    let outcome: WriteOutcome;
    try {
      outcome = await writer.write(row.draft as Readonly<Record<string, unknown>>, key);
    } catch (err) {
      // An unexpected fault is a failed ROW, not a failed run. Swallowing it would hide a
      // gap in the import; aborting on it would discard the rows that already succeeded.
      outcome = {
        kind: "failed",
        code: "UNEXPECTED",
        message: err instanceof Error ? err.message : "The record could not be written.",
      };
    }

    results.push(
      Object.freeze(
        outcome.kind === "failed"
          ? {
              sourceRowNumber: row.sourceRowNumber,
              identity: row.identity,
              outcome: "failed" as const,
              failureCode: outcome.code,
              failureMessage: outcome.message,
            }
          : { sourceRowNumber: row.sourceRowNumber, identity: row.identity, outcome: outcome.kind },
      ),
    );
  }

  return Object.freeze(results);
}
