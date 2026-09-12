// LEGACY INVENTORY TRANSACTION -> eos_ops PHYSICAL MOVEMENT mapping contract.
// Run: node --test test/legacyInventoryMovementMapping.test.mjs   (after `npm run build`; no emulator)
//
// The load-bearing assertions are the SIGN ones. `quantity_delta` is the signed physical balance
// effect and the legacy ledger carries three different quantity conventions, so a mapper that copied
// `source.quantity` would be right for ADJUSTED, sign-flipped for every OUT row, and would
// double-negate a work-order consumption correction.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";

import {
  mapLegacyInventoryMovement,
  mapLegacyInventoryMovements,
  partitionMappingResults,
  shapeOnlyPartIdAuthority,
  adaptThrowingPartIdAuthority,
  MAPPING_REFUSAL_CODES,
  OPS_TRACKING_MODES,
  OPS_LOCATION_TYPES,
  NON_PHYSICAL_LOCATION_TYPES,
} from "../lib/eosOps/migration/legacyInventoryMovementMapping.js";
import {
  OPERATIONAL_MOVEMENT_TYPES,
  LEGACY_TRANSACTION_TYPES,
  MOVEMENT_DIRECTION,
  MOVEMENT_SOURCE_TYPE,
} from "../lib/inventoryLedger/operationalMovementTypes.js";
import { MOVEMENT_SIGN } from "../lib/inventoryLedger/locationOnHand.js";

const OCCURRED_AT = 1_700_000_000_000;

/** A well-formed legacy row for `type`, with the source-faithful quantity convention applied. */
function row(type, over = {}) {
  return {
    id: "tx-1",
    type,
    direction: MOVEMENT_DIRECTION[type],
    partId: "part_canonical_1",
    trackingMode: "NONE",
    // IN/OUT rows carry an UNSIGNED POSITIVE magnitude; SIGNED rows carry the effect itself.
    quantity: MOVEMENT_SIGN[type] === "SIGNED" ? -2 : 5,
    location: { type: "WAREHOUSE", locationId: "wh-1" },
    sourceObject: { type: MOVEMENT_SOURCE_TYPE[type], id: "src-1" },
    actor: { kind: "USER", id: "u-1" },
    occurredAt: OCCURRED_AT,
    operatingCompanyKey: "taylor",
    ...over,
  };
}

const mapped = (type, over = {}) => {
  const result = mapLegacyInventoryMovement(row(type, over));
  assert.equal(result.mapped, true, `expected ${type} to map, got ${result.refusal?.code}: ${result.refusal?.detail}`);
  return result.candidate;
};

const refusedCode = (input, deps) => {
  const result = mapLegacyInventoryMovement(input, deps);
  assert.equal(result.mapped, false, "expected a refusal");
  assert.equal(result.candidate, null);
  return result.refusal.code;
};

// ============================ vocabulary parity ============================

test("ops_movement_type is exactly the source physical vocabulary -- no type is silently unmappable", () => {
  // Mirrors migrations/1757808000000_eos-ops-foundation.sql's ops_movement_type enum.
  const OPS_MOVEMENT_TYPES = [
    "RECEIVED", "RETURNED", "TRANSFER_OUT", "TRANSFER_IN",
    "RELOCATION_OUT", "RELOCATION_IN", "WORK_ORDER_CONSUMPTION", "SCRAPPED", "ADJUSTED",
  ];
  assert.deepEqual([...OPERATIONAL_MOVEMENT_TYPES].sort(), [...OPS_MOVEMENT_TYPES].sort());
});

test("every physical movement type maps, and none of them borrows the commitment vocabulary", () => {
  for (const type of OPERATIONAL_MOVEMENT_TYPES) {
    assert.equal(mapped(type).movementType, type);
  }
  for (const type of LEGACY_TRANSACTION_TYPES) {
    assert.ok(!OPERATIONAL_MOVEMENT_TYPES.includes(type), `${type} must stay commitment-only`);
  }
});

