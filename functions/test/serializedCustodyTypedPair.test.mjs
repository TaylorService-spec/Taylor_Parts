// SERIALIZED CUSTODY — the typed location pair, made real.
// Run (PURE — no emulator, no Postgres):  node --test test/serializedCustodyTypedPair.test.mjs
//
// The defect this suite pins, in one sentence: `serialized_assets.currentLocationType` was READ by
// exactly one caller and WRITTEN by nothing, so its `?? "WAREHOUSE"` default was taken 100% of the
// time — including for a unit relocated into a BIN, whose bin id was then reported to Work-Order
// consumption as a warehouse id.
//
// The assertions are therefore of two kinds, and both are load-bearing:
//   * BEHAVIOUR (pure calls): the contract accepts only real custody types, never invents one, and
//     the consumption reader returns null — not a guess — when the type is absent or unrecognized.
//   * WRITER PROOF (source text, comments stripped): every writer of `currentLocationId` now stamps
//     `currentLocationType` in the same write, and no `?? "WAREHOUSE"` default survives anywhere.
//     The relocation and transfer writers only run under the Firestore emulator, which this
//     environment cannot start; asserting on their source is how their half of the pair is pinned
//     here rather than left unverified. This mirrors consumptionSourceOptions.test.mjs, which
//     already asserts against stripped source for facts it cannot execute.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (rel) => readFileSync(join(HERE, "..", "src", rel), "utf8");
const codeOnly = (rel) =>
  src(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const {
  SERIALIZED_CUSTODY_LOCATION_TYPES,
  isSerializedCustodyLocationType,
  toSerializedCustodyLocationType,
  readSerializedCustodyPair,
  validateSerializedAssetValue,
} = await import("../lib/serializedAsset/types.js");
const { buildSerializedAssetForReceipt } = await import("../lib/serializedAsset/serializedAssetRegistration.js");
const { ACQUIRED_LOCATION_TYPE } = await import("../lib/serializedAsset/acquireSerializedAssetCommand.js");
const { readSerializedCustody } = await import("../lib/workOrderConsumption/consumptionSourceService.js");
const { resolveConsumptionSource } = await import("../lib/workOrderConsumption/consumptionSource.js");
const { projectSerializedAsset } = await import("../lib/serializedAsset/serializedAssetReadService.js");

const VALID = {
  serialNo: "SN-1", partId: "part-1", currentLocationId: "wh-main",
  currentLocationType: "WAREHOUSE", inventoryState: "AVAILABLE",
  currentEquipmentId: null, ownership: "COMPANY",
};

// ══════════════════════════ THE VOCABULARY ══════════════════════════

test("custody location types are exactly the three places a company-held unit can be", () => {
  assert.deepEqual([...SERIALIZED_CUSTODY_LOCATION_TYPES], ["WAREHOUSE", "BIN", "MOBILE"]);
});

test("EQUIPMENT is NOT a custody location type — an installed unit's custody is the install link", () => {
  // Migration 007 adds EQUIPMENT to the SQL custody enum and pointedly not to the physical movement
  // enum. This field is the physical half, so it stops at MOBILE; `currentEquipmentId` carries the
  // other half. Accepting EQUIPMENT here would let a location write claim an installation.
  assert.equal(isSerializedCustodyLocationType("EQUIPMENT"), false);
  assert.equal(toSerializedCustodyLocationType("EQUIPMENT"), null);
});

test("ledger counterparty types are refused — they are not custody of a unit we hold", () => {
  for (const t of ["VENDOR", "CUSTOMER", "VIRTUAL"]) {
    assert.equal(isSerializedCustodyLocationType(t), false, `${t} must not be a custody type`);
  }
});

test("garbage is never coerced into a type", () => {
  for (const v of ["warehouse", " WAREHOUSE ", "", null, undefined, 7, {}, ["BIN"]]) {
    assert.equal(toSerializedCustodyLocationType(v), null);
  }
});

// ══════════════════════════ THE CONTRACT ══════════════════════════

test("a stamped document validates and keeps its type", () => {
  const r = validateSerializedAssetValue({ ...VALID, currentLocationType: "BIN", currentLocationId: "bin_x" });
  assert.equal(r.valid, true);
  assert.equal(r.value.currentLocationType, "BIN");
});

test("an UNSTAMPED document is still valid, and its type is null — unknown, never WAREHOUSE", () => {
  const { currentLocationType: _omitted, ...legacy } = VALID;
  const r = validateSerializedAssetValue(legacy);
  assert.equal(r.valid, true, "documents written before the field existed are not retro-invalidated");
  assert.equal(r.value.currentLocationType, null, "null means NO WRITER STATED IT");
  assert.notEqual(r.value.currentLocationType, "WAREHOUSE", "the old default must not reappear as a value");
  // Explicit null is the same fact as absent.
  assert.equal(validateSerializedAssetValue({ ...VALID, currentLocationType: null }).value.currentLocationType, null);
});

test("an UNRECOGNIZED type fails the document closed rather than being repaired", () => {
  const r = validateSerializedAssetValue({ ...VALID, currentLocationType: "EQUIPMENT" });
  assert.equal(r.valid, false);
  assert.equal(r.reason, "current_location_type_invalid");
});

test("the read projection validates the stored type — a bad one excludes the document", () => {
  assert.notEqual(projectSerializedAsset("sa_1", { ...VALID, schemaVersion: 1 }), null);
  assert.equal(projectSerializedAsset("sa_1", { ...VALID, currentLocationType: "CUSTOMER", schemaVersion: 1 }), null);
  const { currentLocationType: _o, ...legacy } = VALID;
  assert.notEqual(projectSerializedAsset("sa_1", { ...legacy, schemaVersion: 1 }), null,
    "Available Equipment does not consult custody type, so legacy rows still read");
});

// ══════════════════════════ THE TYPED PAIR, OR NOTHING ══════════════════════════

test("both halves present -> the pair; either half missing -> nothing", () => {
  assert.deepEqual(readSerializedCustodyPair({ currentLocationId: "bin_x", currentLocationType: "BIN" }),
    { type: "BIN", locationId: "bin_x" });
  assert.equal(readSerializedCustodyPair({ currentLocationId: "wh-main" }), null, "a bare id is never a location");
  assert.equal(readSerializedCustodyPair({ currentLocationType: "WAREHOUSE" }), null);
  assert.equal(readSerializedCustodyPair({ currentLocationId: "  ", currentLocationType: "WAREHOUSE" }), null);
  assert.equal(readSerializedCustodyPair(null), null);
});

test("an unrecoverable type is REJECTED, never resolved by looking the id up", () => {
  // The id here is plainly a bin id. The pair still refuses: inferring a type from an id (or from a
  // registry read) is the second canonicalization the ruling forbids.
  assert.equal(readSerializedCustodyPair({ currentLocationId: "bin_0000000001", currentLocationType: "EQUIPMENT" }), null);
});

// ══════════════════════════ THE READER, FAILING CLOSED ══════════════════════════

const fakeDb = (data) => ({
  collection: () => ({
    where: () => ({
      where: () => ({
        get: async () => (data === null
          ? { empty: true, docs: [] }
          : { empty: false, docs: [{ data: () => data }] }),
      }),
    }),
  }),
});

test("the consumption reader returns the TYPED pair when the writer stamped it", async () => {
  const r = await readSerializedCustody(fakeDb({ currentLocationId: "bin_x", currentLocationType: "BIN" }), "part-1", "SN-1");
  assert.deepEqual(r, { type: "BIN", locationId: "bin_x" });
});

test("REGRESSION: an unstamped unit is NOT reported as a WAREHOUSE", async () => {
  // This is the defect. Before the fix this returned { type: "WAREHOUSE", locationId: "bin_x" } —
  // a warehouse whose id is a bin id, asserted to Work-Order consumption with full confidence.
  const r = await readSerializedCustody(fakeDb({ currentLocationId: "bin_x" }), "part-1", "SN-1");
  assert.equal(r, null);
});

test("the refusal path downstream is now REACHABLE, and it is the one already specified", () => {
  // readSerializedCustody returning null lands in resolveConsumptionSource's SERIAL_CUSTODY_UNKNOWN
  // branch — a rule that already existed and that the old default made unreachable for a missing type.
  const r = resolveConsumptionSource({
    workOrderId: "wo-1", partId: "part-1", requestedQuantity: 1, trackingMode: "SERIAL",
    serializedCurrentLocation: null, governedLocations: [{ type: "WAREHOUSE", locationId: "wh-main" }], placements: [],
  });
  assert.equal(r.resolved, false);
  assert.equal(r.reason, "SERIAL_CUSTODY_UNKNOWN");
});

test("a stamped unit resolves to its OWN custody, carrying the real type through", () => {
  const r = resolveConsumptionSource({
    workOrderId: "wo-1", partId: "part-1", requestedQuantity: 1, trackingMode: "SERIAL",
    serializedCurrentLocation: { type: "BIN", locationId: "bin_x" },
    governedLocations: [{ type: "WAREHOUSE", locationId: "wh-main" }], placements: [],
  });
  assert.equal(r.resolved, true);
  assert.equal(r.source.locationType, "BIN", "the bin is reported as a BIN, not as a warehouse");
  assert.equal(r.source.locationId, "bin_x");
});

// ══════════════════════════ EVERY WRITER STAMPS THE PAIR ══════════════════════════

test("RECEIPT stamps the put-away location's type, passed in rather than assumed", () => {
  const doc = buildSerializedAssetForReceipt({
    partId: "part-1", serialNo: "SN-1", locationId: "wh-main", locationType: "WAREHOUSE",
    receivingId: "rcv-1", actorId: "u1", now: new Date(1_700_000_000_000),
  });
  assert.equal(doc.currentLocationId, "wh-main");
  assert.equal(doc.currentLocationType, "WAREHOUSE");
  // And the document it builds is one the contract accepts.
  const { schemaVersion, activatedByReceivingId, createdAtMillis, createdByUid, updatedAtMillis, updatedByUid, ...value } = doc;
  assert.equal(validateSerializedAssetValue(value).valid, true);
});

test("RECEIVING refuses to activate a serial at a location that cannot hold custody", () => {
  const code = codeOnly("inventoryReceiving/receiveInventoryStockCommand.ts");
  assert.match(code, /toSerializedCustodyLocationType\(value\.receivingLocation\.type\)/);
  assert.match(code, /receiptCustodyLocationType === null[\s\S]{0,140}throw new DestinationInvalidError/);
});

test("ACQUISITION states its endpoint type ONCE — the resolver and the document read the same constant", () => {
  assert.equal(ACQUIRED_LOCATION_TYPE, "WAREHOUSE");
  assert.equal(isSerializedCustodyLocationType(ACQUIRED_LOCATION_TYPE), true);
  assert.match(codeOnly("serializedAsset/acquireSerializedAssetCommand.ts"),
    /currentLocationType: ACQUIRED_LOCATION_TYPE/);
  assert.match(codeOnly("serializedAsset/acquireCallableWiring.ts"),
    /resolveWarehouse\(txn, \{ type: ACQUIRED_LOCATION_TYPE, locationId \}\)/);
});

test("RELOCATION writes the pair, not the id alone", () => {
  const code = codeOnly("inventoryLocation/stockRelocationCommand.ts");
  assert.match(code, /currentLocationId: req\.destination\.locationId,\s*\n\s*currentLocationType: req\.destination\.type,/);
});

test("TRANSFER writes the pair, not the id alone", () => {
  const code = codeOnly("inventoryTransfer/transferOrderCommand.ts");
  assert.match(code, /currentLocationId: stored\.value\.destination\.locationId,\s*\n\s*currentLocationType: stored\.value\.destination\.type,/);
});

test("NO WRITER of currentLocationId is left without the type beside it", () => {
  // The enumeration that keeps this honest as writers are added: every `currentLocationId:` written
  // into a serialized_assets document must be followed by `currentLocationType:`. Reads and
  // comparisons (`asset.currentLocationId !== ...`) are not writes and are excluded by the colon.
  const files = [
    "serializedAsset/serializedAssetRegistration.ts",
    "serializedAsset/acquireSerializedAssetCommand.ts",
    "inventoryLocation/stockRelocationCommand.ts",
    "inventoryTransfer/transferOrderCommand.ts",
  ];
  for (const f of files) {
    const writes = [...codeOnly(f).matchAll(/currentLocationId:[^\n]*\n\s*([A-Za-z]+):/g)];
    assert.ok(writes.length > 0, `${f} should still write currentLocationId`);
    for (const w of writes) {
      assert.equal(w[1], "currentLocationType", `${f}: currentLocationId written without its type`);
    }
  }
});

test("the `?? \"WAREHOUSE\"` default is GONE from the consumption reader", () => {
  const code = codeOnly("workOrderConsumption/consumptionSourceService.ts");
  assert.doesNotMatch(code, /currentLocationType/,
    "the reader must not touch the raw field at all — it goes through the contract");
  assert.match(code, /return readSerializedCustodyPair\(data\)/);
});

// ══════════════════════════ THE STATE VOCABULARY, AS IT ACTUALLY IS ══════════════════════════
//
// `SERIALIZED_ASSET_STATES` declares 8 lifecycle states; `ops_serial_status` (migration 005) declares
// 5; the two sets overlap in only 2. The useful question is not 8-vs-5 but WHICH STATES A WRITER CAN
// ACTUALLY PRODUCE — that is the set an export has to represent, and it is smaller than both.
//
// This test computes that set from the code rather than asserting it from memory, so a lane that adds
// a writer for a currently-unreachable state trips this and has to re-decide the mapping question
// instead of silently creating an unexportable row.
import { readdirSync, statSync } from "node:fs";
const SRC = join(HERE, "..", "src");
const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const full = join(dir, n);
  return statSync(full).isDirectory() ? walk(full) : (full.endsWith(".ts") ? [full] : []);
});
const stripped = (file) =>
  readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const { RECEIPT_INVENTORY_STATE } = await import("../lib/serializedAsset/serializedAssetRegistration.js");
