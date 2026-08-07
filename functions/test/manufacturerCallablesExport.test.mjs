// Manufacturer: compiled-entry export test. Asserts the three callables are exported from lib/index.js
// under their EXACT frozen public names (Firebase deploys by export name), and that the suffixed impl
// consts are NOT exposed. Prerequisite: npm run build. Offline.
import assert from "node:assert/strict";
import * as indexMod from "../lib/index.js";

let passed = 0, failed = 0;
function check(name, fn) { try { fn(); passed += 1; console.log(`  ok - ${name}`); } catch (err) { failed += 1; console.log(`  FAIL - ${name}: ${err && err.message}`); } }

const PUBLIC = ["createManufacturer", "updateManufacturer", "changeManufacturerStatus"];
check("exact public callable names are exported from the entry point", () => {
  for (const n of PUBLIC) assert.equal(typeof indexMod[n], "function", `${n} must be exported`);
});
check("suffixed implementation names are NOT exposed", () => {
  for (const n of PUBLIC) assert.equal(indexMod[`${n}Callable`], undefined, `${n}Callable must not be exported`);
  const leaked = Object.keys(indexMod).filter((k) => /^(createManufacturer|updateManufacturer|changeManufacturerStatus).*Callable$/.test(k));
  assert.deepEqual(leaked, [], `unexpected suffixed exports: ${leaked.join(", ")}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
