"use strict";
// THE FIREBASE TEST-SAFETY GUARD.
//
// ════════════════════ THE INCIDENT THIS EXISTS FOR ════════════════════
//
// Emulator suites were run with FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST unset. The
// Admin SDK then did what it does outside an emulator: it looked for Application Default
// Credentials, found the operator's real ones in ~/.config/gcloud, and tried to reach Google --
// with test files that initialized the SDK as `projectId: "taylor-parts"` (production). Nothing in
// the test fleet stood between "the emulator is not configured" and "talk to the real project".
//
// ════════════════════ WHAT THIS IS ════════════════════
//
// ONE shared boundary, loaded as the FIRST import of every functions test file that touches the
// Firebase Admin SDK (enforced by test/firebaseTestGuardCoverage.test.mjs, so a new test cannot slip
// past), before any SDK module is evaluated. It never falls back: every refusal prints one clear
// message and exits non-zero immediately.
//
//   (1) EMULATOR MODE (firebaseEmulatorGuard.cjs) requires the caller to name the emulator
//       explicitly -- FIRESTORE_EMULATOR_HOST and/or FIREBASE_AUTH_EMULATOR_HOST, loopback only.
//       An emulator variable the caller did NOT set is pinned to a closed loopback port, so a suite
//       that reaches for a service it was not given fails locally instead of reaching Google.
//       OFFLINE MODE (firebaseOfflineGuard.cjs) is for tests that load the SDK for value classes
//       (Timestamp) or fakes and never talk to a server: it leaves emulator variables alone (several
//       operator tools refuse differently when one is set) but still refuses a non-loopback one.
//   (2) The project the SDK is initialized for must be a Firebase `demo-` project. EVERY governed
//       project id -- read from config/environments.json and .firebaserc, plus a fixed floor -- is
//       refused by name. This is enforced at the SDK itself: AppStore.initializeApp (the one path
//       both `admin.initializeApp` and `initializeApp` from firebase-admin/app go through) is
//       wrapped the moment the SDK's lifecycle module is compiled, so no test can initialize a real
//       project id however it spells it. A governed id held as DATA (GCLOUD_PROJECT set inside a
//       test to exercise environment behaviour) is fine; it just can never be the SDK's project.
//   (3) Application Default Credentials are neutralized for this process AND its children:
//       GOOGLE_APPLICATION_CREDENTIALS is removed (firebase-admin reads it eagerly and would throw on
//       a missing path), HOME and CLOUDSDK_CONFIG point at a fresh empty directory (so the well-known
//       ~/.config/gcloud/application_default_credentials.json cannot be found -- both firebase-admin
//       and google-auth-library look for it under $HOME), and GCE metadata detection is disabled.
//       A real credential variable set by the caller is REFUSED, not overridden -- that is an
//       operator mistake worth surfacing.
//   (4) Child processes inherit the guard through NODE_OPTIONS (--require), so an operator script a
//       test spawns is held to the same rules.
//   (5) No egress: a guarded process can open TCP connections to loopback only (see installEgressBlock).
//
// Plain CommonJS on purpose: CJS test files `require` it, ESM test files `import` it, and
// `node --require` can preload it -- one file, every loader.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const REFUSAL_PREFIX = "FIREBASE TEST GUARD REFUSED";
const STATE_KEY = Symbol.for("eos.firebaseTestGuard");
const ACTIVE_ENV = "EOS_FIREBASE_TEST_GUARD_ACTIVE"; // set for children: "<mode>"
const OWNED_HOME_ENV = "EOS_FIREBASE_TEST_GUARD_HOME";
const DEAD_LOOPBACK = "127.0.0.1:9"; // the discard port: nothing listens on it in a test environment
const EMULATOR_VARS = ["FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST"];
const PROJECT_ENV_VARS = ["GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT", "GCP_PROJECT"];
const DEMO_PROJECT = /^demo-[a-z0-9][a-z0-9-]*$/;
const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\]):[0-9]{1,5}$/;

