// Sales Order write-capability access -- pure glue tests. The state-machine primitives
// (VERSION_STATUS/FEED_STATUS/buildHasCapability/etc.) are ALREADY fully covered by
// test/reportCapabilityAccess.test.mjs (capability-id-agnostic, imported not duplicated, per this
// module's own header comment) -- this file only proves the Sales-Order-specific request list and
// that the re-exports actually resolve to the shared primitives (no accidental fork/shadow copy).
// Mirrors test/opportunityCapabilityAccess.test.mjs.
import assert from "node:assert/strict";
import * as salesOrderCapabilityAccess from "../src/access/salesOrderCapabilityAccess.js";
import * as reportCapabilityAccess from "../src/access/reportCapabilityAccess.js";
import {
  SALES_ORDER_CAPABILITY_REQUEST,
  SALES_ORDER_WRITE_CAPABILITY,
  SALES_ORDER_FULFILL_CAPABILITY,
  SALES_ORDER_SERVICE_CAPABILITY,
  SALES_ORDER_WRITE_DISABLED_REASON,
  buildHasCapability,
} from "../src/access/salesOrderCapabilityAccess.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

ok("requests exactly the three Sales Order write capabilities -- nothing broader", () => {
  assert.deepEqual([...SALES_ORDER_CAPABILITY_REQUEST], ["salesOrder.write", "salesOrder.fulfill", "salesOrder.service"]);
  assert.equal(SALES_ORDER_WRITE_CAPABILITY, "salesOrder.write");
  assert.equal(SALES_ORDER_FULFILL_CAPABILITY, "salesOrder.fulfill");
  assert.equal(SALES_ORDER_SERVICE_CAPABILITY, "salesOrder.service");
});

ok("exposes a non-empty, honest disabled-reason string", () => {
  assert.equal(typeof SALES_ORDER_WRITE_DISABLED_REASON, "string");
  assert.ok(SALES_ORDER_WRITE_DISABLED_REASON.length > 0);
});

ok("re-exports the SAME shared primitive (buildHasCapability) rather than a shadow copy", () => {
  assert.equal(buildHasCapability, reportCapabilityAccess.buildHasCapability);
  assert.equal(salesOrderCapabilityAccess.VERSION_STATUS, reportCapabilityAccess.VERSION_STATUS);
  assert.equal(salesOrderCapabilityAccess.FEED_STATUS, reportCapabilityAccess.FEED_STATUS);
  assert.equal(salesOrderCapabilityAccess.isValidObservedVersion, reportCapabilityAccess.isValidObservedVersion);
  assert.equal(salesOrderCapabilityAccess.interpretAccessResult, reportCapabilityAccess.interpretAccessResult);
});

ok("buildHasCapability is fail-closed by default (no version/feed) for every Sales Order write capability", () => {
  const hasCapability = buildHasCapability({ version: undefined, feed: undefined }, "uid-1");
  assert.equal(hasCapability(SALES_ORDER_WRITE_CAPABILITY), false);
  assert.equal(hasCapability(SALES_ORDER_FULFILL_CAPABILITY), false);
  assert.equal(hasCapability(SALES_ORDER_SERVICE_CAPABILITY), false);
});

ok("buildHasCapability grants only the capability an explicit true decision names, for the matching principal+version", () => {
  const version = { status: reportCapabilityAccess.VERSION_STATUS.READY, uid: "uid-1", version: 3 };
  const feed = {
    status: reportCapabilityAccess.FEED_STATUS.READY,
    forUid: "uid-1",
    forVersion: 3,
    decisions: { [SALES_ORDER_WRITE_CAPABILITY]: false, [SALES_ORDER_FULFILL_CAPABILITY]: true, [SALES_ORDER_SERVICE_CAPABILITY]: false },
  };
  const hasCapability = buildHasCapability({ version, feed }, "uid-1");
  assert.equal(hasCapability(SALES_ORDER_WRITE_CAPABILITY), false);
  assert.equal(hasCapability(SALES_ORDER_FULFILL_CAPABILITY), true);
  assert.equal(hasCapability(SALES_ORDER_SERVICE_CAPABILITY), false);
});

console.log(`\n${passed} passed, 0 failed`);
