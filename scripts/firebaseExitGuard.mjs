// FIREBASE EXIT GUARD. Fails on a NEW Firebase business-runtime dependency beyond the
// committed baseline; tolerates the baseline itself so migration can proceed incrementally.
//
// ============================ WHAT THIS FENCES ============================
//
// docs/architecture/firebase-exit-manifest.json calls out four dependency classes that must
// trend to zero: frontend Firestore reads/writes, frontend Firebase Functions callables,
// server firebase-admin Firestore persistence, and server firebase-functions business runtime
// (v1/v2 triggers and callables). This module fences exactly those four, by exact import/module
// signature -- not by a keyword scan, and not by directory alone, because a broad scan would
// also trip on the word "firebase" in a comment (see field-ops-app-vite/src/domain/equipmentWrites.js,
// which discusses firebase in prose but imports nothing).
//
// ============================ WHAT THIS DOES NOT FENCE ============================
//
// firebase/auth, firebase-admin/auth, and firebase-admin/app are IDENTITY_ONLY: sign-in and UID
// correlation to an EOS Principal/Employee. That is permanently permitted per the architecture
// ruling and is deliberately absent from FORBIDDEN_CATEGORIES below. A file that imports only
// identity modules never trips this guard, no matter how many of them it imports.
//
// ============================ THE RATCHET ============================
//
// docs/architecture/firebase-exit-baseline.json is a floor, not a target: every file already in
// it is tolerated for its recorded category so migration can happen incrementally, but the set
// may only shrink. A file NOT in the baseline for a category that starts using that category's
// dependency is a new violation. See docs/architecture/firebase-exit-ratchet.md.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const REPO_ROOT = process.cwd();
const BASELINE_RELATIVE_PATH = "docs/architecture/firebase-exit-baseline.json";

const SCAN_EXTENSIONS = [".js", ".jsx", ".ts", ".tsx"];
const SKIP_DIRECTORIES = new Set([".git", "node_modules", "dist", "build", "coverage", ".next", "lib"]);

/**
 * Any import/require/dynamic-import specifier, captured whichever form produced it.
 * Deliberately matches `import type { X } from "y"` (the `from` clause is unaffected by
 * `type`), and deliberately matches dynamic `import("y")` because that is how several of the
 * baseline's frontend callable clients lazily load "firebase/functions" to avoid an
 * import-time initializeApp side effect.
 */
const IMPORT_SPECIFIER_PATTERN =
  /\bfrom\s+["']([^"']+)["']|\brequire\(\s*["']([^"']+)["']\s*\)|\bimport\(\s*["']([^"']+)["']\s*\)|^\s*import\s+["']([^"']+)["']/gm;

export function extractImportSpecifiers(text) {
  const specifiers = [];
  IMPORT_SPECIFIER_PATTERN.lastIndex = 0;
  let match;
  while ((match = IMPORT_SPECIFIER_PATTERN.exec(text)) !== null) {
    const specifier = match[1] ?? match[2] ?? match[3] ?? match[4];
    if (specifier) specifiers.push(specifier);
  }
  return specifiers;
}

/**
 * The four business-runtime dependency classes, keyed exactly as they are keyed in
 * docs/architecture/firebase-exit-baseline.json (`baseline.<root>.<key>`), so a category's
 * baseline set can be looked up directly by splitting `key` on ".".
 */
export const FORBIDDEN_CATEGORIES = [
  {
    key: "frontend.firestore_client",
    root: "field-ops-app-vite/src",
    label: "firebase/firestore (frontend Firestore business client)",
    matchesSpecifier: (specifier) =>
      specifier === "firebase/firestore" || specifier.startsWith("firebase/firestore/"),
  },
  {
    key: "frontend.firebase_functions_client",
    root: "field-ops-app-vite/src",
    label: "firebase/functions (frontend Firebase Functions business transport)",
    matchesSpecifier: (specifier) =>
      specifier === "firebase/functions" || specifier.startsWith("firebase/functions/"),
  },
  {
    key: "server.firebase_admin_firestore",
    root: "functions/src",
    label: "firebase-admin/firestore (server Firestore business persistence)",
    matchesSpecifier: (specifier) =>
      specifier === "firebase-admin/firestore" || specifier.startsWith("firebase-admin/firestore/"),
  },
  {
    key: "server.firebase_functions_server",
    root: "functions/src",
    label: "firebase-functions business runtime (v1/v2 triggers and callables)",
    // Deliberately excludes "firebase-functions/logger" and "firebase-functions/params":
    // those are not business transport or business persistence.
    matchesSpecifier: (specifier) => /^firebase-functions(\/v[12](\/.*)?)?$/.test(specifier),
  },
];