test("the physical/non-physical location split is derived, not hand-listed", () => {
  assert.deepEqual([...OPS_LOCATION_TYPES], ["WAREHOUSE", "BIN", "MOBILE"]);
  assert.deepEqual([...NON_PHYSICAL_LOCATION_TYPES].sort(), ["CUSTOMER", "VENDOR", "VIRTUAL"]);
  assert.deepEqual([...OPS_TRACKING_MODES], ["NONE", "SERIAL"]);
});

// ============================ THE SIGN TABLE ============================

test("TRANSFER_OUT: a POSITIVE source magnitude becomes a NEGATIVE quantity_delta", () => {
  const candidate = mapped("TRANSFER_OUT", { quantity: 5 });
  assert.equal(candidate.quantityDelta, -5);
});

test("TRANSFER_IN: positive", () => {
  assert.equal(mapped("TRANSFER_IN", { quantity: 5 }).quantityDelta, 5);
});

test("RECEIVED: positive", () => {
  assert.equal(mapped("RECEIVED", { quantity: 7 }).quantityDelta, 7);
});

test("RELOCATION_OUT: negative, RELOCATION_IN: positive -- the pair nets to zero", () => {
  const out = mapped("RELOCATION_OUT", { quantity: 3, location: { type: "WAREHOUSE", locationId: "wh-1" } });
  const into = mapped("RELOCATION_IN", { quantity: 3, location: { type: "BIN", locationId: "bin-a" } });
  assert.equal(out.quantityDelta, -3);
  assert.equal(into.quantityDelta, 3);
  assert.equal(out.quantityDelta + into.quantityDelta, 0);
});

test("RETURNED is an INCREASE -- verified sign, not assumed", () => {
  // Evidence: MOVEMENT_DIRECTION.RETURNED === "IN" and MOVEMENT_SIGN.RETURNED === "PLUS"; the
  // availability and sales-order readers both count a governed RMA return as a physical receipt.
  assert.equal(MOVEMENT_DIRECTION.RETURNED, "IN");
  assert.equal(MOVEMENT_SIGN.RETURNED, "PLUS");
  assert.equal(mapped("RETURNED", { quantity: 2 }).quantityDelta, 2);
});

test("SCRAPPED is a DECREASE -- verified sign, not assumed", () => {
  assert.equal(MOVEMENT_DIRECTION.SCRAPPED, "OUT");
  assert.equal(MOVEMENT_SIGN.SCRAPPED, "MINUS");
  assert.equal(mapped("SCRAPPED", { quantity: 4 }).quantityDelta, -4);
});

test("WORK_ORDER_CONSUMPTION: the physical decrement passes through as the negative it already is", () => {
  // buildConsumptionMovement() applies the sign at write time: CONSUME -> -quantity.
  assert.equal(mapped("WORK_ORDER_CONSUMPTION", { quantity: -2 }).quantityDelta, -2);
});

test("WORK_ORDER_CONSUMPTION correction stays POSITIVE -- it is NOT re-negated", () => {
  // The correction is the same fact with the opposite sign, restoring stock to the location it left.
  // A mapper that applied a decrement rule to the type would turn a restoration into a second removal.
  assert.equal(mapped("WORK_ORDER_CONSUMPTION", { quantity: 3 }).quantityDelta, 3);
});

test("ADJUSTED preserves its authoritative signed value -- NO double negation in either direction", () => {
  assert.equal(mapped("ADJUSTED", { quantity: -2 }).quantityDelta, -2);
  assert.equal(mapped("ADJUSTED", { quantity: 2 }).quantityDelta, 2);
});

test("the mapper's sign decision agrees with the platform's ONE sign authority for every type", () => {
  for (const type of OPERATIONAL_MOVEMENT_TYPES) {
    const rule = MOVEMENT_SIGN[type];
    if (rule === "SIGNED") {
      assert.equal(mapped(type, { quantity: -6 }).quantityDelta, -6, type);
      assert.equal(mapped(type, { quantity: 6 }).quantityDelta, 6, type);
    } else {
      const expected = rule === "PLUS" ? 6 : -6;
      assert.equal(mapped(type, { quantity: 6 }).quantityDelta, expected, type);
    }
  }
});

