// WAVE C4 against a real postgres:16 -- the Commercial HTTP transport end to end, and migration 023.
//
// Each suite uses its OWN database, migrated by the normal runner. The full trusted path is exercised through the pure
// request handler: bearer -> injected verifier -> resolveOperationalContext (Principal, membership, Role assignment,
// role_capabilities) -> Commercial actor -> C2 command / C3 read -> HTTP response. Roles and grants below exist ONLY in
// these disposable databases.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const http = require("../lib/eosCommercial/commercialHttp.js");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");

const COMMERCIAL_KEYS = ["opportunity.write", "opportunity.read", "opportunity.createSalesOrder", "salesAgreement.create", "salesAgreement.updateDraft",
  "salesAgreement.accept", "salesAgreement.read", "salesOrder.write", "salesOrder.read"];
const WRITE_KEYS = ["opportunity.write", "opportunity.createSalesOrder", "salesAgreement.create", "salesAgreement.updateDraft", "salesAgreement.accept", "salesOrder.write"];
const READ_KEYS = ["opportunity.read", "salesAgreement.read", "salesOrder.read"];

const dbUrlFor = (name) => {
  const u = new URL(URL_BASE);
  u.pathname = `/${name}`;
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
const migrator = (url) => (...args) => execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", ...args, "--migrations-dir", "migrations"], {
  cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
});
/** A disposable database. `beforeDrop` (e.g. ending a pool) runs in the SAME teardown hook, before the drop. */
async function freshDatabase(t, prefix, beforeDrop = async () => {}) {
  const name = `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await beforeDrop();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  return dbUrlFor(name);
}

test("migration 023: Commercial capability vocabulary, no grants, and a down that refuses to destroy grants", { skip: SKIP, concurrency: 1 }, async (t) => {
  const url = await freshDatabase(t, "c4_vocab");
  const run = migrator(url);
  run("up");
  const q = (text, values = []) => withClient(url, (c) => c.query(text, values));
  const commercialKeys = async () => (await q(`SELECT id, key FROM eos_policy.capabilities WHERE key ~ '^(opportunity|salesAgreement|salesOrder)\\.' ORDER BY key`)).rows;
  const latest = async () => (await q(`SELECT name FROM public.pgmigrations ORDER BY run_on DESC, id DESC LIMIT 1`)).rows[0].name;

  await t.test("(25)(26) up registers exactly the nine keys and creates zero grants", async () => {
    assert.equal(await latest(), "1759536000000_commercial-capability-vocabulary");
    const rows = await commercialKeys();
    assert.deepEqual(rows.map((r) => r.key), [...COMMERCIAL_KEYS].sort());
    for (const r of rows) assert.equal(r.id, `cap_${r.key.replace(/\./g, "_")}`);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.capabilities WHERE key IN ('salesOrder.fulfill','salesOrder.service')`)).rows[0].n, 0, "D2 vocabulary was registered");
    assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.role_capabilities`)).rows[0].n, 0, "migration 023 (or any migration) created a Role grant");
    assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.capabilities WHERE origin <> 'SYSTEM' AND key ~ '^(opportunity|salesAgreement|salesOrder)\\.'`)).rows[0].n, 0);
  });

  await t.test("rerunning up is a no-op under the migration framework", async () => {
    run("up");
    assert.equal((await commercialKeys()).length, 9);
  });

  await t.test("(48) down REFUSES while a Role grant references the vocabulary, and destroys nothing", async () => {
    await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t-v','t-v','TV')`);
    await q(`INSERT INTO eos_policy.roles (id, tenant_id, key, name, origin, protected, created_by, updated_by) VALUES ('r-v','t-v','sales','Sales','CUSTOM',false,'x','x')`);
    await q(`INSERT INTO eos_policy.role_capabilities (id, tenant_id, role_id, capability_id, granted_by, created_by, updated_by) VALUES ('rc-v','t-v','r-v','cap_opportunity_read','x','x','x')`);
    assert.throws(() => run("down", "1"), (err) => /migration 023 refuses to remove the Commercial capability vocabulary: 1 Role grant/.test(String(err.stderr)));
    assert.equal(await latest(), "1759536000000_commercial-capability-vocabulary");
    assert.equal((await commercialKeys()).length, 9);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.role_capabilities WHERE id='rc-v'`)).rows[0].n, 1, "the rollback destroyed a grant");
  });

  await t.test("(49) once the grant is withdrawn, down removes exactly the nine and up restores them", async () => {
    await q(`DELETE FROM eos_policy.role_capabilities WHERE id='rc-v'`);
    const others = (await q(`SELECT count(*)::int n FROM eos_policy.capabilities`)).rows[0].n - 9;
    run("down", "1");
    assert.equal(await latest(), "1759449600000_commercial-schema-parity-numbering-receipts");
    assert.deepEqual(await commercialKeys(), []);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.capabilities`)).rows[0].n, others, "the rollback removed other vocabulary");
    run("up");
    assert.equal((await commercialKeys()).length, 9);
  });
});

