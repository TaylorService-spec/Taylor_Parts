// DQ-027: client ledger-row integrity partition. Pure. (Verdict parity with the server's strict reader is
// pinned by functions/test/ledgerRowIntegrityParity.test.mjs.)
import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyLedgerRow, partitionLedgerIntegrity, LEDGER_INTEGRITY_STATE, LedgerIntegrityError,
} from "../src/domain/ledgerRowIntegrity.js";

const ts = { toMillis: () => 1_700_000_000_000 };
const good = (partId, over = {}) => ({
  schemaVersion: 2, type: "RECEIVED", direction: "IN", partId, trackingMode: "NONE",
  location: { type: "WAREHOUSE", locationId: "wh" }, quantity: 3, sourceObject: { type: "RECEIVING_ORDER", id: `s-${partId}` },
  idempotencyKey: `k-${partId}`, actor: { kind: "USER", id: "u" }, occurredAt: 1_700_000_000_000, recordedAt: ts,
  fingerprint: "0123456789abcdef", ...over,
});

test("verdicts: operational, legacy, unreadable", () => {
  assert.equal(classifyLedgerRow(good("A")), "operational");
  assert.equal(classifyLedgerRow({ type: "RESERVED", partId: "A", quantity: 1 }), "legacy");
  assert.equal(classifyLedgerRow(good("A", { quantity: "3" })), "unreadable");
  assert.equal(classifyLedgerRow({ partId: "A", type: "RECEIVED", quantity: 3 }), "unreadable");
});

test("COMPLETE: nothing unreadable, every row kept", () => {
  const p = partitionLedgerIntegrity([good("A"), good("B"), { type: "RESERVED", partId: "A", quantity: 1 }]);
  assert.equal(p.state, LEDGER_INTEGRITY_STATE.COMPLETE);
  assert.equal(p.readable.length, 3);
  assert.deepEqual(p.unavailablePartIds, []);
  assert.equal(p.reason, null);
});

test("INCOMPLETE: the affected part is LISTED and all of its rows withheld; other parts untouched", () => {
  const p = partitionLedgerIntegrity([good("A"), good("B"), good("B", { quantity: -9 }), { type: "RESERVED", partId: "B", quantity: 1 }]);
  assert.equal(p.state, LEDGER_INTEGRITY_STATE.INCOMPLETE);
  assert.deepEqual(p.unavailablePartIds, ["B"]);
  assert.deepEqual(p.readable.map((r) => r.partId), ["A"], "no partial B figure can be computed from B's readable rows");
  assert.equal(p.reason, "LEDGER_ROW_UNREADABLE");
});

test("UNAVAILABLE: an unreadable row naming no part leaves nothing trustworthy", () => {
  const p = partitionLedgerIntegrity([good("A"), { schemaVersion: 2, type: "TRANSFER_OUT", quantity: 1 }]);
  assert.equal(p.state, LEDGER_INTEGRITY_STATE.UNAVAILABLE);
  assert.deepEqual(p.readable, []);
  assert.equal(p.unattributableRows, 1);
  const err = new LedgerIntegrityError(p);
  assert.equal(err.code, "LEDGER_ROW_UNREADABLE");
  assert.match(err.message, /unavailable/i);
});
