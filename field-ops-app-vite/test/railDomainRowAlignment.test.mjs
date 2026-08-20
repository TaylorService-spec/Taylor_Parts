// Rail domain rows must present ONE label edge regardless of whether a domain
// expands. The two row shapes are different elements (<a> vs <button>) with
// different children, so alignment is a structural property that has already
// regressed once and is easy to regress again.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const jsx = readFileSync(new URL("../src/navigation/AppRail.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  ok - ${name}`); }
  catch (e) { console.error(`  FAIL - ${name}`); throw e; }
}

console.log("railDomainRowAlignment.test.mjs");

check("a leaf row reserves the chevron slot with a real element, never ::before", () => {
  // ::before always renders FIRST, ahead of the domain icon, so it indents the
  // whole row instead of aligning the label. That is the exact regression this
  // pins: leaf domains sat further right than their expandable siblings.
  assert.ok(jsx.includes("fo-rail__chevron-spacer"), "leaf row must render a spacer element");
  // Match a RULE, not the phrase. The CSS comment above the replacement explains
  // why ::before was removed, and a bare substring check trips on that prose --
  // a test that fails because of an accurate comment teaches people to delete
  // the comment.
  const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.equal(
    /\.fo-rail__domain-row--leaf::before\s*\{/.test(cssNoComments),
    false,
    "the ::before spacer must not come back -- it renders before the icon",
  );
});

check("the spacer sits BETWEEN the icon and the label, exactly where the chevron sits", () => {
  // Slice from the leaf class to the element that closes it. indexOf("</NavLink>")
  // alone can land BEFORE the class occurrence and yield an empty slice.
  const leafStart = jsx.indexOf("fo-rail__domain-row--leaf");
  const leaf = jsx.slice(leafStart, jsx.indexOf("</NavLink>", leafStart));
  const iconAt = leaf.indexOf("<DomainIcon");
  const spacerAt = leaf.indexOf("fo-rail__chevron-spacer");
  const labelAt = leaf.indexOf("fo-rail__domain-label");
  assert.ok(iconAt >= 0 && spacerAt >= 0 && labelAt >= 0, "leaf row is missing an element");
  assert.ok(iconAt < spacerAt, "spacer must come after the icon");
  assert.ok(spacerAt < labelAt, "spacer must come before the label");
});

check("spacer and chevron declare the same box, so the two row shapes agree", () => {
  const rule = (sel) => {
    const i = css.indexOf(sel + " {");
    assert.ok(i >= 0, `missing rule ${sel}`);
    return css.slice(i, css.indexOf("}", i));
  };
  const spacer = rule(".fo-rail__chevron-spacer");
  const chevron = rule(".fo-rail__chevron");
  for (const decl of ["width: 10px", "height: 10px", "margin-left: 2px", "box-sizing: border-box"]) {
    assert.ok(spacer.includes(decl), `spacer must declare ${decl}`);
    assert.ok(chevron.includes(decl), `chevron must declare ${decl}`);
  }
});

check("the spacer is hidden from assistive technology", () => {
  // It is pure layout. A screen reader announcing an empty element between the
  // domain icon and its name is noise.
  const leafStart = jsx.indexOf("fo-rail__domain-row--leaf");
  const leaf = jsx.slice(leafStart, jsx.indexOf("</NavLink>", leafStart));
  const at = leaf.indexOf("fo-rail__chevron-spacer");
  assert.ok(leaf.slice(at, at + 120).includes("aria-hidden"), "spacer must be aria-hidden");
});

console.log(`\n${passed} passed, 0 failed`);
