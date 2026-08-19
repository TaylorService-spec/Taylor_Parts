// M23 blind-count remediation -- OFFLINE tests for the pure cycle count command request builders,
// focused on buildReconcileCycleCountRequest's new `decision` field (functions/src/cycleCount/
// cycleCountCallables.ts's RECONCILE_KEYS/validateReconcileRequest is the server-side mirror of this
// same shape). No Firebase/network.
import assert from "node:assert/strict";
import { buildReconcileCycleCountRequest, buildCreateCycleCountRequest, buildCycleCountIdOnlyRequest, makeIdempotencyKey } from "../src/domain/cycleCountCommandRequest.js";

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }
console.log("cycleCountCommandRequest.test.mjs");

check("buildReconcileCycleCountRequest defaults decision to APPROVE when omitted", () => {
  const result = buildReconcileCycleCountRequest("cyc-1", "a reason");
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { cycleCountId: "cyc-1", decision: "APPROVE", reason: "a reason" });
});

check("buildReconcileCycleCountRequest honors an explicit REJECT decision", () => {
  const result = buildReconcileCycleCountRequest("cyc-1", "disputed", "REJECT");
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { cycleCountId: "cyc-1", decision: "REJECT", reason: "disputed" });
});

check("buildReconcileCycleCountRequest rejects an unknown decision value", () => {
  const result = buildReconcileCycleCountRequest("cyc-1", "x", "MAYBE");
  assert.equal(result.ok, false);
  assert.equal(result.value, null);
});

check("buildReconcileCycleCountRequest omits reason when blank/absent, but always carries decision", () => {
  const result = buildReconcileCycleCountRequest("cyc-1", "");
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { cycleCountId: "cyc-1", decision: "APPROVE" });
});

check("buildReconcileCycleCountRequest: blank cycleCountId -> rejected", () => {
  assert.equal(buildReconcileCycleCountRequest("", "reason").ok, false);
  assert.equal(buildReconcileCycleCountRequest(undefined, "reason").ok, false);
});

check("buildCreateCycleCountRequest builds the exact createCycleCount shape (unchanged by M23)", () => {
  const result = buildCreateCycleCountRequest(
    { partId: "part-1", locationType: "WAREHOUSE", locationId: "wh-1" },
    { idempotencyKey: "fixed-key" },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    partId: "part-1",
    location: { type: "WAREHOUSE", locationId: "wh-1" },
    idempotencyKey: "fixed-key",
  });
});

check("buildCycleCountIdOnlyRequest: valid id -> exact shape; blank -> rejected", () => {
  assert.deepEqual(buildCycleCountIdOnlyRequest("c1"), { ok: true, value: { cycleCountId: "c1" } });
  assert.equal(buildCycleCountIdOnlyRequest("").ok, false);
});

check("makeIdempotencyKey produces distinct, prefixed values", () => {
  const a = makeIdempotencyKey();
  const b = makeIdempotencyKey();
  assert.notEqual(a, b);
  assert.ok(a.startsWith("cyc_"));
});

console.log(`${passed} passed`);
