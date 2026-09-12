// P1B — EMPLOYEE / TRUCK / MOBILE CROSSWALK. What it must conclude, and what it must never conclude.
//
// ============================ WHAT IS BEING PROVEN ============================
//
//   R4 — EMPLOYEE / IDENTITY
//   * a reciprocal Firebase-UID <-> Employee link is CLEAN_EMPLOYEE_MAPPING;
//   * an Employee with no userId is EMPLOYEE_WITHOUT_UID;
//   * a UID with no Employee back-link is UID_WITHOUT_EMPLOYEE — including the two census probe
//     UIDs, and including a users doc whose employeeId names a document that does not exist;
//   * a fieldops_technicians id with no Employee is ORPHAN_TECHNICIAN, and its row's employeeId
//     stays NULL even when the technician carries a userId that reaches a real Employee — the
//     reachability is reported as evidence and never promoted into Employee authority;
//   * a technician id that coincides with an employee id is reported as a COINCIDENCE, and the
//     row's employeeId is the employees document, never the technician id;
//   * a truck whose assignedDriverEmployeeId is only a technician id is
//     TRUCK_ASSIGNED_TO_UNKNOWN_EMPLOYEE — the technician id does not rescue the assignment.
//
//   R5 — OPERATING COMPANY (never inferred)
//   * a MOBILE id with an authored mapping resolves to the AUTHORED company even when its
//     homeWarehouseId belongs to the other company — the cert-trk-04 / cert-trk-05 case, which is
//     exactly why derivation is forbidden;
//   * a MOBILE id with NO authored mapping emits MISSING_OPERATING_COMPANY_MAPPING even though a
//     homeWarehouseId is sitting right there in the record;
//   * the resolver's signature makes derivation structurally impossible: it takes an id and the
//     config, and no record or warehouse id at all;
//   * a duplicate authored entry that disagrees, an ungoverned company id, and a record whose
//     stamped company disagrees with the authored one are all
//     CONFLICTING_OPERATING_COMPANY_CONFIGURATION — never silently resolved to a winner;
//   * any refusal or conflict makes migrationReadiness REFUSE.
//
//   STRUCTURE
//   * a MOBILE location with no truck and no claim is MOBILE_WITHOUT_TRUCK (the five cert-trk-*);
//   * every row carries a disposition and only vocabulary outcomes — classification is total;
//   * output is deterministic: input order does not change the document;
//   * the committed sandbox authored configuration parses to the companies it authors;
//   * the tooling is READ-ONLY and offline: the analyzer imports only node:fs/url/path, the
//     operator entry point's Firestore surface is the declared read-only set, and neither file
//     contains a Firestore write call;
//   * invocation guard rails hold: --projectId required, production needs an exact confirmation,
//     and an evidence path must end in .local.json so it can never be committed.
//
// NO LIVE SECRETS, NO NETWORK. Every case below is a hand-written fixture. This suite opens no
// connection, reads no credential, and writes no evidence artifact.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  COMPANY_RESOLUTION,
  MIGRATION_READINESS,
  OUTCOMES,
  OUTCOME_VALUES,
  ROW_TYPES,
  buildCrosswalk,
  emptyOperatingCompanyConfig,
  formatCrosswalkText,
  isOperatingCompanyIdShape,
  loadOperatingCompanyConfig,
  resolveOperatingCompanyForMobileLocation,
  OPERATING_COMPANY_ROOTS_SANDBOX,
} from "./employeeTruckCrosswalk.lib.mjs";

import {
  COLLECTIONS_READ,
  EVIDENCE_SUFFIX,
  FIRESTORE_METHODS_USED,
  PRODUCTION_PROJECT_ID,
  parseArgs,
  validateInvocation,
} from "./employeeTruckCrosswalk.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const LIB_SOURCE = readFileSync(join(HERE, "employeeTruckCrosswalk.lib.mjs"), "utf8");
const CLI_SOURCE = readFileSync(join(HERE, "employeeTruckCrosswalk.mjs"), "utf8");

// ---------------------------------------------------------------------------------------------
// Fixtures. Shaped after the completed P1B census, small enough to reason about by hand:
//   cw-emp-012 : employee + technician of the same id (the 11-of-13 coincidence)
//   cw-emp-013 : employee, no technician, clean
//   cw-emp-099 : employee with no userId
//   sbx-tech   : employee only; drives TRK-SEED-101 (NOT in fieldops_technicians)
//   tech-sbx-01: technician orphan whose userId reaches a real Employee
//   tech-sbx-02: technician orphan with userId null — exists nowhere else
//   PROBE_NOT_A_REAL_UID / probe-principal-that-does-not-exist : UIDs with no Employee
// ---------------------------------------------------------------------------------------------

