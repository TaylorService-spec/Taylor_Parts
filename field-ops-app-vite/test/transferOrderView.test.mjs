// Enterprise Inventory -- EI-P1c-1. Deterministic pure unit tests for the Transfer Order
// adapter (src/domain/transferOrderView.js), EOS shape only (the Firestore legacy
// fromWarehouseId/toWarehouseId shape is refused since main went EOS-only). Proves: authoritative
// doc-id (never the stored id), the real EOS item via toTransferOrderDoc, endpoint validity (non-VIRTUAL, distinct), the exact 5-field transferRef, and fail-closed on
// malformed/incomplete/contradictory/stored-id-conflicting records. No writes, no UI.
//
// Run: node test/transferOrderView.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import { toTransferRef, isTransferRefRecord } from "../src/domain/transferOrderView.js";
import { toTransferOrderDoc } from "../src/domain/transferOrderDoc.js";

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

// --- happy paths ---
ok("generalized record -> exact 5-field transferRef", () => {
  const r = toTransferRef("TO-1", gen());
  assert.equal(r.valid, true);
  assert.deepEqual(r.value, { transferOrderId: "TO-1", partId: "PART-1", origin: WH1, destination: TRUCK, status: "REQUESTED" });
  // No quantity/timestamps/other authority copied through.
  assert.deepEqual(Object.keys(r.value).sort(), ["destination", "origin", "partId", "status", "transferOrderId"]);
});

ok("a real EOS listTransferOrders item, through toTransferOrderDoc, is a valid row (regression: every row was unknown_field)", () => {
  const item = { transferOrderId: "trf_1", transferOrderNumber: "TO-2026-000008", status: "COMPLETED", partId: "PRT-1001", trackingMode: "NONE", quantity: 1, serialNumbers: [],
    origin: { type: "MOBILE", locationId: "truck-01-stock", warehouseId: "wh-main" }, destination: { type: "WAREHOUSE", locationId: "wh-main", warehouseId: "wh-main" },
    createdAt: "2026-10-02T00:51:56.425Z", createdBy: "p-1", canReceive: false };
  const doc = toTransferOrderDoc(item);
  const r = toTransferRef(doc.docId, doc.data);
  assert.equal(r.valid, true, r.reason);
  assert.deepEqual(r.value, { transferOrderId: "trf_1", partId: "PRT-1001", origin: { type: "MOBILE", locationId: "truck-01-stock" }, destination: { type: "WAREHOUSE", locationId: "wh-main" }, status: "COMPLETED" });
});

ok("the Firestore legacy warehouse-only shape is refused (no build reads Firestore transfers)", () => {
  assert.equal(toTransferRef("TO-2", { partId: "PART-1", fromWarehouseId: "WH-1", toWarehouseId: "WH-2", status: "IN_TRANSIT" }).reason, "endpoints_missing");
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
ok("endpoints_missing when no endpoint is present", () => {
  assert.equal(toTransferRef("TO-1", { partId: "PART-1", status: "REQUESTED" }).reason, "endpoints_missing");
});

ok("generalized endpoints must be complete + valid discriminated refs", () => {
  assert.equal(toTransferRef("TO-1", gen({ destination: undefined })).reason, "destination_invalid");
  assert.equal(toTransferRef("TO-1", gen({ origin: { type: "TRUCK", locationId: "X" } })).reason, "origin_invalid");
  // A generalized endpoint may not smuggle extra fields (e.g. a label).
  assert.equal(toTransferRef("TO-1", gen({ origin: { type: "WAREHOUSE", locationId: "WH-1", label: "Main" } })).reason, "origin_invalid");
});

ok("non-VIRTUAL and distinct endpoints enforced (via EI-P1b-2 transferRef)", () => {
  assert.equal(toTransferRef("TO-1", gen({ origin: { type: "VIRTUAL", locationId: "V" } })).reason, "endpoint_virtual");
  assert.equal(toTransferRef("TO-1", gen({ destination: { type: "VIRTUAL", locationId: "V" } })).reason, "endpoint_virtual");
  assert.equal(toTransferRef("TO-1", gen({ destination: { ...WH1 } })).reason, "endpoint_same");
});

// --- purity ---
ok("does not mutate input", () => {
  const d = gen();
  const snap = structuredClone(d);
  toTransferRef("TO-1", d);
  assert.deepEqual(d, snap);
});

console.log(`\n${passed} passed`);
