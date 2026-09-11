// FIREBASE EXIT GUARD. What it must catch, and what it must never catch.
//
// ============================ WHAT IS BEING PROVEN ============================
//
//   * an unchanged baseline passes -- the guard is not a ban on the dependency, it is a fence
//     against GROWTH, so the exact set recorded in docs/architecture/firebase-exit-baseline.json
//     produces zero violations;
//
//   * removing a baseline dependency passes -- the ratchet moves toward zero without the guard
//     objecting, because a baseline entry is a ceiling, not a requirement;
//
//   * a NEW file using a forbidden dependency, absent from the baseline, fails;
//
//   * Firebase Auth identity-only usage (firebase/auth, firebase-admin/auth, firebase-admin/app)
//     never trips the Firestore/Functions business-runtime fence, no matter how it is imported;
//
//   * the live repository, scanned today, passes against its own committed baseline.
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FORBIDDEN_CATEGORIES,
  SKIP_DIRECTORIES,
  baselinePathsFor,
  classifyFile,
  evaluateGuard,
  extractImportSpecifiers,
  loadBaseline,
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
// The ratchet: baseline is a ceiling, never a floor requirement, and never expands
// ---------------------------------------------------------------------------------------------

test("an unchanged baseline produces zero violations", () => {
  const baseline = makeBaseline({
    frontend: { firestore_client: ["a.js"], firebase_functions_client: [], firebase_auth: [] },
  });
  const scanResults = new Map([
    ["frontend.firestore_client", new Set(["a.js"])],
    ["frontend.firebase_functions_client", new Set()],
    ["server.firebase_admin_firestore", new Set()],
    ["server.firebase_functions_server", new Set()],
  ]);
  const { violations, decreased } = evaluateGuard(baseline, scanResults);
  assert.deepEqual(violations, []);
  assert.deepEqual(decreased, []);
});

test("removing a baseline dependency passes and is reported as a decrease, not a violation", () => {
  const baseline = makeBaseline({
    frontend: { firestore_client: ["a.js", "b.js"], firebase_functions_client: [], firebase_auth: [] },
  });
  const scanResults = new Map([
    ["frontend.firestore_client", new Set(["a.js"])], // b.js migrated off Firestore
    ["frontend.firebase_functions_client", new Set()],
    ["server.firebase_admin_firestore", new Set()],
    ["server.firebase_functions_server", new Set()],
  ]);
  const { violations, decreased } = evaluateGuard(baseline, scanResults);
  assert.deepEqual(violations, []);
  assert.deepEqual(decreased, [{ category: "frontend.firestore_client", path: "b.js" }]);
});

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
// The live repository, scanned today, against its own committed baseline
// ---------------------------------------------------------------------------------------------

test("the repository currently introduces no Firebase business-runtime dependency beyond its baseline", () => {
  const baseline = loadBaseline(REPO_ROOT);
  const scanResults = scanTree(REPO_ROOT);
  const { violations } = evaluateGuard(baseline, scanResults);
  assert.deepEqual(violations, [],
    `unbaselined Firebase business-runtime dependenc(ies):\n${violations
      .map((v) => `  ${v.path} — ${v.label}`).join("\n")}`);
});
