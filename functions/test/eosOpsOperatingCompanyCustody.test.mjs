// EOS Operational Data Plane — migration 007's OFFLINE proofs: the operating-company vocabulary and
// the two location vocabularies, asserted over the domain module and the migration source itself.
//
// The structural half of these claims (NOT NULL, the enums, the CHECK, the migration's refusal to
// backfill) is proved against a real postgres:16 in eosOpsOperatingCompanyCustodyPostgres.test.mjs.
// What is proved HERE is what does not need a database to be wrong: that the SQL text contains no
// deployment-specific vocabulary and no default, and that the TypeScript domain keeps physical
// movement and serialized custody apart.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  OPS_LOCATION_TYPES,
  OPS_CUSTODY_LOCATION_TYPES,
  OperatingCompanyAuthorityError,
  custodyLocationTypeOf,
  isInstalledCustodyConsistent,
  isOpsCustodyLocationType,
  isOpsLocationType,
  requireOperatingCompanyKey,
} from "../lib/eosOps/operatingCompanyCustody.js";

const MIGRATIONS_DIR = "migrations";
const MIGRATION_FILE = "1757980800000_operating-company-and-serialized-custody.sql";
const migrationSource = readFileSync(join(MIGRATIONS_DIR, MIGRATION_FILE), "utf8");

/** SQL with comment lines removed -- a header that DISCUSSES a forbidden shape is not that shape. */
function executableSql(source) {
  return source.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
}

// ============================ the migration is additive and correctly ordered ============================

test("007 sits in its ordered place, and 005 and 006 are untouched by it", () => {
  // The claim is ORDER, not "007 is last" -- migration 008 (the warehouse/bin location authority)
  // now sorts after it, and a test that pinned the tail would have to be rewritten by every
  // additive migration that follows. What must stay true is that 007 sits immediately after 006 and
  // that neither 005 nor 006 was edited to make room for it.
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  assert.equal(files[4], "1757808000000_eos-ops-foundation.sql");
  assert.equal(files[5], "1757894400000_operational-capability-vocabulary.sql");
  assert.equal(files[6], MIGRATION_FILE, "007 is the seventh -- additive, never renumbered");

  // node-pg-migrate's own format, the same two sections every predecessor uses.
  assert.match(migrationSource, /^-- Up Migration/);
  assert.match(migrationSource, /\n-- Down Migration\n/);
});

test("the migration adds the column to exactly the three authority-bearing tables", () => {
  const sql = executableSql(migrationSource);
  const added = [...sql.matchAll(/ALTER TABLE (\w+)\s+ADD COLUMN operating_company_key/g)].map((m) => m[1]);
  assert.deepEqual(added.sort(), ["cycle_count_sheets", "inventory_movements", "serialized_custody"]);
  assert.equal(
    /cycle_count_lines\s+ADD COLUMN operating_company_key/.test(sql), false,
    "a line inherits its sheet's authority; a second copy could only ever disagree",
  );
});

test("the column is TEXT NOT NULL with NO DEFAULT", () => {
  const sql = executableSql(migrationSource);
  const declarations = [...sql.matchAll(/ADD COLUMN operating_company_key ([^;]+);/g)].map((m) => m[1].trim());
  assert.equal(declarations.length, 3);
  for (const declaration of declarations) {
    assert.equal(declaration, "TEXT NOT NULL", "exactly the ruled representation -- and no DEFAULT clause");
  }
  assert.doesNotMatch(
    sql, /ALTER COLUMN operating_company_key\s+SET DEFAULT/i,
    "and no later statement adds one back",
  );
  assert.doesNotMatch(
    sql, /UPDATE[\s\S]{0,200}SET[\s\S]{0,80}operating_company_key/i,
    "nothing backfills it either -- there is no data migration in this packet",
  );
});

test("the migration REFUSES occupied tables rather than rewriting them -- the guard is in the SQL", () => {
  const sql = executableSql(migrationSource);
  const preflight = sql.indexOf("RAISE EXCEPTION");
  const firstAdd = sql.indexOf("ADD COLUMN operating_company_key");
  assert.ok(preflight !== -1, "the migration raises rather than proceeding");
  assert.ok(preflight < firstAdd, "and it raises BEFORE the first column is added");
  for (const table of ["inventory_movements", "serialized_custody", "cycle_count_sheets"]) {
    assert.ok(
      new RegExp(`count\\(\\*\\)[^;]*FROM eos_ops\\.${table}`).test(sql),
      `the pre-flight counts ${table}`,
    );
  }
});

