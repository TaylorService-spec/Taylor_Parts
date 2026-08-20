// CANONICAL multi-line receiving transport — pure request/response contract. No emulator, no I/O.
// Run: node --test test/canonicalReceivingTransport.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCanonicalReceiveRequest,
  validateCanonicalReceiveResponse,
  buildReceiveRequest,
} from "../src/domain/receivingTransport.js";

const req = (over = {}) => ({
  source: { type: "PURCHASE_ORDER", purchaseOrderId: "PO-1" },
  receivingLocation: { type: "WAREHOUSE", locationId: "WH-1" },
  lines: [{ lineId: "L1", partId: "P1", receivedQuantity: 2 }],
  idempotencyKey: "k1",
  ...over,
});

// ------------------------------------------------------------ the two shapes coexist

test("the LEGACY builder is untouched and still accepts the deployed shape", () => {
  // Deployed clients send this exact payload; it must keep working byte for byte.
  const built = buildReceiveRequest({
    source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: "RR-1", purchaseOrderId: "RR-1" },
    receivingLocation: { type: "WAREHOUSE", locationId: "WH-1" },
    lines: [{ lineId: "ANY-LABEL", partId: "P1", expectedQuantity: 3, receivedQuantity: 3 }],
    idempotencyKey: "k",
  });
  assert.ok(built);
  assert.equal(built.source.type, "REORDER_PURCHASE_ORDER");
  assert.equal(built.lines.length, 1);
});

test("the legacy builder REFUSES a canonical source, and vice versa", () => {
  // Each builder owns one shape. Neither silently accepts the other's, so a caller cannot half-migrate.
  assert.equal(buildReceiveRequest(req()), null);
  assert.equal(
    buildCanonicalReceiveRequest({
      source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: "RR-1", purchaseOrderId: "RR-1" },
      receivingLocation: { type: "WAREHOUSE", locationId: "WH-1" },
      lines: [{ lineId: "L1", partId: "P1", receivedQuantity: 1 }],
      idempotencyKey: "k",
    }),
    null,
  );
});

// ------------------------------------------------------------ canonical request

test("a valid multi-line request is built and frozen", () => {
  const built = buildCanonicalReceiveRequest(req({
    lines: [
      { lineId: "L1", partId: "P1", receivedQuantity: 2 },
      { lineId: "L2", partId: "P2", receivedQuantity: 1, serialNumbers: [" S1 "] },
    ],
  }));
  assert.ok(built);
  assert.equal(built.lines.length, 2);
  assert.equal(built.lines[1].serialNumbers[0], "S1", "serials are trimmed only");
  assert.throws(() => { built.lines.push({}); }, TypeError);
});

test("a canonical source carrying a reorderRequestId is REFUSED, not trimmed", () => {
  // The server rejects it too. Sending a request that disagrees with itself about which authority it
  // addresses should never leave the client.
  assert.equal(
    buildCanonicalReceiveRequest(req({ source: { type: "PURCHASE_ORDER", purchaseOrderId: "PO-1", reorderRequestId: "RR-1" } })),
    null,
  );
});

test("a line may NOT declare expectedQuantity — remaining is a server fact", () => {
  assert.equal(
    buildCanonicalReceiveRequest(req({ lines: [{ lineId: "L1", partId: "P1", receivedQuantity: 1, expectedQuantity: 5 }] })),
    null,
  );
});

test("duplicate line ids are refused before the wire", () => {
  assert.equal(
    buildCanonicalReceiveRequest(req({ lines: [
      { lineId: "L1", partId: "P1", receivedQuantity: 1 },
      { lineId: "L1", partId: "P1", receivedQuantity: 1 },
    ] })),
    null,
  );
});

test("zero, negative and non-numeric quantities are refused", () => {
  for (const q of [0, -1, "2", null, undefined]) {
    assert.equal(buildCanonicalReceiveRequest(req({ lines: [{ lineId: "L1", partId: "P1", receivedQuantity: q }] })), null, `qty ${q}`);
  }
});

test("an empty line list is refused", () => {
  assert.equal(buildCanonicalReceiveRequest(req({ lines: [] })), null);
});

