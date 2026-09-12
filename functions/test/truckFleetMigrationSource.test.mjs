// Truck / MOBILE-location migration source — the PURE proofs. Offline, no database, no emulator.
//
// The load-bearing test in this file is "the authored company wins over the warehouse-derived one":
// it runs against the REAL config/ownership/operating-company-roots.sandbox.json and the REAL
// certification fixture data, and it fails if anyone reintroduces the homeWarehouseId derivation.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COMPANY_RESOLUTION,
  MIGRATION_READINESS,
  TRUCK_FLEET_OUTCOMES,
  isDefectOutcome,
  loadOperatingCompanyRoots,
  resolveOperatingCompanyForMobileLocation,
  planTruckFleetMigration,
} from "../lib/eosOps/migration/truckFleetMigrationSource.js";
import {
  loadOperatingCompanyConfig as crosswalkLoadConfig,
  resolveOperatingCompanyForMobileLocation as crosswalkResolve,
} from "../../scripts/employeeTruckCrosswalk.lib.mjs";
import { BACKFILL_RULES, AUTHORIZED_WRITE_CAPS } from "../lib/ownership/ownershipBackfillRules.js";

const REPO_ROOT = join(process.cwd(), "..");
const ROOTS_PATH = join(REPO_ROOT, "config/ownership/operating-company-roots.sandbox.json");
const AUTHORED = JSON.parse(readFileSync(ROOTS_PATH, "utf8"));
const CONFIG = loadOperatingCompanyRoots(AUTHORED, { label: "operating-company-roots.sandbox.json" });

const TENANT = "tenant-c4";
const ACTOR = "uid-migrator";

const mobileDoc = (id, over = {}) => ({
  id,
  data: { locationId: id, type: "MOBILE", displayLabel: `Label ${id}`, active: true, ...over },
});
const truckDoc = (id, over = {}) => ({
  id,
  data: {
    truckId: id,
    locationId: null,
    homeWarehouseId: "wh-main",
    status: "ACTIVE",
    active: true,
    assignedDriverEmployeeId: null,
    displayLabel: `Truck ${id}`,
    vehicleNumber: id,
    ...over,
  },
});
const claimDoc = (locationId, truckId) => ({ id: locationId, data: { locationId, truckId } });

const plan = (over = {}) =>
  planTruckFleetMigration({
    tenantId: TENANT,
    actorId: ACTOR,
    mobileLocations: [],
    trucks: [],
    claims: [],
    operatingCompanyConfig: CONFIG,
    ...over,
  });

// ============================ the company is authored, and the warehouse answer is wrong ============================

test("the authored file is the only company input, and it contradicts the warehouse answer for 2 of the 5 cert trucks", () => {
  // Every cert-trk MOBILE location is homed at wh-main, which the same file authors as `taylor`.
  const warehouses = AUTHORED.roots.warehouses;
  assert.equal(warehouses.find((w) => w.id === "wh-main").operatingCompanyId, "taylor");

  const certFixtures = [
    ["cert-trk-01", "taylor"],
    ["cert-trk-02", "taylor"],
    ["cert-trk-03", "taylor"],
    ["cert-trk-04", "ventana"],
    ["cert-trk-05", "ventana"],
  ];
  for (const [id, expected] of certFixtures) {
    const resolved = resolveOperatingCompanyForMobileLocation(id, CONFIG);
    assert.equal(resolved.state, COMPANY_RESOLUTION.RESOLVED, id);
    assert.equal(resolved.operatingCompanyId, expected, id);
  }
  // The proof: a homeWarehouseId-derived answer would be `taylor` for all five, so it is wrong twice.
  const wrongIfDerived = certFixtures.filter(([, expected]) => expected !== "taylor");
  assert.equal(wrongIfDerived.length, 2, "cert-trk-04 and cert-trk-05 are ventana despite a taylor home warehouse");
});

