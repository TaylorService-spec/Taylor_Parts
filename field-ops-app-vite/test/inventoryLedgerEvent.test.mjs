// Enterprise Inventory -- EI-P1b-1. Deterministic pure unit tests for the Inventory
// Ledger event ENVELOPE contract (src/domain/inventoryLedgerEvent.js). Proves the
// governed envelope decisions: Part-owned tracking mode + boundary controlType
// translation (SERIALIZED_LOT fail-closed), bounded source taxonomy + movement/source
// compatibility matrix, {USER,SYSTEM} actor with a SYSTEM allowlist, quantity rules
// (SERIAL=1; NONE/LOT positive incl. fractional; COUNTED>=0; ADJUSTED signed nonzero),
// occurredAt-required / recordedAt-forbidden, transfer counterparty (no transferId), and
// fail-closed shape validation. No aggregation / pairing / stock math is exercised.
//
// Run: node test/inventoryLedgerEvent.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import {
  OPERATIONAL_MOVEMENT_TYPES,
  MOVEMENT_DIRECTION,
  SOURCE_OBJECT_TYPES,
  MOVEMENT_SOURCE_TYPE,
  ACTOR_KINDS,
  SYSTEM_ACTOR_IDS,
  resolveTrackingModeFromControlType,
  validateInventoryMovementEvent,
  isInventoryMovementEvent,
} from "../src/domain/inventoryLedgerEvent.js";

let passed = 0;
function ok(name, fn) {
  fn();
  passed += 1;
  console.log("PASS -- " + name);
}

const PART = (mode) => ({ partId: "PART-1", trackingMode: mode });
const LOC = (id) => ({ type: "WAREHOUSE", locationId: id });
const ACTOR = { kind: "USER", id: "uid-abc" };

// Build a valid event for a movement type + tracking mode.
function ev(type, mode, over = {}) {
  const base = {
    type,
    partId: "PART-1",
    location: LOC("WH-1"),
    quantity: mode === "SERIAL" ? 1 : 5,
    sourceObject: { type: MOVEMENT_SOURCE_TYPE[type], id: "SRC-1" },
    idempotencyKey: "idem-1",
    actor: ACTOR,
    occurredAt: 1730000000000,
  };
  if (mode === "SERIAL") base.serialNo = "SN-9";
  if (mode === "LOT") base.lotId = "LOT-9";
  if (type === "TRANSFER_OUT" || type === "TRANSFER_IN") base.counterpartyLocation = LOC("WH-2");
  return { ...base, ...over };
}

// --- constants / governance ---
ok("operational movement types are the seven-member frozen subset", () => {
  assert.deepEqual(OPERATIONAL_MOVEMENT_TYPES, ["RECEIVED", "ADJUSTED", "TRANSFER_OUT", "TRANSFER_IN", "COUNTED", "RETURNED", "SCRAPPED"]);
  assert.equal(Object.isFrozen(OPERATIONAL_MOVEMENT_TYPES), true);
  // Reservation/consumption + opening-balance are deliberately NOT members.
  for (const excluded of ["RESERVED", "RELEASED", "CONSUMED", "OPENING_BALANCE"]) {
    assert.equal(OPERATIONAL_MOVEMENT_TYPES.includes(excluded), false, excluded);
  }
});

ok("direction metadata classifies each type (no sign inference)", () => {
  assert.deepEqual(MOVEMENT_DIRECTION, {
    RECEIVED: "IN", RETURNED: "IN", TRANSFER_IN: "IN",
    TRANSFER_OUT: "OUT", SCRAPPED: "OUT", ADJUSTED: "SIGNED", COUNTED: "SNAPSHOT",
  });
});

