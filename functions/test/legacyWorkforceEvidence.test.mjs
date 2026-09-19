// Steps D/E: the legacy evidence classification, proved offline. No database, no Firebase, no emulator.
//
// The point of this suite is that the census GUESSES NOTHING. Every disposition must follow from evidence, and the
// plan must contain only what the Owner ruled deterministic -- so the tests below are mostly about what does NOT
// appear in the plan.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const evidence = require("../lib/eosWorkforce/migration/legacyWorkforceEvidence.js");
const { parseEmployeeProfileSnapshot } = require("../lib/eosWorkforce/migration/employeeProfileSnapshot.js");
const { LEGACY_QUALIFICATION_CANDIDATES } = require("../lib/eosWorkforce/workEligibilityVocabulary.js");
const { OPERATIONAL_ROLE_VALUES } = require("../lib/access/employeeProfileCommands.js");

const snapshotOf = (employees) => parseEmployeeProfileSnapshot({
  format: "EOS_EMPLOYEE_PROFILE_SNAPSHOT", version: 1,
  source: { firebaseProjectId: "taylor-nonprod", exportedAt: "2026-09-19T00:00:00.000Z" },
  employees,
});

const viewOf = (over = {}) => ({
  tenantId: "t1",
  employees: new Set(["e-1", "e-2"]),
  warehouses: new Map([
    ["wh-main", { tenantId: "t1", status: "ACTIVE" }],
    ["wh-north", { tenantId: "t1", status: "ACTIVE" }],
    ["wh-retired", { tenantId: "t1", status: "INACTIVE" }],
    ["wh-t2", { tenantId: "t2", status: "ACTIVE" }],
  ]),
  currentQualifications: new Set(),
  currentScopes: new Set(),
  ...over,
});

const dispositionsFor = (census, employeeId, legacyValue) =>
  [...census.qualificationFindings, ...census.scopeFindings]
    .filter((f) => f.employeeId === employeeId && f.legacyValue === legacyValue).map((f) => f.disposition);

test("the legacy vocabulary is carried verbatim, and exactly two values are ruled deterministic", () => {
  assert.deepEqual([...evidence.LEGACY_OPERATIONAL_ROLE_VALUES].sort(), [...OPERATIONAL_ROLE_VALUES].sort());
  assert.deepEqual(Object.keys(LEGACY_QUALIFICATION_CANDIDATES).sort(), ["TECHNICIAN", "WAREHOUSE_ASSOCIATE"]);
  assert.deepEqual(Object.values(LEGACY_QUALIFICATION_CANDIDATES).sort(), ["SERVICE_TECHNICIAN", "WAREHOUSE_OPERATIONS"]);
});

test("qualifications: the two ruled values are candidates; every other legacy value is remediation, not a guess", () => {
  const census = evidence.censusLegacyWorkforceEvidence(snapshotOf([
    { id: "e-1", data: { operationalRoles: ["TECHNICIAN", "SERVICE_MANAGER", "PARTS_MANAGER"] } },
    { id: "e-2", data: { operationalRoles: ["WAREHOUSE_ASSOCIATE", "WAREHOUSE_MANAGER"] } },
  ]), viewOf());

  assert.deepEqual(dispositionsFor(census, "e-1", "TECHNICIAN"), ["DETERMINISTIC_CANDIDATE"]);
  assert.deepEqual(dispositionsFor(census, "e-2", "WAREHOUSE_ASSOCIATE"), ["DETERMINISTIC_CANDIDATE"]);
  // WAREHOUSE_MANAGER, SERVICE_MANAGER and PARTS_MANAGER have no ruled mapping -- and none is invented.
  for (const [id, value] of [["e-1", "SERVICE_MANAGER"], ["e-1", "PARTS_MANAGER"], ["e-2", "WAREHOUSE_MANAGER"]]) {
    assert.deepEqual(dispositionsFor(census, id, value), ["AMBIGUOUS_REMEDIATION"], `${value} was mapped`);
  }
  assert.deepEqual(census.plan.qualifications.map((p) => [p.input.employeeId, p.input.qualificationCode]),
    [["e-1", "SERVICE_TECHNICIAN"], ["e-2", "WAREHOUSE_OPERATIONS"]]);
  assert.ok(census.plan.qualifications.every((p) => p.operation === "assignEmployeeWorkEligibility"));
});