test("the resolver's only inputs are an id and the authored config -- a warehouse cannot reach it", () => {
  // A warehouse id is not a PARAMETER, so no caller can pass one even by accident...
  assert.equal(resolveOperatingCompanyForMobileLocation.length, 2);
  // ...and the function body mentions no warehouse at all, so it cannot reach for one either.
  const body = resolveOperatingCompanyForMobileLocation.toString();
  assert.doesNotMatch(body, /warehouse/i);
  assert.doesNotMatch(loadOperatingCompanyRoots.toString(), /warehouse/i, "roots.warehouses is never parsed");

  // Across the whole module, `homeWarehouseId` appears only where the truck's DESCRIPTIVE column is
  // read -- never on a line that also produces a company answer.
  const source = readFileSync("src/eosOps/migration/truckFleetMigrationSource.ts", "utf8");
  const executable = source.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line));
  const warehouseLines = executable
    // The reconciliation marker `homeWarehouseIdUsedForCompany: false` is the DECLARATION that this
    // never happens, so it is the one line allowed to name both.
    .filter((line) => !line.includes("homeWarehouseIdUsedForCompany"))
    .filter((line) => /warehouse/i.test(line));
  assert.ok(warehouseLines.length > 0, "the truck's descriptive homeWarehouseId is carried");
  for (const line of warehouseLines) {
    assert.doesNotMatch(line, /company/i, `a warehouse must never appear in a company answer: ${line.trim()}`);
  }
});

test("it agrees with scripts/employeeTruckCrosswalk.lib.mjs on every authored id -- one company rule, two callers", () => {
  const crosswalkConfig = crosswalkLoadConfig(AUTHORED, { label: "parity" });
  const ids = [...CONFIG.mobileLocations.keys()];
  assert.ok(ids.length >= 7, "the authored file names at least the seven live MOBILE locations");
  for (const id of [...ids, "no-such-mobile-location", ""]) {
    const mine = resolveOperatingCompanyForMobileLocation(id, CONFIG);
    const theirs = crosswalkResolve(id, crosswalkConfig);
    assert.equal(mine.operatingCompanyId, theirs.operatingCompanyId, `company for ${id}`);
    if (theirs.state !== "NOT_APPLICABLE") assert.equal(mine.state, theirs.state, `state for ${id}`);
  }
});

test("malformed, ungoverned and contradictory authoring all CONFLICT; an unauthored id MISSES", () => {
  const config = loadOperatingCompanyRoots({
    governedCompanyIds: ["taylor", "ventana"],
    roots: {
      mobile_locations: [
        { id: "m-malformed", operatingCompanyId: "Taylor Freezer" },
        { id: "m-ungoverned", operatingCompanyId: "acme" },
        { id: "m-twice", operatingCompanyId: "taylor" },
        { id: "m-twice", operatingCompanyId: "ventana" },
        { operatingCompanyId: "taylor" },
      ],
    },
  });
  for (const id of ["m-malformed", "m-ungoverned", "m-twice"]) {
    assert.equal(resolveOperatingCompanyForMobileLocation(id, config).state, COMPANY_RESOLUTION.CONFLICT, id);
  }
  assert.equal(resolveOperatingCompanyForMobileLocation("m-unknown", config).state, COMPANY_RESOLUTION.MISSING);
  assert.deepEqual(
    config.conflicts.map((c) => c.reason).sort(),
    ["AUTHORED_COMPANY_ID_MALFORMED", "AUTHORED_COMPANY_ID_NOT_GOVERNED", "AUTHORED_ENTRY_WITHOUT_ID", "AUTHORED_ID_ASSIGNED_TWICE"],
  );
});

// ============================ refusal, not a guess ============================