const employees = () => [
  { id: "cw-emp-012", data: { userId: "uid-012", employmentStatus: "ACTIVE" } },
  { id: "cw-emp-013", data: { userId: "uid-013", employmentStatus: "ACTIVE" } },
  { id: "cw-emp-099", data: { userId: null, employmentStatus: "ACTIVE" } },
  { id: "sbx-tech", data: { userId: "uid-sbx-tech", employmentStatus: "ACTIVE" } },
];

const users = () => [
  { id: "uid-012", data: { employeeId: "cw-emp-012", role: "technician", technicianId: "cw-emp-012" } },
  { id: "uid-013", data: { employeeId: "cw-emp-013", role: "dispatcher" } },
  { id: "uid-sbx-tech", data: { employeeId: "sbx-tech", role: "technician" } },
  { id: "PROBE_NOT_A_REAL_UID", data: { role: "technician" } },
  { id: "probe-principal-that-does-not-exist", data: { employeeId: "cw-emp-does-not-exist" } },
];

const technicians = () => [
  { id: "cw-emp-012", data: { name: "Twelve", status: "available" } },
  { id: "tech-sbx-01", data: { name: "Orphan One", status: "available", userId: "uid-013" } },
  { id: "tech-sbx-02", data: { name: "Orphan Two", status: "off_shift", userId: null } },
];

// TRK-SEED-101 / TRK-SEED-102 carry homeWarehouseId wh-main (a `taylor` warehouse) on purpose:
// TRK-SEED-102's MOBILE is authored `ventana`, so any homeWarehouseId derivation is visibly wrong.
const trucks = () => [
  {
    id: "TRK-SEED-101",
    data: {
      truckId: "TRK-SEED-101",
      locationId: "mobile-seed-101",
      homeWarehouseId: "wh-main",
      assignedDriverEmployeeId: "sbx-tech",
      status: "ACTIVE",
    },
  },
  {
    id: "TRK-SEED-102",
    data: {
      truckId: "TRK-SEED-102",
      locationId: "mobile-seed-102",
      homeWarehouseId: "wh-main",
      assignedDriverEmployeeId: null,
      status: "ACTIVE",
    },
  },
];

const mobileLocations = () => [
  { id: "mobile-seed-101", data: { type: "MOBILE", displayLabel: "Truck 101 (seed)", active: true } },
  { id: "mobile-seed-102", data: { type: "MOBILE", displayLabel: "Truck 102 (seed)", active: true } },
  { id: "cert-trk-01", data: { type: "MOBILE", displayLabel: "Truck 101", active: true, homeWarehouseId: "wh-main" } },
  { id: "cert-trk-04", data: { type: "MOBILE", displayLabel: "Truck 104", active: true, homeWarehouseId: "wh-main" } },
  { id: "cert-trk-05", data: { type: "MOBILE", displayLabel: "Truck 105", active: true, homeWarehouseId: "wh-main" } },
];

const locationTruckClaims = () => [
  { id: "mobile-seed-101", data: { locationId: "mobile-seed-101", truckId: "TRK-SEED-101" } },
  { id: "mobile-seed-102", data: { locationId: "mobile-seed-102", truckId: "TRK-SEED-102" } },
];

const principals = () => [
  { id: "prn-012", external_subject: "uid-012", identity_provider: "firebase", status: "active" },
  { id: "prn-013", external_subject: "uid-013", identity_provider: "firebase", status: "active" },
];

/** The authored configuration used by most cases: every fixture MOBILE id is authored. */
const fullConfig = () =>
  loadOperatingCompanyConfig(
    {
      environment: "fixture",
      status: "fixture",
      governedCompanyIds: ["taylor", "ventana"],
      roots: {
        warehouses: [{ id: "wh-main", operatingCompanyId: "taylor" }],
        mobile_locations: [
          { id: "mobile-seed-101", provenance: "fixture", operatingCompanyId: "taylor" },
          { id: "mobile-seed-102", provenance: "fixture", operatingCompanyId: "ventana" },
          { id: "cert-trk-01", provenance: "fixture", operatingCompanyId: "taylor" },
          { id: "cert-trk-04", provenance: "fixture", operatingCompanyId: "ventana" },
          { id: "cert-trk-05", provenance: "fixture", operatingCompanyId: "ventana" },
        ],
      },
    },
    { label: "fixture:full" },
  );

function run(overrides = {}) {
  return buildCrosswalk({
    employees: employees(),
    users: users(),
    technicians: technicians(),
    trucks: trucks(),
    mobileLocations: mobileLocations(),
    locationTruckClaims: locationTruckClaims(),
    principals: principals(),
    operatingCompanyConfig: fullConfig(),
    sourceLabel: "fixture",
    ...overrides,
  });
}

