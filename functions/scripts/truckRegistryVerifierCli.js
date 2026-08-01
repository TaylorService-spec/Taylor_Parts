"use strict";

// EI Truck Registry — GOVERNED smoke-verifier OPERATOR CLI (Gate C). This is the reviewed,
// committed entry point that wires the real production dependencies for the pure core in
// verifyTruckRegistryDeployment.js. It does NOT run merely because it is imported — only an
// explicit `node truckRegistryVerifierCli.js ...` invocation (with the required confirmation
// arguments and credentials in the environment) executes it. Production execution remains gated by
// separate Owner authorization, NOT by a missing implementation.
//
// All real dependencies (firebase-admin, the Firebase Rules/Firestore REST APIs, a gcloud access
// token) are lazily required INSIDE their adapter closures, so importing this module and running
// its configuration-validation / dry-boundary unit tests touches no production and pulls no heavy
// SDK. See docs/operations/truck-registry-smoke-verifier.md for the exact copy-ready invocation.
const fsDefault = require("node:fs");
const pathDefault = require("node:path");
const cryptoDefault = require("node:crypto");
const { VerificationError } = require("./firestoreDeploymentVerificationShared");
const {
  EXPECTED_PROJECT,
  assertGovernedPins,
  runVerification,
} = require("./verifyTruckRegistryDeployment");

const PERSONA_ROLE = Object.freeze({ admin: "admin", dispatcher: "dispatcher", technician: "technician" });

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
  for (const required of ["config", "evidence-dir", "recovery-dir", "recapture-date", "confirm-project"]) {
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

// Fail-closed validation BEFORE any dependency is built or any effect occurs.
function validateCliInputs(config, args) {
  assertGovernedPins(config, config.projectId); // pins the compiled hash + authorized project + confirmProject
  if (args["confirm-project"] !== EXPECTED_PROJECT) throw new VerificationError(`--confirm-project must be ${EXPECTED_PROJECT}`);
  if (config.projectId !== args["confirm-project"]) throw new VerificationError("config.projectId must equal --confirm-project");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args["recapture-date"])) throw new VerificationError("--recapture-date must be YYYY-MM-DD");
  if (!/^[A-Z][A-Z0-9_]*$/.test(config.webApiKeyEnv || "")) throw new VerificationError("config.webApiKeyEnv must name an environment variable");
  const labels = (config.personas || []).map((p) => p.label).sort();
  if (labels.join(",") !== "admin,dispatcher,technician") throw new VerificationError("config.personas must be exactly admin, dispatcher, technician");
  for (const p of config.personas) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(p.emailEnv || "") || !/^[A-Z][A-Z0-9_]*$/.test(p.passwordEnv || "")) {
      throw new VerificationError(`persona ${p.label} must reference email/password environment variables`);
    }
  }
  return config;
}

function generatePrefix(crypto = cryptoDefault) {
  return `trc_gatec_${crypto.randomBytes(8).toString("hex")}`;
}

// Durable, protected operator RECOVERY state — kept OUTSIDE the sanitized evidence dir (it holds
// temporary uids/fixture identities). Each entry is flushed immediately; the file is retained on
// failure and only marked complete when cleanup + residual verification both succeed.
function buildDurableManifestStore({ recoveryDir, prefix, fs = fsDefault, path = pathDefault }) {
  fs.mkdirSync(recoveryDir, { recursive: true, mode: 0o700 });
  const file = path.join(recoveryDir, `manifest-${prefix}.recovery.jsonl`);
  const statusFile = path.join(recoveryDir, `manifest-${prefix}.status`);
  fs.writeFileSync(file, "", { mode: 0o600 });
  return {
    file,
    statusFile,
    async append(entry) { fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 }); },
    async retain() { fs.writeFileSync(statusFile, `RETAINED-FOR-RECOVERY ${prefix}\n`, { mode: 0o600 }); },
    async complete() { fs.writeFileSync(statusFile, `COMPLETE ${prefix}\n`, { mode: 0o600 }); },
  };
}