// ============================ no deployment-specific vocabulary, in any migration ============================

test("NO migration creates a Taylor/Ventana-specific enum or a second company master table", () => {
  const offences = [];
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"))) {
    const sql = executableSql(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    if (/taylor|ventana/i.test(sql)) offences.push(`${file}: names a specific operating company in executable SQL`);
    if (/CREATE TABLE\s+(?:\w+\.)?(?:operating_)?compan(?:y|ies)\b/i.test(sql)) {
      offences.push(`${file}: creates a company master table`);
    }
  }
  assert.deepEqual(offences, [], "the operating company is an OPAQUE governed key -- the authority layer owns the valid set");
});

test("the custody enum is created, and EQUIPMENT is never added to the physical one", () => {
  const sql = executableSql(migrationSource);
  assert.match(sql, /CREATE TYPE ops_custody_location_type AS ENUM \('WAREHOUSE', 'BIN', 'MOBILE', 'EQUIPMENT'\)/);
  assert.doesNotMatch(sql, /ALTER TYPE ops_location_type ADD VALUE/i, "the movement vocabulary is not widened");
  assert.doesNotMatch(sql, /'CUSTOMER'/, "CUSTOMER is not invented as a location type");

  // The conversion is by LABEL, which is what makes it deterministic and lossless.
  assert.match(sql, /USING location_type::text::ops_custody_location_type/);
});

test("the INSTALLED constraint is written as a BICONDITIONAL", () => {
  const sql = executableSql(migrationSource);
  assert.match(
    sql,
    /CONSTRAINT serialized_custody_installed_is_equipment CHECK \(\s*\(status = 'INSTALLED'\) = \(location_type = 'EQUIPMENT'\)\s*\)/,
  );
});

// ============================ the domain keeps the two vocabularies apart ============================

test("the physical movement vocabulary is the three places company stock can be", () => {
  assert.deepEqual([...OPS_LOCATION_TYPES], ["WAREHOUSE", "BIN", "MOBILE"]);
  assert.equal(isOpsLocationType("EQUIPMENT"), false, "an installed unit is not a movement location");
  assert.equal(isOpsLocationType("CUSTOMER"), false);
});

test("the custody vocabulary is that set plus EQUIPMENT, and nothing else", () => {
  assert.deepEqual([...OPS_CUSTODY_LOCATION_TYPES], ["WAREHOUSE", "BIN", "MOBILE", "EQUIPMENT"]);
  assert.equal(isOpsCustodyLocationType("EQUIPMENT"), true);
  assert.equal(isOpsCustodyLocationType("CUSTOMER"), false);
  // Every physical location is a valid custody location; the reverse is not true. That asymmetry IS
  // the distinction the two enums exist to preserve.
  for (const physical of OPS_LOCATION_TYPES) {
    assert.equal(isOpsCustodyLocationType(custodyLocationTypeOf(physical)), true);
  }
  assert.equal(OPS_LOCATION_TYPES.includes("EQUIPMENT"), false);
});

test("the repository re-exports the PHYSICAL type for the ledger and the CUSTODY type for custody", async () => {
  // The source, not the runtime: both are erased TYPES, so only the text can show that the ledger's
  // location stayed `OpsLocationType` while custody moved to `OpsCustodyLocationType`.
  const repo = readFileSync("src/eosOps/cycleCountRepository.ts", "utf8");
  assert.match(repo, /type OpsCustodyLocationType/, "the custody vocabulary is reachable from the repository module");
  assert.match(repo, /readonly type: OpsLocationType;/, "a cycle-count/ledger LocationRef is still PHYSICAL");
  assert.doesNotMatch(
    repo, /location_type\s*:\s*OpsCustodyLocationType[^;]*inventory_movements/,
    "nothing widens the ledger's own location column",
  );

  const domain = readFileSync("src/eosOps/operatingCompanyCustody.ts", "utf8");
  assert.match(domain, /readonly status: OpsSerialStatus;/);
  assert.match(domain, /readonly location: CustodyLocationRef;/, "a SerializedCustodyRecord locates in the CUSTODY vocabulary");
  assert.match(domain, /readonly operatingCompanyKey: OperatingCompanyKey;/, "and carries the company as a required field");
});

