// ADMIN-UI-003 safeguard (Owner approval 2026-10-09): Administration styling is ISOLATED. Every rule in the
// Administration block of index.css is scoped under `.fo-admin`, and only the /administration route renders that
// wrapper -- never the application shell or another workspace.
// Run: node --test test/adminUiScope.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const MARKER = "ADMINISTRATION SCOPE (ADMIN-UI-001..008";

function selectorsOf(block) {
  const out = [];
  const body = block.replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(body))) {
    const head = m[1].trim();
    if (!head || head.startsWith("@")) continue;
    for (const sel of head.replace(/^@media[^{]*/, "").split(",")) out.push(sel.trim());
  }
  return out;
}

test("every selector in the Administration block is scoped under .fo-admin", () => {
  const start = css.indexOf(MARKER);
  assert.ok(start > 0, "the Administration scope block must exist");
  // From the block's opening comment, so the comment is stripped whole rather than read as a selector.
  const selectors = selectorsOf(css.slice(css.lastIndexOf("/*", start)).replace(/@media[^{]*\{/g, ""));
  assert.ok(selectors.length > 5, "the block declares Administration rules");
  const unscoped = selectors.filter((s) => !s.startsWith(".fo-admin "));
  assert.deepEqual(unscoped, [], "an Administration rule escaped the .fo-admin scope");
});

test("only the administration domain route renders the .fo-admin layout element", () => {
  assert.match(app, /element=\{domain\.key === "administration" \? <AdministrationScope \/> : undefined\}/);
  assert.equal((app.match(/<AdministrationScope \/>/g) ?? []).length, 1, "the scope element is used exactly once");
  const scope = readFileSync(new URL("../src/modules/administration/AdministrationScope.jsx", import.meta.url), "utf8");
  assert.match(scope, /<div className="fo-admin">\s*<Outlet \/>\s*<\/div>/);
});
