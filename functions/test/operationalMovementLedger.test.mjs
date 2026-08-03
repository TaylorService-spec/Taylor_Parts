// EI-P1 INERT backend foundation -- OFFLINE unit tests for the location-aware operational Inventory
// Ledger foundation (functions/src/inventoryLedger/*). Pure/inert: NO emulator, NO network, NO
// production, NO callable. Runs the COMPILED output (../lib) and asserts PARITY against the merged
// frontend pure contract (../../field-ops-app-vite/src/domain/inventoryLedgerEvent.js).
//
// Run: npm run build && node test/operationalMovementLedger.test.mjs   (see package.json test:inventoryLedger)
import assert from "node:assert/strict";

const T = await import("../lib/inventoryLedger/operationalMovementTypes.js");
const V = await import("../lib/inventoryLedger/operationalMovementValidation.js");
const R = await import("../lib/inventoryLedger/operationalMovementRepository.js");
const FE = await import("../../field-ops-app-vite/src/domain/inventoryLedgerEvent.js");

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}

const loc = { type: "WAREHOUSE", locationId: "WH-1" };
const loc2 = { type: "MOBILE", locationId: "1" };
const partNone = { partId: "P1", trackingMode: "NONE" };
const partSerial = { partId: "P1", trackingMode: "SERIAL" };
const partLot = { partId: "P1", trackingMode: "LOT" };
const SRC = { RECEIVED: { type: "RECEIVING_ORDER", id: "RO-1" }, RETURNED: { type: "RMA", id: "RMA-1" }, TRANSFER_OUT: { type: "TRANSFER_ORDER", id: "TO-1" }, TRANSFER_IN: { type: "TRANSFER_ORDER", id: "TI-1" }, COUNTED: { type: "COUNT_SHEET", id: "CS-1" }, ADJUSTED: { type: "ADJUSTMENT", id: "ADJ-1" }, SCRAPPED: { type: "SCRAP", id: "SC-1" } };
const QTY = { RECEIVED: 5, RETURNED: 5, TRANSFER_OUT: 2, TRANSFER_IN: 2, COUNTED: 0, ADJUSTED: -2, SCRAPPED: 1 };
function ev(type, over = {}) {
  const e = { type, partId: "P1", location: loc, quantity: QTY[type], sourceObject: SRC[type], idempotencyKey: `idem-${type}-0001`, actor: { kind: "USER", id: "u1" }, occurredAt: 1000, ...over };
  if ((type === "TRANSFER_OUT" || type === "TRANSFER_IN") && !("counterpartyLocation" in over)) e.counterpartyLocation = loc2;
  return e;
}
const now = new Date(1_700_000_000_000);

function makeStore() {
  const docs = new Map();
  let creates = 0;
  return {
    docs,
    get creates() { return creates; },
    async read(id) { return docs.has(id) ? docs.get(id) : null; },
    create(id, data) { if (docs.has(id)) throw new Error("already-exists"); docs.set(id, data); creates += 1; },
  };
}

// ---- round-trip: every governed operational type validate -> serialize -> deserialize ----------
await check("every operational type round-trips (validate -> serialize -> deserialize) equal", async () => {
  for (const type of T.OPERATIONAL_MOVEMENT_TYPES) {
    const r = V.validateOperationalMovementEvent(ev(type), partNone);
    assert.equal(r.valid, true, `${type} should validate: ${r.reason}`);
    const data = R.serializeOperationalMovement(r.value, now, R.fingerprintMovement(r.value));
    assert.equal(data.schemaVersion, T.OPERATIONAL_LEDGER_SCHEMA_VERSION);
    const back = R.deserializeOperationalMovement(data);
    assert.deepEqual(back.value, r.value, `${type} round-trip value`);
    assert.equal(back.recordedAt, now.getTime(), `${type} recordedAt = server clock (millis, no Timestamp leak)`);
    assert.equal(typeof back.recordedAt, "number");
  }
});

