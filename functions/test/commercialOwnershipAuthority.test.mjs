// EOS Commercial Data Plane — migration 008's OFFLINE proofs: the ownership authority, the
// reconciliation, and the migration source itself.
//
// The structural half of these claims (NOT NULL, the CHECKs, the append-only trigger, the down
// migration's refusal) is proved against a real postgres:16 in commercialOwnershipPostgres.test.mjs.
// What is proved HERE is what needs no database to be wrong: that the six ownership rulings survive
// the move to PostgreSQL, that the SQL text contains no second copy of an authority that already
// exists, and that the reconciliation agrees with the census derivation by construction.
//
// No Firestore, no emulator, no database. Every input below is a literal.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  COMMERCIAL_HANDOFF_SOURCES,
  COMMERCIAL_RECORD_KINDS,
  COMPANY_REQUIRED_KINDS,
  CommercialOwnershipError,
  buildCommercialHandoff,
  buildCommercialOwnershipRow,
  reconcileCommercialDocument,
  reconcileCommercialFamily,
} from "../lib/eosCommercial/commercialOwnershipAuthority.js";
import { OWNERSHIP_HANDOFF_SOURCES } from "../lib/access/auditEventWriter.js";
import { OWNERSHIP_MATRIX } from "../lib/ownership/ownershipMatrix.js";
import { deriveEmployeeRefOwner, OWNERSHIP_RESOLUTION } from "../lib/ownership/typedOwner.js";

const MIGRATIONS_DIR = "migrations";
const MIGRATION_FILE = "1758844800000_commercial-ownership-authority.sql";
const migrationSource = readFileSync(join(MIGRATIONS_DIR, MIGRATION_FILE), "utf8");

/** SQL with comment lines removed -- a header that DISCUSSES a forbidden shape is not that shape. */
function executableSql(source) {
  return source.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
}

const OPPORTUNITY = {
  kind: "OPPORTUNITY",
  recordNumber: "OPP-2026-000001",
  accountId: "acct-1",
  ownerEmployeeId: "emp-rudy",
  createdBy: "emp-assistant",
};

// ============================ the migration is additive and correctly ordered ============================

test("008 is the newest migration and edits none of its predecessors", () => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  // ORDER, NOT POSITION. This asserted that 008 "sorts last". Eleven additive migrations landed
  // together at the W1 integration and only one of them can be last, so every lane that wrote this
  // sentence about its own migration was asserting something that stops being true the moment a
  // sibling lands. The claim that actually matters is ADDITIVE ORDER: this migration is present, and
  // it applies after 007 -- the last migration that existed when it was written -- so it never
  // renumbers or reorders a predecessor. A twelfth migration is then simply a twelfth migration.
  assert.ok(files.includes(MIGRATION_FILE), "the migration is on disk under its own id");
  assert.ok(MIGRATION_FILE > "1757980800000_operating-company-and-serialized-custody.sql",
    "it applies after 007 -- additive, never renumbered in front of a predecessor");
  assert.equal(files[6], "1757980800000_operating-company-and-serialized-custody.sql", "007 is still seventh");

  // node-pg-migrate's own format, the same two sections every predecessor uses.
  assert.match(migrationSource, /^-- Up Migration/);
  assert.match(migrationSource, /\n-- Down Migration\n/);
});

test("it creates a THIRD sibling schema and touches neither eos_policy nor eos_ops", () => {
  const sql = executableSql(migrationSource);
  assert.match(sql, /CREATE SCHEMA IF NOT EXISTS eos_commercial;/);
  assert.match(sql, /SET search_path = eos_commercial, public;/);

  // The ONLY permitted mention of a sibling schema is the tenants foreign key -- a reference, not a
  // modification. Any ALTER/DROP/CREATE against eos_policy or eos_ops here would make this migration
  // a second authority over someone else's tables.
  const foreign = [...sql.matchAll(/eos_(policy|ops)\.\w+/g)].map((m) => m[0]);
  assert.deepEqual([...new Set(foreign)], ["eos_policy.tenants"], "only the tenants FK reaches out");
  assert.equal(/(ALTER|DROP|CREATE)\s+(TABLE|TYPE|INDEX|SCHEMA)\s+eos_(policy|ops)/i.test(sql), false);
});

