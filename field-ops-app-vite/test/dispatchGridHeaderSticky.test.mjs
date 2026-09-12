// The Dispatch column header must stay with the lanes it labels.
//
// Reported from the running sandbox board: with the technician list long enough to fill more than a
// viewport, scrolling down carried the hour header off the top of the screen. A dispatcher was then
// dragging a job onto an unlabelled grid — the one moment the board has to be unambiguous is exactly
// the moment it had stopped saying what the columns mean.
//
// This is a CSS-only property, and jsdom does not do sticky layout, so it cannot be asserted by
// rendering. It is pinned here the way this repo already pins other layout invariants it has
// regressed on (railDomainRowAlignment, buttonForegroundContrast): match the RULE in the stylesheet,
// not a phrase that a comment could satisfy.
//
// Verified in a real browser before this test was written: on the deployed composition at 1440x860
// the header's viewport y went 530.7 -> 0.0 across a 700px scroll, with zero overflow ancestors in
// the sticky containing chain.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Newlines normalized on read: index.css is not pinned to LF, so a Windows checkout serves CRLF and
// a selector list matched with "\n" between its lines silently finds nothing. (This project has
// already paid for that lesson once, in the Rules deployment verifier.)
const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  ok - ${name}`); }
  catch (e) { console.error(`  FAIL - ${name}`); throw e; }
}

console.log("dispatchGridHeaderSticky.test.mjs");

/** The declaration block for a selector, comments stripped so prose cannot satisfy a match. */
function ruleFor(selectorList) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const idx = withoutComments.indexOf(selectorList);
  assert.notEqual(idx, -1, `selector list not found: ${selectorList}`);
  const open = withoutComments.indexOf("{", idx);
  const close = withoutComments.indexOf("}", open);
  assert.ok(open !== -1 && close !== -1, "unbalanced rule");
  return withoutComments.slice(open + 1, close);
}

const HEADS = ".ns-dispatch-grid__head,\n.ns-dispatch-week__head,\n.ns-dispatch-load__head";

check("all three Dispatch column headers are sticky to the top of the scrollport", () => {
  const body = ruleFor(HEADS);
  assert.match(body, /position:\s*sticky/, "header must be position: sticky");
  assert.match(body, /top:\s*0/, "a sticky header with no `top` never sticks to anything");
});

check("the sticky header is opaque, so lane chips cannot scroll through it", () => {
  // A transparent sticky header lets work-order chips slide underneath and show through the hour
  // labels, which reads as corruption rather than as a header.
  const body = ruleFor(HEADS);
  assert.match(body, /background:\s*var\(--color-surface-page\)/,
    "header background must be the opaque page surface token");
});

check("the sticky header outranks the lane content it overlaps", () => {
  const body = ruleFor(HEADS);
  const z = /z-index:\s*(\d+)/.exec(body);
  assert.ok(z, "a sticky header that overlaps positioned chips needs an explicit z-index");
  assert.ok(Number(z[1]) >= 2, `z-index ${z[1]} is not above the lane chips`);
});

check("the day, week and load views are all covered — the defect was shape, not one view", () => {
  // All three grids have a header row over scrolling technician rows. Fixing only the one that was
  // reported would leave the same defect in the other two, which is how it comes back.
  for (const sel of [".ns-dispatch-grid__head", ".ns-dispatch-week__head", ".ns-dispatch-load__head"]) {
    assert.ok(HEADS.includes(sel), `${sel} must be in the shared sticky rule`);
  }
});

console.log(`\n${passed} passed`);