// ---- mode rules --------------------------------------------------------------------------------
await check("SERIAL requires quantity 1 and serialNo", async () => {
  assert.equal(V.validateOperationalMovementEvent(ev("RECEIVED", { quantity: 1, serialNo: "SN1" }), partSerial).valid, true);
  assert.equal(V.validateOperationalMovementEvent(ev("RECEIVED", { quantity: 2, serialNo: "SN1" }), partSerial).reason, "quantity_invalid");
  assert.equal(V.validateOperationalMovementEvent(ev("RECEIVED", { quantity: 1 }), partSerial).reason, "serial_no_invalid");
});

await check("LOT requires lotId", async () => {
  assert.equal(V.validateOperationalMovementEvent(ev("RECEIVED", { lotId: "L1" }), partLot).valid, true);
  assert.equal(V.validateOperationalMovementEvent(ev("RECEIVED"), partLot).reason, "lot_id_invalid");
});

await check("wrong-mode identifiers fail closed (unknown_field)", async () => {
  assert.equal(V.validateOperationalMovementEvent(ev("RECEIVED", { serialNo: "SN1" }), partNone).reason, "unknown_field");
  assert.equal(V.validateOperationalMovementEvent(ev("RECEIVED", { lotId: "L1" }), partNone).reason, "unknown_field");
  assert.equal(V.validateOperationalMovementEvent(ev("RECEIVED", { quantity: 1, lotId: "L1", serialNo: "SN1" }), partSerial).reason, "unknown_field");
});

// ---- transfer + source enforcement -------------------------------------------------------------
await check("transfer counterparties and source types are enforced", async () => {
  assert.equal(V.validateOperationalMovementEvent(ev("TRANSFER_OUT"), partNone).valid, true);
  assert.equal(V.validateOperationalMovementEvent(ev("TRANSFER_OUT", { counterpartyLocation: undefined }), partNone).reason, "counterparty_invalid");
  assert.equal(V.validateOperationalMovementEvent(ev("TRANSFER_OUT", { counterpartyLocation: loc }), partNone).reason, "transfer_same_location");
  assert.equal(V.validateOperationalMovementEvent(ev("RECEIVED", { counterpartyLocation: loc2 }), partNone).reason, "unknown_field");
  assert.equal(V.validateOperationalMovementEvent(ev("RECEIVED", { sourceObject: { type: "SCRAP", id: "x" } }), partNone).reason, "source_incompatible");
  assert.equal(V.validateOperationalMovementEvent(ev("RECEIVED", { sourceObject: { type: "WORK_ORDER", id: "x" } }), partNone).reason, "source_incompatible");
});

// ---- recordedAt server-owned -------------------------------------------------------------------
await check("recordedAt input is rejected; serialize authors it server-side as a Timestamp", async () => {
  assert.equal(V.validateOperationalMovementEvent(ev("RECEIVED", { recordedAt: 123 }), partNone).reason, "recorded_at_forbidden");
  const r = V.validateOperationalMovementEvent(ev("RECEIVED"), partNone);
  assert.equal("recordedAt" in r.value, false, "recordedAt is never part of the pure value");
  const data = R.serializeOperationalMovement(r.value, now, "abcdef0123456789");
  assert.equal(data.recordedAt.constructor.name, "Timestamp");
});

// ---- malformed / unknown stored records fail closed --------------------------------------------
await check("malformed / unknown stored records fail closed on deserialize", async () => {
  const good = R.serializeOperationalMovement(V.validateOperationalMovementEvent(ev("RECEIVED"), partNone).value, now, "abcdef0123456789");
  assert.throws(() => R.deserializeOperationalMovement({ ...good, stray: 1 }), /MALFORMED_STORED_RECORD|malformed/i);
  assert.throws(() => R.deserializeOperationalMovement({ ...good, recordedAt: 123 }), /Timestamp|malformed/i);
  assert.throws(() => R.deserializeOperationalMovement({ ...good, direction: "OUT" }), /direction/i);
  assert.throws(() => R.deserializeOperationalMovement({ ...good, fingerprint: "nope" }), /fingerprint/i);
  assert.throws(() => R.deserializeOperationalMovement(null), /malformed|operational/i);
  assert.throws(() => R.deserializeOperationalMovement({ schemaVersion: 2, type: "NOPE" }), /operational|malformed/i);
});

