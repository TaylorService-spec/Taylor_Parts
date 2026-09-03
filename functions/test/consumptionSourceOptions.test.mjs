// Consumption source OPTIONS — the trusted projection, its limits, and what it must never leak.
// Run: node --test test/consumptionSourceOptions.test.mjs   (pure — no emulator)
//
// Decision #171's whole claim is that a technician can now name a source WITHOUT being granted any
// standing inventory or location read. The security assertions at the end are the ones that make
// that claim checkable rather than merely stated: Rules unchanged, no balances, no other technician's
// truck.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (rel) => readFileSync(join(HERE, "..", "src", rel), "utf8");
const codeOnly = (rel) =>
  src(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const { projectConsumptionSourceOptions, isOfferedSource } = await import(
  "../lib/workOrderConsumption/consumptionSourceOptions.js"
);
const { PHYSICAL_CONSUMPTION_ACTIVE } = await import("../lib/workOrderConsumption/consumptionActivation.js");

const WH_A = "wh-a";
const WH_B = "wh-b";
const TRUCK = "truck-7-loc";
const WAREHOUSES = [
  { warehouseId: WH_A, name: "Phoenix Warehouse", status: "ACTIVE" },
  { warehouseId: WH_B, name: "Tucson Warehouse", status: "ACTIVE" },
];
const MOBILE = { locationId: TRUCK, label: "Truck 7", truckId: "truck-7" };
const project = (over = {}) =>
  projectConsumptionSourceOptions({
    trackingMode: "NONE", pickedSource: null, pickUnavailableReason: "SOURCE_REQUIRED",
    serializedCurrentLocation: null, warehouses: WAREHOUSES, mobile: MOBILE, ...over,
  });

// ══════════════════════════ THE PICK DEFAULT ══════════════════════════

test("an unambiguous pick is PRE-SELECTED, labelled, and still overridable", () => {
  const o = project({ pickedSource: { locationId: WH_A, locationType: "WAREHOUSE" }, pickUnavailableReason: null });
  assert.equal(o.autoSource.locationId, WH_A);
  assert.equal(o.autoSource.label, "Phoenix Warehouse", "a name, never a raw id");
  assert.equal(o.autoSource.method, "PICK");
  assert.equal(o.sourceRequired, false, "pre-selected, so the technician is not blocked");
  // Required means "cannot proceed without choosing", NOT "cannot change" — the ruling's override.
  assert.ok(o.selectableSources.some((s) => s.locationId === WH_B), "another warehouse is still offerable");
  assert.ok(o.selectableSources.some((s) => s.locationId === TRUCK), "and so is the truck");
});

test("no pick means the technician MUST choose, and the reason is carried", () => {
  const o = project({ pickUnavailableReason: "SOURCE_AMBIGUOUS" });
  assert.equal(o.autoSource, null);
  assert.equal(o.sourceRequired, true);
  assert.equal(o.autoSourceUnavailableReason, "SOURCE_AMBIGUOUS", "so the screen can say WHY, not just 'choose one'");
});

// ══════════════════════════ WHAT IS OFFERED ══════════════════════════

test("only ACTIVE warehouses and the technician's OWN truck are offered", () => {
  const o = project();
  assert.deepEqual(o.selectableSources.map((s) => s.locationId).sort(), [TRUCK, WH_A, WH_B].sort());
  assert.equal(o.selectableSources.find((s) => s.locationId === TRUCK).locationType, "MOBILE");
});

test("ANOTHER technician's truck cannot be offered — there is no parameter for one", () => {
  // Structural, and stronger than a filter: the projection accepts exactly ONE mobile candidate,
  // which the caller resolves from the driver assignment. A second truck has no way in.
  const source = codeOnly("workOrderConsumption/consumptionSourceOptions.ts");
  assert.ok(!/mobiles|mobileList|trucks\s*:/.test(source), "there must be no plural mobile input");
  const o = project({ mobile: null });
  assert.equal(o.selectableSources.filter((s) => s.locationType === "MOBILE").length, 0, "no truck, no option");
});

test("no assigned truck simply means no MOBILE option, not a failure", () => {
  const o = project({ mobile: null });
  assert.equal(o.selectableSources.length, 2, "the warehouses remain");
});

test("a label falls back to the id only when no governed name exists — visibly, not silently", () => {
  const o = project({ warehouses: [{ warehouseId: WH_A, name: null, status: "ACTIVE" }] });
  assert.equal(o.selectableSources[0].label, WH_A, "an unnamed location shows its id rather than a blank or a guess");
});

// ══════════════════════════ SERIALIZED ══════════════════════════

test("a serialized unit is DISPLAYED, never selectable", () => {
  const o = project({ trackingMode: "SERIAL", serializedCurrentLocation: { locationId: TRUCK, locationType: "MOBILE" } });
  assert.equal(o.serializedSource.locationId, TRUCK);
  assert.equal(o.serializedSource.label, "Truck 7");
  assert.equal(o.serializedSource.method, "SERIALIZED_CUSTODY");
  assert.deepEqual(o.selectableSources, [], "offering a choice would invite a contradiction #168 refuses");
  assert.equal(o.autoSource, null);
});

test("a serialized unit with unknown custody offers nothing AND does not ask", () => {
  // sourceRequired would be a lie: there is nothing the technician could pick that would succeed.
  const o = project({ trackingMode: "SERIAL", serializedCurrentLocation: null });
  assert.equal(o.serializedSource, null);
  assert.deepEqual(o.selectableSources, []);
  assert.equal(o.sourceRequired, false);
  assert.equal(o.autoSourceUnavailableReason, "SERIAL_CUSTODY_UNKNOWN");
});

// ══════════════════════════ SUBMIT-TIME REVALIDATION ══════════════════════════

test("a submitted source must be one that was actually offered", () => {
  const o = project({ pickedSource: { locationId: WH_A, locationType: "WAREHOUSE" }, pickUnavailableReason: null });
  assert.equal(isOfferedSource(o, WH_A), true);
  assert.equal(isOfferedSource(o, TRUCK), true);
  assert.equal(isOfferedSource(o, "wh-not-offered"), false);
  assert.equal(isOfferedSource(o, ""), false);
  assert.equal(isOfferedSource(o, null), false);
});

test("for a serialized unit, ONLY its custody location is acceptable", () => {
  const o = project({ trackingMode: "SERIAL", serializedCurrentLocation: { locationId: WH_A, locationType: "WAREHOUSE" } });
  assert.equal(isOfferedSource(o, WH_A), true);
  assert.equal(isOfferedSource(o, WH_B), false, "a contradicting source is refused even though WH_B is a real warehouse");
});

// ══════════════════════════ WHAT IT MUST NEVER LEAK ══════════════════════════

test("NO inventory quantity of any kind appears in a source option", () => {
  // The line between "identify the source" and "an inventory visibility surface". A quantity field
  // here would make the picker a report, which is the read this design exists to avoid granting.
  const o = project({ pickedSource: { locationId: WH_A, locationType: "WAREHOUSE" }, pickUnavailableReason: null });
  const everyOption = [o.autoSource, ...o.selectableSources].filter(Boolean);
  assert.ok(everyOption.length > 0);
  for (const option of everyOption) {
    assert.deepEqual(Object.keys(option).sort(), ["label", "locationId", "locationType", "method"]);
  }
  // The exhaustive key check above is the real assertion. This backs it at the source level, matched
  // as FIELD NAMES rather than as substrings — an earlier version banned the word "available" and
  // fired on `autoSourceUnavailableReason`, which is a reason string, not a quantity.
  const source = codeOnly("workOrderConsumption/consumptionSourceOptions.ts");
  for (const banned of ["onHand", "availableQuantity", "reservedQuantity", "quantity", "balance", "atp"]) {
    assert.ok(
      !new RegExp(`\\b${banned}\\b`, "i").test(source),
      `a source option must not carry ${banned}`,
    );
  }
});

test("firestore.rules is UNCHANGED — no client read was widened to make this work", () => {
  // The claim the whole design rests on. If this ever fails, the trusted projection was abandoned in
  // favour of a grant, and Decision #171's reasoning no longer holds.
  const rules = readFileSync(join(HERE, "..", "..", "firestore.rules"), "utf8");
  const warehouses = rules.slice(rules.indexOf("match /warehouses/"), rules.indexOf("match /warehouses/") + 260);
  assert.match(warehouses, /allow read: if isAdminOrDispatcher\(\) \|\| isAssignedToWarehouse\(warehouseId\);/);
  const mobile = rules.slice(rules.indexOf("match /mobile_locations/"), rules.indexOf("match /mobile_locations/") + 220);
  assert.match(mobile, /allow read: if isAdminOrDispatcher\(\);/);
  // And bin_placements still has no match block at all — deny-all by absence.
  assert.ok(!/match \/bin_placements\//.test(rules));
});

test("the trusted read is gated by the SAME actor boundary that records usage", () => {
  const callable = codeOnly("workOrderConsumption/consumptionSourceCallables.ts");
  assert.match(callable, /caller\.role !== "technician"/, "technician only");
  assert.match(callable, /wo\.assignedTechId !== caller\.technicianId/, "and assigned to THIS work order");
  assert.match(callable, /TERMINAL_STATUSES/, "and not on a terminal work order");
});

test("two trucks for one driver FAILS CLOSED rather than picking one", () => {
  const service = codeOnly("workOrderConsumption/consumptionSourceService.ts");
  assert.match(service, /snap\.docs\.length > 1\) return \{ mobile: null, ambiguous: true \}/);
  assert.ok(!/snap\.docs\[0\]\.data\(\)[\s\S]{0,80}length > 1/.test(service), "it must not read one before checking for two");
});

// ══════════════════════════ ACTIVATION ══════════════════════════

test("PHYSICAL CONSUMPTION IS NOW ACTIVE", () => {
  // Pinned deliberately. #1772 shipped this false with a named blocker; #169 closed the blocker, so
  // the value moved. If it ever returns to false, that is a decision someone must argue for.
  assert.equal(PHYSICAL_CONSUMPTION_ACTIVE, true);
});

test("the gate still EXISTS — it was flipped, not deleted", () => {
  // One place answers "is physical consumption live?", and turning it off is how this is reverted
  // without unpicking a transaction.
  const activation = src("workOrderConsumption/consumptionActivation.ts");
  assert.match(activation, /export const PHYSICAL_CONSUMPTION_ACTIVE/);
  const command = codeOnly("updateWorkOrderExecutionData.ts");
  assert.match(command, /if \(PHYSICAL_CONSUMPTION_ACTIVE\)/, "the command still consults it");
});
