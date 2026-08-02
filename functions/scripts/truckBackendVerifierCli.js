"use strict";

// EI Truck Registry — GATE E4 READ-ONLY BACKEND VERIFIER — OPERATOR CLI.
//
// Reviewed, committed entry point that wires the REAL production read-only dependencies for the pure
// core in verifyTruckBackend.js. It does NOT run merely because it is imported — only an explicit
// `node truckBackendVerifierCli.js --config <local.json> --evidence-dir <dir> --confirm-project
// taylor-parts --verify-date YYYY-MM-DD` invocation, in an operator environment holding Application
// Default Credentials, executes it. Production execution remains gated by separate Owner
// authorization, NOT by a missing implementation.
//
// Read-only by construction: the only production capability handed to the core is a `reads` surface
// of getDoc() + queryByField() built here — both call ONLY Firestore `.get()`. No write/transaction/
// batch/callable/Functions/Auth API is constructed or reachable. firebase-admin is lazily required
// inside the adapter closure, so importing this module (and running the offline unit tests) performs
// NO production I/O and pulls no heavy SDK. See docs/operations/truck-registry-backend-verifier.md.

const fsDefault = require("node:fs");
const pathDefault = require("node:path");
const { VerificationError, sha256, assertEvidenceSecretFree } = require("./firestoreDeploymentVerificationShared");
const { EXPECTED_PROJECT, assertGovernedPins, validateTruckTarget, runVerification } = require("./verifyTruckBackend");

// Emulator env vars that MUST NOT be set — production verification must never hit an emulator.
const EMULATOR_ENV_VARS = Object.freeze([
  "FIRESTORE_EMULATOR_HOST",
  "FIREBASE_AUTH_EMULATOR_HOST",
  "FIREBASE_EMULATOR_HUB",
  "FIRESTORE_EMULATOR",
  "FIREBASE_DATABASE_EMULATOR_HOST",
]);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) throw new VerificationError(`unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new VerificationError(`--${key} requires a value`);
    args[key] = value;
    i += 1;
  }
  for (const required of ["config", "evidence-dir", "confirm-project", "verify-date"]) {
    if (!args[required]) throw new VerificationError(`missing required --${required}`);
  }
  return args;
}

function loadConfig(configPath, fs = fsDefault) {
  let raw;
  try { raw = fs.readFileSync(configPath, "utf8"); } catch { throw new VerificationError(`cannot read config: ${configPath}`); }
  let config;
  try { config = JSON.parse(raw); } catch { throw new VerificationError("config is not valid JSON"); }
  return config;
}

// Fail-closed input validation BEFORE any dependency is built or any effect occurs.
function validateCliInputs(config, args) {
  if (args["confirm-project"] !== EXPECTED_PROJECT) throw new VerificationError(`--confirm-project must be ${EXPECTED_PROJECT}`);
  if (config.projectId !== args["confirm-project"]) throw new VerificationError("config.projectId must equal --confirm-project");
  if (config.confirmProject !== config.projectId) throw new VerificationError("config.confirmProject must exactly match config.projectId");
  if (!/^[0-9a-f]{40}$/.test(config.governedCommit || "")) throw new VerificationError("config.governedCommit must be a full 40-character Git SHA");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args["verify-date"])) throw new VerificationError("--verify-date must be YYYY-MM-DD");
  validateTruckTarget(config); // truckId + expected visible values (driver expected null)
  return config;
}

// Refuse any emulator target — production verification only.
function assertNotEmulator(readEnv) {
  for (const name of EMULATOR_ENV_VARS) {
    if (readEnv(name)) throw new VerificationError(`refusing to run: ${name} is set (emulator target); production verification required`);
  }
}

// Require Application Default Credentials, and REFUSE a service-account key file. A key file is
// injected exclusively via GOOGLE_APPLICATION_CREDENTIALS pointing at a JSON key; ADC from
// `gcloud auth application-default login` does NOT set that variable. So its presence = a key file.
function assertAdcOnly(readEnv, config) {
  if (readEnv("GOOGLE_APPLICATION_CREDENTIALS")) {
    throw new VerificationError("refusing a service-account key file (GOOGLE_APPLICATION_CREDENTIALS set); use Application Default Credentials via `gcloud auth application-default login`");
  }
  for (const k of ["keyFile", "credentialsPath", "serviceAccountKeyPath", "serviceAccount"]) {
    if (config && config[k]) throw new VerificationError(`refusing a service-account key file referenced by config.${k}; use Application Default Credentials`);
  }
}

function generatePrefix(crypto) {
  return `trb_gatee4_${crypto.randomBytes(8).toString("hex")}`;
}

// Clean governed checkout: HEAD must equal config.governedCommit and the tree must be clean.
function resolveCheckout(env = {}) {
  const git = env.git || ((args) => require("node:child_process").execFileSync("git", args, { encoding: "utf8" }));
  const head = git(["rev-parse", "HEAD"]).trim();
  const status = git(["status", "--porcelain"]).trim();
  if (status !== "") throw new VerificationError("refusing to run: working tree is not clean (git status --porcelain non-empty)");
  return head;
}

// ATOMIC evidence publication — publish to a unique staging sibling, verify every staged file + its
// checksum round-trips, then rename into place. Refuses to overwrite an existing final directory, so
// the final directory NEVER contains a successful partial report.
function publishEvidenceAtomic(evidenceDir, files, { fs = fsDefault, path = pathDefault, prefix } = {}) {
  if (fs.existsSync(evidenceDir)) throw new VerificationError(`refusing to overwrite existing final evidence directory: ${evidenceDir}`);
  const staging = `${evidenceDir}.staging-${prefix}`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true, mode: 0o700 });
  try {
    const serialized = {};
    const sums = [];
    for (const [name, value] of Object.entries(files)) {
      assertEvidenceSecretFree(value);
      const text = typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`;
      serialized[name] = text;
      fs.writeFileSync(path.join(staging, name), text, { mode: 0o600 });
      sums.push(`${sha256(text)}  ${name}`);
    }
    fs.writeFileSync(path.join(staging, "SHA256SUMS.txt"), `${sums.join("\n")}\n`, { mode: 0o600 });
    const sumsText = fs.readFileSync(path.join(staging, "SHA256SUMS.txt"), "utf8");
    for (const [name, text] of Object.entries(serialized)) {
      const back = fs.readFileSync(path.join(staging, name), "utf8");
      if (back !== text) throw new VerificationError(`staged evidence file corrupt: ${name}`);
      if (!sumsText.includes(`${sha256(text)}  ${name}`)) throw new VerificationError(`staged checksum missing: ${name}`);
    }
    fs.renameSync(staging, evidenceDir);
  } catch (e) {
    try { fs.rmSync(staging, { recursive: true, force: true }); } catch { /* best-effort staging cleanup */ }
    throw e;
  }
  return evidenceDir;
}