// ============================ the company key is required, never manufactured ============================

test("a missing, blank or non-string operating company is REFUSED, not substituted", () => {
  for (const bad of [undefined, null, "", "   ", 7, {}, []]) {
    assert.throws(
      () => requireOperatingCompanyKey(bad),
      OperatingCompanyAuthorityError,
      `${JSON.stringify(bad) ?? String(bad)} is refused`,
    );
  }
  assert.equal(requireOperatingCompanyKey("oc-alpha"), "oc-alpha");
});

test("the key is OPAQUE -- the domain validates shape, never membership", () => {
  // A union of this deployment's companies here would be a second place the valid set is declared,
  // and it would drift from the EOS authority layer that actually decides.
  const domain = readFileSync("src/eosOps/operatingCompanyCustody.ts", "utf8")
    .split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");
  assert.doesNotMatch(domain, /taylor|ventana/i, "no company is named in code");
  // And nothing derives it from the operational reference data the ruling forbids inferring from.
  for (const forbidden of [/homeWarehouseId/, /\bwarehouseId\b/, /\btruckId\b/, /\bemployeeId\b/]) {
    assert.doesNotMatch(domain, forbidden, `the company is never inferred via ${forbidden}`);
  }
});

test("createSheet takes the operating company as a REQUIRED positional argument", () => {
  const repo = readFileSync("src/eosOps/cycleCountRepository.ts", "utf8");
  assert.match(
    repo,
    /export async function createSheet\(\s*pool: Pool,\s*tenantId: string,\s*actorId: string,\s*operatingCompanyKey: OperatingCompanyKey,/,
    "not optional, and not defaulted",
  );
  assert.match(repo, /requireOperatingCompanyKey\(operatingCompanyKey\)/, "and refused at the boundary, not just by SQL");
  // The ledger row a reconcile stages inherits the company from the SHEET -- the governed parent --
  // rather than deriving one from the warehouse the sheet happens to name.
  assert.match(repo, /selectSheetAuthority\(client, tenantId, line\.sheetId\)/);
  assert.match(repo, /sheet\.operatingCompanyKey/);
});

// ============================ the INSTALLED rule, as the domain states it ============================

test("INSTALLED iff EQUIPMENT -- both directions, matching the serialized-asset contract", () => {
  assert.equal(isInstalledCustodyConsistent("INSTALLED", "EQUIPMENT"), true);
  for (const physical of OPS_LOCATION_TYPES) {
    assert.equal(isInstalledCustodyConsistent("INSTALLED", physical), false,
      `an installed unit is not in ${physical} custody`);
    assert.equal(isInstalledCustodyConsistent("AVAILABLE", physical), true);
  }
  for (const status of ["AVAILABLE", "RESERVED", "CONSUMED", "SCRAPPED"]) {
    assert.equal(isInstalledCustodyConsistent(status, "EQUIPMENT"), false,
      `${status} at customer Equipment is not representable`);
  }
});

test("the bidirectional rule is the one the serialized-asset domain already enforces", () => {
  // THE EVIDENCE, read from the product's own source rather than assumed. `validateSerializedAssetValue`
  // rejects an INSTALLED asset with no Equipment link AND any other state that carries one -- so
  // "linked to an Equipment record" and "INSTALLED" are the same fact, in both directions.
  const assetTypes = readFileSync("src/serializedAsset/types.ts", "utf8");
  assert.match(assetTypes, /reason: "installed_requires_link"/);
  assert.match(assetTypes, /reason: "link_requires_installed"/);

  // And the install command writes both halves in one transaction: INSTALLED plus the Equipment id.
  const install = readFileSync("src/equipmentInstall/installSerializedAssetCommand.ts", "utf8");
  assert.match(install, /inventoryState: INSTALLED_STATE,\s*\n\s*currentEquipmentId: equipmentId,/);
});

// ============================ registration ============================

test("the new POSTGRES suite is registered in the one serialized command", () => {
  // It resets the schema, so running it outside test:adminPolicyPostgres would race the other
  // resetters. adminPolicyPostgres.test.mjs proves this generically; this names the file.
  const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
  assert.match(scripts["test:adminPolicyPostgres"], /eosOpsOperatingCompanyCustodyPostgres\.test\.mjs/);
  assert.match(scripts["test:adminPolicy"], /eosOpsOperatingCompanyCustody\.test\.mjs/);
});
