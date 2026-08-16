// The "don't know yet" vs "known to be no" distinction (Owner decision closing #1065, follow-up).
//
// THE DEFECT THIS PINS. buildHasCapability() denies while loading, which is correct fail-closed
// behaviour for AUTHORIZATION. But routing treats an absent capability-gated route as a miss and the
// router's catch-all REDIRECTS to /dashboard -- destroying the requested URL before the decision
// arrives. Live evidence: inventoryTransferOperator was granted inventory.transfer.create by the
// deployed feed and STILL could not land on /inventory/transfers by full page load or deep link,
// because the redirect had already fired. In-app navigation worked, because the decision was already
// resolved in memory by then.
//
// Compatibility-role users never hit it: ROLE_NAV_ACCESS is available synchronously, so they have no
// window to lose. That is exactly why this went unnoticed until a governed-only principal existed.
//
// isAccessResolving() must therefore be TRUE for every state where an answer is still coming, and
// FALSE for every settled state -- including settled DENIALS, where waiting would just hang the app.
import assert from "node:assert/strict";
import test from "node:test";
import {
  isAccessResolving, VERSION_STATUS, FEED_STATUS, SIGNED_OUT_VERSION, IDLE_FEED,
} from "../src/access/reportCapabilityAccess.js";

const UID = "uid-1";
const OTHER = "uid-2";
const ready = (uid, v) => ({ status: VERSION_STATUS.READY, uid, version: v });
const feedReady = (uid, v) => ({ status: FEED_STATUS.READY, forUid: uid, forVersion: v, decisions: {} });

// ---- still resolving: the shell must WAIT -----------------------------------------------------
test("resolving while the version subscription has not answered", () => {
  assert.equal(isAccessResolving({ version: undefined, feed: IDLE_FEED }, UID), true);
  assert.equal(isAccessResolving({ version: { status: VERSION_STATUS.LOADING, uid: UID, version: null }, feed: IDLE_FEED }, UID), true);
});

test("resolving while the version belongs to a PREVIOUS principal", () => {
  // A stale value from another account is not an answer about this one.
  assert.equal(isAccessResolving({ version: ready(OTHER, 3), feed: feedReady(OTHER, 3) }, UID), true);
});

test("resolving while the feed decision for a known version is still in flight", () => {
  assert.equal(isAccessResolving({ version: ready(UID, 1), feed: IDLE_FEED }, UID), true);
  assert.equal(isAccessResolving({ version: ready(UID, 1), feed: { status: FEED_STATUS.LOADING } }, UID), true);
  assert.equal(isAccessResolving({ version: ready(UID, 1), feed: undefined }, UID), true);
});

test("resolving when the feed answered for a SUPERSEDED version -- a re-fetch is coming", () => {
  // This is the live grant/revoke window: accessVersion bumped, the new decision has not landed.
  assert.equal(isAccessResolving({ version: ready(UID, 2), feed: feedReady(UID, 1) }, UID), true);
});

// ---- settled: the shell must NOT wait ---------------------------------------------------------
test("settled once the feed matches the current principal AND version", () => {
  assert.equal(isAccessResolving({ version: ready(UID, 1), feed: feedReady(UID, 1) }, UID), false);
});

test("settled DENIALS do not hang the app", () => {
  // Each of these is a real answer -- waiting longer would never change it, and returning true here
  // would leave the user on a permanent "Loading..." instead of an honest denial.
  assert.equal(isAccessResolving({ version: { status: VERSION_STATUS.ERROR, uid: UID, version: null }, feed: IDLE_FEED }, UID), false);
  assert.equal(isAccessResolving({ version: SIGNED_OUT_VERSION, feed: IDLE_FEED }, UID), false);
  assert.equal(isAccessResolving({ version: ready(UID, 1), feed: { status: FEED_STATUS.ERROR } }, UID), false);
});

test("signed out is settled, never resolving", () => {
  assert.equal(isAccessResolving({ version: SIGNED_OUT_VERSION, feed: IDLE_FEED }, null), false);
  assert.equal(isAccessResolving({ version: undefined, feed: undefined }, null), false);
});

// ---- the gate grants nothing ------------------------------------------------------------------
test("waiting is not permission: isAccessResolving never reports an ALLOW", () => {
  // It answers a different question than buildHasCapability. Nothing here returns a capability, so
  // this signal can only ever delay a decision -- never widen one.
  assert.equal(typeof isAccessResolving({ version: ready(UID, 1), feed: feedReady(UID, 1) }, UID), "boolean");
});