const rowFor = (doc, rowType, key) => doc.rows.find((r) => r.rowType === rowType && r.key === key);

// ---------------------------------------------------------------------------------------------
// R4 — identity
// ---------------------------------------------------------------------------------------------

test("R4: a reciprocal UID<->Employee link is CLEAN_EMPLOYEE_MAPPING", () => {
  const row = rowFor(run(), ROW_TYPES.IDENTITY, "cw-emp-013");
  assert.equal(row.firebaseUid, "uid-013");
  assert.equal(row.employeeId, "cw-emp-013");
  assert.equal(row.linkIntegrity, "RECIPROCAL");
  assert.deepEqual(row.outcomes, [OUTCOMES.CLEAN_EMPLOYEE_MAPPING]);
  assert.equal(row.disposition, "CLEAN");
});

test("R4: an Employee with no userId is EMPLOYEE_WITHOUT_UID", () => {
  const row = rowFor(run(), ROW_TYPES.IDENTITY, "cw-emp-099");
  assert.equal(row.firebaseUid, null);
  assert.equal(row.employeeId, "cw-emp-099");
  assert.deepEqual(row.outcomes, [OUTCOMES.EMPLOYEE_WITHOUT_UID]);
  assert.equal(row.disposition, "FLAGGED");
});

test("R4: the two census probe UIDs are UID_WITHOUT_EMPLOYEE", () => {
  const doc = run();
  for (const uid of ["PROBE_NOT_A_REAL_UID", "probe-principal-that-does-not-exist"]) {
    const row = rowFor(doc, ROW_TYPES.IDENTITY, `uid:${uid}`);
    assert.ok(row, `expected a row for ${uid}`);
    assert.equal(row.employeeId, null);
    assert.deepEqual(row.outcomes, [OUTCOMES.UID_WITHOUT_EMPLOYEE]);
  }
});

test("R4: a users doc whose employeeId names no employees document is still UID_WITHOUT_EMPLOYEE", () => {
  const row = rowFor(run(), ROW_TYPES.IDENTITY, "uid:probe-principal-that-does-not-exist");
  assert.equal(row.userEmployeeIdForwardLink, "cw-emp-does-not-exist");
  assert.equal(row.employeeId, null, "a forward link is a claim, never Employee authority");
  assert.match(row.notes.join(" "), /is not in employees/);
});

test("R4: an orphan technician is ORPHAN_TECHNICIAN and never gains an employeeId", () => {
  const doc = run();
  for (const technicianId of ["tech-sbx-01", "tech-sbx-02"]) {
    const row = rowFor(doc, ROW_TYPES.IDENTITY, `technician:${technicianId}`);
    assert.ok(row, `expected an orphan row for ${technicianId}`);
    assert.equal(row.technicianId, technicianId);
    assert.equal(row.employeeId, null);
    assert.deepEqual(row.outcomes, [OUTCOMES.ORPHAN_TECHNICIAN]);
  }
});

test("R4: an orphan technician reaching a real Employee by userId reports it but does NOT adopt it", () => {
  // tech-sbx-01 carries userId uid-013, which IS cw-emp-013's UID. A migration might be tempted to
  // fuse them. This tool records the reachability and refuses to make the decision.
  const row = rowFor(run(), ROW_TYPES.IDENTITY, "technician:tech-sbx-01");
  assert.equal(row.employeeIdReachableViaUid, "cw-emp-013");
  assert.equal(row.employeeId, null);
  assert.deepEqual(row.outcomes, [OUTCOMES.ORPHAN_TECHNICIAN]);
});

test("R4: a technician id equal to an employee id is a coincidence, not a derivation", () => {
  const row = rowFor(run(), ROW_TYPES.IDENTITY, "cw-emp-012");
  assert.equal(row.employeeId, "cw-emp-012");
  assert.equal(row.technicianId, "cw-emp-012");
  assert.equal(row.technicianIdMatchesEmployeeId, true);
  assert.equal(row.technicianIdSource, "fieldops_technicians (compatibility projection)");
  // The compatibility edge callerContext.ts reads today is reported, never used as authority.
  assert.equal(row.legacyUserTechnicianId, "cw-emp-012");
  assert.deepEqual(row.outcomes, [OUTCOMES.CLEAN_EMPLOYEE_MAPPING]);
});

test("R4: a Firebase UID maps to a principal without conferring Employee authority", () => {
  const row = rowFor(run(), ROW_TYPES.IDENTITY, "cw-emp-012");
  assert.equal(row.principalId, "prn-012");
  assert.equal(row.principalIdentityProvider, "firebase");
  // No principal export at all changes no outcome — identity is external, authority is `employees`.
  const withoutPrincipals = run({ principals: [] });
  assert.deepEqual(
    rowFor(withoutPrincipals, ROW_TYPES.IDENTITY, "cw-emp-012").outcomes,
    row.outcomes,
  );
});

