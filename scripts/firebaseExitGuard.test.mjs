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
//   * the NAMESPACE-ACCESS form is fenced as well as the subpath form -- a bare
//     `import admin from "firebase-admin"` followed by `admin.firestore()` reaches the same server
//     Firestore business persistence as `from "firebase-admin/firestore"` and must trip the same
//     category, in every variant (namespace import, require, chained require, dynamic import,
//     `admin.app().firestore()`, destructured handle, `admin.firestore.FieldValue`);
//
//   * closing that bypass did NOT turn the fence into a keyword scan: a bare firebase-admin import
//     whose only Firestore mention is in a comment, a string, or a template literal is NOT flagged,
//     and neither is identity-only `admin.auth()` / `admin.app()` / `admin.initializeApp()` use --
//     which is what the Owner ruling's transitional identity carve-out requires;
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
  stripCommentsAndStringLiterals,
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

// =============================================================================================
// THE NAMESPACE-ACCESS BYPASS (verified against origin/main 33945090 before it was closed)
//
// A bare `import admin from "firebase-admin"` names only the package root, so it produced NO
// forbidden specifier and the `server.firebase_admin_firestore` category never fired -- even
// though `admin.firestore()` is exactly the server Firestore business persistence that category
// exists to fence. Empirically confirmed on that baseline: a file of this shape written under
// functions/src produced ZERO violations from the real ratchet run
// (`node scripts/firebaseExitGuard.mjs --previous-baseline=<committed baseline>`, exit 0), while
// the same file written with the /firestore subpath produced one violation (exit 1).
//
// Every test below the first group is a regression fence on that bypass staying closed.
// =============================================================================================

test("stripCommentsAndStringLiterals removes line comments, block comments, and literal contents", () => {
  assert.equal(
    stripCommentsAndStringLiterals("const a = 1; // admin.firestore()\nconst b = 2;").includes("firestore"),
    false);
  assert.equal(
    stripCommentsAndStringLiterals("/* admin.firestore().collection(\"x\") */ const a = 1;").includes("firestore"),
    false);
  assert.equal(
    stripCommentsAndStringLiterals('const m = "admin.firestore()";').includes("firestore"),
    false);
  assert.equal(
    stripCommentsAndStringLiterals("const m = `admin.firestore()`;").includes("firestore"),
    false);
});

test("stripCommentsAndStringLiterals leaves real code intact", () => {
  const stripped = stripCommentsAndStringLiterals(
    'import admin from "firebase-admin";\nadmin.firestore().collection("workOrders").get();');
  assert.ok(stripped.includes("admin.firestore()"),
    "a real access expression must survive blanking, or the detector below cannot see it");
  assert.equal(stripped.includes("firebase-admin"), false,
    "specifiers are blanked in this view -- extractImportSpecifiers reads the RAW text instead");
});

test("stripCommentsAndStringLiterals does not let an escaped quote run the blanking past the literal", () => {
  const stripped = stripCommentsAndStringLiterals(
    'const m = "a \\" b"; admin.firestore();');
  assert.ok(stripped.includes("admin.firestore()"));
});

// --- the bypass family: every variant must now be caught -------------------------------------

const NAMESPACE_FIRESTORE_SHAPES = {
  "default import + admin.firestore()":
    'import admin from "firebase-admin";\nadmin.firestore().collection("x").get();',
  "namespace import + admin.firestore()":
    'import * as admin from "firebase-admin";\nadmin.firestore().doc("x").set({});',
  "aliased namespace import":
    'import * as fbAdmin from "firebase-admin";\nfbAdmin.firestore().collection("x").get();',
  "require() then .firestore()":
    'const admin = require("firebase-admin");\nadmin.firestore().collection("x").get();',
  "chained require(\"firebase-admin\").firestore()":
    'require("firebase-admin").firestore().collection("x").get();',
  "dynamic import() then .firestore()":
    'const admin = (await import("firebase-admin")).default;\nadmin.firestore().collection("x").get();',
  "admin.app().firestore()":
    'import admin from "firebase-admin";\nadmin.app().firestore().collection("x").get();',
  "admin.firestore.FieldValue sentinel namespace (no call on firestore)":
    'import admin from "firebase-admin";\nconst t = admin.firestore.FieldValue.serverTimestamp();',
  "destructured firestore handle":
    'const { firestore } = require("firebase-admin");\nfirestore().collection("x").get();',
  "reassigned local alias":
    'import admin from "firebase-admin";\nconst a = admin;\na.firestore().collection("x").get();',
};

