// INV-CONVERGENCE-E Stage A completion -- readOnce reader-outcome mapping tests.
// Offline; the fetch fn is injected (no Firebase/network). Proves fail-closed handling
// of malformed reads and exactly-one call per read.
import assert from "node:assert/strict";
import { readOnce } from "../src/domain/partsShadowParityReadOnce.js";

let passed = 0;
function check(name, fn) { return Promise.resolve(fn()).then(() => { passed += 1; console.log(`  ok - ${name}`); }); }
console.log("partsShadowParityReadOnce.test.mjs");

await check("empty array [] is a VALID successful empty collection", async () => {
  let calls = 0;
  const r = await readOnce(async () => { calls += 1; return []; });
  assert.deepEqual(r, { ok: true, rows: [] });
  assert.equal(calls, 1);
});
await check("array rows -> { ok:true, rows } and the fetch is called exactly once", async () => {
  let calls = 0;
  const rows = [{ id: "a" }, { id: "b" }];
  const r = await readOnce(async () => { calls += 1; return rows; });
  assert.deepEqual(r, { ok: true, rows });
  assert.equal(calls, 1);
});
await check("non-array success (null/undefined/object/string/number) -> incomplete-input (fail closed)", async () => {
  for (const bad of [null, undefined, {}, "rows", 42, true]) {
    const r = await readOnce(async () => bad);
    assert.deepEqual(r, { ok: false, code: "incomplete-input" }, `value ${JSON.stringify(bad)}`);
  }
});
await check("permission-denied thrown -> { ok:false, code:'permission-denied' }", async () => {
  const r = await readOnce(async () => { const e = new Error("denied"); e.code = "permission-denied"; throw e; });
  assert.deepEqual(r, { ok: false, code: "permission-denied" });
});
await check("any other exception -> { ok:false, code:'unavailable' }", async () => {
  assert.deepEqual(await readOnce(async () => { throw new Error("network"); }), { ok: false, code: "unavailable" });
  const e = new Error("x"); e.code = "not-found";
  assert.deepEqual(await readOnce(async () => { throw e; }), { ok: false, code: "unavailable" });
});

console.log(`\n${passed} passed`);
