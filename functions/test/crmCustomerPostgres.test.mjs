// Migration 008's STRUCTURAL proofs: the CRM customer namespace, against a real database.
//
// ════════════════════ THESE RUN AGAINST A REAL DATABASE ════════════════════
//
// Same contract as eosOpsPostgres.test.mjs and adminPolicyPostgres.test.mjs: set
// POLICY_TEST_DATABASE_URL to run; without it this SKIPS rather than fails.
//
// ════════════════════ THIS SUITE DOES NOT RESET THE SCHEMA ════════════════════
//
// Deliberately, and it is the reason this file is not one of the serialized resetters that
// functions/test/adminPolicyPostgres.test.mjs:692-703 requires to be registered in
// `test:adminPolicyPostgres`. It brings the database up to current with `migrate up` (a no-op when
// it already is), works only on its own two tenants, and deletes only its own rows. It therefore
// cannot drop a sibling suite's schema mid-transaction, which is the race that rule exists to stop.
//
// The claims proved here are STRUCTURAL on purpose. "Nobody will put a warehouse in the customer
// address book" is not a property; "the database has nowhere to put one" is.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import pg from "pg";
import {
  CrmLocationNamespaceError,
  CrmOwnershipError,
} from "../lib/crm/customerIdentity.js";
import {
  CrmRepositoryError,
  assignAccountOwner,
  createAccount,
  createAccountLocation,
  createContact,
  findAccountsByFoldedName,
  listAccountContacts,
  listAccountLocations,
  readAccountLocation,
} from "../lib/crm/customerRepository.js";

const URL = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const TENANT_A = "crm-tenant-a";
const TENANT_B = "crm-tenant-b";

let pool = null;
function repoPool() {
  pool ??= new pg.Pool({ connectionString: URL, max: 4 });
  return pool;
}

function migrate(args) {
  return execFileSync(process.execPath, [
    "node_modules/node-pg-migrate/bin/node-pg-migrate.js", ...args, "--migrations-dir", "migrations",
  ], { env: { ...process.env, DATABASE_URL: URL }, encoding: "utf8", stdio: "pipe" });
}

async function query(text, values = []) {
  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  try { return await client.query(text, values); } finally { await client.end(); }
}

/** Bring the database to current and clear ONLY this suite's tenants. Never a schema reset. */
async function fresh() {
  migrate(["up"]);
  for (const tenant of [TENANT_A, TENANT_B]) {
    await query("DELETE FROM eos_crm.account_locations WHERE tenant_id = $1", [tenant]);
    await query("DELETE FROM eos_crm.contacts WHERE tenant_id = $1", [tenant]);
    await query("DELETE FROM eos_crm.accounts WHERE tenant_id = $1", [tenant]);
    await query(
      "INSERT INTO eos_policy.tenants (id, key, name) VALUES ($1, $1, $1) ON CONFLICT DO NOTHING",
      [tenant],
    );
  }
}

test.after(async () => {
  if (!URL) return;
  for (const tenant of [TENANT_A, TENANT_B]) {
    await query("DELETE FROM eos_crm.account_locations WHERE tenant_id = $1", [tenant]);
    await query("DELETE FROM eos_crm.contacts WHERE tenant_id = $1", [tenant]);
    await query("DELETE FROM eos_crm.accounts WHERE tenant_id = $1", [tenant]);
  }
  if (pool) await pool.end();
});

const columns = (table) => query(
  `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
    WHERE table_schema = 'eos_crm' AND table_name = $1 ORDER BY column_name`,
  [table],
);

// ============================ the schema exists, and holds exactly what it claims ============================

test("eos_crm stands beside eos_policy and eos_ops, with exactly three tables", { skip: SKIP }, async () => {
  await fresh();
  const tables = await query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'eos_crm' ORDER BY 1",
  );
  assert.deepEqual(tables.rows.map((r) => r.table_name), ["account_locations", "accounts", "contacts"]);

  // AND eos_ops IS UNCHANGED. eosOpsPostgres.test.mjs asserts eos_ops holds "exactly four foundation
  // tables -- no balance table, no locations table". Migration 008 does not falsify that claim, and
  // that is exactly why the CRM address book was not put there. Re-asserted from this side so the
  // reason is recorded where the decision was made.
  const ops = await query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'eos_ops' ORDER BY 1",
  );
  // THE RULE, NOT A LIST. This named the four migration-005 tables and read as "eos_ops contains
  // exactly these", which stopped being true the moment any sibling lane added an operational table
  // -- eleven did. The claim this test is actually making is narrower and survives all of them: the
  // CRM address book lives in eos_crm, and NO table of that family was put in the operational schema.
  const opsNames = ops.rows.map((r) => r.table_name);
  for (const crmFamily of ["accounts", "contacts", "account_locations", "customer_sites", "sites"]) {
    assert.equal(opsNames.includes(crmFamily), false,
      `${crmFamily} belongs to eos_crm -- a copy in eos_ops is the second authority this split exists to prevent`);
  }
  for (const foundation of ["cycle_count_lines", "cycle_count_sheets", "inventory_movements", "serialized_custody"]) {
    assert.ok(opsNames.includes(foundation), `migration 005's ${foundation} is still there`);
  }
});

