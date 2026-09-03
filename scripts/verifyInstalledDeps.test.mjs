// =================================================================================================
// A RELEASE MUST BUILD FROM THE DEPENDENCY TREE IT DECLARES
//
// The mechanism these tests reproduce, exactly as it happened on 2026-09-03 (second refresh
// attempt): `jsbarcode` is declared in field-ops-app-vite/package.json and pinned in its lockfile;
// it entered in #1774, inside the undeployed release gap; the operator checkout's node_modules
// predated that commit. The release reached [3a/5] and died in a Rolldown binding stack that named
// nothing relevant. Verified by hiding node_modules/jsbarcode in a healthy tree and reproducing the
// identical error and exit code.
//
// Two failure shapes, and the tests are weighted toward the second:
//
//   LOUD  -- a declared package is MISSING. The build fails. Recoverable, and what happened.
//   QUIET -- a declared package is present at the WRONG VERSION. The build SUCCEEDS and ships an
//            artifact built from dependencies nobody approved. No build, anywhere, catches this.
//
// Deliberately hermetic: no npm, no network, no builds, no platform assumptions. The real-build
// invariants stay where they belong -- in verify:build-base, which still runs both REAL npm scripts.
//
// Run: node --test scripts/verifyInstalledDeps.test.mjs
// =================================================================================================

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { checkInstalledDeps, formatRefusal } from "./verifyInstalledDeps.mjs";

const REPO = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

/**
 * An in-memory package tree. Keys are paths relative to the package dir, so a test states only what
 * it is actually about.
 */
const APP = "/repo/field-ops-app-vite";

function tree({ manifest, lock, installed }) {
  // Keyed on the FULL path, compared exactly. An earlier version matched with endsWith, and every
  // node_modules/<x>/package.json then matched the top-level "package.json" entry first -- the
  // helper answered the manifest for every lookup and four tests failed for a reason that had
  // nothing to do with the code under test.
  const files = new Map();
  files.set(join(APP, "package.json"), manifest);
  if (lock !== null) files.set(join(APP, "package-lock.json"), { packages: lock ?? {} });
  for (const [name, version] of Object.entries(installed ?? {})) {
    files.set(join(APP, "node_modules", name, "package.json"), { name, version });
  }
  return (path) => files.get(path) ?? null;
}

// -- 1. the exact failure that stopped the release ------------------------------------------------

test("a declared dependency that is not installed is reported by name", () => {
  const readJson = tree({
    manifest: { dependencies: { react: "^19.0.0", jsbarcode: "^3.12.3" } },
    lock: { "node_modules/react": { version: "19.0.0" }, "node_modules/jsbarcode": { version: "3.12.3" } },
    installed: { react: "19.0.0" }, // jsbarcode absent -- the operator's stale checkout
  });
  const problems = checkInstalledDeps(APP, { readJson });
  assert.deepEqual(problems, [
    { kind: "MISSING", name: "jsbarcode", expected: "3.12.3", detail: "declared but not installed" },
  ]);
});

// -- 2. the failure NO build catches --------------------------------------------------------------

test("a dependency installed at the WRONG version is reported -- the quiet failure", () => {
  // This one builds cleanly and ships. Nothing else in the release pipeline asks the question.
  const readJson = tree({
    manifest: { dependencies: { vite: "^8.1.1" } },
    lock: { "node_modules/vite": { version: "8.1.3" } },
    installed: { vite: "8.0.9" },
  });
  assert.deepEqual(checkInstalledDeps(APP, { readJson }), [
    { kind: "VERSION", name: "vite", expected: "8.1.3", installed: "8.0.9", detail: "wrong version installed" },
  ]);
});

// -- 3. a healthy tree is silent ------------------------------------------------------------------

test("a tree matching the lockfile produces no problems", () => {
  const readJson = tree({
    manifest: { dependencies: { react: "^19.0.0" }, devDependencies: { vite: "^8.1.1" } },
    lock: { "node_modules/react": { version: "19.0.0" }, "node_modules/vite": { version: "8.1.3" } },
    installed: { react: "19.0.0", vite: "8.1.3" },
  });
  assert.deepEqual(checkInstalledDeps(APP, { readJson }), []);
});

// -- 4. no false refusals ------------------------------------------------------------------------

test("transitive and platform-optional packages are NOT walked", () => {
  // A Rolldown native binding is installed on one platform and legitimately absent on another. A
  // guard that refused over those would be worse than no guard: the first false refusal during a
  // release is the commit that deletes it.
  const readJson = tree({
    manifest: { devDependencies: { vite: "^8.1.1" } },
    lock: {
      "node_modules/vite": { version: "8.1.3" },
      "node_modules/@rolldown/binding-win32-x64-msvc": { version: "1.0.0" },
      "node_modules/some-transitive-dep": { version: "2.0.0" },
    },
    installed: { vite: "8.1.3" }, // neither the binding nor the transitive dep is on disk
  });
  assert.deepEqual(checkInstalledDeps(APP, { readJson }), []);
});

// -- 5. devDependencies count too ----------------------------------------------------------------

test("devDependencies are checked, not just dependencies", () => {
  // verify:build-base runs `vite build`. A missing devDependency breaks the release exactly as hard.
  const readJson = tree({
    manifest: { devDependencies: { vite: "^8.1.1" } },
    lock: { "node_modules/vite": { version: "8.1.3" } },
    installed: {},
  });
  assert.equal(checkInstalledDeps(APP, { readJson })[0].name, "vite");
});

