// EI Phase-2 Receiving, Phase A -- OFFLINE unit tests for the INERT receiving foundation
// (functions/src/inventoryReceiving/*). Pure/inert: NO emulator, NO network, NO production, NO callable.
// Runs the COMPILED output (../lib).
//
// Run: npm run build && node test/inventoryReceivingFoundation.test.mjs  (see package.json test:inventoryReceiving)
import assert from "node:assert/strict";

const T = await import("../lib/inventoryReceiving/receivingTypes.js");
const V = await import("../lib/inventoryReceiving/receivingValidation.js");
const R = await import("../lib/inventoryReceiving/receivingRepository.js");

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}

const AUTH = { part: { partId: "P1", trackingMode: "NONE" }, orderedQuantity: 5 };
const actor = { kind: "USER", id: "u1" };
const now = new Date(1_700_000_000_000);
const loc = { type: "WAREHOUSE", locationId: "WH-1" };
const src = { type: "REORDER_PURCHASE_ORDER", reorderRequestId: "RR-1", purchaseOrderId: "RR-1" };
const line = (over = {}) => ({ lineId: "L1", partId: "P1", expectedQuantity: 5, receivedQuantity: 5, ...over });
// `over.line` overrides the single line; all other keys override the top-level input object.
const input = (over = {}) => {
  const { line: lineOver, ...top } = over;
  return { source: src, receivingLocation: loc, lines: [line(lineOver || {})], idempotencyKey: "idem-00000001", ...top };
};

function makeStore() {
  const docs = new Map();
  let creates = 0;
  return { docs, get creates() { return creates; }, async read(id) { return docs.has(id) ? docs.get(id) : null; }, create(id, data) { if (docs.has(id)) throw new Error("exists"); docs.set(id, data); creates += 1; } };
}

// ---- valid round-trip -------------------------------------------------------------------------
await check("valid NONE single-line order validates -> PUTAWAY_COMPLETE version 1, one RECEIVED line", () => {
  const r = V.validateReceivingOrderInput(input(), AUTH);
  assert.equal(r.valid, true, r.reason);
  assert.equal(r.value.status, "PUTAWAY_COMPLETE");
  assert.equal(r.value.version, 1);
  assert.equal(r.value.lines.length, 1);
  assert.deepEqual(r.value.lines[0], { lineId: "L1", partId: "P1", trackingMode: "NONE", expectedQuantity: 5, receivedQuantity: 5, status: "RECEIVED" });
});

await check("serialize -> deserialize round-trips value + server-authored fields (millis, no Timestamp leak)", () => {
  const v = V.validateReceivingOrderInput(input(), AUTH).value;
  const data = R.serializeReceivingOrder(v, actor, now, R.fingerprintReceivingOrder(v));
  assert.equal(data.status, "PUTAWAY_COMPLETE");
  assert.equal(data.createdAt.constructor.name, "Timestamp");
  const back = R.deserializeReceivingOrder(data);
  assert.deepEqual(back.value, v);
  assert.equal(back.createdAt, now.getTime());
  assert.equal(typeof back.createdAt, "number");
  assert.deepEqual(back.actor, actor);
});

// ---- server fields rejected in input ----------------------------------------------------------
await check("caller-supplied server fields are rejected (unknown_field)", () => {
  for (const bad of [{ actor }, { version: 1 }, { status: "PUTAWAY_COMPLETE" }, { createdAt: 1 }, { receivingId: "x" }, { schemaVersion: 1 }]) {
    assert.equal(V.validateReceivingOrderInput({ ...input(), ...bad }, AUTH).reason, "unknown_field", JSON.stringify(bad));
  }
  // server fields on the line rejected too
  assert.equal(V.validateReceivingOrderInput(input({ line: { status: "RECEIVED" } }), AUTH).reason, "line_unknown_field");
  assert.equal(V.validateReceivingOrderInput(input({ line: { trackingMode: "NONE" } }), AUTH).reason, "line_unknown_field");
});

