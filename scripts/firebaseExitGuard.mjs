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
// Those four classes are fenced at each business-runtime ROOT: field-ops-app-vite/src (the Vite
// frontend), functions/src (the Cloud Functions deployment), and integrations (the standalone
// Node ESM intake service). A category's `root` is a per-file filter -- a file is only ever
// tested against the categories that own it -- so the roots stay independent and adding one
// cannot make the others' categories fire. See categoryOwnsPath.
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

/**
 * Every hand-authored source extension that can carry an import specifier under a scan root.
 * ".mjs" is here because integrations/ is written entirely in ESM .mjs: without it the
 * integration boundary was walked but every file in it was invisible to the classifier, which
 * is a bypass, not a filter. The two original roots contain exactly one .mjs file
 * (field-ops-app-vite/src/domain/inventoryControlLifecycle.cases.mjs) and it imports no
 * Firebase module, so widening the extension set does not grow the baseline.
 */
export const SCAN_EXTENSIONS = [".js", ".jsx", ".mjs", ".ts", ".tsx"];
/**
 * Only vendored/VCS directories that can never legitimately contain hand-authored business
 * source under a scan root (field-ops-app-vite/src, functions/src, integrations). Do NOT add
 * build-output names like "lib", "dist", "build", "coverage", or ".next" here: those collide by basename
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
 * The four business-runtime dependency classes, named exactly as they are named in
 * docs/architecture/firebase-exit-baseline.json (`baseline.<section>.<name>`).
 *
 * These are the four classes docs/architecture/firebase-exit-manifest.json requires to trend to
 * zero. They are defined ONCE here and crossed with every business-runtime root below, because a
 * dependency class does not stop being a Firebase business-runtime dependency because of which
 * directory it appears in.
 */
const BUSINESS_RUNTIME_CLASSES = [
  {
    name: "firestore_client",
    label: "firebase/firestore (Firestore business client)",
    matchesSpecifier: (specifier) =>
      specifier === "firebase/firestore" || specifier.startsWith("firebase/firestore/"),
  },
  {
    name: "firebase_functions_client",
    label: "firebase/functions (Firebase Functions business transport)",
    matchesSpecifier: (specifier) =>
      specifier === "firebase/functions" || specifier.startsWith("firebase/functions/"),
  },
  {
    name: "firebase_admin_firestore",
    label: "firebase-admin/firestore (Firestore business persistence)",
    matchesSpecifier: (specifier) =>
      specifier === "firebase-admin/firestore" || specifier.startsWith("firebase-admin/firestore/"),
  },
  {
    name: "firebase_functions_server",
    label: "firebase-functions business runtime (v1/v2 triggers and callables)",
    // Deliberately excludes "firebase-functions/logger" and "firebase-functions/params":
    // those are not business transport or business persistence.
    matchesSpecifier: (specifier) => /^firebase-functions(\/v[12](\/.*)?)?$/.test(specifier),
  },
];

/**
 * Every root that carries EOS business runtime, and the baseline section each is keyed under.
 *
 * `integrations` is the third root and the reason this file changed: the ChatGPT/MCP intake
 * service is a standalone Node ESM process -- neither the Vite frontend nor the Cloud Functions
 * deployment -- written entirely in .mjs. It was scanned by NO category and matched by NO
 * extension, so a module there could have imported "firebase-admin/firestore" and the ratchet
 * would never have seen it. The Firebase exit guarantee has to hold at every business-runtime
 * boundary, not only at the two that happen to use .ts/.jsx.
 *
 * All four classes are fenced at all three roots rather than only the pairs observed today.
 * Before this change `root` was not a per-file filter (see categoryOwnsPath), so every class was
 * in fact evaluated against every file of every root; restricting a class to the root where it
 * currently has entries would REMOVE coverage -- functions/src importing the web SDK
 * "firebase/firestore", or field-ops-app-vite/src importing "firebase-admin/firestore", were
 * both caught before and must stay caught. Crossing all classes with all roots keeps the new
 * behaviour a strict superset of the old, and the eight cross sets that have no entries today
 * are a ratchet pinned at zero: any such import at all is an immediate violation.
 */
