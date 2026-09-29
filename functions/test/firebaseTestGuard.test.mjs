// REGRESSION: the Firebase test-safety guard (test/support/firebaseTestGuard.cjs) fails CLOSED.
//
// Plain node. NO real SDK, NO network: every child process below imports a FAKE `firebase-admin`
// package written into a temp directory, whose only behaviour is to record -- in a probe log -- that
// it was evaluated and that its AppStore.initializeApp ran. The fake reproduces the one shape the
// guard depends on (lib/app/lifecycle.js exporting AppStore), so what is proven here is the guard's
// own behaviour, not the SDK's.
//
//   (a) missing emulator configuration -> REFUSE before any SDK module is evaluated. Proven with a
//       Module._load probe (and an ESM resolve probe where the runtime has module.registerHooks):
//       firebase-admin is never loaded, never evaluated, initializeApp never runs. A positive control
//       proves the probe DOES see the SDK when the guard is absent -- a probe that cannot fire proves
//       nothing.
//   (b) a real (governed) project id -> REFUSE, whether it reaches initializeApp or arrives through the
//       caller's environment; a demo- project is accepted.
//   (c) Application Default Credentials are neutralized in the guarded process and inherited by its
//       children; a real credential variable is refused rather than overridden.
//   (e) no egress: a guarded process cannot open a TCP connection to anything but loopback. (Proven
//       against TEST-NET / reserved names: the connection is refused before any packet or DNS lookup.)
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUPPORT = path.join(HERE, "support");
const EMULATOR_ENTRY = path.join(SUPPORT, "firebaseEmulatorGuard.cjs");
const OFFLINE_ENTRY = path.join(SUPPORT, "firebaseOfflineGuard.cjs");
const require = createRequire(import.meta.url);
const guard = require("./support/firebaseTestGuard.cjs");

const WORK = mkdtempSync(path.join(tmpdir(), "eos-firebase-guard-regression-"));
test.after(() => rmSync(WORK, { recursive: true, force: true }));

// ── the fake SDK ─────────────────────────────────────────────────────────────────────────────────────
const FAKE = path.join(WORK, "node_modules", "firebase-admin");
mkdirSync(path.join(FAKE, "lib", "app"), { recursive: true });
writeFileSync(path.join(FAKE, "package.json"), JSON.stringify({ name: "firebase-admin", version: "0.0.0-fake", main: "lib/index.js" }));
writeFileSync(path.join(FAKE, "lib", "index.js"), [
  '"use strict";',
  'require("node:fs").appendFileSync(process.env.PROBE_LOG, "SDK-EVALUATED\\n");',
  'const lifecycle = require("./app/lifecycle.js");',
  "module.exports = { initializeApp: (options, name) => lifecycle.defaultAppStore.initializeApp(options, name) };",
].join("\n"));
writeFileSync(path.join(FAKE, "lib", "app", "lifecycle.js"), [
  '"use strict";',
  "class AppStore {",
  "  initializeApp(options, name) {",
  '    require("node:fs").appendFileSync(process.env.PROBE_LOG, "SDK-INITIALIZED:" + String(options && options.projectId) + "\\n");',
  "    return { name: name || \"[DEFAULT]\", options };",
  "  }",
  "}",
  "exports.AppStore = AppStore;",
  "exports.defaultAppStore = new AppStore();",
].join("\n"));

// ── the probes ───────────────────────────────────────────────────────────────────────────────────────
// Module._load sees every CommonJS load; the resolve hook (module.registerHooks, Node >= 22.15) sees
// every ESM resolution. Both record any specifier or resolved file naming the SDK.
const PROBE = path.join(WORK, "probe.cjs");
writeFileSync(PROBE, [
  '"use strict";',
  'const Module = require("node:module");',
  'const fs = require("node:fs");',
  "const SDK = /firebase-admin|@google-cloud/;",
  "const log = (line) => fs.appendFileSync(process.env.PROBE_LOG, line + \"\\n\");",
  "const original = Module._load;",
  "Module._load = function probedLoad(request, parent, isMain) {",
  "  let file = request;",
  "  try { file = Module._resolveFilename(request, parent, isMain); } catch { /* reported by the real load */ }",
  '  if (SDK.test(request) || SDK.test(file)) log("MODULE_LOAD:" + request);',
  "  return original.apply(this, arguments);",
  "};",
  'if (typeof Module.registerHooks === "function") {',
  "  Module.registerHooks({ resolve(specifier, context, next) {",
  '    if (SDK.test(specifier)) log("ESM_RESOLVE:" + specifier);',
  "    return next(specifier, context);",
  "  } });",
  '  log("RESOLVE_PROBE_ACTIVE");',
  "}",
].join("\n"));

