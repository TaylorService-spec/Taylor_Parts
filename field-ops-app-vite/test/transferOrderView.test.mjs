// Enterprise Inventory -- EI-P1c-1. Deterministic pure unit tests for the Transfer Order
// adapter (src/domain/transferOrderView.js). Proves: authoritative doc-id (never the
// stored id), generalized + legacy normalization, both-present exact agreement, endpoint
// validity (non-VIRTUAL, distinct), the exact 5-field transferRef, and fail-closed on
// malformed/incomplete/contradictory/stored-id-conflicting records. No writes, no UI.
//
// Run: node test/transferOrderView.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import { toTransferRef, isTransferRefRecord } from "../src/domain/transferOrderView.js";

let passed = 0;
function ok(name, fn) {
  fn();
  passed += 1;
  console.log("PASS -- " + name);
}

const WH1 = { type: "WAREHOUSE", locationId: "WH-1" };
const WH2 = { type: "WAREHOUSE", locationId: "WH-2" };
const TRUCK = { type: "MOBILE", locationId: "TRUCK-7" };

// Generalized record (also carries fields the adapter must IGNORE).
const gen = (over = {}) => ({ partId: "PART-1", origin: WH1, destination: TRUCK, status: "REQUESTED", quantity: 5, createdAt: 123, updatedAt: 456, ...over });
// Legacy warehouse-only record.
const leg = (over = {}) => ({ partId: "PART-1", fromWarehouseId: "WH-1", toWarehouseId: "WH-2", status: "IN_TRANSIT", quantity: 3, ...over });

// --- happy paths ---
ok("generalized record -> exact 5-field transferRef", () => {
  const r = toTransferRef("TO-1", gen());
  assert.equal(r.valid, true);
  assert.deepEqual(r.value, { transferOrderId: "TO-1", partId: "PART-1", origin: WH1, destination: TRUCK, status: "REQUESTED" });
  // No quantity/timestamps/other authority copied through.
  assert.deepEqual(Object.keys(r.value).sort(), ["destination", "origin", "partId", "status", "transferOrderId"]);
});

ok("legacy record -> WAREHOUSE Location refs derived", () => {
  const r = toTransferRef("TO-2", leg());
  assert.equal(r.valid, true);
  assert.deepEqual(r.value, { transferOrderId: "TO-2", partId: "PART-1", origin: WH1, destination: WH2, status: "IN_TRANSIT" });
});

ok("both representations present and in exact agreement -> valid", () => {
  const r = toTransferRef("TO-3", { partId: "PART-1", origin: WH1, destination: WH2, fromWarehouseId: "WH-1", toWarehouseId: "WH-2", status: "COMPLETED" });
  assert.equal(r.valid, true);
  assert.deepEqual(r.value, { transferOrderId: "TO-3", partId: "PART-1", origin: WH1, destination: WH2, status: "COMPLETED" });
});

ok("extra authority fields (trackingMode, labels, serials, id==docId) are ignored, never copied", () => {
  const r = toTransferRef("TO-4", gen({ id: "TO-4", trackingMode: "SERIAL", serialNos: ["SN-1"], originLabel: "Main", note: "x" }));
  assert.equal(r.valid, true);
  assert.equal("trackingMode" in r.value, false);
  assert.equal("serialNos" in r.value, false);
});

ok("isTransferRefRecord mirrors validity", () => {
  assert.equal(isTransferRefRecord("TO-1", gen()), true);
  assert.equal(isTransferRefRecord("TO-1", {}), false);
});

// --- doc id / stored id ---
ok("authoritative doc id required; stored id never trusted", () => {
  assert.equal(toTransferRef("", gen()).reason, "doc_id_invalid");
  assert.equal(toTransferRef(5, gen()).reason, "doc_id_invalid");
  // A stored id that disagrees with the authoritative doc id fails closed.
  assert.equal(toTransferRef("TO-1", gen({ id: "OTHER" })).reason, "stored_id_conflict");
  // A matching or absent stored id is fine; transferOrderId always comes from the arg.
  assert.equal(toTransferRef("TO-1", gen({ id: "TO-1" })).value.transferOrderId, "TO-1");
  assert.equal(toTransferRef("TO-1", gen()).value.transferOrderId, "TO-1");
});