// ============================ the namespace separation, structurally ============================

test("the customer-site table has NO type discriminator -- the census found none, and there is nowhere to put one", { skip: SKIP }, async () => {
  await fresh();
  const names = (await columns("account_locations")).rows.map((r) => r.column_name);
  for (const forbidden of ["type", "location_type", "site_type", "category"]) {
    assert.equal(names.includes(forbidden), false, `account_locations has no ${forbidden} column`);
  }
  await assert.rejects(
    () => query(
      `INSERT INTO eos_crm.account_locations (id, tenant_id, account_id, name, type, created_by, updated_by)
       VALUES ('l1', $1, 'a1', 'Bay 3', 'WAREHOUSE', 'u', 'u')`,
      [TENANT_A],
    ),
    /column "type" of relation "account_locations" does not exist/,
    "an inventory type cannot be attached to a customer site even in raw SQL",
  );
});

test("NO column anywhere in eos_crm is named location_id", { skip: SKIP }, async () => {
  // The field NAME is what a future migration would union two namespaces on. A CRM site's key is
  // `id`; `location_id` stays in eos_ops, where it means a warehouse, a bin or a truck.
  await fresh();
  const named = await query(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'eos_crm' AND column_name IN ('location_id', 'locationid', 'warehouse_id', 'bin_id')`,
  );
  assert.deepEqual(named.rows, []);
});

test("there is NO foreign key in either direction between eos_crm and eos_ops", { skip: SKIP }, async () => {
  await fresh();
  const crossing = await query(
    `SELECT src.nspname AS from_schema, dst.nspname AS to_schema, c.conname
       FROM pg_constraint c
       JOIN pg_class      st ON st.oid = c.conrelid
       JOIN pg_namespace  src ON src.oid = st.relnamespace
       JOIN pg_class      dt ON dt.oid = c.confrelid
       JOIN pg_namespace  dst ON dst.oid = dt.relnamespace
      WHERE c.contype = 'f'
        AND ((src.nspname = 'eos_crm' AND dst.nspname = 'eos_ops')
          OR (src.nspname = 'eos_ops' AND dst.nspname = 'eos_crm'))`,
  );
  assert.deepEqual(crossing.rows, [],
    "the inventory location_id is opaque governed data; pointing it at a customer site would assert a stock position IS one");

  // The only edge eos_crm has outside itself is tenancy.
  const outbound = await query(
    `SELECT DISTINCT dst.nspname AS to_schema, dt.relname AS to_table
       FROM pg_constraint c
       JOIN pg_class     st ON st.oid = c.conrelid
       JOIN pg_namespace src ON src.oid = st.relnamespace
       JOIN pg_class     dt ON dt.oid = c.confrelid
       JOIN pg_namespace dst ON dst.oid = dt.relnamespace
      WHERE c.contype = 'f' AND src.nspname = 'eos_crm' AND dst.nspname <> 'eos_crm'
      ORDER BY 1, 2`,
  );
  assert.deepEqual(outbound.rows, [{ to_schema: "eos_policy", to_table: "tenants" }]);
});

test("the inventory location vocabulary gains no customer label", { skip: SKIP }, async () => {
  await fresh();
  const labels = await query(
    `SELECT e.enumlabel FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'eos_ops' AND t.typname = 'ops_location_type'
      ORDER BY e.enumsortorder`,
  );
  assert.deepEqual(labels.rows.map((r) => r.enumlabel), ["WAREHOUSE", "BIN", "MOBILE"],
    "no CUSTOMER, CUSTOMER_SITE or ACCOUNT label was added to the physical vocabulary");
});

test("account parentage is NOT NULL and TENANT-SCOPED -- an inventory location is unrepresentable", { skip: SKIP }, async () => {
  await fresh();
  const p = repoPool();
  await createAccount(p, TENANT_A, "u1", { id: "acc-a", name: "Acme", status: "ACTIVE" });
  await createAccount(p, TENANT_B, "u1", { id: "acc-b", name: "Other", status: "ACTIVE" });

  // 1. No parent at all -- which is what a warehouse, a bin or a truck would have.
  await assert.rejects(
    () => query(
      `INSERT INTO eos_crm.account_locations (id, tenant_id, name, created_by, updated_by)
       VALUES ('l1', $1, 'Main Warehouse', 'u', 'u')`,
      [TENANT_A],
    ),
    /account_id/,
    "a site with no Account is refused by the database, not merely discouraged",
  );

  // 2. A parent in another tenant -- a plain REFERENCES accounts(id) would have allowed this.
  await assert.rejects(
    () => query(
      `INSERT INTO eos_crm.account_locations (id, tenant_id, account_id, name, created_by, updated_by)
       VALUES ('l2', $1, 'acc-b', 'Plant 2', 'u', 'u')`,
      [TENANT_A],
    ),
    /account_locations_account_same_tenant/,
  );
  await assert.rejects(
    () => query(
      `INSERT INTO eos_crm.contacts (id, tenant_id, account_id, name, created_by, updated_by)
       VALUES ('c2', $1, 'acc-b', 'Dana', 'u', 'u')`,
      [TENANT_A],
    ),
    /contacts_account_same_tenant/,
  );
});

test("the repository refuses an inventory discriminator before it ever reaches SQL", { skip: SKIP }, async () => {
  await fresh();
  const p = repoPool();
  await createAccount(p, TENANT_A, "u1", { id: "acc-a", name: "Acme", status: "ACTIVE" });
  for (const key of ["type", "locationType"]) {
    await assert.rejects(
      () => createAccountLocation(p, TENANT_A, "u1", {
        id: `l-${key}`, accountId: "acc-a", name: "Bay 3", [key]: "WAREHOUSE",
      }),
      CrmLocationNamespaceError,
      `${key} is a refusal with a reason, not a column error`,
    );
  }
  const written = await query("SELECT count(*)::int n FROM eos_crm.account_locations WHERE tenant_id = $1", [TENANT_A]);
  assert.equal(written.rows[0].n, 0, "the refused calls wrote nothing");
});

test("a customer-site read returns null for an inventory id -- and that is not a redirect", { skip: SKIP }, async () => {
  await fresh();
  const p = repoPool();
  await createAccount(p, TENANT_A, "u1", { id: "acc-a", name: "Acme", status: "ACTIVE" });
  await createAccountLocation(p, TENANT_A, "u1", { id: "cw-acct-a-loc-1", accountId: "acc-a", name: "Plant 2" });

  assert.equal((await readAccountLocation(p, TENANT_A, "cw-acct-a-loc-1")).name, "Plant 2");
  // A warehouse id, a truck id and a bin id are all simply absent here. `null` means "not a customer
  // site", never "look in inventory next" -- the namespaces are disjoint, not complementary.
  for (const inventoryId of ["wh-main", "truck-7", "bin-A01"]) {
    assert.equal(await readAccountLocation(p, TENANT_A, inventoryId), null);
  }
  // And it is tenant-scoped: another tenant's site reads as absent, not as forbidden.
  assert.equal(await readAccountLocation(p, TENANT_B, "cw-acct-a-loc-1"), null);
});

// ============================ the operating-company axis is absent by ruling ============================

test("NO eos_crm table carries an operating company -- all three families are COMPANY_NEUTRAL", { skip: SKIP }, async () => {
  await fresh();
  const found = await query(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'eos_crm' AND column_name LIKE '%operating_company%'`,
  );
  assert.deepEqual(found.rows, [],
    "ownershipMatrix.ts:118-141 classifies account/contact/location as COMPANY_NEUTRAL with no companyScopeField");

  // And no deployment-specific company vocabulary reached this schema either.
  const enums = await query(
    `SELECT t.typname, e.enumlabel FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'eos_crm'
      ORDER BY t.typname, e.enumsortorder`,
  );
  assert.deepEqual(enums.rows.filter((r) => /taylor|ventana/i.test(`${r.typname} ${r.enumlabel}`)), []);
  // ORDERED BY enumsortorder -- the DECLARATION order, which for a lifecycle enum is the meaning.
  // This query carried no ORDER BY and passed on the lane branch purely on the order Postgres
  // happened to return rows in; with eleven migrations creating types ahead of it, that order
  // changed and the assertion failed while the schema was entirely correct. An unordered read
  // compared against an ordered literal is a flaky test, not a proof.
  assert.deepEqual(enums.rows.map((r) => r.enumlabel), ["PROSPECT", "ACTIVE", "INACTIVE", "ARCHIVED"]);
});