test("R4: a non-reciprocal identity link is FLAGGED rather than silently CLEAN", () => {
  const doc = run({ users: [{ id: "uid-013", data: { employeeId: "someone-else" } }] });
  const row = rowFor(doc, ROW_TYPES.IDENTITY, "cw-emp-013");
  assert.equal(row.linkIntegrity, "NON_RECIPROCAL");
  assert.equal(row.disposition, "FLAGGED");
  assert.ok(!row.outcomes.includes(OUTCOMES.CLEAN_EMPLOYEE_MAPPING));
});

// ---------------------------------------------------------------------------------------------
// Truck assignment
// ---------------------------------------------------------------------------------------------

test("a truck whose driver resolves in employees is CLEAN and carries the MOBILE chain", () => {
  const row = rowFor(run(), ROW_TYPES.TRUCK, "TRK-SEED-101");
  assert.equal(row.assignedDriverEmployeeId, "sbx-tech");
  assert.equal(row.assignedDriverResolvesToEmployee, true);
  assert.equal(row.mobileLocationId, "mobile-seed-101");
  assert.equal(row.operatingCompanyId, "taylor");
  assert.equal(row.disposition, "CLEAN");
});

test("TRUCK_ASSIGNED_TO_UNKNOWN_EMPLOYEE: a technician id does not rescue an assignment (R4)", () => {
  const doc = run({
    trucks: [
      {
        id: "TRK-SEED-103",
        data: {
          locationId: "mobile-seed-101",
          homeWarehouseId: "wh-main",
          assignedDriverEmployeeId: "tech-sbx-01",
          status: "ACTIVE",
        },
      },
    ],
  });
  const row = rowFor(doc, ROW_TYPES.TRUCK, "TRK-SEED-103");
  assert.ok(row.outcomes.includes(OUTCOMES.TRUCK_ASSIGNED_TO_UNKNOWN_EMPLOYEE));
  assert.equal(row.assignedDriverIsTechnicianIdOnly, true);
  assert.match(row.notes.join(" "), /that does not make it an Employee/);
});

test("an employee's row walks UID -> Employee -> truck -> MOBILE -> authored company", () => {
  const row = rowFor(run(), ROW_TYPES.IDENTITY, "sbx-tech");
  assert.equal(row.firebaseUid, "uid-sbx-tech");
  assert.equal(row.technicianId, null, "sbx-tech is in employees only, never fieldops_technicians");
  assert.deepEqual(row.truckIds, ["TRK-SEED-101"]);
  assert.deepEqual(row.mobileLocationIds, ["mobile-seed-101"]);
  assert.deepEqual(row.operatingCompanyIds, ["taylor"]);
  assert.equal(row.operatingCompanyResolution, COMPANY_RESOLUTION.RESOLVED);
});

// ---------------------------------------------------------------------------------------------
// R5 — operating company is authored, never derived
// ---------------------------------------------------------------------------------------------

test("R5: the resolver takes an id and the config — a record or warehouse id is not a parameter", () => {
  assert.equal(
    resolveOperatingCompanyForMobileLocation.length,
    2,
    "adding a third parameter is how homeWarehouseId derivation would sneak in",
  );
});

test("R5: authored company wins over homeWarehouseId — the cert-trk-04 / cert-trk-05 case", () => {
  const doc = run();
  // Both records carry homeWarehouseId wh-main, a `taylor` warehouse. Both are authored ventana.
  for (const id of ["cert-trk-04", "cert-trk-05"]) {
    const row = rowFor(doc, ROW_TYPES.MOBILE, id);
    assert.equal(row.homeWarehouseId, "wh-main");
    assert.equal(row.homeWarehouseIdUsedForCompany, false);
    assert.equal(row.operatingCompanyId, "ventana", `${id} must follow authored config, not its warehouse`);
  }
  assert.equal(rowFor(doc, ROW_TYPES.MOBILE, "cert-trk-01").operatingCompanyId, "taylor");
});

test("R5: no authored mapping emits MISSING_OPERATING_COMPANY_MAPPING even with homeWarehouseId present", () => {
  const doc = run({ operatingCompanyConfig: emptyOperatingCompanyConfig() });
  const row = rowFor(doc, ROW_TYPES.MOBILE, "cert-trk-04");
  assert.equal(row.operatingCompanyId, null, "never a guess");
  assert.equal(row.homeWarehouseId, "wh-main");
  assert.ok(row.outcomes.includes(OUTCOMES.MISSING_OPERATING_COMPANY_MAPPING));
  assert.match(row.notes.join(" "), /is NOT consulted/);
});

