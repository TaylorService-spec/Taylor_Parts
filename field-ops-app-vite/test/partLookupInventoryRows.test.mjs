// LOOKUP — the inventory rows fed by the three governed reads (Phase H). PURE.
// Run: node --test test/partLookupInventoryRows.test.mjs
//
// The identity half (part codes, barcodes, conflict) lives in partLookup.test.mjs and
// partLookupAlias.test.mjs. This covers only what the serialized, balance and location-display
// reads turn into rows — and above all that a read which did not happen never becomes a number.
import assert from "node:assert/strict";
import test from "node:test";
import { describePartLookup, FIELD_STATE, READ_STATUS } from "../src/domain/partLookup.js";

const part = (over = {}) => ({
  invalid: false, partId: "PRT-1001", internalPartNumber: "TS-1001", name: "Compressor relay",
  description: "Start relay", category: "Electrical", status: "ACTIVE",
  stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED", version: 1, ...over,
});
const serialPart = () => part({ controlType: "SERIALIZED" });

const rowFor = (rows, label) => rows.find((r) => r.label === label);
const known = (value) => ({ state: "KNOWN", value });
const unknownFigure = { state: "UNKNOWN", value: null };

const readyBalance = (over = {}) => ({
  status: READ_STATUS.READY,
  projection: {
    partId: "PRT-1001",
    onHand: known(12), reserved: known(4), available: known(8), onOrder: known(6),
    byLocation: [{ locationId: "WH-1", quantity: 12 }],
    ...over,
  },
});

const readyLocations = (entries = [["WH-1", { locationId: "WH-1", type: "WAREHOUSE", label: "Main warehouse" }]]) =>
  ({ status: READ_STATUS.READY, displayMap: new Map(entries) });

const readySerialized = (assets = []) => ({ status: READ_STATUS.READY, assets });

// ─────────────────────────────────────────── the answers, when they arrive

test("a READY balance renders the four figures as values", () => {
  const rows = describePartLookup(part(), { balance: readyBalance(), location: readyLocations() });
  assert.equal(rowFor(rows, "On hand").value, "12");
  assert.equal(rowFor(rows, "Reserved").value, "4");
  assert.equal(rowFor(rows, "Available").value, "8");
  assert.equal(rowFor(rows, "On order").value, "6");
  for (const label of ["On hand", "Reserved", "Available", "On order"]) {
    assert.equal(rowFor(rows, label).state, FIELD_STATE.KNOWN);
  }
});

test("a KNOWN ZERO renders as 0 — the one place a zero is honest", () => {
  const rows = describePartLookup(part(), { balance: readyBalance({ onHand: known(0), available: known(0) }) });
  assert.equal(rowFor(rows, "On hand").value, "0");
  assert.equal(rowFor(rows, "On hand").state, FIELD_STATE.KNOWN);
});

test("location shows WHERE and HOW MUCH, using the resolver's label", () => {
  const rows = describePartLookup(part(), { balance: readyBalance(), location: readyLocations() });
  assert.equal(rowFor(rows, "Location").value, "Main warehouse (12)");
});

test("an id the display resolver could not name stays an ID, never a fabricated name", () => {
  const rows = describePartLookup(part(), { balance: readyBalance(), location: readyLocations([]) });
  assert.equal(rowFor(rows, "Location").value, "WH-1 (12)");
});

test("a READY balance holding stock nowhere is a KNOWN answer, not a gap", () => {
  const rows = describePartLookup(part(), { balance: readyBalance({ byLocation: [] }), location: readyLocations() });
  const row = rowFor(rows, "Location");
  assert.equal(row.state, FIELD_STATE.KNOWN);
  assert.match(row.detail, /no warehouse currently holds/i);
});

// ─────────────────────────────────────────── UNKNOWN survives every hop

