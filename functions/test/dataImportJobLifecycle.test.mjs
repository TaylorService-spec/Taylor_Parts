// EOS Data Import P1 -- the job lifecycle, execution orchestration and partId derivation.
//
// Companion to dataImportPartsPipeline.test.mjs, which covers intake/contract/preview. This
// file covers the half that decides WHEN a write may happen and WHAT is recorded about it.
//
// SEEDED SYNTHETIC DATA ONLY. Nothing here reads a fixture derived from customer records.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  stageImportJob,
  assertExecutable,
  beginExecution,
  finishExecution,
  jobImportableRows,
  ImportJobError,
  IMPORT_JOB_MODEL_VERSION,
} from "../lib/dataImport/importJob.js";
import { executeImportJob, rowIdempotencyKey } from "../lib/dataImport/importExecution.js";
import { derivePartId } from "../lib/dataImport/contracts/partImportContract.js";

const TARGET = "eos-platform-sandbox";

function previewRow(n, classification, identity = `PRT-${n}`) {
  return {
    sourceRowNumber: n,
    identity,
    classification,
    findings: [],
    draft: classification === "ERROR" ? null : { internalPartNumber: identity, name: `Part ${n}` },
  };
}

function makePreview(rows) {
  return {
    entityType: "PARTS",
    summary: {
      total: rows.length,
      ready: rows.filter((r) => r.classification === "READY").length,
      warnings: rows.filter((r) => r.classification === "WARNING").length,
      errors: rows.filter((r) => r.classification === "ERROR").length,
    },
    rows,
  };
}

function makeJob(rows) {
  return stageImportJob({
    jobId: "IMP-20260904-AAAAAA",
    preview: makePreview(rows),
    fileName: "seeded-parts.csv",
    targetProjectId: TARGET,
    headerSignature: "sig",
    sourceColumns: ["PART_NO", "DESCRIPTION"],
    mapping: { PART_NO: "internalPartNumber", DESCRIPTION: "name" },
    stagedBy: "seeded-admin",
    stagedAt: "2026-09-04T12:00:00.000Z",
  });
}

// --------------------------------------------------------------- staging

test("a staged job records the preview INCLUDING the rows that will not be written", () => {
  const job = makeJob([previewRow(2, "READY"), previewRow(3, "ERROR"), previewRow(4, "WARNING")]);

  assert.equal(job.status, "STAGED");
  assert.equal(job.modelVersion, IMPORT_JOB_MODEL_VERSION);
  assert.equal(job.approvedBy, null);
  assert.equal(job.result, null);
  // The errored row survives into the stored job. A job that kept only what it wrote
  // cannot answer "what did this file contain that we refused", which is the question.
  assert.equal(job.rows.length, 3);
  assert.equal(jobImportableRows(job).length, 2);
  assert.deepEqual(job.summary, { total: 3, ready: 1, warnings: 1, errors: 1 });
});

// --------------------------------------------------------------- executability

test("only a STAGED job is executable -- every other status is refused", () => {
  const staged = makeJob([previewRow(2, "READY")]);
  assert.equal(assertExecutable(staged, TARGET).jobId, staged.jobId);

  for (const status of ["EXECUTING", "COMPLETED", "COMPLETED_WITH_ERRORS", "FAILED"]) {
    assert.throws(
      () => assertExecutable({ ...staged, status }, TARGET),
      (err) => err instanceof ImportJobError && err.code === "JOB_NOT_STAGED",
      `${status} must not be executable`,
    );
  }
});

test("a job staged against another environment is refused HERE", () => {
  const staged = makeJob([previewRow(2, "READY")]);
  assert.throws(
    () => assertExecutable(staged, "some-other-project"),
    (err) => err instanceof ImportJobError && err.code === "JOB_TARGET_MISMATCH",
  );
});

test("a missing job and an all-errors job are DIFFERENT refusals", () => {
  assert.throws(
    () => assertExecutable(null, TARGET),
    (err) => err instanceof ImportJobError && err.code === "JOB_NOT_FOUND",
  );
  // Not "not found", and not silently a success writing zero rows: a file where every row
  // failed is a real, nameable outcome and gets its own code.
  assert.throws(
    () => assertExecutable(makeJob([previewRow(2, "ERROR")]), TARGET),
    (err) => err instanceof ImportJobError && err.code === "JOB_EMPTY",
  );
});

// --------------------------------------------------------------- execution

test("execution writes the importable rows, skips the errored one, and keys idempotency per row", async () => {
  const job = beginExecution(
    makeJob([previewRow(2, "READY"), previewRow(3, "ERROR"), previewRow(4, "WARNING")]),
    "seeded-approver",
    "2026-09-04T12:05:00.000Z",
  );
  assert.equal(job.status, "EXECUTING");
  assert.equal(job.approvedBy, "seeded-approver");

  const seen = [];
  const results = await executeImportJob(job, {
    async write(draft, key) {
      seen.push({ ipn: draft.internalPartNumber, key });
      return { kind: "created" };
    },
  });

  // Row 3 was ERROR: it is not offered to the writer at all. Not filtered by the writer --
  // never reached, which is what makes "an errored row cannot be written" structural.
  assert.deepEqual(seen.map((s) => s.ipn), ["PRT-2", "PRT-4"]);
  assert.deepEqual(seen.map((s) => s.key), [
    rowIdempotencyKey(job.jobId, 2),
    rowIdempotencyKey(job.jobId, 4),
  ]);
  assert.equal(results.length, 2);
});