ok("source taxonomy declared ahead; WORK_ORDER present but unused by operational types", () => {
  assert.deepEqual(SOURCE_OBJECT_TYPES, ["WORK_ORDER", "RECEIVING_ORDER", "TRANSFER_ORDER", "COUNT_SHEET", "ADJUSTMENT", "RMA", "SCRAP"]);
  assert.equal(Object.values(MOVEMENT_SOURCE_TYPE).includes("WORK_ORDER"), false);
  assert.deepEqual(MOVEMENT_SOURCE_TYPE, {
    RECEIVED: "RECEIVING_ORDER", RETURNED: "RMA", TRANSFER_OUT: "TRANSFER_ORDER",
    TRANSFER_IN: "TRANSFER_ORDER", COUNTED: "COUNT_SHEET", ADJUSTED: "ADJUSTMENT", SCRAPPED: "SCRAP",
  });
});

ok("actor kinds + SYSTEM allowlist (initially only the WO-transition actor)", () => {
  assert.deepEqual(ACTOR_KINDS, ["USER", "SYSTEM"]);
  assert.deepEqual(SYSTEM_ACTOR_IDS, ["WORK_ORDER_TRANSITION"]);
  assert.equal(Object.isFrozen(SYSTEM_ACTOR_IDS), true);
});

// --- boundary controlType -> tracking mode translation ---
ok("resolveTrackingModeFromControlType: total-or-fail, SERIALIZED_LOT fails closed", () => {
  assert.deepEqual(resolveTrackingModeFromControlType("STANDARD"), { mode: "NONE", reason: null });
  assert.deepEqual(resolveTrackingModeFromControlType("SERIALIZED"), { mode: "SERIAL", reason: null });
  assert.deepEqual(resolveTrackingModeFromControlType("LOT"), { mode: "LOT", reason: null });
  assert.deepEqual(resolveTrackingModeFromControlType("SERIALIZED_LOT"), { mode: null, reason: "dual_tracking_unsupported" });
  assert.deepEqual(resolveTrackingModeFromControlType("bogus"), { mode: null, reason: "control_type_unknown" });
  assert.deepEqual(resolveTrackingModeFromControlType(undefined), { mode: null, reason: "control_type_unknown" });
});

// --- happy paths across every type + mode ---
ok("valid events for every operational type (NONE mode)", () => {
  for (const type of OPERATIONAL_MOVEMENT_TYPES) {
    const r = validateInventoryMovementEvent(ev(type, "NONE"), PART("NONE"));
    assert.equal(r.valid, true, `${type}: ${r.reason}`);
    assert.equal(r.value.direction, MOVEMENT_DIRECTION[type]);
  }
});

ok("valid SERIAL and LOT events; normalized value carries mode identifier only", () => {
  const s = validateInventoryMovementEvent(ev("RECEIVED", "SERIAL"), PART("SERIAL"));
  assert.equal(s.valid, true);
  assert.equal(s.value.serialNo, "SN-9");
  assert.equal("lotId" in s.value, false);
  const l = validateInventoryMovementEvent(ev("RECEIVED", "LOT"), PART("LOT"));
  assert.equal(l.valid, true);
  assert.equal(l.value.lotId, "LOT-9");
  assert.equal("serialNo" in l.value, false);
});

ok("normalized value shape (NONE RECEIVED)", () => {
  const r = validateInventoryMovementEvent(ev("RECEIVED", "NONE"), PART("NONE"));
  assert.deepEqual(r.value, {
    type: "RECEIVED", direction: "IN", partId: "PART-1", trackingMode: "NONE",
    location: { type: "WAREHOUSE", locationId: "WH-1" }, quantity: 5,
    sourceObject: { type: "RECEIVING_ORDER", id: "SRC-1" }, idempotencyKey: "idem-1",
    actor: { kind: "USER", id: "uid-abc" }, occurredAt: 1730000000000,
  });
});

ok("isInventoryMovementEvent mirrors validity", () => {
  assert.equal(isInventoryMovementEvent(ev("RECEIVED", "NONE"), PART("NONE")), true);
  assert.equal(isInventoryMovementEvent({}, PART("NONE")), false);
});