// Variables that carry, or point at, a real credential. Refused when set; never overridden.
const CREDENTIAL_VARS = [
  "GOOGLE_OAUTH_ACCESS_TOKEN",
  "CLOUDSDK_AUTH_ACCESS_TOKEN",
  "CLOUDSDK_AUTH_ACCESS_TOKEN_FILE",
  "CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE",
  "FIREBASE_TOKEN",
  "GOOGLE_CREDENTIALS",
  "GOOGLE_CLOUD_KEYFILE_JSON",
  "GCLOUD_KEYFILE_JSON",
  "SANDBOX_CREDENTIALS_FILE",
];
const CREDENTIAL_VAR_PATTERNS = [/^FIREBASE_SERVICE_ACCOUNT/];

// The floor: refused even if the registries below cannot be read or stop naming them.
const GOVERNED_PROJECT_FLOOR = ["taylor-parts", "eos-platform-sandbox", "eos-platform-certification"];

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function refuse(message) {
  const text = `${REFUSAL_PREFIX}: ${message}\n`
    + "  No Firebase SDK was initialized and nothing was contacted. Firebase-dependent tests run ONLY against\n"
    + "  local emulators with a demo- project, e.g.:\n"
    + "    FIRESTORE_EMULATOR_HOST=127.0.0.1:<port> FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:<port> node <test>\n"
    + "  (see functions/test/support/firebaseTestGuard.cjs)\n";
  try { fs.writeSync(2, text); } catch { /* stderr closed: the exit code still refuses */ }
  process.exit(1);
}

/** Every project id this repository governs. Unreadable registry = refuse (fail closed). */
function governedProjectIds(repoRoot = REPO_ROOT) {
  const ids = new Set(GOVERNED_PROJECT_FLOOR);
  let registry;
  let firebaserc;
  try {
    registry = JSON.parse(fs.readFileSync(path.join(repoRoot, "config", "environments.json"), "utf8"));
    firebaserc = JSON.parse(fs.readFileSync(path.join(repoRoot, ".firebaserc"), "utf8"));
  } catch (err) {
    refuse(`cannot read the governed project registries (config/environments.json, .firebaserc): ${err.message}`);
  }
  for (const env of registry.environments ?? []) {
    const id = env?.firebase?.projectId;
    if (typeof id === "string" && id.length > 0) ids.add(id);
  }
  for (const id of Object.values(firebaserc.projects ?? {})) if (typeof id === "string" && id.length > 0) ids.add(id);
  for (const id of Object.keys(firebaserc.targets ?? {})) if (id.length > 0) ids.add(id);
  return ids;
}

function assertDemoProject(projectId, where, governed) {
  if (typeof projectId !== "string" || projectId.length === 0) {
    refuse(`${where}: no project id. The SDK would discover one from ambient credentials; a test must name a demo- project explicitly.`);
  }
  if (governed.has(projectId)) {
    refuse(`${where}: "${projectId}" is a governed (real) Firebase project. Tests may hold it as data, never as the SDK's project.`);
  }
  if (!DEMO_PROJECT.test(projectId)) {
    refuse(`${where}: "${projectId}" is not a Firebase demo project. Use the "demo-" prefix (e.g. demo-eos-test).`);
  }
}

function firebaseConfigProject(env) {
  const raw = env.FIREBASE_CONFIG;
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    const parsed = JSON.parse(raw.trim().startsWith("{") ? raw : fs.readFileSync(raw, "utf8"));
    return typeof parsed.projectId === "string" ? parsed.projectId : null;
  } catch {
    refuse("FIREBASE_CONFIG is set but unreadable; refusing rather than guessing the project.");
  }
  return null;
}

function checkCredentials(env) {
  for (const name of Object.keys(env)) {
    if (!env[name]) continue;
    if (CREDENTIAL_VARS.includes(name) || CREDENTIAL_VAR_PATTERNS.some((p) => p.test(name))) {
      refuse(`${name} is set. A real credential must never reach a test process; unset it.`);
    }
  }
  const gac = env.GOOGLE_APPLICATION_CREDENTIALS;
  if (gac) {
    refuse(`GOOGLE_APPLICATION_CREDENTIALS is set (${gac}). A real credential must never reach a test process; unset it.`);
  }
  const cloudsdk = env.CLOUDSDK_CONFIG;
  if (cloudsdk && cloudsdk !== env[OWNED_HOME_ENV]) {
    if (fs.existsSync(path.join(cloudsdk, "application_default_credentials.json"))) {
      refuse(`CLOUDSDK_CONFIG (${cloudsdk}) holds Application Default Credentials. Unset it.`);
    }
  }
}

