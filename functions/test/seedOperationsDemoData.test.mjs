// X-TARGETING-GUARD -- OFFLINE proof of the Operations demo-seed CLI's fail-closed environment guard
// (functions/scripts/seedOperationsDemoData.js). No firebase-admin app is ever created by this file; every
// rejected configuration is proven to fail BEFORE buildProductionDeps() (and therefore before firebase-admin
// is ever required and before any Firestore connection, read, or write) runs.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { getApps } from "firebase-admin/app";
const require = createRequire(import.meta.url);
const cli = require("../scripts/seedOperationsDemoData.js");

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (e) { failed += 1; console.error(`FAIL: ${name}`); console.error(e); }
}

// Real config/environments.json read via node:fs -- assertNonProductionTarget takes fsDeps as its second
// argument precisely so tests can pass the real fs without ever calling buildProductionDeps().
const fs = require("node:fs");

await check("parseArgs: reads --projectId (and any other --flag value) from argv", () => {
  assert.deepEqual(cli.parseArgs(["--projectId", "eos-platform-sandbox"]), { projectId: "eos-platform-sandbox" });
  assert.deepEqual(cli.parseArgs([]), {});
});

await check("assertNonProductionTarget: refuses a missing --projectId", () => {
  assert.throws(() => cli.assertNonProductionTarget(undefined, fs), /--projectId is required/);
});
await check("assertNonProductionTarget: refuses 'taylor-parts' explicitly, belt and braces", () => {
  assert.throws(() => cli.assertNonProductionTarget("taylor-parts", fs), /REFUSING: taylor-parts is the customer production project/);
});
await check("assertNonProductionTarget: refuses a project id not in config/environments.json (unknown fails closed)", () => {
  assert.throws(() => cli.assertNonProductionTarget("totally-unknown-project-id", fs), /is not a known provisioned environment/);
});
await check("assertNonProductionTarget: accepts the real sandbox project id", () => {
  const env = cli.assertNonProductionTarget("eos-platform-sandbox", fs);
  assert.equal(env.role, "sandbox");
});

// ---- cli.main() fails closed BEFORE buildProductionDeps() ----
// `getApps()` (firebase-admin/app) reads the SAME global app registry buildProductionDeps() would register
// into via initializeApp() -- so its length staying 0 after a rejected cli.main() call is direct proof the
// rejection happened before Firebase touched anything. Technique copied from
// functions/test/salesOrderNumberBackfill.test.mjs's environment-guard tests.
assert.equal(getApps().length, 0, "precondition: no Firebase app has been initialized by anything else in this offline test file");
await check("main(): missing --projectId never reaches buildProductionDeps -- no Firebase app registered", async () => {
  await assert.rejects(cli.main([], fs), /--projectId is required/);
  assert.equal(getApps().length, 0, "buildProductionDeps (and therefore initializeApp) must never run when --projectId is missing");
});
await check("main(): --projectId taylor-parts (production) never reaches buildProductionDeps -- no Firebase app registered", async () => {
  await assert.rejects(cli.main(["--projectId", "taylor-parts"], fs), /taylor-parts is the customer production project/);
  assert.equal(getApps().length, 0, "buildProductionDeps (and therefore initializeApp) must never run when --projectId is taylor-parts");
});
await check("main(): an unknown --projectId never reaches buildProductionDeps -- no Firebase app registered", async () => {
  await assert.rejects(cli.main(["--projectId", "totally-unknown-project-id"], fs), /is not a known provisioned environment/);
  assert.equal(getApps().length, 0, "buildProductionDeps (and therefore initializeApp) must never run when --projectId is unrecognized");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
