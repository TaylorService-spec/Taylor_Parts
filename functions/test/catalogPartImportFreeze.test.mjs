// THE JOB-LEVEL PART IMPORT GATE under the governed catalog freeze (Controller ruling 2026-09-28, freeze fix cycle,
// ruling 4). Ported unchanged from the catalog lane: a frozen catalog refuses a PARTS import BEFORE the job is claimed
// and before any row is written -- never a job that runs and fails row by row.
//
// Offline and dependency-light: the ORDER is proven on the executable source, the REFUSAL on the real guard and the
// real callable error mapper. The emulator end-to-end proof (no job claimed, no Part written) is in
// dataImportEndToEndEmulator.test.mjs.
//
// Prerequisite: `npm run build` in functions/ (imports lib/).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const writerState = require("../lib/catalogMaster/catalogWriterState.js");
const { mapError } = require("../lib/dataImport/dataImportCallables.js");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

test("the PARTS job gate precedes the job claim and every row write", () => {
  const src = strip(readFileSync("src/dataImport/dataImportCallables.ts", "utf8"));
  const gate = src.indexOf('if (staged.entityType === "PARTS") assertFirestoreCatalogWriterOpen("part.import")');
  const claim = src.indexOf("beginExecution(staged");
  const rows = src.indexOf("executeImportJob(claimed");
  assert.ok(gate > 0, "the PARTS job gate must exist in executable code");
  assert.ok(claim > 0 && rows > 0, "precondition: the claim and the row writer are both present");
  assert.ok(gate < claim, "the refusal must precede the claim, or a frozen catalog burns the job id");
  assert.ok(gate < rows, "and must precede any row write");
});

test("part.import is a registered writer, and under the committed FROZEN state the gate refuses by its own id", () => {
  assert.ok(Object.prototype.hasOwnProperty.call(writerState.FIRESTORE_CATALOG_WRITERS, "part.import"));
  assert.equal(writerState.CATALOG_WRITER_AUTHORITY.firestore, "FROZEN");
  assert.throws(() => writerState.assertFirestoreCatalogWriterOpen("part.import"),
    (e) => e instanceof writerState.FirestoreCatalogWriterClosedError && e.code === "FIRESTORE_CATALOG_WRITER_FROZEN" && e.writer === "part.import");
  // It is a state gate only: OPEN (the declared rollback state) lets the job proceed.
  assert.doesNotThrow(() => writerState.assertFirestoreCatalogWriterOpen("part.import", { firestore: "OPEN", postgres: "INACTIVE" }));
});

test("the callable answers a frozen catalog as failed-precondition naming the import -- never internal, never per-row", () => {
  let err;
  try { writerState.assertFirestoreCatalogWriterOpen("part.import"); } catch (e) { err = e; }
  const mapped = mapError(err);
  assert.equal(mapped.code, "failed-precondition");
  assert.match(mapped.message, /Part Import is unavailable/);
  assert.equal(mapped.details && mapped.details.code, "FIRESTORE_CATALOG_WRITER_FROZEN");
});
