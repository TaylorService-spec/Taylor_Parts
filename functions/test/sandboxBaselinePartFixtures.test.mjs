// The sandbox baseline Part fixtures must satisfy the GOVERNED Part Master schema.
//
// THE DEFECT THIS PINS. The seeded Parts carried only a legacy `partTrackingMode: "QUANTITY"` and
// none of the governed fields, so partFromFirestore() -> validatePart() rejected every one of them
// with MalformedStoredRecordError. Every governed command that resolves a Part -- transfer, cycle
// count, receiving -- then failed with an opaque INTERNAL error that said nothing about the cause.
// Live evidence: createTransferOrder returned 500 for an authorized principal, and the six seeded
// Parts all reported controlType = (MISSING).
//
// This validates the fixture DEFINITIONS against the real validator rather than a restatement of it,
// so the seed source cannot drift from the schema it has to satisfy.
//
// Run: node --test functions/test/sandboxBaselinePartFixtures.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

import { validatePart } from "../lib/partMaster/validation.js";
import { CONTROL_TYPES, STOCKING_CLASSES } from "../lib/partMaster/types.js";

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");
const SEED_SRC = readFileSync(resolvePath(ROOT, "scripts/seedSandboxBaseline.js"), "utf8");

// Parse the PARTS literal out of the seed script. Reading the real source keeps this test honest:
// it fails if someone adds a fixture without the governed fields, which is exactly the regression.
function seedParts() {
  const block = SEED_SRC.slice(SEED_SRC.indexOf("const PARTS = ["));
  const body = block.slice(block.indexOf("["), block.indexOf("];") + 1);
  // eslint-disable-next-line no-new-func -- a repo-local literal, not untrusted input.
  return Function(`"use strict"; return ${body};`)();
}

const PARTS = seedParts();

test("the seed defines the six baseline Parts plus the serialized fixture", () => {
  const ids = PARTS.map((p) => p.id);
  assert.deepEqual(ids, [
    "PRT-1001", "PRT-1002", "PRT-1003", "PRT-1004", "PRT-1005", "PRT-1006",
    "PRT-2001",
  ]);
});

test("EVERY fixture passes the real governed Part validator", () => {
  for (const p of PARTS) {
    const result = validatePart({
      partId: p.id,
      internalPartNumber: p.id,
      name: p.name,
      category: p.category,
      status: "ACTIVE",
      stockingUnit: p.stockingUnit,
      controlType: p.controlType,
      stockingClass: p.stockingClass,
    });
    assert.equal(
      result.valid,
      true,
      `${p.id} is not a valid governed Part: ${result.valid ? "" : result.errors.map((e) => `${e.path}:${e.code}`).join(",")}`,
    );
  }
});

test("stockingUnit is the validated unit CODE, never the display abbreviation", () => {
  // The original fixtures carried unitOfMeasure "EA", which is not a unit code -- a quiet way to
  // fail validation while looking correct to a reader.
  for (const p of PARTS) {
    assert.notEqual(p.stockingUnit, "EA", `${p.id} uses the display abbreviation, not a unit code`);
    assert.equal(p.stockingUnit, "EACH");
  }
});

test("control types and stocking classes are declared enum members", () => {
  for (const p of PARTS) {
    assert.ok(CONTROL_TYPES.includes(p.controlType), `${p.id} controlType ${p.controlType}`);
    assert.ok(STOCKING_CLASSES.includes(p.stockingClass), `${p.id} stockingClass ${p.stockingClass}`);
  }
});

test("serialized semantics are not invented: exactly one deliberate SERIALIZED fixture", () => {
  // The quantity-tracked parts stay STANDARD, which is what they have always meant. Marking them
  // SERIALIZED to make a serial test pass would change business semantics to suit a test.
  const serialized = PARTS.filter((p) => p.controlType === "SERIALIZED");
  assert.deepEqual(serialized.map((p) => p.id), ["PRT-2001"]);
  for (const p of PARTS.filter((x) => x.id.startsWith("PRT-10"))) {
    assert.equal(p.controlType, "STANDARD", `${p.id} must remain STANDARD`);
  }
});

test("the writer persists the governed fields, not only the legacy ones", () => {
  // Guards the other half of the bug: correct definitions written to the wrong field names would
  // leave Firestore just as non-conformant as before.
  const writer = SEED_SRC.slice(SEED_SRC.indexOf('upsert(db, "parts"'), SEED_SRC.indexOf('bump("parts")'));
  for (const field of ["internalPartNumber", "stockingUnit", "controlType", "stockingClass"]) {
    assert.match(writer, new RegExp(`\\b${field}\\b`), `seed must persist ${field}`);
  }
});

test("the writer persists an optimistic-concurrency version", () => {
  // readMeta() requires an integer version >= INITIAL_VERSION. Without it a Part whose domain fields
  // are all correct is STILL rejected as malformed metadata -- the second half of the same gap, and
  // exactly as invisible as the first.
  const writer = SEED_SRC.slice(SEED_SRC.indexOf('upsert(db, "parts"'), SEED_SRC.indexOf('bump("parts")'));
  assert.match(writer, /\bversion:\s*1\b/, "seed must persist version");
});
