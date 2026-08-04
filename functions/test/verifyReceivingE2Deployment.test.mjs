// EI Phase-2 Receiving -- Gate E2-V: OFFLINE proof of the pure verifier core + CLI orchestration against
// INJECTED fake adapters (no network, no production). Prereq: npm run build (compiles nothing here -- the
// verifier is plain JS under scripts/ -- but keeps the suite uniform).
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const J = (...p) => path.join(...p);
const core = require("../scripts/verifyReceivingE2Deployment.js");
const cli = require("../scripts/receivingE2VerifierCli.js");
const { CALLABLES, RULES_DENIAL_CASES, MATRIX_TOTAL } = require("../scripts/receivingE2VerificationMatrix.js");

let passed = 0, failed = 0;
async function check(name, fn) { try { await fn(); passed += 1; console.log(`PASS: ${name}`); } catch (e) { failed += 1; console.error(`FAIL: ${name}`); console.error(e); } }
const COMMIT = "c".repeat(40);
const CONFIG = { projectId: "taylor-parts", confirmProject: "taylor-parts", governedCommit: COMMIT, webApiKeyEnv: "E2_WEB_API_KEY", testEmailEnv: "E2_TEST_EMAIL", testPasswordEnv: "E2_TEST_PASSWORD" };

// Complete inventories: pre-deploy has one pre-existing function; post-deploy adds EXACTLY the two callables.
const BASE_FNS = [{ name: "someExistingFn", region: "us-central1", state: "ACTIVE", entryPoint: "x", runtime: "nodejs20", updateTime: "T0" }];
const AFTER_FNS = [...BASE_FNS, { name: "receiveInventoryStock", region: "us-central1" }, { name: "listReceivingLocationOptions", region: "us-central1" }];

// A fully-passing fake environment: exact deploy delta, both callables present@region, rules probes 403, callables UNAUTHENTICATED, receiving_orders unchanged.
function passingDeps(over = {}) {
  return {
    config: CONFIG,
    readPreDeployInventory: async () => BASE_FNS,
    readPostDeployInventory: async () => AFTER_FNS,
    probeRules: async () => 403,
    invokeCallable: async () => ({ code: "UNAUTHENTICATED" }),
    readReceivingOrderIds: async () => ["ro1", "ro2"],
    ...over,
  };
}

await check("assertConfig fail-closed on bad pins", () => {
  assert.throws(() => core.assertConfig({ ...CONFIG, projectId: "x" }));
  assert.throws(() => core.assertConfig({ ...CONFIG, governedCommit: "short" }));
  assert.throws(() => core.assertConfig({ ...CONFIG, webApiKeyEnv: "lower" }));
  assert.doesNotThrow(() => core.assertConfig(CONFIG));
});

await check("extractRulesSourceStrict requires EXACTLY one file named EXACTLY firestore.rules (P2-2, round 2)", () => {
  const ok = { source: { files: [{ name: "firestore.rules", content: "rules_version = '2';\n" }] } };
  assert.equal(core.extractRulesSourceStrict(ok).startsWith("rules_version"), true);       // exact name accepted
  // suffix-but-not-exact names are REJECTED (no unrestricted endsWith).
  assert.throws(() => core.extractRulesSourceStrict({ source: { files: [{ name: "evilfirestore.rules", content: "rules_version='2'" }] } }));
  assert.throws(() => core.extractRulesSourceStrict({ source: { files: [{ name: "archive/firestore.rules", content: "rules_version='2'" }] } }));
  // extra file rejected (structure must be exactly one file).
  assert.throws(() => core.extractRulesSourceStrict({ source: { files: [{ name: "a.rules", content: "x" }, { name: "firestore.rules", content: "rules_version='2'" }] } }));
  // wrong name / blank name / missing name / malformed content / empty set.
  assert.throws(() => core.extractRulesSourceStrict({ source: { files: [{ name: "other", content: "rules_version='2'" }] } }));
  assert.throws(() => core.extractRulesSourceStrict({ source: { files: [{ name: "", content: "rules_version='2'" }] } }));
  assert.throws(() => core.extractRulesSourceStrict({ source: { files: [{ content: "rules_version='2'" }] } }));
  assert.throws(() => core.extractRulesSourceStrict({ source: { files: [{ name: "firestore.rules", content: "nope" }] } }));
  assert.throws(() => core.extractRulesSourceStrict({ source: { files: [] } }));
});

