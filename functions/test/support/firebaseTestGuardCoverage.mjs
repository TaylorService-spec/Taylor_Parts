// STATIC COVERAGE RULE for the Firebase test-safety guard (./firebaseTestGuard.cjs).
//
// "Which functions test files load a Google/Firebase SDK, and does each one load the guard FIRST?"
// One implementation, used by test/firebaseTestGuardCoverage.test.mjs, so the rule a new test is
// judged by is the rule that is written down here.
//
// WHAT COUNTS AS LOADING THE SDK: an import/require of `firebase-admin` (any subpath), any
// `@google-cloud/*` package, or the compiled entry `lib/index.js` (which calls initializeApp() at
// import time). Static `import ... from`, bare `import "x"`, `await import("x")` and `require("x")`
// all count. Comment lines are ignored, and so are the shapes the repository's static fences use to
// MENTION the SDK (a regex source `from\s+["']...`, a quoted import line, an escaped or mismatched
// quote): every pattern below needs the quote to open immediately after `from` / `import(` /
// `require(`, preceded by nothing that makes it part of a word or string. It is a heuristic, not a
// parser -- and it errs toward over-counting, which only means a file must carry the guard.
//
// WHAT COUNTS AS GUARDED: the FIRST module-loading statement in the file is the guard entry (the
// emulator or the offline one). ESM evaluates static imports in source order and CommonJS executes
// top to bottom, so "first" is exactly "before any SDK module is evaluated".

export const GUARD_ENTRIES = Object.freeze(["firebaseEmulatorGuard.cjs", "firebaseOfflineGuard.cjs"]);

const SDK_SPEC = String.raw`(?:firebase-admin(?:/[\w./-]+)?|@google-cloud/[\w.-]+|(?:\.\./)+lib/index\.js)`;

const SDK_PATTERNS = [
  // import x from "spec" / import { a, b } from "spec" (multi-line) / import * as m from "spec"
  new RegExp(String.raw`^import\b[^;'"\`]*?\bfrom\s*(["'])(${SDK_SPEC})\1`, "gm"),
  // import "spec"
  new RegExp(String.raw`^import\s*(["'])(${SDK_SPEC})\1`, "gm"),
  // await import("spec") / import("spec")
  new RegExp(String.raw`(?<![\w$.'"\`\\])import\(\s*(["'])(${SDK_SPEC})\1\s*\)`, "g"),
  // require("spec")
  new RegExp(String.raw`(?<![\w$.'"\`\\])require\(\s*(["'])(${SDK_SPEC})\1\s*\)`, "g"),
];

/** Lines that are comments cannot load anything. Blanked (not removed) so offsets stay stable. */
function blankLineComments(source) {
  return source.split("\n").map((line) => (/^\s*(\/\/|\*|\/\*)/.test(line) ? "" : line)).join("\n");
}

/** Every SDK specifier this source loads (deduplicated, in order of first appearance). */
export function sdkImportsOf(source) {
  const text = blankLineComments(source);
  const found = [];
  for (const pattern of SDK_PATTERNS) {
    for (const m of text.matchAll(pattern)) if (!found.includes(m[2])) found.push(m[2]);
  }
  return found;
}

/**
 * The specifier of the first module-loading statement in the file (static import, bare import,
 * require, or top-level dynamic import), or null when it loads nothing.
 */
export function firstLoadedSpecifierOf(source) {
  const text = blankLineComments(source);
  const any = [
    /^import\b[^;'"`]*?\bfrom\s*(["'])([^"']+)\1/gm,
    /^import\s*(["'])([^"']+)\1/gm,
    /(?<![\w$.'"`\\])require\(\s*(["'])([^"']+)\1\s*\)/g,
    /(?<![\w$.'"`\\])import\(\s*(["'])([^"']+)\1\s*\)/g,
  ];
  let first = null;
  for (const pattern of any) {
    for (const m of text.matchAll(pattern)) {
      if (first === null || m.index < first.index) first = { index: m.index, spec: m[2] };
      break;
    }
  }
  return first ? first.spec : null;
}

/** Which guard entry the file loads first, or null. */
export function firstGuardOf(source) {
  const spec = firstLoadedSpecifierOf(source);
  if (spec === null) return null;
  return GUARD_ENTRIES.find((entry) => spec.endsWith(`/support/${entry}`) || spec === `./${entry}`) ?? null;
}
