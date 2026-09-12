// CYCLE COUNT EXPECTED QUANTITY -- a ledger that nets NEGATIVE is a data-integrity signal, never a zero.
//
// THE DEFECT THIS PINS. computeExpectedQuantityThroughTxn ended with `return Math.max(onHand, 0)`.
// The sign itself was already correct -- it comes from inventoryLedger/locationOnHand.ts, the ONE
// sign authority, and that routing is exactly what fixed the earlier double-subtraction of
// WORK_ORDER_CONSUMPTION. The floor undid part of that care one line later.
//
// A movement set that nets negative at a location says one thing: the ledger is WRONG. Some row is
// missing, duplicated, or misattributed. Clamping that to 0 does not make it right -- it makes the
// count blind. Every unit the counter physically finds then reads as SURPLUS against an expected 0,
// reconciliation posts an ADJUSTED for the whole counted quantity, and the correction is derived
// from a number the system already knew was impossible. The ledger is then "corrected" toward a
// figure that was invented by a clamp.
//
// The floor was also not free to simply delete: cycleCountRepository.ts:161 and
// cycleCountSheetRepository.ts:206 both REJECT a negative stored expectedQuantity as a malformed
// record. Writing one would brick the count document -- unreadable, and therefore not even
// cancellable. So the impossible state is refused at computation time instead, with the existing
// sanitized CycleCountIntegrityError. The stored contract (non-negative integer) is preserved
// because a count with an impossible expected quantity is never created at all.
//
// OFFLINE. No emulator, no network, no Firestore: `txn` and `db` are fakes that replay a fixed row
// set, which is all this function reads. Runs the COMPILED output (../lib).
//
// Run: npm run build && node --test functions/test/cycleCountExpectedQuantityIntegrity.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { Timestamp } from "firebase-admin/firestore";

const { computeExpectedQuantityThroughTxn } = await import("../lib/cycleCount/cycleCountExpectedQuantity.js");
const { CycleCountIntegrityError } = await import("../lib/cycleCount/cycleCountTypes.js");
const { signedQuantity } = await import("../lib/inventoryLedger/locationOnHand.js");

const NOW = 1_700_000_000_000;
const PART = "PRT-9001";
const AT = { type: "WAREHOUSE", locationId: "wh-main" };
const ELSEWHERE = { type: "WAREHOUSE", locationId: "wh-north" };

const DIRECTION = {
  RECEIVED: "IN", RETURNED: "IN", TRANSFER_IN: "IN", RELOCATION_IN: "IN",
  TRANSFER_OUT: "OUT", SCRAPPED: "OUT", RELOCATION_OUT: "OUT",
  ADJUSTED: "SIGNED", WORK_ORDER_CONSUMPTION: "SIGNED",
};
const SOURCE = {
  RECEIVED: "RECEIVING_ORDER", RETURNED: "RMA", TRANSFER_OUT: "TRANSFER_ORDER", TRANSFER_IN: "TRANSFER_ORDER",
  ADJUSTED: "ADJUSTMENT", SCRAPPED: "SCRAP", WORK_ORDER_CONSUMPTION: "WORK_ORDER",
  RELOCATION_OUT: "STOCK_RELOCATION", RELOCATION_IN: "STOCK_RELOCATION",
};
const PAIRED = new Set(["TRANSFER_OUT", "TRANSFER_IN", "RELOCATION_OUT", "RELOCATION_IN"]);

let seq = 0;
/** A well-formed STORED operational row -- exactly what deserializeOperationalMovement accepts. */
const row = (type, quantity, location = AT) => {
  seq += 1;
  return {
    schemaVersion: 2, type, direction: DIRECTION[type], partId: PART, trackingMode: "NONE",
    location, quantity,
    sourceObject: { type: SOURCE[type], id: `src-${seq}` },
    idempotencyKey: `idem-${seq}`,
    actor: { kind: "SYSTEM", id: "WORK_ORDER_TRANSITION" },
    occurredAt: NOW, recordedAt: Timestamp.fromMillis(NOW), fingerprint: "0".repeat(16),
    ...(PAIRED.has(type) ? { counterpartyLocation: location === AT ? ELSEWHERE : AT } : {}),
  };
};
/** A LEGACY Work-Order reservation row: no schemaVersion, no location. */
const legacy = (type, quantity) => ({ type, quantity, partId: PART, workOrderId: "wo-1" });

