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

ok("requests exactly the workspace's own capabilities -- nothing broader", () => {
  // The Sales Agreement panel lives on THIS workspace, so its four capabilities ride the same
  // request: one feed call means all five decisions resolve against ONE accessVersion, and a screen
  // that asked twice could render an ACCEPT control authorized under a version the edit was already
  // denied under.
  //
  // The guard's intent is unchanged and is what this still asserts: an EXACT list, so an unrelated
  // capability cannot be swept in unnoticed. It is not "one id" -- it is "these ids and no others".
  assert.deepEqual([...OPPORTUNITY_CAPABILITY_REQUEST], [
    "opportunity.write",
    "salesAgreement.create",
    "salesAgreement.updateDraft",
    "salesAgreement.accept",
    "salesAgreement.read",
  ]);
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