// ── fixtures (sources assembled from strings so the coverage scanner never mistakes them for imports)
function fixture(name, lines) {
  const file = path.join(WORK, name);
  writeFileSync(file, lines.join("\n"));
  return file;
}
const GUARDED = fixture("guarded.mjs", [
  `import ${JSON.stringify(EMULATOR_ENTRY)};`,
  'import admin from "firebase-admin";',
  "const projectId = process.env.FIXTURE_PROJECT === \"<none>\" ? undefined : process.env.FIXTURE_PROJECT;",
  "admin.initializeApp(projectId === undefined ? undefined : { projectId });",
  'console.log("FIXTURE-REACHED-END");',
]);
const UNGUARDED = fixture("unguarded.mjs", [
  'import admin from "firebase-admin";',
  'admin.initializeApp({ projectId: "demo-eos-test" });',
  'console.log("FIXTURE-REACHED-END");',
]);
const PRELOADED = fixture("preloaded.mjs", [
  'import admin from "firebase-admin";',
  'admin.initializeApp({ projectId: "demo-eos-test" });',
  'console.log("FIXTURE-REACHED-END");',
]);
const ENV_REPORT = fixture("envReport.mjs", [
  `import ${JSON.stringify(OFFLINE_ENTRY)};`,
  'import { existsSync, readdirSync } from "node:fs";',
  'import { homedir } from "node:os";',
  'import { join } from "node:path";',
  'import { spawnSync } from "node:child_process";',
  "const pick = (env) => ({",
  "  GOOGLE_APPLICATION_CREDENTIALS: env.GOOGLE_APPLICATION_CREDENTIALS ?? null,",
  "  HOME: env.HOME, CLOUDSDK_CONFIG: env.CLOUDSDK_CONFIG ?? null,",
  "  METADATA_SERVER_DETECTION: env.METADATA_SERVER_DETECTION ?? null, NODE_OPTIONS: env.NODE_OPTIONS ?? \"\",",
  "});",
  "const wellKnown = join(homedir(), \".config\", \"gcloud\", \"application_default_credentials.json\");",
  "const child = spawnSync(process.execPath, [\"-e\", \"process.stdout.write(JSON.stringify({ HOME: process.env.HOME, GAC: process.env.GOOGLE_APPLICATION_CREDENTIALS ?? null, guard: typeof globalThis[Symbol.for('eos.firebaseTestGuard')] }))\"], { encoding: \"utf8\" });",
  "console.log(JSON.stringify({ self: pick(process.env), homedir: homedir(), wellKnownExists: existsSync(wellKnown),",
  "  cloudsdkEntries: readdirSync(process.env.CLOUDSDK_CONFIG).length, child: JSON.parse(child.stdout || \"null\"), childStatus: child.status }));",
]);

// ── runner ───────────────────────────────────────────────────────────────────────────────────────────
// The child's environment is built from scratch: nothing ambient (no real HOME, no real credential,
// no emulator) leaks in unless a case puts it there.
function run(file, { env = {}, preload = [] } = {}) {
  const log = path.join(WORK, `probe-${Math.random().toString(36).slice(2)}.log`);
  writeFileSync(log, "");
  const args = [...preload.flatMap((p) => ["--require", p]), file];
  const r = spawnSync(process.execPath, args, {
    cwd: WORK,
    encoding: "utf8",
    timeout: 30000,
    env: { PATH: process.env.PATH, HOME: env.HOME ?? WORK, PROBE_LOG: log, ...env },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, probe: readFileSync(log, "utf8") };
}
const REFUSED = new RegExp(`^${guard.REFUSAL_PREFIX}:`, "m");
const assertNoSdk = (r, label) => {
  assert.doesNotMatch(r.probe, /MODULE_LOAD:|SDK-EVALUATED|SDK-INITIALIZED/, `${label}: the SDK must never be loaded\n${r.probe}`);
  assert.doesNotMatch(r.stdout, /FIXTURE-REACHED-END/, `${label}: the test body must never run`);
};

// ════════════════════ (a) missing emulator config: refuse BEFORE the SDK loads ════════════════════

test("control: WITHOUT the guard the probe sees the SDK load, evaluate and initialize", () => {
  const r = run(UNGUARDED, { preload: [PROBE] });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.probe, /SDK-EVALUATED/);
  assert.match(r.probe, /SDK-INITIALIZED:demo-eos-test/);
  assert.match(r.probe, /MODULE_LOAD:|ESM_RESOLVE:firebase-admin/, "the probe must be able to see the SDK, or its silence below proves nothing");
});