// ---- legacy compatibility ----------------------------------------------------------------------
await check("legacy RESERVED/RELEASED/CONSUMED remain distinguishable and are never read as operational", async () => {
  assert.deepEqual([...T.LEGACY_TRANSACTION_TYPES].sort(), ["CONSUMED", "RELEASED", "RESERVED"]);
  // legacy and operational type sets are disjoint (so inventoryService behavior is untouched)
  for (const lt of T.LEGACY_TRANSACTION_TYPES) assert.equal(T.OPERATIONAL_MOVEMENT_TYPES.includes(lt), false);
  for (const lt of T.LEGACY_TRANSACTION_TYPES) {
    const legacyDoc = { workOrderId: "WO-1", partId: "P1", type: lt, quantity: 3 };
    assert.equal(R.classifyLedgerDoc(legacyDoc), "legacy", `${lt} classified legacy`);
    assert.throws(() => R.deserializeOperationalMovement(legacyDoc), /malformed|operational/i, `${lt} never deserialized as operational`);
  }
  // a new operational record is classified operational
  const opDoc = R.serializeOperationalMovement(V.validateOperationalMovementEvent(ev("RECEIVED"), partNone).value, now, "abcdef0123456789");
  assert.equal(R.classifyLedgerDoc(opDoc), "operational");
});

// ---- idempotency -------------------------------------------------------------------------------
await check("idempotent replay creates no duplicate", async () => {
  const store = makeStore();
  const e = ev("RECEIVED");
  const a = await R.stageOperationalMovement(store, e, partNone, { now });
  const b = await R.stageOperationalMovement(store, e, partNone, { now });
  assert.equal(a.outcome, "applied");
  assert.equal(b.outcome, "replayed");
  assert.equal(store.creates, 1, "exactly one create for a replayed key");
  assert.equal(store.docs.size, 1);
});

await check("same idempotencyKey with a changed payload conflicts", async () => {
  const store = makeStore();
  await R.stageOperationalMovement(store, ev("RECEIVED", { quantity: 5 }), partNone, { now });
  await assert.rejects(
    R.stageOperationalMovement(store, ev("RECEIVED", { quantity: 9 }), partNone, { now }),
    (err) => err instanceof T.IdempotencyConflictError && err.code === "IDEMPOTENCY_CONFLICT",
  );
  assert.equal(store.creates, 1, "conflict stages nothing new");
});

// ---- transaction failure stages no partial event -----------------------------------------------
await check("invalid envelope throws before any create (no partial stage)", async () => {
  const store = makeStore();
  await assert.rejects(
    R.stageOperationalMovement(store, ev("RECEIVED", { type: "NOPE" }), partNone, { now }),
    (err) => err instanceof T.InvalidMovementError && err.code === "INVALID_MOVEMENT",
  );
  assert.equal(store.creates, 0);
  assert.equal(store.docs.size, 0);
});

await check("a store whose create fails stages no partial event and rejects", async () => {
  const throwing = { async read() { return null; }, create() { throw new Error("txn-abort"); } };
  await assert.rejects(R.stageOperationalMovement(throwing, ev("RECEIVED"), partNone, { now }), /txn-abort/);
});

// ---- deterministic + non-mutating --------------------------------------------------------------
await check("deterministic + non-mutating (stable fingerprint, inputs untouched)", async () => {
  const e = ev("ADJUSTED");
  const snapshot = JSON.stringify(e);
  const r1 = V.validateOperationalMovementEvent(e, partNone);
  const r2 = V.validateOperationalMovementEvent(e, partNone);
  assert.deepEqual(r1, r2);
  assert.equal(R.fingerprintMovement(r1.value), R.fingerprintMovement(r2.value));
  assert.equal(JSON.stringify(e), snapshot, "input event not mutated");
});