const SCAN_ROOTS = [
  { section: "frontend", root: "field-ops-app-vite/src" },
  { section: "server", root: "functions/src" },
  { section: "integrations", root: "integrations" },
];

/**
 * The business-runtime classes crossed with the business-runtime roots. `key` is
 * `<section>.<name>`, keyed exactly as docs/architecture/firebase-exit-baseline.json keys it
 * (`baseline.<section>.<name>`), so a category's baseline set can be looked up directly by
 * splitting `key` on "." -- a section or name absent from the committed baseline reads as the
 * empty set, which is what the eight currently-empty cross categories rely on.
 */
export const FORBIDDEN_CATEGORIES = SCAN_ROOTS.flatMap(({ section, root }) =>
  BUSINESS_RUNTIME_CLASSES.map((businessClass) => ({
    key: `${section}.${businessClass.name}`,
    root,
    label: `${businessClass.label} in ${root}`,
    matchesSpecifier: businessClass.matchesSpecifier,
  })));

/**
 * Does `category` own `relativePath`? A category's `root` is a PER-FILE FILTER, not merely a
 * hint about which directories to walk. It used to be the latter: scanTree collected the set of
 * roots, walked them, and then evaluated EVERY category against EVERY file from EVERY root. That
 * is harmless only while all categories happen to share the same two roots -- the moment a third
 * root is added, the frontend categories start classifying server files and the integration
 * categories start classifying field-ops-app-vite/src/types/workOrder.ts as an
 * "integration-boundary Firestore client" (239 such false violations, measured). Ownership is
 * path-prefix containment, so nested roots are both owners of a file in the inner one.
 */
export function categoryOwnsPath(category, relativePath) {
  return relativePath === category.root || relativePath.startsWith(`${category.root}/`);
}

/** The categories whose root actually contains `relativePath` -- the only ones it may be
 * classified against. */
export function categoriesForPath(relativePath) {
  return FORBIDDEN_CATEGORIES.filter((category) => categoryOwnsPath(category, relativePath));
}

/**
 * Classify one file's text. When `relativePath` is supplied the file is tested only against the
 * categories that OWN it (see categoryOwnsPath); scanTree always supplies it. Omitting it falls
 * back to testing every category, which is the fail-CLOSED direction -- an unowned caller gets
 * more findings, never fewer -- and is what the pure signature-matching unit tests use.
 */
export function classifyFile(text, relativePath) {
  const specifiers = extractImportSpecifiers(text);
  const applicable =
    relativePath === undefined ? FORBIDDEN_CATEGORIES : categoriesForPath(relativePath);
  const categories = new Set();
  for (const category of applicable) {
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

/**
 * Scan the live-runtime roots and return { categoryKey => Set<relativePath> }.
 *
 * Each file is classified ONLY against the categories whose root contains it, so adding a root
 * widens coverage of that root alone and never leaks its categories onto the other roots (nor
 * theirs onto it). Files are deduplicated by relative path so overlapping or repeated roots
 * cannot double-visit one file.
 */
export function scanTree(absoluteRoot = REPO_ROOT) {
  const results = new Map(FORBIDDEN_CATEGORIES.map((category) => [category.key, new Set()]));
  const scanRoots = new Set(FORBIDDEN_CATEGORIES.map((category) => category.root));
  const visited = new Set();
  for (const scanRoot of scanRoots) {
    for (const file of walk(join(absoluteRoot, scanRoot))) {
      const relativePath = relative(absoluteRoot, file).split(sep).join("/");
      if (visited.has(relativePath)) continue;
      visited.add(relativePath);
      let text;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      for (const key of classifyFile(text, relativePath)) {
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
