// #1095 — one authoritative Account AR request per page context.
//
// A network capture showed THREE identical listAccountInvoiceAr calls on one load of
// /customers/:accountId: AccountDetail (health strip), AccountArSection, and
// AccountAttentionSection each call useAccountAr independently.
//
// These test the sharing primitive directly rather than through React, because the
// property under test is about the NETWORK — how many round trips a set of concurrent
// callers produces — and a render-level test would prove something adjacent instead.
//
// The distinction that matters most here is deduplication vs caching. Sharing an
// in-flight promise is safe; holding a settled result is not, because a stale AR balance
// is a worse defect than the duplicate reads being removed. The tests below pin that
// boundary in both directions: concurrent callers share, later callers do not.

import assert from "node:assert/strict";

let passed = 0;
function ok(name, fn) {
  return fn().then(
    () => {
      passed += 1;
      console.log(`PASS -- ${name}`);
    },
    (err) => {
      console.error(`FAIL -- ${name}`);
      throw err;
    },
  );
}

// Minimal re-implementation of the hook's sharing primitive. The hook itself imports the
// Firebase callable client, which cannot be loaded in a plain node test; extracting the
// behavior under test keeps this offline and deterministic, and the assertions describe
// the contract the hook must honor.
function makeSharedFetcher(underlying) {
  const inFlight = new Map();
  return function sharedFetch(key) {
    const existing = inFlight.get(key);
    if (existing) return existing;
    const request = underlying(key).finally(() => inFlight.delete(key));
    inFlight.set(key, request);
    return request;
  };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

console.log("accountArInFlightSharing.test.mjs");

await ok("three concurrent readers of the same account produce ONE request", async () => {
  let calls = 0;
  const d = deferred();
  const shared = makeSharedFetcher(() => {
    calls += 1;
    return d.promise;
  });

  const a = shared("acct-harbor");
  const b = shared("acct-harbor");
  const c = shared("acct-harbor");
  d.resolve({ result: { status: "ready" }, errorStatus: null });

  const [ra, rb, rc] = await Promise.all([a, b, c]);
  assert.equal(calls, 1, "the three Account page consumers must share one round trip");
  assert.deepEqual(ra, rb);
  assert.deepEqual(rb, rc, "every consumer sees the same answer, so sections cannot disagree");
});

await ok("different accounts are never shared with each other", async () => {
  let calls = 0;
  const shared = makeSharedFetcher((key) => {
    calls += 1;
    return Promise.resolve({ result: { status: "ready", key }, errorStatus: null });
  });
  const [harbor, summit] = await Promise.all([shared("acct-harbor"), shared("acct-summit")]);
  assert.equal(calls, 2);
  assert.equal(harbor.result.key, "acct-harbor");
  assert.equal(summit.result.key, "acct-summit", "keying by account is what makes sharing safe at all");
});

await ok("DEDUPLICATION, NOT CACHING — a later read re-fetches", async () => {
  // The load-bearing assertion. If a settled result were retained, a user returning to an
  // account after a payment posted would see a stale balance, which is a worse defect than
  // the duplicate requests this removes.
  let calls = 0;
  const shared = makeSharedFetcher(() => {
    calls += 1;
    return Promise.resolve({ result: { status: "ready" }, errorStatus: null });
  });

  await shared("acct-harbor");
  assert.equal(calls, 1);
  await shared("acct-harbor");
  assert.equal(calls, 2, "a settled request must not be retained — AR is a financial figure");
});

await ok("a failed request is not pinned for later readers", async () => {
  // Caching a rejection would turn one transient failure into a persistent one for every
  // subsequent consumer of that account.
  let calls = 0;
  const shared = makeSharedFetcher(() => {
    calls += 1;
    return calls === 1
      ? Promise.resolve({ result: null, errorStatus: "unavailable" })
      : Promise.resolve({ result: { status: "ready" }, errorStatus: null });
  });

  const first = await shared("acct-harbor");
  assert.equal(first.errorStatus, "unavailable");

  const second = await shared("acct-harbor");
  assert.equal(second.errorStatus, null, "a transient failure must not persist for later readers");
  assert.equal(calls, 2);
});

await ok("concurrent readers all observe a shared failure identically", async () => {
  // Sections must fail together rather than one rendering a value while another reports
  // unavailable — the class of contradiction #1094 was.
  let calls = 0;
  const d = deferred();
  const shared = makeSharedFetcher(() => {
    calls += 1;
    return d.promise;
  });

  const a = shared("acct-harbor");
  const b = shared("acct-harbor");
  d.resolve({ result: null, errorStatus: "denied" });

  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(calls, 1);
  assert.equal(ra.errorStatus, "denied");
  assert.equal(rb.errorStatus, "denied", "one shared answer means the sections cannot contradict each other");
});

console.log(`\n${passed} passed, 0 failed`);
