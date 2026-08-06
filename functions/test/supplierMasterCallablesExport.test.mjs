// Supplier Master: compiled-entry export test. Imports the compiled lib/index.js and asserts the four
// Supplier callables are exported under their EXACT frozen public names (the names Firebase deploys), and
// that the suffixed implementation consts are NOT exposed as additional callable surfaces. Prerequisite:
// npm run build. Offline (no emulator).
import assert from "node:assert/strict";
import * as indexMod from "../lib/index.js";

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  ok - ${name}`); }
  catch (err) { failed += 1; console.log(`  FAIL - ${name}: ${err && err.message}`); }
}

const PUBLIC = ["createSupplier", "updateSupplier", "activateSupplier", "deactivateSupplier"];

check("exact public callable names are exported from the entry point", () => {
  for (const n of PUBLIC) assert.equal(typeof indexMod[n], "function", `${n} must be exported`);
});

check("suffixed implementation names are NOT exposed as additional callable surfaces", () => {
  for (const n of PUBLIC) assert.equal(indexMod[`${n}Callable`], undefined, `${n}Callable must not be exported`);
  const leaked = Object.keys(indexMod).filter((k) => /^(createSupplier|updateSupplier|activateSupplier|deactivateSupplier).*Callable$/.test(k));
  assert.deepEqual(leaked, [], `unexpected suffixed exports: ${leaked.join(", ")}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