export function classifyFile(text) {
  const specifiers = extractImportSpecifiers(text);
  const categories = new Set();
  for (const category of FORBIDDEN_CATEGORIES) {
    if (specifiers.some((specifier) => category.matchesSpecifier(specifier))) {
      categories.add(category.key);
    }
  }
  return categories;
}

function walk(directory, found = []) {
  let entries;
  try {
    entries = readdirSync(directory);
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (SKIP_DIRECTORIES.has(entry)) continue;
    const full = join(directory, entry);
    let info;
    try {
      info = statSync(full);
    } catch {
      continue;
    }
    if (info.isDirectory()) walk(full, found);
    else if (SCAN_EXTENSIONS.some((extension) => entry.endsWith(extension))) found.push(full);
  }
  return found;
}

/** Scan the live-runtime roots and return { categoryKey => Set<relativePath> }. */
export function scanTree(absoluteRoot = REPO_ROOT) {
  const results = new Map(FORBIDDEN_CATEGORIES.map((category) => [category.key, new Set()]));
  const scanRoots = new Set(FORBIDDEN_CATEGORIES.map((category) => category.root));
  for (const scanRoot of scanRoots) {
    for (const file of walk(join(absoluteRoot, scanRoot))) {
      const relativePath = relative(absoluteRoot, file).split(sep).join("/");
      let text;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      for (const key of classifyFile(text)) {
        results.get(key).add(relativePath);
      }
    }
  }
  return results;
}

export function loadBaseline(absoluteRoot = REPO_ROOT) {
  const path = join(absoluteRoot, BASELINE_RELATIVE_PATH);
  return JSON.parse(readFileSync(path, "utf8"));
}

export function baselinePathsFor(baseline, categoryKey) {
  const [section, name] = categoryKey.split(".");
  return new Set(baseline?.baseline?.[section]?.[name] ?? []);
}

/**
 * Compare a scan against the baseline. `violations` is the set that must never be
 * non-empty: a file not recorded in the baseline for a category, using that category's
 * dependency. `decreased` is the set of baseline entries no longer observed -- the ratchet
 * moving toward zero -- and is informational only, never a failure.
 */
export function evaluateGuard(baseline, scanResults) {
  const violations = [];
  const decreased = [];
  for (const category of FORBIDDEN_CATEGORIES) {
    const baselineSet = baselinePathsFor(baseline, category.key);
    const currentSet = scanResults.get(category.key) ?? new Set();
    for (const path of currentSet) {
      if (!baselineSet.has(path)) {
        violations.push({ category: category.key, label: category.label, path });
      }
    }
    for (const path of baselineSet) {
      if (!currentSet.has(path)) {
        decreased.push({ category: category.key, path });
      }
    }
  }
  return { violations, decreased };
}

if (import.meta.url === `file://${process.argv[1]?.split(sep).join("/")}` ||
    process.argv[1]?.endsWith("firebaseExitGuard.mjs")) {
  const baseline = loadBaseline();
  const scanResults = scanTree();
  const { violations, decreased } = evaluateGuard(baseline, scanResults);

  if (violations.length) {
    for (const violation of violations) {
      console.error(
        `::error file=${violation.path}::new Firebase business-runtime dependency ` +
        `(${violation.label}) not present in ${BASELINE_RELATIVE_PATH}`);
    }
    console.error(
      `\n${violations.length} file(s) introduce Firebase business-runtime dependencies beyond ` +
      "the committed baseline. The baseline may only shrink -- see docs/architecture/firebase-exit-ratchet.md.\n" +
      "If this is genuinely sign-in identity or UID correlation (firebase/auth, firebase-admin/auth, " +
      "firebase-admin/app), it does not belong in this fence at all -- see " +
      "docs/architecture/firebase-exit-manifest.json.");
    process.exit(1);
  }

  if (decreased.length) {
    console.log(
      `${decreased.length} baseline Firebase business-runtime reference(s) no longer observed ` +
      "(ratchet moved toward zero).");
  }
  console.log("no new Firebase business-runtime dependencies beyond the committed baseline");
}