// ---- missing/unknown/malformed ----------------------------------------------------------------
await check("missing/unknown/malformed fields fail closed", () => {
  assert.equal(V.validateReceivingOrderInput(42, AUTH).reason, "not_object");
  assert.equal(V.validateReceivingOrderInput({ ...input(), extra: 1 }, AUTH).reason, "unknown_field");
  assert.equal(V.validateReceivingOrderInput({ ...input(), source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: "RR-1" } }, AUTH).reason, "purchase_order_id_invalid");
  assert.equal(V.validateReceivingOrderInput({ ...input(), source: { ...src, stray: 1 } }, AUTH).reason, "source_invalid");
  assert.equal(V.validateReceivingOrderInput({ ...input(), source: { ...src, type: "PURCHASE_ORDER" } }, AUTH).reason, "source_type_invalid");
  assert.equal(V.validateReceivingOrderInput({ ...input(), source: { ...src, purchaseOrderId: "OTHER" } }, AUTH).reason, "source_identity_mismatch");
  assert.equal(V.validateReceivingOrderInput({ ...input(), receivingLocation: { type: "NOPE", locationId: "x" } }, AUTH).reason, "receiving_location_invalid");
  assert.equal(V.validateReceivingOrderInput({ ...input(), idempotencyKey: "" }, AUTH).reason, "idempotency_key_invalid");
});

// ---- quantity rules ---------------------------------------------------------------------------
await check("zero/negative/non-finite/partial/over/under quantities rejected", () => {
  for (const q of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "5"]) {
    const reason = V.validateReceivingOrderInput(input({ line: { receivedQuantity: q } }), AUTH).reason;
    assert.ok(["quantity_invalid", "received_quantity_mismatch"].includes(reason), `q=${q} -> ${reason}`);
  }
  assert.equal(V.validateReceivingOrderInput(input({ line: { receivedQuantity: 3 } }), AUTH).reason, "received_quantity_mismatch"); // under
  assert.equal(V.validateReceivingOrderInput(input({ line: { receivedQuantity: 9 } }), AUTH).reason, "received_quantity_mismatch"); // over
  assert.equal(V.validateReceivingOrderInput(input({ line: { expectedQuantity: 3 } }), AUTH).reason, "expected_quantity_mismatch");
});

// ---- line count + part identity ---------------------------------------------------------------
await check("empty / multiple lines and part mismatch rejected", () => {
  assert.equal(V.validateReceivingOrderInput({ ...input(), lines: [] }, AUTH).reason, "line_count_invalid");
  assert.equal(V.validateReceivingOrderInput({ ...input(), lines: [line(), line({ lineId: "L2" })] }, AUTH).reason, "line_count_invalid");
  assert.equal(V.validateReceivingOrderInput(input({ line: { partId: "OTHER" } }), AUTH).reason, "part_mismatch");
});

// ---- SERIAL supported (Wave 7 Owner decision) / LOT still deferred -----------------------------
//
// This check previously asserted that SERIAL *and* LOT both failed closed. The Owner authorized SERIAL
// intake through the existing Receiving authority (docs/releases/serialized-asset-registry-slice-b-boundary.md),
// so the SERIAL half is restated rather than deleted: SERIAL is now accepted, and its own rules are
// asserted below. LOT's deferral is unchanged and still locked here.
const SERIAL_AUTH = { ...AUTH, part: { partId: "P1", trackingMode: "SERIAL" } };
const serialLine = (over = {}) => line({ serialNumbers: ["SN-1", "SN-2", "SN-3", "SN-4", "SN-5"], ...over });
const serialInput = (over = {}) => input({ line: serialLine(over) });

await check("LOT still fails closed (tracking_mode_unsupported)", () => {
  assert.equal(V.validateReceivingOrderInput(input(), { ...AUTH, part: { partId: "P1", trackingMode: "LOT" } }).reason, "tracking_mode_unsupported");
  // An unrecognized mode is not silently treated as NONE either.
  assert.equal(V.validateReceivingOrderInput(input(), { ...AUTH, part: { partId: "P1", trackingMode: "WHATEVER" } }).reason, "tracking_mode_invalid");
});

await check("SERIAL: a valid receipt carries one serial per received unit", () => {
  const r = V.validateReceivingOrderInput(serialInput(), SERIAL_AUTH);
  assert.equal(r.valid, true, r.reason);
  assert.deepEqual(r.value.lines[0], {
    lineId: "L1", partId: "P1", trackingMode: "SERIAL",
    expectedQuantity: 5, receivedQuantity: 5, status: "RECEIVED",
    serialNumbers: ["SN-1", "SN-2", "SN-3", "SN-4", "SN-5"],
  });
});

