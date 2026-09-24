// OPERATIONAL SCOPE authority, step B: the platform vocabulary and the migration's declared guarantees.
//
// Firebase-free and database-free. The companion suite employeeOperationalScopePostgres.test.mjs proves the same
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
const vocab = require("../lib/eosWorkforce/operationalScopeVocabulary.js");
const eligibility = require("../lib/eosWorkforce/workEligibilityVocabulary.js");

const MIGRATION = readFileSync(join(FUNCTIONS_DIR, "migrations", "1760097600000_employee-operational-scope-authority.sql"), "utf8");
/** The executable SQL with `--` commentary removed: prose naming a forbidden source must not fail a "never reads" check. */
const SQL = MIGRATION.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
/** The column names the CREATE TABLE declares, in declaration order (constraints excluded). */
const COLUMNS = [...SQL.split("CREATE TABLE employee_operational_scopes (")[1].split(/\n\s*CONSTRAINT/)[0]
  .matchAll(/^\s+([a-z_]+)\s+(?:TEXT|TIMESTAMPTZ)/gm)].map((m) => m[1]);

test("the scope-type vocabulary is exactly the ruled types, and is immutable", () => {
  // WAREHOUSE alone -> WAREHOUSE + REORDER_QUEUE. This migration's own header said the single type
  // held only "before a live consumer requires them", and the Owner ruled whole-queue Reorder
  // visibility an Operational Scope -- that consumer. REORDER_QUEUE's scope_id is the governed
  // operating company KEY, and a trigger added by migration 1761696000000 validates it, so the
  // guarantee the dropped warehouse foreign key carried is preserved per type rather than lost.
  assert.deepEqual([...vocab.OPERATIONAL_SCOPE_TYPES], ["WAREHOUSE", "REORDER_QUEUE"]);
  assert.ok(Object.isFrozen(vocab.OPERATIONAL_SCOPE_TYPES));
  assert.ok(Object.isFrozen(vocab.OPERATIONAL_SCOPE_TYPE_LABEL));
  // The module vocabulary and the database CHECK must be changed together.
  // The CHECK is read from the LATEST migration that defines it, not the first: 1761696000000
  // replaced the constraint, and comparing against the original would pin the vocabulary to a
  // statement the database no longer has.
  const scopeSql = readFileSync(join(FUNCTIONS_DIR, "migrations",
    "1761696000000_parts-associate-eligibility-and-reorder-queue-scope.sql"), "utf8")
    .split("-- Down Migration")[0].split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
  const checked = scopeSql.match(/operational_scope_type_known\s+CHECK \(scope_type IN \(([^)]*)\)\)/);
  assert.ok(checked, "the closed scope-type CHECK must exist");
  assert.deepEqual(checked[1].split(",").map((s) => s.trim().replace(/'/g, "")), [...vocab.OPERATIONAL_SCOPE_TYPES]);
});

test("no arbitrary scope type is built before a live consumer requires one", () => {
  for (const speculative of ["OPERATING_COMPANY", "REGION", "BRANCH", "TERRITORY", "QUEUE", "CUSTOMER", "ALL", "GLOBAL"]) {
    assert.equal(vocab.isOperationalScopeType(speculative), false, `${speculative} must not be a scope type`);
    assert.ok(!new RegExp(`'${speculative}'`).test(SQL), `${speculative} must not appear in the migration`);
  }
});

test("operating company is NOT duplicated into this authority", () => {
  // It already has its own governed Employee authority (employees.operating_company_id, EMP-RT-W2).
  assert.equal(vocab.isOperationalScopeType("OPERATING_COMPANY"), false);
  for (const column of COLUMNS) assert.doesNotMatch(column, /operating|company/);
  const upSql = SQL.split("Down Migration")[0];
  assert.ok(!/operating_company/i.test(upSql.split("CREATE TABLE employee_operational_scopes (")[1] ?? ""),
    "the table must not carry an operating-company reference");
});

test("isOperationalScopeType accepts only an exact canonical type", () => {
  assert.equal(vocab.isOperationalScopeType("WAREHOUSE"), true);
  for (const bad of ["warehouse", "WAREHOUSE ", " WAREHOUSE", "", null, undefined, 7, {}, ["WAREHOUSE"], "Warehouse"]) {
    assert.equal(vocab.isOperationalScopeType(bad), false, `${JSON.stringify(bad)} must not be accepted`);
  }
});

test("the capability is separate from work eligibility, and the migration grants it to nobody", () => {
  assert.equal(vocab.EMPLOYEE_OPERATIONAL_SCOPE_WRITE, "admin.employeeOperationalScope.write");
  // Owner ruling: deciding which warehouses an Employee covers is not the authority that decides what work they are
  // qualified for, nor the one that edits a profile or sets a Job Role.
  for (const other of [eligibility.EMPLOYEE_WORK_ELIGIBILITY_WRITE, "admin.employeeProfile.write", "admin.employeeJobRole.write"]) {
    assert.notEqual(vocab.EMPLOYEE_OPERATIONAL_SCOPE_WRITE, other);
  }
  assert.ok(SQL.includes(`'${vocab.EMPLOYEE_OPERATIONAL_SCOPE_WRITE}'`), "the capability key must be defined by the migration");
  assert.ok(!/INSERT INTO\s+(eos_policy\.)?role_capabilities/i.test(SQL), "the migration must not grant the capability");
  assert.ok(!/INSERT INTO\s+(eos_policy\.)?user_role_assignments/i.test(SQL), "the migration must not create a Security Role assignment");
});

test("the migration seeds no scope and backfills nothing from the legacy array", () => {
  const inserts = [...SQL.matchAll(/INSERT INTO\s+([a-z_.]+)/gi)].map((m) => m[1].toLowerCase());
  assert.deepEqual(inserts, ["capabilities"], "the only insert is the capability vocabulary row");
  const upSql = SQL.split("Down Migration")[0];
  // The legacy array is EVIDENCE for the later governed tooling -- never copied by this migration.
  for (const forbidden of [/assignedWarehouseIds/i, /FROM\s+eos_workforce\.employees/i, /operationalRoles/i,
    /INSERT INTO\s+employee_operational_scopes/i]) {
    assert.ok(!forbidden.test(upSql), `the up migration must not use ${forbidden}`);
  }
  // The evidence field is NAMED for the tooling, and named nowhere else as an authority.
  assert.equal(vocab.LEGACY_SCOPE_EVIDENCE_FIELD, "assignedWarehouseIds");
});

test("the schema anchors scope to a real warehouse in the same tenant", () => {
  // Composite FKs in both directions: the Employee and the warehouse must each resolve within the tenant.
  assert.match(SQL, /FOREIGN KEY \(tenant_id, employee_id\) REFERENCES employees \(tenant_id, id\)/);
  assert.match(SQL, /FOREIGN KEY \(tenant_id, scope_id\) REFERENCES eos_ops\.warehouses \(tenant_id, id\)/);
});

test("the schema keeps history and cannot express access or qualification", () => {
  assert.deepEqual(COLUMNS, ["id", "tenant_id", "employee_id", "scope_type", "scope_id", "effective_from",
    "effective_to", "assigned_by", "ended_by", "ended_at", "reason"]);
  for (const forbidden of ["capab", "permission", "role", "grant", "access", "qualif", "eligib", "job"]) {
    for (const column of COLUMNS) assert.ok(!column.includes(forbidden), `column ${column} must not name a ${forbidden}`);
  }
  // Multiple concurrent warehouses: the uniqueness is per TARGET, not per Employee.
  assert.match(SQL, /CREATE UNIQUE INDEX employee_operational_scope_one_current_per_target\s+ON employee_operational_scopes \(tenant_id, employee_id, scope_type, scope_id\)\s+WHERE effective_to IS NULL/);
  assert.match(MIGRATION, /DELETE is refused/);
  assert.match(MIGRATION, /an ended scope is immutable/);
  assert.match(MIGRATION, /the only permitted change ends a current scope/);
  assert.match(SQL, /BEFORE UPDATE OR DELETE ON employee_operational_scopes/);
  assert.match(MIGRATION, /refuses to reverse/);
});

test("the two decomposed authorities stay separate: no shared table, capability or vocabulary", () => {
  // Step A and step B are independent authorities; nothing here re-fuses them.
  assert.notDeepEqual([...vocab.OPERATIONAL_SCOPE_TYPES], [...eligibility.WORK_ELIGIBILITY_CODES]);
  for (const code of eligibility.WORK_ELIGIBILITY_CODES) assert.equal(vocab.isOperationalScopeType(code), false);
  for (const type of vocab.OPERATIONAL_SCOPE_TYPES) assert.equal(eligibility.isWorkEligibilityCode(type), false);
  // The scope migration must not touch the qualification table, and vice versa.
  assert.ok(!/employee_work_eligibility/i.test(SQL), "the scope migration must not reference the qualification table");
});

test("the label set covers every scope type and is presentation only", () => {
  assert.deepEqual(Object.keys(vocab.OPERATIONAL_SCOPE_TYPE_LABEL).sort(), [...vocab.OPERATIONAL_SCOPE_TYPES].sort());
  for (const type of vocab.OPERATIONAL_SCOPE_TYPES) {
    const label = vocab.OPERATIONAL_SCOPE_TYPE_LABEL[type];
    assert.ok(typeof label === "string" && label.trim() === label && label !== "");
  }
});