// ============================ the commitment boundary ============================

test("RESERVED / RELEASED / commitment CONSUMED are refused as COMMITMENT_EVENT_NOT_PHYSICAL", () => {
  for (const type of ["RESERVED", "RELEASED", "CONSUMED"]) {
    // The real legacy commitment shape: location-less, no tracking mode, no source object.
    const legacyRow = { id: `tx-${type}`, workOrderId: "wo-1", partId: "part_canonical_1", type, quantity: 2 };
    const result = mapLegacyInventoryMovement(legacyRow);
    assert.equal(result.mapped, false, type);
    assert.equal(result.refusal.code, "COMMITMENT_EVENT_NOT_PHYSICAL", type);
    assert.equal(result.refusal.sourceTransactionId, `tx-${type}`);
    assert.equal(result.refusal.observed.family, "COMMITMENT");
  }
});

test("a commitment row is reported as COMMITMENT_EVENT_NOT_PHYSICAL even when it is also malformed", () => {
  // The family verdict is the informative one; it must not be masked by a missing-field verdict.
  assert.equal(refusedCode({ type: "CONSUMED" }), "COMMITMENT_EVENT_NOT_PHYSICAL");
});

test("physical WORK_ORDER_CONSUMPTION is NOT confused with the commitment CONSUMED", () => {
  // Both originate at a Work Order. They are distinguished by the TYPE STRING, which is total.
  assert.equal(refusedCode(row("WORK_ORDER_CONSUMPTION", { type: "CONSUMED" })), "COMMITMENT_EVENT_NOT_PHYSICAL");
  assert.equal(mapped("WORK_ORDER_CONSUMPTION").movementType, "WORK_ORDER_CONSUMPTION");
  assert.equal(mapped("WORK_ORDER_CONSUMPTION").sourceKind, "WORK_ORDER");
});

test("no commitment type can ever become an ops_movement_type", () => {
  for (const type of LEGACY_TRANSACTION_TYPES) {
    const result = mapLegacyInventoryMovement(row("RECEIVED", { type }));
    assert.equal(result.mapped, false);
    assert.equal(result.candidate, null);
  }
});

// ============================ fail closed ============================

test("an unknown movement type fails closed", () => {
  assert.equal(refusedCode(row("RECEIVED", { type: "COUNTED" })), "UNKNOWN_MOVEMENT_TYPE");
  assert.equal(refusedCode(row("RECEIVED", { type: "TELEPORTED" })), "UNKNOWN_MOVEMENT_TYPE");
  assert.equal(refusedCode(row("RECEIVED", { type: "" })), "MISSING_MOVEMENT_TYPE");
  assert.equal(refusedCode(row("RECEIVED", { type: undefined })), "MISSING_MOVEMENT_TYPE");
});

test("a row that is not an object is refused, never silently skipped", () => {
  for (const bad of [null, undefined, 5, "RECEIVED", []]) {
    assert.equal(refusedCode(bad), "INVALID_SOURCE_ROW");
  }
});

// ============================ part id ============================

test("a missing part id is refused", () => {
  assert.equal(refusedCode(row("RECEIVED", { partId: undefined })), "MISSING_PART_ID");
  assert.equal(refusedCode(row("RECEIVED", { partId: "" })), "MISSING_PART_ID");
  assert.equal(refusedCode(row("RECEIVED", { partId: "   " })), "MISSING_PART_ID");
});

test("an invalid part id is refused -- a display SKU or spreadsheet name is not a document id", () => {
  assert.equal(refusedCode(row("RECEIVED", { partId: 12345 })), "INVALID_PART_ID");
  assert.equal(refusedCode(row("RECEIVED", { partId: "X25 Mix Pump Seal" })), "INVALID_PART_ID");
  assert.equal(refusedCode(row("RECEIVED", { partId: "parts/abc123" })), "INVALID_PART_ID");
  assert.equal(refusedCode(row("RECEIVED", { partId: " abc123 " })), "INVALID_PART_ID");
  assert.equal(refusedCode(row("RECEIVED", { partId: "__name__" })), "INVALID_PART_ID");
  assert.equal(refusedCode(row("RECEIVED", { partId: ".." })), "INVALID_PART_ID");
});

