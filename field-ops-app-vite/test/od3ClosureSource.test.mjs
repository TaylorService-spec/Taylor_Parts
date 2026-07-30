// OD-3 closure -- structural source assertions (offline). Operations.jsx no longer references
// the static PARTS_CATALOG (the descriptive count was removed), and searchProviders.js is a pure
// provider over the GOVERNED CANONICAL `context.parts` (no static-catalog import, no stale
// "context.parts is PARTS_CATALOG (static)" comment). These close the OD-3 name-candidate set:
// the only remaining static-catalog consumers are the two warehouseQty stock-authority readers.
import assert from "node:assert/strict";
import fs from "node:fs";

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }
console.log("od3ClosureSource.test.mjs");

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");
const OPERATIONS = read("../src/modules/operations/Operations.jsx");
const SEARCH_PROVIDERS = read("../src/shared/search/searchProviders.js");

check("Operations.jsx no longer imports or references the static PARTS_CATALOG", () => {
  assert.equal(/PARTS_CATALOG/.test(OPERATIONS), false);
  assert.equal(/from ["'][^"']*data\/partsCatalog["']/.test(OPERATIONS), false);
});
check("Operations.jsx keeps the descriptive static-baseline / not-live-stock meaning (no number)", () => {
  const flat = OPERATIONS.replace(/\s+/g, " "); // copy wraps across lines
  assert.equal(/static baseline/.test(flat), true);
  assert.equal(/not live stock/.test(flat), true);
  // no "(<n> parts)" static count rendered anymore
  assert.equal(/\(\{PARTS_CATALOG\.length\} parts\)/.test(OPERATIONS), false);
  assert.equal(/\(\d+ parts\)/.test(flat), false);
});
check("searchProviders.js imports no parts catalog (pure over context.parts)", () => {
  assert.equal(/import[^\n]*partsCatalog/.test(SEARCH_PROVIDERS), false);
  assert.equal(/getCatalogItem/.test(SEARCH_PROVIDERS), false);
});
check("searchProviders.js stale 'context.parts is PARTS_CATALOG (static)' comment is corrected to the governed canonical composition", () => {
  assert.equal(/`context\.parts` is PARTS_CATALOG \(data\/partsCatalog\.ts, a\s*\/\/\s*static in-memory array/.test(SEARCH_PROVIDERS.replace(/\r/g, "")), false);
  assert.equal(/is PARTS_CATALOG \(data\/partsCatalog/.test(SEARCH_PROVIDERS), false);
  assert.equal(/GOVERNED CANONICAL/.test(SEARCH_PROVIDERS), true);
  assert.equal(/canonical-first/.test(SEARCH_PROVIDERS), true);
});

console.log(`\n${passed} passed, 0 failed`);
