// Part Master write -- OFFLINE tests for the pure write helpers (house check()/passed convention). No
// Firebase/network. Asserts the client vocabulary mirrors, status-transition offering, form-input
// shaping (create defaults + optional omission; minimal update diff), and the governed outcome mapping
// (a callable code -> a stable UI outcome; the client never invents a success).
import assert from "node:assert/strict";
import {
  PART_STATUSES, CONTROL_TYPES, STOCKING_CLASSES, OEM_STATUSES, UNIT_CODES,
  allowedStatusTransitions,
  buildCreatePartInput,
  buildUpdateChanges,
  outcomeFromResult,
  outcomeFromError,
  WRITE_DISABLED_OUTCOME,
  NO_CHANGES_OUTCOME,
  isValidIdempotencyKey,
} from "../src/domain/partMasterWrite.js";

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }
console.log("partMasterWrite.test.mjs");

check("vocabularies mirror the backend enums exactly", () => {
  assert.deepEqual([...PART_STATUSES], ["DRAFT", "ACTIVE", "INACTIVE", "SUPERSEDED", "DISCONTINUED"]);
  assert.deepEqual([...CONTROL_TYPES], ["STANDARD", "SERIALIZED", "LOT", "SERIALIZED_LOT"]);
  assert.deepEqual([...STOCKING_CLASSES], ["STOCKED", "NON_STOCK", "SERVICE", "KIT"]);
  assert.deepEqual([...OEM_STATUSES], ["OEM", "AFTERMARKET", "UNKNOWN"]);
  assert.ok(UNIT_CODES.includes("EACH") && UNIT_CODES.includes("CASE"));
});

check("allowedStatusTransitions mirrors the governed transition map; terminals are empty", () => {
  assert.deepEqual(allowedStatusTransitions("DRAFT"), ["ACTIVE"]);
  assert.deepEqual(allowedStatusTransitions("ACTIVE"), ["INACTIVE", "DISCONTINUED", "SUPERSEDED"]);
  assert.deepEqual(allowedStatusTransitions("DISCONTINUED"), []);
  assert.deepEqual(allowedStatusTransitions("bogus"), []);
});

check("buildCreatePartInput: new parts are DRAFT; defaults applied; blanks omitted; oemStatus validated", () => {
  const p = buildCreatePartInput({ partId: " P-1 ", internalPartNumber: " IPN-1 ", name: " Widget ", description: "  ", oemStatus: "OEM" });
  assert.equal(p.status, "DRAFT");
  assert.equal(p.partId, "P-1"); // trimmed
  assert.equal(p.name, "Widget");
  assert.equal(p.stockingUnit, "EACH"); // default
  assert.equal(p.controlType, "STANDARD");
  assert.equal(p.stockingClass, "STOCKED");
  assert.ok(!("description" in p)); // blank omitted
  assert.equal(p.oemStatus, "OEM");
  const p2 = buildCreatePartInput({ partId: "P", name: "N", oemStatus: "BOGUS" });
  assert.ok(!("oemStatus" in p2)); // invalid oemStatus dropped (backend re-validates anyway)
});

check("buildUpdateChanges: only changed updatable fields; non-updatable ignored; unchanged -> {}", () => {
  const original = { name: "Old", description: "d", stockingUnit: "EACH", status: "ACTIVE" };
  const changes = buildUpdateChanges({ name: "New", description: "d", status: "INACTIVE", partId: "X" }, original);
  assert.deepEqual(changes, { name: "New" }); // description unchanged; status/partId not updatable
  assert.deepEqual(buildUpdateChanges({ name: "Old" }, original), {}); // nothing changed
  // blank-vs-undefined isn't a change
  assert.deepEqual(buildUpdateChanges({ category: "" }, { name: "Old" }), {});
});

check("outcomeFromResult: applied/replayed only; never fabricates success", () => {
  assert.equal(outcomeFromResult({ outcome: "applied", version: 1 }).kind, "applied");
  assert.equal(outcomeFromResult({ outcome: "replayed", version: 2 }).kind, "replayed");
  assert.equal(outcomeFromResult({}).kind, "error"); // unknown shape -> error, not success
});

check("outcomeFromError: sanitized code -> stable UI outcome", () => {
  assert.equal(outcomeFromError({ code: "permission-denied" }).kind, "denied");
  assert.equal(outcomeFromError({ code: "already-exists" }).kind, "conflict");
  assert.equal(outcomeFromError({ code: "aborted" }).kind, "conflict");
  assert.equal(outcomeFromError({ code: "invalid-argument" }).kind, "invalid");
  assert.equal(outcomeFromError({ code: "not-found" }).kind, "notFound");
  assert.equal(outcomeFromError({ code: "weird" }).kind, "error");
  assert.equal(outcomeFromError(undefined).kind, "error");
});

check("write-disabled + no-changes outcomes + idempotency-key validity", () => {
  assert.equal(WRITE_DISABLED_OUTCOME.kind, "unavailable");
  assert.equal(NO_CHANGES_OUTCOME.kind, "noop");
  assert.equal(isValidIdempotencyKey("pm-1234567890"), true);
  assert.equal(isValidIdempotencyKey("short"), false);
  assert.equal(isValidIdempotencyKey("bad space!"), false);
});

console.log(`\n${passed} passed, 0 failed`);