test("the default part-id seam is SHAPE-only and says so by accepting a shape-plausible id", () => {
  assert.deepEqual(shapeOnlyPartIdAuthority("part_abc123"), { ok: true, partId: "part_abc123" });
  assert.equal(shapeOnlyPartIdAuthority(undefined).code, "MISSING_PART_ID");
  assert.equal(shapeOnlyPartIdAuthority("a b").code, "INVALID_PART_ID");
});

test("INTEGRATION POINT: a throwing canonical authority can be injected without touching the mapper", () => {
  // This is exactly how `requireCanonicalPartId` is adopted once it lands.
  const requireCanonicalPartId = (value) => {
    if (value === "part_canonical_1") return "part_canonical_1";
    throw new Error("not the canonical parts document id");
  };
  const deps = { partIdAuthority: adaptThrowingPartIdAuthority(requireCanonicalPartId) };

  const ok = mapLegacyInventoryMovement(row("RECEIVED"), deps);
  assert.equal(ok.mapped, true);
  assert.equal(ok.candidate.partId, "part_canonical_1");

  // A shape-plausible but non-canonical id passes the DEFAULT seam and is refused by the injected one.
  assert.equal(mapLegacyInventoryMovement(row("RECEIVED", { partId: "alias-77" })).mapped, true);
  const refused = mapLegacyInventoryMovement(row("RECEIVED", { partId: "alias-77" }), deps);
  assert.equal(refused.mapped, false);
  assert.equal(refused.refusal.code, "INVALID_PART_ID");
  assert.match(refused.refusal.detail, /canonical/);

  assert.equal(refusedCode(row("RECEIVED", { partId: undefined }), deps), "MISSING_PART_ID");
});

// ============================ tracking mode ============================

test("an unknown tracking mode is refused", () => {
  assert.equal(refusedCode(row("RECEIVED", { trackingMode: "BATCH" })), "UNKNOWN_TRACKING_MODE");
  assert.equal(refusedCode(row("RECEIVED", { trackingMode: undefined })), "MISSING_TRACKING_MODE");
  assert.equal(refusedCode(row("RECEIVED", { trackingMode: 1 })), "MISSING_TRACKING_MODE");
});

test("LOT is a real source mode with no ops_tracking_mode member -- refused, never collapsed to NONE", () => {
  assert.equal(refusedCode(row("RECEIVED", { trackingMode: "LOT" })), "UNSUPPORTED_TRACKING_MODE");
});