// ============================ ownership: PERSON, explicit, legitimately absent ============================

test("owner_employee_id is NULLABLE on all three tables, with no default", { skip: SKIP }, async () => {
  await fresh();
  const owners = await query(
    `SELECT table_name, data_type, is_nullable, column_default FROM information_schema.columns
      WHERE table_schema = 'eos_crm' AND column_name = 'owner_employee_id' ORDER BY table_name`,
  );
  assert.deepEqual(owners.rows.map((r) => r.table_name), ["account_locations", "accounts", "contacts"]);
  for (const row of owners.rows) {
    assert.equal(row.data_type, "text");
    assert.equal(row.is_nullable, "YES", `${row.table_name}: OWNERLESS is a legal state, not a NOT NULL violation`);
    assert.equal(row.column_default, null, "and nothing defaults an owner into existence");
  }
  // ONE column, not a (type, id) pair: the owner type is fixed by classification (PERSON/USER).
  const ownerType = await query(
    `SELECT count(*)::int n FROM information_schema.columns
      WHERE table_schema = 'eos_crm' AND column_name IN ('owner_type', 'owner_class')`,
  );
  assert.equal(ownerType.rows[0].n, 0);
});

test("an OWNERLESS Account is written as ownerless, and its children inherit that", { skip: SKIP }, async () => {
  await fresh();
  const p = repoPool();
  const acc = await createAccount(p, TENANT_A, "u1", { id: "acc-a", name: "Acme", status: "PROSPECT" });
  assert.equal(acc.ownerEmployeeId, null, "no owner was manufactured from the actor that wrote it");

  const contact = await createContact(p, TENANT_A, "u1", { id: "c1", accountId: "acc-a", name: "Dana" });
  const site = await createAccountLocation(p, TENANT_A, "u1", { id: "l1", accountId: "acc-a", name: "Plant 2" });
  assert.equal(contact.ownerEmployeeId, null, "an ownerless parent propagates as unresolved, never a substitute");
  assert.equal(site.ownerEmployeeId, null);

  // Assigning the Account later does NOT retroactively re-own the children: inheritance is at
  // creation, and `transfer: "HANDOFF"` means each record's owner is its own fact afterwards.
  await assignAccountOwner(p, TENANT_A, "u2", "acc-a", "emp-1");
  assert.equal((await listAccountContacts(p, TENANT_A, "acc-a"))[0].ownerEmployeeId, null);
  assert.equal((await listAccountLocations(p, TENANT_A, "acc-a"))[0].ownerEmployeeId, null);
});

