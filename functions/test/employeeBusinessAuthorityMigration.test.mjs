// MIGRATION 019 — the Employee business authority, proved WITHOUT a database.
//
// ════════════════════ WHY THESE ARE STATIC ════════════════════
//
// The Postgres suites in this repository skip without POLICY_TEST_DATABASE_URL, which is correct for
// properties of the database (a unique index firing, a trigger raising) but useless for the properties
// that matter most about THIS migration. Those are properties of the TEXT:
//
//   * that the employment vocabulary it encodes is byte-identical to the governed one, and
//   * that it does NOT contain certain things -- no eligibility flag, no partial index on ACTIVE, no
//     foreign key onto a person column, no Employee business fact added to `principals`.
//
// An absence is not observable by querying a migrated database for what is there. It is observable by
// reading the file, so that is what these do, and they run on every machine rather than only on one with
// a cluster. Ruling #186 §4 calls the existing vocabulary drift guard "real"; this is the same kind of
// guard pointed at the SQL.
//
// APPLYING THE MIGRATION IS NOT ATTEMPTED HERE AND IS REPORTED AS NOT RUN. It needs a database, and the
// lane that wrote it had none.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { declaredTables, declaredSchemas, migrationFiles } from "./support/migrationSchema.mjs";
import { EMPLOYMENT_STATUS_VALUES } from "../lib/employeeIdentity/employeeAuthority.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FUNCTIONS_DIR = resolve(HERE, "..");

const MIGRATION = "1759104000000_employee-business-authority.sql";
const MIGRATION_PATH = join(FUNCTIONS_DIR, "migrations", MIGRATION);
const DEFERRED = "1759190400000_employee-principal-link-employee-fk.sql";
const DEFERRED_PATH = join(FUNCTIONS_DIR, "migrations", "deferred", DEFERRED);

const raw = readFileSync(MIGRATION_PATH, "utf8");
const upSection = raw.split(/^-- Down Migration/m)[0];
const downSection = raw.split(/^-- Down Migration/m)[1] ?? "";
/** Comment lines removed, so every assertion below is about SQL rather than about prose. */
const code = (section) =>
  section.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
const upCode = code(upSection);
const downCode = code(downSection);

// ════════════════════ 1. IT IS IN THE MIGRATION SET, AND THE DEFERRED ONE IS NOT ════════════════════

test("migration 019 is in the applied set and declares eos_workforce.employees", () => {
  assert.ok(migrationFiles().includes(MIGRATION), "the migration must be in functions/migrations");
  assert.ok(declaredSchemas().includes("eos_workforce"));
  assert.deepEqual(declaredTables().get("eos_workforce"), ["employees"]);
});

test("exactly ONE new relation is created -- not a table plus a history table plus a role table", () => {
  const created = [...upCode.matchAll(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_.]+)/gim)].map((m) => m[1]);
  assert.deepEqual(created, ["employees"], "#185's target names ONE PostgreSQL Employee relation");
});

test("the deferred foreign key exists, is complete, and is NOT in the applied migration set", () => {
  // The whole safety property of shipping an unapplied migration. node-pg-migrate 9 keeps only
  // `dirent.isFile()` entries of the migrations directory and never recurses, and migrationFiles()
  // filters on `.endsWith(".sql")` in that one directory -- so a subdirectory is invisible to both.
  assert.ok(existsSync(DEFERRED_PATH), "the follow-up constraint must be delivered, not merely described");
  assert.ok(
    !migrationFiles().includes(DEFERRED),
    "the deferred constraint must NOT be in the applied set: it would be evaluated against person ids " +
      "for which no Employee row can yet exist, and #189 forbids every way of making that pass",
  );
  assert.ok(
    !migrationFiles().some((f) => f.includes("employee-principal-link-employee-fk")),
    "and must not appear under any name",
  );

  const deferred = readFileSync(DEFERRED_PATH, "utf8");
  // Complete: it really is the constraint, and it really is the tenant-scoped shape.
  assert.match(deferred, /ADD CONSTRAINT employee_principal_links_employee_fk/);
  assert.match(deferred, /FOREIGN KEY \(tenant_id, employee_id\)/);
  assert.match(deferred, /REFERENCES eos_workforce\.employees \(tenant_id, id\)/);
  assert.match(deferred, /DROP CONSTRAINT IF EXISTS employee_principal_links_employee_fk/);
  // And it says, in its own text, that it is not to be applied yet.
  assert.match(deferred, /NOT APPLIED/);
  assert.match(deferred, /measureEmployeeReferenceIntegrity/, "it must name the measurement that gates it");
});