test("historical tracking mode is read from the ROW -- the mapper never consults a current Part", () => {
  const source = readFileSync("src/eosOps/migration/legacyInventoryMovementMapping.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.ok(!/controlType/.test(source), "the mapper must not read Part.controlType");
  assert.ok(!/controlTypeToTrackingMode/.test(source));
});

test("a SERIAL row maps to a unit-signed delta and carries its serial number", () => {
  const serialRow = { trackingMode: "SERIAL", serialNo: "SN-1", quantity: 1 };
  assert.equal(mapped("RECEIVED", serialRow).quantityDelta, 1);
  assert.equal(mapped("RECEIVED", serialRow).serialNumber, "SN-1");
  assert.equal(mapped("TRANSFER_OUT", serialRow).quantityDelta, -1);
  assert.equal(mapped("SCRAPPED", serialRow).quantityDelta, -1);
});

test("a SERIAL row with no serial number, or a NONE row that claims one, is refused", () => {
  assert.equal(refusedCode(row("RECEIVED", { trackingMode: "SERIAL", quantity: 1 })), "MISSING_SERIAL_NUMBER");
  assert.equal(refusedCode(row("RECEIVED", { serialNo: "SN-1" })), "SERIAL_NUMBER_NOT_ALLOWED");
});

test("a SIGNED movement in SERIAL mode FAILS CLOSED: the source row does not record its direction", () => {
  // operationalMovementValidation.validateQuantityReason pins every SERIAL row's quantity to 1
  // before direction is consulted, so a serial ADJUSTED's stored +1 is evidence of a unit, not a
  // balance effect. Inferring "missing serial => -1" would encode a fact the row does not contain.
  for (const type of ["ADJUSTED", "WORK_ORDER_CONSUMPTION"]) {
    assert.equal(
      refusedCode(row(type, { trackingMode: "SERIAL", serialNo: "SN-9", quantity: 1 })),
      "SERIAL_SIGN_NOT_RECOVERABLE",
      type,
    );
  }
});

// ============================ operating company ============================

test("a missing operating company is refused and is NEVER inferred", () => {
  assert.equal(refusedCode(row("RECEIVED", { operatingCompanyKey: undefined })), "MISSING_OPERATING_COMPANY");
  assert.equal(refusedCode(row("RECEIVED", { operatingCompanyKey: "" })), "MISSING_OPERATING_COMPANY");
  assert.equal(refusedCode(row("RECEIVED", { operatingCompanyKey: null })), "MISSING_OPERATING_COMPANY");
});

test("an operating company of the wrong shape is refused", () => {
  assert.equal(refusedCode(row("RECEIVED", { operatingCompanyKey: "TAYLOR" })), "INVALID_OPERATING_COMPANY");
  assert.equal(refusedCode(row("RECEIVED", { operatingCompanyKey: 7 })), "INVALID_OPERATING_COMPANY");
});

test("the mapper names no warehouse/truck/employee field it could infer a company from", () => {
  const source = readFileSync("src/eosOps/migration/legacyInventoryMovementMapping.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  for (const forbidden of ["homeWarehouseId", "warehouseId", "truckId", "employeeId", "technicianId"]) {
    assert.ok(!source.includes(forbidden), `company must not be inferable from ${forbidden}`);
  }
});

// ============================ location ============================

test("a bare location id is refused -- it is never assumed to be a warehouse", () => {
  assert.equal(refusedCode(row("RECEIVED", { location: "wh-1" })), "MISSING_LOCATION_TYPE");
  assert.equal(refusedCode(row("RECEIVED", { location: undefined })), "MISSING_LOCATION_TYPE");
  assert.equal(refusedCode(row("RECEIVED", { location: { locationId: "wh-1" } })), "MISSING_LOCATION_TYPE");
});

test("EQUIPMENT is not a valid physical location for an imported movement", () => {
  assert.equal(refusedCode(row("RECEIVED", { location: { type: "EQUIPMENT", locationId: "eq-1" } })), "UNKNOWN_LOCATION_TYPE");
});

test("a legacy non-physical location type is refused with its own code", () => {
  for (const type of ["VENDOR", "CUSTOMER", "VIRTUAL"]) {
    assert.equal(refusedCode(row("RECEIVED", { location: { type, locationId: "x-1" } })), "NON_PHYSICAL_LOCATION_TYPE", type);
  }
});

test("an unknown location type is refused", () => {
  assert.equal(refusedCode(row("RECEIVED", { location: { type: "SHELF", locationId: "s-1" } })), "UNKNOWN_LOCATION_TYPE");
});

test("a missing location id is refused", () => {
  assert.equal(refusedCode(row("RECEIVED", { location: { type: "WAREHOUSE" } })), "MISSING_LOCATION_ID");
  assert.equal(refusedCode(row("RECEIVED", { location: { type: "BIN", locationId: "  " } })), "MISSING_LOCATION_ID");
});

test("each physical location type maps through unchanged", () => {
  for (const type of OPS_LOCATION_TYPES) {
    const candidate = mapped("RECEIVED", { location: { type, locationId: `${type}-1` } });
    assert.equal(candidate.locationType, type);
    assert.equal(candidate.locationId, `${type}-1`);
  }
});

// ============================ quantity ============================

test("a zero quantity is refused wherever movement_quantity_nonzero forbids it", () => {
  assert.equal(refusedCode(row("ADJUSTED", { quantity: 0 })), "INVALID_QUANTITY");
  assert.equal(refusedCode(row("WORK_ORDER_CONSUMPTION", { quantity: 0 })), "INVALID_QUANTITY");
  assert.equal(refusedCode(row("RECEIVED", { quantity: 0 })), "INVALID_QUANTITY");
  assert.equal(refusedCode(row("TRANSFER_OUT", { quantity: 0 })), "INVALID_QUANTITY");
});

test("an invalid quantity is refused", () => {
  for (const bad of [undefined, null, "5", NaN, Infinity, 1.5]) {
    assert.equal(refusedCode(row("RECEIVED", { quantity: bad })), "INVALID_QUANTITY", String(bad));
  }
});

test("a corrupt NEGATIVE magnitude on an IN/OUT row is refused, never absolute-valued", () => {
  // Taking |q| would let a corrupt negative receipt manufacture stock.
  assert.equal(refusedCode(row("RECEIVED", { quantity: -5 })), "INVALID_QUANTITY");
  assert.equal(refusedCode(row("TRANSFER_OUT", { quantity: -5 })), "INVALID_QUANTITY");
  assert.equal(refusedCode(row("RETURNED", { quantity: -1 })), "INVALID_QUANTITY");
});

test("a SERIAL row whose quantity is not exactly one unit is refused", () => {
  assert.equal(refusedCode(row("RECEIVED", { trackingMode: "SERIAL", serialNo: "SN-1", quantity: 2 })), "INVALID_QUANTITY");
});

test("no candidate can ever carry a zero quantity_delta", () => {
  for (const type of OPERATIONAL_MOVEMENT_TYPES) {
    for (const quantity of [-3, -1, 0, 1, 3, 5]) {
      const result = mapLegacyInventoryMovement(row(type, { quantity }));
      if (result.mapped) assert.notEqual(result.candidate.quantityDelta, 0, `${type}/${quantity}`);
    }
  }
});

// ============================ direction coherence ============================

test("a stored direction that disagrees with the movement type is refused, not reconciled", () => {
  assert.equal(refusedCode(row("TRANSFER_OUT", { direction: "IN" })), "DIRECTION_TYPE_MISMATCH");
  assert.equal(refusedCode(row("RECEIVED", { direction: "SIGNED" })), "DIRECTION_TYPE_MISMATCH");
  assert.equal(refusedCode(row("ADJUSTED", { direction: "OUT" })), "DIRECTION_TYPE_MISMATCH");
});

test("an ABSENT direction is normal and the type supplies the sign", () => {
  assert.equal(mapped("TRANSFER_OUT", { direction: undefined, quantity: 5 }).quantityDelta, -5);
  assert.equal(mapped("RECEIVED", { direction: undefined, quantity: 5 }).quantityDelta, 5);
  assert.equal(mapped("ADJUSTED", { direction: undefined, quantity: -5 }).quantityDelta, -5);
});

// ============================ provenance ============================

test("a row with no source object or no actor is refused -- provenance is never invented", () => {
  assert.equal(refusedCode(row("RECEIVED", { sourceObject: undefined })), "MISSING_SOURCE_OBJECT");
  assert.equal(refusedCode(row("RECEIVED", { sourceObject: { type: "RECEIVING_ORDER" } })), "MISSING_SOURCE_OBJECT");
  assert.equal(refusedCode(row("RECEIVED", { actor: undefined })), "MISSING_ACTOR");
  assert.equal(refusedCode(row("RECEIVED", { actor: { kind: "USER" } })), "MISSING_ACTOR");
});

test("occurred_at must be the row's real business time", () => {
  for (const bad of [undefined, null, 0, -1, "2024-01-01", 1.5]) {
    assert.equal(refusedCode(row("RECEIVED", { occurredAt: bad })), "INVALID_OCCURRED_AT", String(bad));
  }
  assert.equal(mapped("RECEIVED").occurredAt, OCCURRED_AT);
});

// ============================ reject-bucket support ============================

test("every refusal carries the source transaction id, a stable code and non-secret diagnostics", () => {
  const result = mapLegacyInventoryMovement(row("RECEIVED", { id: "tx-42", trackingMode: "LOT" }));
  assert.equal(result.mapped, false);
  assert.equal(result.refusal.sourceTransactionId, "tx-42");
  assert.equal(result.refusal.code, "UNSUPPORTED_TRACKING_MODE");
  assert.equal(typeof result.refusal.detail, "string");
  assert.deepEqual(result.refusal.observed, { trackingMode: "LOT" });
});

test("diagnostics are bounded tokens, never a copy of the source row", () => {
  const huge = "z".repeat(5000);
  const result = mapLegacyInventoryMovement(row("RECEIVED", { partId: `${huge} x` }));
  assert.equal(result.mapped, false);
  for (const value of Object.values(result.refusal.observed)) {
    assert.ok(value.length <= 65, `diagnostic token was ${value.length} chars`);
  }
});

test("every refusal code the mapper can emit is declared in the stable list", () => {
  const declared = new Set(MAPPING_REFUSAL_CODES);
  const inputs = [
    null, {}, { type: "RESERVED" }, { type: "NOPE" },
    row("RECEIVED", { operatingCompanyKey: undefined }), row("RECEIVED", { operatingCompanyKey: "X" }),
    row("RECEIVED", { partId: undefined }), row("RECEIVED", { partId: "a b" }),
    row("RECEIVED", { trackingMode: undefined }), row("RECEIVED", { trackingMode: "BATCH" }),
    row("RECEIVED", { trackingMode: "LOT" }),
    row("RECEIVED", { location: "wh" }), row("RECEIVED", { location: { type: "SHELF", locationId: "s" } }),
    row("RECEIVED", { location: { type: "VENDOR", locationId: "v" } }),
    row("RECEIVED", { location: { type: "BIN" } }),
    row("RECEIVED", { direction: "OUT" }), row("RECEIVED", { quantity: 0 }),
    row("ADJUSTED", { trackingMode: "SERIAL", serialNo: "SN", quantity: 1 }),
    row("RECEIVED", { trackingMode: "SERIAL", quantity: 1 }), row("RECEIVED", { serialNo: "SN" }),
    row("RECEIVED", { sourceObject: undefined }), row("RECEIVED", { actor: undefined }),
    row("RECEIVED", { occurredAt: undefined }),
  ];
  const seen = new Set();
  for (const input of inputs) {
    const result = mapLegacyInventoryMovement(input);
    assert.equal(result.mapped, false);
    assert.ok(declared.has(result.refusal.code), `undeclared code ${result.refusal.code}`);
    seen.add(result.refusal.code);
  }
  // Every declared code is reachable -- no decorative entries in the taxonomy.
  assert.deepEqual([...declared].filter((c) => !seen.has(c)), []);
});

test("a batch is TOTAL and order-preserving: one outcome per source row, never an implicit skip", () => {
  const rows = [row("RECEIVED"), { type: "RESERVED" }, row("TRANSFER_OUT"), "junk"];
  const results = mapLegacyInventoryMovements(rows);
  assert.equal(results.length, rows.length);
  assert.deepEqual(results.map((r) => r.mapped), [true, false, true, false]);
  for (const result of results) {
    assert.ok(result.mapped ? result.candidate !== null : result.refusal !== null);
    assert.ok(result.mapped ? result.refusal === null : result.candidate === null);
  }
  const { candidates, refusals } = partitionMappingResults(results);
  assert.equal(candidates.length, 2);
  assert.equal(refusals.length, 2);
  assert.deepEqual(refusals.map((r) => r.code), ["COMMITMENT_EVENT_NOT_PHYSICAL", "INVALID_SOURCE_ROW"]);
});

// ============================ determinism / purity ============================

test("the mapping is DETERMINISTIC and SIDE-EFFECT FREE", () => {
  const input = row("WORK_ORDER_CONSUMPTION", { quantity: -4 });
  const snapshot = JSON.stringify(input);
  const first = mapLegacyInventoryMovement(input);
  const second = mapLegacyInventoryMovement(input);
  const third = mapLegacyInventoryMovement(JSON.parse(snapshot));
  assert.deepEqual(first, second);
  assert.deepEqual(first, third);
  assert.equal(JSON.stringify(input), snapshot, "the source row was mutated");
});

test("a frozen source row maps without being written to", () => {
  const input = Object.freeze({ ...row("RECEIVED"), location: Object.freeze({ type: "WAREHOUSE", locationId: "wh-1" }) });
  const result = mapLegacyInventoryMovement(input);
  assert.equal(result.mapped, true);
  assert.ok(Object.isFrozen(result.candidate), "the candidate is immutable evidence");
});

test("the mapper reads no clock, no environment and no randomness", () => {
  const source = readFileSync("src/eosOps/migration/legacyInventoryMovementMapping.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  for (const pattern of [/Date\.now\s*\(/, /new\s+Date\s*\(/, /Math\.random\s*\(/, /process\.env/, /randomUUID/]) {
    assert.ok(!pattern.test(source), `mapper must not use ${pattern}`);
  }
});

// ============================ the module opens no store ============================

/** Every module reachable from the compiled mapper, transitively. */
function importGraph(entry) {
  const seen = new Set();
  const queue = [resolvePath(entry)];
  const externals = new Set();
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    const pattern = /\brequire\(\s*["']([^"']+)["']\s*\)|\bfrom\s+["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const specifier = match[1] ?? match[2] ?? match[3];
      if (specifier.startsWith(".")) queue.push(resolvePath(dirname(file), specifier));
      else externals.add(specifier);
    }
  }
  return { files: [...seen], externals: [...externals] };
}

