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
// correlation to an EOS Principal/Employee. That is outside the BUSINESS_RUNTIME ratchet enforced
// by this module and is deliberately absent from FORBIDDEN_CATEGORIES below -- eventual
// identity/auth migration is a separate future Firebase-exit concern, not decided here. A file
// that imports only identity modules never trips this guard, no matter how many of them it
// imports.
//
// ============================ THE RATCHET ============================
//
// docs/architecture/firebase-exit-baseline.json is a floor, not a target: every file already in
// it is tolerated for its recorded category so migration can happen incrementally, but the set
// may only shrink. This is enforced by TWO independent checks, both of which must pass:
//
//   1. EXACT MATCH (evaluateGuard): the candidate baseline must describe exactly the forbidden
//      dependencies observed in the candidate source tree right now -- no more (a violation: a
//      file uses a forbidden dependency the baseline doesn't record) and no less (a stale entry:
//      the baseline claims a file uses a dependency it no longer does). A stale entry is not
//      informational -- it is a live bypass, because the guard would tolerate that file
//      reintroducing the dependency later without ever tripping a violation.
//
//   2. RATCHET (evaluateRatchet): the candidate baseline, compared against the previously
//      accepted baseline (the PR base / prior main commit), must never ADD a path to any
//      category -- only remove. Without this, a single PR could add a new forbidden dependency
//      AND add the same path to the baseline in the same change, defeating check 1 entirely.
//
// See docs/architecture/firebase-exit-ratchet.md.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const REPO_ROOT = process.cwd();
const BASELINE_RELATIVE_PATH = "docs/architecture/firebase-exit-baseline.json";

const SCAN_EXTENSIONS = [".js", ".jsx", ".ts", ".tsx"];
/**
 * Only vendored/VCS directories that can never legitimately contain hand-authored business
 * source under a scan root (field-ops-app-vite/src, functions/src). Do NOT add build-output
 * names like "lib", "dist", "build", "coverage", or ".next" here: those collide by basename
 * with real source subdirectories inside the scan roots -- e.g. field-ops-app-vite/src/lib/
 * (firebaseSafe.js) and functions/src/coverage/ (coverageCallables.ts) both exist and both
 * import forbidden business-runtime dependencies. A basename-only skip silently blinds the
 * walk to an entire subtree, which is a bypass, not a filter: see
 * docs/architecture/firebase-exit-ratchet.md.
 */
export const SKIP_DIRECTORIES = new Set([".git", "node_modules"]);

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

/** Load a baseline JSON document from an arbitrary path (used for both the candidate baseline
 * committed in the working tree and a previous baseline materialized to a temp file). */
export function loadBaselineFromPath(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadBaseline(absoluteRoot = REPO_ROOT) {
  return loadBaselineFromPath(join(absoluteRoot, BASELINE_RELATIVE_PATH));
}

export function baselinePathsFor(baseline, categoryKey) {
  const [section, name] = categoryKey.split(".");
  return new Set(baseline?.baseline?.[section]?.[name] ?? []);
}

/**
 * Compare the candidate baseline against the candidate source scan. The candidate baseline must
 * describe EXACTLY the forbidden dependencies currently observed -- both directions are a
 * failure:
 *
 *   - `violations`: a file uses a forbidden dependency the baseline does not record for it.
 *   - `staleEntries`: the baseline records a file/category the current scan no longer observes.
 *     A stale entry is unsafe, not merely outdated -- the guard would otherwise tolerate that
 *     file reintroducing the dependency later without ever tripping a violation. The baseline
 *     must shrink in lockstep with source removal; see docs/architecture/firebase-exit-ratchet.md.
 */
export function evaluateGuard(baseline, scanResults) {
  const violations = [];
  const staleEntries = [];
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
        staleEntries.push({ category: category.key, label: category.label, path });
      }
    }
  }
  return { violations, staleEntries };
}

