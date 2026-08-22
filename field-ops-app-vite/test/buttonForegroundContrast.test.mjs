// A BUTTON THAT RE-GROUNDS ITS BACKGROUND MUST RESTATE ITS FOREGROUND.
// Run: node --test test/buttonForegroundContrast.test.mjs
//
// ============================ THE FAILURE THIS EXISTS TO STOP ============================
//
// `index.css` styles the bare element: `button { background: <brand green>; color: white; }`.
// Every button in the product inherits that pairing, and the pairing is only safe together.
//
// A class that overrides ONLY the background silently keeps the white text. On the Customers
// search dropdown that produced a genuinely invisible screen: `.fo-global-search-result` set
// `background: transparent` over a white elevated panel, so every customer NAME rendered white on
// white. The status beside each name stayed readable -- `.fo-muted` sets its own colour -- so the
// dropdown looked like rows of "— Active" with no names, rather than looking broken. The Owner
// found it by typing into the box. Nothing in CI had an opinion.
//
// ============================ WHY THE EXISTING GUARDS MISSED IT ============================
//
// `cssClassCoverage` asks whether a class is DEFINED, not whether its declarations are coherent.
// Every class here was defined and styled. The defect was a missing property, and an absent
// declaration is invisible to a guard that only checks for presence.
//
// ============================ WHAT THIS CHECKS ============================
//
// For every `<button>` in the JSX, if any class it wears re-grounds `background` and that same
// rule does not also declare `color`, the button is inheriting a foreground chosen for a
// background it no longer has. That is reported as a defect.
//
// DELIBERATELY NOT A CONTRAST CALCULATOR. Resolving the real cascade -- variables, media queries,
// specificity, inherited surfaces -- needs a browser, and a static approximation would produce
// confident wrong answers about colours it cannot actually resolve. This asserts the structural
// invariant instead, which is cheap, exact, and has no false negatives of the kind that matter:
// if you change the ground, state the figure.
//
// THERE IS NO ALLOWLIST, ON PURPOSE. The one button this flagged that was not visibly broken --
// a nav toggle whose bars are separately-coloured spans -- was fixed by declaring the colour it
// already relied on, rather than by being exempted. An exemption list is how a guard becomes
// advisory; a one-line declaration costs less than the argument about whether it is needed.
import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(here, "../src");
const cssPath = path.join(srcDir, "index.css");

/** Element-level rules that set a colour every instance inherits (`button { color: ... }`). */
function elementsWithInheritedColor(css) {
  const found = new Map();
  for (const m of css.matchAll(/(^|\})\s*([a-z][a-z0-9]*(?:\s*,\s*[a-z][a-z0-9]*)*)\s*\{([^}]*)\}/gi)) {
    const body = m[3];
    const color = body.match(/(^|[;{\s])color\s*:\s*([^;]+)/);
    if (!color) continue;
    for (const sel of m[2].split(",").map((s) => s.trim())) {
      if (/^[a-z][a-z0-9]*$/i.test(sel)) found.set(sel.toLowerCase(), color[2].trim());
    }
  }
  return found;
}

/**
 * Classes whose rule re-grounds the background but declares no colour.
 *
 * State-scoped selectors (`:hover`, `:focus`, `:active`, `:disabled`) are excluded: they layer a
 * background onto a base rule that has already settled the colour question, so requiring it again
 * would flag correct code.
 */
function classesThatRegroundWithoutColor(css) {
  const risky = new Set();
  for (const m of css.matchAll(/(^|\})\s*([^{}]+)\{([^}]*)\}/g)) {
    const sel = m[2].trim();
    const body = m[3];
    if (/:hover|:focus|:active|:disabled|:focus-visible/.test(sel)) continue;
    if (!/(^|[;{\s])background(-color)?\s*:/.test(body)) continue;
    if (/(^|[;{\s])color\s*:/.test(body)) continue;
    for (const c of sel.matchAll(/\.([A-Za-z0-9_-]+)/g)) risky.add(c[1]);
  }
  return risky;
}

function jsxFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...jsxFiles(p));
    else if (entry.endsWith(".jsx")) out.push(p);
  }
  return out;
}

/** Every `<button …>` opening tag, with the class names written on it. */
function buttonsWithClasses(text) {
  const found = [];
  for (const m of text.matchAll(/<button\b[\s\S]{0,400}?>/g)) {
    const tag = m[0];
    const classes = new Set();
    // Plain strings, template literals, and string literals inside a `className={...}` expression
    // (conditional classes are common and are exactly where a state class hides).
    for (const cm of tag.matchAll(/className=(?:"([^"]*)"|`([^`]*)`|\{[^}]*?["`]([^"`]*)["`][^}]*\})/g)) {
      for (const c of (cm[1] || cm[2] || cm[3] || "").split(/\s+/)) if (c) classes.add(c);
    }
    if (classes.size) found.push({ line: text.slice(0, m.index).split("\n").length, classes });
  }
  return found;
}

const css = readFileSync(cssPath, "utf8");

test("the premise holds: a bare element rule really does impose an inherited colour", () => {
  // If this ever stops being true, the guard below is checking nothing and must be re-derived
  // rather than left passing. A guard whose premise has silently expired is worse than no guard.
  const inherited = elementsWithInheritedColor(css);
  assert.ok(
    inherited.has("button"),
    "index.css no longer sets `color` on the bare `button` element -- this guard's premise is gone",
  );
});

test("no button wears a class that re-grounds the background without restating colour", () => {
  const risky = classesThatRegroundWithoutColor(css);
  const offenders = [];

  for (const file of jsxFiles(srcDir)) {
    const text = readFileSync(file, "utf8");
    for (const btn of buttonsWithClasses(text)) {
      for (const c of btn.classes) {
        if (risky.has(c)) {
          offenders.push(`${path.relative(srcDir, file)}:${btn.line}  .${c}`);
        }
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "These buttons override `background` but inherit `color: white` from the bare `button` rule, "
      + "so their text is coloured for a background they no longer have. Declare `color` in each "
      + "rule:\n  " + offenders.join("\n  "),
  );
});
