// Turning ids into words, and refusing to invent any.
//
// The governed Available Equipment read returns six fields and none of them is a product name. This
// module is what stands between that and a screen showing `CW-WU-TAYLOR--C161 — S/N CW-C713-0005`.
// The tests below are mostly about the failure directions: what happens when the Part has not
// loaded, when a manufacturer is not one this business classifies, and when an id is not canonical.
import test from "node:test";
import assert from "node:assert/strict";
import {
  LINE_OF_BUSINESS, LINE_LABEL,
  parseEquipmentModelId, indexWholeUnitParts,
  composeWholeUnitAssetRow, composeWholeUnitAssetRows,
  countAvailableByLine, groupRowsByLine,
} from "../src/domain/wholeUnitAssetDisplay.js";

const taylorPart = {
  partId: "CW-WU-TAYLOR--C161", wholeUnit: true, name: "Taylor C161",
  category: "Whole Unit Equipment", equipmentModelId: "TAYLOR--C161",
};
const icetroPart = {
  partId: "CW-WU-ICETRO--IM-0460-AH", wholeUnit: true, name: "Icetro IM-0460-AH",
  category: "Whole Unit Equipment", equipmentModelId: "ICETRO--IM-0460-AH",
};
const asset = (over = {}) => ({
  serialNo: "CW-C161-0001", partId: taylorPart.partId, currentLocationId: "wh-main",
  inventoryState: "AVAILABLE", currentEquipmentId: null, ownership: "COMPANY", ...over,
});

// ── IDENTITY IS THE SOURCE ────────────────────────────────────────────────────────────────────

test("manufacturer and model are recovered from the canonical registry id", () => {
  // Not read from a second field. The id IS the registry's identity, so both halves are exact.
  assert.deepEqual(parseEquipmentModelId("TAYLOR--C161"), {
    manufacturerId: "TAYLOR", modelNumber: "C161", manufacturer: "Taylor",
    lineOfBusiness: LINE_OF_BUSINESS.TAYLOR,
  });
});

test("a model number containing hyphens survives the split", () => {
  // IM-0460-AH-22 is a real Icetro model. A naive split on "-" would mangle it; the separator is
  // "--" and the test exists because that distinction is easy to lose in a refactor.
  const parsed = parseEquipmentModelId("ICETRO--IM-0460-AH-22");
  assert.equal(parsed.modelNumber, "IM-0460-AH-22");
  assert.equal(parsed.manufacturer, "Icetro");
});

test("a NON-canonical id yields null, never a guess", () => {
  // The old certification scheme, and every other shape. Inventing a manufacturer from an
  // unrecognised id would hide a defect somewhere upstream behind a plausible label.
  for (const id of ["cw-model-taylor-c713", "TAYLOR-C161", "TAYLOR--", "--C161", "", null, undefined, 42]) {
    assert.equal(parseEquipmentModelId(id), null, `${String(id)} should not parse`);
  }
});

test("Icetro maps to Ventana, and an unclassified manufacturer maps to UNKNOWN", () => {
  // The one thing NOT derived. "Icetro is Ventana's line" is a fact about how this company is
  // organised; a manufacturer nobody has classified must not be filed under whichever line is first.
  assert.equal(parseEquipmentModelId("ICETRO--IM-0460-AH").lineOfBusiness, LINE_OF_BUSINESS.VENTANA);
  assert.equal(parseEquipmentModelId("TAYLOR--C161").lineOfBusiness, LINE_OF_BUSINESS.TAYLOR);
  assert.equal(parseEquipmentModelId("ACMECORP--X1").lineOfBusiness, LINE_OF_BUSINESS.UNKNOWN);
});

// ── THE PART JOIN ─────────────────────────────────────────────────────────────────────────────

test("only WHOLE-UNIT Parts are indexed", () => {
  // A service part cannot describe a machine. Letting one through would put a drive belt's name on
  // a unit somebody is about to install at a customer.
  const index = indexWholeUnitParts([
    taylorPart,
    { partId: "CW-P-0000", wholeUnit: false, name: "Evaporator Fan Motor" },
    { partId: "CW-P-0001", name: "Door Gasket" },
  ]);
  assert.equal(index.size, 1);
  assert.ok(index.has(taylorPart.partId));
});

test("the PRIMARY LABEL is the product, and the serial sits beside it", () => {
  const row = composeWholeUnitAssetRow(asset(), indexWholeUnitParts([taylorPart]));
  assert.equal(row.title, "Taylor C161");
  assert.equal(row.serialNo, "CW-C161-0001");
  assert.equal(row.manufacturer, "Taylor");
  assert.equal(row.modelNumber, "C161");
  assert.equal(row.lineLabel, LINE_LABEL[LINE_OF_BUSINESS.TAYLOR]);
});