test("a MOBILE location with no authored company REFUSES the whole migration and plans nothing", () => {
  const result = plan({ mobileLocations: [mobileDoc("mobile-unauthored-99")] });
  assert.equal(result.readiness, MIGRATION_READINESS.REFUSE);
  assert.deepEqual(result.defects.map((d) => d.outcome), [TRUCK_FLEET_OUTCOMES.MISSING_OPERATING_COMPANY_MAPPING]);
  assert.deepEqual(result.mobileLocationRows, []);
  assert.deepEqual(result.truckRows, []);
  assert.equal(result.reconciliation.mobileLocationsPlanned, 0);
  assert.equal(result.reconciliation.balanced, false);
});

test("one defect refuses everything -- there is no partial import of a registry", () => {
  const result = plan({
    mobileLocations: [mobileDoc("cert-trk-01"), mobileDoc("mobile-unauthored-99")],
  });
  assert.equal(result.readiness, MIGRATION_READINESS.REFUSE);
  assert.equal(result.mobileLocationRows.length, 0, "the good record is not imported alongside the bad one");
});

test("every outcome except CLEAN and MOBILE_WITHOUT_TRUCK is a defect", () => {
  const nonDefects = Object.values(TRUCK_FLEET_OUTCOMES).filter((o) => !isDefectOutcome(o));
  assert.deepEqual(nonDefects.sort(), ["CLEAN", "MOBILE_WITHOUT_TRUCK"]);
});

// ============================ the 5 company-less, truck-less live MOBILE locations ============================

test("the five cert MOBILE locations import with no truck, no claim, and an authored company each", () => {
  const ids = ["cert-trk-01", "cert-trk-02", "cert-trk-03", "cert-trk-04", "cert-trk-05"];
  const result = plan({ mobileLocations: ids.map((id) => mobileDoc(id)) });

  assert.equal(result.readiness, MIGRATION_READINESS.PROCEED);
  assert.equal(result.reconciliation.balanced, true);
  assert.equal(result.mobileLocationRows.length, 5);
  assert.equal(result.reconciliation.trucksPlanned, 0);
  assert.equal(result.reconciliation.claimRowsPlanned, 0);
  assert.equal(result.reconciliation.mobileLocationsWithoutTruck, 5);
  assert.deepEqual(
    result.observations.map((o) => o.outcome),
    Array(5).fill(TRUCK_FLEET_OUTCOMES.MOBILE_WITHOUT_TRUCK),
    "no truck is a fact about these records, not a defect",
  );
  // The authored split survives the plan -- 3 taylor, 2 ventana, despite one shared home warehouse.
  assert.deepEqual(result.reconciliation.companiesPlanned, { taylor: 3, ventana: 2 });
  assert.equal(result.reconciliation.homeWarehouseIdUsedForCompany, false);
});

// ============================ ids are carried verbatim ============================

test("all three live id conventions survive unchanged", () => {
  const ids = ["cert-trk-01", "mobile-seed1786749487428-101", "mobile-seed1786749487428-102"];
  const result = plan({ mobileLocations: ids.map((id) => mobileDoc(id)) });
  assert.equal(result.readiness, MIGRATION_READINESS.PROCEED);
  assert.deepEqual(result.mobileLocationRows.map((r) => r.locationId), ids);
  assert.equal(result.reconciliation.idsRewritten, 0);
  for (const row of result.mobileLocationRows) assert.equal(row.locationType, "MOBILE");
});

// ============================ the 1:1 relationship ============================

test("a linked truck plans the typed pair, and its claim reconciles to zero claim rows", () => {
  const result = plan({
    mobileLocations: [mobileDoc("cert-trk-01")],
    trucks: [truckDoc("TRK-1", { locationId: "cert-trk-01" })],
    claims: [claimDoc("cert-trk-01", "TRK-1")],
  });
  assert.equal(result.readiness, MIGRATION_READINESS.PROCEED);
  assert.equal(result.truckRows[0].mobileLocationType, "MOBILE");
  assert.equal(result.truckRows[0].mobileLocationId, "cert-trk-01");
  assert.equal(result.reconciliation.claimsIn, 1);
  assert.equal(result.reconciliation.claimsReconciled, 1);
  assert.equal(result.reconciliation.claimRowsPlanned, 0, "the claim collection is retired, not imported");
  assert.equal(result.reconciliation.linkedTrucks, 1);
  assert.equal(result.reconciliation.balanced, true);
});

