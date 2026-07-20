// Issue #325 / ADR-007 W1 correction -- reportAccess declares the capabilities the Report Builder
// item needs, and NOTHING that resolves them from a raw role. Pure node.
//
// Run: node test/reportAccess.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import * as reportAccess from "../src/access/reportAccess.js";
import { REPORT_WAVE1_OBJECT_READ_CAPABILITIES } from "../src/access/reportAccess.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

ok("the wave-1 object-read capability set is the four Customer/Contact/Location/Equipment ids", () => {
  assert.deepEqual([...REPORT_WAVE1_OBJECT_READ_CAPABILITIES].sort(), [
    "report.contact.read", "report.customer.read", "report.equipment.read", "report.location.read",
  ]);
});

ok("reportAccess exposes NO client resolver of governed capabilities (raw-role gate removed)", () => {
  // The only export is the capability declaration -- no previewer/resolver that could grant a
  // governed capability from the session's raw role.
  assert.deepEqual(Object.keys(reportAccess), ["REPORT_WAVE1_OBJECT_READ_CAPABILITIES"]);
  assert.equal(reportAccess.previewHasReportAccess, undefined);
});

console.log(`\n${passed} passed, 0 failed`);