test("the per-row idempotency key is accepted by the governed commands' own pattern", () => {
  // /^[A-Za-z0-9_-]{8,200}$/ -- partMasterCommands.assertIdempotencyKey. A key the command
  // rejects would turn every row of a valid file into an invalid-input failure.
  const key = rowIdempotencyKey("IMP-20260904120000-AB12CD", 4);
  assert.match(key, /^[A-Za-z0-9_-]{8,200}$/);
});

test("one row failing does not stop the rest, and a THROWN writer is a failed row not a failed run", async () => {
  const job = beginExecution(
    makeJob([previewRow(2, "READY"), previewRow(3, "READY"), previewRow(4, "READY")]),
    "seeded-approver",
    "2026-09-04T12:05:00.000Z",
  );

  const results = await executeImportJob(job, {
    async write(draft) {
      if (draft.internalPartNumber === "PRT-3") {
        return { kind: "failed", code: "ALREADY_EXISTS", message: "A Part with this identity already exists." };
      }
      if (draft.internalPartNumber === "PRT-4") throw new Error("boom");
      return { kind: "created" };
    },
  });

  assert.deepEqual(results.map((r) => r.outcome), ["created", "failed", "failed"]);
  assert.equal(results[1].failureCode, "ALREADY_EXISTS");
  assert.equal(results[2].failureCode, "UNEXPECTED");

  const finished = finishExecution(job, results);
  // A spreadsheet is not a transaction: the good row stays written and the outcome says so.
  assert.equal(finished.status, "COMPLETED_WITH_ERRORS");
  assert.deepEqual(
    { created: finished.result.created, replayed: finished.result.replayed, failed: finished.result.failed },
    { created: 1, replayed: 0, failed: 2 },
  );
});

test("a replay is counted as a replay, never as a create", async () => {
  const job = beginExecution(makeJob([previewRow(2, "READY")]), "a", "2026-09-04T12:05:00.000Z");
  const results = await executeImportJob(job, { async write() { return { kind: "replayed" }; } });
  const finished = finishExecution(job, results);

  assert.equal(finished.status, "COMPLETED");
  // Reporting a replay as a create would make the history assert that the second run wrote
  // records it did not write.
  assert.equal(finished.result.created, 0);
  assert.equal(finished.result.replayed, 1);
});

test("everything attempted and nothing written is FAILED, not a partial import", () => {
  const job = beginExecution(makeJob([previewRow(2, "READY"), previewRow(3, "READY")]), "a", "t");
  const finished = finishExecution(job, [
    { sourceRowNumber: 2, identity: "PRT-2", outcome: "failed", failureCode: "INVALID", failureMessage: "x" },
    { sourceRowNumber: 3, identity: "PRT-3", outcome: "failed", failureCode: "INVALID", failureMessage: "x" },
  ]);
  assert.equal(finished.status, "FAILED");
});

// --------------------------------------------------------------- partId derivation

test("an id-shaped Internal Part Number becomes its own partId, unchanged and readable", () => {
  assert.equal(derivePartId("TST-1001"), "TST-1001");
  assert.equal(derivePartId("  tst-1001 "), "TST-1001");
  assert.match(derivePartId("TST-1001"), /^[A-Za-z0-9_-]{1,64}$/);
});

test("derivation is deterministic -- the SAME IPN always yields the same id", () => {
  // This is the whole duplicate defence: a re-import lands on the same document id, and
  // the governed command's own already-exists check refuses it. If derivation drifted,
  // re-importing a file would silently create a second Part for one part number.
  assert.equal(derivePartId("VALVE/ASM 12"), derivePartId("VALVE/ASM 12"));
});

test("two DIFFERENT IPNs that sanitize alike do NOT collide", () => {
  // "A/B" and "A-B" both flatten to "A-B"; the digest of the original keeps them apart.
  const a = derivePartId("A/B");
  const b = derivePartId("A-B");
  assert.notEqual(a, b);
  for (const id of [a, b]) assert.match(id, /^[A-Za-z0-9_-]{1,64}$/);
});

test("a long or hostile IPN still yields a legal partId", () => {
  for (const ipn of ["X".repeat(200), "!!!", "  a  b  ", "../../etc/passwd"]) {
    assert.match(derivePartId(ipn), /^[A-Za-z0-9_-]{1,64}$/, `derived id for ${JSON.stringify(ipn)}`);
  }
});

// --------------------------------------------------------------- portability

test("the job model and the execution orchestrator stay on the portable side", () => {
  for (const f of ["../src/dataImport/importJob.ts", "../src/dataImport/importExecution.ts"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    assert.ok(!/from\s+["'][^"']*firebase-admin/.test(src), `${f} must not import firebase-admin`);
    assert.ok(!/\.collection\(/.test(src), `${f} must not name a Firestore collection`);
    // Nor may it name the command that writes. Execution asks an injected writer; the
    // moment it imports one, the data plane is no longer swappable.
    assert.ok(!/partMaster/.test(src), `${f} must not reach for a specific write command`);
  }
});
