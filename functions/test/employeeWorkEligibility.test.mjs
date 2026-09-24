// WORK ELIGIBILITY / QUALIFICATION authority, step A: the platform vocabulary and the migration's declared guarantees.
//
// Firebase-free and database-free. The companion suite employeeWorkEligibilityPostgres.test.mjs proves the same
// guarantees against a real postgres:16; this one pins them statically so a drift is a reviewed diff even when no
// database is available.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const vocab = require("../lib/eosWorkforce/workEligibilityVocabulary.js");
const jobRoleSeed = require("../lib/eosWorkforce/migration/jobRoleCatalogSeed.js");

const MIGRATION = readFileSync(join(FUNCTIONS_DIR, "migrations", "1760054400000_employee-work-eligibility-authority.sql"), "utf8");
/** The executable SQL with `--` commentary removed: prose naming a forbidden source must not fail a "never reads" check. */
const SQL = MIGRATION.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
/** The column names the CREATE TABLE declares, in declaration order (constraints excluded). */
const COLUMNS = [...SQL.split("CREATE TABLE employee_work_eligibility (")[1].split(/\n\s*CONSTRAINT/)[0]
  .matchAll(/^\s+([a-z_]+)\s+(?:TEXT|TIMESTAMPTZ)/gm)].map((m) => m[1]);

/** The eight legacy operationalRole values. None of them becomes a qualification code (Owner ruling). */
const LEGACY_OPERATIONAL_ROLES = Object.freeze(["PARTS_MANAGER", "PARTS_ASSOCIATE", "TECHNICIAN", "WAREHOUSE_MANAGER",
  "WAREHOUSE_ASSOCIATE", "SERVICE_MANAGER", "SALES_MANAGER", "SALES_ASSOCIATE"]);

