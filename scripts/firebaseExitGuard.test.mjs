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
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

// The second argument is the file's repo-relative path: every business-runtime class is fenced
// at every business-runtime root, so the ROOT is what decides which of the three keys for a
// given class applies. See "root is a per-file filter" further down.
test("classifyFile flags each forbidden category by its own exact signature", () => {
  assert.deepEqual(
    [...classifyFile('import { doc } from "firebase/firestore";',
      "field-ops-app-vite/src/services/workOrders.js")],
    ["frontend.firestore_client"]);
  assert.deepEqual(
    [...classifyFile('import { httpsCallable } from "firebase/functions";',
      "field-ops-app-vite/src/services/workOrders.js")],
    ["frontend.firebase_functions_client"]);
  assert.deepEqual(
    [...classifyFile('import { getFirestore } from "firebase-admin/firestore";',
      "functions/src/inventory/inventoryWrites.ts")],
    ["server.firebase_admin_firestore"]);
  assert.deepEqual(
    [...classifyFile('import { onCall } from "firebase-functions/v2/https";',
      "functions/src/inventory/inventoryCallables.ts")],
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
  assert.deepEqual(
    [...classifyFile(mixed, "functions/src/inventory/inventoryWrites.ts")],
    ["server.firebase_admin_firestore"]);
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

// ---------------------------------------------------------------------------------------------
// W1-C21 RETIREMENT PINS. Deleting a Firebase business-runtime module shrinks the baseline, and
// the shrunk baseline is what the exact-match check above compares against -- so a reintroduced
// module WOULD already trip `violations`. That is a fence against the dependency, not against the
// module: a file could come back at the same path reading Firestore through some future helper the
// four FORBIDDEN_CATEGORIES do not match, and nothing would notice that a retirement was undone.
//
// These pins are therefore about the RETIREMENT DECISION, not the import: each path below was
// proven unreachable (no importer, no caller, no runtime path) before deletion, and each is
// asserted absent from BOTH the tree and the baseline. A path returning is not necessarily wrong
// -- it is a decision that must be made again deliberately, by deleting the pin with the evidence
// that justifies it, rather than by a merge nobody reviewed. See
// docs/handoff/w1-c21-registrations.md for the per-path unreachability proof.
const W1_C21_RETIRED = [
  // Duplicate server-side Firebase supplier authority: read the same `suppliers` collection as
  // the governed Supplier Master (functions/src/supplierMaster/*) under an ungoverned shape
  // (contactEmail/leadTimeDays). No importer anywhere in functions/src; never exported from
  // index.ts, so no deployed function could reach it.
  "functions/src/supplierService.ts",
  // Epic 8 "Operations Intelligence Unification Layer": a client Firestore reader whose every
  // exported symbol had zero references repo-wide and on all twelve concurrent lane branches.
  "field-ops-app-vite/src/analytics/operationsIntelligenceService.ts",
  // F-RULES-1 scoped technician read of fieldops_jobs. Its one consumer, modules/mobile/
  // FieldMode.jsx, no longer reads fieldops_jobs at all; the scoped READ rule in firestore.rules
  // is unaffected and still fails closed on an unconstrained technician read.
  "field-ops-app-vite/src/hooks/useAssignedJobs.js",
];

test("W1-C21 retired Firebase business-runtime modules stay retired -- absent from the tree", () => {
  const returned = W1_C21_RETIRED.filter((path) => existsSync(join(REPO_ROOT, path)));
  assert.deepEqual(returned, [],
    "a module retired by W1-C21 is back on disk. It was deleted because it was proven " +
    "unreachable -- no importer, no caller, no runtime path. Reintroducing it needs that proof " +
    "re-examined and this pin removed deliberately; see docs/handoff/w1-c21-registrations.md:\n" +
    returned.map((p) => `  ${p}`).join("\n"));
});

test("W1-C21 retired modules stay out of the baseline -- the ratchet never re-grows for them", () => {
  const baseline = loadBaseline(REPO_ROOT);
  const reentered = [];
  for (const category of FORBIDDEN_CATEGORIES) {
    const paths = baselinePathsFor(baseline, category.key);
    for (const path of W1_C21_RETIRED) {
      if (paths.has(path)) reentered.push(`${category.key}: ${path}`);
    }
  }
  assert.deepEqual(reentered, [],
    `a W1-C21-retired path is back in ${"docs/architecture/firebase-exit-baseline.json"} -- the ` +
    "baseline is a floor that may only shrink:\n" + reentered.map((p) => `  ${p}`).join("\n"));
});

// =============================================================================================
// SCAN COVERAGE: category.root as a real per-file filter, .mjs, and the integrations/ boundary
// =============================================================================================
//
// What is being proven here:
//
//   * `root` is a PER-FILE FILTER, not just a list of directories to walk. Before this, scanTree
//     collected the roots, walked them, and evaluated EVERY category against EVERY file from
//     EVERY root. With two roots that was invisible; adding a third made
//     field-ops-app-vite/src/types/workOrder.ts report as an "integration-boundary Firestore
//     client" (239 such false violations, measured). A file is now only tested against the
//     categories whose root actually contains it;
//
//   * widening coverage never narrows it: all four business-runtime classes are fenced at all
//     three roots, so nothing the previous unfiltered classifier caught is now unfenced;
//
//   * .mjs is scanned -- integrations/ is written entirely in ESM .mjs, so without this the
//     root would be walked and every file in it would still be invisible to the classifier;
//
//   * a Firebase business-runtime import placed under integrations/ IS caught (the negative
//     test: this is the hole the whole change exists to close);
//
//   * integrations/ has no Firebase business-runtime dependency today, so closing the hole does
//     not grow docs/architecture/firebase-exit-baseline.json.
import { mkdirSync, readdirSync } from "node:fs";

import {
  SCAN_EXTENSIONS,
  categoriesForPath,
  categoryOwnsPath,
} from "./firebaseExitGuard.mjs";

const SCAN_ROOT_PATHS = ["field-ops-app-vite/src", "functions/src", "integrations"];
const BUSINESS_RUNTIME_CLASS_NAMES = [
  "firestore_client",
  "firebase_functions_client",
  "firebase_admin_firestore",
  "firebase_functions_server",
];
const SPECIFIER_FOR_CLASS = {
  firestore_client: "firebase/firestore",
  firebase_functions_client: "firebase/functions",
  firebase_admin_firestore: "firebase-admin/firestore",
  firebase_functions_server: "firebase-functions/v2/https",
};

/** Build a throwaway source tree so scanTree can be exercised end-to-end without touching the
 * repository under test. */
function withFixtureTree(files, body) {
  const dir = mkdtempSync(join(tmpdir(), "firebase-exit-guard-tree-"));
  try {
    for (const [relativePath, contents] of Object.entries(files)) {
      const full = join(dir, ...relativePath.split("/"));
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, contents);
    }
    return body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------
// root is a per-file filter
// ---------------------------------------------------------------------------------------------

test("categoryOwnsPath matches only a file genuinely inside the root, never a bare string prefix", () => {
  const integrations = FORBIDDEN_CATEGORIES.find((category) => category.root === "integrations");
  assert.equal(categoryOwnsPath(integrations, "integrations/chatgpt-eos-intake/src/app.mjs"), true);
  // "integrations-archive" starts with "integrations" as a string but is a different directory.
  assert.equal(categoryOwnsPath(integrations, "integrations-archive/src/app.mjs"), false);
  assert.equal(categoryOwnsPath(integrations, "docs/integrations/notes.js"), false);

  const server = FORBIDDEN_CATEGORIES.find((category) => category.root === "functions/src");
  assert.equal(categoryOwnsPath(server, "functions/src/coverage/coverageCallables.ts"), true);
  assert.equal(categoryOwnsPath(server, "functions/srcfoo/x.ts"), false);
  assert.equal(categoryOwnsPath(server, "functions/scripts/x.js"), false);
});

test("categoriesForPath returns exactly the categories of the root that contains the file", () => {
  for (const root of SCAN_ROOT_PATHS) {
    const categories = categoriesForPath(`${root}/some/module.ts`);
    assert.deepEqual(
      categories.map((category) => category.root),
      new Array(BUSINESS_RUNTIME_CLASS_NAMES.length).fill(root),
      `${root} files must only be classified against ${root} categories`);
  }
  // A file under no business-runtime root is classified against nothing at all.
  assert.deepEqual(categoriesForPath("scripts/firebaseExitGuard.mjs"), []);
  assert.deepEqual(categoriesForPath("docs/architecture/firebase-exit-ratchet.md"), []);
});

// THE TRAP. Adding a third root without making `root` a per-file filter reported
// field-ops-app-vite/src/types/workOrder.ts as an integration-boundary Firestore client, because
// `root` only ever contributed to the set of directories WALKED -- every category was then
// evaluated against every file from every root.
test("a frontend file is classified only under its own root's category, never under another " +
  "root's category", () => {
  const categories = classifyFile(
    'import type { DocumentData } from "firebase/firestore";',
    "field-ops-app-vite/src/types/workOrder.ts");
  assert.deepEqual([...categories], ["frontend.firestore_client"]);

  const serverCategories = classifyFile(
    'import { getFirestore } from "firebase-admin/firestore";',
    "functions/src/inventory/inventoryWrites.ts");
  assert.deepEqual([...serverCategories], ["server.firebase_admin_firestore"]);

  const integrationCategories = classifyFile(
    'import { getFirestore } from "firebase-admin/firestore";',
    "integrations/chatgpt-eos-intake/src/store.mjs");
  assert.deepEqual([...integrationCategories], ["integrations.firebase_admin_firestore"]);
});

// ---------------------------------------------------------------------------------------------
// Widening coverage must never narrow it
// ---------------------------------------------------------------------------------------------

test("every business-runtime dependency class is fenced at every business-runtime root", () => {
  const expected = SCAN_ROOT_PATHS.flatMap((root) =>
    BUSINESS_RUNTIME_CLASS_NAMES.map((name) => `${root} :: ${name}`));
  const actual = FORBIDDEN_CATEGORIES.map(
    (category) => `${category.root} :: ${category.key.split(".")[1]}`);
  assert.deepEqual(actual.sort(), expected.sort(),
    "a class fenced at one root but not another is a hole: restricting a class to the root where " +
    "it happens to have baseline entries today would REMOVE coverage the unfiltered classifier had");
});

test("each root/class pair actually fires on its own specifier and on nothing else", () => {
  for (const root of SCAN_ROOT_PATHS) {
    for (const name of BUSINESS_RUNTIME_CLASS_NAMES) {
      const source = `import * as x from "${SPECIFIER_FOR_CLASS[name]}";`;
      const categories = [...classifyFile(source, `${root}/module.mjs`)];
      assert.equal(categories.length, 1, `${root} + ${name} must produce exactly one category`);
      assert.equal(categories[0].endsWith(`.${name}`), true,
        `${root} + ${name} produced ${categories[0]}`);
      assert.equal(
        FORBIDDEN_CATEGORIES.find((category) => category.key === categories[0]).root, root);
    }
  }
});

test("identity-only Firebase imports stay unfenced at the integrations root too", () => {
  const identitySource = [
    'import { getAuth } from "firebase-admin/auth";',
    'import { initializeApp } from "firebase-admin/app";',
    'import { logger } from "firebase-functions/logger";',
  ].join("\n");
  assert.deepEqual(
    [...classifyFile(identitySource, "integrations/chatgpt-eos-intake/src/auth.mjs")], []);
});

// ---------------------------------------------------------------------------------------------
// .mjs is scanned
// ---------------------------------------------------------------------------------------------

test("SCAN_EXTENSIONS includes .mjs -- integrations/ is written entirely in ESM .mjs", () => {
  assert.equal(SCAN_EXTENSIONS.includes(".mjs"), true);
  const integrationSources = readdirSync(join(REPO_ROOT, "integrations/chatgpt-eos-intake/src"));
  assert.ok(
    integrationSources.some((entry) => entry.endsWith(".mjs")),
    "integrations/chatgpt-eos-intake/src must still be .mjs -- if it is not, this guard's " +
    "extension coverage needs rechecking, not this assertion relaxing");
  assert.ok(
    integrationSources.every(
      (entry) => SCAN_EXTENSIONS.some((extension) => entry.endsWith(extension))),
    "every hand-authored integrations source file must match a scanned extension");
});

// ---------------------------------------------------------------------------------------------
// THE NEGATIVE TEST: a Firebase business-runtime import under integrations/ is now caught
// ---------------------------------------------------------------------------------------------

test("a firebase-admin/firestore import placed under integrations/ is a violation against an " +
  "empty baseline", () => {
  withFixtureTree({
    "integrations/chatgpt-eos-intake/src/store.mjs":
      'import { getFirestore } from "firebase-admin/firestore";\nexport const db = getFirestore();\n',
  }, (root) => {
    const scanResults = scanTree(root);
    assert.deepEqual(
      [...scanResults.get("integrations.firebase_admin_firestore")],
      ["integrations/chatgpt-eos-intake/src/store.mjs"],
      "an .mjs module under integrations/ importing firebase-admin/firestore must be seen");

    const { violations } = evaluateGuard(makeBaseline(), scanResults);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].category, "integrations.firebase_admin_firestore");
    assert.equal(violations[0].path, "integrations/chatgpt-eos-intake/src/store.mjs");
  });
});

test("each forbidden class placed under integrations/ is caught, including the callable " +
  "transports", () => {
  for (const name of BUSINESS_RUNTIME_CLASS_NAMES) {
    withFixtureTree({
      "integrations/chatgpt-eos-intake/src/probe.mjs":
        `import * as x from "${SPECIFIER_FOR_CLASS[name]}";\nexport default x;\n`,
    }, (root) => {
      const { violations } = evaluateGuard(makeBaseline(), scanTree(root));
      assert.deepEqual(
        violations.map((violation) => violation.category),
        [`integrations.${name}`],
        `${SPECIFIER_FOR_CLASS[name]} under integrations/ must be a violation`);
    });
  }
});

test("widening to integrations/ produces no violation for files in the other roots -- the " +
  "239-false-violation trap stays closed", () => {
  withFixtureTree({
    "field-ops-app-vite/src/types/workOrder.ts":
      'import type { DocumentData } from "firebase/firestore";\nexport type T = DocumentData;\n',
    "functions/src/inventory/writes.ts":
      'import { getFirestore } from "firebase-admin/firestore";\nexport const db = getFirestore();\n',
    "integrations/chatgpt-eos-intake/src/app.mjs":
      'import express from "express";\nexport default express();\n',
  }, (root) => {
    const { violations } = evaluateGuard(makeBaseline(), scanTree(root));
    assert.deepEqual(
      violations.map((violation) => `${violation.category} ${violation.path}`).sort(),
      [
        "frontend.firestore_client field-ops-app-vite/src/types/workOrder.ts",
        "server.firebase_admin_firestore functions/src/inventory/writes.ts",
      ],
      "each file must be reported exactly once, under the category of the root that owns it");
  });
});

// ---------------------------------------------------------------------------------------------
// Closing the hole must not grow the baseline
// ---------------------------------------------------------------------------------------------

test("integrations/ has no Firebase business-runtime dependency today, so scanning it adds " +
  "nothing to the baseline", () => {
  const scanResults = scanTree(REPO_ROOT);
  for (const category of FORBIDDEN_CATEGORIES) {
    if (category.root !== "integrations") continue;
    assert.deepEqual([...scanResults.get(category.key)], [],
      `${category.key} must be empty -- if a real dependency appeared here it is a violation to ` +
      "migrate off, never a baseline entry to add");
  }
});

test("every category the live scan observes is covered by the committed baseline, and the " +
  "eight zero-entry cross categories stay at zero", () => {
  const baseline = loadBaseline(REPO_ROOT);
  const scanResults = scanTree(REPO_ROOT);
  const populated = FORBIDDEN_CATEGORIES
    .filter((category) => scanResults.get(category.key).size > 0)
    .map((category) => category.key);
  assert.deepEqual(populated.sort(), [
    "frontend.firebase_functions_client",
    "frontend.firestore_client",
    "server.firebase_admin_firestore",
    "server.firebase_functions_server",
  ], "a newly populated category is a new Firebase dependency, not a baseline update");
  for (const key of populated) {
    assert.equal(baselinePathsFor(baseline, key).size, scanResults.get(key).size);
  }
});

// =================================================================================================
// THE NAMESPACE-ACCESS BYPASS
//
// Re-derived and re-closed against main at 64008d5ae0bdd9532909671b15a91122400accf1.
//
// WHAT WAS WRONG. Every class matched the SUBPATH specifier only. The package ROOT reaches the
// identical Firestore business persistence and named no forbidden specifier, so it was invisible:
//
//     import admin from "firebase-admin";
//     await admin.firestore().collection("workOrders").get();
//
// Measured, not inferred. A file of that shape written under functions/src produced ZERO
// violations from a REAL ratchet run (`--previous-baseline` against the committed baseline, exit
// 0) at 64008d5a; the same file written with "firebase-admin/firestore" produced one violation
// (exit 1). Fifteen further shapes were equally invisible; the census below is the list, and every
// one of them is asserted here.
//
// WHAT MUST NOT CHANGE. `matchesSource` is consulted ONLY when `matchesSpecifier` did not match, so
// classification is a strict superset of the previous behaviour by construction. The committed
// baseline's 366 guarded entries (55 + 55 + 184 + 72) are unchanged by this and that is asserted
// against the real tree below, not assumed.
//
// WHAT MUST STILL PASS. Firebase Auth identity is permitted by Owner ruling.
// functions/src/eosApi/server.ts imports the bare "firebase-admin" root purely to call
// app.auth().verifyIdToken(). It is pinned to the REAL FILE here, not a fixture, because a fixture
// would keep passing after the real file changed.
// =================================================================================================

import { readFileSync as readSourceFile } from "node:fs";
import {
  classifyFile as classify,
  stripCommentsAndStringLiterals,
  FORBIDDEN_CATEGORIES as CATEGORIES,
  scanTree as scan,
  loadBaseline as loadCommittedBaseline,
  baselinePathsFor as baselineSetFor,
} from "./firebaseExitGuard.mjs";

const SERVER_PROBE = "functions/src/probe.ts";
const FRONTEND_PROBE = "field-ops-app-vite/src/probe.jsx";

/** Every evasion shape confirmed invisible at 64008d5a, with the category each must now produce. */
const EVASION_CENSUS = [
  ["default import + admin.firestore()", SERVER_PROBE,
    'import admin from "firebase-admin";\nexport const r = () => admin.firestore().collection("workOrders").get();',
    "server.firebase_admin_firestore"],
  ["namespace import", SERVER_PROBE,
    'import * as admin from "firebase-admin";\nexport const r = () => admin.firestore().doc("a/b").get();',
    "server.firebase_admin_firestore"],
  ["aliased namespace", SERVER_PROBE,
    'import * as fb from "firebase-admin";\nexport const r = () => fb.firestore().collection("x").get();',
    "server.firebase_admin_firestore"],
  ["require()", SERVER_PROBE,
    'const admin = require("firebase-admin");\nexport const r = () => admin.firestore().collection("x").get();',
    "server.firebase_admin_firestore"],
  ["chained require().firestore()", SERVER_PROBE,
    'export const r = () => require("firebase-admin").firestore().collection("x").get();',
    "server.firebase_admin_firestore"],
  ["dynamic import()", SERVER_PROBE,
    'export const r = async () => (await import("firebase-admin")).firestore().collection("x").get();',
    "server.firebase_admin_firestore"],
  ["admin.app().firestore()", SERVER_PROBE,
    'import admin from "firebase-admin";\nexport const r = () => admin.app().firestore().collection("x").get();',
    "server.firebase_admin_firestore"],
  ["admin.firestore.FieldValue sentinel namespace", SERVER_PROBE,
    'import admin from "firebase-admin";\nexport const s = () => admin.firestore.FieldValue.serverTimestamp();',
    "server.firebase_admin_firestore"],
  ["destructured handle", SERVER_PROBE,
    'const { firestore } = require("firebase-admin");\nexport const r = () => firestore().collection("x").get();',
    "server.firebase_admin_firestore"],
  ["reassigned local alias", SERVER_PROBE,
    'import admin from "firebase-admin";\nconst h = admin;\nexport const r = () => h.firestore().collection("x").get();',
    "server.firebase_admin_firestore"],
  ["frontend firebase/app + firebase.firestore()", FRONTEND_PROBE,
    'import firebase from "firebase/app";\nexport const r = () => firebase.firestore().collection("jobs").get();',
    "frontend.firestore_client"],
  ["frontend bare firebase namespace", FRONTEND_PROBE,
    'import firebase from "firebase";\nexport const r = () => firebase.firestore().collection("jobs").get();',
    "frontend.firestore_client"],
  ["frontend firebase/compat/firestore specifier", FRONTEND_PROBE,
    'import "firebase/compat/firestore";\nexport const m = 1;',
    "frontend.firestore_client"],
  ["frontend firebase/compat/functions specifier", FRONTEND_PROBE,
    'import "firebase/compat/functions";\nexport const m = 1;',
    "frontend.firebase_functions_client"],
  ["frontend firebase.functions() compat call", FRONTEND_PROBE,
    'import firebase from "firebase/app";\nexport const c = (n) => firebase.functions().httpsCallable(n);',
    "frontend.firebase_functions_client"],
];

for (const [shape, path, source, expectedCategory] of EVASION_CENSUS) {
  test(`evasion shape is caught: ${shape}`, () => {
    const categories = classify(source, path);
    assert.ok(categories.has(expectedCategory),
      `${shape} must classify as ${expectedCategory}; got [${[...categories].join(", ")}]`);
  });
}

test("the bare firebase-functions package root is caught by SPECIFIER alone, which is why " +
  "firebase_functions_server needs no matchesSource", () => {
  const categories = classify(
    'import functions from "firebase-functions";\nexport const f = functions.https.onCall(() => 1);',
    SERVER_PROBE);
  assert.ok(categories.has("server.firebase_functions_server"));
  const serverFunctions = CATEGORIES.find((c) => c.key === "server.firebase_functions_server");
  assert.equal(serverFunctions.matchesSource, undefined,
    "if this class ever gains a matchesSource, the claim in its comment must be re-verified");
});

// ------------------------------- IDENTITY_ONLY MUST STILL PASS -----------------------------------

test("the REAL functions/src/eosApi/server.ts -- the only bare-firebase-admin importer under a " +
  "scan root -- is identity-only and must not trip any category", () => {
  const relativePath = "functions/src/eosApi/server.ts";
  const text = readSourceFile(join(REPO_ROOT, relativePath), "utf8");
  assert.ok(/["']firebase-admin["']/.test(text),
    "this test is only meaningful while server.ts still imports the bare firebase-admin root; if " +
    "that changed, re-point it at whatever file now does, or delete it as obsolete");
  assert.ok(/verifyIdToken/.test(text), "identity use is what makes this the carve-out");
  assert.deepEqual([...classify(text, relativePath)], [],
    "Firebase Auth identity is permitted by Owner ruling -- importing the firebase-admin root is " +
    "not the violation; persisting business data through it is");
});

test("bare-admin identity code whose ONLY Firestore mention is in a comment, a string, or a " +
  "template literal does not trip -- blanking is what keeps this from being a keyword scan", () => {
  const source = [
    'import admin from "firebase-admin";',
    "// Migrated off admin.firestore.FieldValue.serverTimestamp() in wave 1.",
    '/* The old path was admin.firestore().collection("x") -- kept for history. */',
    'const note = "admin.firestore().collection(\'x\')";',
    "const tmpl = `also ${\"admin.firestore()\"} in a template`;",
    "export const v = async (t) => (await admin.auth().verifyIdToken(t)).uid;",
    "export const notes = [note, tmpl];",
  ].join("\n");
  assert.deepEqual([...classify(source, SERVER_PROBE)], []);
});

test("the real repository file that discusses firebase in PROSE while importing nothing stays " +
  "unflagged -- the case this module's header calls out by name", () => {
  const relativePath = "field-ops-app-vite/src/domain/equipmentWrites.js";
  const text = readSourceFile(join(REPO_ROOT, relativePath), "utf8");
  assert.ok(/firebase/i.test(text), `${relativePath} no longer mentions firebase`);
  assert.deepEqual([...classify(text, relativePath)], [], relativePath);
});

test("the two real files that mention admin.firestore in a COMMENT are classified by SPECIFIER " +
  "only -- matchesSource adds nothing to them, so no entry is reclassified", () => {
  // Both import `type { Timestamp }` from the Firestore subpath, which the specifier matcher
  // deliberately matches (the `from` clause is unaffected by `type`), so both are already baseline
  // entries. The point being pinned is that their prose mention of admin.firestore contributes
  // NOTHING: the category set is exactly the one specifier matching alone produces.
  const expected = {
    "functions/src/types/workOrder.ts": ["server.firebase_admin_firestore"],
    "field-ops-app-vite/src/types/workOrder.ts": ["frontend.firestore_client"],
  };
  for (const [relativePath, categories] of Object.entries(expected)) {
    const text = readSourceFile(join(REPO_ROOT, relativePath), "utf8");
    assert.ok(/admin\.firestore/.test(text), `${relativePath} no longer mentions admin.firestore`);
    assert.ok(!/["']firebase-admin["']/.test(text),
      `${relativePath} now imports the bare firebase-admin root -- re-derive this expectation`);
    assert.deepEqual([...classify(text, relativePath)].sort(), categories, relativePath);
  }
});

test("a Firestore access expression with NO firebase package-root import is not a violation -- " +
  "half one of the conjunction is what stops this becoming a keyword scan", () => {
  assert.deepEqual([...classify(
    'import { thing } from "./local";\nexport const r = () => thing.firestore().get();',
    SERVER_PROBE)], []);
});

test("firebase/app imported for identity only (initializeApp beside firebase/auth) does not trip", () => {
  assert.deepEqual([...classify(
    'import { initializeApp } from "firebase/app";\nimport { getAuth } from "firebase/auth";\n' +
    "export const auth = getAuth(initializeApp({}));",
    FRONTEND_PROBE)], []);
});

test("firebase-admin root imported for storage only is not one of the four fenced classes", () => {
  assert.deepEqual([...classify(
    'import admin from "firebase-admin";\nexport const b = () => admin.storage().bucket();',
    SERVER_PROBE)], []);
});

test(".functions. member access on an unrelated object is not the Functions client -- the " +
  "frontend Functions pattern is deliberately call-only", () => {
  assert.deepEqual([...classify(
    'import firebase from "firebase/app";\nexport const r = (c) => c.functions.region;',
    FRONTEND_PROBE)], []);
});

// ------------------------------------ BLANKING ITSELF --------------------------------------------

test("stripCommentsAndStringLiterals removes comment and literal contents and keeps code", () => {
  assert.equal(stripCommentsAndStringLiterals('a; // b.firestore()\nc;'), "a; \nc;");
  assert.equal(stripCommentsAndStringLiterals("a; /* b.firestore() */ c;"), "a;  c;");
  assert.equal(stripCommentsAndStringLiterals('const x = "b.firestore()"; y;'), 'const x = ""; y;');
  assert.equal(stripCommentsAndStringLiterals("const x = `${b.firestore()}`; y;"), "const x = ``; y;");
  assert.equal(stripCommentsAndStringLiterals('a.firestore(); "z";'), 'a.firestore(); "";');
});

test("an escaped quote inside a string does not end the literal early, so code after it is not " +
  "mistaken for literal content", () => {
  assert.equal(stripCommentsAndStringLiterals('const x = "a\\"b"; y.firestore();'),
    'const x = ""; y.firestore();');
});

// ------------------------- SUPERSET PROPERTY AND THE COMMITTED BASELINE --------------------------

test("classification is a strict SUPERSET: every file the specifier matcher alone would classify " +
  "is still classified identically with matchesSource wired in", () => {
  for (const category of CATEGORIES) {
    assert.equal(typeof category.matchesSpecifier, "function", category.key);
    if (category.matchesSource !== undefined) {
      assert.equal(typeof category.matchesSource, "function", category.key);
    }
  }
  // A file matched by specifier is classified by specifier regardless of source shape: here the
  // source has no access expression at all, so only the specifier path can be responsible.
  assert.ok(classify('import { getFirestore } from "firebase-admin/firestore";\nexport const m = 1;',
    SERVER_PROBE).has("server.firebase_admin_firestore"));
});

test("the live tree still produces EXACTLY the committed baseline after the namespace fix -- 365 " +
  "guarded entries across four populated categories, nothing lost and nothing reclassified", () => {
  const scanResults = scan(REPO_ROOT);
  const baseline = loadCommittedBaseline(REPO_ROOT);
  const expected = {
    "frontend.firestore_client": 55,
    "frontend.firebase_functions_client": 55,
    // 184 -> 183: the Firestore policy parity harness (adminPolicy/migration/firestorePolicyParityHarness.ts) was
    // deleted with its baseline entry by the role-assignment census (shrink-only; never grown).
    "server.firebase_admin_firestore": 183,
    "server.firebase_functions_server": 72,
  };
  let total = 0;
  for (const category of CATEGORIES) {
    const observed = scanResults.get(category.key);
    total += observed.size;
    assert.equal(observed.size, expected[category.key] ?? 0,
      `${category.key} changed size -- the namespace fix must not grow or shrink the baseline`);
    assert.deepEqual([...observed].sort(), [...baselineSetFor(baseline, category.key)].sort(),
      `${category.key} membership changed`);
  }
  assert.equal(total, 365);
});