test("the deferred key targets a UNIQUE that migration 019 actually declares", () => {
  // A composite foreign key needs a matching UNIQUE, and a follow-up that referenced one this migration
  // did not create would fail only when somebody finally applied it.
  assert.match(upCode, /CONSTRAINT employees_tenant_scoped_unique UNIQUE \(tenant_id, id\)/);
});

// ════════════════════ 2. THE VOCABULARY DRIFT GUARD ════════════════════

test("the migration's employment enum matches EMPLOYMENT_STATUS_VALUES exactly, in order", () => {
  // The guard the brief and ruling #186 §4 both ask for, in the spirit of the shipped mirror test at
  // functions/test/employeeProfileCommands.test.mjs:570. If somebody adds a seventh status in code and
  // not in the schema -- or the reverse -- this is what says so.
  const block = /CREATE TYPE workforce_employment_status AS ENUM \(([^)]*)\)/.exec(upCode);
  assert.ok(block, "workforce_employment_status must still be declared as an ENUM");
  const fromSql = [...block[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);

  assert.deepEqual(fromSql, [...EMPLOYMENT_STATUS_VALUES], "the schema and the port must agree, in order");
  assert.equal(fromSql.length, 6, "six governed values -- no more, and none omitted");
});

test("the enum agrees with the TypeScript command vocabulary and its canonical home too", () => {
  // Three statements of one vocabulary, so no pair can drift silently: the SQL, the command's export,
  // and the canonical home ruling #186 §4 names (NOT the provisioning script that module's own header
  // claims, which holds only EMPLOYMENT_STATUS_ACTIVE).
  const block = /CREATE TYPE workforce_employment_status AS ENUM \(([^)]*)\)/.exec(upCode);
  const fromSql = [...block[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);

  const ts = readFileSync(join(FUNCTIONS_DIR, "src/access/employeeProfileCommands.ts"), "utf8");
  const tsBlock = /export const EMPLOYMENT_STATUS_VALUES = Object\.freeze\(\[([^\]]*)\]/.exec(ts);
  assert.ok(tsBlock, "EMPLOYMENT_STATUS_VALUES must still exist in employeeProfileCommands.ts");
  assert.deepEqual(fromSql, [...tsBlock[1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]));

  const constants = readFileSync(join(FUNCTIONS_DIR, "../field-ops-app-vite/src/domain/constants.js"), "utf8");
  const cBlock = /export const EMPLOYMENT_STATUS = \{([^}]*)\}/.exec(constants);
  assert.ok(cBlock, "EMPLOYMENT_STATUS must still exist in domain/constants.js");
  assert.deepEqual(fromSql, [...cBlock[1].matchAll(/([A-Z_]+):\s*"([A-Z_]+)"/g)].map((m) => m[2]));
});

test("the enum idiom is used, not a CHECK -- the house test for a platform vocabulary", () => {
  // Migration 016:161-164 states the rule: a closed vocabulary the PLATFORM defines may be a SQL enum,
  // unlike tenant-configurable `operating_company_key`. EMPLOYMENT_STATUS is platform-defined and frozen.
  assert.match(upCode, /CREATE TYPE workforce_employment_status AS ENUM/);
  assert.ok(
    !/employment_status\s+TEXT/.test(upCode),
    "employment_status must be the enum type, not TEXT with a CHECK bolted on",
  );
  assert.match(downCode, /DROP TYPE IF EXISTS workforce_employment_status/, "and the down must drop the type");
});

// ════════════════════ 3. STATUS IS A LIFECYCLE FACT, NOT AN ELIGIBILITY FLAG ════════════════════

