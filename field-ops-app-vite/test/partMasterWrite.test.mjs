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

check("outcomeFromResult: only the governed Catalog success shape is a success; never fabricates one", () => {
  // The REAL server shapes (test/fixtures/catalogPartMasterContract.json, proven against PostgreSQL).
  assert.equal(outcomeFromResult({ partId: "PRT-1", version: 1, replayed: false }).kind, "applied");
  assert.equal(outcomeFromResult({ partId: "PRT-1", version: 1, replayed: false }).version, 1);
  assert.equal(outcomeFromResult({ partId: "PRT-1", version: 2, replayed: true }).kind, "replayed");
  // The retired Firebase callable shape is NOT a success any more -- nothing answers with it.
  assert.equal(outcomeFromResult({ outcome: "applied", version: 1 }).kind, "error");
  assert.equal(outcomeFromResult({}).kind, "error");
  assert.equal(outcomeFromResult({ partId: "PRT-1", version: "1", replayed: false }).kind, "error");
  assert.equal(outcomeFromResult(undefined).kind, "error");
});

check("outcomeFromError: the Catalog category, worded for the operation that was refused", () => {
  assert.equal(outcomeFromError({ code: "FORBIDDEN" }, "create").kind, "denied");
  assert.equal(outcomeFromError({ code: "NOT_SIGNED_IN" }, "update").kind, "denied");
  assert.equal(outcomeFromError({ code: "INVALID_INPUT" }, "create").kind, "invalid");
  // CONFLICT means a different rule per operation: an existing Part ID on create, a stale version otherwise.
  assert.match(outcomeFromError({ code: "CONFLICT" }, "create").message, /already exists/);
  assert.match(outcomeFromError({ code: "CONFLICT" }, "update").message, /changed since you loaded it/);
  assert.match(outcomeFromError({ code: "CONFLICT" }, "changeStatus").message, /changed since you loaded it/);
  assert.match(outcomeFromError({ code: "PRECONDITION_FAILED" }, "changeStatus").message, /status change isn't allowed/);
  assert.equal(outcomeFromError({ code: "NOT_FOUND" }, "update").kind, "notFound");
  assert.equal(outcomeFromError({ code: "UNREACHABLE" }, "create").kind, "unavailable");
  // Unknown or retired (Firebase HttpsError) codes fail closed to the generic error.
  assert.equal(outcomeFromError({ code: "permission-denied" }, "create").kind, "error");
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