// Real production dependency wiring. Every adapter lazily requires its heavy/production module, so
// constructing this object performs NO production I/O (unit tests assert only its shape).
function buildProductionDeps(config, { prefix, evidenceDir }) {
  const gcloudToken = () => require("node:child_process").execFileSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8" }).trim();
  const project = config.projectId;
  const getAdmin = () => {
    const admin = require("firebase-admin");
    if (!admin.apps.length) admin.initializeApp({ projectId: project });
    return admin;
  };
  const DOC_BASE = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;

  const rules = {
    async fetchLiveSource() {
      const token = gcloudToken();
      const rel = await (await fetch(`https://firebaserules.googleapis.com/v1/projects/${project}/releases`, { headers: { authorization: `Bearer ${token}` } })).json();
      const matches = (rel.releases || []).filter((r) => r.name.endsWith("cloud.firestore"));
      if (matches.length !== 1) throw new VerificationError(`expected exactly 1 active cloud.firestore release, got ${matches.length}`);
      return (await fetch(`https://firebaserules.googleapis.com/v1/${matches[0].rulesetName}`, { headers: { authorization: `Bearer ${token}` } })).json();
    },
  };
  const auth = {
    async provisionPersona(persona, runPrefix) {
      const admin = getAdmin();
      const email = `${runPrefix}.${persona}@trc-gatec.invalid`;
      const password = cryptoDefault.randomBytes(24).toString("base64url");
      const user = await admin.auth().createUser({ email, password, displayName: `${runPrefix}_${persona}` });
      await admin.firestore().collection("users").doc(user.uid).set({ role: PERSONA_ROLE[persona] });
      const apiKey = process.env[config.webApiKeyEnv];
      if (!apiKey) throw new VerificationError(`missing ${config.webApiKeyEnv}`);
      const signIn = await (await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }),
      })).json();
      if (!signIn.idToken) throw new VerificationError(`sign-in failed for ${persona}`);
      return { uid: user.uid, token: signIn.idToken, docs: [`users/${user.uid}`] };
    },
  };
  const probe = async ({ token, method, target, body }) => {
    const res = await fetch(`${DOC_BASE}/${target}`, {
      method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return res.status;
  };
  const admin = {
    async docExists(docPath) { return (await getAdmin().firestore().doc(docPath).get()).exists; },
    async seedDoc(collection, id) { await getAdmin().firestore().collection(collection).doc(id).set({ trc_probe_seed: true }); },
    async deleteDoc(docPath) { await getAdmin().firestore().doc(docPath).delete(); },
    async deleteUser(uid) { await getAdmin().auth().deleteUser(uid); },
    async userExists(uid) { try { await getAdmin().auth().getUser(uid); return true; } catch { return false; } },
    async listUsersByPrefix(runPrefix) {
      const out = [];
      let pageToken;
      do {
        const page = await getAdmin().auth().listUsers(1000, pageToken);
        for (const u of page.users) if ((u.displayName || "").includes(runPrefix) || (u.email || "").includes(runPrefix)) out.push(u.uid);
        pageToken = page.pageToken;
      } while (pageToken);
      return out;
    },
    async listDocIdsByPrefix(collection, runPrefix) {
      const snap = await getAdmin().firestore().collection(collection)
        .where("__name__", ">=", `${collection}/${runPrefix}`).where("__name__", "<", `${collection}/${runPrefix}`).get();
      return snap.docs.map((d) => d.id);
    },
  };
  const { writeEvidence } = require("./firestoreDeploymentVerificationShared");
  const evidence = { async write(files) { writeEvidence(evidenceDir, files); } };
  return { rules, auth, probe, admin, evidence };
}

async function main(argv, { fs = fsDefault, path = pathDefault, crypto = cryptoDefault, log = console.log } = {}) {
  const args = parseArgs(argv);
  const config = validateCliInputs(loadConfig(args.config, fs), args);
  const prefix = generatePrefix(crypto);
  const manifestStore = buildDurableManifestStore({ recoveryDir: args["recovery-dir"], prefix, fs, path });
  const deps = buildProductionDeps(config, { prefix, evidenceDir: args["evidence-dir"] });
  log(`GATE-C RECAPTURE START project=${config.projectId} prefix=${prefix} recovery=${manifestStore.file}`);
  const result = await runVerification({
    config, targetProject: config.projectId, ...deps, manifestStore,
    prefix, recaptureDate: args["recapture-date"], log,
  });
  log(`GATE-C RECAPTURE OK matrix_total=${result.matrixTotal} passed=${result.smokeResults.passed} failed=${result.smokeResults.failed} residual-docs=${result.residual.residualDocs} residual-users=${result.residual.residualUsers}`);
  return result;
}

module.exports = { parseArgs, loadConfig, validateCliInputs, generatePrefix, buildDurableManifestStore, buildProductionDeps, main, PERSONA_ROLE };

if (require.main === module) {
  main(process.argv.slice(2)).then(() => process.exit(0)).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err && err.message ? err.message : String(err));
    process.exit(1);
  });
}