test("no eligibility flag is stored on the Employee", () => {
  // #186 §2 makes lifecycle status and current eligibility separate facts, and #189 (MI-e) forbids
  // implementing eligibility as `status != ACTIVE`. A boolean column here would encode exactly that, and
  // it would be the schema making the policy decision the ruling assigns to a policy layer.
  for (const forbidden of [
    /\bis_eligible\b/, /\bis_active\b/, /\bactive\b\s+BOOLEAN/i, /\bcan_be_accountable\b/,
    /\beligible\b/, /\bis_historical\b/, /\bis_current\b/,
  ]) {
    assert.ok(!forbidden.test(upCode), `the Employee relation must not carry an eligibility flag (${forbidden})`);
  }
});

test("no index treats ACTIVE as the interesting value", () => {
  // A partial index `WHERE employment_status = 'ACTIVE'` is the same collapse in a different place: the
  // schema asserting that one of six values matters and the other five are one bucket. #186 §4 forbids
  // the bucket.
  assert.ok(
    !/CREATE\s+(UNIQUE\s+)?INDEX[\s\S]*?WHERE[\s\S]*?employment_status/i.test(upCode),
    "no partial index may be keyed on employment_status",
  );
  // 'ACTIVE' legitimately appears once -- as a value inside the enum declaration, where it is one of six
  // peers. Anywhere ELSE it would be the schema singling it out, so the declaration is removed first
  // rather than the check being weakened.
  const withoutEnum = upCode.replace(/CREATE TYPE workforce_employment_status AS ENUM \([^)]*\);/, "");
  assert.ok(
    !/'ACTIVE'/.test(withoutEnum),
    "the literal 'ACTIVE' must appear nowhere outside the enum declaration's value list",
  );
});

test("employment_status has NO DEFAULT", () => {
  // Migration 008:100-104's reason for operating_company_id: a DEFAULT lets a writer that never decided
  // produce a row that claims it did. For this column the value a default would pick is ACTIVE, which is
  // the most expensive wrong answer the table can give.
  // The COLUMN line, not the CREATE TYPE line -- `workforce_employment_status` contains
  // `employment_status` as a substring, so a naive match finds the type declaration first and that line
  // has no NOT NULL on it either way.
  const line = upCode
    .split("\n")
    .find((l) => /^\s*employment_status\s+workforce_employment_status\b/.test(l));
  assert.ok(line, "the employment_status column must still be declared");
  assert.match(line, /NOT NULL/);
  assert.ok(!/DEFAULT/i.test(line), "employment_status must have no DEFAULT");
});

// ════════════════════ 4. WHAT THE MIGRATION MUST NOT TOUCH ════════════════════

test("no foreign key is added to any existing person-reference column", () => {
  // The MI-l decision, asserted rather than described. This is the guard that would fail if somebody
  // later "helpfully" folded the deferred constraint back into this file.
  assert.ok(
    !/ALTER\s+TABLE[\s\S]*?ADD\s+CONSTRAINT[\s\S]*?FOREIGN\s+KEY/i.test(upCode),
    "#189 (MI-l): no FK onto an existing person column may be added here -- it would have to fabricate, " +
      "infer or delete to pass, and all three are forbidden",
  );
  for (const table of ["employee_principal_links", "ownership_handoffs", "opportunities", "sales_agreements", "sales_orders", "accounts", "contacts", "account_locations"]) {
    assert.ok(!new RegExp(`ALTER\\s+TABLE\\s+(?:\\w+\\.)?${table}\\b`, "i").test(upCode), `migration 019 must not ALTER ${table}`);
  }
});

test("principals gains no Employee business fact, and the crosswalk gains no column", () => {
  // #185 keeps EMPLOYEE, PRINCIPAL and CREDENTIAL permanently separate, and migration 008:19-33 already
  // refused `principals.employee_id`. This asserts migration 019 does not quietly undo either.
  assert.ok(!/ALTER\s+TABLE\s+(?:eos_policy\.)?principals/i.test(upCode));
  assert.ok(!/ADD\s+COLUMN/i.test(upCode), "migration 019 adds no column to any existing table");
});

test("the Employee relation carries no credential or identity-provider fact", () => {
  // The `/Employee` seam #185 struck from four architecture documents, in column form. A firebase_uid or
  // external_subject column here would make the Employee table a credential table.
  for (const forbidden of ["external_subject", "identity_provider", "firebase_uid", "firebaseUid", "user_id", "technician_id", "principal_id", "display_name"]) {
    assert.ok(!upCode.includes(forbidden), `the Employee relation must not carry ${forbidden} (#185, #187 §3)`);
  }
});

