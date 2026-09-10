// Ownership Model v1 fields on stored records -- the strict readers accept EXACTLY the shapes the
// Owner-authorized ownership backfill writes (ownershipBackfillRules.ts), and nothing else.
//
// The defect this pins: the 2026-08-30 sandbox backfill stamped operatingCompanyId (or a participating
// source/destination pair) onto ledger rows, transfer orders and receiving orders. Each strict
// deserializer rejected the field as "unknown", and every on-hand reader SKIPS a malformed row -- so
// sandbox stock was silently understated (39 of 41 ledger rows at one warehouse).
//
// Run: node test/ownershipFieldStrictReaders.test.mjs   (pure; no emulator)
import assert from "node:assert/strict";

const L = await import("../lib/inventoryLedger/operationalMovementRepository.js");
const LV = await import("../lib/inventoryLedger/operationalMovementValidation.js");
const T = await import("../lib/inventoryTransfer/transferOrderRepository.js");
const R = await import("../lib/inventoryReceiving/receivingRepository.js");
const RV = await import("../lib/inventoryReceiving/receivingValidation.js");

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}
const now = new Date(1_700_000_000_000);
const actor = { kind: "USER", id: "u1" };
const malformed = /malformed|invalid|incomplete|both/i;

// ---------------------------------------------------------------- ledger
const ledgerRow = (type, extra = {}) => {
  const ev = {
    type, partId: "P1", location: { type: "WAREHOUSE", locationId: "WH-1" }, quantity: 2,
    sourceObject: type === "RECEIVED" ? { type: "RECEIVING_ORDER", id: "RO-1" } : { type: "TRANSFER_ORDER", id: "TO-1" },
    idempotencyKey: `idem-${type}-0001`, actor, occurredAt: 1000,
    ...(type.startsWith("TRANSFER") ? { counterpartyLocation: { type: "WAREHOUSE", locationId: "WH-2" } } : {}),
  };
  const v = LV.validateOperationalMovementEvent(ev, { partId: "P1", trackingMode: "NONE" });
  assert.equal(v.valid, true, v.reason);
  return { ...L.serializeOperationalMovement(v.value, now, L.fingerprintMovement(v.value)), ...extra };
};

await check("ledger: a scalar operatingCompanyId (the backfill's single-location shape) is readable", () => {
  const back = L.deserializeOperationalMovement(ledgerRow("RECEIVED", { operatingCompanyId: "taylor" }));
  assert.equal(back.value.quantity, 2);
});
await check("ledger: a participating pair on a transfer row is readable", () => {
  L.deserializeOperationalMovement(ledgerRow("TRANSFER_OUT", { sourceOperatingCompanyId: "taylor", destinationOperatingCompanyId: "ventana" }));
});
await check("ledger: the pair is refused on a single-location row, half a pair is refused, scalar+pair is refused", () => {
  assert.throws(() => L.deserializeOperationalMovement(ledgerRow("RECEIVED", { sourceOperatingCompanyId: "taylor", destinationOperatingCompanyId: "ventana" })), malformed);
  assert.throws(() => L.deserializeOperationalMovement(ledgerRow("TRANSFER_OUT", { sourceOperatingCompanyId: "taylor" })), malformed);
  assert.throws(() => L.deserializeOperationalMovement(ledgerRow("TRANSFER_OUT", { operatingCompanyId: "taylor", sourceOperatingCompanyId: "taylor", destinationOperatingCompanyId: "ventana" })), malformed);
});
await check("ledger: a malformed company id and any other unknown field still fail closed", () => {
  assert.throws(() => L.deserializeOperationalMovement(ledgerRow("RECEIVED", { operatingCompanyId: "Taylor Freezer" })), malformed);
  assert.throws(() => L.deserializeOperationalMovement(ledgerRow("RECEIVED", { stray: 1 })), malformed);
});

// ---------------------------------------------------------------- transfer orders
const transferDoc = (extra = {}) => {
  const value = {
    partId: "P1", trackingMode: "NONE", quantity: 2,
    origin: { type: "WAREHOUSE", locationId: "WH-1" }, destination: { type: "WAREHOUSE", locationId: "WH-2" },
    idempotencyKey: "idem-transfer-0001",
  };
  return { ...T.serializeTransferOrder(value, actor, now, T.fingerprintTransferOrder(value), "TO-2026-000001"), ...extra };
};
const transferId = T.transferOrderDocId("idem-transfer-0001");

await check("transfer: the participating pair is readable; the record without it still is", () => {
  T.deserializeTransferOrder(transferId, transferDoc());
  T.deserializeTransferOrder(transferId, transferDoc({ sourceOperatingCompanyId: "taylor", destinationOperatingCompanyId: "taylor" }));
});
await check("transfer: half a pair, a scalar owner, or a malformed id fail closed", () => {
  assert.throws(() => T.deserializeTransferOrder(transferId, transferDoc({ sourceOperatingCompanyId: "taylor" })), malformed);
  assert.throws(() => T.deserializeTransferOrder(transferId, transferDoc({ operatingCompanyId: "taylor" })), malformed);
  assert.throws(() => T.deserializeTransferOrder(transferId, transferDoc({ sourceOperatingCompanyId: "taylor", destinationOperatingCompanyId: "NOT OK" })), malformed);
});

// ---------------------------------------------------------------- receiving orders
const receivingDoc = (extra = {}) => {
  const v = RV.validateReceivingOrderInput({
    source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: "RR-1", purchaseOrderId: "RR-1" },
    receivingLocation: { type: "WAREHOUSE", locationId: "WH-1" },
    lines: [{ lineId: "L1", partId: "P1", expectedQuantity: 5, receivedQuantity: 5 }],
    idempotencyKey: "idem-00000001",
  }, { part: { partId: "P1", trackingMode: "NONE" }, orderedQuantity: 5 }).value;
  return { ...R.serializeReceivingOrder(v, actor, now, R.fingerprintReceivingOrder(v)), ...extra };
};

await check("receiving: a scalar operatingCompanyId is readable; a malformed one and a pair are not", () => {
  R.deserializeReceivingOrder(receivingDoc({ operatingCompanyId: "taylor" }));
  assert.throws(() => R.deserializeReceivingOrder(receivingDoc({ operatingCompanyId: "x y" })), malformed);
  assert.throws(() => R.deserializeReceivingOrder(receivingDoc({ sourceOperatingCompanyId: "taylor" })), malformed);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
