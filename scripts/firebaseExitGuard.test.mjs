// FIREBASE EXIT GUARD. What it must catch, and what it must never catch.
//
// ============================ WHAT IS BEING PROVEN ============================
//
//   * an unchanged baseline passes -- the guard is not a ban on the dependency, it is a fence
//     against GROWTH, so the exact set recorded in docs/architecture/firebase-exit-baseline.json
//     produces zero violations;
//
//   * a candidate baseline entry no longer observed in the scan (stale) FAILS -- it is a live
//     bypass, not informational, because it would tolerate the dependency being reintroduced
//     later without ever tripping a violation;
//
//   * removing a baseline dependency in lockstep with removing the source dependency passes;
//
//   * a NEW file using a forbidden dependency, absent from the baseline, fails;
//
//   * a NEW forbidden dependency introduced alongside a same-PR candidate baseline addition
//     still fails once compared against the PREVIOUS accepted baseline -- the exact-match check
//     alone cannot catch this, because the candidate baseline was expanded to match;
//
//   * a baseline-only addition (no matching source usage) fails;
//
//   * a baseline-only deletion (relative to the previous accepted baseline) is allowed;
//
//   * bootstrap (no previous baseline exists) is accepted only when the candidate baseline
//     exactly matches the candidate scan;
//
//   * bootstrap is ONLY what happens when no --previous-baseline argument is supplied at all --
//     a SUPPLIED path that is missing, unreadable, or malformed JSON must fail, never silently
//     fall back to bootstrap;
//
//   * Firebase Auth identity-only usage (firebase/auth, firebase-admin/auth, firebase-admin/app)
//     never trips the Firestore/Functions business-runtime fence, no matter how it is imported;
//
//   * the live repository, scanned today, passes against its own committed baseline.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  FORBIDDEN_CATEGORIES,
  SKIP_DIRECTORIES,
  baselinePathsFor,
  classifyFile,
  evaluateGuard,
  evaluateRatchet,
  extractImportSpecifiers,
  loadBaseline,
  loadPreviousBaseline,
  scanTree,
} from "./firebaseExitGuard.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(HERE, "..");

