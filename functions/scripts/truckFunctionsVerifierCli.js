"use strict";

// EI Truck Registry — GATE D governed FUNCTIONS-verifier OPERATOR CLI. The reviewed, committed
// entry point that wires the real production dependencies for the pure core in
// verifyTruckFunctionsDeployment.js. It does NOT run merely because it is imported — only an
// explicit `node truckFunctionsVerifierCli.js ...` invocation (with the required confirmation
// arguments + credentials already present in the authenticated operator environment) executes it.
// Production execution stays gated by separate Owner authorization, NOT by a missing implementation.
//
// All real dependencies (firebase-admin, gcloud, the callable HTTPS protocol, an ID token via the
// existing operator credentials) are lazily required INSIDE their adapter closures, so importing
// this module and running its configuration/dry-boundary unit tests touches no production and pulls
// no heavy SDK. It NEVER accepts or emits raw tokens, API keys, secrets or credential material — the
// only evidence it prints is the sanitized report object from the core. See
// docs/operations/truck-registry-functions-deploy-handoff.md for the exact copy-ready invocation.
const fsDefault = require("node:fs");
const pathDefault = require("node:path");
const cryptoDefault = require("node:crypto");
const { VerificationError } = require("./firestoreDeploymentVerificationShared");
const { EXPECTED_PROJECT, EXPECTED_REGION, assertGovernedPins, runVerification } = require("./verifyTruckFunctionsDeployment");
const { CALLABLES, PERSONA_ROLE } = require("./truckFunctionsVerificationMatrix");

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
  for (const required of ["config", "evidence-dir", "recovery-dir", "verify-date", "confirm-project"]) {
    if (!args[required]) throw new VerificationError(`missing required --${required}`);
  }
  return args;
}

function loadConfig(configPath, fs = fsDefault) {
  let raw;
  try { raw = fs.readFileSync(configPath, "utf8"); } catch { throw new VerificationError(`cannot read config: ${configPath}`); }
  try { return JSON.parse(raw); } catch { throw new VerificationError("config is not valid JSON"); }
}

// Fail-closed validation of config + args BEFORE any dependency is built or any effect occurs.
// (The governed-commit / clean-checkout binding is enforced separately in main via resolveCheckout +
// the core's assertGovernedPins, which requires the checkout HEAD to equal config.governedCommit.)
function validateCliInputs(config, args) {
  if (config.projectId !== EXPECTED_PROJECT) throw new VerificationError(`config.projectId must be ${EXPECTED_PROJECT}`);
  if (config.confirmProject !== config.projectId) throw new VerificationError("config.confirmProject must equal config.projectId");
  if (args["confirm-project"] !== EXPECTED_PROJECT) throw new VerificationError(`--confirm-project must be ${EXPECTED_PROJECT}`);
  if (config.projectId !== args["confirm-project"]) throw new VerificationError("config.projectId must equal --confirm-project");
  if (!/^[0-9a-f]{40}$/.test(config.governedCommit || "")) throw new VerificationError("config.governedCommit must be a 40-hex commit SHA");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args["verify-date"])) throw new VerificationError("--verify-date must be YYYY-MM-DD");
  // The ONLY credential input is the Firebase Web API key env var (used for disposable-persona
  // sign-in). Admin SDK access comes from the ambient authenticated operator environment (ADC).
  // Disposable personas are CREATED fresh per run (no pre-existing persona accounts are referenced).
  if (!/^[A-Z][A-Z0-9_]*$/.test(config.webApiKeyEnv || "")) throw new VerificationError("config.webApiKeyEnv must name an environment variable");
  return config;
}

function generatePrefix(crypto = cryptoDefault) {
  return `trf_gated_${crypto.randomBytes(8).toString("hex")}`;
}

// Resolve the operator's checkout: the exact HEAD commit and whether the working tree is clean. Git
// is injected so this is unit-testable; production reads it via `git`. The clean requirement plus the
// core's commit==governedCommit check enforce the runbook's "clean exact-head checkout" rule.
function resolveCheckout(env = {}) {
  const run = env.git || ((argsArr) => require("node:child_process").execFileSync("git", argsArr, { encoding: "utf8" }));
  const commit = run(["rev-parse", "HEAD"]).trim();
  const status = run(["status", "--porcelain"]).trim();
  return { commit, clean: status.length === 0 };
}

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

const AUTH_USER_NOT_FOUND = "auth/user-not-found";

// Canonical callable error status -> sanitized code suffix (lower-hyphen). Unknown/absent -> internal.
function statusToCode(status) {
  if (typeof status !== "string" || status.length === 0) return "internal";
  return status.trim().toLowerCase().replace(/_/g, "-");
}