await check("SERIAL: missing, miscounted, malformed or duplicated serials all fail closed", () => {
  assert.equal(V.validateReceivingOrderInput(input(), SERIAL_AUTH).reason, "serial_numbers_missing");
  assert.equal(V.validateReceivingOrderInput(serialInput({ serialNumbers: ["SN-1"] }), SERIAL_AUTH).reason, "serial_count_mismatch");
  assert.equal(V.validateReceivingOrderInput(serialInput({ serialNumbers: ["SN-1", "SN-2", "SN-3", "SN-4", "SN-5", "SN-6"] }), SERIAL_AUTH).reason, "serial_count_mismatch");
  assert.equal(V.validateReceivingOrderInput(serialInput({ serialNumbers: ["SN-1", "SN-2", "SN-3", "SN-4", ""] }), SERIAL_AUTH).reason, "serial_number_invalid");
  assert.equal(V.validateReceivingOrderInput(serialInput({ serialNumbers: ["SN-1", "SN-2", "SN-3", "SN-4", 5] }), SERIAL_AUTH).reason, "serial_number_invalid");
  assert.equal(V.validateReceivingOrderInput(serialInput({ serialNumbers: ["SN-1", "SN-1", "SN-3", "SN-4", "SN-5"] }), SERIAL_AUTH).reason, "serial_numbers_duplicated");
});

await check("SERIAL: serials are trimmed but NOT case-folded (serial identity is case-significant)", () => {
  const r = V.validateReceivingOrderInput(serialInput({ serialNumbers: ["  SN-1 ", "sn-1", "SN-3", "SN-4", "SN-5"] }), SERIAL_AUTH);
  assert.equal(r.valid, true, r.reason);
  // "  SN-1 " trims to "SN-1"; "sn-1" stays distinct from it rather than colliding.
  assert.deepEqual(r.value.lines[0].serialNumbers, ["SN-1", "sn-1", "SN-3", "SN-4", "SN-5"]);
});

await check("NONE: a serialNumbers key is REJECTED (a NONE line has no serial identity)", () => {
  assert.equal(V.validateReceivingOrderInput(input({ line: line({ serialNumbers: ["SN-1"] }) }), AUTH).reason, "serial_numbers_not_allowed");
});

await check("SERIAL: serialize -> deserialize round-trips the serials; a tampered stored line fails closed", () => {
  const v = V.validateReceivingOrderInput(serialInput(), SERIAL_AUTH).value;
  const data = R.serializeReceivingOrder(v, actor, now, R.fingerprintReceivingOrder(v));
  assert.deepEqual(R.deserializeReceivingOrder(data).value, v);

  const dropped = { ...data, lines: [{ ...data.lines[0], serialNumbers: undefined }] };
  delete dropped.lines[0].serialNumbers;
  assert.throws(() => R.deserializeReceivingOrder(dropped), /serialNumbers/);

  const miscounted = { ...data, lines: [{ ...data.lines[0], serialNumbers: ["SN-1"] }] };
  assert.throws(() => R.deserializeReceivingOrder(miscounted), /count/);

  const duped = { ...data, lines: [{ ...data.lines[0], serialNumbers: ["SN-1", "SN-1", "SN-3", "SN-4", "SN-5"] }] };
  assert.throws(() => R.deserializeReceivingOrder(duped), /duplicates/);

  // A NONE line that somehow acquired serials is malformed too.
  const noneValue = V.validateReceivingOrderInput(input(), AUTH).value;
  const noneData = R.serializeReceivingOrder(noneValue, actor, now, R.fingerprintReceivingOrder(noneValue));
  const noneWithSerials = { ...noneData, lines: [{ ...noneData.lines[0], serialNumbers: ["SN-1"] }] };
  assert.throws(() => R.deserializeReceivingOrder(noneWithSerials), /must not carry serialNumbers/);
});

await check("SERIAL: the same key with DIFFERENT serials is a conflict, not a replay", () => {
  // Serials are part of the fingerprinted request value, so swapping one cannot masquerade as a retry.
  const a = V.validateReceivingOrderInput(serialInput(), SERIAL_AUTH).value;
  const b = V.validateReceivingOrderInput(serialInput({ serialNumbers: ["SN-1", "SN-2", "SN-3", "SN-4", "SN-9"] }), SERIAL_AUTH).value;
  assert.notEqual(R.fingerprintReceivingOrder(a), R.fingerprintReceivingOrder(b));
});