function neutralizeAdc(env) {
  // GOOGLE_APPLICATION_CREDENTIALS is REMOVED, not pointed at a missing file: firebase-admin reads that
  // variable eagerly inside initializeApp() and throws ENOENT, which would break every emulator
  // suite. The caller's value was already refused above, so there is nothing real to remove.
  delete env.GOOGLE_APPLICATION_CREDENTIALS;
  // Both firebase-admin and google-auth-library find the well-known ADC file at
  // $HOME/.config/gcloud/application_default_credentials.json (neither reads CLOUDSDK_CONFIG), so
  // HOME itself is pointed at a fresh empty directory. CLOUDSDK_CONFIG follows it for any gcloud child.
  let dir = env[OWNED_HOME_ENV];
  if (!(dir && env.HOME === dir && env.CLOUDSDK_CONFIG === dir && fs.existsSync(dir))) {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "eos-firebase-test-guard-home-"));
    const created = dir;
    process.once("exit", () => { try { fs.rmSync(created, { recursive: true, force: true }); } catch { /* best effort */ } });
  }
  if (fs.existsSync(path.join(dir, ".config", "gcloud", "application_default_credentials.json"))
      || fs.existsSync(path.join(dir, "application_default_credentials.json"))) {
    refuse(`the neutral HOME directory (${dir}) holds Application Default Credentials.`);
  }
  env.HOME = dir;
  env.CLOUDSDK_CONFIG = dir;
  env[OWNED_HOME_ENV] = dir;
  // No GCE metadata server either: google-auth-library would otherwise probe it for credentials.
  env.METADATA_SERVER_DETECTION = "none";
  env.GCE_METADATA_HOST = DEAD_LOOPBACK;
  env.GCE_METADATA_IP = DEAD_LOOPBACK;
}

function checkEmulatorHosts(env, mode, isChild) {
  const explicit = [];
  for (const name of EMULATOR_VARS) {
    const value = env[name];
    if (value === undefined || value === "") continue;
    if (!LOOPBACK_HOST.test(value)) refuse(`${name}=${value} is not a loopback emulator address (127.0.0.1 / localhost only).`);
    if (value !== DEAD_LOOPBACK) explicit.push(name);
  }
  if (mode !== "emulator") return;
  if (explicit.length === 0 && !isChild) {
    refuse("emulator mode requires FIRESTORE_EMULATOR_HOST and/or FIREBASE_AUTH_EMULATOR_HOST to be set explicitly "
      + "(127.0.0.1:<port>). Neither is set, so the Admin SDK would reach real Google services.");
  }
  // A service the caller did not name an emulator for goes nowhere, rather than to Google.
  for (const name of EMULATOR_VARS) if (!env[name]) env[name] = DEAD_LOOPBACK;
}

function checkProjectEnv(env, governed) {
  for (const name of PROJECT_ENV_VARS) {
    if (env[name]) assertDemoProject(env[name], `${name} in the caller's environment`, governed);
  }
  const cfg = firebaseConfigProject(env);
  if (cfg) assertDemoProject(cfg, "FIREBASE_CONFIG.projectId", governed);
}

const LIFECYCLE_FILE = /[\\/]firebase-admin[\\/]lib[\\/]app[\\/]lifecycle\.js$/;

/** Wrap AppStore.initializeApp the moment firebase-admin's lifecycle module is compiled. */
function installSdkInitializationGate(state) {
  const patch = (exportsObject, filename) => {
    const proto = exportsObject?.AppStore?.prototype;
    if (!proto || typeof proto.initializeApp !== "function" || proto.initializeApp[STATE_KEY]) return;
    const original = proto.initializeApp;
    const gated = function guardedInitializeApp(options, appName) {
      const projectId = (options && options.projectId)
        || PROJECT_ENV_VARS.map((n) => process.env[n]).find(Boolean)
        || firebaseConfigProject(process.env);
      assertDemoProject(projectId, `initializeApp(${appName === undefined ? "" : JSON.stringify(appName)})`, state.governed);
      state.initializedProjects.push(projectId);
      return original.call(this, options, appName);
    };
    gated[STATE_KEY] = true;
    proto.initializeApp = gated;
    state.gatedLifecycleModules.push(filename);
  };
  const originalJs = Module._extensions[".js"];
  Module._extensions[".js"] = function guardedJsLoader(module, filename) {
    const result = originalJs.call(this, module, filename);
    if (LIFECYCLE_FILE.test(filename)) patch(module.exports, filename);
    return result;
  };
  // A lifecycle module already compiled before the guard (should never happen: the guard is the first
  // import) is patched in place rather than silently left ungated.
  for (const [filename, cached] of Object.entries(require.cache)) {
    if (LIFECYCLE_FILE.test(filename)) patch(cached.exports, filename);
  }
}

