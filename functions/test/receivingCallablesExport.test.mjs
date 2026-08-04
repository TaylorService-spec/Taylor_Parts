// Receiving Phase-2 E1: compiled-entry export test. Imports the compiled lib/index.js and asserts the two
// callables are exported under their EXACT frozen public names (the names Firebase deploys), and that the
// suffixed implementation consts are NOT exposed as additional callable surfaces. Prerequisite: npm run build.
import assert from "node:assert/strict";
import * as indexMod from "../lib/index.js";

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  ok - ${name}`); }
  catch (err) { failed += 1; console.log(`  FAIL - ${name}: ${err && err.message}`); }
}

check("exact public callable names are exported from the entry point", () => {
  assert.equal(typeof indexMod.receiveInventoryStock, "function", "receiveInventoryStock must be exported");
  assert.equal(typeof indexMod.listReceivingLocationOptions, "function", "listReceivingLocationOptions must be exported");
});

check("suffixed implementation names are NOT exposed as additional callable surfaces", () => {
  assert.equal(indexMod.receiveInventoryStockCallable, undefined);
  assert.equal(indexMod.listReceivingLocationOptionsCallable, undefined);
  // and no stray *Callable-suffixed receiving export leaked
  const leaked = Object.keys(indexMod).filter((k) => /^(receiveInventoryStock|listReceivingLocationOptions).*Callable$/.test(k));
  assert.deepEqual(leaked, [], `unexpected suffixed exports: ${leaked.join(", ")}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
