// Migration 008's OFFLINE proofs: the CRM customer namespace, its ownership model, and the
// reconciliation that has to pass before any source document becomes a row.
//
// The structural half of these claims (the columns, the NOT NULLs, the composite foreign keys, the
// absence of a cross-schema edge) is proved against a real postgres:16 in
// crmCustomerPostgres.test.mjs. What is proved HERE is what does not need a database to be wrong:
// that the SQL text creates nothing it disclaimed, that the domain module refuses what the model
// forbids, and that the migration-source reconciliation reports rather than repairs.
//
// This file does not reset any schema — it reads text and calls pure functions — so it is not one
// of the serialized resetters that functions/test/adminPolicyPostgres.test.mjs requires to be
// registered in `test:adminPolicyPostgres`.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  CRM_ACCOUNT_STATUSES,
  CRM_ID_PATTERN,
  CrmIdentityError,
  CrmLocationNamespaceError,
  CrmOwnershipError,
  INVENTORY_LOCATION_DISCRIMINATOR_KEYS,
  INVENTORY_LOCATION_TYPE_LABELS,
  IMPORT_DERIVED_ACCOUNT_ID_PREFIX,
  assertNoInventoryLocationDiscriminator,
  foldCustomerName,
  inheritOwnerFromAccount,
  isImportDerivedAccountId,
  requireCrmId,
  requireCustomerName,
  requireExplicitAccountOwner,
} from "../lib/crm/customerIdentity.js";
import { OPS_LOCATION_TYPES } from "../lib/eosOps/operatingCompanyCustody.js";
import {
  foldedNameCollisions,
  reconcileCustomerMigrationSource,
} from "../lib/crm/customerMigrationSource.js";

const MIGRATIONS_DIR = "migrations";
const MIGRATION_FILE = "1758758400000_crm-account-contact-location.sql";
const migrationSource = readFileSync(join(MIGRATIONS_DIR, MIGRATION_FILE), "utf8");

/** SQL with comment lines removed — a header that DISCUSSES a refused shape is not that shape. */
function executableSql(source) {
  return source.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
}

const upSql = executableSql(migrationSource.split("\n-- Down Migration\n")[0]);
const downSql = executableSql(migrationSource.split("\n-- Down Migration\n")[1] ?? "");

const TENANT = "tenant-a";
const doc = (id, data) => ({ id, data });
const account = (id, extra = {}) => doc(id, { name: `Account ${id}`, status: "ACTIVE", ...extra });
const owner = (employeeId) => ({ type: "USER", id: employeeId });

// ============================ the migration is additive and correctly placed ============================

test("008 uses the pre-allocated id, is the newest, and leaves 001-007 in place", () => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  assert.ok(files.includes(MIGRATION_FILE), "the pre-allocated migration id is the one on disk");
  for (const predecessor of [
    "1757462400000_admin-policy.sql",
    "1757548800000_tenant-and-identity.sql",
    "1757635200000_assignment-integrity.sql",
    "1757721600000_operational-capabilities.sql",
    "1757808000000_eos-ops-foundation.sql",
    "1757894400000_operational-capability-vocabulary.sql",
    "1757980800000_operating-company-and-serialized-custody.sql",
  ]) {
    assert.ok(files.includes(predecessor), `${predecessor} is untouched and still present`);
  }
  // ORDER, NOT POSITION. This asserted that 008 "sorts last". Eleven additive migrations landed
  // together at the W1 integration and only one of them can be last, so every lane that wrote this
  // sentence about its own migration was asserting something that stops being true the moment a
  // sibling lands. The claim that actually matters is ADDITIVE ORDER: this migration is present, and
  // it applies after 007 -- the last migration that existed when it was written -- so it never
  // renumbers or reorders a predecessor. A twelfth migration is then simply a twelfth migration.
  assert.ok(files.includes(MIGRATION_FILE), "the migration is on disk under its own id");
  assert.ok(MIGRATION_FILE > "1757980800000_operating-company-and-serialized-custody.sql",
    "it applies after 007 -- additive, never renumbered in front of a predecessor");

  // node-pg-migrate's own format, the same two sections every predecessor uses.
  assert.match(migrationSource, /^-- Up Migration/);
  assert.match(migrationSource, /\n-- Down Migration\n/);
  assert.match(upSql, /SET search_path = eos_crm, public;/);
  assert.match(downSql, /SET search_path = eos_crm, public;/);
});

