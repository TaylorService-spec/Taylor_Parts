// I-1F — deterministic build-base verification. Builds the app in BOTH
// output modes and asserts index.html emits the correct asset base for each
// host, so the GitHub Pages and Firebase Hosting builds can never silently
// diverge again (the I-1 production failure: a Firebase build carrying the
// GitHub Pages /Taylor_Parts/field-ops/ asset base 404s every asset → blank
// site). Build-time asset-URL check only — no runtime/domain/Rules logic.
//
// Run: npm run verify:build-base  (from field-ops-app-vite/)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const appDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const indexPath = path.join(appDir, "dist", "index.html");
const GITHUB_BASE = "/Taylor_Parts/field-ops/";

function build(script) {
  // Clean dist so each assertion reflects only this build. Exercise the REAL
  // npm scripts (execSync uses a shell → cross-platform npm resolution).
  fs.rmSync(path.join(appDir, "dist"), { recursive: true, force: true });
  execSync(`npm run ${script}`, { cwd: appDir, stdio: "inherit" });
  return fs.readFileSync(indexPath, "utf8");
}

// Asset references live in <script src=...> / <link href=...> that Vite
// rewrites with the configured base. We check the built asset URLs, not
// arbitrary text.
function assetRefs(html) {
  return [...html.matchAll(/(?:src|href)="([^"]*\/assets\/[^"]+)"/g)].map((m) => m[1]);
}

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }

console.log("verifyBuildBase.mjs");

console.log("[1/2] standard/GitHub build (npm run build)");
const gh = build("build");
const ghAssets = assetRefs(gh);
check("GitHub build emits at least one hashed asset reference", () => {
  assert.ok(ghAssets.length > 0, "no /assets/ references found in dist/index.html");
});
check(`GitHub build references are under ${GITHUB_BASE}assets/`, () => {
  for (const ref of ghAssets) {
    assert.ok(ref.startsWith(`${GITHUB_BASE}assets/`), `unexpected GitHub asset base: ${ref}`);
  }
});

console.log("[2/2] Firebase build (npm run build:firebase)");
const fb = build("build:firebase");
const fbAssets = assetRefs(fb);
check("Firebase build emits at least one hashed asset reference", () => {
  assert.ok(fbAssets.length > 0, "no /assets/ references found in dist/index.html");
});
check("Firebase build references are ROOT-relative (/assets/...)", () => {
  for (const ref of fbAssets) {
    assert.ok(ref.startsWith("/assets/"), `Firebase asset ref is not root-relative: ${ref}`);
  }
});
check("Firebase build carries NO GitHub Pages base anywhere in index.html", () => {
  assert.ok(!fb.includes(GITHUB_BASE), `Firebase index.html still references ${GITHUB_BASE}`);
});
check("the two modes actually differ (GitHub base present in GitHub build, absent in Firebase build)", () => {
  assert.ok(gh.includes(GITHUB_BASE), "GitHub build unexpectedly lost its base");
  assert.ok(!fb.includes(GITHUB_BASE), "Firebase build unexpectedly kept the GitHub base");
});

console.log(`\nverifyBuildBase: ${passed} passed, 0 failed`);
