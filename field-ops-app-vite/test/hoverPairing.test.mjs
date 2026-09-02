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