test("R5: an unauthored MOBILE refuses the migration, and every refusal is listed", () => {
  const doc = run({ operatingCompanyConfig: emptyOperatingCompanyConfig() });
  assert.equal(doc.migrationReadiness, MIGRATION_READINESS.REFUSE);
  assert.ok(doc.refusals.length > 0);
  for (const refusal of doc.refusals) {
    assert.equal(refusal.reason, OUTCOMES.MISSING_OPERATING_COMPANY_MAPPING);
  }
  // The truck rows refuse too — a truck's company comes from its MOBILE id, not its warehouse.
  assert.ok(doc.refusals.some((r) => r.rowType === ROW_TYPES.TRUCK));
});

test("R5: a fully authored world proceeds", () => {
  // Drop the five unclaimed cert MOBILE ids' structural defect out of the picture by authoring
  // everything; MOBILE_WITHOUT_TRUCK does not refuse a migration, only an unknown company does.
  const doc = run();
  assert.equal(doc.migrationReadiness, MIGRATION_READINESS.PROCEED);
  assert.deepEqual(doc.refusals, []);
  assert.deepEqual(doc.conflicts, []);
});

test("R5: duplicate authored entries that disagree are CONFLICTING, never resolved to a winner", () => {
  const config = loadOperatingCompanyConfig(
    {
      governedCompanyIds: ["taylor", "ventana"],
      roots: {
        mobile_locations: [
          { id: "mobile-seed-101", operatingCompanyId: "taylor" },
          { id: "mobile-seed-101", operatingCompanyId: "ventana" },
        ],
      },
    },
    { label: "fixture:duplicate" },
  );
  const resolution = resolveOperatingCompanyForMobileLocation("mobile-seed-101", config);
  assert.equal(resolution.state, COMPANY_RESOLUTION.CONFLICT);
  assert.equal(resolution.operatingCompanyId, null);
  assert.deepEqual(config.conflicts[0].observed, ["taylor", "ventana"]);
});

test("R5: an ungoverned or malformed authored company id is CONFLICTING, not accepted", () => {
  const config = loadOperatingCompanyConfig(
    {
      governedCompanyIds: ["taylor", "ventana"],
      roots: {
        mobile_locations: [
          { id: "m-ungoverned", operatingCompanyId: "acme" },
          { id: "m-malformed", operatingCompanyId: "Taylor Freezer" },
        ],
      },
    },
    { label: "fixture:bad-ids" },
  );
  assert.equal(resolveOperatingCompanyForMobileLocation("m-ungoverned", config).state, COMPANY_RESOLUTION.CONFLICT);
  assert.equal(resolveOperatingCompanyForMobileLocation("m-malformed", config).state, COMPANY_RESOLUTION.CONFLICT);
  assert.deepEqual(
    config.conflicts.map((c) => c.reason).sort(),
    ["AUTHORED_COMPANY_ID_MALFORMED", "AUTHORED_COMPANY_ID_NOT_GOVERNED"],
  );
});

test("R5: a stamped record company disagreeing with authored config is CONFLICTING and refuses", () => {
  const doc = run({
    mobileLocations: [
      { id: "mobile-seed-102", data: { type: "MOBILE", displayLabel: "Truck 102", active: true, operatingCompanyId: "taylor" } },
    ],
  });
  const row = rowFor(doc, ROW_TYPES.MOBILE, "mobile-seed-102");
  assert.equal(row.recordOperatingCompanyId, "taylor");
  assert.equal(row.operatingCompanyId, "ventana", "the authored config is the truth on record");
  assert.ok(row.outcomes.includes(OUTCOMES.CONFLICTING_OPERATING_COMPANY_CONFIGURATION));
  assert.equal(doc.migrationReadiness, MIGRATION_READINESS.REFUSE);
});

test("R5: a truck stamped with a company that disagrees with its MOBILE's authored company conflicts", () => {
  const doc = run({
    trucks: [
      {
        id: "TRK-SEED-102",
        data: {
          locationId: "mobile-seed-102",
          homeWarehouseId: "wh-main",
          assignedDriverEmployeeId: null,
          operatingCompanyId: "taylor",
        },
      },
    ],
  });
  const row = rowFor(doc, ROW_TYPES.TRUCK, "TRK-SEED-102");
  assert.ok(row.outcomes.includes(OUTCOMES.CONFLICTING_OPERATING_COMPANY_CONFIGURATION));
  assert.equal(doc.migrationReadiness, MIGRATION_READINESS.REFUSE);
});

test("R5: the operating-company id shape check mirrors operatingCompanyAuthority.ts", () => {
  assert.equal(isOperatingCompanyIdShape("taylor"), true);
  assert.equal(isOperatingCompanyIdShape("ventana"), true);
  assert.equal(isOperatingCompanyIdShape("Taylor"), false);
  assert.equal(isOperatingCompanyIdShape("t"), false);
  assert.equal(isOperatingCompanyIdShape(null), false);
});