await check("interpretDeploymentDelta: exact +2 pass; extra/removed/changed/duplicate/wrong-region fail (P1-2)", () => {
  assert.equal(core.interpretDeploymentDelta(BASE_FNS, AFTER_FNS).pass, true);
  // extra unexpected function added
  assert.equal(core.interpretDeploymentDelta(BASE_FNS, [...AFTER_FNS, { name: "sneaky", region: "us-central1" }]).pass, false);
  // a pre-existing function changed
  assert.equal(core.interpretDeploymentDelta(BASE_FNS, [{ name: "someExistingFn", region: "us-central1", updateTime: "T9" }, ...AFTER_FNS.slice(1)]).pass, false);
  // a pre-existing function removed
  assert.equal(core.interpretDeploymentDelta(BASE_FNS, AFTER_FNS.slice(1)).pass, false);
  // callable at the wrong region
  assert.equal(core.interpretDeploymentDelta(BASE_FNS, [...BASE_FNS, { name: "receiveInventoryStock", region: "us-east1" }, { name: "listReceivingLocationOptions", region: "us-central1" }]).pass, false);
  // duplicate name -> normalizeInventory rejects -> delta fails
  assert.equal(core.interpretDeploymentDelta(BASE_FNS, [...AFTER_FNS, { name: "receiveInventoryStock", region: "us-central1" }]).pass, false);
  // malformed entry (missing region)
  assert.equal(core.interpretDeploymentDelta(BASE_FNS, [...AFTER_FNS, { name: "bad" }]).pass, false);
});

await check("interpretters are exact", () => {
  assert.equal(core.interpretRulesDenial(RULES_DENIAL_CASES[0], 403).pass, true);
  assert.equal(core.interpretRulesDenial(RULES_DENIAL_CASES[0], 200).pass, false);
  assert.equal(core.interpretCallableDenial({ callable: "x", expectedCode: "UNAUTHENTICATED" }, { code: "UNAUTHENTICATED" }).pass, true);
  assert.equal(core.interpretCallableDenial({ callable: "x", expectedCode: "UNAUTHENTICATED" }, { ok: true }).interpretation, "UNEXPECTED_SUCCESS");
  assert.equal(core.interpretReceivingOrdersUnchanged(["a", "b"], ["b", "a"]).pass, true); // order-independent
  assert.equal(core.interpretReceivingOrdersUnchanged(["a"], ["a", "b"]).pass, false);
});

await check("runVerification PASS on a fully-conforming environment", async () => {
  const { pass, report } = await core.runVerification(passingDeps());
  assert.equal(pass, true);
  assert.equal(report.passed, MATRIX_TOTAL);
  assert.equal(report.pass, true);
});

await check("runVerification FAILS CLOSED: a rules probe returns 200 (access succeeded)", async () => {
  const { pass, report } = await core.runVerification(passingDeps({ probeRules: async (row) => (row.label === "rules:auth:write" ? 200 : 403) }));
  assert.equal(pass, false);
  assert.ok(report.passed < MATRIX_TOTAL);
});

await check("runVerification FAILS CLOSED: a callable accepts an unauthenticated call", async () => {
  const { pass } = await core.runVerification(passingDeps({ invokeCallable: async () => ({ ok: true }) }));
  assert.equal(pass, false);
});

await check("runVerification FAILS CLOSED: a callable missing @ region (discovery + delta)", async () => {
  const { pass } = await core.runVerification(passingDeps({ readPostDeployInventory: async () => [...BASE_FNS, { name: CALLABLES[0], region: "us-central1" }] }));
  assert.equal(pass, false);
});

await check("runVerification FAILS CLOSED: deployment delta touched an unrelated function", async () => {
  const { pass } = await core.runVerification(passingDeps({ readPostDeployInventory: async () => [{ name: "someExistingFn", region: "us-central1", updateTime: "CHANGED" }, ...AFTER_FNS.slice(1)] }));
  assert.equal(pass, false);
});

await check("runVerification FAILS CLOSED: receiving_orders changed during probes", async () => {
  let n = 0;
  const { pass } = await core.runVerification(passingDeps({ readReceivingOrderIds: async () => (n++ === 0 ? ["ro1"] : ["ro1", "ro-new"]) }));
  assert.equal(pass, false);
});