test("qualifications: already-governed, dead vocabulary, unknown drift, and an Employee who does not resolve", () => {
  const census = evidence.censusLegacyWorkforceEvidence(snapshotOf([
    { id: "e-1", data: { operationalRoles: ["TECHNICIAN"] } },
    { id: "e-gone", data: { operationalRoles: ["TECHNICIAN"] } },
    { id: "e-2", data: { operationalRoles: ["FOREMAN", "technician", 42] } },
  ]), viewOf({ currentQualifications: new Set(["e-1|SERVICE_TECHNICIAN"]) }));

  // Already held: reported, and deliberately NOT planned -- the command would only answer NO_CHANGE.
  assert.deepEqual(dispositionsFor(census, "e-1", "TECHNICIAN"), ["ALREADY_GOVERNED"]);
  // A ruled value for an Employee this tenant does not have is remediation, never a candidate.
  assert.deepEqual(dispositionsFor(census, "e-gone", "TECHNICIAN"), ["AMBIGUOUS_REMEDIATION"]);
  // Outside the legacy vocabulary entirely -- including a case variant and a non-string.
  for (const value of ["FOREMAN", "technician", "42"]) {
    assert.deepEqual(dispositionsFor(census, "e-2", value), ["UNKNOWN"], `${value} was not reported as drift`);
  }
  // A known legacy value nobody holds is vocabulary with nothing behind it: reported once, not per Employee.
  const dead = census.qualificationFindings.filter((f) => f.disposition === "DEAD_LEGACY").map((f) => f.legacyValue).sort();
  assert.deepEqual(dead, ["PARTS_ASSOCIATE", "PARTS_MANAGER", "SALES_ASSOCIATE", "SALES_MANAGER", "SERVICE_MANAGER", "WAREHOUSE_ASSOCIATE", "WAREHOUSE_MANAGER"]);
  assert.deepEqual(census.plan.qualifications, [], "nothing was planned from already-governed, unresolved or unknown evidence");
});

test("scopes: only an exact, same-tenant, governed, ACTIVE warehouse becomes a candidate", () => {
  const census = evidence.censusLegacyWorkforceEvidence(snapshotOf([
    { id: "e-1", data: { assignedWarehouseIds: ["wh-main", "wh-retired", "wh-t2", "wh-nope", "wh-main", " wh-main", "a/b", "", 7] } },
    { id: "e-gone", data: { assignedWarehouseIds: ["wh-north"] } },
    { id: "e-2", data: { assignedWarehouseIds: "wh-main" } },
  ]), viewOf());

  assert.deepEqual(dispositionsFor(census, "e-1", "wh-main"), ["DETERMINISTIC_CANDIDATE", "DUPLICATE"]);
  assert.deepEqual(dispositionsFor(census, "e-1", "wh-retired"), ["INACTIVE_WAREHOUSE"]);
  // A warehouse that exists in ANOTHER tenant is its own finding -- never folded into "unknown", never a candidate.
  assert.deepEqual(dispositionsFor(census, "e-1", "wh-t2"), ["CROSS_TENANT"]);
  assert.deepEqual(dispositionsFor(census, "e-1", "wh-nope"), ["UNKNOWN_WAREHOUSE"]);
  for (const value of [" wh-main", "a/b", "", "7"]) {
    assert.deepEqual(dispositionsFor(census, "e-1", value), ["AMBIGUOUS"], `${JSON.stringify(value)} was not refused as inexact`);
  }
  assert.deepEqual(dispositionsFor(census, "e-gone", "wh-north"), ["UNKNOWN_EMPLOYEE"]);
  // A legacy field that is present but not an array cannot be read as evidence at all.
  assert.deepEqual(dispositionsFor(census, "e-2", ""), ["REMEDIATION_REQUIRED"]);

  assert.deepEqual(census.plan.scopes, [{
    operation: "assignEmployeeOperationalScope",
    input: { employeeId: "e-1", scopeType: "WAREHOUSE", scopeId: "wh-main", reason: census.plan.scopes[0].input.reason },
  }]);
  assert.match(census.plan.scopes[0].input.reason, /assignedWarehouseIds/);
});

test("scopes: an already-governed scope is reported and not re-planned", () => {
  const census = evidence.censusLegacyWorkforceEvidence(
    snapshotOf([{ id: "e-1", data: { assignedWarehouseIds: ["wh-main", "wh-north"] } }]),
    viewOf({ currentScopes: new Set(["e-1|WAREHOUSE|wh-main"]) }),
  );
  assert.deepEqual(dispositionsFor(census, "e-1", "wh-main"), ["ALREADY_GOVERNED"]);
  assert.deepEqual(census.plan.scopes.map((p) => p.input.scopeId), ["wh-north"]);
});

