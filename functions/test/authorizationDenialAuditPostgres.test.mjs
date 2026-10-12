// DECISIONS #229 -- authorization denials on the Catalog transport, recorded in eos_policy.audit_events, in a REAL
// PostgreSQL: authorization outcome unchanged, one rate-bounded row per denial, no payload, tenant isolation, an audit
// store failure that cannot turn a denial into an allowance, and OFF (the committed mode) writing nothing.
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
const http = require("../lib/catalogMaster/catalogHttp.js");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");

const ACTIVE = Object.freeze({ firestore: "FROZEN", postgres: "ACTIVE" });
const SECRET = "SECRET-PAYLOAD-7f3e";

test("authorization denials are audited on the Catalog transport (DECISIONS #229)", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `denial_audit_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const url = (() => { const u = new URL(URL_BASE); u.pathname = `/${name}`; return u.toString(); })();
  const admin = new pg.Client({ connectionString: URL_BASE });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"],
    { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: url }, maxBuffer: 64 * 1024 * 1024, stdio: "pipe" });
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
  let clock = new Date("2026-10-11T12:00:05.000Z");
  const RECORD = { mode: "RECORD", now: () => clock };
  const baseDeps = {
    reader: repo, pool, writerAuthority: ACTIVE, allowedOrigins: [],
    verifyToken: async (token) => { const s = TOKENS.get(token); if (!s) throw new Error("bad"); return { externalSubject: s, identityProvider: "firebase" }; },
  };
  const deps = { ...baseDeps, denialAudit: RECORD };

  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1'), ('t2','t2','T2')`);
  const makeActor = async (tenantId, subject, keys) => {
    const fixture = { tenantId, uid: "uid-fixture-admin" };
    const principalId = await repo.transact(fixture, async (tx) => {
      const p = await tx.createPrincipal({ externalSubject: subject, identityProvider: "firebase" });
      await tx.createTenantMembership(p.id);
      return p.id;
    });
    if (keys.length) {
      const role = await repo.transact(fixture, (tx) => tx.createRole({ key: `role-${subject}`, name: subject, description: null, origin: "CUSTOM", protected: false }));
      for (const key of keys) {
        await q(`INSERT INTO eos_policy.role_capabilities (id, tenant_id, role_id, capability_id, granted_by, created_by, updated_by)
                 SELECT $1, $2, $3, c.id, 'fixture', 'fixture', 'fixture' FROM eos_policy.capabilities c WHERE c.key = $4`,
          [`rc_${role.id}_${key}`, tenantId, role.id, key]);
      }
      await repo.transact(fixture, async (tx) => {
        const v = await tx.bumpAccessVersion(principalId);
        return tx.createAssignment({ principalId, roleId: role.id, scopeType: "global", scopeValue: null, status: "active", grantedBy: "fixture", grantedAt: new Date().toISOString(), accessVersionAtGrant: v });
      });
    }
    TOKENS.set(`tok-${subject}`, subject);
    return { principalId, token: `tok-${subject}`, tenantId };
  };

  const reader = await makeActor("t1", "fb-reader", ["inventory.catalog.read"]);
  const manager = await makeActor("t1", "fb-manager", ["inventory.catalog.read", "inventory.catalog.manage"]);
  const readerT2 = await makeActor("t2", "fb-reader-t2", ["inventory.catalog.read"]);
  const nobody = await makeActor("t1", "fb-nobody", []);

  const call = async (d, actor, operation, input = {}, headers = {}) => {
    const res = await http.handleCatalogRequest(d, {
      method: "POST", url: http.CATALOG_ROUTE,
      headers: { ...(actor ? { authorization: `Bearer ${actor.token}` } : {}), ...headers },
      body: JSON.stringify({ operation, input }),
    });
    return { status: res.status, body: JSON.parse(res.body) };
  };
  const PART = (id) => ({ part: { partId: id, internalPartNumber: id, name: `${SECRET} ${id}`, status: "DRAFT", stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED" } });
  const denials = async (tenantId) => (await q(
    `SELECT * FROM eos_policy.audit_events WHERE tenant_id = $1 AND action LIKE '%.denied' ORDER BY occurred_at, id`, [tenantId])).rows;
  const parts = async () => Number((await q(`SELECT count(*) FROM eos_ops.parts`)).rows[0].count);

  await t.test("OFF (the committed mode) writes nothing, and the denial is unchanged", async () => {
    const r = await call(baseDeps, reader, "createPart", PART("P-OFF"));
    assert.deepEqual([r.status, r.body.code], [403, "FORBIDDEN"]);
    assert.equal((await denials("t1")).length, 0);
  });

  await t.test("a refused WRITE is still refused, writes no domain row, and is recorded once with the policy's fields", async () => {
    const r = await call(deps, reader, "createPart", PART("P-1"), { "x-request-id": "req-abc.123" });
    assert.deepEqual([r.status, r.body.code], [403, "FORBIDDEN"]);
    assert.equal(await parts(), 0, "the denied command wrote nothing");
    const rows = await denials("t1");
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.action, "catalog.createPart.denied");
    assert.equal(row.actor_uid, reader.principalId);
    assert.deepEqual([row.target_kind, row.target_id, row.reason], ["authorization", "createPart", "CAPABILITY_REQUIRED"]);
    assert.equal(row.before, null);
    assert.deepEqual(row.after, { operation: "createPart", requiredCapability: "inventory.catalog.manage", refusalCode: "CAPABILITY_REQUIRED", correlationId: "req-abc.123" });
    assert.ok(!JSON.stringify(row).includes(SECRET), "the request payload never reaches the audit row");
    assert.ok(!JSON.stringify(row).includes(reader.token), "no credential reaches the audit row");
  });

  await t.test("rate bound: repeats in the same minute are one row; the next minute is a new row", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await call(deps, reader, "createPart", PART(`P-R${i}`));
      assert.equal(r.status, 403);
    }
    assert.equal((await denials("t1")).length, 1);
    clock = new Date("2026-10-11T12:01:01.000Z");
    await call(deps, reader, "createPart", PART("P-NEXT"));
    assert.equal((await denials("t1")).length, 2);
  });

  await t.test("a refused READ is recorded with the capabilities it lacked", async () => {
    const r = await call(deps, nobody, "searchParts", { query: "x" });
    assert.deepEqual([r.status, r.body.code], [403, "FORBIDDEN"]);
    const row = (await denials("t1")).find((x) => x.action === "catalog.searchParts.denied");
    assert.ok(row);
    assert.equal(row.actor_uid, nobody.principalId);
    assert.equal(row.after.requiredCapability, "inventory.catalog.read");
  });

  await t.test("a business refusal (validation, conflict, precondition) is NOT an authorization denial", async () => {
    const before = (await denials("t1")).length;
    await call(deps, manager, "createPart", { part: { partId: "" } });
    await call(deps, manager, "updatePart", { partId: "P-NONE", expectedVersion: 1, changes: { name: "x" } });
    assert.equal((await denials("t1")).length, before);
  });

  await t.test("an unresolved identity is never recorded: no token, a bad token, a stated tenant the caller is no member of", async () => {
    const before = (await q(`SELECT count(*) FROM eos_policy.audit_events`)).rows[0].count;
    assert.equal((await call(deps, null, "createPart", PART("P-A"))).status, 401);
    assert.equal((await call(deps, { token: "forged" }, "createPart", PART("P-B"))).status, 401);
    const crossTenant = await call(deps, reader, "createPart", PART("P-C"), { "x-eos-tenant": "t2" });
    assert.equal(crossTenant.status, 403);
    assert.equal((await q(`SELECT count(*) FROM eos_policy.audit_events`)).rows[0].count, before);
    assert.equal((await denials("t2")).length, 0, "nothing was written into a tenant the caller is not a member of");
  });

  await t.test("tenant isolation: a denial is recorded in the denied Principal's own tenant only", async () => {
    const t1Before = (await denials("t1")).length;
    await call(deps, readerT2, "createPart", PART("P-T2"));
    const t2 = await denials("t2");
    assert.equal(t2.length, 1);
    assert.equal(t2[0].actor_uid, readerT2.principalId);
    assert.equal((await denials("t1")).length, t1Before);
  });

  await t.test("an audit-store failure cannot turn a denial into an allowance", async () => {
    // A pool that serves identity and reads, but whose audit INSERT fails.
    const failingPool = Object.create(pool);
    failingPool.query = (text, values) => (/INSERT INTO eos_policy\.audit_events/.test(String(text))
      ? Promise.reject(new Error("audit store unavailable")) : pool.query(text, values));
    const warnings = [];
    const failingDeps = { ...baseDeps, pool: failingPool, denialAudit: { ...RECORD, warn: (m) => warnings.push(m) } };
    const r = await call(failingDeps, reader, "createPart", PART("P-FAIL"));
    assert.deepEqual([r.status, r.body.code], [403, "FORBIDDEN"]);
    assert.equal(await parts(), 0);
    assert.deepEqual(warnings, ["authorization-denial audit: the audit row could not be written"]);
  });

  await t.test("an ALLOWED operation is unchanged and writes no denial row", async () => {
    const before = (await denials("t1")).length;
    const r = await call(deps, manager, "createPart", PART("P-OK"));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await denials("t1")).length, before);
  });
});
