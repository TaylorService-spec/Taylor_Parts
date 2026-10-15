"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.rowIdempotencyKey = rowIdempotencyKey;
exports.executeImportJob = executeImportJob;
const importJob_js_1 = require("./importJob.js");
/**
 * Stable per (job, row). Deterministic so a retry keys identically.
 *
 * Hyphen-separated, not colon-separated: the governed commands accept idempotency keys
 * matching /^[A-Za-z0-9_-]{8,200}$/, and a key the command rejects would turn every row
 * into an invalid-input failure.
 */
function rowIdempotencyKey(jobId, sourceRowNumber) {
    return `dataImport-${jobId}-${sourceRowNumber}`;
}
async function executeImportJob(job, writer) {
    const results = [];
    for (const row of (0, importJob_js_1.jobImportableRows)(job)) {
        const key = rowIdempotencyKey(job.jobId, row.sourceRowNumber);
        let outcome;
        try {
            outcome = await writer.write(row.draft, key);
        }
        catch (err) {
            // An unexpected fault is a failed ROW, not a failed run. Swallowing it would hide a
            // gap in the import; aborting on it would discard the rows that already succeeded.
            outcome = {
                kind: "failed",
                code: "UNEXPECTED",
                message: err instanceof Error ? err.message : "The record could not be written.",
            };
        }
        results.push(Object.freeze(outcome.kind === "failed"
            ? {
                sourceRowNumber: row.sourceRowNumber,
                identity: row.identity,
                outcome: "failed",
                failureCode: outcome.code,
                failureMessage: outcome.message,
            }
            : { sourceRowNumber: row.sourceRowNumber, identity: row.identity, outcome: outcome.kind }));
    }
    return Object.freeze(results);
}
//# sourceMappingURL=importExecution.js.map