// ADMIN-UI-003 safeguard (Owner approval 2026-10-09): Administration styling is ISOLATED. Every rule between the
// Administration block's start and END markers in index.css is scoped under `.fo-admin` as a DESCENDANT (a sibling
// combinator would reach outside it), and only the /administration route renders that wrapper -- never the
// application shell or another workspace.
// Run: node --test test/adminUiScope.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const START = "ADMINISTRATION SCOPE (ADMIN-UI-001..008";
const END = "END ADMINISTRATION SCOPE";

/** The Administration block, from its opening comment to its END marker, with comments and @media headers removed. */
export function administrationBlock(source) {
  const start = source.indexOf(START);
  const end = source.indexOf(END);
  if (start < 0 || end < start) return null;
  return source.slice(source.lastIndexOf("/*", start), source.lastIndexOf("/*", end))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/@media[^{]*\{/g, "");
}

/** Every selector of every rule in a block (comma lists split; :is()/:where() are not used in this block). */
export function selectorsOf(block) {
  const out = [];
  for (const m of block.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    for (const sel of m[1].split(",")) if (sel.trim()) out.push(sel.trim());
  }
  return out;
}

const escapes = (sel) => !/^\.fo-admin\s+[^\s~+>]/.test(sel) || /[:(]\s*(is|where)\(/.test(sel);

test("every selector in the Administration block is a descendant of .fo-admin", () => {
  const block = administrationBlock(css);
  assert.ok(block, "the Administration scope block and its END marker must exist");
  const selectors = selectorsOf(block);
  assert.ok(selectors.length > 5, "the block declares Administration rules");
  assert.deepEqual(selectors.filter(escapes), [], "an Administration rule escaped the .fo-admin scope");
});

test("the guard refuses an unscoped rule, a sibling combinator and a bare scope class", () => {
  for (const bad of [".fo-panel { color: red; }", ".fo-admin ~ .fo-panel { color: red; }", ".fo-admin + .x { color: red; }", ".fo-admin { color: red; }"]) {
    const probe = css.replace(`/* ${END}`, `${bad}\n/* ${END}`);
    assert.ok(selectorsOf(administrationBlock(probe)).some(escapes), `the guard missed: ${bad}`);
  }
});

test("only the administration domain route renders the .fo-admin layout element", () => {
  assert.match(app, /element=\{domain\.key === "administration" \? <AdministrationScope \/> : undefined\}/);
  assert.equal((app.match(/<AdministrationScope \/>/g) ?? []).length, 1, "the scope element is used exactly once");
  const scope = readFileSync(new URL("../src/modules/administration/AdministrationScope.jsx", import.meta.url), "utf8");
  assert.match(scope, /<div className="fo-admin">\s*<Outlet \/>\s*<\/div>/);
});