// ============================ ruling 1: every record has an owner ============================

test("every commercial table declares owner_employee_id NOT NULL with no default", () => {
  const sql = executableSql(migrationSource);
  // Anchored at the start of the line so `previous_owner_employee_id` and `new_owner_employee_id`
  // on the handoff table are not mistaken for a record's own owner column.
  const declarations = [...sql.matchAll(/^\s+owner_employee_id\s+(TEXT[^,\n]*)/gm)].map((m) => m[1].trim());
  assert.equal(declarations.length, 3, "one per commercial table");
  for (const declaration of declarations) {
    assert.match(declaration, /NOT NULL/, "an ownerless commercial row is unrepresentable");
    assert.equal(/DEFAULT/i.test(declaration), false, "a defaulted owner is a manufactured owner");
  }
});

test("the builder refuses a record with no owner rather than choosing one", () => {
  for (const ownerEmployeeId of [undefined, null, "", "   "]) {
    assert.throws(
      () => buildCommercialOwnershipRow({ ...OPPORTUNITY, ownerEmployeeId }),
      (err) => err instanceof CommercialOwnershipError && err.code === "OWNER_REQUIRED",
      `ownerEmployeeId ${JSON.stringify(ownerEmployeeId)} must refuse, not default`,
    );
  }
});

// ============================ rulings 2 and 3: the customer default, and the assistant ============================

test("the account is required, because it is the upstream a missing owner is inherited FROM", () => {
  assert.throws(
    () => buildCommercialOwnershipRow({ ...OPPORTUNITY, accountId: "" }),
    (err) => err.code === "ACCOUNT_REQUIRED",
  );
});

test("an assistant-created opportunity keeps the primary owner: owner and creator are separate columns", () => {
  // The canonical case from creationOwnerResolution.ts:18-20 -- Customer owner = Rudy, an assistant
  // performs the call. The row records BOTH facts and conflates neither.
  const row = buildCommercialOwnershipRow(OPPORTUNITY);
  assert.equal(row.ownerEmployeeId, "emp-rudy", "the owner is the primary owner, not the caller");
  assert.equal(row.createdBy, "emp-assistant", "and who did it is recorded, separately");

  // Structurally, in the schema: two columns, and owner_employee_id is never assigned from created_by.
  const sql = executableSql(migrationSource);
  assert.match(sql, /created_by\s+TEXT\s+NOT NULL/);
  assert.equal(/owner_employee_id[^,]*DEFAULT[^,]*created_by/i.test(sql), false);
});

test("the builder never invents an owner from the creator, even when it is the only id present", () => {
  // If the builder had ANY fallback, this is the call that would take it: a creator is supplied and
  // an owner is not. It refuses instead -- the whole of ruling D-4's refusal, restated where the
  // row is made.
  assert.throws(
    () => buildCommercialOwnershipRow({ ...OPPORTUNITY, ownerEmployeeId: undefined }),
    (err) => err.code === "OWNER_REQUIRED",
  );
});

// ============================ ruling 4: negotiated transfer is allowed ============================

test("a handoff is accepted for all three families, and its vocabulary is the audit writer's", () => {
  assert.deepEqual(
    [...COMMERCIAL_HANDOFF_SOURCES],
    [...OWNERSHIP_HANDOFF_SOURCES],
    "a source this table accepts must be one the audit event would accept",
  );
  for (const kind of COMMERCIAL_RECORD_KINDS) {
    const handoff = buildCommercialHandoff({
      kind,
      recordId: "rec-1",
      previousOwnerEmployeeId: "emp-rudy",
      newOwnerEmployeeId: "emp-lee",
      source: "DIRECT_HANDOFF",
      reason: "negotiated at the quarterly book review",
    });
    assert.equal(handoff.previousOwnerEmployeeId, "emp-rudy");
    assert.equal(handoff.newOwnerEmployeeId, "emp-lee");
  }
});