// Real production READ-ONLY dependency wiring. The core receives ONLY { getDoc, queryByField } — each
// closure calls exclusively Firestore `.get()`. No write path is constructed or handed out.
function buildReadOnlyDeps(config, { evidenceDir, prefix, env = {} } = {}) {
  const project = config.projectId;
  const getAdmin = env.getAdmin || (() => { const admin = require("firebase-admin"); if (!admin.apps.length) admin.initializeApp({ projectId: project }); return admin; });
  const fs = env.fs || fsDefault;
  const path = env.path || pathDefault;

  const reads = {
    async getDoc(collection, id) {
      const snap = await getAdmin().firestore().collection(collection).doc(id).get();
      return snap.exists ? { id: snap.id, data: snap.data() } : null;
    },
    async queryByField(collection, field, value, limit) {
      const snap = await getAdmin().firestore().collection(collection).where(field, "==", value).limit(limit).get();
      return snap.docs.map((d) => ({ id: d.id, data: d.data() }));
    },
  };
  const publish = async (evidenceFiles) => publishEvidenceAtomic(evidenceDir, evidenceFiles, { fs, path, prefix });
  return { reads, publish };
}

async function main(argv, { fs = fsDefault, crypto = require("node:crypto"), log = console.log, env = {} } = {}) {
  const readEnv = env.readEnv || ((name) => process.env[name]);
  const args = parseArgs(argv);
  const config = validateCliInputs(loadConfig(args.config, fs), args);
  assertNotEmulator(readEnv);
  assertAdcOnly(readEnv, config);
  const targetCommit = resolveCheckout(env);
  assertGovernedPins(config, config.projectId, targetCommit); // clean exact-head pin
  const prefix = generatePrefix(crypto);
  const { reads, publish } = buildReadOnlyDeps(config, { evidenceDir: args["evidence-dir"], prefix, env });
  log(`GATE-E4 BACKEND VERIFY START project=${config.projectId} truck=${config.truckId} commit=${targetCommit} prefix=${prefix}`);
  const result = await runVerification({
    config, targetProject: config.projectId, targetCommit, reads, publish, verifyDate: args["verify-date"], log,
  });
  log(`GATE-E4 BACKEND VERIFY OK checks=${result.passed}/${result.matrixTotal} evidence=${result.evidenceDir}`);
  return result;
}

module.exports = {
  parseArgs,
  loadConfig,
  validateCliInputs,
  assertNotEmulator,
  assertAdcOnly,
  generatePrefix,
  resolveCheckout,
  publishEvidenceAtomic,
  buildReadOnlyDeps,
  main,
  EMULATOR_ENV_VARS,
};

if (require.main === module) {
  main(process.argv.slice(2)).then(() => process.exit(0)).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err && err.message ? err.message : String(err));
    process.exit(1);
  });
}