test("NOTHING IS INFERRED: no qualification from a Job Role or title, and no scope from a role string", () => {
  const census = evidence.censusLegacyWorkforceEvidence(snapshotOf([
    // Every tempting signal at once, and no legacy evidence of the kind each authority actually requires.
    { id: "e-1", data: {
      jobTitle: "Service Technician", managerEmployeeId: "e-2", operatingCompanyId: "taylor",
      securityRole: "warehouseManager", role: "technician", userId: "firebase-uid-1",
      operationalRoles: ["WAREHOUSE_ASSOCIATE", "WAREHOUSE_MANAGER"],
    } },
    // Qualified for warehouse work by legacy evidence, but WHICH warehouse is not stated anywhere.
    { id: "e-2", data: { operationalRoles: ["WAREHOUSE_ASSOCIATE"], jobTitle: "Warehouse Lead" } },
  ]), viewOf());

  // WAREHOUSE_ASSOCIATE yields a QUALIFICATION and not one warehouse scope: they are separate authorities.
  assert.deepEqual(census.plan.qualifications.map((p) => p.input.qualificationCode), ["WAREHOUSE_OPERATIONS", "WAREHOUSE_OPERATIONS"]);
  assert.deepEqual(census.plan.scopes, [], "a scope was inferred from a role string, title, manager or company");
  assert.equal(census.employeesWithLegacyWarehouses, 0);
  // The Service Technician title produced no SERVICE_TECHNICIAN qualification.
  assert.ok(!census.plan.qualifications.some((p) => p.input.qualificationCode === "SERVICE_TECHNICIAN"));
});

test("the census is deterministic, counts every finding, and separates remediation from action", () => {
  const employees = [
    { id: "e-2", data: { operationalRoles: ["SALES_MANAGER"], assignedWarehouseIds: ["wh-t2"] } },
    { id: "e-1", data: { operationalRoles: ["TECHNICIAN"], assignedWarehouseIds: ["wh-main"] } },
  ];
  const a = evidence.censusLegacyWorkforceEvidence(snapshotOf(employees), viewOf());
  const b = evidence.censusLegacyWorkforceEvidence(snapshotOf([...employees].reverse()), viewOf());
  assert.deepEqual(a, b, "the census depends on snapshot order");

  assert.equal(a.employeesInSnapshot, 2);
  assert.equal(a.employeesWithLegacyRoles, 2);
  assert.equal(a.employeesWithLegacyWarehouses, 2);
  assert.equal(a.qualificationFindings.length, Object.values(a.qualificationCounts).reduce((s, n) => s + n, 0));
  assert.equal(a.scopeFindings.length, Object.values(a.scopeCounts).reduce((s, n) => s + n, 0));
  assert.deepEqual(a.remediation.map((f) => [f.employeeId, f.legacyValue, f.disposition]),
    [["e-2", "SALES_MANAGER", "AMBIGUOUS_REMEDIATION"], ["e-2", "wh-t2", "CROSS_TENANT"]]);
  assert.equal(a.applied, false);
  // Every disposition the module can emit is a declared one.
  for (const f of a.qualificationFindings) assert.ok(evidence.QUALIFICATION_DISPOSITIONS.includes(f.disposition));
  for (const f of a.scopeFindings) assert.ok(evidence.SCOPE_DISPOSITIONS.includes(f.disposition));
});

// Comments in this lane necessarily DISCUSS writing and Firebase in order to forbid them, so the fence below is
// asserted against code with comments stripped -- otherwise the documentation would fail its own rule.
const code = (path) => readFileSync(join(FUNCTIONS_DIR, path), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("the lane cannot mutate: no write statement, no apply flag, no Firebase, and the reads are READ ONLY", () => {
  const pure = code("src/eosWorkforce/migration/legacyWorkforceEvidence.ts");
  const report = code("src/eosWorkforce/migration/legacyWorkforceEvidenceReport.ts");
  const cli = code("scripts/legacyWorkforceEvidenceCli.js");

  // The pure module touches no database and no clock at all.
  assert.doesNotMatch(pure, /\bpg\b|pool|client\.query|SELECT|INSERT|UPDATE|DELETE|Date\.now|new Date/);
  for (const [name, src] of [["report", report], ["cli", cli]]) {
    assert.doesNotMatch(src, /INSERT INTO|UPDATE\s+\w|DELETE FROM|CREATE |DROP |ALTER /i, `${name} contains a write statement`);
    // The fence is on LOADING a Firebase module, not on the word: an error message may truthfully say where the
    // legacy export came from, and forbidding the noun would only teach the next author to paraphrase it.
    assert.doesNotMatch(src, /require\(\s*["'][^"']*firebase[^"']*["']\s*\)|from\s+["'][^"']*firebase[^"']*["']/i, `${name} loads a Firebase module`);
  }
  assert.match(report, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  // There is no apply path, and a stray --apply is refused rather than ignored.
  assert.doesNotMatch(report, /apply/i);
  assert.doesNotMatch(cli, /"--apply"|args\.apply === "true"|apply:\s*true/);
  assert.match(readFileSync(join(FUNCTIONS_DIR, "scripts/legacyWorkforceEvidenceCli.js"), "utf8"), /--apply is not a flag of this command/);
  const { assertCensusInvocation } = require("../scripts/legacyWorkforceEvidenceCli.js");
  assert.equal(typeof assertCensusInvocation, "function");
});