test("all three families are transfer=HANDOFF in the matrix -- the allow-list is not this file's list", () => {
  for (const family of ["opportunity", "salesAgreement", "salesOrder"]) {
    const row = OWNERSHIP_MATRIX.find((f) => f.family === family);
    assert.ok(row, `${family} is in the matrix`);
    assert.equal(row.ownerClass, "PERSON");
    assert.equal(row.transfer, "HANDOFF");
  }
});

test("salesTerritory is EXCLUDED from ownership, which is why eos_commercial gives it no table", () => {
  const territory = OWNERSHIP_MATRIX.find((f) => f.family === "salesTerritory");
  assert.ok(territory, "it IS in the matrix -- a built object, deliberately classified");
  assert.equal(territory.ownerClass, "EXCLUDED");
  assert.equal(territory.collection, "sales_territories");
  assert.equal(COMMERCIAL_RECORD_KINDS.includes("SALES_TERRITORY"), false);
  assert.equal(/CREATE TABLE sales_territories/.test(executableSql(migrationSource)), false);
});

test("a no-op is refused: a handoff that moves nothing is not a negotiation", () => {
  assert.throws(
    () => buildCommercialHandoff({
      kind: "SALES_ORDER", recordId: "rec-1",
      previousOwnerEmployeeId: "emp-rudy", newOwnerEmployeeId: "emp-rudy",
      source: "DIRECT_HANDOFF",
    }),
    (err) => err.code === "HANDOFF_NO_OP",
  );
});

test("an empty previous owner is refused -- null MEANS ownerless and is not spelled two ways", () => {
  assert.throws(
    () => buildCommercialHandoff({
      kind: "SALES_ORDER", recordId: "rec-1",
      previousOwnerEmployeeId: "", newOwnerEmployeeId: "emp-lee",
      source: "DIRECT_HANDOFF",
    }),
    (err) => err.code === "PREVIOUS_OWNER_INVALID",
  );
  const backfill = buildCommercialHandoff({
    kind: "SALES_ORDER", recordId: "rec-1",
    previousOwnerEmployeeId: null, newOwnerEmployeeId: "emp-lee",
    source: "ADMIN_CORRECTION",
  });
  assert.equal(backfill.previousOwnerEmployeeId, null, "the genuinely-ownerless case is representable");
});

// ============================ ruling 5: historical ownership remains ============================

test("the handoff history is append-only in the STORE, not merely in the repository", () => {
  const sql = executableSql(migrationSource);
  assert.match(sql, /CREATE TRIGGER ownership_handoffs_are_append_only/);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON ownership_handoffs/);
  assert.match(sql, /RAISE EXCEPTION[\s\S]*append-only/);
});

test("no repository function updates or deletes a recorded handoff", () => {
  const repository = readFileSync("src/eosCommercial/commercialOwnershipRepository.ts", "utf8");
  const statements = repository
    .split("\n")
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
    .join("\n");
  assert.equal(/UPDATE\s+\$\{SCHEMA\}\.ownership_handoffs/.test(statements), false);
  assert.equal(/DELETE\s+FROM\s+\$\{SCHEMA\}\.ownership_handoffs/.test(statements), false);
});

test("reversing the migration refuses while any ownership history exists", () => {
  const down = migrationSource.split("\n-- Down Migration\n")[1];
  assert.ok(down, "there is a down half");
  assert.match(down, /cannot be reversed/);
  assert.match(down, /ownership_handoffs/);
  assert.match(down, /Historical ownership remains/);
});

// ============================ ruling 6: future sales follow the new owner ============================