// Real production dependency wiring. Every heavy/production module is reached through the injectable
// `env`, so constructing this object performs NO production I/O — the unit tests inject fakes for
// `env` to exercise the REAL adapter logic without a live project. It NEVER returns raw tokens/keys.
function buildProductionDeps(config, { prefix, evidenceDir, env = {} } = {}) {
  const project = config.projectId;
  const gcloudJson = env.gcloudJson || ((argsArr) => JSON.parse(require("node:child_process").execFileSync("gcloud", argsArr, { encoding: "utf8" })));
  const doFetch = env.doFetch || ((...a) => fetch(...a));
  const getAdmin = env.getAdmin || (() => { const admin = require("firebase-admin"); if (!admin.apps.length) admin.initializeApp({ projectId: project }); return admin; });
  const cryptoLib = env.crypto || cryptoDefault;
  const readEnv = env.readEnv || ((name) => process.env[name]);
  const callableBase = config.callableBaseUrl || `https://${EXPECTED_REGION}-${project}.cloudfunctions.net`;

  // Export discovery via `gcloud functions list` (read-only). Parses the region from each resource
  // name (…/locations/<region>/functions/<name>) so only us-central1 deployments count as present.
  const discovery = {
    async listFunctions() {
      const raw = gcloudJson(["functions", "list", "--project", project, "--format", "json"]);
      if (!Array.isArray(raw)) throw new VerificationError("gcloud functions list did not return a JSON array.");
      return raw.map((f) => {
        const name = String(f.name || "");
        const shortName = name.split("/").pop();
        const m = name.match(/\/locations\/([^/]+)\//);
        const region = m ? m[1] : (typeof f.region === "string" ? f.region : null);
        return { name: shortName, region };
      });
    },
  };

  // Callable HTTPS protocol invoke. POSTs { data } with a Firebase ID token; a 200 body { result }
  // is success, a non-2xx body { error:{ status } } maps to a sanitized code. Never emits the token.
  const callable = {
    async invoke({ name, token, data }) {
      const res = await doFetch(`${callableBase}/${name}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ data }),
      });
      let body = null;
      try { body = await res.json(); } catch { body = null; }
      if (res.status >= 200 && res.status < 300 && body && body.result !== undefined) {
        return { ok: true, data: body.result };
      }
      const status = body && body.error ? body.error.status : null;
      return { ok: false, code: statusToCode(status) };
    },
  };

  const auth = {
    async provisionPersona(persona, runPrefix, record) {
      const admin = getAdmin();
      const email = `${runPrefix}.${persona}@trf-gated.invalid`;
      const password = cryptoLib.randomBytes(24).toString("base64url");
      const user = await admin.auth().createUser({ email, password, displayName: `${runPrefix}_${persona}` });
      await record({ kind: "USER", ref: user.uid }); // durable immediately after Auth creation
      await admin.firestore().collection("users").doc(user.uid).set({ role: PERSONA_ROLE[persona] });
      await record({ kind: "DOC", ref: `users/${user.uid}` }); // durable immediately after doc creation
      const apiKey = readEnv(config.webApiKeyEnv);
      if (!apiKey) throw new VerificationError(`missing ${config.webApiKeyEnv}`);
      const signIn = await (await doFetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }),
      })).json();
      if (!signIn.idToken) throw new VerificationError(`sign-in failed for ${persona}`); // both resources already recorded
      return { uid: user.uid, token: signIn.idToken };
    },
  };

  const admin = {
    async seedDoc(collection, id, fields) { await getAdmin().firestore().collection(collection).doc(id).set({ ...fields, trf_prefix: prefix }); },
    async docExists(docPath) { return (await getAdmin().firestore().doc(docPath).get()).exists; },
    async deleteDoc(docPath) { await getAdmin().firestore().doc(docPath).delete(); },
    async deleteUser(uid) { await getAdmin().auth().deleteUser(uid); },
    async userExists(uid) {
      try { await getAdmin().auth().getUser(uid); return true; }
      catch (e) { if (e && e.code === AUTH_USER_NOT_FOUND) return false; throw e; }
    },
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
      const adminSdk = getAdmin();
      const docId = adminSdk.firestore.FieldPath.documentId();
      const snap = await adminSdk.firestore().collection(collection).orderBy(docId).startAt(runPrefix).endAt(runPrefix + "").get();
      return snap.docs.map((d) => d.id);
    },
    // auditEvents are keyed by a non-prefixed deterministic id, so the run's audit docs are found by
    // the disposable persona's actorUid instead of by prefix.
    async listAuditIdsByActor(actorUid) {
      const snap = await getAdmin().firestore().collection("auditEvents").where("actorUid", "==", actorUid).get();
      return snap.docs.map((d) => d.id);
    },
  };

  const { writeEvidence } = require("./firestoreDeploymentVerificationShared");
  const evidence = { async write(files) { writeEvidence(evidenceDir, files); } };
  return { discovery, callable, auth, admin, evidence };
}

async function main(argv, { fs = fsDefault, path = pathDefault, crypto = cryptoDefault, env = {}, log = console.log } = {}) {
  const args = parseArgs(argv);
  const config = validateCliInputs(loadConfig(args.config, fs), args);

  // Clean exact-head checkout: the working tree must be clean AND HEAD must equal the reviewed
  // governed commit (the latter enforced inside runVerification's assertGovernedPins).
  const checkout = resolveCheckout(env);
  if (!checkout.clean) throw new VerificationError("working tree is not clean — check out the exact governed commit with no local changes.");
  assertGovernedPins(config, config.projectId, checkout.commit); // fail fast before building deps

  const prefix = generatePrefix(crypto);
  const manifestStore = buildDurableManifestStore({ recoveryDir: args["recovery-dir"], prefix, fs, path });
  const deps = buildProductionDeps(config, { prefix, evidenceDir: args["evidence-dir"], env });
  log(`GATE-D VERIFY START project=${config.projectId} region=${EXPECTED_REGION} callables=${CALLABLES.length} prefix=${prefix} recovery=${manifestStore.file}`);
  const result = await runVerification({
    config, targetProject: config.projectId, targetCommit: checkout.commit, ...deps, manifestStore,
    prefix, verifyDate: args["verify-date"], log,
  });
  log(`GATE-D VERIFY OK matrix_total=${result.matrixTotal} passed=${result.report.passed} residual-docs=${result.residual.residualDocs} residual-users=${result.residual.residualUsers}`);
  return result;
}

module.exports = { parseArgs, loadConfig, validateCliInputs, generatePrefix, resolveCheckout, buildDurableManifestStore, buildProductionDeps, statusToCode, main };

if (require.main === module) {
  main(process.argv.slice(2)).then(() => process.exit(0)).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err && err.message ? err.message : String(err));
    process.exit(1);
  });
}