// In-file form (the guard is the file's first import): ESM links the graph before evaluating it, so
// the `firebase-admin` SPECIFIER is resolved -- but no SDK file is ever loaded (no Module._load of it)
// or evaluated, and initializeApp never runs. The preloaded form below does not even resolve it.
test("(a) no emulator variables: the guard refuses, non-zero, and firebase-admin is never loaded", () => {
  const r = run(GUARDED, { preload: [PROBE], env: { FIXTURE_PROJECT: "demo-eos-test" } });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, REFUSED);
  assert.match(r.stderr, /FIRESTORE_EMULATOR_HOST and\/or FIREBASE_AUTH_EMULATOR_HOST/);
  assertNoSdk(r, "missing emulator");
});

test("(a) preloaded with --require (the package-script form): refused before the SDK is even RESOLVED", () => {
  const r = run(PRELOADED, { preload: [PROBE, EMULATOR_ENTRY] });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, REFUSED);
  assertNoSdk(r, "preload");
  if (/RESOLVE_PROBE_ACTIVE/.test(r.probe)) assert.doesNotMatch(r.probe, /ESM_RESOLVE:/, "not even resolved");
});

test("(a) an empty emulator variable is not configuration", () => {
  const r = run(GUARDED, { preload: [PROBE], env: { FIXTURE_PROJECT: "demo-eos-test", FIRESTORE_EMULATOR_HOST: "" } });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, REFUSED);
  assertNoSdk(r, "empty emulator var");
});

for (const host of ["firestore.googleapis.com:443", "10.0.0.5:8080", "0.0.0.0:8080", "example.com:8080"]) {
  test(`(a) a non-loopback emulator address (${host}) is refused before the SDK loads`, () => {
    const r = run(GUARDED, { preload: [PROBE], env: { FIXTURE_PROJECT: "demo-eos-test", FIRESTORE_EMULATOR_HOST: host } });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /is not a loopback emulator address/);
    assertNoSdk(r, host);
  });
}

test("(a) the service the caller did not name is pinned to a dead loopback port, never left to reach Google", () => {
  const r = run(fixture("pinned.mjs", [
    `import ${JSON.stringify(EMULATOR_ENTRY)};`,
    "console.log(JSON.stringify({ fs: process.env.FIRESTORE_EMULATOR_HOST, auth: process.env.FIREBASE_AUTH_EMULATOR_HOST }));",
  ]), { env: { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8093" } });
  assert.equal(r.status, 0, r.stderr);
  const seen = JSON.parse(r.stdout);
  assert.equal(seen.fs, "127.0.0.1:8093", "the caller's emulator is kept");
  assert.equal(seen.auth, guard.DEAD_LOOPBACK, "the unnamed one goes nowhere");
});

// ════════════════════ (b) a real project id: refuse ════════════════════

const GOVERNED = [...guard.governedProjectIds()];
test("the governed set is read from the registries and includes every known real project", () => {
  for (const id of ["taylor-parts", "eos-platform-sandbox", "eos-platform-certification"]) assert.ok(GOVERNED.includes(id), id);
});

for (const projectId of GOVERNED) {
  test(`(b) initializeApp for the governed project "${projectId}" is refused; the SDK's initializeApp never runs`, () => {
    const r = run(GUARDED, { preload: [PROBE], env: { FIXTURE_PROJECT: projectId, FIRESTORE_EMULATOR_HOST: guard.DEAD_LOOPBACK.replace(":9", ":19") } });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, REFUSED);
    assert.match(r.stderr, new RegExp(`"${projectId}" is a governed \\(real\\) Firebase project`));
    assert.doesNotMatch(r.probe, /SDK-INITIALIZED/);
    assert.doesNotMatch(r.stdout, /FIXTURE-REACHED-END/);
  });

  test(`(b) "${projectId}" exported by the caller as GCLOUD_PROJECT is refused before the SDK loads`, () => {
    const r = run(GUARDED, { preload: [PROBE], env: { FIXTURE_PROJECT: "demo-eos-test", FIRESTORE_EMULATOR_HOST: "127.0.0.1:19", GCLOUD_PROJECT: projectId } });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /GCLOUD_PROJECT in the caller's environment/);
    assertNoSdk(r, `GCLOUD_PROJECT=${projectId}`);
  });
}

test("(b) a non-demo project id that is not governed is refused too (demo- prefix required)", () => {
  const r = run(GUARDED, { preload: [PROBE], env: { FIXTURE_PROJECT: "some-lookalike-project", FIRESTORE_EMULATOR_HOST: "127.0.0.1:19" } });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /is not a Firebase demo project/);
  assert.doesNotMatch(r.probe, /SDK-INITIALIZED/);
});

test("(b) initializeApp with NO project anywhere is refused (the SDK would discover one from credentials)", () => {
  const r = run(GUARDED, { preload: [PROBE], env: { FIXTURE_PROJECT: "<none>", FIRESTORE_EMULATOR_HOST: "127.0.0.1:19" } });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /no project id/);
  assert.doesNotMatch(r.probe, /SDK-INITIALIZED/);
});

