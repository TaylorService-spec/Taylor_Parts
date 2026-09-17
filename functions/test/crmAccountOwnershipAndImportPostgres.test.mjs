// Against a real postgres:16 -- the two governed CRM capabilities the CRM client cutover (CRM-8) requires:
//
//   A. Account ownership history: updateAccount's `ownerEmployeeId` + `ownershipHandoff` as OWNER_HANDOFF (owned Account)
//      or INITIAL_OWNER_ASSIGNMENT (legacy ownerless Account, Owner ruling option b), the append-only
//      eos_crm.account_ownership_history (migration 1759924800000), and listAccountOwnershipHistory.
//   B. The atomic CSV Contact import: importAccountContacts -- 1..200 Contacts for ONE Account, all or none, one receipt.
//
// Its OWN database, migrated by the normal runner through the whole set, dropped in ONE t.after that ends the pool first.
// Nothing here asserts which migration is latest.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
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

const DB_NAME = `crm_hof_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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
const UPDATER = Object.freeze({ tenantId: "t1", principalId: "p-updater", capabilities: ALL });
const K = () => `key-${randomUUID()}`;
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const code = (c) => (e) => {
  assert.equal(e.name, "CrmAuthorityError", `not a governed error: ${e}`);
  assert.equal(e.code, c, `expected ${c}, got ${e.code}: ${e.message}`);
  return true;
};
/** A pool whose client fails the first statement matching `pattern`, the way a real mid-command failure would. */
const failingOn = (pool, pattern) => ({
  connect: async () => {
    const client = await pool.connect();
    return {
      query: (text, values) => pattern.test(String(text)) ? Promise.reject(Object.assign(new Error("injected"), { code: "57014" })) : client.query(text, values),
      release: () => client.release(),
    };
  },
});

test("CRM Account ownership history and atomic Contact import, in PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${DB_NAME}`));
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], {
    cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrl() }, stdio: "pipe",
  });
  const pool = new pg.Pool({ connectionString: dbUrl(), max: 8 });
  t.after(async () => {
    await pool.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`));
  });
  const q = (text, values = []) => pool.query(text, values);
  const deps = { pool };
  const count = async (table, where = "TRUE", values = []) => Number((await q(`SELECT count(*)::int n FROM eos_crm.${table} WHERE ${where}`, values)).rows[0].n);
  const history = (accountId) => q(`SELECT * FROM eos_crm.account_ownership_history WHERE account_id = $1 ORDER BY effective_at, id`, [accountId]).then((r) => r.rows);
  const ownerOf = async (accountId) => (await q(`SELECT owner_employee_id FROM eos_crm.accounts WHERE id = $1`, [accountId])).rows[0].owner_employee_id;

  // ── the world ──
  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1'), ('t2','t2','T2')`);
  for (const [p, tenant] of [["p-t1", "t1"], ["p-t2", "t2"], ["p-updater", "t1"]]) {
    await q(`INSERT INTO eos_policy.principals (id, external_subject, identity_provider) VALUES ($1,$1,'proof')`, [p]);
    await q(`INSERT INTO eos_policy.tenant_memberships (id, tenant_id, principal_id) VALUES ($1,$2,$3)`, [`m-${p}`, tenant, p]);
  }
  await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id) VALUES
    ('e-a','t1','ACTIVE','taylor'), ('e-b','t1','ACTIVE','taylor'), ('e-c','t1','ACTIVE','taylor'), ('e-t2','t2','ACTIVE','taylor')`);
  await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, created_by, updated_by) VALUES
    ('acct-legacy-ownerless','t1','Ownerless Diner','PROSPECT','import','import'),
    ('acct-remediate','t1','Remediation Cafe','ACTIVE','import','import'),
    ('acct-remediate-2','t1','Second Remediation Cafe','ACTIVE','import','import'),
    ('acct-remediate-t2','t2','Tenant Two Ownerless','ACTIVE','import','import')`);

  const acct = await accounts.createAccount(deps, A1, { idempotencyKey: K(), name: "Handoff Co", status: "ACTIVE", ownerEmployeeId: "e-a" });
  const child = await contacts.createContact(deps, A1, { idempotencyKey: K(), accountId: acct.accountId, name: "Child Contact" });
  const site = await sites.createAccountLocation(deps, A1, { idempotencyKey: K(), accountId: acct.accountId, name: "Child Site" });
  const acct2 = await accounts.createAccount(deps, A2, { idempotencyKey: K(), name: "Tenant Two Co", status: "ACTIVE", ownerEmployeeId: "e-t2" });

  // ════════════════════ A. ownership handoff ════════════════════

  await t.test("(A1) a handoff moves the owner, appends ONE history row, and changes other fields in the same command", async () => {
    const updated = await accounts.updateAccount(deps, UPDATER, {
      accountId: acct.accountId, ownerEmployeeId: "e-b", notes: "handed over",
      ownershipHandoff: { source: "CUSTOMER_HANDOFF_REVIEW", reason: "  territory realignment  " },
    });
    assert.deepEqual([updated.ownerEmployeeId, updated.notes, updated.updatedBy, updated.createdBy], ["e-b", "handed over", "p-updater", "p-t1"]);
    const rows = await history(acct.accountId);
    assert.equal(rows.length, 1);
    const [h] = rows;
    assert.match(h.id, /^acown_[0-9a-f-]{36}$/);
    assert.deepEqual(
      { tenant: h.tenant_id, event: h.event, previous: h.previous_owner_employee_id, next: h.new_owner_employee_id, source: h.source, reason: h.reason, by: h.changed_by },
      { tenant: "t1", event: "OWNER_HANDOFF", previous: "e-a", next: "e-b", source: "CUSTOMER_HANDOFF_REVIEW", reason: "territory realignment", by: "p-updater" },
    );
    // Same transaction: recorded at the transaction's server now(); effective once the Account lock was held.
    assert.equal(h.created_at.toISOString(), updated.updatedAt);
    assert.ok(h.effective_at >= h.created_at && h.effective_at - h.created_at < 60_000, "effective_at is not the handoff statement's server time");
    // Through the governed read, newest first.
    const listed = await accounts.listAccountOwnershipHistory(deps, A1, { accountId: acct.accountId });
    assert.deepEqual(listed.items, [{
      historyId: h.id, accountId: acct.accountId, event: "OWNER_HANDOFF", previousOwnerEmployeeId: "e-a", newOwnerEmployeeId: "e-b", source: "CUSTOMER_HANDOFF_REVIEW",
      reason: "territory realignment", changedBy: "p-updater", effectiveAt: h.effective_at.toISOString(), createdAt: updated.updatedAt,
    }]);
    assert.equal(listed.truncated, false);
  });

  await t.test("(A2) NO CASCADE: the Account's Contacts and customer sites keep the owner they inherited at creation", async () => {
    assert.equal((await contacts.getContact(deps, A1, { contactId: child.contactId })).ownerEmployeeId, "e-a");
    assert.equal((await sites.getAccountLocation(deps, A1, { accountLocationId: site.accountLocationId })).ownerEmployeeId, "e-a");
    // A Contact created AFTER the handoff inherits the CURRENT owner.
    assert.equal((await contacts.createContact(deps, A1, { idempotencyKey: K(), accountId: acct.accountId, name: "After Handoff" })).ownerEmployeeId, "e-b");
  });

  await t.test("(A3) default source DIRECT_HANDOFF, no reason; the next handoff's predecessor is the locked current owner; paged newest first", async () => {
    await accounts.updateAccount(deps, A1, { accountId: acct.accountId, ownerEmployeeId: "e-c" });
    await accounts.updateAccount(deps, A1, { accountId: acct.accountId, ownerEmployeeId: "e-a", ownershipHandoff: { reason: "   " } });
    const rows = await history(acct.accountId);
    assert.deepEqual(rows.map((r) => [r.previous_owner_employee_id, r.new_owner_employee_id, r.source, r.reason]), [
      ["e-a", "e-b", "CUSTOMER_HANDOFF_REVIEW", "territory realignment"], ["e-b", "e-c", "DIRECT_HANDOFF", null], ["e-c", "e-a", "DIRECT_HANDOFF", null],
    ]);
    const seen = [];
    let cursor;
    do {
      const page = await accounts.listAccountOwnershipHistory(deps, A1, { accountId: acct.accountId, limit: 2, ...(cursor ? { cursor } : {}) });
      seen.push(...page.items.map((i) => i.newOwnerEmployeeId));
      cursor = page.nextCursor;
    } while (cursor);
    assert.deepEqual(seen, ["e-a", "e-c", "e-b"]);
    await assert.rejects(accounts.listAccountOwnershipHistory(deps, A1, { accountId: acct.accountId, limit: 201 }), code("PAGE_SIZE_INVALID"));
    const foreignCursor = Buffer.from(JSON.stringify({ v: 1, f: "accountOwnershipHistory", n: "not-a-time", id: "x" })).toString("base64url");
    await assert.rejects(accounts.listAccountOwnershipHistory(deps, A1, { accountId: acct.accountId, cursor: foreignCursor }), code("CURSOR_INVALID"));
  });

  await t.test("(A4) the same owner is a no-op for ownership; ownershipHandoff without an owner change refuses and writes nothing", async () => {
    const before = await history(acct.accountId);
    const same = await accounts.updateAccount(deps, A1, { accountId: acct.accountId, ownerEmployeeId: "e-a", name: "Handoff Co Renamed" });
    assert.deepEqual([same.ownerEmployeeId, same.name], ["e-a", "Handoff Co Renamed"]);
    assert.equal((await history(acct.accountId)).length, before.length, "a same-owner update recorded a handoff");
    await assert.rejects(accounts.updateAccount(deps, A1, { accountId: acct.accountId, ownerEmployeeId: "e-a", name: "Nope", ownershipHandoff: { reason: "x" } }), code("OWNERSHIP_HANDOFF_WITHOUT_OWNER_CHANGE"));
    await assert.rejects(accounts.updateAccount(deps, A1, { accountId: acct.accountId, name: "Nope", ownershipHandoff: { source: "DIRECT_HANDOFF" } }), code("OWNERSHIP_HANDOFF_WITHOUT_OWNER_CHANGE"));
    assert.equal((await accounts.getAccount(deps, A1, { accountId: acct.accountId })).name, "Handoff Co Renamed");
    assert.equal((await history(acct.accountId)).length, before.length);
  });

  await t.test("(A5) clearing refuses OWNER_REQUIRED; malformed, foreign-tenant, unknown and Principal-id owners refuse; nothing moves", async () => {
    const before = [await ownerOf(acct.accountId), (await history(acct.accountId)).length];
    for (const [owner, expected] of [[null, "OWNER_REQUIRED"], ["", "OWNER_INVALID"], ["e a", "OWNER_INVALID"], [7, "OWNER_INVALID"],
      ["e-t2", "OWNER_NOT_FOUND"], ["e-nobody", "OWNER_NOT_FOUND"], ["p-t1", "OWNER_NOT_FOUND"]]) {
      await assert.rejects(accounts.updateAccount(deps, A1, { accountId: acct.accountId, ownerEmployeeId: owner, notes: "must not land" }), code(expected), JSON.stringify(owner));
    }
    assert.deepEqual([await ownerOf(acct.accountId), (await history(acct.accountId)).length], before);
    assert.notEqual((await accounts.getAccount(deps, A1, { accountId: acct.accountId })).notes, "must not land", "a refused handoff left a partial effect");
  });

  await t.test("(A6) source is the closed vocabulary; reason is bounded; the store holds the same line", async () => {
    for (const [handoff, expected] of [
      [{ source: "WHIM" }, "HANDOFF_SOURCE_INVALID"], [{ source: "direct_handoff" }, "HANDOFF_SOURCE_INVALID"], [{ source: null }, "HANDOFF_SOURCE_INVALID"],
      [{ reason: "x".repeat(501) }, "HANDOFF_REASON_INVALID"], [{ reason: 42 }, "HANDOFF_REASON_INVALID"], [{ effectiveAt: "2020-01-01" }, "FIELD_NOT_ALLOWED"],
      [{ previousOwnerEmployeeId: "e-z" }, "FIELD_NOT_ALLOWED"], ["DIRECT_HANDOFF", "HANDOFF_INVALID"], [null, "HANDOFF_INVALID"],
    ]) {
      await assert.rejects(accounts.updateAccount(deps, A1, { accountId: acct.accountId, ownerEmployeeId: "e-b", ownershipHandoff: handoff }), code(expected), JSON.stringify(handoff));
    }
    assert.equal(await ownerOf(acct.accountId), "e-a");
    for (const source of accounts.ACCOUNT_OWNERSHIP_HANDOFF_SOURCES) {
      const next = (await ownerOf(acct.accountId)) === "e-a" ? "e-b" : "e-a";
      await accounts.updateAccount(deps, A1, { accountId: acct.accountId, ownerEmployeeId: next, ownershipHandoff: { source, reason: "y".repeat(500) } });
    }
    const recent = (await history(acct.accountId)).slice(-3);
    assert.deepEqual(recent.map((r) => r.source), ["DIRECT_HANDOFF", "CUSTOMER_HANDOFF_REVIEW", "ADMIN_CORRECTION"]);
    assert.ok(recent.every((r) => r.reason.length === 500));
    const raw = (event, source, reason, prev = "e-a", next = "e-b", account = acct.accountId, tenant = "t1") => q(`INSERT INTO eos_crm.account_ownership_history
      (id, tenant_id, account_id, event, previous_owner_employee_id, new_owner_employee_id, source, reason, changed_by, effective_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'p-raw', now())`, [`raw-${randomUUID()}`, tenant, account, event, prev, next, source, reason]);
    // (Initial-assignment shapes are proven on an Account with no history: the ordering trigger runs before the CHECKs.)
    const shape = (e) => e.constraint === "account_ownership_history_event_shape";
    await assert.rejects(raw("OWNER_HANDOFF", "WHIM", null), shape);
    await assert.rejects(raw("OWNER_HANDOFF", null, null), shape, "a handoff without a source");
    await assert.rejects(raw("OWNER_HANDOFF", "DIRECT_HANDOFF", null, null, "e-b"), shape, "a handoff without a predecessor");
    await assert.rejects(raw("OWNER_HANDOFF", "DIRECT_HANDOFF", null, "e-a", "e-a"), shape, "a no-op handoff");
    await assert.rejects(raw("INITIAL_OWNER_ASSIGNMENT", null, null, "e-a", "e-b", "acct-legacy-ownerless"), shape, "an initial assignment with an invented prior owner");
    await assert.rejects(raw("INITIAL_OWNER_ASSIGNMENT", "DIRECT_HANDOFF", null, null, "e-b", "acct-legacy-ownerless"), shape, "an initial assignment with a handoff source");
    await assert.rejects(raw("TRANSFER", "DIRECT_HANDOFF", null), (e) => ["account_ownership_history_event_shape", "account_ownership_history_event_vocabulary"].includes(e.constraint));
    await assert.rejects(raw("OWNER_HANDOFF", "DIRECT_HANDOFF", " padded "), (e) => e.constraint === "account_ownership_history_reason_shape");
    await assert.rejects(raw("OWNER_HANDOFF", "DIRECT_HANDOFF", "z".repeat(501)), (e) => e.constraint === "account_ownership_history_reason_shape");
    // Initial assignment may not follow any other event of the Account.
    await assert.rejects(raw("INITIAL_OWNER_ASSIGNMENT", null, null, null, "e-b"), (e) => e.constraint === "account_ownership_history_initial_assignment_first");
    // A cross-tenant history row is unrepresentable.
    await assert.rejects(raw("OWNER_HANDOFF", "DIRECT_HANDOFF", null, "e-a", "e-b", acct.accountId, "t2"), (e) => e.constraint === "account_ownership_history_account_same_tenant");
  });

  await t.test("(A7) history is append-only: UPDATE and DELETE are refused by the store", async () => {
    const [first] = await history(acct.accountId);
    await assert.rejects(q(`UPDATE eos_crm.account_ownership_history SET reason = 'rewritten' WHERE id = $1`, [first.id]), /append-only: UPDATE/);
    await assert.rejects(q(`DELETE FROM eos_crm.account_ownership_history WHERE id = $1`, [first.id]), /append-only: DELETE/);
    await assert.rejects(q(`DELETE FROM eos_crm.account_ownership_history`), /append-only: DELETE/);
    assert.deepEqual((await history(acct.accountId))[0], first);
  });

  await t.test("(A8) capability and tenancy: no handoff without customer.record.update; tenant B sees and moves nothing", async () => {
    const before = [await ownerOf(acct.accountId), (await history(acct.accountId)).length];
    const reader = { ...A1, capabilities: new Set(["customer.record.read"]) };
    const governedOnly = { ...A1, capabilities: new Set(["customer.governedField.write", "customer.record.create"]) };
    await assert.rejects(accounts.updateAccount(deps, reader, { accountId: acct.accountId, ownerEmployeeId: "e-c" }), code("CAPABILITY_REQUIRED"));
    await assert.rejects(accounts.updateAccount(deps, governedOnly, { accountId: acct.accountId, ownerEmployeeId: "e-c" }), code("CAPABILITY_REQUIRED"));
    await assert.rejects(accounts.updateAccount(deps, A2, { accountId: acct.accountId, ownerEmployeeId: "e-t2" }), code("ACCOUNT_NOT_FOUND"));
    await assert.rejects(accounts.listAccountOwnershipHistory(deps, A2, { accountId: acct.accountId }), code("ACCOUNT_NOT_FOUND"));
    await assert.rejects(accounts.listAccountOwnershipHistory(deps, { ...A1, capabilities: new Set(["customer.record.update"]) }, { accountId: acct.accountId }), code("CAPABILITY_REQUIRED"));
    await assert.rejects(accounts.updateAccount(deps, A1, { accountId: acct.accountId, ownerEmployeeId: "e-c", tenantId: "t2" }), code("CALLER_AUTHORITY_REFUSED"));
    assert.deepEqual([await ownerOf(acct.accountId), (await history(acct.accountId)).length], before);
    assert.deepEqual((await accounts.listAccountOwnershipHistory(deps, A2, { accountId: acct2.accountId })).items, []);
  });

  await t.test("(A9) INITIAL_OWNER_ASSIGNMENT: a legacy ownerless Account's first owner -- no invented predecessor, no source, the Principal as actor", async () => {
    const assigned = await accounts.updateAccount(deps, UPDATER, { accountId: "acct-remediate", ownerEmployeeId: "e-a", notes: "remediated", ownershipHandoff: { reason: "  post-cutover remediation " } });
    assert.deepEqual([assigned.ownerEmployeeId, assigned.notes, assigned.updatedBy], ["e-a", "remediated", "p-updater"]);
    const [h, ...rest] = await history("acct-remediate");
    assert.equal(rest.length, 0);
    assert.deepEqual({ event: h.event, previous: h.previous_owner_employee_id, next: h.new_owner_employee_id, source: h.source, reason: h.reason, by: h.changed_by },
      { event: "INITIAL_OWNER_ASSIGNMENT", previous: null, next: "e-a", source: null, reason: "post-cutover remediation", by: "p-updater" });
    assert.notEqual(h.changed_by, "import", "the legacy creator/assigner is never fabricated as the actor");
    const listed = await accounts.listAccountOwnershipHistory(deps, A1, { accountId: "acct-remediate" });
    assert.deepEqual(listed.items.map((i) => [i.event, i.previousOwnerEmployeeId, i.newOwnerEmployeeId, i.source, i.changedBy]),
      [["INITIAL_OWNER_ASSIGNMENT", null, "e-a", null, "p-updater"]]);
    // Without any ownershipHandoff terms: reason null.
    await accounts.updateAccount(deps, A1, { accountId: "acct-remediate-2", ownerEmployeeId: "e-c" });
    assert.deepEqual((await history("acct-remediate-2")).map((r) => [r.event, r.previous_owner_employee_id, r.source, r.reason, r.changed_by]),
      [["INITIAL_OWNER_ASSIGNMENT", null, null, null, "p-t1"]]);
  });

  await t.test("(A9b) initial assignment refusals: a source, clearing, unresolvable owners, capability and tenancy -- nothing written", async () => {
    await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, created_by, updated_by) VALUES ('acct-still-ownerless','t1','Still Ownerless','ACTIVE','import','import')`);
    const id = "acct-still-ownerless";
    for (const source of ["DIRECT_HANDOFF", "CUSTOMER_HANDOFF_REVIEW", "ADMIN_CORRECTION"]) {
      await assert.rejects(accounts.updateAccount(deps, A1, { accountId: id, ownerEmployeeId: "e-a", ownershipHandoff: { source } }), code("INITIAL_OWNER_ASSIGNMENT_SOURCE_NOT_ALLOWED"));
    }
    await assert.rejects(accounts.updateAccount(deps, A1, { accountId: id, ownerEmployeeId: "e-a", ownershipHandoff: { source: "WHIM" } }), code("HANDOFF_SOURCE_INVALID"));
    await assert.rejects(accounts.updateAccount(deps, A1, { accountId: id, ownerEmployeeId: null }), code("OWNER_REQUIRED"));
    for (const [owner, expected] of [["e-t2", "OWNER_NOT_FOUND"], ["e-nobody", "OWNER_NOT_FOUND"], ["p-t1", "OWNER_NOT_FOUND"], ["e a", "OWNER_INVALID"]]) {
      await assert.rejects(accounts.updateAccount(deps, A1, { accountId: id, ownerEmployeeId: owner, notes: "must not land" }), code(expected), owner);
    }
    await assert.rejects(accounts.updateAccount(deps, { ...A1, capabilities: new Set(["customer.record.read", "customer.record.create", "customer.governedField.write"]) }, { accountId: id, ownerEmployeeId: "e-a" }), code("CAPABILITY_REQUIRED"));
    await assert.rejects(accounts.updateAccount(deps, A2, { accountId: id, ownerEmployeeId: "e-t2" }), code("ACCOUNT_NOT_FOUND"));
    await assert.rejects(accounts.updateAccount(deps, A1, { accountId: "acct-remediate-t2", ownerEmployeeId: "e-a" }), code("ACCOUNT_NOT_FOUND"));
    assert.equal(await ownerOf(id), null);
    assert.equal(await ownerOf("acct-remediate-t2"), null);
    assert.equal(await count("account_ownership_history", "account_id IN ($1, 'acct-remediate-t2')", [id]), 0);
    assert.notEqual((await accounts.getAccount(deps, A1, { accountId: id })).notes, "must not land");
  });

  await t.test("(A9c) the chain: a handoff after the initial assignment names it as predecessor; owner -> null refused; a second initial assignment is refused by the store", async () => {
    await accounts.updateAccount(deps, A1, { accountId: "acct-remediate", ownerEmployeeId: "e-b", ownershipHandoff: { source: "ADMIN_CORRECTION", reason: "wrong rep" } });
    await accounts.updateAccount(deps, A1, { accountId: "acct-remediate", ownerEmployeeId: "e-c" });
    const rows = await history("acct-remediate");
    assert.deepEqual(rows.map((r) => [r.event, r.previous_owner_employee_id, r.new_owner_employee_id, r.source]), [
      ["INITIAL_OWNER_ASSIGNMENT", null, "e-a", null], ["OWNER_HANDOFF", "e-a", "e-b", "ADMIN_CORRECTION"], ["OWNER_HANDOFF", "e-b", "e-c", "DIRECT_HANDOFF"],
    ]);
    const listed = await accounts.listAccountOwnershipHistory(deps, A1, { accountId: "acct-remediate" });
    assert.deepEqual(listed.items.map((i) => i.event), ["OWNER_HANDOFF", "OWNER_HANDOFF", "INITIAL_OWNER_ASSIGNMENT"], "newest first");
    await assert.rejects(accounts.updateAccount(deps, A1, { accountId: "acct-remediate", ownerEmployeeId: null }), code("OWNER_REQUIRED"));
    assert.equal(await ownerOf("acct-remediate"), "e-c");
    // Even if the owner column were forced back to NULL outside the authority, a second INITIAL_OWNER_ASSIGNMENT refuses.
    await q(`UPDATE eos_crm.accounts SET owner_employee_id = NULL WHERE id = 'acct-remediate-2'`);
    await assert.rejects(accounts.updateAccount(deps, A1, { accountId: "acct-remediate-2", ownerEmployeeId: "e-a" }), code("INITIAL_OWNER_ALREADY_ASSIGNED"));
    assert.equal(await ownerOf("acct-remediate-2"), null, "the refused assignment moved the owner");
    const second = `INSERT INTO eos_crm.account_ownership_history (id, tenant_id, account_id, event, new_owner_employee_id, changed_by, effective_at)
      VALUES ('raw-second-initial', 't1', 'acct-remediate-2', 'INITIAL_OWNER_ASSIGNMENT', 'e-b', 'p-raw', now())`;
    await assert.rejects(q(second), (e) => e.constraint === "account_ownership_history_initial_assignment_first");
    // The partial unique index holds the same line on its own (ordering trigger disabled in a rolled-back transaction).
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("ALTER TABLE eos_crm.account_ownership_history DISABLE TRIGGER account_ownership_history_initial_assignment_first");
      await assert.rejects(client.query(second), (e) => e.constraint === "account_ownership_history_one_initial_assignment");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
    // The initial assignment is append-only like every event.
    const [initial] = await history("acct-remediate");
    await assert.rejects(q(`UPDATE eos_crm.account_ownership_history SET previous_owner_employee_id = 'e-z' WHERE id = $1`, [initial.id]), /append-only: UPDATE/);
    await assert.rejects(q(`DELETE FROM eos_crm.account_ownership_history WHERE id = $1`, [initial.id]), /append-only: DELETE/);
  });

  await t.test("(A9d) the chain stays in causal order even when the wall clock steps back", async () => {
    // Simulate a clock step-back: push the latest recorded event far into the future, then change the owner again.
    const [latest] = (await q(`SELECT id, effective_at FROM eos_crm.account_ownership_history WHERE account_id = 'acct-remediate' ORDER BY effective_at DESC LIMIT 1`)).rows;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("ALTER TABLE eos_crm.account_ownership_history DISABLE TRIGGER USER");
      await client.query(`UPDATE eos_crm.account_ownership_history SET effective_at = now() + interval '1 day' WHERE id = $1`, [latest.id]);
      await client.query("ALTER TABLE eos_crm.account_ownership_history ENABLE TRIGGER USER");
      await client.query("COMMIT");
    } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
    const before = await ownerOf("acct-remediate");
    const next = before === "e-a" ? "e-b" : "e-a";
    await accounts.updateAccount(deps, A1, { accountId: "acct-remediate", ownerEmployeeId: next });
    const rows = await history("acct-remediate");
    const last = rows[rows.length - 1];
    assert.deepEqual([last.previous_owner_employee_id, last.new_owner_employee_id], [before, next], "the newest event is not last in effective order");
    // Compared in SQL: a JS Date drops the microsecond that separates them.
    const strict = await q(`SELECT (SELECT effective_at FROM eos_crm.account_ownership_history WHERE id = $1) > (SELECT effective_at FROM eos_crm.account_ownership_history WHERE id = $2) AS ok`, [last.id, rows[rows.length - 2].id]);
    assert.equal(strict.rows[0].ok, true);
  });

  await t.test("(A9d) NO CASCADE on initial assignment: children of the remediated Account keep their own owner", async () => {
    await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, created_by, updated_by) VALUES ('acct-remediate-kids','t1','Kids Cafe','ACTIVE','import','import')`);
    await q(`INSERT INTO eos_crm.contacts (id, tenant_id, account_id, name, owner_employee_id, created_by, updated_by) VALUES ('con-kid','t1','acct-remediate-kids','Kid','e-c','import','import')`);
    await q(`INSERT INTO eos_crm.account_locations (id, tenant_id, account_id, name, owner_employee_id, created_by, updated_by) VALUES ('loc-kid','t1','acct-remediate-kids','Kid Site','e-c','import','import')`);
    await accounts.updateAccount(deps, A1, { accountId: "acct-remediate-kids", ownerEmployeeId: "e-a" });
    assert.equal((await q(`SELECT owner_employee_id FROM eos_crm.contacts WHERE id = 'con-kid'`)).rows[0].owner_employee_id, "e-c");
    assert.equal((await q(`SELECT owner_employee_id FROM eos_crm.account_locations WHERE id = 'loc-kid'`)).rows[0].owner_employee_id, "e-c");
  });

  await t.test("(A9e) OWNER PRECONDITION: a stale read never turns an intended first assignment into a handoff, or a handoff into anything else", async () => {
    await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, created_by, updated_by) VALUES ('acct-precond','t1','Precondition Diner','ACTIVE','import','import')`);
    // Form A and form B both read the Account as OWNERLESS. A assigns first; B's stale "first assignment" must refuse.
    await accounts.updateAccount(deps, A1, { accountId: "acct-precond", ownerEmployeeId: "e-a", expectedCurrentOwnerEmployeeId: null });
    assert.deepEqual((await history("acct-precond")).map((r) => r.event), ["INITIAL_OWNER_ASSIGNMENT"]);
    await assert.rejects(
      accounts.updateAccount(deps, A1, { accountId: "acct-precond", ownerEmployeeId: "e-b", expectedCurrentOwnerEmployeeId: null, ownershipHandoff: { reason: "first owner" } }),
      code("ACCOUNT_OWNER_CHANGED_SINCE_READ"));
    assert.deepEqual([await ownerOf("acct-precond"), (await history("acct-precond")).length], ["e-a", 1], "the stale first assignment became a handoff");
    // A stale expected OWNER refuses too; the matching one proceeds as a handoff.
    await assert.rejects(accounts.updateAccount(deps, A1, { accountId: "acct-precond", ownerEmployeeId: "e-c", expectedCurrentOwnerEmployeeId: "e-b" }), code("ACCOUNT_OWNER_CHANGED_SINCE_READ"));
    await accounts.updateAccount(deps, A1, { accountId: "acct-precond", ownerEmployeeId: "e-c", expectedCurrentOwnerEmployeeId: "e-a", ownershipHandoff: { source: "ADMIN_CORRECTION" } });
    assert.deepEqual((await history("acct-precond")).map((r) => [r.event, r.previous_owner_employee_id, r.new_owner_employee_id]),
      [["INITIAL_OWNER_ASSIGNMENT", null, "e-a"], ["OWNER_HANDOFF", "e-a", "e-c"]]);
    // A refused precondition rolls back the other fields of the same command.
    await assert.rejects(accounts.updateAccount(deps, A1, { accountId: "acct-precond", ownerEmployeeId: "e-b", expectedCurrentOwnerEmployeeId: "e-a", notes: "must not persist" }), code("ACCOUNT_OWNER_CHANGED_SINCE_READ"));
    assert.equal((await q(`SELECT notes FROM eos_crm.accounts WHERE id = 'acct-precond'`)).rows[0].notes, null);
    // Only meaningful with an owner change; still optional (omitting it keeps the unconditional behaviour).
    await assert.rejects(accounts.updateAccount(deps, A1, { accountId: "acct-precond", notes: "x", expectedCurrentOwnerEmployeeId: "e-c" }), code("OWNER_PRECONDITION_WITHOUT_OWNER_CHANGE"));
    await assert.rejects(accounts.updateAccount(deps, A1, { accountId: "acct-precond", ownerEmployeeId: "e-a", expectedCurrentOwnerEmployeeId: "not a/valid id" }), code("OWNER_INVALID"));
  });

  await t.test("(A10) atomicity: a failure after the history row rolls back the row, the owner and every other change", async () => {
    const before = [await ownerOf(acct.accountId), (await history(acct.accountId)).length];
    const broken = failingOn(pool, /updated_by = \$3, updated_at = now\(\)/);
    await assert.rejects(accounts.updateAccount({ pool: broken }, A1, { accountId: acct.accountId, ownerEmployeeId: before[0] === "e-a" ? "e-c" : "e-a", notes: "rolled back" }), code("CRM_COMMAND_FAILED"));
    assert.deepEqual([await ownerOf(acct.accountId), (await history(acct.accountId)).length], before);
    assert.notEqual((await accounts.getAccount(deps, A1, { accountId: acct.accountId })).notes, "rolled back");
  });

  await t.test("(A11) concurrent handoffs serialize on the locked Account: the history is one unbroken chain", async () => {
    const race = await accounts.createAccount(deps, A1, { idempotencyKey: K(), name: "Race Co", status: "ACTIVE", ownerEmployeeId: "e-a" });
    // Deterministic interleaving: the second handoff's transaction STARTS while the first holds the lock, and waits.
    const holder = await pool.connect();
    const racePool = new pg.Pool({ connectionString: dbUrl(), max: 4 });
    try {
      await holder.query("BEGIN");
      await holder.query(`SELECT 1 FROM eos_crm.accounts WHERE id = $1 FOR UPDATE`, [race.accountId]);
      const first = accounts.updateAccount({ pool: racePool }, A1, { accountId: race.accountId, ownerEmployeeId: "e-b" });
      await new Promise((r) => setTimeout(r, 150));
      const second = accounts.updateAccount({ pool: racePool }, A1, { accountId: race.accountId, ownerEmployeeId: "e-c" });
      await new Promise((r) => setTimeout(r, 150));
      await holder.query("COMMIT");
      await Promise.all([first, second]);
    } finally {
      holder.release();
      await racePool.end();
    }
    for (let round = 0; round < 5; round++) {
      await Promise.all(["e-a", "e-b", "e-c"].map((owner) =>
        accounts.updateAccount(deps, A1, { accountId: race.accountId, ownerEmployeeId: owner }).catch(() => null)));
    }
    // Ordered by EFFECTIVE time (what listAccountOwnershipHistory pages by), every predecessor is the previous new owner.
    const rows = await history(race.accountId);
    assert.ok(rows.length >= 2);
    assert.equal(rows[0].previous_owner_employee_id, "e-a");
    for (let n = 1; n < rows.length; n++) {
      assert.equal(rows[n].previous_owner_employee_id, rows[n - 1].new_owner_employee_id, `link ${n}: a handoff recorded a predecessor who never held the Account`);
    }
    assert.equal(await ownerOf(race.accountId), rows[rows.length - 1].new_owner_employee_id);
  });

  // ════════════════════ B. atomic Contact import ════════════════════

  const importTarget = await accounts.createAccount(deps, A1, { idempotencyKey: K(), name: "Import Co", status: "ACTIVE", ownerEmployeeId: "e-b" });
  const row = (n, extra = {}) => ({ name: `Row ${n}`, email: `row${n}@example.com`, ...extra });

  await t.test("(B1) an import writes every row, in order, with createContact's inheritance and attribution, never primary, one receipt", async () => {
    const key = K();
    const result = await contacts.importAccountContacts(deps, A1, {
      idempotencyKey: key, accountId: importTarget.accountId,
      contacts: [{ name: "  Ana  ", email: "ana@example.com", phone: "555-0100", contactRole: "Buyer" }, { name: "Bo", isPrimary: false }, { name: "Cy", email: null }],
    });
    assert.equal(result.replayed, false);
    assert.deepEqual([result.accountId, result.importedCount], [importTarget.accountId, 3]);
    assert.deepEqual(result.contacts.map((c) => [c.name, c.email, c.phone, c.contactRole, c.isPrimary, c.ownerEmployeeId, c.createdBy, c.accountId]), [
      ["Ana", "ana@example.com", "555-0100", "Buyer", false, "e-b", "p-t1", importTarget.accountId],
      ["Bo", null, null, null, false, "e-b", "p-t1", importTarget.accountId],
      ["Cy", null, null, null, false, "e-b", "p-t1", importTarget.accountId],
    ]);
    assert.ok(result.contacts.every((c) => /^cont_[0-9a-f-]{36}$/.test(c.contactId)));
    assert.equal(await count("contacts", "account_id = $1", [importTarget.accountId]), 3);
    const receipts = (await q(`SELECT operation, target_type, target_id FROM eos_crm.command_receipts WHERE idempotency_key_hash = $1`, [sha(key)])).rows;
    assert.deepEqual(receipts, [{ operation: "crm.importAccountContacts", target_type: "ACCOUNT", target_id: importTarget.accountId }]);
    assert.deepEqual((await contacts.getContact(deps, A1, { contactId: result.contacts[0].contactId })).name, "Ana");
  });

  await t.test("(B2) ONE invalid row refuses the WHOLE import with indexed findings, before the database is touched", async () => {
    const unreachable = { connect: async () => { throw new Error("the database was reached"); } };
    const input = {
      idempotencyKey: K(), accountId: importTarget.accountId,
      contacts: [row(0), { email: "no-name@example.com" }, row(2), row(3, { phone: 5551234 }), row(4, { isPrimary: true }), row(5, { accountId: acct.accountId }), row(6, { isPrimary: "yes" })],
    };
    const err = await contacts.importAccountContacts({ pool: unreachable }, A1, input).then(() => null, (e) => e);
    assert.equal(err?.code, "IMPORT_ROWS_INVALID", err?.message);
    assert.equal(err.category, "INVALID_INPUT");
    assert.deepEqual(err.findings.map((f) => [f.index, f.code]), [[1, "NAME_REQUIRED"], [3, "FIELD_INVALID"], [4, "IMPORTED_CONTACT_NEVER_PRIMARY"], [5, "FIELD_NOT_ALLOWED"], [6, "FIELD_INVALID"]]);
    const before = await count("contacts", "account_id = $1", [importTarget.accountId]);
    await assert.rejects(contacts.importAccountContacts(deps, A1, input), code("IMPORT_ROWS_INVALID"));
    assert.equal(await count("contacts", "account_id = $1", [importTarget.accountId]), before);
    assert.equal(await count("command_receipts", "idempotency_key_hash = $1", [sha(input.idempotencyKey)]), 0);
    // A row carrying authority is a forged request, refused as such.
    await assert.rejects(contacts.importAccountContacts(deps, A1, { idempotencyKey: K(), accountId: importTarget.accountId, contacts: [row(0), row(1, { tenantId: "t2" })] }), code("CALLER_AUTHORITY_REFUSED"));
  });

  await t.test("(B3) a REAL database failure on row 150 of 200 persists ZERO Contacts and no receipt; the key stays free", async () => {
    const key = K();
    const input = { idempotencyKey: key, accountId: importTarget.accountId, contacts: Array.from({ length: 200 }, (_, n) => row(n)) };
    const before = await count("contacts", "account_id = $1", [importTarget.accountId]);
    await q(`CREATE FUNCTION eos_crm.proof_explode_on_row() RETURNS trigger AS $$
             BEGIN IF NEW.name = 'Row 149' THEN RAISE EXCEPTION 'injected failure on the 150th insert'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await q(`CREATE TRIGGER proof_explode_on_row BEFORE INSERT ON eos_crm.contacts FOR EACH ROW EXECUTE FUNCTION eos_crm.proof_explode_on_row()`);
    try {
      const err = await contacts.importAccountContacts(deps, A1, input).then(() => null, (e) => e);
      assert.equal(err?.code, "CRM_COMMAND_FAILED");
      assert.doesNotMatch(`${err.message} ${JSON.stringify(err)}`, /injected|150th|proof_explode|eos_crm/);
      assert.equal(await count("contacts", "account_id = $1", [importTarget.accountId]), before, "a failed import left a partial set");
      assert.equal(await count("contacts", "name LIKE 'Row %'"), 0);
      assert.equal(await count("command_receipts", "idempotency_key_hash = $1", [sha(key)]), 0, "a failed import left a receipt");
    } finally {
      await q(`DROP TRIGGER proof_explode_on_row ON eos_crm.contacts`);
      await q(`DROP FUNCTION eos_crm.proof_explode_on_row()`);
    }
    // A late receipt failure rolls every row back too.
    await assert.rejects(contacts.importAccountContacts(failingOn(pool, /INSERT INTO eos_crm\.command_receipts/), A1, input), code("CRM_COMMAND_FAILED"));
    assert.equal(await count("contacts", "account_id = $1", [importTarget.accountId]), before);
    // The same key, retried once the failure is gone, is a first execution: exactly 200 new Contacts (the bound, accepted).
    const retried = await contacts.importAccountContacts(deps, A1, input);
    assert.deepEqual([retried.replayed, retried.importedCount], [false, 200]);
    assert.deepEqual(retried.contacts.map((c) => c.name), input.contacts.map((c) => c.name));
    assert.equal(await count("contacts", "account_id = $1", [importTarget.accountId]), before + 200);
  });

  await t.test("(B4) the bound: 1..200 rows; 201, 0 or a non-array refuses whole", async () => {
    assert.equal(contacts.MAX_CONTACT_IMPORT_ROWS, 200);
    const before = await count("contacts");
    for (const list of [Array.from({ length: 201 }, (_, n) => row(n)), [], "Row 1", { 0: row(0) }, null]) {
      await assert.rejects(contacts.importAccountContacts(deps, A1, { idempotencyKey: K(), accountId: importTarget.accountId, contacts: list }), code("IMPORT_SIZE_INVALID"));
    }
    await assert.rejects(contacts.importAccountContacts(deps, A1, { idempotencyKey: K(), accountId: importTarget.accountId }), code("IMPORT_SIZE_INVALID"));
    assert.equal(await count("contacts"), before);
  });

  await t.test("(B5) idempotency: a replay returns the recorded import; a different request under the key refuses; nothing duplicates", async () => {
    const input = { idempotencyKey: K(), accountId: importTarget.accountId, contacts: [row("r1"), row("r2")] };
    const first = await contacts.importAccountContacts(deps, A1, input);
    const before = await count("contacts", "account_id = $1", [importTarget.accountId]);
    const again = await contacts.importAccountContacts(deps, A1, structuredClone(input));
    assert.equal(again.replayed, true);
    assert.deepEqual({ ...again, replayed: false }, first);
    await assert.rejects(contacts.importAccountContacts(deps, A1, { ...input, contacts: [row("r1"), row("r3")] }), code("IDEMPOTENCY_KEY_REUSED"));
    assert.equal(await count("contacts", "account_id = $1", [importTarget.accountId]), before);
    // The key is scoped to the operation: the same key on createContact is a different key.
    assert.equal((await contacts.createContact(deps, A1, { idempotencyKey: input.idempotencyKey, accountId: importTarget.accountId, name: "Keyed" })).replayed, false);
  });

  await t.test("(B6) tenancy and capability: a foreign Account reads as absent; the create capability is required", async () => {
    const before = await count("contacts");
    await assert.rejects(contacts.importAccountContacts(deps, A2, { idempotencyKey: K(), accountId: importTarget.accountId, contacts: [row("x")] }), code("ACCOUNT_NOT_FOUND"));
    await assert.rejects(contacts.importAccountContacts(deps, A1, { idempotencyKey: K(), accountId: acct2.accountId, contacts: [row("x")] }), code("ACCOUNT_NOT_FOUND"));
    await assert.rejects(contacts.importAccountContacts(deps, A1, { idempotencyKey: K(), accountId: "acct-nowhere", contacts: [row("x")] }), code("ACCOUNT_NOT_FOUND"));
    for (const caps of [["customer.record.read"], ["customer.record.update"], ["customer.record.read", "customer.record.update", "customer.governedField.write"]]) {
      await assert.rejects(contacts.importAccountContacts(deps, { ...A1, capabilities: new Set(caps) }, { idempotencyKey: K(), accountId: importTarget.accountId, contacts: [row("x")] }), code("CAPABILITY_REQUIRED"));
    }
    await assert.rejects(contacts.importAccountContacts(deps, { ...A1, principalId: "p-t2" }, { idempotencyKey: K(), accountId: importTarget.accountId, contacts: [row("x")] }), code("ACTOR_NOT_TENANT_MEMBER"));
    assert.equal(await count("contacts"), before);
  });

  await t.test("(B7) parity with createContact: an ownerless legacy Account yields ownerless Contacts; no server duplicate rule", async () => {
    const ownerless = await contacts.importAccountContacts(deps, A1, { idempotencyKey: K(), accountId: "acct-legacy-ownerless", contacts: [row("o1")] });
    assert.equal(ownerless.contacts[0].ownerEmployeeId, (await contacts.createContact(deps, A1, { idempotencyKey: K(), accountId: "acct-legacy-ownerless", name: "Single" })).ownerEmployeeId);
    assert.equal(ownerless.contacts[0].ownerEmployeeId, null);
    // createContact accepts a same-named, same-email Contact twice; so does the import (the legacy SKIP was a client preview).
    const dup = await contacts.importAccountContacts(deps, A1, { idempotencyKey: K(), accountId: importTarget.accountId, contacts: [row("dup"), row("dup")] });
    assert.equal(dup.importedCount, 2);
    // After an Account handoff an import inherits the CURRENT owner; earlier Contacts keep theirs.
    await accounts.updateAccount(deps, A1, { accountId: importTarget.accountId, ownerEmployeeId: "e-c" });
    const later = await contacts.importAccountContacts(deps, A1, { idempotencyKey: K(), accountId: importTarget.accountId, contacts: [row("later")] });
    assert.equal(later.contacts[0].ownerEmployeeId, "e-c");
    assert.equal((await contacts.getContact(deps, A1, { contactId: dup.contacts[0].contactId })).ownerEmployeeId, "e-b");
  });

  await t.test("(C1) migration 1759924800000 refuses to roll back while handoff history or import receipts exist", async (st) => {
    const names = (await q(`SELECT name FROM public.pgmigrations ORDER BY run_on DESC, id DESC`)).rows.map((r) => r.name);
    if (names[0] !== "1759924800000_crm-account-ownership-history") {
      st.diagnostic(`skipped: ${names[0]} is the last-run migration, so down 1 would not reach 1759924800000`);
      return;
    }
    const down = spawnSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "down", "1", "--migrations-dir", "migrations"],
      { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrl() }, encoding: "utf8" });
    assert.notEqual(down.status, 0);
    assert.match(down.stdout + down.stderr, /refuses to drop CRM Account ownership history or Contact import receipts/);
    assert.ok((await q(`SELECT to_regclass('eos_crm.account_ownership_history') AS t`)).rows[0].t);
  });
});