// --- fail-closed: structure + part authority ---
ok("not_object / type_invalid", () => {
  for (const v of [null, undefined, "x", 5, []]) assert.equal(validateInventoryMovementEvent(v, PART("NONE")).reason, "not_object", String(v));
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "NONE", { type: "RESERVED" }), PART("NONE")).reason, "type_invalid");
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "NONE", { type: "OPENING_BALANCE" }), PART("NONE")).reason, "type_invalid");
});

ok("part authority: invalid / bad mode / id mismatch", () => {
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "NONE"), null).reason, "part_invalid");
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "NONE"), { partId: "PART-1", trackingMode: "SERIALIZED" }).reason, "tracking_mode_invalid");
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "NONE"), { partId: "PART-1", trackingMode: "SERIALIZED_LOT" }).reason, "tracking_mode_invalid");
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "NONE", { partId: "OTHER" }), PART("NONE")).reason, "part_mismatch");
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "NONE", { partId: "" }), PART("NONE")).reason, "part_id_invalid");
});

// --- serial/lot exclusivity ---
ok("serial/lot identifiers are mode-exclusive and fail closed", () => {
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "SERIAL", { serialNo: "" }), PART("SERIAL")).reason, "serial_no_invalid");
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "LOT", { lotId: "  " }), PART("LOT")).reason, "lot_id_invalid");
  // NONE may carry neither.
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "NONE", { serialNo: "SN-1" }), PART("NONE")).reason, "unknown_field");
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "NONE", { lotId: "L-1" }), PART("NONE")).reason, "unknown_field");
  // Cross identifiers rejected (SERIAL carrying lotId, LOT carrying serialNo).
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "SERIAL", { lotId: "L-1" }), PART("SERIAL")).reason, "unknown_field");
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "LOT", { serialNo: "SN-1" }), PART("LOT")).reason, "unknown_field");
});

// --- location + transfer counterparty (correction: no transferId) ---
ok("location must be a valid discriminated reference", () => {
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "NONE", { location: { type: "TRUCK", locationId: "T" } }), PART("NONE")).reason, "location_invalid");
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "NONE", { location: null }), PART("NONE")).reason, "location_invalid");
});

ok("transfers require counterpartyLocation; distinct from own location", () => {
  assert.equal(validateInventoryMovementEvent(ev("TRANSFER_OUT", "NONE", { counterpartyLocation: undefined }), PART("NONE")).reason, "counterparty_invalid");
  assert.equal(validateInventoryMovementEvent(ev("TRANSFER_IN", "NONE", { counterpartyLocation: { type: "TRUCK", locationId: "X" } }), PART("NONE")).reason, "counterparty_invalid");
  const okOut = validateInventoryMovementEvent(ev("TRANSFER_OUT", "NONE"), PART("NONE"));
  assert.equal(okOut.valid, true);
  assert.deepEqual(okOut.value.counterpartyLocation, { type: "WAREHOUSE", locationId: "WH-2" });
});

ok("transfer_same_location requires BOTH type AND locationId to match (identity is the whole ref)", () => {
  // a. identical {type, locationId} -> same endpoint -> fails
  assert.equal(
    validateInventoryMovementEvent(ev("TRANSFER_OUT", "NONE", { counterpartyLocation: { type: "WAREHOUSE", locationId: "WH-1" } }), PART("NONE")).reason,
    "transfer_same_location",
  );
  // b. same locationId, different valid types -> distinct governed locations -> succeeds
  const r = validateInventoryMovementEvent(
    ev("TRANSFER_OUT", "NONE", { location: { type: "WAREHOUSE", locationId: "X" }, counterpartyLocation: { type: "BIN", locationId: "X" } }),
    PART("NONE"),
  );
  assert.equal(r.valid, true, r.reason);
  assert.deepEqual(r.value.counterpartyLocation, { type: "BIN", locationId: "X" });
});

ok("counterpartyLocation not allowed on non-transfer types (unknown_field)", () => {
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "NONE", { counterpartyLocation: LOC("WH-2") }), PART("NONE")).reason, "unknown_field");
});