// --- structural fail-closed ---
ok("not_object / part / status", () => {
  for (const v of [null, undefined, "x", 5, []]) assert.equal(toTransferRef("TO-1", v).reason, "not_object", String(v));
  assert.equal(toTransferRef("TO-1", gen({ partId: "" })).reason, "part_id_invalid");
  assert.equal(toTransferRef("TO-1", gen({ partId: 7 })).reason, "part_id_invalid");
  assert.equal(toTransferRef("TO-1", gen({ status: "PENDING" })).reason, "status_invalid");
  assert.equal(toTransferRef("TO-1", gen({ status: undefined })).reason, "status_invalid");
});

// --- endpoints ---
ok("endpoints_missing when neither representation is present", () => {
  assert.equal(toTransferRef("TO-1", { partId: "PART-1", status: "REQUESTED" }).reason, "endpoints_missing");
});

ok("generalized endpoints must be complete + valid discriminated refs", () => {
  assert.equal(toTransferRef("TO-1", gen({ destination: undefined })).reason, "destination_invalid");
  assert.equal(toTransferRef("TO-1", gen({ origin: { type: "TRUCK", locationId: "X" } })).reason, "origin_invalid");
  // A generalized endpoint may not smuggle extra fields (e.g. a label).
  assert.equal(toTransferRef("TO-1", gen({ origin: { type: "WAREHOUSE", locationId: "WH-1", label: "Main" } })).reason, "origin_invalid");
});

ok("legacy endpoints must be complete non-empty warehouse ids", () => {
  assert.equal(toTransferRef("TO-1", { partId: "PART-1", fromWarehouseId: "WH-1", status: "REQUESTED" }).reason, "destination_invalid");
  assert.equal(toTransferRef("TO-1", { partId: "PART-1", fromWarehouseId: 5, toWarehouseId: "WH-2", status: "REQUESTED" }).reason, "origin_invalid");
});

ok("non-VIRTUAL and distinct endpoints enforced (via EI-P1b-2 transferRef)", () => {
  assert.equal(toTransferRef("TO-1", gen({ origin: { type: "VIRTUAL", locationId: "V" } })).reason, "endpoint_virtual");
  assert.equal(toTransferRef("TO-1", gen({ destination: { type: "VIRTUAL", locationId: "V" } })).reason, "endpoint_virtual");
  assert.equal(toTransferRef("TO-1", gen({ destination: { ...WH1 } })).reason, "endpoint_same");
});

// --- contradiction between representations ---
ok("both present but disagreeing endpoints fail closed", () => {
  // generalized destination is the truck, legacy toWarehouseId is WH-2 -> disagree.
  assert.equal(toTransferRef("TO-1", { partId: "PART-1", origin: WH1, destination: TRUCK, fromWarehouseId: "WH-1", toWarehouseId: "WH-2", status: "REQUESTED" }).reason, "endpoint_disagreement");
  // generalized origin differs from legacy fromWarehouseId.
  assert.equal(toTransferRef("TO-1", { partId: "PART-1", origin: WH2, destination: WH2, fromWarehouseId: "WH-1", toWarehouseId: "WH-2", status: "REQUESTED" }).reason, "endpoint_disagreement");
});

// --- purity ---
ok("does not mutate input", () => {
  const d = gen({ fromWarehouseId: "WH-1", toWarehouseId: "TRUCK-7" });
  // (fromWarehouseId TRUCK-7 would disagree, but we only check non-mutation here)
  const snap = structuredClone(d);
  toTransferRef("TO-1", d);
  assert.deepEqual(d, snap);
});

console.log(`\n${passed} passed`);
