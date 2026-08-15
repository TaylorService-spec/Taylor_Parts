// Opportunity write-capability access -- pure glue tests. The state-machine primitives
// (VERSION_STATUS/FEED_STATUS/buildHasCapability/etc.) are ALREADY fully covered by
// test/reportCapabilityAccess.test.mjs (they are capability-id-agnostic and imported, not duplicated, per
// this module's own header comment) -- this file only proves the Opportunity-specific request list and that
// the re-exports actually resolve to the shared primitives (no accidental fork/shadow copy).
import assert from "node:assert/strict";
import * as opportunityCapabilityAccess from "../src/access/opportunityCapabilityAccess.js";
import * as reportCapabilityAccess from "../src/access/reportCapabilityAccess.js";
import { OPPORTUNITY_CAPABILITY_REQUEST, OPPORTUNITY_WRITE_CAPABILITY, buildHasCapability } from "../src/access/opportunityCapabilityAccess.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

ok("requests exactly opportunity.write -- nothing broader", () => {
  assert.deepEqual([...OPPORTUNITY_CAPABILITY_REQUEST], ["opportunity.write"]);
  assert.equal(OPPORTUNITY_WRITE_CAPABILITY, "opportunity.write");
});

ok("re-exports the SAME shared primitive (buildHasCapability) rather than a shadow copy", () => {
  assert.equal(buildHasCapability, reportCapabilityAccess.buildHasCapability);
  assert.equal(opportunityCapabilityAccess.VERSION_STATUS, reportCapabilityAccess.VERSION_STATUS);
  assert.equal(opportunityCapabilityAccess.FEED_STATUS, reportCapabilityAccess.FEED_STATUS);
  assert.equal(opportunityCapabilityAccess.isValidObservedVersion, reportCapabilityAccess.isValidObservedVersion);
  assert.equal(opportunityCapabilityAccess.interpretAccessResult, reportCapabilityAccess.interpretAccessResult);
});

console.log(`\n${passed} passed, 0 failed`);