ok("a stray transferId is an unknown field (linkage is the TRANSFER_ORDER source)", () => {
  assert.equal(validateInventoryMovementEvent(ev("TRANSFER_OUT", "NONE", { transferId: "TR-1" }), PART("NONE")).reason, "unknown_field");
});

// --- quantity rules ---
ok("SERIAL quantity must be exactly 1 (dominant over per-type rule)", () => {
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "SERIAL", { quantity: 2 }), PART("SERIAL")).reason, "quantity_invalid");
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "SERIAL", { quantity: 0 }), PART("SERIAL")).reason, "quantity_invalid");
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "SERIAL", { quantity: 1.5 }), PART("SERIAL")).reason, "quantity_invalid");
  // Even COUNTED/ADJUSTED for a serial are pinned to 1 in this envelope gate.
  assert.equal(validateInventoryMovementEvent(ev("COUNTED", "SERIAL", { quantity: 0 }), PART("SERIAL")).reason, "quantity_invalid");
  assert.equal(validateInventoryMovementEvent(ev("COUNTED", "SERIAL", { quantity: 1 }), PART("SERIAL")).valid, true);
});

ok("NONE/LOT allow positive fractional; IN/OUT reject <= 0", () => {
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "NONE", { quantity: 2.5 }), PART("NONE")).valid, true);
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "LOT", { quantity: 0.25 }), PART("LOT")).valid, true);
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "NONE", { quantity: 0 }), PART("NONE")).reason, "quantity_invalid");
  assert.equal(validateInventoryMovementEvent(ev("SCRAPPED", "NONE", { quantity: -1 }), PART("NONE")).reason, "quantity_invalid");
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "NONE", { quantity: "5" }), PART("NONE")).reason, "quantity_invalid");
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "NONE", { quantity: Infinity }), PART("NONE")).reason, "quantity_invalid");
});

ok("COUNTED snapshot >= 0 (0 allowed); ADJUSTED signed nonzero (negative allowed)", () => {
  assert.equal(validateInventoryMovementEvent(ev("COUNTED", "NONE", { quantity: 0 }), PART("NONE")).valid, true);
  assert.equal(validateInventoryMovementEvent(ev("COUNTED", "NONE", { quantity: -1 }), PART("NONE")).reason, "quantity_invalid");
  assert.equal(validateInventoryMovementEvent(ev("ADJUSTED", "NONE", { quantity: -3 }), PART("NONE")).valid, true);
  assert.equal(validateInventoryMovementEvent(ev("ADJUSTED", "LOT", { quantity: -2.5 }), PART("LOT")).valid, true);
  assert.equal(validateInventoryMovementEvent(ev("ADJUSTED", "NONE", { quantity: 0 }), PART("NONE")).reason, "quantity_invalid");
});

// --- movement/source compatibility matrix ---
ok("each movement type requires exactly its source type", () => {
  for (const type of OPERATIONAL_MOVEMENT_TYPES) {
    const r = validateInventoryMovementEvent(ev(type, "NONE"), PART("NONE"));
    assert.equal(r.valid, true, `${type}: ${r.reason}`);
    assert.equal(r.value.sourceObject.type, MOVEMENT_SOURCE_TYPE[type]);
  }
});

ok("mismatched source discriminant fails closed (source_incompatible)", () => {
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "NONE", { sourceObject: { type: "TRANSFER_ORDER", id: "T" } }), PART("NONE")).reason, "source_incompatible");
  // WORK_ORDER is never a valid source for an operational movement type.
  assert.equal(validateInventoryMovementEvent(ev("ADJUSTED", "NONE", { sourceObject: { type: "WORK_ORDER", id: "WO" } }), PART("NONE")).reason, "source_incompatible");
  assert.equal(validateInventoryMovementEvent(ev("TRANSFER_IN", "NONE", { sourceObject: { type: "RMA", id: "R" } }), PART("NONE")).reason, "source_incompatible");
});

