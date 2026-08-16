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
  TRACKING_MODE,
  PART_TRACKING_STATUS,
  resolvePartTrackingMode,
  describeSerialEntryIssues,
  validateSerialNumbers,
  describePartTrackingBlock,
  describeLotNotSupported,
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

check("RECEIVE_STEP vocabulary is present and ordered as the linear flow (SERIALS inserted before CONFIRM)", () => {
  assert.deepEqual(Object.keys(RECEIVE_STEP), ["SELECT_CANDIDATE", "SELECT_LOCATION", "SERIALS", "CONFIRM", "RESULT"]);
});

// ---- Wave 7 Part 2: SERIAL capture ----

const okPartsFetch = (parts) => ({ ok: true, parts, invalid: [] });

check("resolvePartTrackingMode: STANDARD -> NONE, SERIALIZED -> SERIAL, LOT -> LOT (mirrors the server mapping)", () => {
  const parts = [
    { partId: "p-standard", controlType: "STANDARD" },
    { partId: "p-serial", controlType: "SERIALIZED" },
    { partId: "p-lot", controlType: "LOT" },
  ];
  assert.equal(resolvePartTrackingMode({ partsFetchResult: okPartsFetch(parts), partId: "p-standard" }).trackingMode, TRACKING_MODE.NONE);
  assert.equal(resolvePartTrackingMode({ partsFetchResult: okPartsFetch(parts), partId: "p-serial" }).trackingMode, TRACKING_MODE.SERIAL);
  assert.equal(resolvePartTrackingMode({ partsFetchResult: okPartsFetch(parts), partId: "p-lot" }).trackingMode, TRACKING_MODE.LOT);
  assert.equal(resolvePartTrackingMode({ partsFetchResult: okPartsFetch(parts), partId: "p-standard" }).status, PART_TRACKING_STATUS.READY);
});

check("resolvePartTrackingMode: fails CLOSED (never defaults to NONE) on a denied/unavailable/not-found Part read", () => {
  assert.equal(resolvePartTrackingMode({ partsFetchResult: { ok: false, code: "permission-denied" }, partId: "p-1" }).status, PART_TRACKING_STATUS.BLOCKED_PERMISSION);
  assert.equal(resolvePartTrackingMode({ partsFetchResult: { ok: false, code: "unavailable" }, partId: "p-1" }).status, PART_TRACKING_STATUS.BLOCKED_UNAVAILABLE);
  assert.equal(resolvePartTrackingMode({ partsFetchResult: okPartsFetch([{ partId: "other", controlType: "STANDARD" }]), partId: "p-1" }).status, PART_TRACKING_STATUS.BLOCKED_NOT_FOUND);
  // malformed fetch result (not even a plain object) -> also fails closed, never throws
  assert.equal(resolvePartTrackingMode({ partsFetchResult: null, partId: "p-1" }).status, PART_TRACKING_STATUS.BLOCKED_UNAVAILABLE);
  // none of the blocked statuses ever carry a trackingMode
  assert.equal(resolvePartTrackingMode({ partsFetchResult: { ok: false, code: "permission-denied" }, partId: "p-1" }).trackingMode, undefined);
});

check("describeSerialEntryIssues / validateSerialNumbers: exactly orderedQuantity, no blanks, no duplicates", () => {
  assert.equal(describeSerialEntryIssues({ serials: ["A", "B"], expectedCount: 2 }).ok, true);
  assert.equal(describeSerialEntryIssues({ serials: ["A"], expectedCount: 2 }).ok, false); // count mismatch
  assert.equal(describeSerialEntryIssues({ serials: ["A", "A"], expectedCount: 2 }).ok, false); // duplicate
  assert.equal(describeSerialEntryIssues({ serials: ["A", " "], expectedCount: 2 }).ok, false); // blank after trim
  assert.deepEqual(describeSerialEntryIssues({ serials: ["A", "A", "B"], expectedCount: 3 }).duplicateIndexes, [0, 1]);
  assert.equal(validateSerialNumbers({ serialNumbers: ["A", "B"], expectedCount: 2 })[0], "A");
  assert.equal(validateSerialNumbers({ serialNumbers: ["A"], expectedCount: 2 }), null);
  assert.equal(validateSerialNumbers({ serialNumbers: ["A", "A"], expectedCount: 2 }), null);
  assert.equal(validateSerialNumbers({ serialNumbers: ["A", ""], expectedCount: 2 }), null);
  assert.equal(validateSerialNumbers({ serialNumbers: "not-an-array", expectedCount: 2 }), null);
});

check("validateSerialNumbers: trims whitespace but PRESERVES CASE (serial identity is case-significant)", () => {
  const validated = validateSerialNumbers({ serialNumbers: ["  AbC123  ", " xyz "], expectedCount: 2 });
  assert.deepEqual(validated, ["AbC123", "xyz"]);
  // "abc123" and "AbC123" are NOT duplicates -- case is significant
  assert.equal(describeSerialEntryIssues({ serials: ["abc123", "AbC123"], expectedCount: 2 }).ok, true);
});