test("children created after an owner exists inherit it, in one transaction", { skip: SKIP }, async () => {
  await fresh();
  const p = repoPool();
  await createAccount(p, TENANT_A, "u1", { id: "acc-a", name: "Acme", status: "ACTIVE", ownerEmployeeId: "emp-7" });
  const contact = await createContact(p, TENANT_A, "u1", { id: "c1", accountId: "acc-a", name: "Dana", isPrimary: true });
  const site = await createAccountLocation(p, TENANT_A, "u1", {
    id: "l1", accountId: "acc-a", name: "Plant 2",
    addressStreet: "1 Main", addressCity: "Reno", addressState: "NV", addressPostalCode: "89501",
  });
  assert.equal(contact.ownerEmployeeId, "emp-7");
  assert.equal(site.ownerEmployeeId, "emp-7");
  assert.equal(contact.isPrimary, true);
  assert.equal(site.addressCity, "Reno");
});

test("ruling D-6 holds at the repository: an owner is stated or absent, never inferred", { skip: SKIP }, async () => {
  await fresh();
  const p = repoPool();
  for (const bad of ["", "   "]) {
    await assert.rejects(
      () => createAccount(p, TENANT_A, "u1", { id: "acc-bad", name: "Acme", status: "ACTIVE", ownerEmployeeId: bad }),
      CrmOwnershipError,
      `${JSON.stringify(bad)} is refused rather than treated as OWNERLESS`,
    );
  }
  const written = await query("SELECT count(*)::int n FROM eos_crm.accounts WHERE tenant_id = $1", [TENANT_A]);
  assert.equal(written.rows[0].n, 0);
});

