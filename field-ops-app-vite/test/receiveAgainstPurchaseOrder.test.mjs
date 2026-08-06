// Governed FieldMode Receive-against-Purchase-Order (A1) -- OFFLINE tests for the pure workflow
// view-model. Plain Node (house check()/passed convention). No Firebase/network. The key
// assertion is a CONTRACT cross-check: the request this module assembles is accepted by
// domain/receivingTransport.js's frozen buildReceiveRequest (so the UI can never build a request
// the transport would reject). Nothing here invokes a callable or touches the readiness transport.
import assert from "node:assert/strict";
import {
  isReceivableCandidate,
  receiveLineId,
  receiveIdempotencyKey,
  buildReceiveRequestInput,
  describeReceiveOutcome,
  isReceivingUnavailable,
  RECEIVE_STEP,
} from "../src/domain/receiveAgainstPurchaseOrder.js";
import { buildReceiveRequest, RECEIVING_OUTCOME } from "../src/domain/receivingTransport.js";

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }
console.log("receiveAgainstPurchaseOrder.test.mjs");

// An OPEN row exactly as domain/purchaseOrdersView.js produces it.
const candidate = (over = {}) => ({
  reorderRequestId: "r1",
  purchaseOrderId: "r1",
  partId: "part-r1",
  orderedQuantity: 5,
  viewStatus: "OPEN",
  isReceiptCandidate: true,
  receiptSource: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: "r1", purchaseOrderId: "r1" },
  ...over,
});

check("isReceivableCandidate: an OPEN row with a receiptSource + partId + positive qty is receivable", () => {
  assert.equal(isReceivableCandidate(candidate()), true);
});
check("isReceivableCandidate: non-candidate / missing source / zero qty / malformed -> false", () => {
  assert.equal(isReceivableCandidate(candidate({ isReceiptCandidate: false })), false);
  assert.equal(isReceivableCandidate(candidate({ receiptSource: null })), false);
  assert.equal(isReceivableCandidate(candidate({ orderedQuantity: 0 })), false);
  assert.equal(isReceivableCandidate(candidate({ partId: "" })), false);
  assert.equal(isReceivableCandidate(null), false);
  assert.equal(isReceivableCandidate({}), false);
});

check("deterministic lineId + idempotencyKey (stable, distinct from the raw id)", () => {
  assert.equal(receiveLineId("r1"), "r1:1");
  assert.equal(receiveIdempotencyKey("r1"), "receive:r1");
  // stable across calls
  assert.equal(receiveIdempotencyKey("r1"), receiveIdempotencyKey("r1"));
});

check("buildReceiveRequestInput: assembles source/location/single-line/idempotencyKey; expected==received==ordered", () => {
  const input = buildReceiveRequestInput({ candidate: candidate(), locationId: "wh-1" });
  assert.deepEqual(input.source, { type: "REORDER_PURCHASE_ORDER", reorderRequestId: "r1", purchaseOrderId: "r1" });
  assert.deepEqual(input.receivingLocation, { type: "WAREHOUSE", locationId: "wh-1" });
  assert.equal(input.lines.length, 1);
  assert.deepEqual(input.lines[0], { lineId: "r1:1", partId: "part-r1", expectedQuantity: 5, receivedQuantity: 5 });
  assert.equal(input.idempotencyKey, "receive:r1");
});

check("CONTRACT CROSS-CHECK: the assembled input is ACCEPTED by the transport's frozen buildReceiveRequest", () => {
  const input = buildReceiveRequestInput({ candidate: candidate(), locationId: "wh-1" });
  const payload = buildReceiveRequest(input);
  assert.notEqual(payload, null, "transport must accept the assembled request");
  // and the frozen payload round-trips the identity + the v1 expected==received==ordered invariant
  assert.equal(payload.source.reorderRequestId, "r1");
  assert.equal(payload.lines[0].expectedQuantity, payload.lines[0].receivedQuantity);
  assert.equal(payload.lines[0].receivedQuantity, 5);
});

check("buildReceiveRequestInput: non-receivable candidate or blank location -> null (never a partial request)", () => {
  assert.equal(buildReceiveRequestInput({ candidate: candidate({ isReceiptCandidate: false }), locationId: "wh-1" }), null);
  assert.equal(buildReceiveRequestInput({ candidate: candidate(), locationId: "" }), null);
  assert.equal(buildReceiveRequestInput({ candidate: candidate(), locationId: "   " }), null);
});

check("describeReceiveOutcome: applied/replayed are terminal successes; denied/conflict/invalid are non-terminal; unavailable is the not-activated default", () => {
  assert.equal(describeReceiveOutcome(RECEIVING_OUTCOME.APPLIED).terminal, true);
  assert.equal(describeReceiveOutcome(RECEIVING_OUTCOME.REPLAYED).terminal, true);
  assert.equal(describeReceiveOutcome(RECEIVING_OUTCOME.DENIED).terminal, false);
  assert.equal(describeReceiveOutcome(RECEIVING_OUTCOME.CONFLICT).terminal, false);
  assert.equal(describeReceiveOutcome(RECEIVING_OUTCOME.INVALID).terminal, false);
  // unknown / undefined -> unavailable default, never throws
  assert.equal(describeReceiveOutcome("nonsense").tone, "muted");
  assert.equal(describeReceiveOutcome(undefined).title, "Receiving not available");
});
check("describeReceiveOutcome: copy leaks no raw code/path/id (only sanitized human text)", () => {
  for (const s of Object.values(RECEIVING_OUTCOME)) {
    const d = describeReceiveOutcome(s);
    assert.ok(!/permission-denied|failed-precondition|firestore|functions\/|\//.test(d.message), `sanitized: ${s}`);
  }
});

check("isReceivingUnavailable: true only for the UNAVAILABLE status", () => {
  assert.equal(isReceivingUnavailable(RECEIVING_OUTCOME.UNAVAILABLE), true);
  assert.equal(isReceivingUnavailable(RECEIVING_OUTCOME.DENIED), false);
  assert.equal(isReceivingUnavailable(RECEIVING_OUTCOME.APPLIED), false);
});

check("RECEIVE_STEP vocabulary is present and ordered as the linear flow", () => {
  assert.deepEqual(Object.keys(RECEIVE_STEP), ["SELECT_CANDIDATE", "SELECT_LOCATION", "CONFIRM", "RESULT"]);
});

console.log(`\n${passed} passed, 0 failed`);
