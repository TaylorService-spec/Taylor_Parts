// THE JOB-LEVEL EQUIPMENT IMPORT GATE (Owner ruling D-1). The Equipment register authority is eos_ops.equipment and
// the Firestore `equipment` collection is FROZEN (eosOps/equipmentWriterState.ts), so an EQUIPMENT import is refused
// BEFORE the job is claimed and before any row is written -- the same shape as the PARTS gate
// (catalogPartImportFreeze.test.mjs).
//
// Offline: the ORDER is proven on the executable source, the REFUSAL on the real guard and the real callable error
// mapper. The emulator proof (job stays STAGED, no equipment written, retry refused again) is in
// dataImportEndToEnd.test.mjs.
//
// Prerequisite: `npm run build` in functions/ (imports lib/).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const writerState = require("../lib/eosOps/equipmentWriterState.js");
const { mapError } = require("../lib/dataImport/dataImportCallables.js");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

test("the EQUIPMENT job gate precedes the job claim and every row write", () => {
  const src = strip(readFileSync("src/dataImport/dataImportCallables.ts", "utf8"));
  const gate = src.indexOf('if (staged.entityType === "EQUIPMENT") assertFirestoreEquipmentWriterOpen("equipment.import")');
  const claim = src.indexOf("beginExecution(staged");
  const rows = src.indexOf("executeImportJob(claimed");
  assert.ok(gate > 0, "the EQUIPMENT job gate must exist in executable code");
  assert.ok(claim > 0 && rows > 0, "precondition: the claim and the row writer are both present");
  assert.ok(gate < claim, "the refusal must precede the claim, or a frozen register burns the job id");
  assert.ok(gate < rows, "and must precede any row write");
});

test("under the committed FROZEN state the gate refuses; only an OPEN Firestore writer lets the job proceed", () => {
  assert.equal(writerState.EQUIPMENT_WRITER_AUTHORITY.firestore, "FROZEN");
  assert.throws(() => writerState.assertFirestoreEquipmentWriterOpen("equipment.import"),
    (e) => e instanceof writerState.FirestoreEquipmentWriterClosedError && e.code === "FIRESTORE_EQUIPMENT_WRITER_FROZEN" && e.writer === "equipment.import");
  assert.throws(() => writerState.assertFirestoreEquipmentWriterOpen("equipment.import", { firestore: "RETIRED", postgres: "ACTIVE" }),
    (e) => e.code === "FIRESTORE_EQUIPMENT_WRITER_RETIRED");
  // OPEN + INACTIVE is the pre-activation (rollback) state: the legacy writer is the authority again.
  assert.doesNotThrow(() => writerState.assertFirestoreEquipmentWriterOpen("equipment.import", { firestore: "OPEN", postgres: "INACTIVE" }));
  // OPEN + ACTIVE is a dual write and never passes.
  assert.throws(() => writerState.assertFirestoreEquipmentWriterOpen("equipment.import", { firestore: "OPEN", postgres: "ACTIVE" }), /dual write/);
  assert.throws(() => writerState.assertFirestoreEquipmentWriterOpen("equipment.somethingElse"), /unknown/);
});

test("the callable answers a frozen register as failed-precondition naming the import -- never internal, never per-row", () => {
  let err;
  try { writerState.assertFirestoreEquipmentWriterOpen("equipment.import"); } catch (e) { err = e; }
  const mapped = mapError(err);
  assert.equal(mapped.code, "failed-precondition");
  assert.match(mapped.message, /Equipment Import is unavailable/);
  assert.equal(mapped.details && mapped.details.code, "FIRESTORE_EQUIPMENT_WRITER_FROZEN");
});
