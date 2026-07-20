// Issue #325 / ADR-007 W-SAVE-UI -- pure tests for the saved-report model + validation.
// Pure: no firebase, no browser -- runs under plain node.
//
// Run: node test/savedReportModel.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import {
  createSavedReport, validateSavedReport, duplicateName,
  SAVED_REPORT_KEYS, SAVED_REPORT_NAME_MAX,
} from "../src/domain/reporting/savedReportModel.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

function validDef() {
  return { objectId: "customer", fields: ["customer.name"] };
}
function validSaved(overrides = {}) {
  return {
    id: "r1", name: "My customers", ownerUid: "u1",
    definition: validDef(), createdAt: 1000, updatedAt: 2000, ...overrides,
  };
}

ok("createSavedReport produces a frozen, inert saved report with injected id/now", () => {
  const s = createSavedReport({ id: "r9", name: "N", ownerUid: "u1", definition: validDef(), now: 5000 });
  assert.equal(s.id, "r9");
  assert.equal(s.createdAt, 5000);
  assert.equal(s.updatedAt, 5000);
  assert.throws(() => { s.name = "x"; }); // frozen
  // no sharing/scheduling fields
  assert.deepEqual(Object.keys(s).sort(), [...SAVED_REPORT_KEYS].sort());
});

ok("a well-formed saved report validates clean", () => {
  assert.deepEqual(validateSavedReport(validSaved()), []);
});

ok("validation fails closed on every metadata defect", () => {
  const bad = (o, needle) => {
    const errs = validateSavedReport(validSaved(o));
    assert.ok(errs.some((e) => e.includes(needle)), `expected "${needle}", got: ${errs.join(" | ") || "(none)"}`);
  };
  bad({ id: "" }, "id is required");
  bad({ ownerUid: "" }, "ownerUid is required");
  bad({ name: "" }, "name is required");
  bad({ name: "x".repeat(SAVED_REPORT_NAME_MAX + 1) }, "exceeds");
  bad({ createdAt: "nope" }, "createdAt must be a number");
  bad({ updatedAt: null }, "updatedAt must be a number");
  bad({ surprise: 1 }, "unknown keys"); // fail-closed on stray keys (e.g. a sharing/schedule field)
  // non-object
  assert.ok(validateSavedReport(null).length > 0);
  assert.ok(validateSavedReport("x").length > 0);
});

ok("the embedded definition is validated by the F2 validator (fail-closed, prefixed)", () => {
  const missingDef = validateSavedReport(validSaved({ definition: undefined }));
  assert.ok(missingDef.some((e) => e.includes("definition is required")));
  // an unknown object in the definition surfaces through, prefixed with `definition:`
  const badObj = validateSavedReport(validSaved({ definition: { objectId: "nope", fields: ["x"] } }));
  assert.ok(badObj.some((e) => e.startsWith("definition:") && e.includes("unknown objectId")));
  // a definition with unknown keys is rejected (fail-closed)
  const badKeys = validateSavedReport(validSaved({ definition: { objectId: "customer", fields: ["customer.name"], sneaky: 1 } }));
  assert.ok(badKeys.some((e) => e.startsWith("definition:") && e.includes("unknown keys")));
});

ok("activation option is forwarded to the definition validator", () => {
  // an empty activation set makes even a catalogued object invalid (fail-closed)
  const errs = validateSavedReport(validSaved(), { activatedObjectIds: [] });
  assert.ok(errs.some((e) => e.includes("is not activated")));
});

ok("duplicateName prefixes 'Copy of' and clamps to the name limit", () => {
  assert.equal(duplicateName("Q3 accounts"), "Copy of Q3 accounts");
  assert.equal(duplicateName(""), "Copy of report");
  assert.ok(duplicateName("x".repeat(200)).length <= SAVED_REPORT_NAME_MAX);
});

console.log(`\n${passed} passed, 0 failed`);
