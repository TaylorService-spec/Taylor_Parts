"use strict";

// EI Phase-2 Receiving -- Gate E2-V production verifier OPERATOR CLI: the reviewed, committed entry point
// that wires real production dependencies for the pure core in verifyReceivingE2Deployment.js. INERT on
// import (only an explicit `node receivingE2VerifierCli.js ...` invocation acts; firebase-admin + network
// adapters are lazy-required inside their closures) -- importing it touches no production and pulls no
// heavy SDK. Production execution stays gated by separate Owner authorization, not by a missing
// implementation. It NEVER accepts or emits raw tokens/keys/secrets/PII; the only output is the sanitized
// report object, published atomically (temp dir -> secret-scan -> rename) so the evidence dir materializes
// only on a clean run and is never partially written or overwritten.
//
// It performs NO receipt and NO write: discovery + receiving_orders client-denial (403) + callable
// unauthenticated-denial (UNAUTHENTICATED) + receiving_orders-unchanged. See
// docs/operations/receiving-e2-activation-handoff.md for the copy-ready invocation.

const path = require("node:path");
const { VerificationError, sha256, assertEvidenceSecretFree } = require("./firestoreDeploymentVerificationShared");
const { RECEIVING_ORDERS_DOC, REGION } = require("./receivingE2VerificationMatrix");
const core = require("./verifyReceivingE2Deployment");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) throw new VerificationError(`unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new VerificationError(`--${key} requires a value`);
    args[key] = value; i += 1;
  }
  for (const required of ["config", "evidence-dir", "verify-date", "confirm-project", "pre-deploy-inventory", "pre-deploy-inventory-sha256"]) {
    if (!args[required]) throw new VerificationError(`missing required --${required}`);
  }
  if (args["confirm-project"] !== "taylor-parts") throw new VerificationError("--confirm-project must be taylor-parts");
  if (!/^[0-9a-f]{64}$/.test(String(args["pre-deploy-inventory-sha256"]).trim().toLowerCase())) throw new VerificationError("--pre-deploy-inventory-sha256 must be a 64-hex hash");
  return args;
}

function loadConfig(configPath, fs) {
  let raw;
  try { raw = fs.readFileSync(configPath, "utf8"); } catch { throw new VerificationError(`cannot read config: ${configPath}`); }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new VerificationError("config is not valid JSON"); }
  return core.assertConfig(parsed);
}

// Atomic sanitized-evidence publish: temp sibling dir -> secret-scan every file -> rename into place.
// Refuses to overwrite an existing evidence dir; removes the temp dir on any failure.
function publishEvidenceAtomically(fsDeps, finalDir, files) {
  const tmpDir = `${finalDir}.tmp-${fsDeps.stamp}`;
  fsDeps.rmrf(tmpDir);
  fsDeps.mkdirpSecure(tmpDir);
  try {
    const sums = [];
    for (const f of files) {
      assertEvidenceSecretFree(f.content);
      fsDeps.writeFileSecure(path.join(tmpDir, f.name), f.content);
      sums.push(`${sha256(f.content)}  ${f.name}`);
    }
    fsDeps.writeFileSecure(path.join(tmpDir, "SHA256SUMS.txt"), `${sums.sort().join("\n")}\n`);
    if (fsDeps.exists(finalDir)) throw new VerificationError(`refusing to overwrite existing evidence dir ${finalDir}`);
    fsDeps.rename(tmpDir, finalDir);
    return finalDir;
  } catch (err) {
    fsDeps.rmrf(tmpDir);
    throw err;
  }
}

async function run(deps, argv) {
  const args = parseArgs(argv);
  const config = loadConfig(args.config, deps.fs);
  if (args["confirm-project"] !== config.projectId) throw new VerificationError("--confirm-project must equal config.projectId");

  // Hash-bind the COMPLETE pre-deploy Functions inventory the Owner recorded in Phase 1 (P1-2). The raw
  // bytes are hashed BEFORE parsing; a mismatch fails closed (no verification, no evidence).
  const rawPre = deps.fs.readFileSync(args["pre-deploy-inventory"], "utf8");
  const expectedPre = String(args["pre-deploy-inventory-sha256"]).trim().toLowerCase();
  if (sha256(rawPre) !== expectedPre) throw new VerificationError("pre-deploy inventory hash mismatch: refusing to verify");
  let preInventory;
  try { preInventory = JSON.parse(rawPre); } catch { throw new VerificationError("pre-deploy inventory is not valid JSON"); }

  const { report, pass } = await core.runVerification({
    config,
    readPreDeployInventory: async () => deps.normalizeGcloudInventory(preInventory),
    readPostDeployInventory: deps.readPostDeployInventory,
    probeRules: deps.probeRules,
    invokeCallable: deps.invokeCallable,
    readReceivingOrderIds: deps.readReceivingOrderIds,
    log: deps.log,
  });
  const content = `${JSON.stringify(report, null, 2)}\n`;
  if (pass) {
    const dir = publishEvidenceAtomically(deps.fs, args["evidence-dir"], [{ name: "verification-report.json", content }]);
    return { pass, evidenceDir: dir, matrixTotal: report.matrix_total };
  }
  // (P2-3) On failure, atomically publish a SANITIZED failure report to a clearly-marked directory, then
  // exit non-zero. The report is secret-free by construction (assertEvidenceSecretFree ran in the core).
  const failDir = `${args["evidence-dir"]}.FAILED`;
  let published = null;
  try { published = publishEvidenceAtomically(deps.fs, failDir, [{ name: "verification-report.FAILED.json", content }]); } catch { /* keep the primary failure */ }
  throw new VerificationError(`E2 verification failed: ${report.passed}/${report.matrix_total} assertions passed${published ? ` (failure evidence: ${published})` : ""}`);
}

// Lazily build real production deps. Node 20 global fetch; gcloud/ADC from the ambient authenticated env.
function buildProductionDeps(args) {
  // eslint-disable-next-line global-require
  const admin = require("firebase-admin");
  const { execFileSync } = require("node:child_process");
  const fs = require("node:fs");
  const config = loadConfig(args.config, fs);
  const webApiKey = process.env[config.webApiKeyEnv];
  const testEmail = process.env[config.testEmailEnv];
  const testPassword = process.env[config.testPasswordEnv];
  if (!webApiKey || !testEmail || !testPassword) throw new VerificationError("web API key + test-persona email/password env vars must be present (never committed/logged)");
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();
  const REST = `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/(default)/documents`;

  async function idToken() {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${webApiKey}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: testEmail, password: testPassword, returnSecureToken: true }),
    });
    const body = await res.json();
    if (!body.idToken) throw new VerificationError("could not obtain a test-persona ID token");
    return body.idToken;
  }
  let cachedToken = null;

  // Normalize a raw gcloud `functions list --format json` payload to the COMPLETE, unfiltered comparable
  // set {name, region, state, entryPoint, runtime, updateTime}. Used for BOTH the pinned pre-deploy file
  // and the live post-deploy read so the exact-delta comparison sees every function (P1-2).
  const normalizeGcloudInventory = (list) => (Array.isArray(list) ? list : []).map((fn) => {
    const name = String(fn.name || "").split("/").pop();
    const region = fn.name && fn.name.includes("/locations/") ? fn.name.split("/locations/")[1].split("/")[0] : (fn.region || "");
    const build = fn.buildConfig || {};
    return { name, region, state: fn.state || "", entryPoint: build.entryPoint || fn.entryPoint || "", runtime: build.runtime || fn.runtime || "", updateTime: fn.updateTime || "" };
  });
  return {
    normalizeGcloudInventory,
    async readPostDeployInventory() {
      const out = execFileSync("gcloud", ["functions", "list", "--project", config.projectId, "--format", "json"], { encoding: "utf8" });
      return normalizeGcloudInventory(JSON.parse(out));
    },
    async probeRules(row) {
      const url = `${REST}/${RECEIVING_ORDERS_DOC}`;
      const headers = { "Content-Type": "application/json" };
      if (row.principal === "authenticated") { cachedToken = cachedToken || await idToken(); headers.Authorization = `Bearer ${cachedToken}`; }
      const init = { method: row.method, headers };
      if (row.method === "PATCH") init.body = JSON.stringify({ fields: { probe: { stringValue: "x" } } });
      const res = await fetch(url, init);
      return res.status;
    },
    async invokeCallable(callable) {
      const res = await fetch(`https://${REGION}-${config.projectId}.cloudfunctions.net/${callable}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: {} }),
      });
      let body = {};
      try { body = await res.json(); } catch { /* non-JSON -> treat as no code */ }
      const status = body && body.error && body.error.status;
      return status ? { code: status } : { ok: true };
    },
    async readReceivingOrderIds() {
      const snap = await db.collection("receiving_orders").select().get();
      return snap.docs.map((d) => d.id);
    },
    log: (m) => console.error(`[e2-verify] ${m}`),
    fs: {
      stamp: String(process.pid),
      mkdirpSecure: (d) => fs.mkdirSync(d, { recursive: true, mode: 0o700 }),
      rmrf: (d) => fs.rmSync(d, { recursive: true, force: true }),
      exists: (p) => fs.existsSync(p),
      writeFileSecure: (p, c) => fs.writeFileSync(p, c, { mode: 0o600 }),
      readFileSync: (p, e) => fs.readFileSync(p, e),
      rename: (a, b) => fs.renameSync(a, b),
    },
  };
}

module.exports = { parseArgs, loadConfig, publishEvidenceAtomically, run, buildProductionDeps };

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  run(buildProductionDeps(args), process.argv.slice(2))
    .then((r) => { console.log(JSON.stringify({ ok: true, pass: r.pass, evidenceDir: r.evidenceDir, matrixTotal: r.matrixTotal }, null, 2)); process.exitCode = 0; })
    .catch((err) => { console.error(`RECEIVING E2 VERIFIER CLI FAILURE: ${err.message}`); process.exitCode = 2; });
}
