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

// A fully-passing fake environment: both callables present@region, all rules probes 403, callables UNAUTHENTICATED, receiving_orders unchanged.
function passingDeps(over = {}) {
  return {
    config: CONFIG,
    discover: async () => CALLABLES.map((name) => ({ name, region: "us-central1" })),
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

await check("extractRulesSourceStrict requires exactly one named firestore.rules (no files[0] fallback)", () => {
  const ok = { source: { files: [{ name: "a.rules" }, { name: "firestore.rules", content: "rules_version = '2';\n" }] } };
  assert.equal(core.extractRulesSourceStrict(ok).startsWith("rules_version"), true);
  assert.throws(() => core.extractRulesSourceStrict({ source: { files: [{ name: "other", content: "rules_version='2'" }] } }));
  assert.throws(() => core.extractRulesSourceStrict({ source: { files: [] } }));
  assert.throws(() => core.extractRulesSourceStrict({ source: { files: [{ name: "firestore.rules", content: "nope" }] } }));
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

await check("runVerification FAILS CLOSED: a callable missing @ region (discovery)", async () => {
  const { pass } = await core.runVerification(passingDeps({ discover: async () => [{ name: CALLABLES[0], region: "us-central1" }] }));
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

await check("CLI run publishes sanitized evidence atomically on PASS", async () => {
  const fs = fakeFs();
  fs.writeFileSecure("cfg.json", JSON.stringify(CONFIG));
  const deps = { ...passingDeps(), fs, log: () => {} };
  // core.runVerification uses deps.config etc.; CLI reads config from --config path.
  const r = await cli.run(deps, ["--config", "cfg.json", "--evidence-dir", "out/verify", "--verify-date", "2026-08-04", "--confirm-project", "taylor-parts"]);
  assert.equal(r.pass, true);
  assert.equal(r.evidenceDir, "out/verify");
  assert.ok(fs._files.has(J("out/verify", "verification-report.json")));
  assert.ok(fs._files.has(J("out/verify", "SHA256SUMS.txt")));
});

await check("CLI run does NOT publish on FAIL (no evidence dir)", async () => {
  const fs = fakeFs();
  fs.writeFileSecure("cfg.json", JSON.stringify(CONFIG));
  const deps = { ...passingDeps({ probeRules: async () => 200 }), fs, log: () => {} };
  await assert.rejects(cli.run(deps, ["--config", "cfg.json", "--evidence-dir", "out/verify", "--verify-date", "2026-08-04", "--confirm-project", "taylor-parts"]));
  assert.ok(!fs._files.has(J("out/verify", "verification-report.json")));
  assert.ok(!fs._dirs.has("out/verify"));
});

await check("CLI parseArgs enforces required flags + confirm-project", () => {
  assert.throws(() => cli.parseArgs(["--config", "c"]));
  assert.throws(() => cli.parseArgs(["--config", "c", "--evidence-dir", "d", "--verify-date", "x", "--confirm-project", "wrong"]));
  assert.doesNotThrow(() => cli.parseArgs(["--config", "c", "--evidence-dir", "d", "--verify-date", "x", "--confirm-project", "taylor-parts"]));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
