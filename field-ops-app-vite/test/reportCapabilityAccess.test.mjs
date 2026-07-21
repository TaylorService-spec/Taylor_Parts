// Issue #325 / ADR-007 -- pure tests for the trusted access-feed client gate, hardened for
// access-version freshness (live grant/revocation without logout). Pure node.
//
// The callable's ALLOW/DENY per principal is the feed's own job (functions/test/
// effectiveAccessFeed.test.mjs). This file proves the CLIENT reacts fail-closed and FRESH: it
// grants only when the feed's resolved version exactly matches the current observed version, so a
// grant/revocation that bumps accessVersion takes effect without logout.
//
// Run: node test/reportCapabilityAccess.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import {
  REPORT_CAPABILITY_REQUEST, VERSION_STATUS, FEED_STATUS,
  SIGNED_OUT_VERSION, IDLE_FEED, isValidObservedVersion, interpretAccessResult, buildHasCapability,
} from "../src/access/reportCapabilityAccess.js";
import { REPORT_WAVE1_OBJECT_READ_CAPABILITIES, REPORT_DEFINITION_CAPABILITY_IDS } from "../src/access/reportAccess.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

const CAP = "report.customer.read";
const versionReady = (uid, v) => ({ status: VERSION_STATUS.READY, uid, version: v });
const feedReady = (uid, forVersion, decisions) => ({ status: FEED_STATUS.READY, forUid: uid, forVersion, decisions });
const grants = (version, feed, uid) => buildHasCapability({ version, feed }, uid)(CAP);

ok("requests the four wave-1 object-read ids PLUS the five saved-definition ids -- nothing more", () => {
  assert.deepEqual([...REPORT_CAPABILITY_REQUEST], [
    ...REPORT_WAVE1_OBJECT_READ_CAPABILITIES, ...REPORT_DEFINITION_CAPABILITY_IDS,
  ]);
  assert.deepEqual([...REPORT_DEFINITION_CAPABILITY_IDS].sort(), [
    "report.definition.create", "report.definition.delete", "report.definition.duplicate",
    "report.definition.read", "report.definition.rename",
  ]);
  assert.equal(REPORT_CAPABILITY_REQUEST.length, 9);
});

// ---- observed-version validation -------------------------------------------
ok("isValidObservedVersion accepts finite non-negative integers and rejects everything else", () => {
  for (const good of [0, 1, 2, 1000, Number.MAX_SAFE_INTEGER]) assert.equal(isValidObservedVersion(good), true, `${good}`);
  for (const bad of [-1, -0.0001, 1.5, 0.5, NaN, Infinity, -Infinity, "1", "0", null, undefined, {}, [], true]) {
    assert.equal(isValidObservedVersion(bad), false, `${String(bad)}`);
  }
});

// ---- interpretAccessResult now carries the resolved version ----------------
ok("interpretAccessResult returns the resolved accessVersion and rejects malformed results", () => {
  assert.deepEqual(
    interpretAccessResult({ accessVersion: 4, decisions: { [CAP]: true } }),
    { ok: true, accessVersion: 4, decisions: { [CAP]: true } },
  );
  for (const bad of [
    null, 42, {},
    { decisions: { [CAP]: true } },                  // no accessVersion
    { accessVersion: -1, decisions: {} },            // negative version
    { accessVersion: 1.5, decisions: {} },           // fractional version
    { accessVersion: "1", decisions: {} },           // non-number version
    { accessVersion: 1 },                            // no decisions
    { accessVersion: 1, decisions: [] },             // decisions not a plain object
    { accessVersion: 1, decisions: { [CAP]: "yes" } }, // non-boolean decision
  ]) {
    assert.deepEqual(interpretAccessResult(bad), { ok: false }, `should reject ${JSON.stringify(bad)}`);
  }
});

// ---- the fresh gate: grant only on an exact version match ------------------
ok("GRANT: version ready + feed ready for the same principal + matching version + decision true", () => {
  assert.equal(grants(versionReady("u1", 3), feedReady("u1", 3, { [CAP]: true }), "u1"), true);
});