// ---- CLI-level: injected deps, atomic evidence, publish-only-on-pass ----
function fakeFs() {
  const files = new Map(); const dirs = new Set();
  const N = (p) => path.normalize(p);
  const within = (base, k) => { const rel = path.relative(base, k); return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel); };
  return {
    stamp: "T", _files: files, _dirs: dirs,
    mkdirpSecure: (d) => dirs.add(N(d)),
    rmrf: (d) => { const nd = N(d); for (const k of [...files.keys()]) if (k === nd || within(nd, k)) files.delete(k); dirs.delete(nd); },
    exists: (p) => dirs.has(N(p)) || files.has(N(p)),
    writeFileSecure: (p, c) => files.set(N(p), c),
    readFileSync: (p) => { const np = N(p); if (!files.has(np)) throw new Error("ENOENT"); return files.get(np); },
    rename: (a, b) => {
      const na = N(a), nb = N(b); dirs.delete(na); dirs.add(nb);
      for (const k of [...files.keys()]) if (within(na, k)) { files.set(N(path.join(nb, path.relative(na, k))), files.get(k)); files.delete(k); }
    },
  };
}

const crypto = require("node:crypto");
const PRE_RAW = JSON.stringify(BASE_FNS);
const PRE_SHA = crypto.createHash("sha256").update(PRE_RAW).digest("hex");
function cliDeps(fs, over = {}) {
  return { ...passingDeps(over), normalizeGcloudInventory: (x) => x, fs, log: () => {} };
}
const CLI_ARGS = (dir) => ["--config", "cfg.json", "--evidence-dir", dir, "--verify-date", "2026-08-04", "--confirm-project", "taylor-parts", "--pre-deploy-inventory", "pre.json", "--pre-deploy-inventory-sha256", PRE_SHA];

await check("CLI run publishes sanitized evidence atomically on PASS", async () => {
  const fs = fakeFs();
  fs.writeFileSecure("cfg.json", JSON.stringify(CONFIG));
  fs.writeFileSecure("pre.json", PRE_RAW);
  const r = await cli.run(cliDeps(fs), CLI_ARGS("out/verify"));
  assert.equal(r.pass, true); assert.equal(r.evidenceDir, "out/verify");
  assert.ok(fs._files.has(J("out/verify", "verification-report.json")));
  assert.ok(fs._files.has(J("out/verify", "SHA256SUMS.txt")));
});

await check("CLI run: pre-deploy inventory hash mismatch fails closed (no verification)", async () => {
  const fs = fakeFs();
  fs.writeFileSecure("cfg.json", JSON.stringify(CONFIG));
  fs.writeFileSecure("pre.json", PRE_RAW);
  const args = ["--config", "cfg.json", "--evidence-dir", "out/v2", "--verify-date", "2026-08-04", "--confirm-project", "taylor-parts", "--pre-deploy-inventory", "pre.json", "--pre-deploy-inventory-sha256", "a".repeat(64)];
  await assert.rejects(cli.run(cliDeps(fs), args), /inventory hash mismatch/);
});

await check("CLI run publishes a SANITIZED FAILURE report on FAIL (P2-3), then throws", async () => {
  const fs = fakeFs();
  fs.writeFileSecure("cfg.json", JSON.stringify(CONFIG));
  fs.writeFileSecure("pre.json", PRE_RAW);
  await assert.rejects(cli.run(cliDeps(fs, { probeRules: async () => 200 }), CLI_ARGS("out/verify")), /verification failed/);
  // primary evidence dir NOT created; a clearly-marked FAILED dir IS published for incident review.
  assert.ok(!fs._files.has(J("out/verify", "verification-report.json")));
  assert.ok(fs._files.has(J("out/verify.FAILED", "verification-report.FAILED.json")));
  assert.ok(fs._files.has(J("out/verify.FAILED", "SHA256SUMS.txt")));
});

await check("CLI parseArgs enforces required flags + confirm-project + pre-deploy inventory", () => {
  assert.throws(() => cli.parseArgs(["--config", "c"]));
  assert.throws(() => cli.parseArgs(["--config", "c", "--evidence-dir", "d", "--verify-date", "x", "--confirm-project", "wrong", "--pre-deploy-inventory", "p", "--pre-deploy-inventory-sha256", "a".repeat(64)]));
  assert.throws(() => cli.parseArgs(["--config", "c", "--evidence-dir", "d", "--verify-date", "x", "--confirm-project", "taylor-parts"])); // missing pre-deploy inventory
  assert.doesNotThrow(() => cli.parseArgs(["--config", "c", "--evidence-dir", "d", "--verify-date", "x", "--confirm-project", "taylor-parts", "--pre-deploy-inventory", "p", "--pre-deploy-inventory-sha256", "a".repeat(64)]));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
