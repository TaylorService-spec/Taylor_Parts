// I-1F/I-1R — deterministic build verification. Builds the app in BOTH
// output modes and asserts, per mode, (a) index.html emits the correct asset
// base and (b) the React Router basename resolves correctly from that same
// build base — so the GitHub Pages and Firebase Hosting builds can never
// silently diverge again (I-1 failures: a Firebase build carrying the GitHub
// Pages /Taylor_Parts/field-ops/ asset base 404s assets → blank shell; and a
// hard-coded router basename → post-login blank page). Build-time asset-URL +
// basename derivation check only — no runtime/domain/Rules logic.
//
// Run: npm run verify:build-base  (from field-ops-app-vite/)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { routerBasenameFrom } from "../src/routerBasename.js";

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

// Full built-output text: index.html + every emitted JS chunk. Used to prove
// (I-1H) that NO GitHub Pages host path survives anywhere in the Firebase
// build — asset base (I-1F), router basename (I-1R), and header link (I-1H)
// are all base-derived, so the string is entirely absent when base is "/".
function readDistText() {
  const assetsDir = path.join(appDir, "dist", "assets");
  const js = fs.existsSync(assetsDir)
    ? fs.readdirSync(assetsDir).filter((f) => f.endsWith(".js")).map((f) => fs.readFileSync(path.join(assetsDir, f), "utf8"))
    : [];
  return [fs.readFileSync(indexPath, "utf8"), ...js].join("\n");
}

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }

console.log("verifyBuildBase.mjs");

console.log("[1/2] standard/GitHub build (npm run build)");
const gh = build("build");
const ghTree = readDistText();
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
const fbTree = readDistText();
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

// --- I-1R: router basename resolves correctly per build mode ---
// The app computes basename = routerBasenameFrom(import.meta.env.BASE_URL),
// where BASE_URL == the observed build base. Deriving expected basename from
// each build's observed asset base, through the SAME helper the app uses,
// deterministically proves the router mount point per mode.
console.log("[router basename]");
const ghBase = GITHUB_BASE; // observed from the GitHub asset refs above
const fbBase = "/";          // observed from the Firebase root-relative refs above
check("App.jsx derives the basename from import.meta.env.BASE_URL (no hard-coded host path)", () => {
  const app = fs.readFileSync(path.join(appDir, "src", "App.jsx"), "utf8");
  assert.ok(app.includes("routerBasenameFrom(import.meta.env.BASE_URL)"), "App.jsx must derive basename from import.meta.env.BASE_URL");
  assert.ok(!/basename="\/Taylor_Parts\/field-ops\/?"/.test(app), "App.jsx still hard-codes a BrowserRouter basename");
});
check("GitHub build router basename resolves to /Taylor_Parts/field-ops", () => {
  assert.equal(routerBasenameFrom(ghBase), "/Taylor_Parts/field-ops");
});
check("Firebase build router basename resolves to /", () => {
  assert.equal(routerBasenameFrom(fbBase), "/");
});

// --- I-1H: no GitHub Pages host path survives ANYWHERE in the Firebase
// build (index.html + all JS chunks) -- asset base, router basename, and the
// AppHeader home link are all base-derived. The GitHub build DOES carry it.
console.log("[whole-bundle host-path scan]");
check("GitHub build bundle contains the GitHub Pages base (sanity)", () => {
  assert.ok(ghTree.includes("/Taylor_Parts/field-ops"), "GitHub build unexpectedly has no /Taylor_Parts/field-ops anywhere");
});
check("Firebase build bundle contains ZERO /Taylor_Parts/field-ops occurrences (assets + router + header)", () => {
  const hits = fbTree.split("/Taylor_Parts/field-ops").length - 1;
  assert.equal(hits, 0, `Firebase build still references /Taylor_Parts/field-ops ${hits} time(s) — a hard-coded host path survived`);
});
check("AppHeader home link is base-derived (source: no hard-coded host path)", () => {
  const header = fs.readFileSync(path.join(appDir, "src", "shared", "ui", "AppHeader.jsx"), "utf8");
  assert.ok(header.includes("href={import.meta.env.BASE_URL}"), "AppHeader must derive the home href from import.meta.env.BASE_URL");
  assert.ok(!header.includes("/Taylor_Parts/field-ops"), "AppHeader still contains a hard-coded /Taylor_Parts/field-ops path");
});

console.log(`\nverifyBuildBase: ${passed} passed, 0 failed`);