ok("malformed source object fails closed (source_object_invalid)", () => {
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "NONE", { sourceObject: null }), PART("NONE")).reason, "source_object_invalid");
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "NONE", { sourceObject: { type: "RECEIVING_ORDER", id: "" } }), PART("NONE")).reason, "source_object_invalid");
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "NONE", { sourceObject: { type: "NOPE", id: "X" } }), PART("NONE")).reason, "source_object_invalid");
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "NONE", { sourceObject: { type: "RECEIVING_ORDER", id: "X", extra: 1 } }), PART("NONE")).reason, "source_object_invalid");
});

// --- idempotency + actor ---
ok("idempotencyKey required (nonempty)", () => {
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "NONE", { idempotencyKey: "" }), PART("NONE")).reason, "idempotency_key_invalid");
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "NONE", { idempotencyKey: 5 }), PART("NONE")).reason, "idempotency_key_invalid");
});

ok("actor: USER any nonempty id; SYSTEM must be on the allowlist", () => {
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "NONE", { actor: { kind: "USER", id: "uid-xyz" } }), PART("NONE")).valid, true);
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "NONE", { actor: { kind: "SYSTEM", id: "WORK_ORDER_TRANSITION" } }), PART("NONE")).valid, true);
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "NONE", { actor: { kind: "SYSTEM", id: "ROGUE" } }), PART("NONE")).reason, "system_actor_not_allowed");
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "NONE", { actor: { kind: "ROBOT", id: "x" } }), PART("NONE")).reason, "actor_kind_invalid");
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "NONE", { actor: { kind: "USER", id: "" } }), PART("NONE")).reason, "actor_id_invalid");
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "NONE", { actor: null }), PART("NONE")).reason, "actor_invalid");
});

// --- time: occurredAt required, recordedAt forbidden ---
ok("occurredAt must be a positive epoch-ms integer", () => {
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "NONE", { occurredAt: undefined }), PART("NONE")).reason, "occurred_at_invalid");
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "NONE", { occurredAt: -1 }), PART("NONE")).reason, "occurred_at_invalid");
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "NONE", { occurredAt: 1730000000000.5 }), PART("NONE")).reason, "occurred_at_invalid");
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "NONE", { occurredAt: "1730000000000" }), PART("NONE")).reason, "occurred_at_invalid");
});

ok("occurredAt must be a REPRESENTABLE epoch-ms (Date range), rejecting unusable values", () => {
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "NONE", { occurredAt: NaN }), PART("NONE")).reason, "occurred_at_invalid");
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "NONE", { occurredAt: Infinity }), PART("NONE")).reason, "occurred_at_invalid");
  // 1e100 is a finite integer but far outside Date's representable range -> rejected.
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "NONE", { occurredAt: 1e100 }), PART("NONE")).reason, "occurred_at_invalid");
  // Just past Date's max time value (8.64e15) -> rejected.
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "NONE", { occurredAt: 8640000000000001 }), PART("NONE")).reason, "occurred_at_invalid");
  // The exact maximum representable instant -> accepted boundary.
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "NONE", { occurredAt: 8640000000000000 }), PART("NONE")).valid, true);
});

ok("recordedAt is a forbidden input (reserved for the trusted server writer)", () => {
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "NONE", { recordedAt: 1730000000001 }), PART("NONE")).reason, "recorded_at_forbidden");
});

// --- unknown fields + purity ---
ok("unknown fields fail closed", () => {
  assert.equal(validateInventoryMovementEvent(ev("RECEIVED", "NONE", { note: "x" }), PART("NONE")).reason, "unknown_field");
});

ok("validation does not mutate inputs", () => {
  const e = ev("TRANSFER_OUT", "SERIAL"), p = PART("SERIAL");
  const se = structuredClone(e), sp = structuredClone(p);
  validateInventoryMovementEvent(e, p);
  assert.deepEqual(e, se);
  assert.deepEqual(p, sp);
});

console.log(`\n${passed} passed`);
