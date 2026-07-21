// Issue #325 / ADR-007 W1 correction -- reportAccess declares the capabilities the Report Builder
// item needs, and NOTHING that resolves them from a raw role. Pure node.
//
// Run: node test/reportAccess.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import * as reportAccess from "../src/access/reportAccess.js";
import {
  REPORT_WAVE1_OBJECT_READ_CAPABILITIES, REPORT_DEFINITION_CAPABILITIES, REPORT_DEFINITION_CAPABILITY_IDS,
} from "../src/access/reportAccess.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

ok("the wave-1 object-read capability set is the four Customer/Contact/Location/Equipment ids", () => {
  assert.deepEqual([...REPORT_WAVE1_OBJECT_READ_CAPABILITIES].sort(), [
    "report.contact.read", "report.customer.read", "report.equipment.read", "report.location.read",
  ]);
});

ok("the five saved-definition capabilities map each action to its report.definition.* id", () => {
  assert.deepEqual(REPORT_DEFINITION_CAPABILITIES, {
    create: "report.definition.create", read: "report.definition.read", rename: "report.definition.rename",
    duplicate: "report.definition.duplicate", delete: "report.definition.delete",
  });
  assert.deepEqual([...REPORT_DEFINITION_CAPABILITY_IDS].sort(), [
    "report.definition.create", "report.definition.delete", "report.definition.duplicate",
    "report.definition.read", "report.definition.rename",
  ]);
});

ok("reportAccess exposes ONLY capability DATA -- no client resolver of governed capabilities", () => {
  // Every export is inert capability declaration data; NOTHING resolves a governed capability from
  // the session's raw role (the W1-correction boundary), so no export is a function.
  assert.deepEqual(Object.keys(reportAccess).sort(), [
    "REPORT_DEFINITION_CAPABILITIES", "REPORT_DEFINITION_CAPABILITY_IDS", "REPORT_WAVE1_OBJECT_READ_CAPABILITIES",
  ]);
  for (const v of Object.values(reportAccess)) assert.notEqual(typeof v, "function", "no resolver may be exported");
  assert.equal(reportAccess.previewHasReportAccess, undefined);
});

console.log(`\n${passed} passed, 0 failed`);
