// Receiving Location Authority -- I-LA3: offline unit tests for the read-only warehouse-governance verifier
// (functions/src/warehouseGovernance/warehouseGovernanceVerifier.ts). PURE: no Firebase, no emulator.
import assert from "node:assert/strict";
import { Timestamp } from "firebase-admin/firestore";
import { verifyWarehouseGovernance } from "../lib/warehouseGovernance/warehouseGovernanceVerifier.js";

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  ok - ${name}`); }
  catch (err) { failed += 1; console.log(`  FAIL - ${name}: ${err && err.message}`); }
}
const TS = Timestamp.fromMillis(1_700_000_000_000);
function governed(id, over = {}) {
  return { id, name: "N", location: "L", status: "ACTIVE", version: 1, updatedAt: TS, updatedBy: "u", provenance: "NATIVE", createdAt: TS, createdBy: "u", ...over };
}

check("all-governed set -> pass true, every count zero except governed", () => {
  const r = verifyWarehouseGovernance([
    { warehouseId: "a", data: governed("a") },
    { warehouseId: "b", data: governed("b", { status: "INACTIVE" }) },
  ]);
  assert.equal(r.pass, true);
  assert.equal(r.total, 2);
  assert.equal(r.counts.governed, 2);
  assert.deepEqual([r.counts.legacy, r.counts.ambiguous, r.counts.malformed, r.counts.activePresent, r.counts.identityMismatch], [0, 0, 0, 0, 0]);
});

check("legacy / ambiguous / malformed categorized; pass false", () => {
  const r = verifyWarehouseGovernance([
    { warehouseId: "g", data: governed("g") },
    { warehouseId: "l", data: { id: "l", name: "N", location: "L" } },                          // legacy (derive)
    { warehouseId: "am", data: { id: "am", name: "N", location: "L", status: "PENDING" } },      // ambiguous (malformed status)
    { warehouseId: "mal", data: null },                                                          // malformed
  ]);
  assert.equal(r.pass, false);
  assert.equal(r.counts.governed, 1);
  assert.equal(r.counts.legacy, 1);
  assert.equal(r.counts.ambiguous, 1);
  assert.equal(r.counts.malformed, 1);
});

check("lingering active is flagged and fails the gate", () => {
  const r = verifyWarehouseGovernance([{ warehouseId: "a", data: { ...governed("a"), active: true } }]);
  assert.equal(r.counts.activePresent, 1);
  assert.equal(r.pass, false); // a record with active is never governed
});

check("identity mismatch (stored id != doc id) is flagged and fails the gate", () => {
  const r = verifyWarehouseGovernance([{ warehouseId: "doc-1", data: governed("OTHER") }]);
  assert.equal(r.counts.identityMismatch, 1);
  assert.equal(r.counts.governed, 0); // validator binds id to doc id -> not governed
  assert.equal(r.pass, false);
});

check("output is sanitized: fingerprints are hashes, no raw field values", () => {
  const r = verifyWarehouseGovernance([{ warehouseId: "am", data: { id: "am", name: "SECRET-NAME", location: "SECRET-LOC", status: "PENDING" } }]);
  const text = JSON.stringify(r);
  assert.ok(!text.includes("SECRET-NAME") && !text.includes("SECRET-LOC"));
  assert.match(r.fingerprints.ambiguous, /^[0-9a-f]{64}$/);
});

check("empty set -> pass true (vacuously), all counts zero", () => {
  const r = verifyWarehouseGovernance([]);
  assert.equal(r.pass, true);
  assert.equal(r.total, 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