// -- 6. missing inputs fail closed ---------------------------------------------------------------

test("an absent lockfile or manifest refuses rather than passing vacuously", () => {
  const noLock = tree({ manifest: { dependencies: { react: "^19.0.0" } }, lock: null, installed: {} });
  assert.equal(checkInstalledDeps(APP, { readJson: noLock })[0].kind, "NO_LOCKFILE");

  assert.equal(checkInstalledDeps(APP, { readJson: () => null })[0].kind, "NO_MANIFEST");
});

test("a direct dependency the lockfile does not pin is reported, not ignored", () => {
  const readJson = tree({
    manifest: { dependencies: { rogue: "^1.0.0" } },
    lock: {},
    installed: { rogue: "1.2.3" },
  });
  assert.deepEqual(checkInstalledDeps(APP, { readJson }), [
    { kind: "UNPINNED", name: "rogue", installed: "1.2.3", detail: "installed but absent from the lockfile" },
  ]);
});

// -- 7. the refusal has to be actionable ----------------------------------------------------------

test("the refusal names every problem and the exact command that fixes it", () => {
  const text = formatRefusal("/repo/field-ops-app-vite", [
    { kind: "MISSING", name: "jsbarcode", expected: "3.12.3", detail: "" },
    { kind: "VERSION", name: "vite", expected: "8.1.3", installed: "8.0.9", detail: "" },
  ]);
  assert.match(text, /jsbarcode/);
  assert.match(text, /3\.12\.3/);
  assert.match(text, /vite/);
  assert.match(text, /npm ci/);
  assert.match(text, /Nothing has been built, deployed or changed/);
  // The dangerous case must be stated, or the operator reads this as "a package is missing" and
  // never learns that a WRONG VERSION ships silently.
  assert.match(text, /succeed[\s\S]*dependencies this release does not declare/);
});

// -- 8. against the real filesystem ---------------------------------------------------------------

test("the real, non-injected code path detects a missing dependency on disk", () => {
  const dir = mkdtempSync(join(tmpdir(), "eos-deps-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { jsbarcode: "^3.12.3", react: "^19.0.0" } }));
  writeFileSync(
    join(dir, "package-lock.json"),
    JSON.stringify({ packages: { "node_modules/jsbarcode": { version: "3.12.3" }, "node_modules/react": { version: "19.0.0" } } }),
  );
  mkdirSync(join(dir, "node_modules", "react"), { recursive: true });
  writeFileSync(join(dir, "node_modules", "react", "package.json"), JSON.stringify({ name: "react", version: "19.0.0" }));

  const problems = checkInstalledDeps(dir);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].name, "jsbarcode");
  assert.equal(problems[0].kind, "MISSING");
});

// -- 9. THIS repository's own trees are consistent -------------------------------------------------

test("every direct dependency of both release packages is pinned in its lockfile", () => {
  // Not an install check -- CI installs from the lockfile, so "installed" is trivially true there.
  // This asserts the committed manifests and lockfiles agree, which is what makes the operator-side
  // check meaningful in the first place.
  for (const pkg of ["field-ops-app-vite", "functions"]) {
    const dir = join(REPO, pkg);
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const lock = JSON.parse(readFileSync(join(dir, "package-lock.json"), "utf8"));
    const declared = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
    assert.ok(declared.length > 0, `${pkg} declares no dependencies?`);
    const unpinned = declared.filter((name) => !lock.packages?.[`node_modules/${name}`]?.version);
    assert.deepEqual(unpinned, [], `${pkg}: declared but not pinned in package-lock.json`);
  }
});

// -- 10. the guard is actually wired in, in both places --------------------------------------------

test("the release runbook refuses a stale tree BEFORE it builds anything", () => {
  const runbook = readFileSync(join(REPO, "scripts", "_sandboxRefresh.run.sh"), "utf8");
  const appCheck = runbook.indexOf("verifyInstalledDeps.mjs field-ops-app-vite");
  const functionsBuild = runbook.indexOf("cd functions && npm run build");
  const appBuild = runbook.indexOf("npm run verify:build-base");

  assert.ok(appCheck > -1, "the runbook must verify the app's installed tree");
  assert.ok(runbook.includes("verifyInstalledDeps.mjs functions"), "the runbook must verify the functions tree");
  assert.ok(appCheck < functionsBuild, "the app dependency check must precede the functions build");
  assert.ok(appCheck < appBuild, "the app dependency check must precede the app build");
});

test("verify:build-base preflights dependencies and still runs the REAL build scripts", () => {
  const verifier = readFileSync(join(REPO, "field-ops-app-vite", "test", "verifyBuildBase.mjs"), "utf8");
  assert.match(verifier, /checkInstalledDeps/, "the verifier must preflight its dependency tree");
  // §5/§6: the preflight must not have become a substitute for the real builds.
  assert.match(verifier, /execSync\(`npm run \$\{script\}`/, "the verifier must still exec the real npm scripts");
  assert.match(verifier, /build\("build"\)/, "the GitHub build must still run");
  assert.match(verifier, /build\("build:firebase"\)/, "the Firebase build must still run");
  assert.match(verifier, /fs\.rmSync\(path\.join\(appDir, "dist"\)/, "dist must still be cleaned between modes");
});
