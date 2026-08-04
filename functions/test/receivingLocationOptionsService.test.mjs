// Receiving Location Authority -- I-LA4/I-LR: offline unit tests for the trusted receiving-location option
// service (functions/src/warehouseGovernance/receivingLocationOptionsService.ts). PURE: injected fake
// authorize / candidate-read / runRead seams; no Firebase, no emulator. Prerequisite: npm run build.
import assert from "node:assert/strict";
import { Timestamp } from "firebase-admin/firestore";
import {
  listEligibleReceivingLocationOptions,
  buildOptionLabel,
  ReceivingLocationOptionsError,
} from "../lib/warehouseGovernance/receivingLocationOptionsService.js";

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`  ok - ${name}`); }
  catch (err) { failed += 1; console.log(`  FAIL - ${name}: ${err && err.message}`); }
}
const TS = Timestamp.fromMillis(1_700_000_000_000);
function governed(id, over = {}) {
  return { id, name: "N", location: "L", status: "ACTIVE", version: 1, updatedAt: TS, updatedBy: "u", provenance: "NATIVE", createdAt: TS, createdBy: "u", ...over };
}
// deps builder: authorize granted, candidates from a list, runRead passes a marker txn.
function deps(candidates, over = {}) {
  return {
    actor: { kind: "USER", id: "admin-1" },
    authorize: async () => true,
    readCandidateWarehouses: async () => candidates,
    runRead: async (fn) => fn({ marker: "txn" }),
    ...over,
  };
}
const call = (candidates, over = {}) => listEligibleReceivingLocationOptions({}, deps(candidates, over));

await check("ACTIVE governed warehouse included as sanitized DTO", async () => {
  const out = await call([{ warehouseId: "wh-1", data: governed("wh-1", { name: "Main" }) }]);
  assert.deepEqual(out, [{ value: "wh-1", label: "Main", type: "WAREHOUSE" }]);
  assert.deepEqual(Object.keys(out[0]).sort(), ["label", "type", "value"]); // exact allowlist
});

await check("INACTIVE excluded", async () => {
  const out = await call([{ warehouseId: "wh-1", data: governed("wh-1", { status: "INACTIVE" }) }]);
  assert.deepEqual(out, []);
});

await check("missing / malformed / partial §3A records excluded; only governed ACTIVE returned", async () => {
  const out = await call([
    { warehouseId: "g", data: governed("g", { name: "Good" }) },
    { warehouseId: "legacy", data: { id: "legacy", name: "N", location: "L" } },                 // legacy (no envelope)
    { warehouseId: "partial", data: { id: "partial", name: "N", location: "L", status: "ACTIVE" } }, // missing version/provenance
    { warehouseId: "mal", data: null },                                                            // malformed
    { warehouseId: "active-field", data: { ...governed("active-field"), active: true } },          // lingering active
    { warehouseId: "", data: governed("x") },                                                       // blank candidate id
  ]);
  assert.deepEqual(out, [{ value: "g", label: "Good", type: "WAREHOUSE" }]);
});

await check("document-id mismatch excluded (validator binds stored id to doc id)", async () => {
  const out = await call([{ warehouseId: "doc-1", data: governed("OTHER", { name: "X" }) }]);
  assert.deepEqual(out, []);
});

await check("legacy active field is never accepted even with status ACTIVE", async () => {
  const out = await call([{ warehouseId: "a", data: { ...governed("a"), active: false } }]);
  assert.deepEqual(out, []);
});

await check("blank-name label fallback -> warehouseId (label helper)", async () => {
  assert.equal(buildOptionLabel("  Main  ", "wh"), "Main"); // trimmed
  assert.equal(buildOptionLabel("   ", "wh-2"), "wh-2");     // whitespace -> id
  assert.equal(buildOptionLabel(undefined, "wh-3"), "wh-3"); // absent -> id
});

await check("deterministic sort by label then warehouseId; duplicate identity protection", async () => {
  const out = await call([
    { warehouseId: "b", data: governed("b", { name: "Zed" }) },
    { warehouseId: "a", data: governed("a", { name: "Alpha" }) },
    { warehouseId: "c", data: governed("c", { name: "Alpha" }) }, // same label as 'a' -> tiebreak by id
    { warehouseId: "a", data: governed("a", { name: "Alpha" }) }, // duplicate value -> dropped
  ]);
  assert.deepEqual(out.map((o) => o.value), ["a", "c", "b"]);
  assert.equal(out.length, 3);
});

await check("unknown request field rejected -> INVALID_REQUEST", async () => {
  await assert.rejects(listEligibleReceivingLocationOptions({ foo: 1 }, deps([])), (e) => e instanceof ReceivingLocationOptionsError && e.code === "INVALID_REQUEST");
});
await check("non-object request rejected -> INVALID_REQUEST", async () => {
  for (const bad of [null, [], "x", 1, true]) {
    await assert.rejects(listEligibleReceivingLocationOptions(bad, deps([])), (e) => e.code === "INVALID_REQUEST");
  }
});

await check("unauthorized -> PERMISSION_DENIED (fail closed, no options)", async () => {
  await assert.rejects(call([{ warehouseId: "g", data: governed("g") }], { authorize: async () => false }), (e) => e.code === "PERMISSION_DENIED");
});
await check("invalid/missing trusted actor -> PERMISSION_DENIED", async () => {
  await assert.rejects(call([], { actor: { kind: "USER", id: "" } }), (e) => e.code === "PERMISSION_DENIED");
  await assert.rejects(call([], { actor: { kind: "ROBOT", id: "r" } }), (e) => e.code === "PERMISSION_DENIED");
});

await check("candidate read failure -> SOURCE_UNAVAILABLE (fail closed, sanitized)", async () => {
  await assert.rejects(call([], { readCandidateWarehouses: async () => { throw new Error("firestore boom raw detail"); } }), (e) => e.code === "SOURCE_UNAVAILABLE" && !/boom raw detail/.test(e.message));
});

await check("deterministic + non-mutating (repeat call equal; input candidates untouched)", async () => {
  const candidates = [{ warehouseId: "a", data: governed("a", { name: "A" }) }, { warehouseId: "b", data: governed("b", { name: "B" }) }];
  const snapshot = JSON.stringify(candidates.map((c) => ({ id: c.warehouseId, keys: Object.keys(c.data).sort() })));
  const r1 = await call(candidates);
  const r2 = await call(candidates);
  assert.deepEqual(r1, r2);
  assert.equal(JSON.stringify(candidates.map((c) => ({ id: c.warehouseId, keys: Object.keys(c.data).sort() }))), snapshot);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
