// Receiving Location Authority -- I-LA5: offline unit tests for the concrete resolveLocationActive resolver
// (functions/src/inventoryReceiving/receivingLocationResolver.ts). PURE: a fake db/txn returns snapshots;
// no Firebase app, no emulator. Prerequisite: npm run build.
import assert from "node:assert/strict";
import { Timestamp } from "firebase-admin/firestore";
import { makeResolveWarehouseLocationActive } from "../lib/inventoryReceiving/receivingLocationResolver.js";

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`  ok - ${name}`); }
  catch (err) { failed += 1; console.log(`  FAIL - ${name}: ${err && err.message}`); }
}
const TS = Timestamp.fromMillis(1_700_000_000_000);
function governed(id, over = {}) {
  return { id, name: "N", location: "L", status: "ACTIVE", version: 1, updatedAt: TS, updatedBy: "u", provenance: "NATIVE", createdAt: TS, createdBy: "u", ...over };
}
// Fake db + txn: txn.get(ref) resolves against `map` keyed by the doc id embedded in the ref.
function harness(map) {
  const reads = [];
  const db = { collection: () => ({ doc: (id) => ({ __id: id }) }) };
  const txn = { async get(ref) { reads.push(ref.__id); const has = map.has(ref.__id); return { exists: has, data: () => map.get(ref.__id) }; } };
  return { resolve: makeResolveWarehouseLocationActive(db), txn, reads };
}
const loc = (locationId, type = "WAREHOUSE") => ({ type, locationId });

await check("governed ACTIVE WAREHOUSE -> true (read through the txn)", async () => {
  const h = harness(new Map([["wh-1", governed("wh-1")]]));
  assert.equal(await h.resolve(h.txn, loc("wh-1")), true);
  assert.deepEqual(h.reads, ["wh-1"]); // read occurred through the injected txn
});

await check("INACTIVE -> false", async () => {
  const h = harness(new Map([["wh-1", governed("wh-1", { status: "INACTIVE" })]]));
  assert.equal(await h.resolve(h.txn, loc("wh-1")), false);
});

await check("non-WAREHOUSE type -> false (no read)", async () => {
  const h = harness(new Map([["wh-1", governed("wh-1")]]));
  for (const t of ["BIN", "MOBILE", "VENDOR", "CUSTOMER", "VIRTUAL", "warehouse", ""]) {
    assert.equal(await h.resolve(h.txn, loc("wh-1", t)), false);
  }
  assert.deepEqual(h.reads, []); // fails closed before any read
});

await check("blank/invalid locationId or non-object location -> false", async () => {
  const h = harness(new Map([["", governed("")]]));
  assert.equal(await h.resolve(h.txn, loc("")), false);
  assert.equal(await h.resolve(h.txn, loc("   ")), false);
  assert.equal(await h.resolve(h.txn, { type: "WAREHOUSE", locationId: 7 }), false);
  assert.equal(await h.resolve(h.txn, null), false);
});

await check("missing warehouse -> false", async () => {
  const h = harness(new Map());
  assert.equal(await h.resolve(h.txn, loc("nope")), false);
});

await check("stored/document id mismatch -> false", async () => {
  const h = harness(new Map([["doc-1", governed("OTHER")]]));
  assert.equal(await h.resolve(h.txn, loc("doc-1")), false);
});

await check("ACTIVE but missing version / updated metadata / provenance -> false", async () => {
  for (const drop of ["version", "updatedAt", "updatedBy", "provenance"]) {
    const rec = governed("wh-1"); delete rec[drop];
    const h = harness(new Map([["wh-1", rec]]));
    assert.equal(await h.resolve(h.txn, loc("wh-1")), false, `expected false when ${drop} missing`);
  }
});

await check("lingering active -> false", async () => {
  const h = harness(new Map([["wh-1", { ...governed("wh-1"), active: true }]]));
  assert.equal(await h.resolve(h.txn, loc("wh-1")), false);
});

await check("malformed / unknown-status records -> false", async () => {
  const h1 = harness(new Map([["wh-1", null]]));
  assert.equal(await h1.resolve(h1.txn, loc("wh-1")), false);
  const h2 = harness(new Map([["wh-1", governed("wh-1", { status: "PENDING" })]]));
  assert.equal(await h2.resolve(h2.txn, loc("wh-1")), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
