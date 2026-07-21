// Issue #325 / ADR-007 -- pure tests for the trusted access-feed client gate. Pure node.
//
// Covers every gating scenario as a pure decision-state: the callable's ALLOW/DENY per principal is
// the feed's own job (functions/test/effectiveAccessFeed.test.mjs, which proves valid-Owner-assignment
// ALLOW, unassigned/raw-owner DENY, admin-without-assignment DENY, stale/disabled DENY); this file
// proves the CLIENT reacts fail-closed to each resulting state.
//
// Run: node test/reportCapabilityAccess.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import {
  REPORT_CAPABILITY_REQUEST, FEED_STATUS, SIGNED_OUT_STATE,
  interpretAccessResult, buildHasCapability,
} from "../src/access/reportCapabilityAccess.js";
import { REPORT_WAVE1_OBJECT_READ_CAPABILITIES } from "../src/access/reportAccess.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

const CAP = "report.customer.read";
const ready = (uid, decisions) => ({ status: FEED_STATUS.READY, forUid: uid, decisions });

ok("requests ONLY the four wave-1 Report Builder capability ids", () => {
  assert.deepEqual([...REPORT_CAPABILITY_REQUEST], [...REPORT_WAVE1_OBJECT_READ_CAPABILITIES]);
  assert.equal(REPORT_CAPABILITY_REQUEST.length, 4);
});

// ---- interpretAccessResult: only well-formed results are trusted -----------
ok("interpretAccessResult accepts a well-formed { accessVersion, decisions } and rejects malformed", () => {
  assert.deepEqual(
    interpretAccessResult({ accessVersion: 3, decisions: { [CAP]: true } }),
    { ok: true, decisions: { [CAP]: true } },
  );
  for (const bad of [
    null, undefined, 42, "x", [],
    { decisions: { [CAP]: true } },                 // no accessVersion
    { accessVersion: "1", decisions: {} },           // accessVersion not a number
    { accessVersion: 1 },                            // no decisions
    { accessVersion: 1, decisions: [] },             // decisions not a plain object
    { accessVersion: 1, decisions: { [CAP]: "yes" } }, // non-boolean decision -> malformed
  ]) {
    assert.deepEqual(interpretAccessResult(bad), { ok: false }, `should reject ${JSON.stringify(bad)}`);
  }
});

// ---- buildHasCapability: granted only from a successful, current-principal decision ----
ok("VALID access: a READY grant for the current principal returns true", () => {
  const has = buildHasCapability(ready("u1", { [CAP]: true }), "u1");
  assert.equal(has(CAP), true);
});

ok("DENIED (raw owner / admin-without-assignment / stale / disabled): a READY deny returns false", () => {
  // The callable returns `false` for these principals; the client must hide.
  const has = buildHasCapability(ready("u1", { [CAP]: false }), "u1");
  assert.equal(has(CAP), false);
  // a capability with NO decision is also false (never granted by omission)
  assert.equal(has("report.contact.read"), false);
});

ok("LOADING and ERROR (unavailable/not-deployed/malformed) both deny", () => {
  assert.equal(buildHasCapability({ status: FEED_STATUS.LOADING, forUid: "u1", decisions: null }, "u1")(CAP), false);
  assert.equal(buildHasCapability({ status: FEED_STATUS.ERROR, forUid: "u1", decisions: null }, "u1")(CAP), false);
});

ok("SIGNED OUT denies (logout clears decisions)", () => {
  assert.equal(buildHasCapability(SIGNED_OUT_STATE, null)(CAP), false);
  // even a lingering ready state denies once the current principal is null
  assert.equal(buildHasCapability(ready("u1", { [CAP]: true }), null)(CAP), false);
});

ok("ACCOUNT SWITCH: a previous principal's grant is never reused for the new principal", () => {
  // u1 was granted; now the current principal is u2 (uid changed before the effect re-ran).
  const staleForU1 = ready("u1", { [CAP]: true });
  assert.equal(buildHasCapability(staleForU1, "u2")(CAP), false, "u1's decisions must not grant u2");
  // and once u2's own grant arrives, it applies
  assert.equal(buildHasCapability(ready("u2", { [CAP]: true }), "u2")(CAP), true);
});

ok("a null/garbage state denies fail-closed", () => {
  assert.equal(buildHasCapability(null, "u1")(CAP), false);
  assert.equal(buildHasCapability({ status: "ready", forUid: "u1", decisions: null }, "u1")(CAP), false);
});

console.log(`\n${passed} passed, 0 failed`);