test("(b) positive control: a demo- project on a loopback emulator initializes normally", () => {
  const r = run(GUARDED, { preload: [PROBE], env: { FIXTURE_PROJECT: "demo-eos-test", FIRESTORE_EMULATOR_HOST: "127.0.0.1:19" } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.probe, /SDK-INITIALIZED:demo-eos-test/);
  assert.match(r.stdout, /FIXTURE-REACHED-END/);
});

// ════════════════════ (c) Application Default Credentials are neutralized ════════════════════

// A fake HOME holding a well-known ADC file. Its content is a dummy -- never a real credential.
const FAKE_HOME = path.join(WORK, "fake-home");
mkdirSync(path.join(FAKE_HOME, ".config", "gcloud"), { recursive: true });
writeFileSync(path.join(FAKE_HOME, ".config", "gcloud", "application_default_credentials.json"), JSON.stringify({ type: "dummy-not-a-credential" }));

test("(c) the guarded process cannot see the well-known ADC file, has no GOOGLE_APPLICATION_CREDENTIALS, no metadata server", () => {
  const r = run(ENV_REPORT, { env: { HOME: FAKE_HOME } });
  assert.equal(r.status, 0, r.stderr);
  const seen = JSON.parse(r.stdout);
  assert.equal(seen.self.GOOGLE_APPLICATION_CREDENTIALS, null);
  assert.notEqual(seen.self.HOME, FAKE_HOME, "HOME no longer points at the directory holding ADC");
  assert.equal(seen.homedir, seen.self.HOME, "os.homedir() follows it");
  assert.equal(seen.wellKnownExists, false, "the well-known ADC path resolves to nothing");
  assert.equal(seen.self.CLOUDSDK_CONFIG, seen.self.HOME);
  assert.equal(seen.cloudsdkEntries, 0, "an EMPTY config directory");
  assert.equal(seen.self.METADATA_SERVER_DETECTION, "none");
  assert.ok(seen.self.NODE_OPTIONS.includes(OFFLINE_ENTRY), "children are guarded too");
});

test("(c) a child process inherits the neutralized environment AND the guard itself", () => {
  const r = run(ENV_REPORT, { env: { HOME: FAKE_HOME } });
  const seen = JSON.parse(r.stdout);
  assert.equal(seen.childStatus, 0);
  assert.equal(seen.child.HOME, seen.self.HOME);
  assert.equal(seen.child.GAC, null);
  assert.equal(seen.child.guard, "object", "the guard ran in the child via NODE_OPTIONS");
});

test("(c) the neutral HOME is removed when the guarded process exits", () => {
  const r = run(ENV_REPORT, { env: { HOME: FAKE_HOME } });
  assert.equal(existsSync(JSON.parse(r.stdout).self.HOME), false);
});

const CREDENTIAL_FILE = path.join(WORK, "fake-credential.json");
writeFileSync(CREDENTIAL_FILE, JSON.stringify({ type: "dummy-not-a-credential" }));
for (const [name, value] of [
  ["GOOGLE_APPLICATION_CREDENTIALS", CREDENTIAL_FILE],
  ["GOOGLE_APPLICATION_CREDENTIALS", "/nonexistent/but/still/set.json"],
  ["FIREBASE_TOKEN", "dummy"],
  ["GOOGLE_OAUTH_ACCESS_TOKEN", "dummy"],
  ["CLOUDSDK_AUTH_ACCESS_TOKEN_FILE", CREDENTIAL_FILE],
  ["FIREBASE_SERVICE_ACCOUNT_KEY", "dummy"],
  ["SANDBOX_CREDENTIALS_FILE", CREDENTIAL_FILE],
]) {
  test(`(c) a real credential variable (${name}) is REFUSED, not overridden, before the SDK loads`, () => {
    const r = run(GUARDED, { preload: [PROBE], env: { FIXTURE_PROJECT: "demo-eos-test", FIRESTORE_EMULATOR_HOST: "127.0.0.1:19", [name]: value } });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, new RegExp(`${name} is set`));
    assertNoSdk(r, name);
  });
}