// ---- idempotency ------------------------------------------------------------------------------
await check("exact idempotent replay creates no duplicate", async () => {
  const store = makeStore();
  const a = await R.stageReceivingOrder(store, input(), AUTH, { actor, now });
  const b = await R.stageReceivingOrder(store, input(), AUTH, { actor, now });
  assert.equal(a.outcome, "applied");
  assert.equal(b.outcome, "replayed");
  assert.equal(a.receivingId, b.receivingId);
  assert.equal(store.creates, 1);
  assert.equal(store.docs.size, 1);
});

await check("same key with a changed payload conflicts (nothing new staged)", async () => {
  const store = makeStore();
  await R.stageReceivingOrder(store, input(), AUTH, { actor, now });
  // different receivingLocation, same idempotencyKey -> different fingerprint
  const changed = { ...input(), receivingLocation: { type: "MOBILE", locationId: "1" } };
  const changedAuth = AUTH; // ordered qty 5 still binds
  await assert.rejects(
    R.stageReceivingOrder(store, changed, changedAuth, { actor, now }),
    (e) => e instanceof T.IdempotencyConflictError && e.code === "IDEMPOTENCY_CONFLICT",
  );
  assert.equal(store.creates, 1);
});

// ---- malformed stored record ------------------------------------------------------------------
await check("malformed stored record rejected on deserialize + on replay", async () => {
  const v = V.validateReceivingOrderInput(input(), AUTH).value;
  const good = R.serializeReceivingOrder(v, actor, now, R.fingerprintReceivingOrder(v));
  assert.throws(() => R.deserializeReceivingOrder({ ...good, stray: 1 }), (e) => e instanceof T.MalformedStoredRecordError);
  assert.throws(() => R.deserializeReceivingOrder({ ...good, version: 2 }), /version/);
  assert.throws(() => R.deserializeReceivingOrder({ ...good, status: "EXPECTED" }), /status/);
  assert.throws(() => R.deserializeReceivingOrder({ ...good, createdAt: 123 }), /Timestamp/);
  assert.throws(() => R.deserializeReceivingOrder({ ...good, fingerprint: "nope" }), /fingerprint/);
  assert.throws(() => R.deserializeReceivingOrder(null), (e) => e instanceof T.MalformedStoredRecordError);
  // replay path: a malformed existing doc at the derived id -> MalformedStoredRecordError, no write
  const store = makeStore();
  const docId = R.receivingOrderDocId(v.idempotencyKey);
  store.docs.set(docId, { ...good, fingerprint: "0000000000000000" }); // valid-format wrong fingerprint
  await assert.rejects(R.stageReceivingOrder(store, input(), AUTH, { actor, now }), (e) => e instanceof T.MalformedStoredRecordError);
  assert.equal(store.creates, 0);
});

// ---- P2-1: stored receivingId identity --------------------------------------------------------
await check("stored record carries receivingId == doc id == derived; round-trip exposes it", () => {
  const v = V.validateReceivingOrderInput(input(), AUTH).value;
  const data = R.serializeReceivingOrder(v, actor, now, R.fingerprintReceivingOrder(v));
  const docId = R.receivingOrderDocId(v.idempotencyKey);
  assert.equal(data.receivingId, docId);
  assert.match(data.receivingId, /^rcv_[0-9a-f]{40}$/);
  const back = R.deserializeReceivingOrder(data);
  assert.equal(back.receivingId, docId);
});

await check("missing / malformed / wrong-path receivingId -> MalformedStoredRecordError", () => {
  const v = V.validateReceivingOrderInput(input(), AUTH).value;
  const good = R.serializeReceivingOrder(v, actor, now, R.fingerprintReceivingOrder(v));
  const { receivingId, ...noId } = good;
  assert.throws(() => R.deserializeReceivingOrder(noId), /receivingId|unknown field/);
  assert.throws(() => R.deserializeReceivingOrder({ ...good, receivingId: "not-path-safe" }), /receivingId/);
  assert.throws(() => R.deserializeReceivingOrder({ ...good, receivingId: R.receivingOrderDocId("some-other-key") }), /receivingId does not agree/);
});