test("two trucks claiming one MOBILE location refuse -- the 1:1 did not hold in the source", () => {
  const result = plan({
    mobileLocations: [mobileDoc("cert-trk-01")],
    trucks: [truckDoc("TRK-1", { locationId: "cert-trk-01" }), truckDoc("TRK-2", { locationId: "cert-trk-01" })],
    claims: [claimDoc("cert-trk-01", "TRK-1")],
  });
  assert.equal(result.readiness, MIGRATION_READINESS.REFUSE);
  assert.ok(result.defects.some((d) => d.outcome === TRUCK_FLEET_OUTCOMES.TRUCK_LOCATION_ALREADY_LINKED));
});

test("a claim that names a different truck than the truck's own link refuses", () => {
  const result = plan({
    mobileLocations: [mobileDoc("cert-trk-01"), mobileDoc("cert-trk-02")],
    trucks: [truckDoc("TRK-1", { locationId: "cert-trk-01" }), truckDoc("TRK-2", { locationId: "cert-trk-02" })],
    claims: [claimDoc("cert-trk-01", "TRK-2"), claimDoc("cert-trk-02", "TRK-2")],
  });
  assert.equal(result.readiness, MIGRATION_READINESS.REFUSE);
  assert.ok(result.defects.some((d) => d.outcome === TRUCK_FLEET_OUTCOMES.CLAIM_DISAGREES_WITH_TRUCK));
});

test("a linked truck with no guarding claim refuses, and a claim naming no truck refuses", () => {
  const noClaim = plan({
    mobileLocations: [mobileDoc("cert-trk-01")],
    trucks: [truckDoc("TRK-1", { locationId: "cert-trk-01" })],
    claims: [],
  });
  assert.ok(noClaim.defects.some((d) => d.outcome === TRUCK_FLEET_OUTCOMES.MISSING_CLAIM_FOR_LINKED_TRUCK));

  const orphanClaim = plan({
    mobileLocations: [mobileDoc("cert-trk-01")],
    claims: [claimDoc("cert-trk-01", "TRK-GONE")],
  });
  assert.ok(orphanClaim.defects.some((d) => d.outcome === TRUCK_FLEET_OUTCOMES.CLAIM_WITHOUT_TRUCK));
});

test("a truck pointing at a MOBILE location that is not importable refuses rather than dropping the link", () => {
  const result = plan({ trucks: [truckDoc("TRK-1", { locationId: "cert-trk-01" })] });
  assert.equal(result.readiness, MIGRATION_READINESS.REFUSE);
  assert.deepEqual(result.defects.map((d) => d.outcome), [TRUCK_FLEET_OUTCOMES.TRUCK_LOCATION_NOT_FOUND]);
});

// ============================ the lifecycle biconditional ============================

test("OUT_OF_SERVICE with active=true refuses, and so does ACTIVE with active=false", () => {
  for (const over of [{ status: "OUT_OF_SERVICE", active: true }, { status: "ACTIVE", active: false }]) {
    const result = plan({ trucks: [truckDoc("TRK-1", over)] });
    assert.equal(result.readiness, MIGRATION_READINESS.REFUSE, JSON.stringify(over));
    assert.deepEqual(result.defects.map((d) => d.outcome), [TRUCK_FLEET_OUTCOMES.TRUCK_STATUS_CONTRADICTS_ACTIVE]);
  }
  const ok = plan({ trucks: [truckDoc("TRK-1", { status: "OUT_OF_SERVICE", active: false })] });
  assert.equal(ok.readiness, MIGRATION_READINESS.PROCEED);
});

