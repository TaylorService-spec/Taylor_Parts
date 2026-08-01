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

// Firebase Auth "user not found" — the ONLY error `userExists()` may swallow.
const AUTH_USER_NOT_FOUND = "auth/user-not-found";

// Real production dependency wiring. Every heavy/production module is reached through the injectable
// `env`, so constructing this object performs NO production I/O — the unit tests inject fakes for
// `env` to exercise the REAL adapter logic (persona-provisioning order, the document-id prefix
// query, and userExists error handling) without a live project.
function buildProductionDeps(config, { prefix, evidenceDir, env = {} } = {}) {
  const project = config.projectId;
  const gcloudToken = env.gcloudToken || (() => require("node:child_process").execFileSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8" }).trim());
  const doFetch = env.doFetch || ((...a) => fetch(...a));
  const getAdmin = env.getAdmin || (() => { const admin = require("firebase-admin"); if (!admin.apps.length) admin.initializeApp({ projectId: project }); return admin; });
  const cryptoLib = env.crypto || cryptoDefault;
  const readEnv = env.readEnv || ((name) => process.env[name]);
  const DOC_BASE = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;

  const rules = {
    async fetchLiveSource() {
      const token = gcloudToken();
      const rel = await (await doFetch(`https://firebaserules.googleapis.com/v1/projects/${project}/releases`, { headers: { authorization: `Bearer ${token}` } })).json();
      const matches = (rel.releases || []).filter((r) => r.name.endsWith("cloud.firestore"));
      if (matches.length !== 1) throw new VerificationError(`expected exactly 1 active cloud.firestore release, got ${matches.length}`);
      return (await doFetch(`https://firebaserules.googleapis.com/v1/${matches[0].rulesetName}`, { headers: { authorization: `Bearer ${token}` } })).json();
    },
  };
  const auth = {
    // Records the Auth USER right after creation and the users/{uid} role DOC right after creation —
    // BOTH durable BEFORE sign-in — so a sign-in failure can never orphan an unrecorded resource.
    async provisionPersona(persona, runPrefix, record) {
      const admin = getAdmin();
      const email = `${runPrefix}.${persona}@trc-gatec.invalid`;
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
  const probe = async ({ token, method, target, body }) => {
    const res = await doFetch(`${DOC_BASE}/${target}`, {
      method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return res.status;
  };
  // Collection-list read (getDocs(collection(...))). The Firestore REST list is PAGINATED — it
  // returns up to a page of documents plus a nextPageToken. The verifier must NOT assume these
  // collections are empty: existing truck records could push the seeded record onto a later page.
  // So this follows nextPageToken to exhaustion and accumulates every doc id across all pages.
  // Fails closed on: a non-200 status (denial -> no ids), an unparseable/mis-shaped body, a
  // repeated page token (a server loop), a non-string page token, or exceeding the bounded page
  // limit.
  const LIST_MAX_PAGES = 100;
  const listProbe = async ({ token, collection }) => {
    const ids = [];
    const seenTokens = new Set();
    let pageToken;
    for (let page = 0; ; page += 1) {
      if (page >= LIST_MAX_PAGES) return { status: 200, malformed: true }; // bounded safety limit
      const url = `${DOC_BASE}/${collection}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
      const res = await doFetch(url, { headers: { ...(token ? { authorization: `Bearer ${token}` } : {}) } });
      if (res.status !== 200) return { status: res.status, ids: [] }; // denial (page 0) or a mid-run anomaly
      let body;
      try { body = await res.json(); } catch { return { status: 200, malformed: true }; }
      if (body && body.documents !== undefined && !Array.isArray(body.documents)) return { status: 200, malformed: true };
      const docs = body && Array.isArray(body.documents) ? body.documents : [];
      for (const d of docs) { const id = String(d.name || "").split("/").pop(); if (id) ids.push(id); }
      const next = body ? body.nextPageToken : undefined;
      if (next === undefined || next === null || next === "") break; // last page
      if (typeof next !== "string") return { status: 200, malformed: true }; // malformed token
      if (seenTokens.has(next)) return { status: 200, malformed: true }; // repeated token -> loop -> fail closed
      seenTokens.add(next);
      pageToken = next;
    }
    return { status: 200, ids };
  };
  const admin = {
    async docExists(docPath) { return (await getAdmin().firestore().doc(docPath).get()).exists; },
    async seedDoc(collection, id) { await getAdmin().firestore().collection(collection).doc(id).set({ trc_probe_seed: true, trc_prefix: prefix }); },
    async deleteDoc(docPath) { await getAdmin().firestore().doc(docPath).delete(); },
    async deleteUser(uid) { await getAdmin().auth().deleteUser(uid); },
    // Fail closed: ONLY the specific user-not-found error means "absent"; any other error rethrows.
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
    // Document-id prefix enumeration via the supported FieldPath.documentId() sentinel + orderBy +
    // startAt/endAt bounds ([prefix, prefix + high sentinel] matches ids that begin with prefix).
    async listDocIdsByPrefix(collection, runPrefix) {
      const adminSdk = getAdmin();
      const docId = adminSdk.firestore.FieldPath.documentId();
      const snap = await adminSdk.firestore().collection(collection)
        .orderBy(docId).startAt(runPrefix).endAt(runPrefix + "").get();
      return snap.docs.map((d) => d.id);
    },
  };
  const { writeEvidence } = require("./firestoreDeploymentVerificationShared");
  const evidence = { async write(files) { writeEvidence(evidenceDir, files); } };
  return { rules, auth, probe, listProbe, admin, evidence };
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