await check("replay: stored receivingId not matching its doc id -> MalformedStoredRecordError, zero writes", async () => {
  const v = V.validateReceivingOrderInput(input(), AUTH).value;
  const docId = R.receivingOrderDocId(v.idempotencyKey);
  // a self-consistent record for a DIFFERENT key, placed at this key's doc id
  const other = V.validateReceivingOrderInput({ ...input(), idempotencyKey: "idem-99999999" }, AUTH).value;
  const otherDoc = R.serializeReceivingOrder(other, actor, now, R.fingerprintReceivingOrder(other));
  const store = makeStore();
  store.docs.set(docId, otherDoc);
  await assert.rejects(R.stageReceivingOrder(store, input(), AUTH, { actor, now }), (e) => e instanceof T.MalformedStoredRecordError);
  assert.equal(store.creates, 0);
});

// ---- P2-2: server-metadata coherence ----------------------------------------------------------
await check("incoherent server metadata (createdBy/updatedBy != actor.id, or createdAt != updatedAt) -> Malformed", () => {
  const v = V.validateReceivingOrderInput(input(), AUTH).value;
  const good = R.serializeReceivingOrder(v, actor, now, R.fingerprintReceivingOrder(v));
  assert.throws(() => R.deserializeReceivingOrder({ ...good, createdBy: "B" }), /createdBy/);
  assert.throws(() => R.deserializeReceivingOrder({ ...good, updatedBy: "C" }), /updatedBy/);
  assert.throws(() => R.deserializeReceivingOrder({ ...good, actor: { kind: "USER", id: "OTHER" } }), /createdBy|updatedBy/);
  const later = R.serializeReceivingOrder(v, actor, new Date(now.getTime() + 1000), R.fingerprintReceivingOrder(v));
  assert.throws(() => R.deserializeReceivingOrder({ ...good, updatedAt: later.updatedAt }), /same instant/);
});

await check("replay against a metadata-incoherent stored record -> Malformed, zero writes", async () => {
  const v = V.validateReceivingOrderInput(input(), AUTH).value;
  const docId = R.receivingOrderDocId(v.idempotencyKey);
  const good = R.serializeReceivingOrder(v, actor, now, R.fingerprintReceivingOrder(v));
  const store = makeStore();
  store.docs.set(docId, { ...good, createdBy: "MISMATCH" });
  await assert.rejects(R.stageReceivingOrder(store, input(), AUTH, { actor, now }), (e) => e instanceof T.MalformedStoredRecordError);
  assert.equal(store.creates, 0);
});

// ---- no stage/write after any validation failure ----------------------------------------------
await check("invalid input throws before any create; invalid actor/deps rejected", async () => {
  const store = makeStore();
  await assert.rejects(R.stageReceivingOrder(store, input({ line: { receivedQuantity: 9 } }), AUTH, { actor, now }), (e) => e instanceof T.InvalidReceivingError);
  assert.equal(store.creates, 0);
  await assert.rejects(R.stageReceivingOrder(store, input(), AUTH, { actor: { kind: "ROBOT", id: "x" }, now }), (e) => e instanceof T.InvalidReceivingError);
  await assert.rejects(R.stageReceivingOrder(store, input(), AUTH, { actor, now: new Date(Number.NaN) }), (e) => e instanceof T.InvalidReceivingError);
  assert.equal(store.creates, 0);
});

await check("a store whose create fails stages no partial order and rejects", async () => {
  const throwing = { async read() { return null; }, create() { throw new Error("txn-abort"); } };
  await assert.rejects(R.stageReceivingOrder(throwing, input(), AUTH, { actor, now }), /txn-abort/);
});

// ---- deterministic identity/fingerprint + non-mutation ----------------------------------------
await check("deterministic receivingId + fingerprint; inputs not mutated", () => {
  const i = input();
  const snap = JSON.stringify(i);
  const v1 = V.validateReceivingOrderInput(i, AUTH).value;
  const v2 = V.validateReceivingOrderInput(i, AUTH).value;
  assert.deepEqual(v1, v2);
  assert.equal(R.fingerprintReceivingOrder(v1), R.fingerprintReceivingOrder(v2));
  assert.equal(R.receivingOrderDocId("idem-00000001"), R.receivingOrderDocId("idem-00000001"));
  assert.match(R.receivingOrderDocId("idem-00000001"), /^rcv_[0-9a-f]{40}$/);
  assert.equal(JSON.stringify(i), snap, "input not mutated");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