// ---------------------------------------------------------------------------------------------
// Structural outcomes
// ---------------------------------------------------------------------------------------------

test("MOBILE_WITHOUT_TRUCK: a MOBILE id with no truck and no claim (the five cert-trk-*)", () => {
  const doc = run();
  for (const id of ["cert-trk-01", "cert-trk-04", "cert-trk-05"]) {
    const row = rowFor(doc, ROW_TYPES.MOBILE, id);
    assert.deepEqual(row.truckIds, []);
    assert.equal(row.claimTruckId, null);
    assert.ok(row.outcomes.includes(OUTCOMES.MOBILE_WITHOUT_TRUCK));
  }
  // A MOBILE with a truck is not flagged for it.
  assert.ok(!rowFor(doc, ROW_TYPES.MOBILE, "mobile-seed-101").outcomes.includes(OUTCOMES.MOBILE_WITHOUT_TRUCK));
});

test("MOBILE_WITHOUT_TRUCK alone does not refuse the migration — only company truth does", () => {
  const doc = run();
  assert.ok(doc.outcomeCounts[OUTCOMES.MOBILE_WITHOUT_TRUCK] >= 3);
  assert.equal(doc.migrationReadiness, MIGRATION_READINESS.PROCEED);
});

test("a claim alone (no truck record) still counts as having a truck", () => {
  const doc = run({
    trucks: [],
    locationTruckClaims: [{ id: "mobile-seed-101", data: { truckId: "TRK-SEED-101" } }],
  });
  const row = rowFor(doc, ROW_TYPES.MOBILE, "mobile-seed-101");
  assert.equal(row.claimTruckId, "TRK-SEED-101");
  assert.ok(!row.outcomes.includes(OUTCOMES.MOBILE_WITHOUT_TRUCK));
});

test("classification is total: every row has a disposition and only vocabulary outcomes", () => {
  for (const doc of [run(), run({ operatingCompanyConfig: emptyOperatingCompanyConfig() })]) {
    assert.ok(doc.rows.length > 0);
    for (const row of doc.rows) {
      assert.ok(["CLEAN", "FLAGGED"].includes(row.disposition), `${row.key} has no disposition`);
      for (const outcome of row.outcomes) {
        assert.ok(OUTCOME_VALUES.includes(outcome), `${row.key} emitted unknown outcome ${outcome}`);
      }
    }
    assert.equal(
      doc.dispositionCounts.CLEAN + doc.dispositionCounts.FLAGGED,
      doc.rows.length,
      "disposition counts must account for every row",
    );
  }
});

test("the outcome vocabulary is exactly the eight declared terms", () => {
  assert.deepEqual(
    [...OUTCOME_VALUES].sort(),
    [
      "CLEAN_EMPLOYEE_MAPPING",
      "CONFLICTING_OPERATING_COMPANY_CONFIGURATION",
      "EMPLOYEE_WITHOUT_UID",
      "MISSING_OPERATING_COMPANY_MAPPING",
      "MOBILE_WITHOUT_TRUCK",
      "ORPHAN_TECHNICIAN",
      "TRUCK_ASSIGNED_TO_UNKNOWN_EMPLOYEE",
      "UID_WITHOUT_EMPLOYEE",
    ],
  );
});

test("two Employees claiming one Firebase UID is reported, never silently collapsed", () => {
  const doc = run({
    employees: [
      { id: "cw-emp-a", data: { userId: "uid-shared" } },
      { id: "cw-emp-b", data: { userId: "uid-shared" } },
    ],
    users: [{ id: "uid-shared", data: { employeeId: "cw-emp-a" } }],
  });
  assert.deepEqual(doc.duplicateUidBackLinks, [
    { firebaseUid: "uid-shared", employeeIds: ["cw-emp-a", "cw-emp-b"] },
  ]);
  assert.equal(rowFor(doc, ROW_TYPES.IDENTITY, "cw-emp-b").disposition, "FLAGGED");
});

// ---------------------------------------------------------------------------------------------
// Determinism and rendering
// ---------------------------------------------------------------------------------------------

test("output is deterministic: input order does not change the document", () => {
  const shuffled = (list) => [...list].reverse();
  const a = run();
  const b = buildCrosswalk({
    employees: shuffled(employees()),
    users: shuffled(users()),
    technicians: shuffled(technicians()),
    trucks: shuffled(trucks()),
    mobileLocations: shuffled(mobileLocations()),
    locationTruckClaims: shuffled(locationTruckClaims()),
    principals: shuffled(principals()),
    operatingCompanyConfig: fullConfig(),
    sourceLabel: "fixture",
  });
  assert.deepEqual(b, a);
  assert.equal(JSON.stringify(b), JSON.stringify(a), "key order must be stable too");
});

