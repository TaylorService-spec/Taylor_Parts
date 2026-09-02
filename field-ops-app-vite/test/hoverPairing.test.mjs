// HOVER PAIRING — a hover that moves the background must move the foreground with it.
// Run: node --test test/hoverPairing.test.mjs
//
// ════════ THE BUG THIS EXISTS TO PREVENT ════════
//
// `button:hover` sets an evergreen fill AND white text, deliberately paired (see its own comment:
// an earlier version set only the background and produced dark-on-dark). Its specificity is 0-1-1,
// so ANY single-class hover rule outranks it — and a class rule that overrides only the BACKGROUND
// leaves that white foreground stranded on whatever fill it just chose.
//
// That is not hypothetical. `.fo-filter-btn:hover` did exactly this: it reset the fill to a
// near-white surface and said nothing about colour, so on the accepted Financials palette a hovered
// company chip rendered white-on-#F2F5F3 — 1.06:1, an invisible label. The same rule was a no-op
// everywhere else, because its background and border matched the base state.
//
// These cases pin the pairing for the chip/tab family, where the fill genuinely changes.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");

/** The declaration block of the LAST rule whose selector is exactly `selector`. */
function ruleBody(selector) {
  // Split on block boundaries rather than building a regex out of the selector — a CSS selector
  // contains regex metacharacters, and escaping them was itself the first thing that broke here.
  let last = null;
  for (const chunk of css.split("}")) {
    const i = chunk.lastIndexOf("{");
    if (i === -1) continue;
    const sel = chunk.slice(0, i).split(";").pop().split("\n").pop().trim();
    if (sel === selector) last = chunk.slice(i + 1);
  }
  return last;
}

const setsBackground = (b) => /(^|[;{\s])background(-color)?\s*:/.test(b);
const setsColor = (b) => /(^|[;{\s])color\s*:/.test(b);

test("the blanket button:hover still carries its own foreground", () => {
  const body = ruleBody("button:hover");
  assert.ok(body, "button:hover must exist");
  assert.ok(setsBackground(body) && setsColor(body), "it sets the fill, so it must set the text too");
});

test("every chip/tab hover that changes the fill also changes the text", () => {
  // These are the controls whose hover genuinely inverts — a fill change without a foreground
  // change is what strands white text.
  for (const sel of [".fo-filter-btn:hover", ".ns-view:hover", ".ns-tabrail__tab:hover"]) {
    const body = ruleBody(sel);
    assert.ok(body, `${sel} must exist`);
    assert.ok(setsBackground(body), `${sel} should change the fill`);
    assert.ok(setsColor(body), `${sel} changes the fill, so it MUST carry a foreground`);
  }
});

test("the filter chip has a hover that actually does something", () => {
  // The old rule set background and border to the SAME values as its base state, so outside the
  // Financials palette the control had no hover feedback at all.
  const base = ruleBody(".fo-filter-btn");
  const hover = ruleBody(".fo-filter-btn:hover");
  assert.ok(base && hover);
  const bg = (b) => (b.match(/background\s*:\s*([^;]+)/) || [])[1]?.trim();
  assert.notEqual(bg(hover), bg(base), "a hover identical to the base state is not a hover");
});

test("the filter chip's hover pair is legible — evergreen fill with inverse text", () => {
  const body = ruleBody(".fo-filter-btn:hover");
  assert.match(body, /background:\s*var\(--color-brand-secondary\)/);
  assert.match(body, /color:\s*var\(--color-text-inverse\)/);
});

// ════════ THE MIRROR DIRECTION, WHICH THE CASES ABOVE COULD NOT SEE ════════
//
// Everything above asks: does a hover that changes the FILL also carry a foreground? The live sweep
// found the same bug running the other way. `.fin-hlp:hover` named only a colour, so `button:hover`
// at 0-1-1 lost the colour to it and KEPT its background — supplying an evergreen fill under
// near-black text at 2.27:1 on every Financials route. `.eos-auth__reveal`, `.eos-auth__secondary`
// and `.ns-info__close` had it too, at 1.81:1, on the sign-in screen an authenticated sweep can
// never reach. Owning half a pair is the bug; which half you own is a detail.
//
// This is a whole-stylesheet sweep rather than a list, because a list only ever pins the rules
// somebody already thought about. It is not regex-only: the button set is read out of the JSX, so a
// class that never lands on a <button> is never accused, and `button:hover` cannot reach it.
import { readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/** Class names that actually appear on a <button> somewhere in the app. */
function buttonClasses() {
  const found = new Set();
  const root = fileURLToPath(new URL("../src", import.meta.url));
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.jsx?$/.test(name)) {
        const src = readFileSync(p, "utf8");
        for (const tag of src.matchAll(/<button\b[\s\S]{0,400}?>/g))
          for (const lit of tag[0].matchAll(/["'`]([a-zA-Z0-9 _-]+)["'`]/g))
            for (const cls of lit[1].split(/\s+/))
              if (/^[a-z]/.test(cls) && cls.includes("-")) found.add(cls);
      }
    }
  };
  walk(root);
  return found;
}

// A DESCENDANT restating the foreground over a fill its ANCESTOR owns is the correct shape, not a
// violation: `.ns-view.is-active:hover` sets the evergreen fill and this keeps the count legible
// on it. The exception is the selector, so a new offender cannot hide behind it.
const FOREGROUND_ONLY_ALLOWED = new Set([".ns-view.is-active:hover .ns-view__count"]);

test("no button hover names a foreground and lets button:hover supply the fill", () => {
  const buttons = buttonClasses();
  assert.ok(buttons.size > 20, "the JSX scan must actually find buttons, or this test proves nothing");

  const offenders = [];
  for (const chunk of css.replace(/\/\*[\s\S]*?\*\//g, "").split("}")) {
    const i = chunk.lastIndexOf("{");
    if (i === -1) continue;
    const selector = chunk.slice(0, i).split(";").pop().trim().replace(/\s+/g, " ");
    const body = chunk.slice(i + 1);
    if (!selector.includes(":hover") || !setsColor(body) || setsBackground(body)) continue;
    for (const part of selector.split(",").map((s) => s.trim())) {
      if (!part.includes(":hover") || FOREGROUND_ONLY_ALLOWED.has(part)) continue;
      // The class the :hover actually hangs off — not one further up a descendant chain.
      const hooked = (part.match(/\.([a-zA-Z0-9_-]+)(?=[^ ]*:hover)/g) ?? []).map((c) => c.slice(1));
      if (hooked.some((c) => buttons.has(c))) offenders.push(`${part} → {${body.trim()}}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `these hover rules change a button's text and leave button:hover to choose the fill underneath it:\n  ${offenders.join("\n  ")}`,
  );
});
