// INV-CONVERGENCE-E Stage A completion -- readOnce reader-outcome mapping tests.
// Offline; the fetch fn is injected (no Firebase/network). Proves the live-reader
// mapping and exactly-one call per read.
import assert from "node:assert/strict";
import { readOnce } from "../src/domain/partsShadowParityReadOnce.js";

let passed = 0;
function check(name, fn) { return Promise.resolve(fn()).then(() => { passed += 1; console.log(`  ok - ${name}`); }); }
console.log("partsShadowParityReadOnce.test.mjs");

await check("success: rows -> { ok:true, rows } and the fetch is called exactly once", async () => {
  let calls = 0;
  const rows = [{ id: "a" }, { id: "b" }];
  const r = await readOnce(async () => { calls += 1; return rows; });
  assert.deepEqual(r, { ok: true, rows });
  assert.equal(calls, 1);
});
await check("permission-denied thrown -> { ok:false, code:'permission-denied' }", async () => {
  const r = await readOnce(async () => { const e = new Error("denied"); e.code = "permission-denied"; throw e; });
  assert.deepEqual(r, { ok: false, code: "permission-denied" });
});
await check("any other error -> { ok:false, code:'unavailable' }", async () => {
  const r = await readOnce(async () => { throw new Error("network"); });
  assert.deepEqual(r, { ok: false, code: "unavailable" });
  const r2 = await readOnce(async () => { const e = new Error("x"); e.code = "not-found"; throw e; });
  assert.deepEqual(r2, { ok: false, code: "unavailable" });
});
await check("non-array success is normalized to an empty rows list", async () => {
  const r = await readOnce(async () => undefined);
  assert.deepEqual(r, { ok: true, rows: [] });
});

console.log(`\n${passed} passed`);