function makeBaseline(overrides = {}) {
  return {
    baseline: {
      frontend: {
        firestore_client: [],
        firebase_functions_client: [],
        firebase_auth: [],
      },
      server: {
        firebase_admin_firestore: [],
        firebase_functions_server: [],
        firebase_auth: [],
        firebase_admin_app: [],
      },
      ...overrides,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Import-specifier extraction: static, dynamic, require, type-only
// ---------------------------------------------------------------------------------------------

test("extracts a static import specifier", () => {
  const specifiers = extractImportSpecifiers('import { doc } from "firebase/firestore";');
  assert.deepEqual(specifiers, ["firebase/firestore"]);
});

test("extracts a type-only import specifier (the `type` keyword does not hide the clause)", () => {
  const specifiers = extractImportSpecifiers(
    'import type { CallableRequest } from "firebase-functions/v2/https";');
  assert.deepEqual(specifiers, ["firebase-functions/v2/https"]);
});

test("extracts a dynamic import specifier", () => {
  const specifiers = extractImportSpecifiers(
    'async function f() { const { httpsCallable } = await import("firebase/functions"); }');
  assert.deepEqual(specifiers, ["firebase/functions"]);
});

test("extracts a require() specifier", () => {
  const specifiers = extractImportSpecifiers('const { getFirestore } = require("firebase-admin/firestore");');
  assert.deepEqual(specifiers, ["firebase-admin/firestore"]);
});

test("mentioning firebase in prose does not produce an import specifier", () => {
  // field-ops-app-vite/src/domain/equipmentWrites.js is exactly this shape: it discusses
  // firebase in a comment and imports nothing from it.
  const specifiers = extractImportSpecifiers(
    "// This module deliberately has NO firebase import. The store is injected.");
  assert.deepEqual(specifiers, []);
});

// ---------------------------------------------------------------------------------------------
// Exact signature matching, not keyword scanning
// ---------------------------------------------------------------------------------------------

test("classifyFile flags each forbidden category by its own exact signature", () => {
  assert.deepEqual(
    [...classifyFile('import { doc } from "firebase/firestore";')],
    ["frontend.firestore_client"]);
  assert.deepEqual(
    [...classifyFile('import { httpsCallable } from "firebase/functions";')],
    ["frontend.firebase_functions_client"]);
  assert.deepEqual(
    [...classifyFile('import { getFirestore } from "firebase-admin/firestore";')],
    ["server.firebase_admin_firestore"]);
  assert.deepEqual(
    [...classifyFile('import { onCall } from "firebase-functions/v2/https";')],
    ["server.firebase_functions_server"]);
});

test("firebase-functions utility submodules are not business runtime", () => {
  const categories = classifyFile('import { logger } from "firebase-functions/logger";');
  assert.deepEqual([...categories], []);
});

test("a file that only mentions firebase in a comment classifies as nothing", () => {
  const categories = classifyFile(
    "// See services/truckRegistryCommandClient.js; this file imports no firebase module.");
  assert.deepEqual([...categories], []);
});

// ---------------------------------------------------------------------------------------------
// Firebase Auth identity-only usage never trips the business-runtime fence
// ---------------------------------------------------------------------------------------------

test("firebase/auth, firebase-admin/auth, and firebase-admin/app are not forbidden categories", () => {
  const identitySource = [
    'import { onAuthStateChanged } from "firebase/auth";',
    'import { getAuth } from "firebase-admin/auth";',
    'import { initializeApp } from "firebase-admin/app";',
  ].join("\n");
  assert.deepEqual([...classifyFile(identitySource)], []);
});

test("a file mixing identity auth with a business dependency is flagged only for the business one", () => {
  const mixed = [
    'import { getAuth } from "firebase-admin/auth";',
    'import { getFirestore } from "firebase-admin/firestore";',
  ].join("\n");
  assert.deepEqual([...classifyFile(mixed)], ["server.firebase_admin_firestore"]);
});

// ---------------------------------------------------------------------------------------------
// evaluateGuard: exact-match between the candidate baseline and the candidate source scan
// ---------------------------------------------------------------------------------------------

// Requirement 1: candidate baseline exactly matching current scan passes.
test("a candidate baseline that exactly matches the current scan produces zero violations and " +
  "zero stale entries", () => {
  const baseline = makeBaseline({
    frontend: { firestore_client: ["a.js"], firebase_functions_client: [], firebase_auth: [] },
  });
  const scanResults = new Map([
    ["frontend.firestore_client", new Set(["a.js"])],
    ["frontend.firebase_functions_client", new Set()],
    ["server.firebase_admin_firestore", new Set()],
    ["server.firebase_functions_server", new Set()],
  ]);
  const { violations, staleEntries } = evaluateGuard(baseline, scanResults);
  assert.deepEqual(violations, []);
  assert.deepEqual(staleEntries, []);
});

// Requirement 2: a stale candidate baseline entry fails. This is DEFECT 1: a baseline entry the
// current scan no longer observes is a live bypass (it would tolerate the dependency being
// reintroduced silently later), not merely informational.
test("a stale candidate baseline entry -- no longer observed in the scan -- fails", () => {
  const baseline = makeBaseline({
    frontend: { firestore_client: ["a.js"], firebase_functions_client: [], firebase_auth: [] },
  });
  const scanResults = new Map([
    ["frontend.firestore_client", new Set()], // a.js no longer imports firebase/firestore
    ["frontend.firebase_functions_client", new Set()],
    ["server.firebase_admin_firestore", new Set()],
    ["server.firebase_functions_server", new Set()],
  ]);
  const { violations, staleEntries } = evaluateGuard(baseline, scanResults);
  assert.deepEqual(violations, []);
  assert.deepEqual(staleEntries, [
    { category: "frontend.firestore_client", label: FORBIDDEN_CATEGORIES[0].label, path: "a.js" },
  ]);
});

// Requirement 3: source dependency removal + matching baseline deletion passes.
test("removing a source dependency and deleting its baseline entry together passes", () => {
  const baseline = makeBaseline({
    frontend: { firestore_client: ["a.js"], firebase_functions_client: [], firebase_auth: [] }, // b.js entry already deleted
  });
  const scanResults = new Map([
    ["frontend.firestore_client", new Set(["a.js"])], // b.js migrated off Firestore
    ["frontend.firebase_functions_client", new Set()],
    ["server.firebase_admin_firestore", new Set()],
    ["server.firebase_functions_server", new Set()],
  ]);
  const { violations, staleEntries } = evaluateGuard(baseline, scanResults);
  assert.deepEqual(violations, []);
  assert.deepEqual(staleEntries, []);
});

// Requirement 4: new source dependency without baseline addition fails.
test("a new forbidden file absent from the baseline fails", () => {
  const baseline = makeBaseline({
    frontend: { firestore_client: ["a.js"], firebase_functions_client: [], firebase_auth: [] },
  });
  const scanResults = new Map([
    ["frontend.firestore_client", new Set(["a.js", "new-file.js"])],
    ["frontend.firebase_functions_client", new Set()],
    ["server.firebase_admin_firestore", new Set()],
    ["server.firebase_functions_server", new Set()],
  ]);
  const { violations } = evaluateGuard(baseline, scanResults);
  assert.deepEqual(violations, [
    { category: "frontend.firestore_client", label: FORBIDDEN_CATEGORIES[0].label, path: "new-file.js" },
  ]);
});

test("a baseline file crossing into a NEW forbidden category it was not recorded for also fails", () => {
  // A file already tolerated for Firestore that starts also using Functions is an expansion
  // of the firebase_functions_client set, even though it was already in the baseline for a
  // different category.
  const baseline = makeBaseline({
    frontend: { firestore_client: ["a.js"], firebase_functions_client: [], firebase_auth: [] },
  });
  const scanResults = new Map([
    ["frontend.firestore_client", new Set(["a.js"])],
    ["frontend.firebase_functions_client", new Set(["a.js"])],
    ["server.firebase_admin_firestore", new Set()],
    ["server.firebase_functions_server", new Set()],
  ]);
  const { violations } = evaluateGuard(baseline, scanResults);
  assert.deepEqual(violations, [
    { category: "frontend.firebase_functions_client", label: FORBIDDEN_CATEGORIES[1].label, path: "a.js" },
  ]);
});

test("baselinePathsFor returns an empty set for a category with no baseline entries", () => {
  const baseline = makeBaseline();
  assert.deepEqual(baselinePathsFor(baseline, "server.firebase_functions_server"), new Set());
});

// ---------------------------------------------------------------------------------------------
// evaluateRatchet: previous accepted baseline -> candidate baseline (DEFECT 2)
// ---------------------------------------------------------------------------------------------

// Requirement 5: new source dependency + SAME-PR candidate baseline addition also fails when
// compared to the previous baseline. evaluateGuard alone cannot catch this -- the candidate
// baseline was expanded to exactly match the candidate scan, so the exact-match check passes.
// The ratchet check, comparing against the PREVIOUS accepted baseline, is what closes this.
test("a same-PR baseline addition covering a new source dependency fails the ratchet check " +
  "even though it passes the exact-match check", () => {
  const previousBaseline = makeBaseline({
    frontend: { firestore_client: ["a.js"], firebase_functions_client: [], firebase_auth: [] },
  });
  const candidateBaseline = makeBaseline({
    frontend: { firestore_client: ["a.js", "new-file.js"], firebase_functions_client: [], firebase_auth: [] },
  });
  const scanResults = new Map([
    ["frontend.firestore_client", new Set(["a.js", "new-file.js"])],
    ["frontend.firebase_functions_client", new Set()],
    ["server.firebase_admin_firestore", new Set()],
    ["server.firebase_functions_server", new Set()],
  ]);

  const { violations, staleEntries } = evaluateGuard(candidateBaseline, scanResults);
  assert.deepEqual(violations, [], "exact-match check alone is fooled by the same-PR baseline addition");
  assert.deepEqual(staleEntries, []);

  const { additions } = evaluateRatchet(previousBaseline, candidateBaseline);
  assert.deepEqual(additions, [
    { category: "frontend.firestore_client", label: FORBIDDEN_CATEGORIES[0].label, path: "new-file.js" },
  ]);
});

// Requirement 6: baseline-only addition (no matching source usage) fails.
test("a baseline-only addition -- no corresponding source usage -- fails the ratchet check", () => {
  const previousBaseline = makeBaseline({
    frontend: { firestore_client: ["a.js"], firebase_functions_client: [], firebase_auth: [] },
  });
  const candidateBaseline = makeBaseline({
    frontend: { firestore_client: ["a.js", "unused-entry.js"], firebase_functions_client: [], firebase_auth: [] },
  });
  const { additions } = evaluateRatchet(previousBaseline, candidateBaseline);
  assert.deepEqual(additions, [
    { category: "frontend.firestore_client", label: FORBIDDEN_CATEGORIES[0].label, path: "unused-entry.js" },
  ]);
});

// Requirement 7: baseline deletion is allowed.
test("a baseline deletion relative to the previous accepted baseline is allowed", () => {
  const previousBaseline = makeBaseline({
    frontend: { firestore_client: ["a.js", "b.js"], firebase_functions_client: [], firebase_auth: [] },
  });
  const candidateBaseline = makeBaseline({
    frontend: { firestore_client: ["a.js"], firebase_functions_client: [], firebase_auth: [] },
  });
  const { additions } = evaluateRatchet(previousBaseline, candidateBaseline);
  assert.deepEqual(additions, []);
});

// Requirement 8: bootstrap with no previous baseline works only when the candidate baseline
// exactly matches the candidate scan.
test("bootstrap (no previous baseline) reports no additions, but exact-match still applies", () => {
  const candidateBaseline = makeBaseline({
    frontend: { firestore_client: ["a.js"], firebase_functions_client: [], firebase_auth: [] },
  });

  const { additions, bootstrap } = evaluateRatchet(null, candidateBaseline);
  assert.deepEqual(additions, []);
  assert.equal(bootstrap, true);

  const matchingScan = new Map([
    ["frontend.firestore_client", new Set(["a.js"])],
    ["frontend.firebase_functions_client", new Set()],
    ["server.firebase_admin_firestore", new Set()],
    ["server.firebase_functions_server", new Set()],
  ]);
  assert.deepEqual(evaluateGuard(candidateBaseline, matchingScan).violations, []);
  assert.deepEqual(evaluateGuard(candidateBaseline, matchingScan).staleEntries, []);

  const mismatchedScan = new Map([
    ["frontend.firestore_client", new Set(["a.js", "other-file.js"])],
    ["frontend.firebase_functions_client", new Set()],
    ["server.firebase_admin_firestore", new Set()],
    ["server.firebase_functions_server", new Set()],
  ]);
  assert.notDeepEqual(evaluateGuard(candidateBaseline, mismatchedScan).violations, []);
});

// ---------------------------------------------------------------------------------------------
// Directory skip-list must never collide with a real source subdirectory name (bypass class)
// ---------------------------------------------------------------------------------------------

test("the directory skip-list contains no build-output basename that collides with a real " +
  "source subdirectory under a scan root", () => {
  // field-ops-app-vite/src/lib/ and functions/src/coverage/ are both real, hand-authored
  // source directories that exist today and both import forbidden business-runtime
  // dependencies. A skip-list entry matching "lib" or "coverage" by bare basename would
  // silently blind walk() to that entire subtree -- a bypass, not a filter.
  assert.equal(SKIP_DIRECTORIES.has("lib"), false);
  assert.equal(SKIP_DIRECTORIES.has("coverage"), false);
});

test("scanTree walks into field-ops-app-vite/src/lib/ and finds its baselined Firestore import", () => {
  const scanResults = scanTree(REPO_ROOT);
  assert.ok(
    scanResults.get("frontend.firestore_client").has("field-ops-app-vite/src/lib/firebaseSafe.js"),
    "field-ops-app-vite/src/lib/firebaseSafe.js must be scanned, not skipped by directory name");
});

test("scanTree walks into functions/src/coverage/ and finds its baselined server imports", () => {
  const scanResults = scanTree(REPO_ROOT);
  assert.ok(
    scanResults.get("server.firebase_functions_server").has("functions/src/coverage/coverageCallables.ts"),
    "functions/src/coverage/coverageCallables.ts must be scanned, not skipped by directory name");
  assert.ok(
    scanResults.get("server.firebase_admin_firestore").has("functions/src/coverage/coverageReadCallables.ts"),
    "functions/src/coverage/coverageReadCallables.ts must be scanned, not skipped by directory name");
});

// ---------------------------------------------------------------------------------------------
// loadPreviousBaseline: a SUPPLIED --previous-baseline path must fail closed, never bootstrap
// ---------------------------------------------------------------------------------------------

test("no --previous-baseline argument (undefined path) allows bootstrap", () => {
  assert.equal(loadPreviousBaseline(undefined), null);
});

test("a valid supplied previous baseline loads and parses successfully", () => {
  const dir = mkdtempSync(join(tmpdir(), "firebase-exit-guard-test-"));
  const path = join(dir, "previous-baseline.json");
  try {
    const baseline = makeBaseline({
      frontend: { firestore_client: ["a.js"], firebase_functions_client: [], firebase_auth: [] },
    });
    writeFileSync(path, JSON.stringify(baseline));
    assert.deepEqual(loadPreviousBaseline(path), baseline);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a supplied but missing previous-baseline path fails -- never silently becomes bootstrap", () => {
  const dir = mkdtempSync(join(tmpdir(), "firebase-exit-guard-test-"));
  const path = join(dir, "does-not-exist.json");
  try {
    assert.throws(() => loadPreviousBaseline(path));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a supplied but malformed-JSON previous-baseline path fails -- never silently becomes " +
  "bootstrap", () => {
  const dir = mkdtempSync(join(tmpdir(), "firebase-exit-guard-test-"));
  const path = join(dir, "malformed-baseline.json");
  try {
    writeFileSync(path, "{ not valid json");
    assert.throws(() => loadPreviousBaseline(path));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// The live repository, scanned today, against its own committed baseline
// ---------------------------------------------------------------------------------------------

test("the repository's committed baseline exactly matches its own current scan -- no " +
  "violations, no stale entries", () => {
  const baseline = loadBaseline(REPO_ROOT);
  const scanResults = scanTree(REPO_ROOT);
  const { violations, staleEntries } = evaluateGuard(baseline, scanResults);
  assert.deepEqual(violations, [],
    `unbaselined Firebase business-runtime dependenc(ies):\n${violations
      .map((v) => `  ${v.path} — ${v.label}`).join("\n")}`);
  assert.deepEqual(staleEntries, [],
    `stale committed baseline entr(ies) no longer observed in the tree:\n${staleEntries
      .map((v) => `  ${v.path} — ${v.label}`).join("\n")}`);
});