const { ACQUIRED_INITIAL_STATE } = await import("../lib/serializedAsset/acquireSerializedAssetCommand.js");
const { INSTALLED_STATE, INSTALLABLE_STATES } = await import("../lib/equipmentInstall/installSerializedAssetCommand.js");
const { SERIALIZED_ASSET_STATES } = await import("../lib/serializedAsset/types.js");

// Every literal `inventoryState: "X"` written anywhere in src, plus the three states named by an
// exported constant instead of a literal.
const writtenStates = new Set([RECEIPT_INVENTORY_STATE, ACQUIRED_INITIAL_STATE, INSTALLED_STATE]);
for (const f of walk(SRC).filter((f) => !f.endsWith("serializedAsset/types.ts"))) {
  for (const m of stripped(f).matchAll(/inventoryState:\s*"([A-Z_]+)"/g)) writtenStates.add(m[1]);
}

test("only FOUR of the eight declared lifecycle states can be produced by any writer", () => {
  assert.deepEqual([...writtenStates].sort(), ["AVAILABLE", "INSTALLED", "IN_TRANSIT", "RECEIVED"]);
});

test("RESERVED, STAGED, LOADED and DELIVERED are declared but UNREACHABLE — no writer exists", () => {
  for (const dead of ["RESERVED", "STAGED", "LOADED", "DELIVERED"]) {
    assert.ok(SERIALIZED_ASSET_STATES.includes(dead), `${dead} is declared`);
    assert.equal(writtenStates.has(dead), false, `${dead} must have no writer, or the export gap changed`);
  }
});

