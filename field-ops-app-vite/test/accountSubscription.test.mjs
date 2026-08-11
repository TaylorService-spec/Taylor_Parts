// #785 -- the pure state decisions behind useAccount. The React lifecycle (subscription,
// obsolete-callback guard, retry re-subscription) is proven in the browser gate; the
// fail-closed outcomes are proven here, without a browser. The single-document sibling of
// locationSubscription.test.mjs (#291).
//
// Run: node test/accountSubscription.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import {
  accountSuccessOutcome,
  accountFailureOutcome,
  accountIdleOutcome,
} from "../src/domain/accountSubscription.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

const LEAKY = /permission-denied|firestore|firebase|FirebaseError|unavailable\b|\/accounts\/|[A-Za-z0-9_-]{20,}/i;

ok("SUCCESS resolves the account, stops loading, and clears any prior error", () => {
  const acct = { id: "a1", name: "Northwind Foods" };
  const o = accountSuccessOutcome(acct);
  assert.deepEqual(o, { account: acct, loading: false, error: null });
  // A later success SUPERSEDES an earlier failure -- this is what makes retry recover:
  // whatever error was on screen, a good snapshot clears it.
  assert.equal(o.error, null);
});

ok("SUCCESS with a genuinely-absent document resolves to a CONFIRMED null, not an error", () => {
  // The document was looked at and does not exist -- distinct from a failed read. The
  // consumer renders "Unknown customer" ONLY for this case.
  const o = accountSuccessOutcome(null);
  assert.deepEqual(o, { account: null, loading: false, error: null });
  assert.equal(accountSuccessOutcome(undefined).account, null);
});

ok("FAILURE fails closed -- no account, stopped loading, a SAFE message", () => {
  const o = accountFailureOutcome({ code: "permission-denied" });
  assert.equal(o.account, null, "no stale record survives a failure");
  assert.equal(o.loading, false, "a failure is not perpetual loading");
  assert.equal(typeof o.error, "string");
  assert.ok(o.error.length > 0, "the failure is named, not silent");
  assert.match(o.error, /permission to view/i);
});

ok("FAILURE is DISTINCT from a confirmed-absent customer", () => {
  // The whole point of #785: these two must not collapse to the same render.
  const failed = accountFailureOutcome({ code: "permission-denied" });
  const absent = accountSuccessOutcome(null);
  assert.notEqual(failed.error, absent.error);   // one has a message, the other null
  assert.equal(absent.error, null);
  assert.ok(failed.error);
});

ok("FAILURE copy leaks no provider code, path, id, or collection name", () => {
  for (const err of [
    { code: "permission-denied" },
    { code: "unavailable" },
    { code: "firestore/permission-denied", message: "Missing or insufficient permissions." },
    new Error("FirebaseError: 7 PERMISSION_DENIED: /accounts/abc123XYZ"),
    { code: "resource-exhausted" },
    null,
  ]) {
    const { error } = accountFailureOutcome(err);
    assert.doesNotMatch(error, LEAKY, `leaked from ${JSON.stringify(err)}: ${error}`);
  }
});

ok("FAILURE distinguishes the two categories users can act on", () => {
  // permission vs connectivity -- different actions (ask an admin vs check your network).
  assert.match(accountFailureOutcome({ code: "permission-denied" }).error, /permission/i);
  assert.match(accountFailureOutcome({ code: "unavailable" }).error, /connection|reach/i);
  // anything else is a generic, still-safe retryable.
  assert.match(accountFailureOutcome({ code: "internal" }).error, /try again/i);
});

ok("IDLE (no account id) is empty -- not loading, not an error, not a failure", () => {
  const o = accountIdleOutcome();
  assert.deepEqual(o, { account: null, loading: false, error: null });
});

console.log(`\n${passed} passed, 0 failed`);