test("a child of a missing or cross-tenant Account is refused, and nothing partial is left behind", { skip: SKIP }, async () => {
  await fresh();
  const p = repoPool();
  await createAccount(p, TENANT_B, "u1", { id: "acc-b", name: "Other", status: "ACTIVE" });

  await assert.rejects(
    () => createContact(p, TENANT_A, "u1", { id: "c1", accountId: "acc-missing", name: "Dana" }),
    CrmRepositoryError,
  );
  await assert.rejects(
    () => createAccountLocation(p, TENANT_A, "u1", { id: "l1", accountId: "acc-b", name: "Plant" }),
    CrmRepositoryError,
    "another tenant's Account reads as absent, not as forbidden",
  );
  const rows = await query(
    "SELECT count(*)::int n FROM eos_crm.contacts WHERE tenant_id = $1", [TENANT_A],
  );
  assert.equal(rows.rows[0].n, 0, "the rolled-back transaction wrote nothing");
});

// ============================ identity: the id is the source id ============================

test("an IMP- import-derived Account id is stored verbatim", { skip: SKIP }, async () => {
  await fresh();
  const p = repoPool();
  const id = "IMP-ACCEPTANCE-ICE-CO-NQX1QO-1OSKNMX";
  const acc = await createAccount(p, TENANT_A, "u1", { id, name: "Acceptance Ice Co", status: "ACTIVE" });
  assert.equal(acc.id, id, "not re-minted, not normalized, not prefixed again");
  const stored = await query("SELECT id FROM eos_crm.accounts WHERE tenant_id = $1", [TENANT_A]);
  assert.deepEqual(stored.rows.map((r) => r.id), [id]);
});

test("two Accounts may share a folded name -- the doc id is the only hard-unique key", { skip: SKIP }, async () => {
  await fresh();
  const p = repoPool();
  await createAccount(p, TENANT_A, "u1", { id: "acc-1", name: "Acceptance Ice Co", status: "ACTIVE" });
  await createAccount(p, TENANT_A, "u1", { id: "acc-2", name: "  acceptance ice co ", status: "PROSPECT" });

  // D-C1-4: duplicate prevention is ADVISORY at create. The lookup finds both and refuses neither.
  const matches = await findAccountsByFoldedName(p, TENANT_A, "ACCEPTANCE ICE CO");
  assert.deepEqual(matches.map((a) => a.id), ["acc-1", "acc-2"]);

  // And the same id twice IS refused -- that is the key the ruling does make hard.
  await assert.rejects(
    () => createAccount(p, TENANT_A, "u1", { id: "acc-1", name: "Somebody Else", status: "ACTIVE" }),
    (err) => err instanceof CrmRepositoryError && err.code === "DUPLICATE_ID",
  );
});

test("a whitespace-only name is refused by the database, not only by the repository", { skip: SKIP }, async () => {
  await fresh();
  for (const [table, extra] of [["accounts", ", status"], ["contacts", ""], ["account_locations", ""]]) {
    const constraint = table === "account_locations" ? "account_locations_name_present" : `${table}_name_present`;
    const check = await query(
      `SELECT count(*)::int n FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'eos_crm' AND t.relname = $1 AND c.conname = $2`,
      [table, constraint],
    );
    assert.equal(check.rows[0].n, 1, `${table} refuses a blank name${extra ? "" : ""}`);
  }
  await assert.rejects(
    () => query(
      `INSERT INTO eos_crm.accounts (id, tenant_id, name, status, created_by, updated_by)
       VALUES ('blank', $1, '   ', 'ACTIVE', 'u', 'u')`,
      [TENANT_A],
    ),
    /accounts_name_present/,
  );
});

test("the composite keys a future Equipment table needs are present", { skip: SKIP }, async () => {
  await fresh();
  const uniques = await query(
    `SELECT t.relname AS table_name, c.conname
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'eos_crm' AND c.contype = 'u'
      ORDER BY 1, 2`,
  );
  assert.deepEqual(uniques.rows, [
    { table_name: "account_locations", conname: "account_locations_account_scoped_identity" },
    { table_name: "accounts", conname: "accounts_tenant_scoped_identity" },
  ]);
});

test("the folded-name index exists and is NOT unique", { skip: SKIP }, async () => {
  await fresh();
  const index = await query(
    "SELECT indexdef FROM pg_indexes WHERE schemaname = 'eos_crm' AND indexname = 'accounts_by_folded_name'",
  );
  assert.equal(index.rowCount, 1);
  assert.doesNotMatch(index.rows[0].indexdef, /UNIQUE/, "an advisory lookup, never a constraint");
  assert.match(index.rows[0].indexdef, /lower\(btrim\(name\)\)/);
});