test("Commercial transport end to end over the real policy and Commercial authorities", { skip: SKIP, concurrency: 1 }, async (t) => {
  let pool;
  const url = await freshDatabase(t, "c4_transport", () => pool?.end());
  migrator(url)("up");
  pool = new pg.Pool({ connectionString: url, max: 8 });
  const q = (text, values = []) => pool.query(text, values);
  const repo = new PostgresPolicyRepository(pool);

  // Every statement the transport's pool sees, for the "PostgreSQL authorities only" proof.
  const statements = [];
  const spyPool = new Proxy(pool, {
    get(target, prop) {
      if (prop === "query") return (text, values) => { statements.push(String(text?.text ?? text)); return target.query(text, values); };
      if (prop === "connect") {
        return async () => {
          const client = await target.connect();
          return new Proxy(client, { get(c, p) { if (p === "query") return (text, values) => { statements.push(String(text?.text ?? text)); return c.query(text, values); }; const v = c[p]; return typeof v === "function" ? v.bind(c) : v; } });
        };
      }
      const v = target[prop];
      return typeof v === "function" ? v.bind(target) : v;
    },
  });

  // ── identity: tokens map to EXTERNAL subjects; EOS Principal ids are generated and never equal them ──
  const TOKENS = new Map();
  const verifyToken = async (token) => {
    const subject = TOKENS.get(token);
    if (!subject) throw new Error("invalid token");
    return { externalSubject: subject, identityProvider: "firebase" };
  };
  const bare = { reader: repo, pool: spyPool, verifyToken, allowedOrigins: [] };
  const catalog = { async verifyReferences(_db, _t, refs) { return refs.map(() => "FOUND"); } };
  const withCatalog = { ...bare, catalog }; // TEST-ONLY governed catalog authority

  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1'), ('t2','t2','T2')`);
  assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.role_capabilities`)).rows[0].n, 0, "the migrated database already carried grants");
  const actorFor = (tenantId) => ({ tenantId, uid: "uid-fixture-admin" });
  const makeActor = async (tenantId, subject, keys) => {
    const principalId = await repo.transact(actorFor(tenantId), async (tx) => {
      const principal = await tx.createPrincipal({ externalSubject: subject, identityProvider: "firebase" });
      await tx.createTenantMembership(principal.id);
      return principal.id;
    });
    if (keys.length > 0) {
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
    const token = `tok-${subject}`;
    TOKENS.set(token, subject);
    return { principalId, token, subject };
  };

  const writer = await makeActor("t1", "firebase-uid-writer", WRITE_KEYS);
  const reader = await makeActor("t1", "firebase-uid-reader", READ_KEYS);
  const partialReader = await makeActor("t1", "firebase-uid-partial", ["opportunity.read", "salesOrder.read"]);
  const nobody = await makeActor("t1", "firebase-uid-nobody", []);
  const t2 = await makeActor("t2", "firebase-uid-t2", [...WRITE_KEYS, ...READ_KEYS]);
  assert.notEqual(writer.principalId, writer.subject);

  await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, owner_employee_id, created_by, updated_by) VALUES
    ('acct-1','t1','Retail Customer','ACTIVE','e-retail','x','x'), ('acct-t2','t2','Other Tenant','ACTIVE','e-t2','x','x')`);
  await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id) VALUES
    ('e-retail','t1','ACTIVE','taylor'), ('e-national','t1','ACTIVE','taylor'), ('e-gm','t1','ACTIVE','taylor'), ('e-t2','t2','ACTIVE','taylor')`);

  const call = async (deps, actor, operation, input, headers = {}) => {
    const res = await http.handleCommercialRequest(deps, {
      method: "POST", url: "/commercial/sales", headers: { authorization: `Bearer ${actor.token}`, ...headers },
      body: JSON.stringify(input === undefined ? { operation } : { operation, input }),
    });
    return { status: res.status, body: JSON.parse(res.body) };
  };
  const key = () => `k-${randomUUID()}`;
  const receipts = async () => (await q(`SELECT count(*)::int n FROM eos_commercial.command_receipts`)).rows[0].n;
  const SERVICE_OPP = { accountId: "acct-1", salesChannel: "RETAIL", operatingCompanyId: "taylor", need: "Service contract", lines: [{ kind: "SERVICE", ref: "svc-pm", qty: 1 }] };

  let opp;
  await t.test("(29)(9)(43) a write grant creates a SERVICE-only Opportunity through HTTP, attributed to the EOS Principal, with one receipt", async () => {
    const res = await call(bare, writer, "createOpportunity", { idempotencyKey: key(), ...SERVICE_OPP });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual([res.body.ok, res.body.operation, res.body.result.replayed], [true, "createOpportunity", false]);
    opp = res.body.result;
    const row = (await q(`SELECT created_by, tenant_id FROM eos_commercial.opportunities WHERE id=$1`, [opp.opportunityId])).rows[0];
    assert.deepEqual(row, { created_by: writer.principalId, tenant_id: "t1" }, "the domain was handed something other than the EOS Principal");
    const receipt = (await q(`SELECT principal_id FROM eos_commercial.command_receipts WHERE target_id=$1`, [opp.opportunityId])).rows;
    assert.deepEqual(receipt, [{ principal_id: writer.principalId }]);
  });

  await t.test("(31)(32) the same idempotency key replays through HTTP: one mutation, one receipt", async () => {
    const k = key();
    const first = await call(bare, writer, "createOpportunity", { idempotencyKey: k, ...SERVICE_OPP, need: "Replay me" });
    const before = await receipts();
    const again = await call(bare, writer, "createOpportunity", { idempotencyKey: k, ...SERVICE_OPP, need: "Replay me" });
    assert.deepEqual([first.status, again.status, again.body.result.replayed], [200, 200, true]);
    assert.equal(again.body.result.opportunityId, first.body.result.opportunityId);
    assert.equal(await receipts(), before);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_commercial.opportunities WHERE need='Replay me'`)).rows[0].n, 1);
  });

  await t.test("(27)(42) a read grant reads the PostgreSQL projection; reads write no receipt", async () => {
    const before = await receipts();
    const res = await call(bare, reader, "getOpportunityDetail", { opportunityId: opp.opportunityId });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual([res.body.result.id, res.body.result.opportunityNumber, res.body.result.accountName, res.body.result.lines.length], [opp.opportunityId, opp.opportunityNumber, "Retail Customer", 1]);
    const list = await call(bare, reader, "listOpportunities");
    assert.equal(list.status, 200);
    assert.ok(list.body.result.items.some((i) => i.id === opp.opportunityId));
    assert.equal(await receipts(), before, "a read wrote a command receipt");
  });

  await t.test("(28)(30) capabilities are required per operation: no read grant, no write grant, and write never implies read", async () => {
    for (const [actor, operation, input] of [[nobody, "getOpportunityDetail", { opportunityId: opp.opportunityId }], [writer, "listOpportunities", undefined],
      [reader, "createOpportunity", { idempotencyKey: key(), ...SERVICE_OPP }], [nobody, "createOpportunity", { idempotencyKey: key(), ...SERVICE_OPP }]]) {
      const res = await call(bare, actor, operation, input);
      assert.deepEqual([res.status, res.body.code], [403, "CAPABILITY_REQUIRED"], `${actor.subject} ${operation}`);
    }
  });

  await t.test("(33)(34)(10)(11) tenancy: a foreign x-eos-tenant refuses; tenant B cannot read tenant A; a body tenantId refuses", async () => {
    const foreign = await call(bare, reader, "getOpportunityDetail", { opportunityId: opp.opportunityId }, { "x-eos-tenant": "t2" });
    assert.deepEqual([foreign.status, foreign.body.code, foreign.body.message], [403, "FORBIDDEN", "TENANT_NOT_A_MEMBERSHIP"]);
    const crossTenant = await call(bare, t2, "getOpportunityDetail", { opportunityId: opp.opportunityId });
    assert.deepEqual([crossTenant.status, crossTenant.body.code], [404, "RECORD_NOT_FOUND"]);
    const bodyTenant = await call(bare, t2, "getOpportunityDetail", { opportunityId: opp.opportunityId, tenantId: "t1" });
    assert.deepEqual([bodyTenant.status, bodyTenant.body.code], [400, "AUTHORITY_FIELD_NOT_ACCEPTED"]);
    const before = (await q(`SELECT count(*)::int n FROM eos_commercial.opportunities WHERE tenant_id='t1'`)).rows[0].n;
    const bodyPrincipal = await call(bare, t2, "createOpportunity", { idempotencyKey: key(), ...SERVICE_OPP, tenantId: "t1", principalId: writer.principalId });
    assert.equal(bodyPrincipal.status, 400);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_commercial.opportunities WHERE tenant_id='t1'`)).rows[0].n, before);
    const disabled = await call(bare, { token: "tok-unknown-subject" }, "listOpportunities");
    assert.equal(disabled.status, 401);
    TOKENS.set("tok-unregistered", "firebase-uid-never-provisioned");
    const unknown = await call(bare, { token: "tok-unregistered" }, "listOpportunities");
    assert.deepEqual([unknown.status, unknown.body.message], [403, "UNKNOWN_PRINCIPAL"]);
  });

  await t.test("(38)(39) an owner handoff through HTTP writes governed ownership history and leaves the Accountable Person alone", async () => {
    const before = (await q(`SELECT owner_employee_id, accountable_employee_id, edit_version FROM eos_commercial.opportunities WHERE id=$1`, [opp.opportunityId])).rows[0];
    const res = await call(bare, writer, "updateOpportunity", { idempotencyKey: key(), opportunityId: opp.opportunityId, expectedEditVersion: Number(before.edit_version), ownerEmployeeId: "e-national", ownershipHandoff: { reason: "territory" } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const after = (await q(`SELECT owner_employee_id, accountable_employee_id FROM eos_commercial.opportunities WHERE id=$1`, [opp.opportunityId])).rows[0];
    assert.deepEqual(after, { owner_employee_id: "e-national", accountable_employee_id: before.accountable_employee_id });
    const history = (await q(`SELECT previous_owner_employee_id, new_owner_employee_id, recorded_by FROM eos_commercial.ownership_handoffs WHERE opportunity_id=$1`, [opp.opportunityId])).rows;
    assert.deepEqual(history, [{ previous_owner_employee_id: before.owner_employee_id, new_owner_employee_id: "e-national", recorded_by: writer.principalId }]);
    const stale = await call(bare, writer, "updateOpportunity", { idempotencyKey: key(), opportunityId: opp.opportunityId, expectedEditVersion: Number(before.edit_version), need: "stale" });
    assert.deepEqual([stale.status, stale.body.code], [409, "VERSION_CONFLICT"]);
  });

  let agreement;
  await t.test("(36) Agreement create and accept reach C2 through the transport; a second accept is 412, a second Agreement 409", async () => {
    const created = await call(bare, writer, "createSalesAgreement", { idempotencyKey: key(), opportunityId: opp.opportunityId, ownerEmployeeId: "e-retail",
      lines: [{ kind: "SERVICE", ref: "svc-pm", quantity: 1, unitPrice: 90000, businessUnitId: "SERVICE" }] });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    agreement = created.body.result;
    const accepted = await call(bare, writer, "acceptSalesAgreement", { idempotencyKey: key(), salesAgreementId: agreement.salesAgreementId });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    assert.equal(accepted.body.result.acceptedBy, writer.principalId);
    assert.equal((await q(`SELECT accepted_by FROM eos_commercial.sales_agreements WHERE id=$1`, [agreement.salesAgreementId])).rows[0].accepted_by, writer.principalId);
    const again = await call(bare, writer, "acceptSalesAgreement", { idempotencyKey: key(), salesAgreementId: agreement.salesAgreementId });
    assert.equal(again.status, 412, JSON.stringify(again.body));
    const second = await call(bare, writer, "createSalesAgreement", { idempotencyKey: key(), opportunityId: opp.opportunityId, ownerEmployeeId: "e-retail",
      lines: [{ kind: "SERVICE", ref: "svc-pm", quantity: 1, unitPrice: 90000, businessUnitId: "SERVICE" }] });
    assert.deepEqual([second.status, second.body.code], [409, "AGREEMENT_ALREADY_EXISTS"]);
    const read = await call(bare, reader, "getSalesAgreementDetail", { salesAgreementId: agreement.salesAgreementId });
    assert.deepEqual([read.status, read.body.result.state, read.body.result.acceptedByPrincipalId], [200, "ACCEPTED", writer.principalId]);
  });

  let order;
  await t.test("(37) a direct Sales Order create reaches C2 through the transport", async () => {
    const res = await call(bare, writer, "createSalesOrder", { idempotencyKey: key(), accountId: "acct-1", ownerEmployeeId: "e-gm", operatingCompanyId: "taylor",
      salesChannel: "RETAIL", lines: [{ kind: "SERVICE", ref: "svc-pm", orderedQty: 2, unitPrice: 45000, businessUnitId: "SERVICE" }] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    order = res.body.result;
    assert.equal((await q(`SELECT created_by, state::text FROM eos_commercial.sales_orders WHERE id=$1`, [order.salesOrderId])).rows[0].created_by, writer.principalId);
    const detail = await call(bare, reader, "getSalesOrderDetail", { salesOrderId: order.salesOrderId });
    assert.deepEqual([detail.status, detail.body.result.totalMinor], [200, 90000]);
  });

  await t.test("(35) the Account projection needs all three read capabilities", async () => {
    const partial = await call(bare, partialReader, "getAccountCommercialProjection", { accountId: "acct-1" });
    assert.deepEqual([partial.status, partial.body.code], [403, "CAPABILITY_REQUIRED"]);
    const full = await call(bare, reader, "getAccountCommercialProjection", { accountId: "acct-1" });
    assert.equal(full.status, 200);
    assert.ok(full.body.result.salesOrders.items.some((i) => i.id === order.salesOrderId));
    assert.ok(full.body.result.salesAgreements.items.some((i) => i.id === agreement.salesAgreementId));
  });

  await t.test("(40)(41) product references: 503 CATALOG_AUTHORITY_UNAVAILABLE on the deployed composition, success only with a test-injected catalog", async () => {
    const productOpp = { ...SERVICE_OPP, need: "Freezer", lines: [{ kind: "EQUIPMENT_MODEL", ref: "model-a", qty: 1 }] };
    const before = (await q(`SELECT count(*)::int n FROM eos_commercial.opportunities`)).rows[0].n;
    const refused = await call(bare, writer, "createOpportunity", { idempotencyKey: key(), ...productOpp });
    assert.deepEqual([refused.status, refused.body.code], [503, "CATALOG_AUTHORITY_UNAVAILABLE"]);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_commercial.opportunities`)).rows[0].n, before);
    const accepted = await call(withCatalog, writer, "createOpportunity", { idempotencyKey: key(), ...productOpp });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  });

  await t.test("(44)(45) the transport touched PostgreSQL authorities only and loaded no Firebase module", async () => {
    statements.length = 0;
    await call(bare, reader, "getAccountCommercialProjection", { accountId: "acct-1" });
    await call(bare, writer, "createOpportunity", { idempotencyKey: key(), ...SERVICE_OPP, need: "Final" });
    const schemas = new Set(statements.flatMap((s) => [...s.matchAll(/\b(eos_[a-z_]+)\./g)].map((m) => m[1])));
    for (const schema of schemas) assert.ok(["eos_policy", "eos_commercial", "eos_crm", "eos_workforce"].includes(schema), `unexpected schema ${schema}`);
    assert.ok(schemas.has("eos_policy") && schemas.has("eos_commercial"));
    const loaded = Object.keys(require.cache).filter((m) => /firebase/i.test(m));
    assert.deepEqual(loaded, [], "a Firebase module was loaded by the Commercial path");
  });
});