test("there is no cascade: a handoff names exactly one record", () => {
  const sql = executableSql(migrationSource);
  assert.match(sql, /CONSTRAINT ownership_handoff_names_exactly_one_record CHECK/);
  // Three nullable record columns summing to exactly one. A list column or a "children" flag would
  // be the cascade ruling D-1 forbids, and neither exists.
  assert.match(sql, /\(opportunity_id\s+IS NOT NULL\)::int/);
  assert.equal(/record_ids\s+TEXT\[\]/.test(sql), false, "no list column");
  // The UP half only. The down half tears the schema down with a CASCADE, which is teardown, not an
  // ownership cascade -- and scanning the whole file would confuse the two.
  const up = executableSql(migrationSource.split("\n-- Down Migration\n")[0]);
  assert.equal(/cascade/i.test(up), false, "nothing in the created schema cascades an ownership change");
});

test("a record's CURRENT owner is a single mutable column -- that is what tomorrow inherits", () => {
  // Ruling 6 needs no new mechanism, only this: the owner column is the thing
  // creationOwnerResolution inherits from, so once it moves, records created afterwards inherit the
  // new owner while the handoff rows keep saying who held it before.
  const sql = executableSql(migrationSource);
  for (const table of ["opportunities", "sales_agreements", "sales_orders"]) {
    const body = sql.split(`CREATE TABLE ${table} (`)[1].split("\n);")[0];
    assert.equal((body.match(/owner_employee_id/g) ?? []).length, 1, `${table} states its owner once`);
  }
});

// ============================ the operating company axis (ruling R-8) ============================

test("the store requires a company exactly where the command requires one, and nowhere else", () => {
  assert.deepEqual([...COMPANY_REQUIRED_KINDS], ["SALES_ORDER"]);

  // An Opportunity may be company-unresolved -- opportunityCommands.ts:175 returns null by design.
  const opportunity = buildCommercialOwnershipRow(OPPORTUNITY);
  assert.equal(opportunity.operatingCompanyKey, null);

  // A Sales Order may not.
  assert.throws(
    () => buildCommercialOwnershipRow({
      kind: "SALES_ORDER", recordNumber: "SO-2026-000001", accountId: "acct-1",
      ownerEmployeeId: "emp-rudy", createdBy: "emp-rudy",
    }),
    (err) => err.code === "COMPANY_REQUIRED",
  );
});

test("the operating company is never inferred, and an ungoverned id is refused", () => {
  assert.throws(
    () => buildCommercialOwnershipRow({ ...OPPORTUNITY, operatingCompanyId: "acme" }),
    (err) => err.code === "COMPANY_UNGOVERNED",
  );
  const taylor = buildCommercialOwnershipRow({ ...OPPORTUNITY, operatingCompanyId: "taylor" });
  assert.equal(taylor.operatingCompanyKey, "taylor");
});

test("the schema names no operating company -- only the authority module does", () => {
  const sql = executableSql(migrationSource);
  for (const company of ["taylor", "ventana", "Taylor", "Ventana"]) {
    assert.equal(sql.includes(company), false, `${company} must not appear in executable SQL`);
  }
});

// ============================ lineage ============================

test("an Opportunity is the head of the chain and is refused a commercial upstream", () => {
  assert.throws(
    () => buildCommercialOwnershipRow({ ...OPPORTUNITY, opportunityId: "opp-other" }),
    (err) => err.code === "LINEAGE_INVALID",
  );
});

test("the downstream lineage columns are real foreign keys, and nullable", () => {
  const sql = executableSql(migrationSource);
  assert.match(sql, /opportunity_id\s+TEXT REFERENCES opportunities\(id\)/);
  assert.match(sql, /sales_agreement_id\s+TEXT REFERENCES sales_agreements\(id\)/);
  // Nullable because all three creation paths the governed commands allow are real.
  assert.equal(/opportunity_id\s+TEXT NOT NULL REFERENCES/.test(sql), false);
});