test("rows are emitted IDENTITY, then TRUCK, then MOBILE, each sorted by key", () => {
  const doc = run();
  const families = doc.rows.map((r) => r.rowType);
  assert.deepEqual([...new Set(families)], [ROW_TYPES.IDENTITY, ROW_TYPES.TRUCK, ROW_TYPES.MOBILE]);
  for (const rowType of [ROW_TYPES.IDENTITY, ROW_TYPES.TRUCK, ROW_TYPES.MOBILE]) {
    const keys = doc.rows.filter((r) => r.rowType === rowType).map((r) => r.key);
    assert.deepEqual(keys, [...keys].sort(), `${rowType} rows are not sorted`);
  }
});

test("the text rendering shows the full crosswalk chain for every row", () => {
  const text = formatCrosswalkText(run());
  assert.match(text, /IDENTITY sbx-tech: uid-sbx-tech -> sbx-tech -> - -> TRK-SEED-101 -> mobile-seed-101 -> taylor/);
  assert.match(text, /MOBILE cert-trk-04: - -> - -> - -> - -> cert-trk-04 -> ventana/);
  assert.match(text, /migrationReadiness: PROCEED/);
});

test("the document records the rulings it was built under", () => {
  const doc = run();
  assert.equal(doc.readOnly, true);
  assert.match(doc.rulings.R4, /employees is the canonical business Employee/);
  assert.match(doc.rulings.R5, /never from homeWarehouseId/);
  assert.equal(doc.counts.employees, 4);
  assert.equal(doc.counts.fieldops_technicians, 3);
});

// ---------------------------------------------------------------------------------------------
// The committed sandbox authored configuration
// ---------------------------------------------------------------------------------------------

test("the committed sandbox authored configuration is the company truth for all seven MOBILE ids", () => {
  const config = loadOperatingCompanyConfig(OPERATING_COMPANY_ROOTS_SANDBOX);
  assert.deepEqual(config.governedCompanyIds, ["taylor", "ventana"]);
  assert.deepEqual(config.conflicts, []);
  assert.equal(config.authoredMobileLocationCount, 7);
  const company = (id) => resolveOperatingCompanyForMobileLocation(id, config).operatingCompanyId;
  assert.equal(company("cert-trk-01"), "taylor");
  assert.equal(company("cert-trk-02"), "taylor");
  assert.equal(company("cert-trk-03"), "taylor");
  assert.equal(company("cert-trk-04"), "ventana");
  assert.equal(company("cert-trk-05"), "ventana");
  assert.equal(company("mobile-seed1786749487428-101"), "taylor");
  assert.equal(company("mobile-seed1786749487428-102"), "ventana");
});

test("a MOBILE id absent from the committed configuration resolves MISSING, never a default", () => {
  const config = loadOperatingCompanyConfig(OPERATING_COMPANY_ROOTS_SANDBOX);
  const resolution = resolveOperatingCompanyForMobileLocation("cert-trk-06", config);
  assert.equal(resolution.state, COMPANY_RESOLUTION.MISSING);
  assert.equal(resolution.operatingCompanyId, null);
});

test("the authored warehouse roots are never reachable as a MOBILE company lookup", () => {
  // wh-main is authored `taylor`. Asking the MOBILE resolver for it must MISS, not answer taylor —
  // if warehouse roots were folded into the same index, this would return a company.
  const config = loadOperatingCompanyConfig(OPERATING_COMPANY_ROOTS_SANDBOX);
  assert.equal(resolveOperatingCompanyForMobileLocation("wh-main", config).state, COMPANY_RESOLUTION.MISSING);
  assert.equal(resolveOperatingCompanyForMobileLocation("wh-north", config).state, COMPANY_RESOLUTION.MISSING);
});

// ---------------------------------------------------------------------------------------------
// Read-only, offline, and the invocation guard rails
// ---------------------------------------------------------------------------------------------

/** Write APIs whose names cannot collide with anything else this code legitimately does. */
const FORBIDDEN_TOKENS = [
  ".create(", "writeBatch", "batch()", "bulkWriter", "BulkWriter",
  "runTransaction", "FieldValue", "firestore.rules",
];

/** Mutating method names that DO collide — Map#set, Map#delete, Set#add — so they are only a
 *  violation when they sit on a line that also touches Firestore. */
const AMBIGUOUS_MUTATORS = [".set(", ".update(", ".delete(", ".add("];
const FIRESTORE_RECEIVERS = ["db", "collection(", ".doc(", "snapshot", "getFirestore", "firestore"];

/** Strip comments: the CLI's read-only proof names the write APIs in prose on purpose. */
const codeOf = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\/\/.*$/, ""))
    .join("\n");