test("a Part with no name still produces a readable title from its model identity", () => {
  const row = composeWholeUnitAssetRow(asset(), indexWholeUnitParts([{ ...taylorPart, name: null }]));
  assert.equal(row.title, "Taylor C161");
});

test("A UNIT WHOSE PART HAS NOT LOADED STILL APPEARS", () => {
  // The failure direction that matters most. If the Part read is denied or slow, the person deciding
  // what to install needs the machines more than they need the words -- so the row degrades to the
  // raw part id and an unclassified line rather than vanishing.
  const row = composeWholeUnitAssetRow(asset(), new Map());
  assert.equal(row.title, "CW-WU-TAYLOR--C161");
  assert.equal(row.lineOfBusiness, LINE_OF_BUSINESS.UNKNOWN);
  assert.equal(row.serialNo, "CW-C161-0001");
  assert.equal(row.available, true, "the unit is still installable; only its label is missing");
});

test("an unresolved location renders its raw id AND says it is unresolved", () => {
  const withLabel = composeWholeUnitAssetRow(asset({ locationLabel: "Main Distribution Center" }), new Map());
  assert.equal(withLabel.location, "Main Distribution Center");
  assert.equal(withLabel.locationResolved, true);

  const withoutLabel = composeWholeUnitAssetRow(asset(), new Map());
  assert.equal(withoutLabel.location, "wh-main");
  assert.equal(withoutLabel.locationResolved, false, "an id must not be presented as a place name");
});

// ── AVAILABILITY IS DERIVED FROM BOTH HALVES ──────────────────────────────────────────────────

test("available means AVAILABLE *and* belonging to nobody", () => {
  const parts = indexWholeUnitParts([taylorPart]);
  assert.equal(composeWholeUnitAssetRow(asset(), parts).available, true);
  // Either half alone has been wrong somewhere in this platform's history, so both are required.
  assert.equal(composeWholeUnitAssetRow(asset({ inventoryState: "INSTALLED" }), parts).available, false);
  assert.equal(composeWholeUnitAssetRow(asset({ currentEquipmentId: "eq_1" }), parts).available, false);
  assert.equal(composeWholeUnitAssetRow(asset({ inventoryState: "IN_TRANSIT" }), parts).available, false);
});

test("an installed unit still reports which Equipment it became", () => {
  const row = composeWholeUnitAssetRow(
    asset({ inventoryState: "INSTALLED", currentEquipmentId: "eq_abc" }), indexWholeUnitParts([taylorPart]));
  assert.equal(row.installedEquipmentId, "eq_abc");
  assert.equal(row.available, false);
});

// ── COUNTS AND GROUPING ───────────────────────────────────────────────────────────────────────

test("counts are per line and count ONLY available units", () => {
  // A total that quietly included an installed machine is the same category error as counting truck
  // stock as warehouse stock.
  const rows = composeWholeUnitAssetRows([
    asset(), asset({ serialNo: "T2" }),
    asset({ serialNo: "T3", inventoryState: "INSTALLED", currentEquipmentId: "eq_x" }),
    asset({ serialNo: "I1", partId: icetroPart.partId }),
  ], [taylorPart, icetroPart]);
  const counts = countAvailableByLine(rows);
  assert.equal(counts[LINE_OF_BUSINESS.TAYLOR], 2);
  assert.equal(counts[LINE_OF_BUSINESS.VENTANA], 1);
  assert.equal(rows.length, 4, "the installed unit is still listed, just not counted as available");
});

test("groups are ordered Taylor, Ventana, unclassified -- and empty lines are omitted", () => {
  const rows = composeWholeUnitAssetRows(
    [asset({ serialNo: "I1", partId: icetroPart.partId }), asset()], [taylorPart, icetroPart]);
  const groups = groupRowsByLine(rows);
  assert.deepEqual(groups.map((g) => g.lineOfBusiness), [LINE_OF_BUSINESS.TAYLOR, LINE_OF_BUSINESS.VENTANA]);
  assert.deepEqual(groups.map((g) => g.label),
    [LINE_LABEL[LINE_OF_BUSINESS.TAYLOR], LINE_LABEL[LINE_OF_BUSINESS.VENTANA]]);
});

test("the Ventana label names Icetro too", () => {
  // A user looking at an Icetro machine should not need to know the business relationship to
  // recognise which line it belongs to.
  assert.match(LINE_LABEL[LINE_OF_BUSINESS.VENTANA], /Icetro/);
});

test("empty and malformed inputs produce empty output, never a throw", () => {
  for (const input of [null, undefined, "nope", 7, {}]) {
    assert.deepEqual(composeWholeUnitAssetRows(input, [taylorPart]), []);
    assert.deepEqual(groupRowsByLine(input), []);
  }
  assert.equal(indexWholeUnitParts(null).size, 0);
});
