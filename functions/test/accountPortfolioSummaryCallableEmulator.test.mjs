// Account Portfolio Summary — the trusted callable's resolver-failure catch, emulator test.
//
// X-CATCH-LOGGING regression (docs/assessments/sandbox-gap-scan-2026-08-19.md M10): 26 catch
// blocks across functions/src set `allowed = false` from a failed capability resolution and
// logged NOTHING. Fail-closed was correct and stays correct here -- this test exists solely to
// prove the OTHER half of the fix: a resolver failure (malformed catalog entry, a Firestore
// transient, a genuine bug inside resolveEffectiveAccess) is no longer indistinguishable from an
// ordinary permission-denied to anyone reading Cloud Logging after the fact. Same idiom as the
// existing "genuine read failure is logged server-side" check in salesOrderIndexRead.test.mjs.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";

import assert from "node:assert/strict";
import admin from "firebase-admin";

admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
const { getAccountPortfolioSummary, ACCOUNT_PORTFOLIO_READ_CAPABILITY } = await import(
  "../lib/account/accountPortfolioSummary.js"
);

let passed = 0;
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log(`PASS: ${name}`);
}
const request = (data, uid) => ({ data, auth: uid ? { uid, token: {} } : undefined });

const runId = Date.now();
const adminUid = `acct-portfolio-catch-admin-${runId}`;

async function seedAdmin() {
  await db.collection("users").doc(adminUid).set({ accessVersion: 1 });
  await db.collection("roleAssignments").doc(`acct-portfolio-catch-role-${runId}`).set({
    principalUid: adminUid,
    roleId: "admin",
    scope: { type: "global" },
    grantedBy: "test",
    grantedAt: admin.firestore.Timestamp.now(),
    status: "active",
    accessVersionAtGrant: 1,
  });
}
await seedAdmin();

await check("sanity: a granted admin reads the summary through the callable (proves the forced-failure test below is exercising the real deny path, not an already-broken one)", async () => {
  const result = await getAccountPortfolioSummary.run(request({}, adminUid));
  assert.ok(result && typeof result.summary === "object");
});

// ----- the resolver-failure catch: logged AND still denies -----
await check("a resolveEffectiveAccess failure is logged server-side, names the callable and capability, and the caller still gets permission-denied (fail-closed unchanged)", async () => {
  const originalCollection = db.collection.bind(db);
  const forcedError = new Error("FORCED_TEST_FAILURE: simulated resolver failure (e.g. Firestore transient)");
  const originalConsoleError = console.error;
  const logCalls = [];
  // Fail the users/{uid} read that resolveEffectiveAccess itself performs -- this throws INSIDE
  // resolveEffectiveAccess, before it ever returns a decision, which is exactly the case this
  // catch block exists for (not a downstream data read failure -- that is a different catch,
  // already covered elsewhere).
  db.collection = (name) => {
    if (name === "users") throw forcedError;
    return originalCollection(name);
  };
  console.error = (...args) => {
    logCalls.push(args);
  };
  let caught;
  try {
    await getAccountPortfolioSummary.run(request({}, adminUid));
  } catch (e) {
    caught = e;
  } finally {
    db.collection = originalCollection;
    console.error = originalConsoleError;
  }

  // Fail-closed semantics are byte-identical to before this fix: same code, same message.
  assert.ok(caught, "expected the callable to reject");
  assert.equal(caught.code, "permission-denied");
  assert.equal(caught.message, "Not authorized to read customers.");
  assert.ok(!String(caught.message).includes("FORCED_TEST_FAILURE"));

  // The NEW behavior: the forced error was logged server-side, naming the callable and the
  // capability being resolved -- never the caller's uid, never record content, never a token.
  assert.ok(
    logCalls.some(
      ([msg, err]) =>
        typeof msg === "string" &&
        msg.includes("getAccountPortfolioSummary") &&
        msg.includes(ACCOUNT_PORTFOLIO_READ_CAPABILITY) &&
        err === forcedError,
    ),
    `expected console.error to have been called naming the callable, the capability, and the forced error; got: ${JSON.stringify(logCalls.map((c) => c[0]))}`,
  );
  assert.ok(
    !logCalls.some(([msg]) => typeof msg === "string" && msg.includes(adminUid)),
    "the log line must never include the caller's uid",
  );
});

console.log(`\n${passed} account portfolio summary catch-logging checks passed`);