// The only two things this function asks of Firestore: one where() query, one txn.get() of it.
const fakeDb = (docs) => ({ collection: () => ({ where: () => ({ docs }) }) });
const fakeTxn = { get: async (q) => ({ docs: q.docs.map((d) => ({ data: () => d })) }) };
const expected = (docs, location = AT) => computeExpectedQuantityThroughTxn(fakeTxn, fakeDb(docs), PART, location);

// ---------------------------------------------------------------- the harness proves itself first
test("the fake txn/db really drives the real function (a plain receipt reads through)", async () => {
  assert.equal(await expected([row("RECEIVED", 7)]), 7);
});

test("the sign still comes from the ONE authority, not from this file", async () => {
  // Not a restatement of the rule -- a cross-check that the function's answer IS the authority's sum.
  const rows = [row("RECEIVED", 10), row("WORK_ORDER_CONSUMPTION", -3), row("TRANSFER_OUT", 2), row("ADJUSTED", -1)];
  const authority = rows.reduce((s, r) => s + signedQuantity(r), 0);
  assert.equal(authority, 4);
  assert.equal(await expected(rows), authority);
});

// ---------------------------------------------------------------------------- THE DEFECT ITSELF
test("a ledger that nets NEGATIVE is refused, not clamped to zero", async () => {
  // Physically impossible: more left this location than ever arrived. Some row is missing or wrong.
  const rows = [row("RECEIVED", 2), row("ADJUSTED", -5)];
  assert.equal(rows.reduce((s, r) => s + signedQuantity(r), 0), -3, "the row set really does net negative");
  await assert.rejects(() => expected(rows), (err) => {
    assert.ok(err instanceof CycleCountIntegrityError, `expected CycleCountIntegrityError, got ${err?.name}`);
    assert.equal(err.code, "CYCLE_COUNT_INTEGRITY");
    return true;
  });
});

test("the consumption case the sign authority exists for: a lost receipt, not a surplus", async () => {
  // Decision #171 made WORK_ORDER_CONSUMPTION physical. If the receipt that put the part here was
  // never written, the consumption alone nets negative. Reading that as "expected 0" would make
  // every unit actually on the shelf a surplus, and reconciliation would post an ADJUSTED for it.
  await assert.rejects(() => expected([row("WORK_ORDER_CONSUMPTION", -4)]), CycleCountIntegrityError);
});

test("the error names the location and the impossible figure, and leaks nothing else", async () => {
  const err = await expected([row("ADJUSTED", -9)]).catch((e) => e);
  assert.ok(err instanceof CycleCountIntegrityError);
  assert.match(err.message, /-9/);
  assert.match(err.message, /wh-main/);
  assert.doesNotMatch(err.message, /idem-|src-|fingerprint/, "no ledger identifiers in a sanitized message");
});

// ------------------------------------------------------------------ what must NOT change with it
test("zero is still zero -- an empty or fully-netted location is not an integrity failure", async () => {
  assert.equal(await expected([]), 0);
  assert.equal(await expected([row("RECEIVED", 3), row("TRANSFER_OUT", 3)]), 0);
});

test("a negative total ELSEWHERE does not fail a count at this location", async () => {
  // The refusal is scoped to the location being counted, exactly as the sum is.
  assert.equal(await expected([row("RECEIVED", 5), row("ADJUSTED", -9, ELSEWHERE)]), 5);
});

test("legacy and malformed rows are still skipped, and still cannot push the total negative", async () => {
  // A commitment is not physical stock; a malformed row is not trusted. Neither may manufacture an
  // integrity failure out of a location that is genuinely fine.
  assert.equal(await expected([row("RECEIVED", 4), legacy("RESERVED", 99), { schemaVersion: 2, type: "NONSENSE" }]), 4);
});

test("a corrupt negative receipt contributes nothing rather than turning the count negative", async () => {
  // signedQuantity's own rule: an IN/OUT row must be a positive magnitude. A corrupt one is dropped,
  // so this is a 4, not a -1 refusal and not a manufactured 6.
  assert.equal(await expected([row("RECEIVED", 4), { ...row("RECEIVED", 1), quantity: -2 }]), 4);
});