test("account_id is NOT a foreign key -- Account is a different authority, not copied here", () => {
  const sql = executableSql(migrationSource);
  assert.match(sql, /account_id\s+TEXT NOT NULL,/);
  assert.equal(/account_id[^,]*REFERENCES/.test(sql), false);
  assert.equal(/CREATE TABLE accounts/.test(sql), false, "no unmaintained copy of the Account master");
});

// ============================ reconciliation ============================

test("reconciliation agrees with the census derivation, document for document", () => {
  const docs = [
    { id: "o1", data: { ownerEmployeeId: "emp-rudy", accountId: "acct-1" } },
    { id: "o2", data: { accountId: "acct-1" } },
    { id: "o3", data: { ownerEmployeeId: "   ", accountId: "acct-1" } },
    { id: "o4", data: { ownerEmployeeId: "emp-lee", accountId: "acct-2", operatingCompanyId: "ventana" } },
  ];
  for (const doc of docs) {
    const verdict = reconcileCommercialDocument("OPPORTUNITY", doc).verdict;
    const censusResolved =
      deriveEmployeeRefOwner(doc.data).resolution === OWNERSHIP_RESOLUTION.RESOLVED;
    // The equivalence IS the reconciliation proof: a document the census calls resolved is never one
    // this calls ownerless, and vice versa.
    assert.equal(verdict === "OWNERLESS", !censusResolved, `${doc.id} must not disagree with the census`);
  }
});

test("a family report counts every document into exactly one verdict, and samples the blocked", () => {
  const docs = [
    { id: "s1", data: { ownerEmployeeId: "emp-rudy", accountId: "a", operatingCompanyId: "taylor" } },
    { id: "s2", data: { ownerEmployeeId: "emp-rudy", accountId: "a" } },
    { id: "s3", data: { ownerEmployeeId: "emp-rudy", accountId: "a", operatingCompanyId: "acme" } },
    { id: "s4", data: { accountId: "a", operatingCompanyId: "taylor" } },
    { id: "s5", data: { ownerEmployeeId: "emp-rudy", operatingCompanyId: "taylor" } },
  ];
  const report = reconcileCommercialFamily("SALES_ORDER", docs);
  assert.equal(report.table, "sales_orders");
  assert.equal(report.scanned, 5);
  assert.equal(report.ready, 1);
  assert.equal(report.blocked, 4);
  assert.deepEqual(report.verdicts, {
    READY: 1, COMPANY_MISSING: 1, COMPANY_UNGOVERNED: 1, OWNERLESS: 1, ACCOUNT_MISSING: 1,
  });
  assert.equal(
    Object.values(report.verdicts).reduce((a, b) => a + b, 0), report.scanned,
    "no document is double-counted and none is dropped",
  );
  assert.equal(report.blockedSamples.length, 4);
  for (const sample of report.blockedSamples) {
    assert.ok(sample.reason, "a blocked document says WHY");
  }
});

test("an empty family reconciles to zero rather than throwing", () => {
  const report = reconcileCommercialFamily("SALES_AGREEMENT", []);
  assert.equal(report.scanned, 0);
  assert.equal(report.ready, 0);
  assert.deepEqual(report.verdicts, {});
});

// ============================ no second authority ============================

test("the authority module imports no Firebase and no Firestore collection name", () => {
  const source = readFileSync("src/eosCommercial/commercialOwnershipAuthority.ts", "utf8");
  assert.equal(/from "firebase/.test(source), false);
  assert.equal(/constants\/collections/.test(source), false, "the Firestore names are not restated here");
  const repository = readFileSync("src/eosCommercial/commercialOwnershipRepository.ts", "utf8");
  assert.equal(/from "firebase/.test(repository), false);
});

test("the operating-company vocabulary is called, not mirrored", () => {
  const source = readFileSync("src/eosCommercial/commercialOwnershipAuthority.ts", "utf8");
  assert.match(source, /resolveOperatingCompany/, "it calls the authority");
  const executable = source
    .split("\n")
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
    .join("\n");
  assert.equal(/"taylor"|"ventana"/.test(executable), false, "and holds no copy of its values");
});
