// Enterprise Inventory Phase 4 -- OFFLINE tests for the pure Transfer command request builders
// (house check()/passed convention). No Firebase/network.
import assert from "node:assert/strict";
import { buildCreateTransferRequest, buildTransferActionRequest, makeIdempotencyKey } from "../src/domain/transferCommandRequest.js";

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }
console.log("transferCommandRequest.test.mjs");

const baseDraft = () => ({
  partId: "part-1",
  quantity: "3",
  originType: "WAREHOUSE",
  originLocationId: "wh-1",
  destinationType: "MOBILE",
  destinationLocationId: "truck-loc-1",
  serialNumbersText: "",
});

check("valid NONE draft builds the exact request shape, with a stable supplied key", () => {
  const result = buildCreateTransferRequest(baseDraft(), { idempotencyKey: "fixed-key" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    partId: "part-1",
    quantity: 3,
    origin: { type: "WAREHOUSE", locationId: "wh-1" },
    destination: { type: "MOBILE", locationId: "truck-loc-1" },
    idempotencyKey: "fixed-key",
  });
});

check("valid SERIAL draft parses newline/comma-separated serials", () => {
  const draft = { ...baseDraft(), quantity: "2", serialNumbersText: "SN-1,\nSN-2" };
  const result = buildCreateTransferRequest(draft, { idempotencyKey: "k" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.serialNumbers, ["SN-1", "SN-2"]);
});

check("missing partId -> error, no value", () => {
  const result = buildCreateTransferRequest({ ...baseDraft(), partId: "" }, { idempotencyKey: "k" });
  assert.equal(result.ok, false);
  assert.equal(result.value, null);
  assert.ok(result.errors.partId);
});

check("quantity must be a positive integer", () => {
  assert.equal(buildCreateTransferRequest({ ...baseDraft(), quantity: "0" }).ok, false);
  assert.equal(buildCreateTransferRequest({ ...baseDraft(), quantity: "1.5" }).ok, false);
  assert.equal(buildCreateTransferRequest({ ...baseDraft(), quantity: "abc" }).ok, false);
});

check("same origin==destination -> rejected", () => {
  const draft = { ...baseDraft(), originType: "WAREHOUSE", originLocationId: "wh-1", destinationType: "WAREHOUSE", destinationLocationId: "wh-1" };
  const result = buildCreateTransferRequest(draft, { idempotencyKey: "k" });
  assert.equal(result.ok, false);
  assert.ok(result.errors.destinationLocationId);
});

check("duplicate serial numbers -> rejected", () => {
  const draft = { ...baseDraft(), quantity: "2", serialNumbersText: "SN-1, SN-1" };
  const result = buildCreateTransferRequest(draft, { idempotencyKey: "k" });
  assert.equal(result.ok, false);
  assert.ok(result.errors.serialNumbersText);
});

check("an omitted idempotencyKey is auto-generated and non-empty", () => {
  const result = buildCreateTransferRequest(baseDraft());
  assert.equal(result.ok, true);
  assert.equal(typeof result.value.idempotencyKey, "string");
  assert.ok(result.value.idempotencyKey.length > 0);
});

check("makeIdempotencyKey produces distinct, prefixed values", () => {
  const a = makeIdempotencyKey();
  const b = makeIdempotencyKey();
  assert.notEqual(a, b);
  assert.ok(a.startsWith("trf_"));
});

check("buildTransferActionRequest: valid id -> exact shape; blank -> rejected", () => {
  assert.deepEqual(buildTransferActionRequest("t1"), { ok: true, value: { transferOrderId: "t1" } });
  assert.equal(buildTransferActionRequest("").ok, false);
  assert.equal(buildTransferActionRequest(undefined).ok, false);
});

console.log(`${passed} passed`);
