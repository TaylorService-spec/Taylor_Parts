// C3/D1 — deployed-version identity verification.
//
// Asserts that a real build emits a stable, externally-readable `version.json`
// alongside index.html, in BOTH output modes, carrying the build provenance
// needed to answer "what version is production actually running?" with one HTTP
// GET — the foundation D2 (expected-vs-deployed comparison) builds on.
//
// Why this test exists: the build already injected `__APP_COMMIT__` INSIDE the
// bundle, but that is only reachable by loading the app and inspecting internals.
// Establishing the deployed revision of the two live frontends previously took a
// multi-step forensic exercise (fetch both surfaces, extract bundle fingerprints,
// list Hosting releases, cross-reference CI history). See
// docs/design/c3-delivery-reliability-and-release-visibility.md.
//
// Also asserts the manifest carries NO secrets — it must contain only build
// provenance, never configuration or credentials.
//
// Build-time artifact check only — no runtime, routing, Firestore, Rules, or
// authorization behaviour is exercised or affected.
//
// Run: node test/verifyVersionManifest.mjs   (from field-ops-app-vite/)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const appDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const distDir = path.join(appDir, "dist");
const manifestPath = path.join(distDir, "version.json");
const GITHUB_BASE = "/Taylor_Parts/field-ops/";

function build(script) {
  fs.rmSync(distDir, { recursive: true, force: true });
  execSync(`npm run ${script}`, { cwd: appDir, stdio: "pipe" });
}

function readManifest() {
  assert.ok(
    fs.existsSync(manifestPath),
    "dist/version.json was not emitted — the deployed revision would be unreadable from outside the app.",
  );
  return JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
}

const checks = [];
function check(name, fn) {
  try { fn(); checks.push(`ok - ${name}`); }
  catch (err) { checks.push(`FAIL - ${name}: ${err.message}`); process.exitCode = 1; }
}

// ---------------------------------------------------------------- GitHub Pages
build("build");
const pages = readManifest();

check("D1: Pages build emits version.json with a resolved commit", () => {
  assert.equal(typeof pages.commit, "string");
  assert.ok(pages.commit.length > 0, "commit is empty");
  // "unknown" is the documented fallback when git is unavailable. It must be
  // possible, but a normal repo build must not produce it — otherwise the
  // manifest would silently convey no version information at all.
  assert.notEqual(
    pages.commit, "unknown",
    "commit resolved to 'unknown' in a git checkout — version identity would be useless",
  );
});

check("D1: Pages build records the GitHub Pages asset base", () => {
  assert.equal(pages.base, GITHUB_BASE);
});

check("D1: buildTime is a valid ISO-8601 instant", () => {
  assert.equal(typeof pages.buildTime, "string");
  assert.ok(!Number.isNaN(Date.parse(pages.buildTime)), `unparseable buildTime: ${pages.buildTime}`);
});

check("D1: manifest is schema-versioned so consumers can evolve safely", () => {
  // schema 2 = O-3 added environment identity, so a consumer can verify BOTH
  // which revision AND which environment a surface was built for.
  assert.equal(pages.schema, 2);
});

check("D1/O-3: manifest records the environment the build targeted", () => {
  assert.equal(typeof pages.environmentId, "string");
  assert.ok(pages.environmentId.length > 0);
  assert.equal(typeof pages.environmentRole, "string");
  // An un-parameterised build must reproduce the current production target.
  assert.equal(pages.environmentId, "taylor-parts-production");
  assert.equal(pages.environmentRole, "production");
});

check("D1: manifest carries build provenance ONLY — no secrets or config", () => {
  assert.deepEqual(
    Object.keys(pages).sort(),
    ["base", "buildTime", "commit", "environmentId", "environmentRole", "schema"],
    "unexpected keys in version.json — it must never carry configuration or credentials",
  );
  const serialized = JSON.stringify(pages).toLowerCase();
  for (const forbidden of ["apikey", "secret", "token", "password", "projectid", "authdomain"]) {
    assert.ok(!serialized.includes(forbidden), `version.json leaked '${forbidden}'`);
  }
});

check("D1: the emitted commit matches the repository HEAD", () => {
  const head = execSync("git rev-parse --short HEAD", { cwd: appDir, encoding: "utf8" }).trim();
  assert.equal(pages.commit, head, "version.json commit does not match HEAD");
});

// ------------------------------------------------------------ Firebase Hosting
build("build:firebase");
const firebase = readManifest();

check("D1: Firebase build also emits version.json", () => {
  assert.equal(typeof firebase.commit, "string");
  assert.notEqual(firebase.commit, "unknown");
});

check("D1: Firebase build records the root asset base", () => {
  assert.equal(
    firebase.base, "/",
    "Firebase build must record base '/' — the two surfaces must be distinguishable from their manifests alone",
  );
});

check("D1: both surfaces report the SAME commit for the same source", () => {
  // This is what makes drift between the two live frontends detectable: an
  // identical source revision must produce an identical commit in both
  // manifests, so any difference observed in production is real drift and not
  // a build-mode artifact.
  assert.equal(pages.commit, firebase.commit);
});

console.log(checks.join("\n"));
console.log(
  process.exitCode
    ? "\nD1 version manifest: FAILURES PRESENT"
    : `\nD1 version manifest: all ${checks.length} checks passed (commit ${pages.commit})`,
);