// ════════════════════ (5) NO EGRESS ════════════════════
// Belt and braces under (1)-(3): a guarded process cannot open a TCP connection to anything but loopback. Every
// client the SDKs use (http/https, TLS, HTTP/2 for gRPC, undici's fetch) connects through net.Socket#connect, so a
// test that would have reached a Google endpoint -- a token server, a public-key URL, a real Firestore -- fails
// locally and at once instead. Loopback (emulators, the local PostgreSQL) and Unix sockets are untouched.
const LOOPBACK_TARGET = /^(127\.\d+\.\d+\.\d+|localhost|::1|\[::1\]|::ffff:127\.\d+\.\d+\.\d+)$/i;
function installEgressBlock(state) {
  const net = require("node:net");
  const original = net.Socket.prototype.connect;
  if (original[STATE_KEY]) return;
  const blocked = function guardedConnect(...args) {
    let options = args[0];
    if (Array.isArray(options)) options = options[0]; // internal normalized form
    let host;
    let isPath = false;
    if (options && typeof options === "object") {
      if (typeof options.path === "string") isPath = true;
      host = options.host ?? options.hostname ?? "localhost";
    } else if (typeof options === "string" && !/^\d+$/.test(options)) {
      isPath = true; // connect(path)
    } else {
      host = typeof args[1] === "string" ? args[1] : "localhost"; // connect(port[, host])
    }
    if (!isPath && !LOOPBACK_TARGET.test(String(host))) {
      state.blockedConnections.push(String(host));
      const err = Object.assign(new Error(`${REFUSAL_PREFIX}: outbound network to ${host} is blocked in a guarded test process (loopback only)`), { code: "EOS_TEST_EGRESS_BLOCKED" });
      process.nextTick(() => this.destroy(err));
      return this;
    }
    return original.apply(this, args);
  };
  blocked[STATE_KEY] = true;
  net.Socket.prototype.connect = blocked;
}

function propagateToChildren(env, mode) {
  env[ACTIVE_ENV] = mode;
  const entry = path.join(__dirname, mode === "emulator" ? "firebaseEmulatorGuard.cjs" : "firebaseOfflineGuard.cjs");
  const flag = `--require "${entry}"`;
  const current = env.NODE_OPTIONS ?? "";
  if (!current.includes(entry)) env.NODE_OPTIONS = `${current} ${flag}`.trim();
}

/**
 * Enforce the guard for this process. Idempotent; a later, stricter mode (offline -> emulator)
 * re-runs the emulator checks.
 */
function enforce(mode) {
  if (mode !== "emulator" && mode !== "offline") refuse(`unknown guard mode ${JSON.stringify(mode)}`);
  const existing = globalThis[STATE_KEY];
  if (existing && (existing.mode === mode || existing.mode === "emulator")) return existing;

  const env = process.env;
  const isChild = Boolean(env[ACTIVE_ENV]);
  const governed = governedProjectIds();

  checkCredentials(env);
  checkEmulatorHosts(env, mode, isChild);
  // A governed id the CALLER exported is refused. Inside a child, the project variables are the
  // parent test's DATA (set after its own guard ran); the SDK gate below still refuses them as the
  // SDK's project.
  if (!isChild) checkProjectEnv(env, governed);
  neutralizeAdc(env);

  const state = existing ?? { governed, initializedProjects: [], gatedLifecycleModules: [], blockedConnections: [] };
  state.mode = mode;
  state.governed = governed;
  if (!existing) { installSdkInitializationGate(state); installEgressBlock(state); }
  propagateToChildren(env, mode);
  globalThis[STATE_KEY] = state;
  return state;
}

module.exports = {
  enforce,
  governedProjectIds,
  REFUSAL_PREFIX,
  STATE_KEY,
  OWNED_HOME_ENV,
  DEAD_LOOPBACK,
  GOVERNED_PROJECT_FLOOR,
  CREDENTIAL_VARS,
};