// ---- no quantities / availability calculated ---------------------------------------------------
await check("no on-hand / available / balance is calculated or exposed", async () => {
  const r = V.validateOperationalMovementEvent(ev("RECEIVED"), partNone);
  for (const forbidden of ["onHand", "available", "reserved", "balance", "valuation", "total"]) {
    assert.equal(forbidden in r.value, false, `value must not carry ${forbidden}`);
  }
  for (const mod of [T, V, R]) {
    for (const name of Object.keys(mod)) {
      assert.ok(!/onHand|available|balance|valuation|aggregate/i.test(name), `no aggregate export: ${name}`);
    }
  }
});

// ---- PARITY against the merged frontend pure contract ------------------------------------------
await check("backend validator is byte-for-byte parity with the frontend pure contract", async () => {
  const cases = [
    { event: ev("RECEIVED"), part: partNone },
    { event: ev("RECEIVED", { quantity: 1, serialNo: "SN1" }), part: partSerial },
    { event: ev("RECEIVED", { lotId: "L1" }), part: partLot },
    { event: ev("TRANSFER_OUT"), part: partNone },
    { event: ev("TRANSFER_IN"), part: partNone },
    { event: ev("COUNTED"), part: partNone },
    { event: ev("ADJUSTED"), part: partNone },
    { event: ev("RETURNED"), part: partNone },
    { event: ev("SCRAPPED"), part: partNone },
    { event: ev("RECEIVED", { type: "NOPE" }), part: partNone }, // type_invalid
    { event: ev("RECEIVED", { partId: "OTHER" }), part: partNone }, // part_mismatch
    { event: ev("RECEIVED", { recordedAt: 1 }), part: partNone }, // recorded_at_forbidden
    { event: ev("RECEIVED", { extra: 1 }), part: partNone }, // unknown_field
    { event: ev("RECEIVED", { quantity: 1 }), part: partSerial }, // serial_no_invalid
    { event: ev("RECEIVED"), part: partLot }, // lot_id_invalid
    { event: ev("RECEIVED", { location: { type: "NOPE", locationId: "x" } }), part: partNone }, // location_invalid
    { event: ev("TRANSFER_OUT", { counterpartyLocation: { type: "X", locationId: "y" } }), part: partNone }, // counterparty_invalid
    { event: ev("TRANSFER_OUT", { counterpartyLocation: loc }), part: partNone }, // transfer_same_location
    { event: ev("RECEIVED", { quantity: 0 }), part: partNone }, // quantity_invalid
    { event: ev("RECEIVED", { sourceObject: { type: "SCRAP", id: "x" } }), part: partNone }, // source_incompatible
    { event: ev("RECEIVED", { idempotencyKey: "" }), part: partNone }, // idempotency_key_invalid
    { event: ev("RECEIVED", { actor: { kind: "ROBOT", id: "x" } }), part: partNone }, // actor_kind_invalid
    { event: ev("RECEIVED", { actor: { kind: "SYSTEM", id: "not-allowed" } }), part: partNone }, // system_actor_not_allowed
    { event: ev("RECEIVED", { actor: { kind: "SYSTEM", id: "WORK_ORDER_TRANSITION" } }), part: partNone }, // valid SYSTEM
    { event: ev("RECEIVED", { occurredAt: -1 }), part: partNone }, // occurred_at_invalid
    { event: 42, part: partNone }, // not_object
    { event: ev("RECEIVED"), part: { partId: "P1", trackingMode: "BOGUS" } }, // tracking_mode_invalid
  ];
  for (const { event, part } of cases) {
    const b = V.validateOperationalMovementEvent(event, part);
    const f = FE.validateInventoryMovementEvent(event, part);
    assert.equal(b.valid, f.valid, `valid mismatch for ${JSON.stringify(event).slice(0, 60)}`);
    assert.equal(b.reason, f.reason, `reason mismatch (${b.reason} vs ${f.reason})`);
    if (b.valid) assert.deepEqual(b.value, f.value, "value mismatch");
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