for (const [shape, source] of Object.entries(NAMESPACE_FIRESTORE_SHAPES)) {
  test(`bare firebase-admin namespace access is server Firestore persistence: ${shape}`, () => {
    assert.deepEqual([...classifyFile(source)], ["server.firebase_admin_firestore"],
      `${shape} reaches admin Firestore without naming the /firestore subpath and must be fenced`);
  });
}

// --- and identity-only bare-admin use must still NOT be caught -------------------------------

const IDENTITY_ONLY_BARE_ADMIN_SHAPES = {
  "admin.auth().verifyIdToken only":
    'import admin from "firebase-admin";\nawait admin.auth().verifyIdToken(token);',
  "admin.initializeApp() only":
    'import admin from "firebase-admin";\nadmin.initializeApp();',
  "the real functions/src/eosApi/server.ts shape (dynamic CJS import, app().auth())":
    'const imported = await import("firebase-admin");\n' +
    'const admin = imported.default ?? imported;\n' +
    'const app = admin.apps?.length ? admin.app() : admin.initializeApp();\n' +
    'await app.auth().verifyIdToken(token);',
  "admin.storage() -- Firebase Storage is not one of the four fenced classes":
    'import admin from "firebase-admin";\nadmin.storage().bucket().file("x");',
  "Firestore named only in a line comment":
    'import admin from "firebase-admin";\n// migrated off admin.firestore() in wave 1\n' +
    'await admin.auth().verifyIdToken(token);',
  "Firestore named only in a block comment":
    'import admin from "firebase-admin";\n/* was: admin.firestore().collection("x") */\n' +
    'await admin.auth().verifyIdToken(token);',
  "Firestore named only in a string literal":
    'import admin from "firebase-admin";\nconst m = "never call admin.firestore() here";\n' +
    'await admin.auth().verifyIdToken(token);',
  "Firestore named only in a template literal":
    'import admin from "firebase-admin";\nconst m = `never call admin.firestore() here`;\n' +
    'await admin.auth().verifyIdToken(token);',
};

for (const [shape, source] of Object.entries(IDENTITY_ONLY_BARE_ADMIN_SHAPES)) {
  test(`transitional identity use of bare firebase-admin is NOT fenced: ${shape}`, () => {
    assert.deepEqual([...classifyFile(source)], [],
      "Firebase Auth identity is permitted by the Owner ruling and is deliberately outside this " +
      "business-runtime fence -- closing the namespace bypass must not reclassify it");
  });
}

test("a Firestore access expression with NO firebase-admin import is not fenced -- the detector " +
  "is a conjunction, not a keyword scan", () => {
  assert.deepEqual([...classifyFile('import { db } from "./localDb";\ndb.firestore().collection("x").get();')], []);
  assert.deepEqual([...classifyFile("// this module used to call admin.firestore()")], []);
});

test("a file mixing identity auth with NAMESPACE Firestore access is flagged only for Firestore", () => {
  const mixed = [
    'import admin from "firebase-admin";',
    "await admin.auth().verifyIdToken(token);",
    'await admin.firestore().collection("workOrders").get();',
  ].join("\n");
  assert.deepEqual([...classifyFile(mixed)], ["server.firebase_admin_firestore"]);
});

// --- the frontend mirror of the same bypass ---------------------------------------------------

test("the frontend compat namespace reaches the Firestore and Functions clients and is fenced", () => {
  assert.deepEqual(
    [...classifyFile('import firebase from "firebase/app";\nfirebase.firestore().collection("x").get();')],
    ["frontend.firestore_client"]);
  assert.deepEqual(
    [...classifyFile('import firebase from "firebase";\nfirebase.firestore().doc("x").get();')],
    ["frontend.firestore_client"]);
  assert.deepEqual(
    [...classifyFile('import firebase from "firebase/app";\nfirebase.functions().httpsCallable("f");')],
    ["frontend.firebase_functions_client"]);
});

