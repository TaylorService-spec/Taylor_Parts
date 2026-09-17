// The CRM Render transport against a real postgres:16: bearer -> injected verifier -> resolveOperationalContext
// (Principal, membership, Role assignment, role_capabilities) -> CRM actor -> governed CRM authority -> HTTP response.
// Its own database, migrated by the normal runner. Roles and grants exist ONLY in this disposable database.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const http = require("../lib/eosCrm/crmHttp.js");
const { eosApiDomainFor } = require("../lib/eosApi/server.js");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
const { CRM_WRITER_AUTHORITY } = require("../lib/crm/crmWriterState.js");
const { readFileSync } = require("node:fs");
// The end-to-end proof runs the transport as it will behave AFTER ACTIVATE_POSTGRES. The committed state is proven below.
const ACTIVE = Object.freeze({ firestore: "FROZEN", postgres: "ACTIVE" });

const RECORD = ["customer.record.read", "customer.record.create", "customer.record.update"];

test("offline: the CRM transport is a closed, authenticated envelope routed by server.ts", async () => {
  assert.deepEqual([...http.CRM_OPERATIONS].sort(), [
    "createAccount", "createAccountLocation", "createContact", "getAccount", "getAccountLocation", "getContact",
    "importAccountContacts", "listAccountContacts", "listAccountLocations", "listAccountOwnershipHistory", "listAccounts",
    "updateAccount", "updateAccountLocation", "updateContact",
  ]);
  assert.equal(http.CRM_OPERATIONS.length, 14);
  for (const name of ["deleteAccount", "runSQL", "assignAccountOwner", "toString", "__proto__", "constructor"]) assert.equal(http.isCrmOperation(name), false, name);
  assert.deepEqual([eosApiDomainFor("/crm/customer"), eosApiDomainFor("/crm/customer?x=1"), eosApiDomainFor("/commercial/sales"), eosApiDomainFor("/crmcustomer")],
    ["crm", "crm", "commercial", "administration"]);
  const never = { reader: null, pool: null, verifyToken: async () => { throw new Error("no"); }, allowedOrigins: ["https://eos.example"] };
  const req = (over) => http.handleCrmRequest(never, { method: "POST", url: "/crm/customer", headers: {}, ...over });
  assert.equal((await req({ body: JSON.stringify({ operation: "deleteAccount", input: {} }) })).status, 404);
  assert.equal((await req({ method: "GET" })).status, 405);
  assert.equal((await req({ url: "/crm/accounts", body: "{}" })).status, 404);
  assert.equal((await req({ body: "not json" })).status, 400);
  assert.equal((await req({ body: JSON.stringify({ operation: "getAccount", input: { accountId: "a" }, tenantId: "t2" }) })).status, 400);
  const stated = await req({ body: JSON.stringify({ operation: "createAccount", input: { tenantId: "t2" } }) });
  assert.equal(JSON.parse(stated.body).code, "AUTHORITY_FIELD_NOT_ACCEPTED");
  assert.equal((await req({ body: JSON.stringify({ operation: "getAccount", input: { accountId: "a" } }) })).status, 401);
  assert.equal((await req({ headers: { authorization: "Bearer bad" }, body: JSON.stringify({ operation: "getAccount", input: { accountId: "a" } }) })).status, 401);
  const pre = await http.handleCrmRequest(never, { method: "OPTIONS", url: "/crm/customer", headers: { origin: "https://eos.example" } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers["access-control-allow-origin"], "https://eos.example");
  const other = await http.handleCrmRequest(never, { method: "OPTIONS", url: "/crm/customer", headers: { origin: "https://evil.example" } });
  assert.equal(other.headers["access-control-allow-origin"], undefined);
  // THE ACTIVATION GATE: while the committed CRM writer authority is PostgreSQL INACTIVE, an authenticated caller is
  // refused 503 before the caller context is resolved or any table is read -- reader and pool here would throw.
  assert.equal(CRM_WRITER_AUTHORITY.postgres, "INACTIVE", "PostgreSQL CRM was activated: replace this gate proof with the activation evidence");
  const authenticated = { reader: null, pool: null, verifyToken: async () => ({ externalSubject: "s", identityProvider: "firebase" }), allowedOrigins: [] };
  let gated = 0;
  for (const operation of http.CRM_OPERATIONS) {
    gated++;
    const res = await http.handleCrmRequest(authenticated, { method: "POST", url: "/crm/customer", headers: { authorization: "Bearer ok" }, body: JSON.stringify({ operation, input: {} }) });
    assert.deepEqual([res.status, JSON.parse(res.body).code], [503, "POSTGRES_CRM_WRITER_INACTIVE"], operation);
  }
  assert.equal(gated, 14, "every CRM operation, including the ownership history read and the Contact import, is behind the gate");
  // Composition never supplies the test seam: the committed constant decides in the running API.
  assert.doesNotMatch(readFileSync(resolve(FUNCTIONS_DIR, "src/eosApi/server.ts"), "utf8"), /writerAuthority/);
  // No Firebase module loads with the transport.
  const probe = spawnSync(process.execPath, ["-e", `const M=require("module");const l=M._load;M._load=function(r,...a){if(/firebase/i.test(r)){process.exit(97)}return l.call(this,r,...a)};require("./lib/eosCrm/crmHttp.js")`], { cwd: FUNCTIONS_DIR });
  assert.equal(probe.status, 0, "the CRM transport loaded a Firebase module");
});

test("CRM transport end to end, in PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `crm_http_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const url = (() => { const u = new URL(URL_BASE); u.pathname = `/${name}`; return u.toString(); })();
  const admin = new pg.Client({ connectionString: URL_BASE });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  const pool = new pg.Pool({ connectionString: url, max: 6 });
  t.after(async () => {
    await pool.end();
    const c = new pg.Client({ connectionString: URL_BASE });
    await c.connect();
    await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await c.end();
  });
  const q = (text, values = []) => pool.query(text, values);
  const repo = new PostgresPolicyRepository(pool);
  const TOKENS = new Map();
  const deps = { reader: repo, pool, writerAuthority: ACTIVE, verifyToken: async (token) => { const s = TOKENS.get(token); if (!s) throw new Error("bad"); return { externalSubject: s, identityProvider: "firebase" }; }, allowedOrigins: [] };

  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1'), ('t2','t2','T2')`);
  await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id) VALUES ('e-1','t1','ACTIVE','taylor'), ('e-1b','t1','ACTIVE','taylor'), ('e-2','t2','ACTIVE','taylor')`);
  const actorFor = (tenantId) => ({ tenantId, uid: "uid-fixture-admin" });
  const makeActor = async (tenantId, subject, keys) => {
    const principalId = await repo.transact(actorFor(tenantId), async (tx) => {
      const principal = await tx.createPrincipal({ externalSubject: subject, identityProvider: "firebase" });
      await tx.createTenantMembership(principal.id);
      return principal.id;
    });
    if (keys.length) {
      const role = await repo.transact(actorFor(tenantId), (tx) => tx.createRole({ key: `role-${subject}`, name: subject, description: null, origin: "CUSTOM", protected: false }));
      for (const key of keys) {
        await q(`INSERT INTO eos_policy.role_capabilities (id, tenant_id, role_id, capability_id, granted_by, created_by, updated_by)
                 SELECT $1, $2, $3, c.id, 'fixture', 'fixture', 'fixture' FROM eos_policy.capabilities c WHERE c.key = $4`, [`rc_${role.id}_${key}`, tenantId, role.id, key]);
      }
      await repo.transact(actorFor(tenantId), async (tx) => {
        const accessVersion = await tx.bumpAccessVersion(principalId);
        return tx.createAssignment({ principalId, roleId: role.id, scopeType: "global", scopeValue: null, status: "active", grantedBy: "fixture", grantedAt: new Date().toISOString(), accessVersionAtGrant: accessVersion });
      });
    }
    TOKENS.set(`tok-${subject}`, subject);
    return { principalId, token: `tok-${subject}`, subject };
  };
  const editor = await makeActor("t1", "fb-editor", RECORD);
  const governed = await makeActor("t1", "fb-governed", [...RECORD, "customer.governedField.write"]);
  const reader = await makeActor("t1", "fb-reader", ["customer.record.read"]);
  const other = await makeActor("t2", "fb-t2", RECORD);

  const call = async (actor, operation, input, headers = {}) => {
    const res = await http.handleCrmRequest(deps, { method: "POST", url: "/crm/customer", headers: { authorization: `Bearer ${actor.token}`, ...headers }, body: JSON.stringify({ operation, input }) });
    return { status: res.status, body: JSON.parse(res.body) };
  };
  const key = () => `k-${randomUUID()}`;

  let account;
  let contact;
  let site;
  await t.test("(1)(2)(5)(12) authenticated create/read/update Account resolves the EOS Principal; creates replay; reads return stored PostgreSQL data", async () => {
    const input = { idempotencyKey: key(), ownerEmployeeId: "e-1", name: "Transport Co", status: "ACTIVE", tags: ["VIP"] };
    const created = await call(editor, "createAccount", input);
    assert.equal(created.status, 200, JSON.stringify(created.body));
    account = created.body.result;
    assert.equal(account.createdBy, editor.principalId);
    assert.notEqual(account.createdBy, editor.subject, "the Firebase subject was used as attribution");
    const replay = await call(editor, "createAccount", input);
    assert.deepEqual([replay.status, replay.body.result.replayed, replay.body.result.accountId], [200, true, account.accountId]);
    const updated = await call(editor, "updateAccount", { accountId: account.accountId, notes: "Back gate" });
    assert.equal(updated.body.result.notes, "Back gate");
    const read = await call(reader, "getAccount", { accountId: account.accountId });
    assert.deepEqual([read.status, read.body.result.notes, read.body.result.tags], [200, "Back gate", ["VIP"]]);
    const listed = await call(reader, "listAccounts", { nameStartsWith: "transport" });
    assert.deepEqual(listed.body.result.items.map((a) => a.accountId), [account.accountId]);
  });

  await t.test("(3)(4) Contact and Location create/read/update through the transport", async () => {
    contact = (await call(editor, "createContact", { idempotencyKey: key(), accountId: account.accountId, name: "Ana" })).body.result;
    assert.equal(contact.ownerEmployeeId, "e-1");
    assert.equal((await call(editor, "updateContact", { contactId: contact.contactId, phone: "555-0100" })).body.result.phone, "555-0100");
    assert.equal((await call(reader, "getContact", { contactId: contact.contactId })).body.result.phone, "555-0100");
    assert.equal((await call(reader, "listAccountContacts", { accountId: account.accountId })).body.result.items.length, 1);
    site = (await call(editor, "createAccountLocation", { idempotencyKey: key(), accountId: account.accountId, name: "Main", addressCity: "Austin" })).body.result;
    assert.equal((await call(editor, "updateAccountLocation", { accountLocationId: site.accountLocationId, accessNotes: "Dock 2" })).body.result.accessNotes, "Dock 2");
    assert.equal((await call(reader, "getAccountLocation", { accountLocationId: site.accountLocationId })).body.result.addressCity, "Austin");
    assert.equal((await call(reader, "listAccountLocations", { accountId: account.accountId })).body.result.items.length, 1);
  });

  await t.test("(6)(8) owner required; governed fields need customer.governedField.write; write never implied by read", async () => {
    const noOwner = await call(editor, "createAccount", { idempotencyKey: key(), name: "No Owner", status: "ACTIVE" });
    assert.deepEqual([noOwner.status, noOwner.body.code], [400, "OWNER_REQUIRED"]);
    const terms = await call(editor, "updateAccount", { accountId: account.accountId, paymentTerms: "NET_30" });
    assert.deepEqual([terms.status, terms.body.code], [403, "CAPABILITY_REQUIRED"]);
    assert.equal((await call(governed, "updateAccount", { accountId: account.accountId, paymentTerms: "NET_30" })).body.result.paymentTerms, "NET_30");
    const readerWrite = await call(reader, "updateAccount", { accountId: account.accountId, name: "Nope" });
    assert.deepEqual([readerWrite.status, readerWrite.body.code], [403, "CAPABILITY_REQUIRED"]);
  });

  await t.test("(7) cross-tenant: tenant B cannot read or mutate tenant A; a foreign x-eos-tenant refuses", async () => {
    assert.equal((await call(other, "getAccount", { accountId: account.accountId })).status, 404);
    assert.equal((await call(other, "updateContact", { contactId: contact.contactId, name: "X" })).status, 404);
    assert.equal((await call(other, "createAccountLocation", { idempotencyKey: key(), accountId: account.accountId, name: "X" })).status, 404);
    const foreign = await call(editor, "getAccount", { accountId: account.accountId }, { "x-eos-tenant": "t2" });
    assert.equal(foreign.status, 403);
    const unknown = await http.handleCrmRequest({ ...deps, verifyToken: async () => ({ externalSubject: "never-registered", identityProvider: "firebase" }) },
      { method: "POST", url: "/crm/customer", headers: { authorization: "Bearer x" }, body: JSON.stringify({ operation: "getAccount", input: { accountId: account.accountId } }) });
    assert.equal(unknown.status, 403);
  });
  await t.test("(9) Account ownership handoff and the atomic Contact import through the transport", async () => {
    const handed = await call(editor, "updateAccount", { accountId: account.accountId, ownerEmployeeId: "e-1b", ownershipHandoff: { reason: "coverage" } });
    assert.equal(handed.status, 200, JSON.stringify(handed.body));
    assert.equal(handed.body.result.ownerEmployeeId, "e-1b");
    const history = await call(reader, "listAccountOwnershipHistory", { accountId: account.accountId });
    assert.equal(history.status, 200);
    assert.deepEqual(history.body.result.items.map((h) => [h.event, h.previousOwnerEmployeeId, h.newOwnerEmployeeId, h.source, h.reason, h.changedBy]),
      [["OWNER_HANDOFF", "e-1", "e-1b", "DIRECT_HANDOFF", "coverage", editor.principalId]]);
    // A legacy ownerless Account's first owner: INITIAL_OWNER_ASSIGNMENT; a handoff source on it refuses 400.
    await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, created_by, updated_by) VALUES ('acct-http-ownerless','t1','Ownerless','ACTIVE','import','import')`);
    const withSource = await call(editor, "updateAccount", { accountId: "acct-http-ownerless", ownerEmployeeId: "e-1", ownershipHandoff: { source: "DIRECT_HANDOFF" } });
    assert.deepEqual([withSource.status, withSource.body.code], [400, "INITIAL_OWNER_ASSIGNMENT_SOURCE_NOT_ALLOWED"]);
    const initial = await call(editor, "updateAccount", { accountId: "acct-http-ownerless", ownerEmployeeId: "e-1" });
    assert.deepEqual([initial.status, initial.body.result.ownerEmployeeId], [200, "e-1"]);
    const first = await call(reader, "listAccountOwnershipHistory", { accountId: "acct-http-ownerless" });
    assert.deepEqual(first.body.result.items.map((h) => [h.event, h.previousOwnerEmployeeId, h.newOwnerEmployeeId, h.source, h.changedBy]),
      [["INITIAL_OWNER_ASSIGNMENT", null, "e-1", null, editor.principalId]]);
    assert.equal((await call(other, "listAccountOwnershipHistory", { accountId: account.accountId })).status, 404);
    const cleared = await call(editor, "updateAccount", { accountId: account.accountId, ownerEmployeeId: null });
    assert.deepEqual([cleared.status, cleared.body.code], [400, "OWNER_REQUIRED"]);
    assert.deepEqual([(await call(reader, "updateAccount", { accountId: account.accountId, ownerEmployeeId: "e-1" })).status], [403]);

    const input = { idempotencyKey: key(), accountId: account.accountId, contacts: [{ name: "Imp One", email: "one@example.com" }, { name: "Imp Two" }] };
    const imported = await call(editor, "importAccountContacts", input);
    assert.equal(imported.status, 200, JSON.stringify(imported.body));
    assert.deepEqual(imported.body.result.contacts.map((c) => [c.name, c.ownerEmployeeId, c.isPrimary, c.createdBy]),
      [["Imp One", "e-1b", false, editor.principalId], ["Imp Two", "e-1b", false, editor.principalId]]);
    assert.equal((await call(editor, "importAccountContacts", input)).body.result.replayed, true);
    const refused = await call(editor, "importAccountContacts", { idempotencyKey: key(), accountId: account.accountId, contacts: [{ name: "Fine" }, { name: "" }, { name: "Boss", isPrimary: true }] });
    assert.deepEqual([refused.status, refused.body.code], [400, "IMPORT_ROWS_INVALID"]);
    assert.deepEqual(refused.body.findings.map((f) => [f.index, f.code]), [[1, "NAME_REQUIRED"], [2, "IMPORTED_CONTACT_NEVER_PRIMARY"]]);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_crm.contacts WHERE name IN ('Fine', 'Boss')`)).rows[0].n, 0);
    assert.equal((await call(reader, "importAccountContacts", { idempotencyKey: key(), accountId: account.accountId, contacts: [{ name: "X" }] })).status, 403);
    assert.equal((await call(other, "importAccountContacts", { idempotencyKey: key(), accountId: account.accountId, contacts: [{ name: "X" }] })).status, 404);
  });

  await t.test("committed state: with the real database and a fully capable caller, nothing is read or written while INACTIVE", async () => {
    const committed = { ...deps, writerAuthority: undefined };
    const before = (await q(`SELECT (SELECT count(*) FROM eos_crm.accounts)::int a, (SELECT count(*) FROM eos_crm.contacts)::int c, (SELECT count(*) FROM eos_policy.audit_events)::int e`)).rows[0];
    const res = await http.handleCrmRequest(committed, { method: "POST", url: "/crm/customer", headers: { authorization: `Bearer ${editor.token}` },
      body: JSON.stringify({ operation: "createAccount", input: { idempotencyKey: key(), ownerEmployeeId: "e-1", name: "Too Early", status: "ACTIVE" } }) });
    assert.deepEqual([res.status, JSON.parse(res.body).code], [503, "POSTGRES_CRM_WRITER_INACTIVE"]);
    const read = await http.handleCrmRequest(committed, { method: "POST", url: "/crm/customer", headers: { authorization: `Bearer ${reader.token}` },
      body: JSON.stringify({ operation: "getAccount", input: { accountId: account.accountId } }) });
    assert.equal(read.status, 503, "an un-activated PostgreSQL CRM answered a read");
    const after = (await q(`SELECT (SELECT count(*) FROM eos_crm.accounts)::int a, (SELECT count(*) FROM eos_crm.contacts)::int c, (SELECT count(*) FROM eos_policy.audit_events)::int e`)).rows[0];
    assert.deepEqual(after, before);
  });
});