ok("DENIED decision, absent decision, or feed for the wrong principal -> false", () => {
  assert.equal(grants(versionReady("u1", 3), feedReady("u1", 3, { [CAP]: false }), "u1"), false);
  assert.equal(grants(versionReady("u1", 3), feedReady("u1", 3, {}), "u1"), false); // no decision for CAP
  assert.equal(grants(versionReady("u1", 3), feedReady("u2", 3, { [CAP]: true }), "u1"), false); // feed for another principal
});

ok("DENY while the observed version is loading / error / signed out / missing / malformed", () => {
  const goodFeed = feedReady("u1", 3, { [CAP]: true });
  assert.equal(grants({ status: VERSION_STATUS.LOADING, uid: "u1", version: null }, goodFeed, "u1"), false);
  assert.equal(grants({ status: VERSION_STATUS.ERROR, uid: "u1", version: null }, goodFeed, "u1"), false);
  assert.equal(grants(SIGNED_OUT_VERSION, goodFeed, null), false);
  // a "ready" version that is somehow invalid (defensive) never grants
  assert.equal(grants(versionReady("u1", -1), feedReady("u1", -1, { [CAP]: true }), "u1"), false);
  assert.equal(grants(versionReady("u1", 1.5), feedReady("u1", 1.5, { [CAP]: true }), "u1"), false);
});

ok("DENY while the feed is idle / loading / error (unavailable/malformed)", () => {
  const v = versionReady("u1", 3);
  assert.equal(grants(v, IDLE_FEED, "u1"), false);
  assert.equal(grants(v, { status: FEED_STATUS.LOADING, forUid: "u1", forVersion: 3, decisions: null }, "u1"), false);
  assert.equal(grants(v, { status: FEED_STATUS.ERROR, forUid: "u1", forVersion: 3, decisions: null }, "u1"), false);
});

// ---- freshness: live revocation & grant without logout ---------------------
ok("REVOCATION without logout: granted decisions stop granting the instant the version bumps", () => {
  const grantedAtV3 = feedReady("u1", 3, { [CAP]: true });
  assert.equal(grants(versionReady("u1", 3), grantedAtV3, "u1"), true); // still v3 -> granted
  // accessVersion bumps to v4 (a revocation happened); the feed is still resolved against v3 ->
  // DENY immediately, before any re-fetch returns.
  assert.equal(grants(versionReady("u1", 4), grantedAtV3, "u1"), false);
  // re-fetch returns v4 with the capability now denied -> stays denied
  assert.equal(grants(versionReady("u1", 4), feedReady("u1", 4, { [CAP]: false }), "u1"), false);
});

ok("GRANT without logout: a newly-granted decision applies once the re-fetch returns the matching version", () => {
  assert.equal(grants(versionReady("u1", 3), feedReady("u1", 3, { [CAP]: false }), "u1"), false); // denied at v3
  // an admin grants access -> version bumps to v4; while re-fetching, the v3 decisions no longer
  // match -> denied
  assert.equal(grants(versionReady("u1", 4), feedReady("u1", 3, { [CAP]: false }), "u1"), false);
  // the re-fetch returns v4 granting the capability -> now granted, no logout needed
  assert.equal(grants(versionReady("u1", 4), feedReady("u1", 4, { [CAP]: true }), "u1"), true);
});

ok("OUT-OF-ORDER / stale-version responses never grant against a different observed version", () => {
  // a decision resolved against an OLDER version than currently observed -> deny
  assert.equal(grants(versionReady("u1", 5), feedReady("u1", 4, { [CAP]: true }), "u1"), false);
  // a decision resolved against a NEWER version than currently observed (feed raced ahead) -> also
  // deny until the observed version catches up (exact match required)
  assert.equal(grants(versionReady("u1", 4), feedReady("u1", 5, { [CAP]: true }), "u1"), false);
});

ok("ACCOUNT SWITCH: neither a previous principal's version nor its decisions ever grant the new one", () => {
  // u1 was fully granted at v3; the current principal is now u2 (effects not yet re-run)
  assert.equal(grants(versionReady("u1", 3), feedReady("u1", 3, { [CAP]: true }), "u2"), false);
});

ok("a null/garbage gate denies fail-closed", () => {
  assert.equal(buildHasCapability(null, "u1")(CAP), false);
  assert.equal(buildHasCapability({}, "u1")(CAP), false);
  assert.equal(grants(versionReady("u1", 3), null, "u1"), false);
});

console.log(`\n${passed} passed, 0 failed`);