test("it is not in eos_policy -- Employee is business data, not policy data", () => {
  assert.match(upCode, /CREATE SCHEMA IF NOT EXISTS eos_workforce/);
  assert.match(upCode, /SET search_path = eos_workforce, public/);
  assert.ok(
    !declaredTables().get("eos_policy")?.includes("employees"),
    "eos_policy.employees would rebuild the identity-carve-out seam #185 struck",
  );
});

test("no existing migration file was modified", () => {
  // "Additive: no existing migration is edited" is a claim this migration's header makes; the shipped
  // files are what make it checkable. Anything older than 019 must be byte-identical to HEAD's parent.
  const older = migrationFiles().filter((f) => f < MIGRATION);
  assert.equal(older.length, 18, "the eighteen prior migrations must all still be present");
});

// ════════════════════ 5. THE DOWN REFUSES ════════════════════

test("the down migration refuses while any Employee is held", () => {
  // Migration 015's "REFUSE, NEVER DESTROY" shape. Dropping the canonical identity of people is the
  // "deleted from immutable history" #189 forbids, not a reversal.
  assert.match(downCode, /SELECT count\(\*\)\s+INTO\s+recorded\s+FROM eos_workforce\.employees/);
  assert.match(downCode, /RAISE EXCEPTION/);
  assert.match(downCode, /IF recorded > 0 THEN/);
  assert.match(downCode, /USING HINT/, "a refusal must tell the operator what to do instead");
  assert.match(downCode, /DROP SCHEMA IF EXISTS eos_workforce CASCADE/);
});

// ════════════════════ 6. THE FILE PARSES AS THE HOUSE FORMAT ════════════════════

test("the migration is well-formed raw SQL in the node-pg-migrate convention", () => {
  assert.ok(raw.startsWith("-- Up Migration"), "node-pg-migrate's raw-SQL convention, as all 18 others do");
  assert.ok(/^-- Down Migration$/m.test(raw), "and it must have a Down section");

  for (const [name, section] of [["up", upCode], ["down", downCode]]) {
    const open = (section.match(/\(/g) ?? []).length;
    const close = (section.match(/\)/g) ?? []).length;
    assert.equal(open, close, `${name}: parentheses must balance`);
    assert.equal((section.match(/'/g) ?? []).length % 2, 0, `${name}: string literals must be closed`);
    assert.equal((section.match(/\$\$/g) ?? []).length % 2, 0, `${name}: dollar-quoted blocks must be closed`);
    assert.ok(section.trim().endsWith(";"), `${name}: the last statement must be terminated`);
  }
});

test("the deferred migration is well-formed too, so moving it is the only step needed", () => {
  const deferred = readFileSync(DEFERRED_PATH, "utf8");
  assert.ok(deferred.startsWith("-- Up Migration"));
  assert.ok(/^-- Down Migration$/m.test(deferred));
  for (const section of deferred.split(/^-- Down Migration$/m)) {
    const c = code(section);
    assert.equal((c.match(/\(/g) ?? []).length, (c.match(/\)/g) ?? []).length);
    assert.ok(c.trim().endsWith(";"));
  }
});

test("APPLICATION AGAINST A REAL DATABASE IS NOT PROVED HERE", () => {
  // Recorded as a test so the gap is visible in the suite's output rather than only in a report. These
  // proofs are about the TEXT. Whether PostgreSQL accepts it, whether the enum and CHECKs behave, and
  // whether the down actually raises are properties of the database, and this lane had no reachable
  // one: POLICY_TEST_DATABASE_URL is unset.
  //
  // The registered home for that proof is `npm run test:adminPolicyPostgres`, whose CI job supplies an
  // ephemeral postgres:16 and runs `node-pg-migrate up` over the whole directory -- so migration 019 is
  // exercised there the moment this lands, without a new suite. NOT RUN in this lane.
  assert.equal(process.env.POLICY_TEST_DATABASE_URL ?? "", "", "if this fails, a database WAS available and the migration should have been applied and proved");
});
