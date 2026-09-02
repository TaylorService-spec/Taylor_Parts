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

/**
 * Every `selector { … }` rule in the sheet, as `{ sel, body }`.
 *
 * ANCHORING THIS ON `(^|\})` WAS A BUG, and it is the reason the Owner's hover defect could reach
 * production. A rule's match ended by CONSUMING its own closing `}`, so the next rule had no `}`
 * left in front of it and could not match; the engine then skipped ahead to the following one.
 * The walker therefore read every OTHER rule, silently, and `.fo-filter-btn:hover` happened to
 * land in the half it never looked at. There is no need for the anchor: a selector cannot contain
 * a brace, so `[^{}]+` already starts wherever the previous rule stopped.
 */
function rules(css) {
  const out = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) out.push({ sel: m[1].trim(), body: m[2] });
  return out;
}

/** Element-level rules that set a colour every instance inherits (`button { color: ... }`). */
function elementsWithInheritedColor(css) {
  const found = new Map();
  for (const { sel, body } of rules(css)) {
    const color = body.match(/(^|[;{\s])color\s*:\s*([^;]+)/);
    if (!color) continue;
    for (const part of sel.split(",").map((s) => s.trim())) {
      if (/^[a-z][a-z0-9]*$/i.test(part)) found.set(part.toLowerCase(), color[2].trim());
    }
  }
  return found;
}

/**
 * Classes whose rule re-grounds the background but declares no colour, in a given STATE.
 *
 * `state: null` inspects base rules; `state: ":hover"` inspects hover rules.
 *
 * HOVER USED TO BE EXCLUDED HERE, on the reasoning that a state rule "layers a background onto a
 * base rule that has already settled the colour question". THAT REASONING WAS WRONG, and the Owner
 * found the proof on the Financials filter rail: Consolidated / Taylor / Ventana turned
 * white-on-near-white the moment the pointer touched them.
 *
 * The base rule settles nothing during hover, because index.css colours the bare element in that
 * state too -- `button:hover { background: <brand green>; color: #FFFFFF }`. That selector is
 * specificity 0-1-1, which OUTRANKS a single-class base rule at 0-1-0. So when
 * `.fo-filter-btn:hover` (0-2-0) re-grounded the background to a light surface and said nothing
 * about colour, the winning colour was the white from `button:hover`, not the dark text from
 * `.fo-filter-btn`.
 *
 * The invariant is the one this file always asserted, now applied per state: if you change the
 * ground, state the figure -- in the rule that changes it.
 */
function classesThatRegroundWithoutColor(css, state = null) {
  const risky = new Set();
  const STATES = /:hover|:focus|:active|:disabled|:focus-visible/;
  for (const { sel, body } of rules(css)) {
    if (state === null ? STATES.test(sel) : !sel.includes(state)) continue;
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

/**
 * Every `<button …>` opening tag, with the class names written on it.
 *
 * THIS USED TO READ ONLY THE FIRST STRING LITERAL of a `className={...}` expression, because the
 * pattern that scanned the expression could not cross a `}` -- and the first `}` in a real
 * conditional className is usually the one closing a `${...}` interpolation, long before the
 * interesting branch. On FilterBar's button that meant the guard saw `ns-view` and never saw
 * `fo-filter-btn` at all, so the Owner's hover defect could not have been caught even once the
 * hover state was inspected. A guard that silently reads a fraction of its input is worse than no
 * guard, so the expression is now scanned with balanced braces and EVERY literal is collected.
 */
function classLiteralsIn(expr) {
  const out = [];
  // Static text of "…", '…' and `…`; the ${…} parts of a template are expressions, not classes.
  for (const m of expr.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)) {
    const raw = m[1] ?? m[2] ?? m[3] ?? "";
    for (const piece of raw.split(/\$\{[^}]*\}?/)) out.push(piece);
  }
  return out;
}

function buttonsWithClasses(text) {
  const found = [];
  for (const m of text.matchAll(/<button\b/g)) {
    // Walk to the end of the opening tag, respecting nested braces so `onClick={() => …}` and
    // friends do not terminate it early.
    let i = m.index + "<button".length, depth = 0, tag = "";
    for (; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      else if (ch === ">" && depth === 0) break;
      tag += ch;
    }
    const classes = new Set();
    for (const cm of tag.matchAll(/className=/g)) {
      let j = cm.index + "className=".length, d = 0, expr = "";
      for (; j < tag.length; j += 1) {
        const ch = tag[j];
        if (ch === "{") d += 1;
        else if (ch === "}") { d -= 1; if (d === 0) { expr += ch; break; } }
        else if (d === 0 && /\s/.test(ch) && expr && !expr.startsWith("{")) break;
        expr += ch;
      }
      for (const literal of classLiteralsIn(expr)) {
        for (const c of literal.split(/\s+/)) if (c && /^[A-Za-z][A-Za-z0-9_-]*$/.test(c)) classes.add(c);
      }
    }
    if (classes.size) found.push({ line: text.slice(0, m.index).split("\n").length, classes });
  }
  return found;
}

/** Element-level rules for one state, e.g. `button:hover { color: ... }`. */
function elementsWithStateColor(css, state) {
  const found = new Map();
  // `m` matters: `button:hover` is preceded by a comment, not by a closing brace.
  const re = new RegExp(`(^|\\})\\s*([a-z][a-z0-9]*)${state}\\s*\\{([^}]*)\\}`, "gim");
  for (const m of css.matchAll(re)) {
    const color = m[3].match(/(^|[;{\s])color\s*:\s*([^;]+)/);
    if (color) found.set(m[2].toLowerCase(), color[2].trim());
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

test("the premise holds in the hover state too: `button:hover` imposes its own colour", () => {
  // The guard below only means something while this is true. If the bare hover rule stops setting
  // a colour, re-derive the guard rather than leaving it passing over an expired premise.
  assert.ok(
    elementsWithStateColor(css, ":hover").has("button"),
    "index.css no longer sets `color` on `button:hover` -- re-derive this guard",
  );
});

test("no button wears a class whose HOVER re-grounds the background without restating colour", () => {
  // THE OWNER'S DEFECT, 2026-09-02. `.fo-filter-btn:hover` set a light background and no colour, so
  // the Financials company filter rendered white on near-white under the pointer. The base rule's
  // dark text lost to `button:hover`'s white at higher specificity. Same invariant, hover state.
  const risky = classesThatRegroundWithoutColor(css, ":hover");
  const offenders = [];

  for (const file of jsxFiles(srcDir)) {
    const text = readFileSync(file, "utf8");
    for (const btn of buttonsWithClasses(text)) {
      for (const c of btn.classes) {
        if (risky.has(c)) offenders.push(`${path.relative(srcDir, file)}:${btn.line}  .${c}:hover`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "These buttons re-ground `background` on hover but inherit `color` from `button:hover`, so their "
      + "label is coloured for a background they no longer have. Declare `color` in the same hover "
      + "rule:\n  " + offenders.join("\n  "),
  );
});