test("(c) CLOUDSDK_CONFIG pointing at a directory that holds ADC is refused", () => {
  const r = run(GUARDED, { preload: [PROBE], env: { FIXTURE_PROJECT: "demo-eos-test", FIRESTORE_EMULATOR_HOST: "127.0.0.1:19", CLOUDSDK_CONFIG: path.join(FAKE_HOME, ".config", "gcloud") } });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /CLOUDSDK_CONFIG .* holds Application Default Credentials/);
  assertNoSdk(r, "CLOUDSDK_CONFIG");
});

test("(c) offline mode leaves emulator variables alone but still neutralizes ADC and gates initializeApp", () => {
  const r = run(fixture("offline.mjs", [
    `import ${JSON.stringify(OFFLINE_ENTRY)};`,
    'import admin from "firebase-admin";',
    "console.log(JSON.stringify({ fs: process.env.FIRESTORE_EMULATOR_HOST ?? null, home: process.env.HOME }));",
    'admin.initializeApp({ projectId: "taylor-parts" });',
    'console.log("FIXTURE-REACHED-END");',
  ]), { preload: [PROBE], env: { HOME: FAKE_HOME } });
  assert.notEqual(r.status, 0);
  const seen = JSON.parse(r.stdout.split("\n")[0]);
  assert.equal(seen.fs, null, "no emulator invented in offline mode");
  assert.notEqual(seen.home, FAKE_HOME);
  assert.match(r.stderr, /"taylor-parts" is a governed \(real\) Firebase project/);
  assert.doesNotMatch(r.probe, /SDK-INITIALIZED/);
});

test("the neutral directories the guard creates do not accumulate", () => {
  const before = readdirSync(tmpdir()).filter((n) => n.startsWith("eos-firebase-test-guard-home-")).length;
  run(ENV_REPORT, { env: { HOME: FAKE_HOME } });
  const after = readdirSync(tmpdir()).filter((n) => n.startsWith("eos-firebase-test-guard-home-")).length;
  assert.ok(after <= before, `${before} -> ${after}`);
});

// ════════════════════ (e) no egress beyond loopback ════════════════════

test("(e) a guarded process cannot open a TCP connection to a non-loopback host; loopback still works", () => {
  const r = run(fixture("egress.mjs", [
    `import ${JSON.stringify(OFFLINE_ENTRY)};`,
    'import net from "node:net";',
    'import https from "node:https";',
    "const attempt = (make) => new Promise((resolve) => { const s = make(); s.on(\"error\", (e) => resolve(e.code || e.message)); s.on(\"connect\", () => { s.destroy(); resolve(\"CONNECTED\"); }); });",
    "const server = net.createServer((c) => c.end()).listen(0, \"127.0.0.1\");",
    "await new Promise((r) => server.once(\"listening\", r));",
    "const out = {",
    "  testNet: await attempt(() => net.connect({ host: \"203.0.113.10\", port: 443 })),",
    "  googleName: await attempt(() => net.connect(443, \"www.googleapis.com\")),",
    "  https: await new Promise((resolve) => https.get(\"https://firestore.googleapis.com/\").on(\"error\", (e) => resolve(e.code || e.message))),",
    "  loopback: await attempt(() => net.connect({ host: \"127.0.0.1\", port: server.address().port })),",
    "  blocked: globalThis[Symbol.for(\"eos.firebaseTestGuard\")].blockedConnections,",
    "};",
    "server.close();",
    "console.log(JSON.stringify(out));",
  ]));
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.testNet, "EOS_TEST_EGRESS_BLOCKED");
  assert.equal(out.googleName, "EOS_TEST_EGRESS_BLOCKED");
  assert.equal(out.https, "EOS_TEST_EGRESS_BLOCKED");
  assert.equal(out.loopback, "CONNECTED", "emulators and the local database stay reachable");
  assert.deepEqual(out.blocked, ["203.0.113.10", "www.googleapis.com", "firestore.googleapis.com"]);
});