check("buildReceiveRequestInput: NONE / omitted trackingMode -> the EXACT legacy line shape, no serialNumbers key", () => {
  const input = buildReceiveRequestInput({ candidate: candidate(), locationId: "wh-1", trackingMode: TRACKING_MODE.NONE });
  assert.deepEqual(input.lines[0], { lineId: "r1:1", partId: "part-r1", expectedQuantity: 5, receivedQuantity: 5 });
  assert.equal(Object.prototype.hasOwnProperty.call(input.lines[0], "serialNumbers"), false);
  // omitting trackingMode entirely (legacy caller) behaves identically
  const legacyInput = buildReceiveRequestInput({ candidate: candidate(), locationId: "wh-1" });
  assert.deepEqual(legacyInput.lines[0], input.lines[0]);
});

check("buildReceiveRequestInput: SERIAL -> requires exactly orderedQuantity valid serials, included on the line", () => {
  const c = candidate({ orderedQuantity: 2 });
  const ok = buildReceiveRequestInput({ candidate: c, locationId: "wh-1", trackingMode: TRACKING_MODE.SERIAL, serialNumbers: ["SN-1", "SN-2"] });
  assert.deepEqual(ok.lines[0].serialNumbers, ["SN-1", "SN-2"]);
  assert.equal(ok.lines[0].expectedQuantity, 2);
  // wrong count, blank, duplicate, or missing entirely -> null (never a partial request)
  assert.equal(buildReceiveRequestInput({ candidate: c, locationId: "wh-1", trackingMode: TRACKING_MODE.SERIAL, serialNumbers: ["SN-1"] }), null);
  assert.equal(buildReceiveRequestInput({ candidate: c, locationId: "wh-1", trackingMode: TRACKING_MODE.SERIAL, serialNumbers: ["SN-1", ""] }), null);
  assert.equal(buildReceiveRequestInput({ candidate: c, locationId: "wh-1", trackingMode: TRACKING_MODE.SERIAL, serialNumbers: ["SN-1", "SN-1"] }), null);
  assert.equal(buildReceiveRequestInput({ candidate: c, locationId: "wh-1", trackingMode: TRACKING_MODE.SERIAL }), null);
});

check("buildReceiveRequestInput: LOT is deliberately blocked -> always null, regardless of other inputs", () => {
  assert.equal(buildReceiveRequestInput({ candidate: candidate(), locationId: "wh-1", trackingMode: TRACKING_MODE.LOT }), null);
});

check("CONTRACT CROSS-CHECK (NONE): the legacy assembled input is still ACCEPTED by the transport's frozen buildReceiveRequest", () => {
  const input = buildReceiveRequestInput({ candidate: candidate(), locationId: "wh-1", trackingMode: TRACKING_MODE.NONE });
  const payload = buildReceiveRequest(input);
  assert.notEqual(payload, null, "transport must still accept the unchanged NONE request shape");
  // A NONE receipt must carry NO serial key at all -- not an empty array.
  assert.equal("serialNumbers" in payload.lines[0], false);
});

// The SERIAL half of the same cross-check. This could not be asserted while it was written, because
// the transport had not yet been taught to pass serialNumbers through (that landed in #1009). It is
// the seam where SERIAL receiving previously broke end to end -- the command accepted serials while
// the boundary either stripped or rejected them -- so it is asserted directly rather than assumed.
check("CONTRACT CROSS-CHECK (SERIAL): an assembled SERIAL input is ACCEPTED by the transport and keeps its serials", () => {
  const serials = ["SN-1", "SN-2", "SN-3", "SN-4", "SN-5"];
  const input = buildReceiveRequestInput({
    candidate: candidate(),
    locationId: "wh-1",
    trackingMode: TRACKING_MODE.SERIAL,
    serialNumbers: serials,
  });
  assert.notEqual(input, null, "a valid SERIAL input must be assembled");
  const payload = buildReceiveRequest(input);
  assert.notEqual(payload, null, "transport must accept the SERIAL request shape");
  assert.deepEqual([...payload.lines[0].serialNumbers], serials, "serials must survive the transport verbatim");
  // one serial per received unit, bound to the ordered quantity
  assert.equal(payload.lines[0].serialNumbers.length, payload.lines[0].receivedQuantity);
});

check("CONTRACT CROSS-CHECK (SERIAL): trimming is preserved and case is NOT folded through the transport", () => {
  const input = buildReceiveRequestInput({
    candidate: candidate(),
    locationId: "wh-1",
    trackingMode: TRACKING_MODE.SERIAL,
    serialNumbers: ["  SN-1 ", "sn-1", "SN-3", "SN-4", "SN-5"],
  });
  const payload = buildReceiveRequest(input);
  assert.notEqual(payload, null);
  // "  SN-1 " trims to "SN-1"; "sn-1" stays distinct rather than collapsing into it.
  assert.deepEqual([...payload.lines[0].serialNumbers], ["SN-1", "sn-1", "SN-3", "SN-4", "SN-5"]);
});

check("describePartTrackingBlock / describeLotNotSupported: sanitized honest copy, no raw code/path", () => {
  for (const status of Object.values(PART_TRACKING_STATUS)) {
    if (status === PART_TRACKING_STATUS.READY) continue;
    const d = describePartTrackingBlock(status);
    assert.ok(d.title && d.message);
    assert.ok(!/permission-denied|firestore|functions\/|\//.test(d.message));
  }
  const lot = describeLotNotSupported();
  assert.ok(lot.title && lot.message);
});

console.log(`\n${passed} passed, 0 failed`);