// ============================ the schema creates exactly what it claims ============================

test("008 creates eos_crm and EXACTLY three tables", () => {
  assert.match(upSql, /CREATE SCHEMA IF NOT EXISTS eos_crm;/);
  const created = [...upSql.matchAll(/CREATE TABLE (\w+) \(/g)].map((m) => m[1]).sort();
  assert.deepEqual(created, ["account_locations", "accounts", "contacts"]);
});

test("008 creates NO table called `locations` -- the ambiguous name does not cross the boundary", () => {
  // The source collection's name is the ambiguous one. Carrying it across would carry the ambiguity.
  assert.doesNotMatch(upSql, /CREATE TABLE locations\b/);
  assert.match(upSql, /CREATE TABLE account_locations \(/, "the account_ prefix states the invariant in the name");
});

test("008 touches NOTHING in eos_ops or eos_policy beyond the tenant foreign key", () => {
  assert.doesNotMatch(upSql, /ALTER TABLE/, "additive: no existing table is altered");
  assert.doesNotMatch(upSql, /eos_ops/, "no statement in the up migration names the operational schema");
  const policyReferences = [...upSql.matchAll(/eos_policy\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(policyReferences)], ["tenants"], "the only eos_policy dependency is tenancy");
});

// ============================ the namespace separation, in the SQL text ============================

test("the customer-site table has NO type discriminator, and no column named location_id", () => {
  const table = /CREATE TABLE account_locations \(([\s\S]*?)\n\);/.exec(upSql);
  assert.ok(table, "the customer-site table is there to inspect");
  const body = table[1];

  for (const forbidden of ["location_type", "site_type", " type "]) {
    assert.ok(!body.includes(forbidden), `account_locations declares no ${forbidden.trim()} column`);
  }
  // POINT 4 OF THE HEADER. A CRM site's key is `id`. The NAME `location_id` belongs to the inventory
  // pair and is left there, so nothing can later union the two on a shared spelling.
  assert.doesNotMatch(upSql, /\blocation_id\b/, "no column anywhere in eos_crm is named location_id");
});

test("account parentage is MANDATORY and TENANT-SCOPED on both child tables", () => {
  for (const table of ["contacts", "account_locations"]) {
    const body = new RegExp(`CREATE TABLE ${table} \\(([\\s\\S]*?)\\n\\);`).exec(upSql)[1];
    assert.match(body, /account_id\s+TEXT NOT NULL/, `${table}.account_id is NOT NULL -- an inventory location has no Account`);
    assert.match(
      body,
      /FOREIGN KEY \(tenant_id, account_id\) REFERENCES accounts \(tenant_id, id\)/,
      `${table} is parented by a COMPOSITE key, so a cross-tenant parent is refused in SQL`,
    );
  }
  assert.match(
    upSql,
    /CONSTRAINT accounts_tenant_scoped_identity UNIQUE \(tenant_id, id\)/,
    "and accounts offers the composite target that makes those keys possible",
  );
});

test("the Equipment same-Account invariant gets a key it can be enforced with", () => {
  // ADR-006 section 2.1, today an integrity guard in Rules over a collection that validates nothing
  // (firestore.rules:1438-1443). A future Equipment table carries
  // FOREIGN KEY (tenant_id, account_id, location_id) against this.
  assert.match(
    upSql,
    /CONSTRAINT account_locations_account_scoped_identity UNIQUE \(tenant_id, account_id, id\)/,
  );
  // ...and no Equipment table is created here. That is lane C7's object.
  assert.doesNotMatch(upSql, /CREATE TABLE equipment/i);
});

test("no operating company column exists, because the model says the axis does not apply", () => {
  assert.doesNotMatch(upSql, /operating_company/i, "COMPANY_NEUTRAL, per ownershipMatrix.ts:118-141");
  assert.doesNotMatch(upSql, /taylor|ventana/i, "and no deployment-specific company vocabulary anywhere");
});

test("ownership is ONE nullable person column -- no owner_type, no NOT NULL", () => {
  const declarations = [...upSql.matchAll(/owner_employee_id\s+([^,\n]+)/g)].map((m) => m[1].trim());
  assert.equal(declarations.length, 3, "all three tables carry it");
  for (const declaration of declarations) {
    assert.equal(declaration, "TEXT", "TEXT, nullable, no default -- OWNERLESS is a legal state");
  }
  assert.doesNotMatch(upSql, /owner_type/, "the owner type is fixed by classification, not restated per row");
});

test("the folded-name index is NOT unique -- D-C1-4 says the doc id is the only hard-unique key", () => {
  assert.match(upSql, /CREATE INDEX accounts_by_folded_name ON accounts \(tenant_id, lower\(btrim\(name\)\)\)/);
  assert.doesNotMatch(upSql, /CREATE UNIQUE INDEX[\s\S]*?lower\(btrim\(name\)\)/);
  // Nor anywhere else: no unique constraint on a name, a customer number, or an external id.
  assert.doesNotMatch(upSql, /UNIQUE \(tenant_id, name\)/);
});

test("no unique index decides the primary-contact question the product left open", () => {
  assert.doesNotMatch(upSql, /is_primary[\s\S]{0,80}UNIQUE/);
  assert.doesNotMatch(upSql, /CREATE UNIQUE INDEX[\s\S]*?is_primary/);
});

// ============================ the down migration refuses ============================

test("the down REFUSES occupied tables before it reverses anything", () => {
  const raise = downSql.indexOf("RAISE EXCEPTION");
  const drop = downSql.indexOf("eos_crm CASCADE");
  assert.ok(raise !== -1, "the down raises rather than deleting customer master data silently");
  assert.ok(drop !== -1, "and otherwise reverses the whole schema, which is what the up created");
  assert.ok(raise < drop, "the refusal comes FIRST");
  for (const table of ["accounts", "contacts", "account_locations"]) {
    assert.ok(
      new RegExp(`FROM eos_crm\\.${table}\\b`).test(downSql),
      `${table} is counted, not assumed empty`,
    );
  }
});

// ============================ the domain module ============================

test("the status vocabulary is the D-C1-5 lifecycle, and matches the SQL enum", () => {
  assert.deepEqual([...CRM_ACCOUNT_STATUSES], ["PROSPECT", "ACTIVE", "INACTIVE", "ARCHIVED"]);
  const enumLabels = /CREATE TYPE crm_account_status AS ENUM \(([^)]+)\)/.exec(upSql)[1]
    .split(",").map((s) => s.trim().replace(/'/g, ""));
  assert.deepEqual(enumLabels, [...CRM_ACCOUNT_STATUSES], "the TypeScript list and the SQL enum cannot drift apart silently");
});

test("the inventory vocabulary this module refuses is pinned to the real one", () => {
  // Deliberately a COPY, not an import: importing it would create the first dependency edge between
  // the CRM domain and the operational one. This test is what keeps the copy honest.
  assert.deepEqual([...INVENTORY_LOCATION_TYPE_LABELS], [...OPS_LOCATION_TYPES]);
});

test("ids are carried verbatim -- accepted or refused, never re-minted", () => {
  const imported = "IMP-ACCEPTANCE-ICE-CO-NQX1QO-1OSKNMX";
  assert.equal(requireCrmId(imported, "an Account id"), imported, "an import-derived id survives byte for byte");
  assert.equal(isImportDerivedAccountId(imported), true);
  assert.equal(IMPORT_DERIVED_ACCOUNT_ID_PREFIX, "IMP-");
  assert.equal(isImportDerivedAccountId("cw-acct-1"), false, "an interface-minted id is not import-derived");

  for (const bad of ["", "has space", "has/slash", "a".repeat(201), 7, null, undefined]) {
    assert.throws(() => requireCrmId(bad, "an id"), CrmIdentityError, `${JSON.stringify(bad)} is refused`);
  }
  assert.ok(CRM_ID_PATTERN.test("cw-acct-0001-loc-2"), "the CRM site id shapes the census saw are valid ids");
});

test("the name fold is trim-and-lowercase and NOTHING else -- byte-for-byte with the deployed writer", () => {
  // functions/src/account/accountImportCommand.ts:85-90 warns explicitly against collapsing double
  // spaces. Read its implementation rather than trusting the comment.
  const deployed = readFileSync("src/account/accountImportCommand.ts", "utf8");
  const body = /function normalizeAccountSearchName\([\s\S]*?\n\}/.exec(deployed);
  assert.ok(body, "the deployed normalizer is still there to compare against");
  assert.match(body[0], /\.trim\(\)/);
  assert.match(body[0], /\.toLowerCase\(\)/);
  assert.doesNotMatch(body[0], /replace/, "it does not collapse whitespace, and neither may we");

  assert.equal(foldCustomerName("  Acceptance  Ice Co  "), "acceptance  ice co", "internal double space survives");
  assert.equal(foldCustomerName("ACME"), "acme");
  // And the SQL expression is the same fold.
  assert.match(upSql, /lower\(btrim\(name\)\)/);
});

test("a name is required, and whitespace is not a name", () => {
  assert.equal(requireCustomerName("Acme", "an Account"), "Acme");
  for (const bad of ["", "   ", null, 3]) {
    assert.throws(() => requireCustomerName(bad, "an Account"), CrmIdentityError);
  }
});

test("ruling D-6: an Account owner is EXPLICIT or ABSENT, and cannot be inferred", () => {
  assert.equal(requireExplicitAccountOwner("emp-1"), "emp-1");
  assert.equal(requireExplicitAccountOwner(null), null, "OWNERLESS is an answer, not a failure");
  assert.equal(requireExplicitAccountOwner(undefined), null);
  for (const bad of ["", "   ", 7, {}, { type: "USER", id: "emp-1" }]) {
    assert.throws(() => requireExplicitAccountOwner(bad), CrmOwnershipError);
  }
  // The function takes ONE argument. There is no actor, session or territory in scope that a
  // fallback could reach, which is the point -- the fallback is the forbidden thing.
  assert.equal(requireExplicitAccountOwner.length, 1);
});

test("inheritance propagates OWNERLESS rather than substituting an owner", () => {
  assert.equal(inheritOwnerFromAccount("emp-9"), "emp-9");
  assert.equal(inheritOwnerFromAccount(null), null, "an ownerless parent yields an ownerless child");
});

test("a customer site carrying an inventory discriminator is REFUSED, not cleaned up", () => {
  assert.deepEqual([...INVENTORY_LOCATION_DISCRIMINATOR_KEYS], ["type", "locationType"]);
  for (const key of INVENTORY_LOCATION_DISCRIMINATOR_KEYS) {
    assert.throws(
      () => assertNoInventoryLocationDiscriminator({ name: "Plant 2", accountId: "a1", [key]: "WAREHOUSE" }),
      CrmLocationNamespaceError,
      `${key} is a refusal`,
    );
  }
  // Undefined is still PRESENT: `{ type: undefined }` is a caller that meant to say a type.
  assert.throws(
    () => assertNoInventoryLocationDiscriminator({ type: undefined }),
    CrmLocationNamespaceError,
  );
  assert.doesNotThrow(() => assertNoInventoryLocationDiscriminator({ name: "Plant 2", accountId: "a1" }));
});

test("no CRM module ever offers to classify a bare location id", () => {
  // The operation with no correct answer. Offering it would make every caller's guess look governed.
  const repository = readFileSync("src/crm/customerRepository.ts", "utf8");
  assert.doesNotMatch(repository, /export (async )?function resolveLocation\b/);
  assert.doesNotMatch(repository, /warehouses|mobile_locations|stock_locations/,
    "the CRM repository names no inventory collection at all");
  const identity = readFileSync("src/crm/customerIdentity.ts", "utf8");
  assert.doesNotMatch(identity, /from "\.\.\/eosOps/, "and imports nothing from the operational domain");
});

test("the repository offers no generic write, no delete, and no Firebase", () => {
  const repository = readFileSync("src/crm/customerRepository.ts", "utf8");
  // By IMPORT, not by keyword: this file DISCUSSES Firebase in prose, exactly as
  // scripts/firebaseExitGuard.mjs's header warns a keyword scan would trip on.
  assert.doesNotMatch(repository, /from ["'][^"']*firebase/i);
  assert.doesNotMatch(repository, /require\(["'][^"']*firebase/i);
  assert.doesNotMatch(repository, /\bDELETE FROM\b/, "ARCHIVED is soft-delete only; there is no delete path");
  assert.doesNotMatch(repository, /export (async )?function (update|patch|upsert|set)\w*\(/,
    "every command names the fact it changes");
});

// ============================ reconciliation: reports, never repairs ============================

test("a clean export reconciles one-for-one, with the ownership buckets kept apart", () => {
  const report = reconcileCustomerMigrationSource({
    accounts: [
      account("acc-1", { accountOwner: { assignedToEmployeeId: "emp-1", assignedToDisplayName: "stale name" } }),
      account("IMP-ACCEPTANCE-ICE-CO-NQX1QO-1OSKNMX", { accountOwner: owner("emp-2") }),
      account("acc-3"),
    ],
    contacts: [doc("con-1", { accountId: "acc-1", name: "Dana", email: "d@x.test", isPrimary: true })],
    locations: [
      doc("cw-acct-1-loc-1", { accountId: "acc-1", name: "Plant 2", address: { street: "1 Main", city: "Reno", state: "NV", zip: "89501" } }),
      doc("loc-9", { accountId: "acc-3", name: "Dock", addressLine1: "9 Pier", city: "Sparks", state: "NV" }),
    ],
  }, TENANT);

  assert.equal(report.ready, true);
  assert.deepEqual(report.counts, {
    accountsIn: 3, contactsIn: 1, locationsIn: 2, accountsOut: 3, contactsOut: 1, locationsOut: 2,
  });
  assert.equal(report.importDerivedAccountIds, 1, "the IMP- id is recognised as an ACCOUNT id");
  assert.deepEqual(report.addressShapes, { nested: 1, flat: 1, absent: 0 }, "both source shapes reconcile");
  assert.equal(report.ownership.accountsOwned, 2);
  assert.equal(report.ownership.accountsOwnerless, 1);
  assert.equal(report.ownership.locationsOwned, 1, "the site under the ownerless Account stays ownerless");
  assert.equal(report.ownership.locationsOwnerless, 1);

  // The Person Assignment map's stored display name is deliberately discarded, and only the employee
  // id survives -- customers-structured-list.md:56-65.
  assert.equal(report.accounts.find((a) => a.id === "acc-1").ownerEmployeeId, "emp-1");
  const nested = report.locations.find((l) => l.id === "cw-acct-1-loc-1");
  assert.deepEqual(
    [nested.addressStreet, nested.addressCity, nested.addressState, nested.addressPostalCode],
    ["1 Main", "Reno", "NV", "89501"],
  );
  const flat = report.locations.find((l) => l.id === "loc-9");
  assert.deepEqual([flat.addressStreet, flat.addressCity, flat.addressState], ["9 Pier", "Sparks", "NV"]);

  // OWNERLESS is reported, and it is ADVISORY -- it does not block, because it is legal.
  const ownerless = report.findings.filter((f) => f.code === "OWNERLESS");
  assert.equal(ownerless.length, 1);
  assert.equal(ownerless[0].severity, "ADVISORY");
});

test("a customer site carrying a location type BLOCKS the whole reconciliation", () => {
  const report = reconcileCustomerMigrationSource({
    accounts: [account("acc-1")],
    contacts: [],
    locations: [doc("loc-1", { accountId: "acc-1", name: "Bay 3", type: "WAREHOUSE" })],
  }, TENANT);

  assert.equal(report.ready, false);
  assert.equal(report.namespace.customerSitesCarryingADiscriminator, 1);
  assert.equal(report.counts.locationsOut, 0, "it is refused, not stripped of its type and written anyway");
  const refusal = report.findings.find((f) => f.code === "INVENTORY_DISCRIMINATOR_PRESENT");
  assert.ok(refusal, "the refusal names the namespace, not a generic shape error");
  assert.equal(refusal.severity, "BLOCKING");
});

test("an id that is ALSO an inventory location id BLOCKS -- the namespaces must stay disjoint", () => {
  const report = reconcileCustomerMigrationSource({
    accounts: [account("acc-1")],
    contacts: [],
    locations: [
      doc("wh-main", { accountId: "acc-1", name: "Main" }),
      doc("cw-acct-1-loc-1", { accountId: "acc-1", name: "Plant" }),
    ],
    inventoryLocationIds: ["wh-main", "truck-7"],
  }, TENANT);

  assert.equal(report.ready, false);
  assert.equal(report.namespace.inventoryIdsChecked, 2, "'we did not look' and 'we looked' stay distinguishable");
  assert.equal(report.namespace.idCollisionsWithInventory, 1);
  assert.deepEqual(report.locations.map((l) => l.id), ["cw-acct-1-loc-1"]);
});

test("the disjointness check is reported as VACUOUS when no inventory ids were supplied", () => {
  const report = reconcileCustomerMigrationSource({
    accounts: [account("acc-1")],
    contacts: [],
    locations: [doc("loc-1", { accountId: "acc-1", name: "Plant" })],
  }, TENANT);
  assert.equal(report.namespace.inventoryIdsChecked, 0);
  assert.equal(report.ready, true, "a vacuous check does not fail the run -- it just proves nothing");
});

test("an orphaned Contact or site BLOCKS; the parent is never guessed", () => {
  const report = reconcileCustomerMigrationSource({
    accounts: [account("acc-1")],
    contacts: [doc("con-1", { accountId: "acc-missing", name: "Dana" }), doc("con-2", { name: "Rae" })],
    locations: [doc("loc-1", { accountId: "acc-missing", name: "Plant" })],
  }, TENANT);

  assert.equal(report.ready, false);
  const codes = report.findings.filter((f) => f.severity === "BLOCKING").map((f) => f.code).sort();
  assert.deepEqual(codes, ["ACCOUNT_ID_MISSING", "ACCOUNT_ID_ORPHANED", "ACCOUNT_ID_ORPHANED"]);
  assert.equal(report.counts.contactsOut, 0);
  assert.equal(report.counts.locationsOut, 0);
});

test("an unrecognised owner shape BLOCKS -- a malformed owner is not an absent one", () => {
  const report = reconcileCustomerMigrationSource({
    accounts: [account("acc-1", { accountOwner: { type: "COMPANY", id: "taylor" } })],
    contacts: [],
    locations: [],
  }, TENANT);
  assert.equal(report.ready, false);
  assert.deepEqual(report.findings.map((f) => f.code), ["OWNER_SHAPE_UNRECOGNISED"]);
  assert.equal(report.counts.accountsOut, 0, "a PERSON family does not silently accept a COMPANY owner");
});

test("an unassigned Person Assignment map is OWNERLESS, not malformed", () => {
  const report = reconcileCustomerMigrationSource({
    accounts: [account("acc-1", { accountOwner: { assignedToEmployeeId: "" } })],
    contacts: [], locations: [],
  }, TENANT);
  assert.equal(report.ready, true);
  assert.equal(report.accounts[0].ownerEmployeeId, null);
  assert.deepEqual(report.findings.map((f) => f.code), ["OWNERLESS"]);
});

test("two disagreeing address shapes on one document BLOCK rather than picking a winner", () => {
  const report = reconcileCustomerMigrationSource({
    accounts: [account("acc-1")],
    contacts: [],
    locations: [doc("loc-1", {
      accountId: "acc-1", name: "Plant",
      address: { street: "1 Main", city: "Reno" },
      addressLine1: "2 Other", city: "Reno",
    })],
  }, TENANT);
  assert.equal(report.ready, false);
  const conflict = report.findings.find((f) => f.code === "ADDRESS_SHAPE_CONFLICT");
  assert.ok(conflict);
  assert.match(conflict.detail, /street/);
});

test("an unrecognised status BLOCKS rather than defaulting to ACTIVE", () => {
  const report = reconcileCustomerMigrationSource({
    accounts: [account("acc-1", { status: "CUSTOMER" })], contacts: [], locations: [],
  }, TENANT);
  assert.equal(report.ready, false);
  assert.deepEqual(report.findings.map((f) => f.code), ["STATUS_UNRECOGNISED"]);
});

test("a Contact's own stated owner survives a later handoff away from its Account's", () => {
  const report = reconcileCustomerMigrationSource({
    accounts: [account("acc-1", { accountOwner: owner("emp-1") })],
    contacts: [doc("con-1", { accountId: "acc-1", name: "Dana", owner: owner("emp-2") })],
    locations: [doc("loc-1", { accountId: "acc-1", name: "Plant" })],
  }, TENANT);
  assert.equal(report.contacts[0].ownerEmployeeId, "emp-2", "HANDOFF means the child may have diverged");
  assert.equal(report.locations[0].ownerEmployeeId, "emp-1", "and a child with no owner of its own inherits");
});

test("duplicate-name groups are reported as ADVISORY, and nothing refuses them", () => {
  const report = reconcileCustomerMigrationSource({
    accounts: [
      account("acc-1", { name: "Acceptance Ice Co" }),
      account("acc-2", { name: "  acceptance ice co " }),
      account("acc-3", { name: "Other" }),
    ],
    contacts: [], locations: [],
  }, TENANT);
  assert.equal(report.ready, true, "D-C1-4: the doc id is the only hard-unique key");
  const collisions = foldedNameCollisions(report.accounts);
  assert.deepEqual([...collisions.keys()], ["acceptance ice co"]);
  assert.deepEqual(collisions.get("acceptance ice co"), ["acc-1", "acc-2"]);
});
