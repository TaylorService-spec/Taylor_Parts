// Issue #325 / ADR-007 W1 -- pure tests for the report-builder nav access preview.
// Pure: no firebase, no browser -- runs under plain node. The previewer is injected, so this
// exercises the gate logic without importing the TypeScript resolver.
//
// Run: node test/reportAccess.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import {
  REPORT_WAVE1_OBJECT_READ_CAPABILITIES, previewHasReportAccess,
} from "../src/access/reportAccess.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

// A stub previewer standing in for createPermissionPreviewer(resolveEffectivePermission, roles):
// only `owner` holds the report caps; admin/dispatcher/technician hold none.
function previewer(grants) {
  return (permissionId, role) => (grants[role] ?? []).includes(permissionId);
}
const OWNER_GRANTS = {
  owner: [...REPORT_WAVE1_OBJECT_READ_CAPABILITIES],
  admin: ["workOrder.create"],
  dispatcher: [],
  technician: [],
};

ok("the wave-1 object-read capability set is the four Customer/Contact/Location/Equipment ids", () => {
  assert.deepEqual([...REPORT_WAVE1_OBJECT_READ_CAPABILITIES].sort(), [
    "report.contact.read", "report.customer.read", "report.equipment.read", "report.location.read",
  ]);
});

ok("Owner holds report access; admin/dispatcher/technician do not (non-Owner denial)", () => {
  const has = previewer(OWNER_GRANTS);
  assert.equal(previewHasReportAccess(has, "owner"), true);
  assert.equal(previewHasReportAccess(has, "admin"), false);
  assert.equal(previewHasReportAccess(has, "dispatcher"), false);
  assert.equal(previewHasReportAccess(has, "technician"), false);
});

ok("holding ANY one wave-1 object-read cap is enough to open the builder", () => {
  const has = previewer({ owner: ["report.equipment.read"] }); // only one of the four
  assert.equal(previewHasReportAccess(has, "owner"), true);
});

ok("fail-closed: a non-function previewer or an unknown role yields no access", () => {
  assert.equal(previewHasReportAccess(null, "owner"), false);
  assert.equal(previewHasReportAccess(undefined, "owner"), false);
  assert.equal(previewHasReportAccess(previewer(OWNER_GRANTS), "mysteryRole"), false);
});

console.log(`\n${passed} passed, 0 failed`);