test("an UNKNOWN figure stays UNKNOWN — it is never rendered as 0", () => {
  const rows = describePartLookup(part(), { balance: readyBalance({ onHand: unknownFigure, available: unknownFigure }) });
  for (const label of ["On hand", "Available"]) {
    const row = rowFor(rows, label);
    assert.equal(row.state, FIELD_STATE.UNKNOWN);
    assert.equal(row.value, null);
    assert.match(row.detail, /no stock movement/i);
  }
});

test("a DENIED read says NOT SWITCHED ON for every figure, and carries no numbers", () => {
  const rows = describePartLookup(part(), { balance: { status: READ_STATUS.DENIED } });
  for (const label of ["On hand", "Reserved", "Available", "On order"]) {
    const row = rowFor(rows, label);
    assert.equal(row.state, FIELD_STATE.CAPABILITY_INACTIVE);
    assert.equal(row.value, null);
    assert.match(row.detail, /not switched on/i);
  }
});

test("a LOADING read says it is READING — never that it failed", () => {
  const rows = describePartLookup(part(), { balance: { status: READ_STATUS.LOADING } });
  const row = rowFor(rows, "On hand");
  assert.match(row.detail, /reading/i);
  assert.doesNotMatch(row.detail, /could not/i);
  assert.equal(row.value, null);
});

test("a FAILED read is distinguished from a refused one", () => {
  const failed = rowFor(describePartLookup(part(), { balance: { status: READ_STATUS.UNAVAILABLE } }), "On hand");
  const denied = rowFor(describePartLookup(part(), { balance: { status: READ_STATUS.DENIED } }), "On hand");
  assert.equal(failed.state, FIELD_STATE.READ_FAILED);
  assert.equal(denied.state, FIELD_STATE.CAPABILITY_INACTIVE);
  assert.notEqual(failed.detail, denied.detail, "different problems, different fixes");
});

test("a MISSING read envelope fails closed, and never produces a value", () => {
  for (const rows of [describePartLookup(part()), describePartLookup(part(), {}), describePartLookup(part(), { balance: null })]) {
    const row = rowFor(rows, "On hand");
    assert.notEqual(row.state, FIELD_STATE.KNOWN);
    assert.equal(row.value, null);
  }
});

test("a malformed balance projection is UNKNOWN, never zero", () => {
  const rows = describePartLookup(part(), { balance: { status: READ_STATUS.READY, projection: { partId: "PRT-1001" } } });
  const row = rowFor(rows, "On hand");
  assert.equal(row.state, FIELD_STATE.UNKNOWN);
  assert.equal(row.value, null);
});

// ─────────────────────────────────────────── serialized parts

test("a serialized part counts UNITS, and does not claim a quantity", () => {
  const rows = describePartLookup(serialPart(), {
    serialized: readySerialized([
      { serialNo: "S1", partId: "PRT-1001", currentLocationId: "WH-1" },
      { serialNo: "S2", partId: "PRT-1001", currentLocationId: "WH-1" },
      { serialNo: "S9", partId: "OTHER", currentLocationId: "WH-1" },
    ]),
    location: readyLocations(),
    balance: { status: READ_STATUS.READY, projection: { onHand: { state: "NOT_COUNTED_BY_QUANTITY", value: null }, reserved: { state: "NOT_COUNTED_BY_QUANTITY", value: null }, available: { state: "NOT_COUNTED_BY_QUANTITY", value: null }, onOrder: known(2), byLocation: [] } },
  });
  assert.equal(rowFor(rows, "Serialized units").value, "2", "units of OTHER parts are not this part's units");
  assert.equal(rowFor(rows, "On hand").state, FIELD_STATE.NOT_APPLICABLE);
  assert.match(rowFor(rows, "On hand").detail, /counted individually/i);
  assert.equal(rowFor(rows, "On order").value, "2", "on order IS a quantity, even for a serial part");
});