const ENTRY = "lib/eosOps/migration/legacyInventoryMovementMapping.js";

test("the module opens NO Firestore connection -- nothing in its import graph reaches Firebase", () => {
  const { files, externals } = importGraph(ENTRY);
  const forbidden = externals.filter((s) => /^firebase(-admin|-functions)?(\/|$)/.test(s));
  assert.deepEqual(forbidden, [], `Firebase reached via: ${forbidden.join(", ")}`);
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const pattern of [/\bgetFirestore\s*\(/, /\bFieldValue\b/, /\bFieldPath\b/, /\binitializeApp\s*\(/, /\bfirestore\s*\(\s*\)/]) {
      assert.ok(!pattern.test(source), `${file} matches ${pattern}`);
    }
  }
});

test("the module opens NO Postgres connection -- no pg client, no pool, no DATABASE_URL", () => {
  const { files, externals } = importGraph(ENTRY);
  assert.ok(!externals.some((s) => s === "pg" || s.startsWith("pg/") || s.startsWith("pg-")), `pg reached via: ${externals.join(", ")}`);
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const pattern of [/new\s+(?:Pool|Client)\s*\(/, /process\.env\.DATABASE_URL/, /\.connect\s*\(/, /\bpool\.query\s*\(/]) {
      assert.ok(!pattern.test(source), `${file} matches ${pattern}`);
    }
  }
});

test("the mapper's whole import graph is pure: node builtins only, and this lane added no new one", () => {
  const { externals } = importGraph(ENTRY);
  assert.deepEqual(externals, [], `unexpected external dependency: ${externals.join(", ")}`);
});

test("the source file imports no Firebase and names no Firestore collection", () => {
  const source = readFileSync("src/eosOps/migration/legacyInventoryMovementMapping.ts", "utf8");
  for (const pattern of [/from\s+["']firebase/, /from\s+["']firebase-admin/, /from\s+["']firebase-functions/, /from\s+["']pg["']/]) {
    assert.ok(!pattern.test(source), `forbidden import matching ${pattern}`);
  }
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  for (const collection of ['"inventory_transactions"', '"parts"', '"partsCatalog"', '"serialized_assets"', '"warehouses"', '"bins"']) {
    assert.ok(!code.includes(collection), `names the collection ${collection}`);
  }
});