test("the platform qualification vocabulary is exactly the ruled codes, and is immutable", () => {
  // TWO -> THREE deliberately. Owner ruling (scope-policy slice): the legacy operationalRoleActive
  // gate on technician's Reorder and Purchase Order grants is BUSINESS WORK ELIGIBILITY, so it
  // needed a code of its own. It is PARTS_OPERATIONS, not the legacy label -- the guard below
  // forbids reproducing a legacy operationalRole value, and the ruling deferred to exactly that
  // ("unless an existing governed Work Eligibility vocabulary requires another exact format").
  assert.deepEqual([...vocab.WORK_ELIGIBILITY_CODES], ["SERVICE_TECHNICIAN", "WAREHOUSE_OPERATIONS", "PARTS_OPERATIONS"]);
  assert.ok(Object.isFrozen(vocab.WORK_ELIGIBILITY_CODES));
  assert.ok(Object.isFrozen(vocab.WORK_ELIGIBILITY_LABEL));
  assert.ok(Object.isFrozen(vocab.LEGACY_QUALIFICATION_CANDIDATES));
  // Adding a code is a deliberate migration, so the vocabulary and the database CHECK must be
  // changed together. The CHECK is read from the LATEST migration that defines it -- 1761696000000
  // replaced the original constraint, and pinning to the first file would assert a statement the
  // database no longer has.
  const codeSql = readFileSync(join(FUNCTIONS_DIR, "migrations",
    "1761696000000_parts-associate-eligibility-and-reorder-queue-scope.sql"), "utf8")
    .split("-- Down Migration")[0];
  for (const code of vocab.WORK_ELIGIBILITY_CODES) assert.ok(codeSql.includes(`'${code}'`), `${code} missing from the CHECK`);
  const checked = codeSql.match(/work_eligibility_code_known\s+CHECK \(qualification_code IN \(([^)]*)\)\)/);
  assert.ok(checked, "the closed-vocabulary CHECK must exist");
  assert.deepEqual(
    checked[1].split(",").map((s) => s.trim().replace(/'/g, "")),
    [...vocab.WORK_ELIGIBILITY_CODES],
    "the database CHECK and the module vocabulary must not drift",
  );
});

test("no legacy operationalRole value is reproduced as a qualification code", () => {
  for (const legacy of LEGACY_OPERATIONAL_ROLES) {
    assert.ok(!vocab.isWorkEligibilityCode(legacy), `${legacy} must not be a qualification code`);
    // ...and the migration must not quote it as an accepted value either.
    assert.ok(!new RegExp(`'${legacy}'`).test(MIGRATION), `${legacy} must not appear as a value in the migration`);
  }
  // WAREHOUSE_ASSOCIATE in particular: its enforcement meaning is WAREHOUSE_OPERATIONS + explicit warehouse scope.
  assert.ok(!vocab.isWorkEligibilityCode("WAREHOUSE_ASSOCIATE"));
});

test("isWorkEligibilityCode accepts only an exact canonical code", () => {
  for (const code of vocab.WORK_ELIGIBILITY_CODES) assert.equal(vocab.isWorkEligibilityCode(code), true);
  for (const bad of ["service_technician", "SERVICE_TECHNICIAN ", " SERVICE_TECHNICIAN", "", null, undefined, 7, {},
    ["SERVICE_TECHNICIAN"], "OWNER", "admin", "Service Technician"]) {
    assert.equal(vocab.isWorkEligibilityCode(bad), false, `${JSON.stringify(bad)} must not be accepted`);
  }
});

test("the capability is its own narrow capability, and the migration grants it to nobody", () => {
  assert.equal(vocab.EMPLOYEE_WORK_ELIGIBILITY_WRITE, "admin.employeeWorkEligibility.write");
  // Owner ruling: it deliberately does NOT reuse either existing Employee-administration capability.
  assert.notEqual(vocab.EMPLOYEE_WORK_ELIGIBILITY_WRITE, "admin.employeeProfile.write");
  assert.notEqual(vocab.EMPLOYEE_WORK_ELIGIBILITY_WRITE, "admin.employeeJobRole.write");
  assert.ok(MIGRATION.includes(`'${vocab.EMPLOYEE_WORK_ELIGIBILITY_WRITE}'`), "the capability key must be defined by the migration");
  // Defining the vocabulary is not granting it: who holds it comes from the Role-catalog reconciliation only.
  assert.ok(!/INSERT INTO\s+role_capabilities/i.test(MIGRATION), "the migration must not grant the capability");
  assert.ok(!/INSERT INTO\s+eos_policy\.role_capabilities/i.test(MIGRATION));
  assert.ok(!/INSERT INTO\s+user_role_assignments/i.test(MIGRATION), "the migration must not create a Security Role assignment");
});

test("the migration seeds no qualification and backfills nothing", () => {
  const inserts = [...SQL.matchAll(/INSERT INTO\s+([a-z_.]+)/gi)].map((m) => m[1].toLowerCase());
  // The ONLY insert is the capability vocabulary row.
  assert.deepEqual(inserts, ["capabilities"]);
  assert.ok(!/INSERT INTO\s+employee_work_eligibility/i.test(MIGRATION), "assignments start EMPTY");
  // Nothing is derived from any other authority.
  const upSql = SQL.split("Down Migration")[0];
  for (const forbidden of [/FROM\s+eos_workforce\.employees/i, /operationalRoles/i, /job_roles/i, /FROM\s+eos_policy\.roles/i]) {
    assert.ok(!forbidden.test(upSql), `the up migration must not read ${forbidden}`);
  }
});

test("the schema keeps history and cannot express access", () => {
  // One CURRENT row per (Employee, code) -- so multiple DIFFERENT concurrent qualifications are permitted.
  assert.match(MIGRATION, /CREATE UNIQUE INDEX employee_work_eligibility_one_current_per_code\s+ON employee_work_eligibility \(tenant_id, employee_id, qualification_code\)\s+WHERE effective_to IS NULL/);
  // History is kept by a trigger, not by convention.
  assert.match(MIGRATION, /DELETE is refused/);
  assert.match(MIGRATION, /an ended qualification is immutable/);
  assert.match(MIGRATION, /the only permitted change ends a current qualification/);
  assert.match(MIGRATION, /BEFORE UPDATE OR DELETE ON employee_work_eligibility/);
  // Tenant-scoped by a COMPOSITE Employee foreign key -- an employee id alone is never enough.
  assert.match(MIGRATION, /FOREIGN KEY \(tenant_id, employee_id\) REFERENCES employees \(tenant_id, id\)/);
  // The reversal refuses rather than destroying business facts.
  assert.match(MIGRATION, /refuses to reverse/);
  // No COLUMN can carry a capability, permission, Security Role, Job Role or scope: the table cannot express access,
  // and it cannot express operational scope either (that is step B's separate authority).
  assert.deepEqual(COLUMNS, ["id", "tenant_id", "employee_id", "qualification_code", "effective_from", "effective_to",
    "assigned_by", "ended_by", "ended_at", "reason"]);
  for (const forbidden of ["capab", "permission", "role", "scope", "warehouse", "operating", "grant", "access"]) {
    for (const column of COLUMNS) assert.ok(!column.includes(forbidden), `column ${column} must not name a ${forbidden}`);
  }
});

test("the legacy candidate map is exactly the two the Owner allowed, and is not a runtime fallback", () => {
  assert.deepEqual(vocab.LEGACY_QUALIFICATION_CANDIDATES, { TECHNICIAN: "SERVICE_TECHNICIAN", WAREHOUSE_ASSOCIATE: "WAREHOUSE_OPERATIONS" });
  // Every candidate target must be a real code.
  for (const target of Object.values(vocab.LEGACY_QUALIFICATION_CANDIDATES)) assert.ok(vocab.isWorkEligibilityCode(target));
  // No other legacy value is mapped: the rest need a proven consumer mapping or Administration remediation.
  const mapped = Object.keys(vocab.LEGACY_QUALIFICATION_CANDIDATES);
  for (const legacy of LEGACY_OPERATIONAL_ROLES.filter((r) => !mapped.includes(r))) {
    assert.equal(vocab.LEGACY_QUALIFICATION_CANDIDATES[legacy], undefined, `${legacy} must not be silently mapped`);
  }
  // Warehouse SCOPE is never derived from a role string: no candidate names a warehouse.
  assert.ok(!JSON.stringify(vocab.LEGACY_QUALIFICATION_CANDIDATES).toLowerCase().includes("warehouse_manager"));
});

test("a qualification is not a Job Role: the two vocabularies are independent authorities", () => {
  // The launch Job Role catalog is a business-function catalog of its own; the qualification vocabulary is not derived
  // from it and is deliberately far smaller. SERVICE_TECHNICIAN intentionally PARALLELS the `Service Technician` Job
  // Role in wording while remaining a separate authority -- an Employee may hold either without the other.
  const jobRoleIds = jobRoleSeed.LAUNCH_JOB_ROLES.map((r) => r.jobRoleId);
  assert.equal(jobRoleIds.length, 10);
  assert.equal(vocab.WORK_ELIGIBILITY_CODES.length, 3);
  // No qualification code is a Job Role id, and no Job Role id is a qualification code.
  for (const code of vocab.WORK_ELIGIBILITY_CODES) assert.ok(!jobRoleIds.includes(code));
  for (const id of jobRoleIds) assert.ok(!vocab.isWorkEligibilityCode(id));
});

test("the Administration label set covers every code and is presentation only", () => {
  assert.deepEqual(Object.keys(vocab.WORK_ELIGIBILITY_LABEL).sort(), [...vocab.WORK_ELIGIBILITY_CODES].sort());
  for (const code of vocab.WORK_ELIGIBILITY_CODES) {
    const label = vocab.WORK_ELIGIBILITY_LABEL[code];
    assert.ok(typeof label === "string" && label.trim() === label && label !== "");
    // The label names work eligibility, so a reader cannot mistake it for a Security Role or a persona.
    assert.match(label, /work eligibility/i);
  }
});