/**
 * Compare the candidate baseline against the previously accepted baseline (PR base sha / prior
 * main commit). For every forbidden category, candidate paths must be a SUBSET of previous
 * paths: additions are forbidden (that would let a PR add a new forbidden dependency and
 * baseline it in the same change), deletions are allowed (the ratchet moving toward zero).
 *
 * `previousBaseline` is `null`/`undefined` when no previous baseline exists (bootstrap): the
 * first committed baseline has nothing to ratchet against, so `additions` is always empty and
 * `bootstrap` is `true`. Bootstrap is still constrained by `evaluateGuard`'s exact-match check.
 */
export function evaluateRatchet(previousBaseline, candidateBaseline) {
  if (!previousBaseline) {
    return { additions: [], bootstrap: true };
  }
  const additions = [];
  for (const category of FORBIDDEN_CATEGORIES) {
    const previousSet = baselinePathsFor(previousBaseline, category.key);
    const candidateSet = baselinePathsFor(candidateBaseline, category.key);
    for (const path of candidateSet) {
      if (!previousSet.has(path)) {
        additions.push({ category: category.key, label: category.label, path });
      }
    }
  }
  return { additions, bootstrap: false };
}

export function parsePreviousBaselinePath(argv) {
  for (const arg of argv) {
    if (arg.startsWith("--previous-baseline=")) return arg.slice("--previous-baseline=".length);
  }
  return undefined;
}

/** No --previous-baseline argument at all is bootstrap: there is genuinely nothing to ratchet
 * against yet. But a SUPPLIED path that is missing, unreadable, or malformed JSON must fail
 * closed -- silently treating that as bootstrap would let a ratchet bypass masquerade as a
 * harmless missing-file condition (e.g. a CI misconfiguration that points at the wrong sha). */
export function loadPreviousBaseline(path) {
  if (!path) return null;
  return loadBaselineFromPath(path);
}

if (import.meta.url === `file://${process.argv[1]?.split(sep).join("/")}` ||
    process.argv[1]?.endsWith("firebaseExitGuard.mjs")) {
  const baseline = loadBaseline();
  const scanResults = scanTree();
  const { violations, staleEntries } = evaluateGuard(baseline, scanResults);

  const previousBaselinePath = parsePreviousBaselinePath(process.argv.slice(2));
  const previousBaseline = loadPreviousBaseline(previousBaselinePath);
  const { additions, bootstrap } = evaluateRatchet(previousBaseline, baseline);

  if (violations.length) {
    for (const violation of violations) {
      console.error(
        `::error file=${violation.path}::new Firebase business-runtime dependency ` +
        `(${violation.label}) not present in ${BASELINE_RELATIVE_PATH}`);
    }
  }

  if (staleEntries.length) {
    for (const entry of staleEntries) {
      console.error(
        `::error file=${entry.path}::stale ${BASELINE_RELATIVE_PATH} entry -- ` +
        `(${entry.label}) is recorded but no longer observed in the current tree`);
    }
  }

  if (additions.length) {
    for (const addition of additions) {
      console.error(
        `::error file=${addition.path}::${BASELINE_RELATIVE_PATH} adds a new entry ` +
        `(${addition.label}) not present in the previously accepted baseline -- ` +
        "baseline additions are not allowed in the same change as the dependency");
    }
  }

  if (violations.length || staleEntries.length || additions.length) {
    console.error(
      `\n${violations.length} new violation(s), ${staleEntries.length} stale baseline ` +
      `entr(ies), ${additions.length} same-change baseline addition(s). The candidate baseline ` +
      "must exactly match the current scan, and may only shrink relative to the previously " +
      "accepted baseline -- see docs/architecture/firebase-exit-ratchet.md.\n" +
      "If this is genuinely sign-in identity or UID correlation (firebase/auth, firebase-admin/auth, " +
      "firebase-admin/app), it does not belong in this fence at all -- see " +
      "docs/architecture/firebase-exit-manifest.json.");
    process.exit(1);
  }

  if (bootstrap) {
    console.log("no previous baseline found -- bootstrap accepted (candidate baseline exactly matches scan)");
  }
  console.log("no new Firebase business-runtime dependencies beyond the committed baseline");
}