test("firebase/compat/firestore and firebase/compat/functions are the same clients by another " +
  "specifier and are fenced", () => {
  assert.deepEqual([...classifyFile('import "firebase/compat/firestore";')], ["frontend.firestore_client"]);
  assert.deepEqual([...classifyFile('import "firebase/compat/functions";')], ["frontend.firebase_functions_client"]);
});

test("firebase/app on its own is the identity entry point and is NOT fenced", () => {
  const identityBootstrap = [
    'import { initializeApp } from "firebase/app";',
    'import { getAuth, onAuthStateChanged } from "firebase/auth";',
    "initializeApp(config);",
    "onAuthStateChanged(getAuth(), handler);",
  ].join("\n");
  assert.deepEqual([...classifyFile(identityBootstrap)], [],
    "importing firebase/app is not a business-runtime dependency -- only Firestore/Functions " +
    "access alongside it is");
});

test("an unrelated `.functions.` member chain beside firebase/app is not a Functions client", () => {
  // "functions" is an ordinary identifier; "firestore" is not. The Functions detector matches a
  // CALL only, precisely so that config/util member chains cannot manufacture a violation.
  assert.deepEqual(
    [...classifyFile('import { initializeApp } from "firebase/app";\nconst r = config.functions.region;')],
    []);
});

// --- strict-superset and real-tree invariants -------------------------------------------------

test("closing the bypass is a strict SUPERSET: every subpath form still classifies as before", () => {
  assert.deepEqual([...classifyFile('import { doc } from "firebase/firestore";')],
    ["frontend.firestore_client"]);
  assert.deepEqual([...classifyFile('import { httpsCallable } from "firebase/functions";')],
    ["frontend.firebase_functions_client"]);
  assert.deepEqual([...classifyFile('import { getFirestore } from "firebase-admin/firestore";')],
    ["server.firebase_admin_firestore"]);
  assert.deepEqual([...classifyFile('import { onCall } from "firebase-functions/v2/https";')],
    ["server.firebase_functions_server"]);
  // Utility submodules and identity modules stay out, as before.
  assert.deepEqual([...classifyFile('import { logger } from "firebase-functions/logger";')], []);
  assert.deepEqual([...classifyFile('import { getAuth } from "firebase-admin/auth";')], []);
});

test("the bare firebase-functions package root was ALREADY fenced by specifier -- no " +
  "matchesSource needed for that category", () => {
  assert.deepEqual([...classifyFile('import functions from "firebase-functions";')],
    ["server.firebase_functions_server"]);
  assert.deepEqual([...classifyFile('const functions = require("firebase-functions");')],
    ["server.firebase_functions_server"]);
});

test("functions/src/eosApi/server.ts -- the only file in the tree importing the bare " +
  "firebase-admin root -- is identity-only and must not be in any fenced category", () => {
  // This pins the transitional identity carve-out to REAL code, not just a synthetic string. The
  // file imports "firebase-admin" dynamically to call app().auth().verifyIdToken(). If a future
  // change gives it Firestore access, this test is the one that should start failing.
  const scanResults = scanTree(REPO_ROOT);
  for (const category of FORBIDDEN_CATEGORIES) {
    assert.equal(
      scanResults.get(category.key).has("functions/src/eosApi/server.ts"), false,
      `functions/src/eosApi/server.ts must stay outside ${category.key}: it imports the bare ` +
      "firebase-admin root purely for Firebase Auth ID-token verification");
  }
});

test("a NAMESPACE-form Firestore dependency in an unbaselined file is a violation end to end", () => {
  // The bypass, expressed through the checker the CI job actually runs.
  const baseline = makeBaseline();
  const scanResults = new Map(FORBIDDEN_CATEGORIES.map((category) => [category.key, new Set()]));
  const namespaceSource =
    'import admin from "firebase-admin";\nawait admin.firestore().collection("workOrders").get();';
  for (const key of classifyFile(namespaceSource)) {
    scanResults.get(key).add("functions/src/newDomain/newWriter.ts");
  }
  const { violations } = evaluateGuard(baseline, scanResults);
  assert.deepEqual(violations, [
    {
      category: "server.firebase_admin_firestore",
      label: FORBIDDEN_CATEGORIES[2].label,
      path: "functions/src/newDomain/newWriter.ts",
    },
  ]);
});