test("expectedVersion is optional, and must be a non-negative number when present", () => {
  assert.ok(buildCanonicalReceiveRequest(req({ expectedVersion: 0 })));
  assert.ok(buildCanonicalReceiveRequest(req({ expectedVersion: 3 })));
  assert.equal(buildCanonicalReceiveRequest(req({ expectedVersion: -1 })), null);
  assert.equal(buildCanonicalReceiveRequest(req({ expectedVersion: "2" })), null);
});

test("an unknown top-level or line key is refused rather than dropped", () => {
  assert.equal(buildCanonicalReceiveRequest(req({ extra: 1 })), null);
  assert.equal(buildCanonicalReceiveRequest(req({ lines: [{ lineId: "L1", partId: "P1", receivedQuantity: 1, sneaky: true }] })), null);
});

test("a non-WAREHOUSE destination is refused", () => {
  assert.equal(buildCanonicalReceiveRequest(req({ receivingLocation: { type: "BIN", locationId: "B1" } })), null);
});

// ------------------------------------------------------------ canonical response

const res = (over = {}) => ({
  outcome: "applied",
  receivingId: "rcvc_abc",
  purchaseOrderId: "PO-1",
  ledgerEventId: "led-1",
  derivedState: "PARTIALLY_RECEIVED",
  storedStatus: "SENT",
  lines: [{ lineId: "L1", partId: "P1", orderedQuantity: 5, previouslyReceived: 1, receivedNow: 2, remainingQuantity: 2, state: "PARTIALLY_RECEIVED" }],
  ...over,
});

test("a well-formed response is accepted and frozen", () => {
  const v = validateCanonicalReceiveResponse(res());
  assert.ok(v);
  assert.equal(v.derivedState, "PARTIALLY_RECEIVED");
  assert.equal(v.storedStatus, "SENT");
  assert.equal(v.lines[0].remainingQuantity, 2);
  assert.throws(() => { v.lines.push({}); }, TypeError);
});

test("derived receipt state and stored lifecycle stay SEPARATE concepts", () => {
  // A partially received order is PARTIALLY_RECEIVED (derived) while still SENT (stored). Collapsing
  // them would be exactly the persisted-partial-status the design refuses.
  const v = validateCanonicalReceiveResponse(res());
  assert.notEqual(v.derivedState, v.storedStatus);
});

test("EXTRA server fields are STRIPPED, never passed through", () => {
  // The bound is what keeps an internal fingerprint, stack, or authority-selection detail out of the
  // UI even if a future server version sent one.
  const v = validateCanonicalReceiveResponse({ ...res(), fingerprint: "deadbeef", stack: "...", internalPath: "x" });
  assert.ok(v);
  assert.equal(v.fingerprint, undefined);
  assert.equal(v.stack, undefined);
  assert.equal(v.internalPath, undefined);
});

test("a malformed response returns null rather than a partially-trusted object", () => {
  assert.equal(validateCanonicalReceiveResponse(null), null);
  assert.equal(validateCanonicalReceiveResponse(res({ outcome: "maybe" })), null);
  assert.equal(validateCanonicalReceiveResponse(res({ derivedState: "SORT_OF" })), null);
  assert.equal(validateCanonicalReceiveResponse(res({ lines: [] })), null);
  assert.equal(validateCanonicalReceiveResponse(res({ receivingId: "" })), null);
});

test("a negative or missing line quantity makes the whole response invalid", () => {
  assert.equal(validateCanonicalReceiveResponse(res({ lines: [{ lineId: "L1", partId: "P1", orderedQuantity: 5, previouslyReceived: -1, receivedNow: 2, remainingQuantity: 2, state: "RECEIVED" }] })), null);
  assert.equal(validateCanonicalReceiveResponse(res({ lines: [{ lineId: "L1", partId: "P1", orderedQuantity: 5, receivedNow: 2, remainingQuantity: 2, state: "RECEIVED" }] })), null);
});

test("storedStatus may be null — a legacy source has no canonical PO status", () => {
  assert.ok(validateCanonicalReceiveResponse(res({ storedStatus: null })));
});
