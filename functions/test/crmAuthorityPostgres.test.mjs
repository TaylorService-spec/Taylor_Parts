// WAVE D1-A against a real postgres:16 -- the governed PostgreSQL CRM authority layer (Account, Contact, customer site).
//
// Its OWN database, migrated by the normal runner, dropped in ONE t.after that ends the pool first. Every record below is
// written by the real governed operations and read back through them. Nothing here asserts which migration is latest.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const accounts = require("../lib/eosCrm/accountAuthority.js");
const contacts = require("../lib/eosCrm/contactAuthority.js");
const sites = require("../lib/eosCrm/accountLocationAuthority.js");
const { capabilitiesForRoleKeys } = require("../lib/eosOps/capabilityAuthority.js");

const DB_NAME = `d1a_crm_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const dbUrl = () => {
  const u = new URL(URL_BASE);
  u.pathname = `/${DB_NAME}`;
  return u.toString();
};
async function withClient(url, fn) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

const ALL = new Set(["customer.record.read", "customer.record.create", "customer.record.update"]);
const A1 = Object.freeze({ tenantId: "t1", principalId: "p-t1", capabilities: ALL });
const A2 = Object.freeze({ tenantId: "t2", principalId: "p-t2", capabilities: ALL });
const K = () => `key-${randomUUID()}`;
const code = (c) => (e) => {
  assert.equal(e.name, "CrmAuthorityError", `not a governed error: ${e}`);
  assert.equal(e.code, c, `expected ${c}, got ${e.code}: ${e.message}`);
  return true;
};

test("governed PostgreSQL CRM authority, in PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${DB_NAME}`));
  // Migrated THROUGH 025 only (timestamp mode, the C4 pin technique): test (18) proves 025's own rollback guard, which
  // `down 1` can reach only while 025 is the last-run migration. Later migrations are not what this suite proves.
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "1759708800000", "--timestamp", "--migrations-dir", "migrations"], {
    cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrl() }, stdio: "pipe",
  });
  const pool = new pg.Pool({ connectionString: dbUrl(), max: 6 });
  t.after(async () => {
    await pool.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`));
  });
  const q = (text, values = []) => pool.query(text, values);

  // Every statement issued, captured -- to prove reads are bounded and read-only.
  const statements = [];
  const spyPool = {
    connect: async () => {
      const client = await pool.connect();
      return { query: (text, values) => { statements.push(String(text)); return client.query(text, values); }, release: () => client.release() };
    },
  };
  const deps = { pool: spyPool };
  const count = async (table, where = "TRUE", values = []) => Number((await q(`SELECT count(*)::int n FROM eos_crm.${table} WHERE ${where}`, values)).rows[0].n);

  // ── the world ──
  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1'), ('t2','t2','T2')`);
  for (const [p, tenant, status] of [["p-t1", "t1", "active"], ["p-t2", "t2", "active"], ["p-disabled", "t1", "disabled"]]) {
    await q(`INSERT INTO eos_policy.principals (id, external_subject, identity_provider, status) VALUES ($1,$1,'proof',$2)`, [p, status]);
    await q(`INSERT INTO eos_policy.tenant_memberships (id, tenant_id, principal_id) VALUES ($1,$2,$3)`, [`m-${p}`, tenant, p]);
  }
  await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id) VALUES
    ('e-t1','t1','ACTIVE','taylor'), ('e-t2','t2','ACTIVE','taylor')`);

  const acct1 = await accounts.createAccount(deps, A1, { idempotencyKey: K(), name: "  Mesquite Soda Works ", status: "ACTIVE", ownerEmployeeId: "e-t1" });
  // A LEGACY ownerless row, exactly as an import or migration may carry one (OWNERLESS is a legitimate stored state). The
  // governed authority can no longer CREATE one; it must still read it and inherit from it truthfully.
  await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, created_by, updated_by) VALUES ('acct-legacy-ownerless','t1','Ownerless Diner','PROSPECT','import','import')`);
  const ownerless = { accountId: "acct-legacy-ownerless" };
  const acct2 = await accounts.createAccount(deps, A2, { idempotencyKey: K(), name: "Mesquite Soda Works", status: "ACTIVE", ownerEmployeeId: "e-t2" });

  await t.test("(1) Account create: canonical id, trimmed name, EOS Principal attribution, explicit owner, server timestamps", async () => {
    assert.match(acct1.accountId, /^acct_[0-9a-f-]{36}$/);
    assert.equal(acct1.name, "Mesquite Soda Works");
    assert.equal(acct1.createdBy, "p-t1");
    assert.equal(acct1.updatedBy, "p-t1");
    assert.equal(acct1.ownerEmployeeId, "e-t1");
    const row = (await q(`SELECT tenant_id, created_by, created_at, now() - created_at AS age FROM eos_crm.accounts WHERE id = $1`, [acct1.accountId])).rows[0];
    assert.equal(row.tenant_id, "t1");
    assert.equal(row.created_by, "p-t1", "attribution is the EOS Principal id");
    assert.equal(new Date(acct1.createdAt).toISOString(), row.created_at.toISOString(), "the timestamp is the server's");
    // OWNER REFUSAL MATRIX. Missing, malformed, unresolved, cross-tenant -- and never the Principal standing in for one.
    const refused = [
      [{}, "OWNER_REQUIRED"], [{ ownerEmployeeId: null }, "OWNER_REQUIRED"], [{ ownerEmployeeId: "" }, "OWNER_INVALID"],
      [{ ownerEmployeeId: "e t1" }, "OWNER_INVALID"], [{ ownerEmployeeId: 7 }, "OWNER_INVALID"],
      [{ ownerEmployeeId: "e-nobody" }, "OWNER_NOT_FOUND"], [{ ownerEmployeeId: "e-t2" }, "OWNER_NOT_FOUND"],
      [{ ownerEmployeeId: "p-t1" }, "OWNER_NOT_FOUND"],
    ];
    for (const [owner, expected] of refused) {
      await assert.rejects(accounts.createAccount(deps, A1, { idempotencyKey: K(), name: "X", status: "ACTIVE", ...owner }), code(expected), JSON.stringify(owner));
    }
    assert.equal(await count("accounts", "name = 'X'"), 0);
    assert.equal(await count("command_receipts", "target_type = 'ACCOUNT' AND result->>'name' = 'X'"), 0);
    // No Account the authority created is ownerless, and none is owned by its creator.
    assert.equal(await count("accounts", "created_by <> 'import' AND (owner_employee_id IS NULL OR owner_employee_id = created_by)"), 0);
  });

  await t.test("(2) TENANCY: tenant B cannot read, list or mutate tenant A's Account", async () => {
    await assert.rejects(accounts.getAccount(deps, A2, { accountId: acct1.accountId }), code("ACCOUNT_NOT_FOUND"));
    await assert.rejects(accounts.updateAccount(deps, A2, { accountId: acct1.accountId, name: "Hijacked", status: "ARCHIVED" }), code("ACCOUNT_NOT_FOUND"));
    const row = (await q(`SELECT name, status, updated_by FROM eos_crm.accounts WHERE id = $1`, [acct1.accountId])).rows[0];
    assert.deepEqual(row, { name: "Mesquite Soda Works", status: "ACTIVE", updated_by: "p-t1" });
    const listed = await accounts.listAccounts(deps, A2, { nameStartsWith: "mesquite" });
    assert.deepEqual(listed.items.map((a) => a.accountId), [acct2.accountId], "a same-named Account of another tenant leaked");
    assert.deepEqual((await accounts.getAccount(deps, A1, { accountId: acct1.accountId })).accountId, acct1.accountId);
  });

  await t.test("(3) Contact: created under the actor's tenant Account, owner inherited at creation; cannot link across tenant", async () => {
    const c1 = await contacts.createContact(deps, A1, { idempotencyKey: K(), accountId: acct1.accountId, name: "Ana", email: "ana@example.com", isPrimary: true });
    assert.equal(c1.accountId, acct1.accountId);
    assert.equal(c1.ownerEmployeeId, "e-t1", "owner inherited from the parent Account");
    assert.equal(c1.createdBy, "p-t1");
    const c0 = await contacts.createContact(deps, A1, { idempotencyKey: K(), accountId: ownerless.accountId, name: "Bo" });
    assert.equal(c0.ownerEmployeeId, null, "an ownerless parent yields an ownerless child, never the actor");
    // Tenant B names tenant A's Account.
    await assert.rejects(contacts.createContact(deps, A2, { idempotencyKey: K(), accountId: acct1.accountId, name: "Intruder" }), code("ACCOUNT_NOT_FOUND"));
    assert.equal(await count("contacts", "name = 'Intruder'"), 0);
    // Tenant B cannot read, list or mutate tenant A's Contact.
    await assert.rejects(contacts.getContact(deps, A2, { contactId: c1.contactId }), code("CONTACT_NOT_FOUND"));
    await assert.rejects(contacts.updateContact(deps, A2, { contactId: c1.contactId, name: "Hijacked" }), code("CONTACT_NOT_FOUND"));
    await assert.rejects(contacts.listAccountContacts(deps, A2, { accountId: acct1.accountId }), code("ACCOUNT_NOT_FOUND"));
    assert.equal((await q(`SELECT name FROM eos_crm.contacts WHERE id = $1`, [c1.contactId])).rows[0].name, "Ana");
    // The schema refuses the cross-tenant link even when the governed read is bypassed.
    await assert.rejects(q(`INSERT INTO eos_crm.contacts (id, tenant_id, account_id, name, created_by, updated_by) VALUES ('raw-c','t2',$1,'Raw','x','x')`, [acct1.accountId]), (e) => e.constraint === "contacts_account_same_tenant");
    // Update: allowlisted fields only; attribution follows the updater.
    const u = await contacts.updateContact(deps, A1, { contactId: c1.contactId, phone: "555-0100", email: null });
    assert.equal(u.phone, "555-0100");
    assert.equal(u.email, null);
    assert.equal(u.accountId, acct1.accountId);
    assert.equal(u.createdBy, "p-t1");
    await assert.rejects(contacts.updateContact(deps, A1, { contactId: c1.contactId, accountId: ownerless.accountId }), code("FIELD_NOT_ALLOWED"));
    assert.equal((await q(`SELECT account_id FROM eos_crm.contacts WHERE id = $1`, [c1.contactId])).rows[0].account_id, acct1.accountId);
  });

  await t.test("(4) Location: customer site under the actor's tenant Account; cannot link across tenant; never an inventory location", async () => {
    const s1 = await sites.createAccountLocation(deps, A1, { idempotencyKey: K(), accountId: acct1.accountId, name: "Main Kitchen", addressStreet: "1 Main", addressCity: "Austin", addressState: "TX", addressPostalCode: "78701" });
    assert.equal(s1.ownerEmployeeId, "e-t1");
    assert.equal(s1.createdBy, "p-t1");
    await assert.rejects(sites.createAccountLocation(deps, A2, { idempotencyKey: K(), accountId: acct1.accountId, name: "Intruder Site" }), code("ACCOUNT_NOT_FOUND"));
    assert.equal(await count("account_locations", "name = 'Intruder Site'"), 0);
    await assert.rejects(sites.getAccountLocation(deps, A2, { accountLocationId: s1.accountLocationId }), code("ACCOUNT_LOCATION_NOT_FOUND"));
    await assert.rejects(sites.updateAccountLocation(deps, A2, { accountLocationId: s1.accountLocationId, accessNotes: "gate code" }), code("ACCOUNT_LOCATION_NOT_FOUND"));
    await assert.rejects(sites.listAccountLocations(deps, A2, { accountId: acct1.accountId }), code("ACCOUNT_NOT_FOUND"));
    await assert.rejects(q(`INSERT INTO eos_crm.account_locations (id, tenant_id, account_id, name, created_by, updated_by) VALUES ('raw-s','t2',$1,'Raw','x','x')`, [acct1.accountId]), (e) => e.constraint === "account_locations_account_same_tenant");
    await assert.rejects(sites.createAccountLocation(deps, A1, { idempotencyKey: K(), accountId: acct1.accountId, name: "Warehouse 9", type: "WAREHOUSE" }), code("INVENTORY_LOCATION_DISCRIMINATOR_REFUSED"));
    assert.equal(await count("account_locations", "name = 'Warehouse 9'"), 0);
    const u = await sites.updateAccountLocation(deps, A1, { accountLocationId: s1.accountLocationId, accessNotes: "  back door  ", addressCity: null });
    assert.equal(u.accessNotes, "back door");
    assert.equal(u.addressCity, null);
    assert.equal(u.addressStreet, "1 Main");
    assert.deepEqual((await sites.listAccountLocations(deps, A1, { accountId: acct1.accountId })).items.map((s) => s.accountLocationId), [s1.accountLocationId]);
  });

  await t.test("(5) COMMERCIAL FK CONTRACT: a CRM-created Account id IS the eos_commercial account_id; no mapping id", async () => {
    await q(`INSERT INTO eos_commercial.opportunities (id, tenant_id, opportunity_number, account_id, owner_employee_id, created_by, updated_by)
             VALUES ('opp-d1a','t1','OPP-D1A',$1,'e-t1','p-t1','p-t1')`, [acct1.accountId]);
    // The same id from the wrong tenant is refused by the composite (tenant_id, account_id) FK.
    await assert.rejects(q(`INSERT INTO eos_commercial.opportunities (id, tenant_id, opportunity_number, account_id, owner_employee_id, created_by, updated_by)
             VALUES ('opp-x','t2','OPP-X',$1,'e-t2','p-t2','p-t2')`, [acct1.accountId]), (e) => e.code === "23503" && e.constraint === "opportunities_account_fk");
    const fks = (await q(`
      SELECT c.conname, c.convalidated, pg_get_constraintdef(c.oid) AS def, t.relname AS on_table
        FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname = 'eos_commercial' AND c.contype = 'f' AND c.confrelid = 'eos_crm.accounts'::regclass
       ORDER BY c.conname`)).rows;
    assert.deepEqual(fks.map((f) => f.conname), ["opportunities_account_fk", "sales_agreements_account_fk", "sales_orders_account_fk"]);
    for (const f of fks) assert.equal(f.def.replace(/\s+NOT VALID$/, ""), "FOREIGN KEY (tenant_id, account_id) REFERENCES eos_crm.accounts(tenant_id, id)");
    // C1 semantics: still NOT VALID (legacy Firestore-only account ids may exist); new rows are checked. Validation of
    // the populated table would succeed here because every row references a CRM-created Account -- proven in a
    // rolled-back transaction so the C1 posture is left exactly as migrated.
    assert.ok(fks.every((f) => f.convalidated === false), "C1 FK posture changed");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("ALTER TABLE eos_commercial.opportunities VALIDATE CONSTRAINT opportunities_account_fk");
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    // No mapping column exists anywhere between the two identities.
    const mapping = (await q(`SELECT table_schema, table_name, column_name FROM information_schema.columns
      WHERE table_schema IN ('eos_crm','eos_commercial') AND column_name ~ '(crm_account|legacy_account|firestore|external_account|account_ref|account_key)'`)).rows;
    assert.deepEqual(mapping, []);
    // The Commercial reader resolves the CRM-created Account by the same id.
    const commercial = (await q(`SELECT a.name FROM eos_commercial.opportunities o JOIN eos_crm.accounts a ON a.tenant_id = o.tenant_id AND a.id = o.account_id WHERE o.id = 'opp-d1a'`)).rows;
    assert.deepEqual(commercial, [{ name: "Mesquite Soda Works" }]);
  });

  await t.test("(6) caller authority in input is refused and writes nothing", async () => {
    const before = [await count("accounts"), await count("contacts"), await count("account_locations")];
    for (const field of ["tenantId", "principalId", "capabilities", "uid", "roles", "securityRole", "jobRole", "externalSubject", "identityProvider"]) {
      await assert.rejects(accounts.createAccount(deps, A1, { idempotencyKey: K(), ownerEmployeeId: "e-t1", name: "Forged", status: "ACTIVE", [field]: "t2" }), code("CALLER_AUTHORITY_REFUSED"));
      await assert.rejects(accounts.updateAccount(deps, A1, { accountId: acct1.accountId, name: "Forged", [field]: "t2" }), code("CALLER_AUTHORITY_REFUSED"));
      await assert.rejects(contacts.createContact(deps, A2, { idempotencyKey: K(), accountId: acct1.accountId, name: "Forged", [field]: "t1" }), code("CALLER_AUTHORITY_REFUSED"));
      await assert.rejects(sites.createAccountLocation(deps, A2, { idempotencyKey: K(), accountId: acct1.accountId, name: "Forged", [field]: "t1" }), code("CALLER_AUTHORITY_REFUSED"));
      await assert.rejects(accounts.getAccount(deps, A2, { accountId: acct1.accountId, [field]: "t1" }), code("CALLER_AUTHORITY_REFUSED"));
    }
    assert.deepEqual([await count("accounts"), await count("contacts"), await count("account_locations")], before);
    assert.equal(await count("accounts", "name = 'Forged'"), 0);
  });

  await t.test("(7) no write without capability; non-members and disabled principals refused; no Job Role inference", async () => {
    const before = await count("accounts");
    const reader = { tenantId: "t1", principalId: "p-t1", capabilities: new Set(["customer.record.read"]) };
    await assert.rejects(accounts.createAccount(deps, reader, { idempotencyKey: K(), ownerEmployeeId: "e-t1", name: "No Cap", status: "ACTIVE" }), code("CAPABILITY_REQUIRED"));
    await assert.rejects(accounts.updateAccount(deps, reader, { accountId: acct1.accountId, name: "No Cap" }), code("CAPABILITY_REQUIRED"));
    await assert.rejects(contacts.createContact(deps, reader, { idempotencyKey: K(), accountId: acct1.accountId, name: "No Cap" }), code("CAPABILITY_REQUIRED"));
    await assert.rejects(sites.createAccountLocation(deps, reader, { idempotencyKey: K(), accountId: acct1.accountId, name: "No Cap" }), code("CAPABILITY_REQUIRED"));
    // Role-shaped strings are not capabilities.
    const roleShaped = { tenantId: "t1", principalId: "p-t1", capabilities: new Set(["admin", "ADMIN", "dispatcher", "SALES_MANAGER", "jobRole:GENERAL_MANAGER"]) };
    await assert.rejects(accounts.createAccount(deps, roleShaped, { idempotencyKey: K(), ownerEmployeeId: "e-t1", name: "No Cap", status: "ACTIVE" }), code("CAPABILITY_REQUIRED"));
    await assert.rejects(accounts.getAccount(deps, roleShaped, { accountId: acct1.accountId }), code("CAPABILITY_REQUIRED"));
    // A principal of tenant B claiming tenant A; a disabled principal of tenant A.
    await assert.rejects(accounts.createAccount(deps, { ...A1, principalId: "p-t2" }, { idempotencyKey: K(), ownerEmployeeId: "e-t1", name: "No Cap", status: "ACTIVE" }), code("ACTOR_NOT_TENANT_MEMBER"));
    await assert.rejects(accounts.getAccount(deps, { ...A1, principalId: "p-t2" }, { accountId: acct1.accountId }), code("ACTOR_NOT_TENANT_MEMBER"));
    await assert.rejects(accounts.createAccount(deps, { ...A1, principalId: "p-disabled" }, { idempotencyKey: K(), ownerEmployeeId: "e-t1", name: "No Cap", status: "ACTIVE" }), code("ACTOR_NOT_TENANT_MEMBER"));
    assert.equal(await count("accounts"), before);
  });

  await t.test("(8) grantable through PostgreSQL: migration 024 vocabulary -> role_capabilities -> resolved capability -> governed write", async () => {
    const keys = (await q(`SELECT key FROM eos_policy.capabilities WHERE key LIKE 'customer.%' ORDER BY key`)).rows.map((r) => r.key);
    assert.deepEqual(keys, ["customer.governedField.write", "customer.record.create", "customer.record.read", "customer.record.update"]);
    assert.equal(Number((await q(`SELECT count(*)::int n FROM eos_policy.role_capabilities`)).rows[0].n), 0, "a migration granted a capability");
    await q(`INSERT INTO eos_policy.roles (id, tenant_id, key, name, origin, created_by, updated_by) VALUES ('r-crm','t1','crm-editor','CRM editor','CUSTOM','proof','proof')`);
    await q(`INSERT INTO eos_policy.role_capabilities (id, tenant_id, role_id, capability_id, granted_by, created_by, updated_by)
             SELECT 'rc-' || c.id, 't1', 'r-crm', c.id, 'proof', 'proof', 'proof' FROM eos_policy.capabilities c WHERE c.key IN ('customer.record.read','customer.record.create')`);
    const resolved = await capabilitiesForRoleKeys(pool, "t1", ["crm-editor"]);
    assert.deepEqual([...resolved].sort(), ["customer.record.create", "customer.record.read"]);
    const created = await accounts.createAccount(deps, { tenantId: "t1", principalId: "p-t1", capabilities: resolved }, { idempotencyKey: K(), ownerEmployeeId: "e-t1", name: "Granted", status: "PROSPECT" });
    assert.equal(created.createdBy, "p-t1");
    await assert.rejects(accounts.updateAccount(deps, { tenantId: "t1", principalId: "p-t1", capabilities: resolved }, { accountId: created.accountId, name: "Nope" }), code("CAPABILITY_REQUIRED"));
    assert.deepEqual([...(await capabilitiesForRoleKeys(pool, "t2", ["crm-editor"]))], [], "a grant in t1 resolved in t2");
  });

  await t.test("(9) updates are allowlisted and change only what they name", async () => {
    const before = (await q(`SELECT owner_employee_id, created_by, created_at FROM eos_crm.accounts WHERE id = $1`, [acct1.accountId])).rows[0];
    for (const extra of ["ownerEmployeeId", "accountOwner", "createdBy", "createdAt", "updatedBy", "id", "nameLower"]) {
      await assert.rejects(accounts.updateAccount(deps, A1, { accountId: acct1.accountId, status: "INACTIVE", [extra]: "p-evil" }), code("FIELD_NOT_ALLOWED"));
    }
    assert.equal((await q(`SELECT status FROM eos_crm.accounts WHERE id = $1`, [acct1.accountId])).rows[0].status, "ACTIVE");
    const updater = { ...A1, principalId: "p-updater" };
    await q(`INSERT INTO eos_policy.principals (id, external_subject, identity_provider) VALUES ('p-updater','p-updater','proof')`);
    await q(`INSERT INTO eos_policy.tenant_memberships (id, tenant_id, principal_id) VALUES ('m-p-updater','t1','p-updater')`);
    const updated = await accounts.updateAccount(deps, updater, { accountId: acct1.accountId, status: "INACTIVE" });
    assert.equal(updated.status, "INACTIVE");
    assert.equal(updated.name, "Mesquite Soda Works");
    assert.equal(updated.updatedBy, "p-updater");
    const after = (await q(`SELECT owner_employee_id, created_by, created_at FROM eos_crm.accounts WHERE id = $1`, [acct1.accountId])).rows[0];
    assert.deepEqual(after, before, "an update touched owner or creation attribution");
  });

  await t.test("(10) reads are bounded, paged without gaps or repeats, and read-only", async () => {
    for (let i = 0; i < 7; i++) await accounts.createAccount(deps, A1, { idempotencyKey: K(), ownerEmployeeId: "e-t1", name: `Paged ${String.fromCharCode(71 - i)}`, status: "ACTIVE" });
    statements.length = 0;
    const seen = [];
    let cursor;
    let pages = 0;
    do {
      const page = await accounts.listAccounts(deps, A1, { nameStartsWith: "paged", limit: 3, ...(cursor ? { cursor } : {}) });
      assert.ok(page.items.length <= 3);
      seen.push(...page.items.map((a) => a.name));
      cursor = page.nextCursor;
      pages++;
    } while (cursor);
    assert.equal(pages, 3);
    assert.deepEqual(seen, ["Paged A", "Paged B", "Paged C", "Paged D", "Paged E", "Paged F", "Paged G"]);
    const reads = statements.filter((s) => /eos_crm/.test(s));
    assert.ok(reads.length > 0 && reads.every((s) => /LIMIT \$\d/.test(s) && !/\bINSERT\s+INTO\b|\bUPDATE\s+eos_|\bDELETE\s+FROM\b|FOR (SHARE|UPDATE)/i.test(s)));
    assert.ok(statements.includes("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"));
    const filtered = await accounts.listAccounts(deps, A1, { status: "PROSPECT" });
    assert.ok(filtered.items.length > 0 && filtered.items.every((a) => a.status === "PROSPECT"));
    const deflt = await accounts.listAccounts(deps, A1, {});
    assert.ok(deflt.items.length <= 50);
    await assert.rejects(accounts.listAccounts(deps, A1, { limit: 500 }), code("PAGE_SIZE_INVALID"));
    // Contacts page within ONE Account.
    for (let i = 0; i < 4; i++) await contacts.createContact(deps, A1, { idempotencyKey: K(), accountId: ownerless.accountId, name: `Person ${i}` });
    const p1 = await contacts.listAccountContacts(deps, A1, { accountId: ownerless.accountId, limit: 2 });
    const p2 = await contacts.listAccountContacts(deps, A1, { accountId: ownerless.accountId, limit: 2, cursor: p1.nextCursor });
    const p3 = await contacts.listAccountContacts(deps, A1, { accountId: ownerless.accountId, limit: 2, cursor: p2.nextCursor });
    assert.deepEqual([...p1.items, ...p2.items, ...p3.items].map((c) => c.name), ["Bo", "Person 0", "Person 1", "Person 2", "Person 3"]);
    assert.equal(p3.truncated, false);
    assert.ok([...p1.items, ...p2.items, ...p3.items].every((c) => c.accountId === ownerless.accountId));
  });

  await t.test("(11) a real PostgreSQL failure leaks no SQL, relation, constraint or connection detail", async () => {
    const breaking = {
      connect: async () => {
        const client = await pool.connect();
        return {
          query: (text, values) => /INSERT INTO eos_crm\.accounts/.test(String(text))
            ? client.query("SELECT secret_column FROM eos_crm.no_such_relation_d1a WHERE tenant_id = $1", [values[1]])
            : client.query(text, values),
          release: () => client.release(),
        };
      },
    };
    const err = await accounts.createAccount({ pool: breaking }, A1, { idempotencyKey: K(), ownerEmployeeId: "e-t1", name: "Broken", status: "ACTIVE" }).then(() => null, (e) => e);
    assert.ok(err, "the broken statement did not refuse");
    assert.equal(err.code, "CRM_COMMAND_FAILED");
    assert.equal(err.category, "FAILED");
    assert.doesNotMatch(`${err.message} ${JSON.stringify(err)} ${err.stack}`, /no_such_relation|secret_column|relation|eos_crm|42P01|SELECT|127\.0\.0\.1|55451|eos:/);
    assert.equal(await count("accounts", "name = 'Broken'"), 0, "a failed command left a partial effect");
    const unreachable = new pg.Pool({ connectionString: (() => { const u = new URL(URL_BASE); u.pathname = "/d1a_no_such_database"; return u.toString(); })(), max: 1 });
    try {
      const readErr = await accounts.getAccount({ pool: unreachable }, A1, { accountId: acct1.accountId }).then(() => null, (e) => e);
      assert.equal(readErr.code, "CRM_READ_FAILED");
      assert.doesNotMatch(`${readErr.message} ${JSON.stringify(readErr)}`, /d1a_no_such_database|does not exist|eos|55451/);
    } finally {
      await unreachable.end();
    }
  });

  await t.test("(12) no Firebase, no Firestore: the operations run in a process where loading Firebase exits", async () => {
    const preload = join(mkdtempSync(join(tmpdir(), "d1a-pg-")), "preload.cjs");
    writeFileSync(preload, `const M=require("module");const l=M._load;M._load=function(r,...a){if(/firebase|firestore/i.test(r)){process.stderr.write("D1A_LOADED_FIREBASE:"+r);process.exit(97);}return l.call(this,r,...a);};`);
    const script = `
      const pg = require("pg");
      const a = require("./lib/eosCrm/accountAuthority.js");
      const c = require("./lib/eosCrm/contactAuthority.js");
      const s = require("./lib/eosCrm/accountLocationAuthority.js");
      (async () => {
        const pool = new pg.Pool({ connectionString: process.env.D1A_DB, max: 2 });
        const actor = { tenantId: "t1", principalId: "p-t1", capabilities: new Set(["customer.record.read","customer.record.create","customer.record.update"]) };
        const acct = await a.createAccount({ pool }, actor, { idempotencyKey: "sub-a", ownerEmployeeId: "e-t1", name: "Subprocess", status: "ACTIVE" });
        await c.createContact({ pool }, actor, { idempotencyKey: "sub-c", accountId: acct.accountId, name: "Sub Contact" });
        await s.createAccountLocation({ pool }, actor, { idempotencyKey: "sub-s", accountId: acct.accountId, name: "Sub Site" });
        await a.getAccount({ pool }, actor, { accountId: acct.accountId });
        await pool.end();
        const loaded = Object.keys(require.cache).filter((k) => /firebase|firestore/i.test(k));
        if (loaded.length) { process.stderr.write("D1A_LOADED_FIREBASE:" + loaded.join(",")); process.exit(98); }
        process.stdout.write("OK");
      })().catch((e) => { process.stderr.write("FAILED:" + (e && e.code)); process.exit(1); });`;
    const probe = spawnSync(process.execPath, ["--require", preload, "-e", script], { cwd: FUNCTIONS_DIR, encoding: "utf8", env: { ...process.env, D1A_DB: dbUrl() } });
    assert.equal(probe.status, 0, `subprocess failed: ${probe.stderr.slice(0, 200)}`);
    assert.equal(probe.stdout, "OK");
    assert.equal(await count("contacts", "name = 'Sub Contact'"), 1);
  });

  await t.test("(13) ACCOUNT BUSINESS FACTS: every migrated field round-trips, children are normalized and tenant-bound", async () => {
    const full = await accounts.createAccount(deps, A1, {
      idempotencyKey: K(), ownerEmployeeId: "e-t1", name: "Full Facts Co", status: "ACTIVE", notes: "  Use the back gate ",
      billingAddress: { street: "1 Main", city: "Austin", state: "TX", zip: "78701" }, customerNumber: "C-100", erpId: "ERP-9",
      accountingId: "AC-7", legacyId: "L-3", defaultCurrency: "USD", purchaseOrderRequired: true, invoiceDeliveryMethod: "EDI",
      tags: ["VIP", " Chain Store "], relationshipTypes: ["VENDOR", "CUSTOMER"], lineOfBusiness: ["VENTANA", "TAYLOR"],
    });
    assert.deepEqual({ ...full, accountId: undefined, createdAt: undefined, updatedAt: undefined, replayed: undefined }, {
      accountId: undefined, name: "Full Facts Co", status: "ACTIVE", ownerEmployeeId: "e-t1", notes: "Use the back gate",
      billingAddress: { street: "1 Main", city: "Austin", state: "TX", zip: "78701" }, customerNumber: "C-100", erpId: "ERP-9",
      accountingId: "AC-7", legacyId: "L-3", defaultCurrency: "USD", purchaseOrderRequired: true, invoiceDeliveryMethod: "EDI",
      paymentTerms: null, taxStatus: null, billingContactId: null, tags: ["VIP", "Chain Store"],
      relationshipTypes: ["CUSTOMER", "VENDOR"], lineOfBusiness: ["TAYLOR", "VENTANA"], createdBy: "p-t1", createdAt: undefined,
      updatedBy: "p-t1", updatedAt: undefined, replayed: undefined,
    });
    assert.deepEqual(await accounts.getAccount(deps, A1, { accountId: full.accountId }), (({ replayed, ...rest }) => rest)(full));
    assert.deepEqual((await q(`SELECT position, tag FROM eos_crm.account_tags WHERE account_id = $1 ORDER BY position`, [full.accountId])).rows, [{ position: 0, tag: "VIP" }, { position: 1, tag: "Chain Store" }]);
    assert.equal(await count("account_relationship_types", "account_id = $1", [full.accountId]), 2);
    // No JSON dump of the legacy document anywhere in eos_crm.
    assert.deepEqual((await q(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'eos_crm' AND data_type IN ('json','jsonb') AND table_name <> 'command_receipts'`)).rows, []);
    // External ids are NOT unique (ruling D-C1-4): a second Account may carry the same customer number.
    await accounts.createAccount(deps, A1, { idempotencyKey: K(), ownerEmployeeId: "e-t1", name: "Same Number Co", status: "ACTIVE", customerNumber: "C-100" });
    // Update: sets are replaced, scalars cleared by null, billing address cleared together.
    const updated = await accounts.updateAccount(deps, A1, { accountId: full.accountId, tags: ["Chain Store"], lineOfBusiness: [], billingAddress: null, notes: null, purchaseOrderRequired: false });
    assert.deepEqual([updated.tags, updated.lineOfBusiness, updated.billingAddress, updated.notes, updated.purchaseOrderRequired, updated.relationshipTypes],
      [["Chain Store"], [], null, null, false, ["CUSTOMER", "VENDOR"]]);
    // Billing contact: a Contact of THIS Account only.
    const own = await contacts.createContact(deps, A1, { idempotencyKey: K(), accountId: full.accountId, name: "Billing Person" });
    const other = await contacts.createContact(deps, A1, { idempotencyKey: K(), accountId: acct1.accountId, name: "Elsewhere" });
    assert.equal((await accounts.updateAccount(deps, A1, { accountId: full.accountId, billingContactId: own.contactId })).billingContactId, own.contactId);
    await assert.rejects(accounts.updateAccount(deps, A1, { accountId: full.accountId, billingContactId: other.contactId }), code("BILLING_CONTACT_NOT_ON_ACCOUNT"));
    const t2contact = await contacts.createContact(deps, A2, { idempotencyKey: K(), accountId: acct2.accountId, name: "T2 Person" });
    await assert.rejects(accounts.updateAccount(deps, A1, { accountId: full.accountId, billingContactId: t2contact.contactId }), code("BILLING_CONTACT_NOT_ON_ACCOUNT"));
    assert.equal((await accounts.getAccount(deps, A1, { accountId: full.accountId })).billingContactId, own.contactId);
    // Tenant B cannot mutate tenant A's business facts or children.
    await assert.rejects(accounts.updateAccount(deps, A2, { accountId: full.accountId, tags: ["Hijacked"] }), code("ACCOUNT_NOT_FOUND"));
    assert.equal(await count("account_tags", "tag = 'Hijacked'"), 0);
    // The schema holds the same line when the authority is bypassed.
    await assert.rejects(q(`INSERT INTO eos_crm.account_tags (tenant_id, account_id, position, tag) VALUES ('t2', $1, 9, 'Raw')`, [full.accountId]), (e) => e.constraint === "account_tags_account_same_tenant");
    await assert.rejects(q(`UPDATE eos_crm.accounts SET payment_terms = 'NET_45' WHERE id = $1`, [full.accountId]), (e) => e.constraint === "accounts_payment_terms_vocabulary");
    await assert.rejects(q(`UPDATE eos_crm.accounts SET default_currency = 'usd' WHERE id = $1`, [full.accountId]), (e) => e.constraint === "accounts_default_currency_shape");
    await assert.rejects(q(`INSERT INTO eos_crm.account_lines_of_business (tenant_id, account_id, line_of_business) VALUES ('t1', $1, 'not a key')`, [full.accountId]), (e) => e.code === "23514");
  });

  await t.test("(14) GOVERNED FIELDS keep their distinct authority: customer.governedField.write", async () => {
    const noGoverned = A1;
    const governed = { ...A1, capabilities: new Set([...ALL, "customer.governedField.write"]) };
    await assert.rejects(accounts.createAccount(deps, noGoverned, { idempotencyKey: K(), ownerEmployeeId: "e-t1", name: "Terms Co", status: "ACTIVE", paymentTerms: "NET_30" }), code("CAPABILITY_REQUIRED"));
    const baseline = await accounts.createAccount(deps, noGoverned, { idempotencyKey: K(), ownerEmployeeId: "e-t1", name: "Terms Co", status: "ACTIVE", taxStatus: "UNKNOWN" });
    assert.equal(baseline.taxStatus, "UNKNOWN");
    await assert.rejects(accounts.updateAccount(deps, noGoverned, { accountId: baseline.accountId, paymentTerms: "NET_60" }), code("CAPABILITY_REQUIRED"));
    await assert.rejects(accounts.updateAccount(deps, noGoverned, { accountId: baseline.accountId, taxStatus: "EXEMPT", name: "Sneaky" }), code("CAPABILITY_REQUIRED"));
    assert.equal((await accounts.getAccount(deps, A1, { accountId: baseline.accountId })).name, "Terms Co", "a refused governed change left a partial effect");
    const set = await accounts.updateAccount(deps, governed, { accountId: baseline.accountId, paymentTerms: "NET_60", taxStatus: "EXEMPT" });
    assert.deepEqual([set.paymentTerms, set.taxStatus], ["NET_60", "EXEMPT"]);
    // Naming the CURRENT governed values is not a governed write (accountGovernedFieldsUnchanged).
    const same = await accounts.updateAccount(deps, noGoverned, { accountId: baseline.accountId, paymentTerms: "NET_60", taxStatus: "EXEMPT", notes: "ok" });
    assert.equal(same.notes, "ok");
    const created = await accounts.createAccount(deps, governed, { idempotencyKey: K(), ownerEmployeeId: "e-t1", name: "Governed Co", status: "ACTIVE", paymentTerms: "COD", taxStatus: "RESELLER" });
    assert.deepEqual([created.paymentTerms, created.taxStatus], ["COD", "RESELLER"]);
    // The governed capability never stands in for the record verb.
    await assert.rejects(accounts.updateAccount(deps, { ...A1, capabilities: new Set(["customer.governedField.write"]) }, { accountId: created.accountId, paymentTerms: "NET_30" }), code("CAPABILITY_REQUIRED"));
  });

  await t.test("(15) STATUS: canonical vocabulary only; no transition graph is enforced", async () => {
    const a = await accounts.createAccount(deps, A1, { idempotencyKey: K(), ownerEmployeeId: "e-t1", name: "Lifecycle Co", status: "ARCHIVED" });
    for (const status of ["ACTIVE", "PROSPECT", "ARCHIVED", "INACTIVE", "PROSPECT"]) {
      assert.equal((await accounts.updateAccount(deps, A1, { accountId: a.accountId, status })).status, status);
    }
    await assert.rejects(accounts.updateAccount(deps, A1, { accountId: a.accountId, status: "DELETED" }), code("STATUS_INVALID"));
    await assert.rejects(accounts.updateAccount(deps, A1, { accountId: a.accountId, status: "prospect" }), code("STATUS_INVALID"));
  });

  await t.test("(16) IDEMPOTENCY: replay, request mismatch, scoping, raw key never stored, rollback leaves no receipt", async () => {
    const key = `secret-key-${randomUUID()}`;
    const input = { idempotencyKey: key, ownerEmployeeId: "e-t1", name: "Idempotent Co", status: "ACTIVE", tags: ["x"] };
    const first = await accounts.createAccount(deps, A1, input);
    const again = await accounts.createAccount(deps, A1, { ...input });
    assert.equal(first.replayed, false);
    assert.equal(again.replayed, true);
    assert.deepEqual({ ...again, replayed: false }, first, "a replay returned a different result");
    assert.equal(await count("accounts", "name = 'Idempotent Co'"), 1);
    // A different request under the same key refuses and writes nothing.
    await assert.rejects(accounts.createAccount(deps, A1, { ...input, name: "Other Co" }), code("IDEMPOTENCY_KEY_REUSED"));
    assert.equal(await count("accounts", "name = 'Other Co'"), 0);
    // Scope: the same key for another principal, another tenant or another operation is a different key.
    await q(`INSERT INTO eos_policy.principals (id, external_subject, identity_provider) VALUES ('p-t1-b','p-t1-b','proof')`);
    await q(`INSERT INTO eos_policy.tenant_memberships (id, tenant_id, principal_id) VALUES ('m-p-t1-b','t1','p-t1-b')`);
    const otherPrincipal = await accounts.createAccount(deps, { ...A1, principalId: "p-t1-b" }, input);
    assert.equal(otherPrincipal.replayed, false);
    assert.notEqual(otherPrincipal.accountId, first.accountId);
    const otherTenant = await accounts.createAccount(deps, A2, { ...input, ownerEmployeeId: "e-t2" });
    assert.equal(otherTenant.replayed, false);
    const contact = await contacts.createContact(deps, A1, { idempotencyKey: key, accountId: first.accountId, name: "Keyed" });
    const site = await sites.createAccountLocation(deps, A1, { idempotencyKey: key, accountId: first.accountId, name: "Keyed" });
    assert.equal(contact.replayed, false);
    assert.equal(site.replayed, false);
    assert.equal((await contacts.createContact(deps, A1, { idempotencyKey: key, accountId: first.accountId, name: "Keyed" })).contactId, contact.contactId);
    assert.equal((await sites.createAccountLocation(deps, A1, { idempotencyKey: key, accountId: first.accountId, name: "Keyed" })).accountLocationId, site.accountLocationId);
    assert.equal(await count("contacts", "name = 'Keyed'"), 1);
    // The raw key is nowhere in the database.
    const receipts = (await q(`SELECT * FROM eos_crm.command_receipts`)).rows;
    assert.ok(receipts.length >= 5);
    assert.ok(!JSON.stringify(receipts).includes(key), "a raw idempotency key was stored");
    const mine = receipts.filter((r) => r.target_id === first.accountId);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].idempotency_key_hash, createHash("sha256").update(key, "utf8").digest("hex"));
    assert.deepEqual([mine[0].principal_id, mine[0].operation, mine[0].target_type], ["p-t1", "crm.createAccount", "ACCOUNT"]);
    // Rollback: a create that fails leaves neither record nor receipt, and the key stays free.
    const failKey = `fail-${randomUUID()}`;
    await assert.rejects(accounts.createAccount(deps, A1, { idempotencyKey: failKey, ownerEmployeeId: "e-t2", name: "Rolled Back", status: "ACTIVE" }), code("OWNER_NOT_FOUND"));
    const failingReceipt = {
      connect: async () => {
        const client = await pool.connect();
        return {
          query: (text, values) => /INSERT INTO eos_crm\.command_receipts/.test(String(text)) ? Promise.reject(Object.assign(new Error("boom"), { code: "57014" })) : client.query(text, values),
          release: () => client.release(),
        };
      },
    };
    await assert.rejects(accounts.createAccount({ pool: failingReceipt }, A1, { idempotencyKey: failKey, ownerEmployeeId: "e-t1", name: "Rolled Back", status: "ACTIVE" }), code("CRM_COMMAND_FAILED"));
    assert.equal(await count("accounts", "name = 'Rolled Back'"), 0, "the create survived its receipt's failure");
    assert.equal(await count("command_receipts", "idempotency_key_hash = $1", [createHash("sha256").update(failKey, "utf8").digest("hex")]), 0);
    // A COMMIT that fails after the receipt INSERT leaves no receipt either: the receipt is the create's own transaction.
    const failingCommit = {
      connect: async () => {
        const client = await pool.connect();
        return {
          query: async (text, values) => {
            if (String(text) === "COMMIT") { await client.query("ROLLBACK"); throw Object.assign(new Error("commit lost"), { code: "08006" }); }
            return client.query(text, values);
          },
          release: () => client.release(),
        };
      },
    };
    const commitKey = `commit-${randomUUID()}`;
    await assert.rejects(accounts.createAccount({ pool: failingCommit }, A1, { idempotencyKey: commitKey, ownerEmployeeId: "e-t1", name: "Commit Lost", status: "ACTIVE" }), code("CRM_COMMAND_FAILED"));
    assert.equal(await count("accounts", "name = 'Commit Lost'"), 0);
    assert.equal(await count("command_receipts", "idempotency_key_hash = $1", [createHash("sha256").update(commitKey, "utf8").digest("hex")]), 0, "a receipt survived its create's failed commit");
    const retried = await accounts.createAccount(deps, A1, { idempotencyKey: failKey, ownerEmployeeId: "e-t1", name: "Rolled Back", status: "ACTIVE" });
    assert.equal(retried.replayed, false);
  });

  await t.test("(17) IDEMPOTENCY under concurrency: twelve simultaneous first executions create exactly one Account", async () => {
    const key = `race-${randomUUID()}`;
    const racePool = new pg.Pool({ connectionString: dbUrl(), max: 12 });
    try {
      const results = await Promise.all(Array.from({ length: 12 }, () =>
        accounts.createAccount({ pool: racePool }, A1, { idempotencyKey: key, ownerEmployeeId: "e-t1", name: "Race Co", status: "ACTIVE" })));
      assert.equal(new Set(results.map((r) => r.accountId)).size, 1);
      assert.equal(results.filter((r) => !r.replayed).length, 1);
      assert.equal(await count("accounts", "name = 'Race Co'"), 1);
      assert.equal(await count("command_receipts", "idempotency_key_hash = $1", [createHash("sha256").update(key, "utf8").digest("hex")]), 1);
    } finally {
      await racePool.end();
    }
  });

  await t.test("(18) migration 025 refuses to roll back while governed facts or receipts exist", async (st) => {
    // Pinned by NAME, not as "the latest": `down 1` reverses the last-run migration, so this proof runs only while 025 is
    // that migration in this database, and says so instead of silently testing a different one.
    const names = (await q(`SELECT name FROM public.pgmigrations ORDER BY run_on DESC, id DESC`)).rows.map((r) => r.name);
    assert.ok(names.includes("1759708800000_crm-account-business-facts-and-receipts"));
    assert.equal(names[0], "1759708800000_crm-account-business-facts-and-receipts", "this database must be migrated only through 025");
    const down = spawnSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "down", "1", "--migrations-dir", "migrations"],
      { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrl() }, encoding: "utf8" });
    assert.notEqual(down.status, 0);
    assert.match(down.stdout + down.stderr, /migration 025 refuses to drop CRM Account business facts/);
    assert.ok((await q(`SELECT to_regclass('eos_crm.command_receipts') AS t`)).rows[0].t, "the receipts table was dropped");
  });
});