// ============================ the driver is reported, not carried ============================

test("a truck's driver assignment is counted as a handoff fact and appears in no planned row", () => {
  const result = plan({ trucks: [truckDoc("TRK-1", { assignedDriverEmployeeId: "emp-7" })] });
  assert.equal(result.readiness, MIGRATION_READINESS.PROCEED);
  assert.equal(result.reconciliation.trucksWithDriverNotCarried, 1);
  assert.equal(Object.keys(result.truckRows[0]).some((k) => /driver|employee/i.test(k)), false);
});

// ============================ malformed source records ============================

test("a record the Firestore repository would itself reject is named, not silently repaired", () => {
  const cases = [
    [mobileDoc("cert-trk-01", { type: "WAREHOUSE" }), TRUCK_FLEET_OUTCOMES.MALFORMED_MOBILE_LOCATION],
    [mobileDoc("cert-trk-01", { displayLabel: "  " }), TRUCK_FLEET_OUTCOMES.MALFORMED_MOBILE_LOCATION],
    [mobileDoc("cert-trk-01", { locationId: "somewhere-else" }), TRUCK_FLEET_OUTCOMES.MALFORMED_MOBILE_LOCATION],
    [mobileDoc("cert-trk-01", { active: "yes" }), TRUCK_FLEET_OUTCOMES.MALFORMED_MOBILE_LOCATION],
  ];
  for (const [doc, outcome] of cases) {
    const result = plan({ mobileLocations: [doc] });
    assert.equal(result.readiness, MIGRATION_READINESS.REFUSE);
    assert.deepEqual(result.defects.map((d) => d.outcome), [outcome], JSON.stringify(doc.data));
  }
});

test("a truck missing a required governed field refuses", () => {
  for (const over of [{ vehicleNumber: "" }, { displayLabel: "" }, { homeWarehouseId: "" }, { status: "PARKED" }]) {
    const result = plan({ trucks: [truckDoc("TRK-1", over)] });
    assert.deepEqual(result.defects.map((d) => d.outcome), [TRUCK_FLEET_OUTCOMES.MALFORMED_TRUCK], JSON.stringify(over));
  }
});

test("a duplicated source id refuses rather than letting the last write win", () => {
  const result = plan({ mobileLocations: [mobileDoc("cert-trk-01"), mobileDoc("cert-trk-01")] });
  assert.ok(result.defects.some((d) => d.outcome === TRUCK_FLEET_OUTCOMES.DUPLICATE_SOURCE_ID));
});

// ============================ determinism ============================

test("the same input always yields the same plan", () => {
  const input = {
    mobileLocations: [mobileDoc("cert-trk-02"), mobileDoc("cert-trk-01")],
    trucks: [truckDoc("TRK-2", { locationId: "cert-trk-02" }), truckDoc("TRK-1", { locationId: "cert-trk-01" })],
    claims: [claimDoc("cert-trk-01", "TRK-1"), claimDoc("cert-trk-02", "TRK-2")],
  };
  assert.deepEqual(plan(input), plan(input));
  assert.deepEqual(plan(input).mobileLocationRows.map((r) => r.locationId), ["cert-trk-02", "cert-trk-01"]);
});

// ============================ the retired backfill rule stays retired ============================

test("no ownership backfill rule derives a truck's or a MOBILE location's company from a root", () => {
  const collections = BACKFILL_RULES.map((r) => r.collection);
  assert.equal(collections.includes("trucks"), false, "a truck's company is never derived from its home warehouse");
  assert.equal(collections.includes("mobile_locations"), false, "a MOBILE location's company is authored, not derived");
  assert.equal("trucks" in AUTHORIZED_WRITE_CAPS, false, "and no cap authorizes writes the retired rule would have made");
  assert.equal("mobile_locations" in AUTHORIZED_WRITE_CAPS, false);
});