test("a serialized part locates its UNITS, deduplicated and labelled", () => {
  const rows = describePartLookup(serialPart(), {
    serialized: readySerialized([
      { serialNo: "S1", partId: "PRT-1001", currentLocationId: "WH-1" },
      { serialNo: "S2", partId: "PRT-1001", currentLocationId: "WH-1" },
    ]),
    location: readyLocations(),
  });
  assert.equal(rowFor(rows, "Location").value, "Main warehouse");
});

test("a NON-serialized part reports serialized units as NOT APPLICABLE", () => {
  const row = rowFor(describePartLookup(part(), { serialized: readySerialized() }), "Serialized units");
  assert.equal(row.state, FIELD_STATE.NOT_APPLICABLE);
  assert.match(row.detail, /not serialized/i);
});

test("a serialized part with a READY registry and no units is a KNOWN zero", () => {
  const rows = describePartLookup(serialPart(), { serialized: readySerialized([]), location: readyLocations() });
  const row = rowFor(rows, "Serialized units");
  assert.equal(row.state, FIELD_STATE.KNOWN);
  assert.equal(row.value, "0");
  assert.match(row.detail, /none available/i);
});

test("a DENIED registry is not a count of zero", () => {
  const row = rowFor(describePartLookup(serialPart(), { serialized: { status: READ_STATUS.DENIED } }), "Serialized units");
  assert.equal(row.state, FIELD_STATE.CAPABILITY_INACTIVE);
  assert.equal(row.value, null, "a refused read must never look like an empty shelf");
});

test("units the registry holds no location for are UNKNOWN, not 'nowhere'", () => {
  const rows = describePartLookup(serialPart(), {
    serialized: readySerialized([{ serialNo: "S1", partId: "PRT-1001", currentLocationId: null }]),
    location: readyLocations(),
  });
  const row = rowFor(rows, "Location");
  assert.equal(row.state, FIELD_STATE.UNKNOWN);
  assert.equal(row.value, null);
});

// ─────────────────────────────────────────── one read failing does not take the others

test("a refused LOCATION read does not cost the balance figures", () => {
  const rows = describePartLookup(part(), { balance: readyBalance(), location: { status: READ_STATUS.DENIED } });
  assert.equal(rowFor(rows, "On hand").value, "12");
  assert.equal(rowFor(rows, "Location").state, FIELD_STATE.KNOWN, "ids still answer WHERE, just unlabelled");
  assert.equal(rowFor(rows, "Location").value, "WH-1 (12)");
});

test("a refused BALANCE read does not cost the serialized count", () => {
  const rows = describePartLookup(serialPart(), {
    serialized: readySerialized([{ serialNo: "S1", partId: "PRT-1001", currentLocationId: "WH-1" }]),
    balance: { status: READ_STATUS.DENIED },
    location: readyLocations(),
  });
  assert.equal(rowFor(rows, "Serialized units").value, "1");
  assert.equal(rowFor(rows, "On hand").state, FIELD_STATE.CAPABILITY_INACTIVE);
});

// ─────────────────────────────────────────── every row is one thing or the other

test("EVERY row is either a value or a stated reason — never both, never neither", () => {
  for (const context of [
    {},
    { balance: readyBalance(), location: readyLocations(), serialized: readySerialized() },
    { balance: { status: READ_STATUS.DENIED }, location: { status: READ_STATUS.DENIED }, serialized: { status: READ_STATUS.DENIED } },
  ]) {
    for (const p of [part(), serialPart()]) {
      for (const row of describePartLookup(p, context)) {
        assert.ok(Object.values(FIELD_STATE).includes(row.state), `${row.label} has no field state`);
        if (row.state === FIELD_STATE.KNOWN) assert.ok(row.value !== null, `${row.label} claims KNOWN with no value`);
        else {
          assert.equal(row.value, null, `${row.label} carries a value it should not`);
          assert.ok(row.detail, `${row.label} is empty and says nothing about why`);
        }
      }
    }
  }
});