test("INSTALLABLE_STATES admits two states nothing can ever produce", () => {
  // Recorded, not "fixed": narrowing the install gate is the install command's decision, not this
  // registry's. The point here is that the "STAGED/DELIVERED are installable but unmappable to
  // ops_serial_status" hazard is UNREACHABLE — no code path can put a unit into either state.
  const unreachableButInstallable = INSTALLABLE_STATES.filter((s) => !writtenStates.has(s));
  assert.deepEqual([...unreachableButInstallable].sort(), ["DELIVERED", "RESERVED", "STAGED"]);
});

test("the two states an export cannot represent are RECEIVED and IN_TRANSIT", () => {
  // ops_serial_status, verbatim from migrations/1757808000000_eos-ops-foundation.sql:80.
  const OPS_SERIAL_STATUS = ["AVAILABLE", "RESERVED", "INSTALLED", "CONSUMED", "SCRAPPED"];
  const unmappable = [...writtenStates].filter((s) => !OPS_SERIAL_STATUS.includes(s)).sort();
  assert.deepEqual(unmappable, ["IN_TRANSIT", "RECEIVED"],
    "these are reachable in Firestore and have no SQL representation — refuse at import, never fold");
  // And the reverse gap: three enum values no Firestore writer can produce.
  const unproducible = OPS_SERIAL_STATUS.filter((s) => !writtenStates.has(s)).sort();
  assert.deepEqual(unproducible, ["CONSUMED", "RESERVED", "SCRAPPED"]);
});