test("the analyzer is pure: it imports only node:fs, node:url and node:path", () => {
  const specifiers = [...LIB_SOURCE.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(specifiers)].sort(), ["node:fs", "node:path", "node:url"]);
});

test("neither file contains a Firestore write call", () => {
  for (const [name, source] of [["lib", LIB_SOURCE], ["cli", CLI_SOURCE]]) {
    const code = codeOf(source);
    for (const token of FORBIDDEN_TOKENS) {
      assert.ok(!code.includes(token), `${name} contains a forbidden token: ${token}`);
    }
    for (const line of code.split(/\r?\n/)) {
      if (!AMBIGUOUS_MUTATORS.some((m) => line.includes(m))) continue;
      for (const receiver of FIRESTORE_RECEIVERS) {
        assert.ok(!line.includes(receiver), `${name} mutates a Firestore receiver: ${line.trim()}`);
      }
    }
  }
});

test("the CLI's only Firestore expression is a whole-collection read", () => {
  const code = codeOf(CLI_SOURCE);
  const firestoreCalls = [...code.matchAll(/db\.[A-Za-z.()\s]+/g)].map((m) => m[0].replace(/\s+/g, ""));
  assert.deepEqual([...new Set(firestoreCalls)], ["db.collection(name).get()"]);
  assert.ok(!code.includes(".doc("), "a document-level handle is the first step toward a write");
});

test("the declared Firestore surface is exactly the read-only set, and names six collections", () => {
  assert.deepEqual(FIRESTORE_METHODS_USED, [
    "initializeApp",
    "getFirestore",
    "collection().get()",
    "QuerySnapshot.docs",
    "QueryDocumentSnapshot.id",
    "QueryDocumentSnapshot.data()",
  ]);
  assert.deepEqual(COLLECTIONS_READ, [
    "employees",
    "users",
    "fieldops_technicians",
    "trucks",
    "mobile_locations",
    "location_truck_claims",
  ]);
});

test("the tooling lives outside every Firebase Exit Guard scan root", () => {
  // The guard scans field-ops-app-vite/src and functions/src only (scripts/firebaseExitGuard.mjs).
  // Both files are repo-root scripts/, so the exit baseline cannot grow because of this tool.
  const code = codeOf(CLI_SOURCE);
  assert.ok(!code.includes("functions/src"), "the tool must not reach into functions/src");
  // The analyzer never imports firebase at all — see the purity test above; here we only pin that
  // the CLI borrows the dependency rather than declaring one at the repo root.
  assert.match(code, /functions", "package\.json"/, "firebase-admin is borrowed from functions/, never installed at root");
});

test("--projectId is required; there is no implicit target", () => {
  assert.deepEqual(validateInvocation({}).length, 1);
  assert.match(validateInvocation({})[0], /--projectId is required/);
  assert.deepEqual(validateInvocation({ projectId: "eos-platform-sandbox" }), []);
});

test("the production project requires an exact confirmation", () => {
  assert.match(
    validateInvocation({ projectId: PRODUCTION_PROJECT_ID })[0],
    /requires --confirmProduction taylor-parts/,
  );
  assert.match(
    validateInvocation({ projectId: PRODUCTION_PROJECT_ID, confirmProduction: "yes" })[0],
    /requires --confirmProduction taylor-parts/,
  );
  assert.deepEqual(
    validateInvocation({ projectId: PRODUCTION_PROJECT_ID, confirmProduction: PRODUCTION_PROJECT_ID }),
    [],
  );
});

test("an evidence path must end in .local.json so tenant data can never be committed", () => {
  assert.equal(EVIDENCE_SUFFIX, ".local.json");
  const problems = validateInvocation({ projectId: "sbx", out: "evidence/crosswalk.json" });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /must end in \.local\.json/);
  assert.deepEqual(validateInvocation({ projectId: "sbx", out: "evidence/crosswalk.local.json" }), []);
  // .gitignore already excludes that suffix globally, which is what makes the rule bite.
  const gitignore = readFileSync(join(HERE, "..", ".gitignore"), "utf8");
  assert.match(gitignore, /^\*\.local\.json$/m);
});

test("argument parsing rejects a flag with no value and a bare positional", () => {
  assert.deepEqual(parseArgs(["--projectId", "sbx", "--format", "text"]), { projectId: "sbx", format: "text" });
  assert.throws(() => parseArgs(["--projectId"]), /--projectId requires a value/);
  assert.throws(() => parseArgs(["sbx"]), /unexpected argument/);
});

test("--format only accepts json or text", () => {
  assert.deepEqual(validateInvocation({ projectId: "sbx", format: "yaml" }).length, 1);
  assert.deepEqual(validateInvocation({ projectId: "sbx", format: "text" }), []);
});
