// Workforce census finding #17: readMyWorkforceCapabilities against a real postgres:16.
//
// The Administration Employee pages decide what to OFFER from this read, so it must answer from exactly the authority
// the Workforce commands authorize against: EOS Principal -> ACTIVE membership -> qualifying Roles ->
// eos_policy.role_capabilities, intersected with the closed Workforce list.
//
// The suite migrates its OWN disposable database. Workforce grants are delivered through the EXISTING Employee
// capability-grant reconciliation; the deliberately NON-Workforce grants (which must never be disclosed) are inserted
// by hand into this disposable database only. Callers are real bearer requests through the Workforce transport.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
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
const http = require("../lib/eosWorkforce/workforceHttp.js");
const grants = require("../lib/eosWorkforce/migration/employeeCapabilityGrants.js");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");

const WORKFORCE_IDS = ["employee.record.read", "admin.principalAccess.read", "admin.employeeProfile.write", "admin.employeeJobRole.write"];

const dbUrlFor = (name) => { const u = new URL(URL_BASE); u.pathname = `/${name}`; return u.toString(); };
async function withClient(url, fn) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}

test("readMyWorkforceCapabilities over the real policy authority", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `emp_capgate_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], {
    cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe",
  });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 8 });
  const q = (text, values = []) => pool.query(text, values);
  const repo = new PostgresPolicyRepository(pool);
  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1'), ('t2','t2','T2')`);

  // Every statement the transport sends, so read-only is proven on the wire and not only by the transaction mode.
  const statements = [];
  const spyPool = new Proxy(pool, {
    get(target, prop) {
      if (prop === "query") return (text, values) => { statements.push(String(text?.text ?? text)); return target.query(text, values); };
      if (prop === "connect") {
        return async () => {
          const client = await target.connect();
          return new Proxy(client, {
            get(c, p) {
              if (p === "query") return (text, values) => { statements.push(String(text?.text ?? text)); return c.query(text, values); };
              const v = c[p];
              return typeof v === "function" ? v.bind(c) : v;
            },
          });
        };
      }
      const v = target[prop];
      return typeof v === "function" ? v.bind(target) : v;
    },
  });

  const fixture = (tenantId) => ({ tenantId, uid: "uid-fixture-admin" });
  const roleIds = {};
  for (const tenantId of ["t1", "t2"]) {
    for (const key of ["admin", "generalManager", "technician"]) {
      roleIds[`${tenantId}:${key}`] = (await repo.transact(fixture(tenantId), (tx) => tx.createRole({ key, name: key, description: null, origin: "CUSTOM", protected: false }))).id;
    }
    await grants.reconcileEmployeeCapabilityGrants(pool, { tenantId, apply: true, actor: "employee-capability-grants:test" });
  }
  // NON-Workforce grants the same Roles hold. They are real, resolvable capabilities -- and must never be disclosed.
  const handGrant = (tenantId, roleKey, capability) => q(
    `INSERT INTO eos_policy.role_capabilities (id, tenant_id, role_id, capability_id, granted_by, created_by, updated_by)
     SELECT $1, $2, $3, c.id, 'fixture', 'fixture', 'fixture' FROM eos_policy.capabilities c WHERE c.key = $4`,
    [`rc_${tenantId}_${roleKey}_${capability}`, tenantId, roleIds[`${tenantId}:${roleKey}`], capability],
  );
  for (const [roleKey, capability] of [["admin", "opportunity.read"], ["admin", "inventory.cycleCount.create"], ["generalManager", "salesOrder.read"], ["technician", "inventory.cycleCount.submit"], ["technician", "customer.record.read"]]) {
    const inserted = await handGrant("t1", roleKey, capability);
    assert.equal(inserted.rowCount, 1, `${capability} is not in the capability vocabulary`);
  }

  const TOKENS = new Map();
  const verifyToken = async (token) => {
    const subject = TOKENS.get(token);
    if (!subject) throw new Error("invalid token");
    return { externalSubject: subject, identityProvider: "firebase" };
  };
  const deps = { reader: repo, pool: spyPool, verifyToken, allowedOrigins: [] };
  const assign = (tenantId, principalId, roleKey) => repo.transact(fixture(tenantId), async (tx) => {
    const accessVersion = await tx.bumpAccessVersion(principalId);
    return tx.createAssignment({ principalId, roleId: roleIds[`${tenantId}:${roleKey}`], scopeType: "global", scopeValue: null, status: "active", grantedBy: "fixture", grantedAt: new Date().toISOString(), accessVersionAtGrant: accessVersion });
  });
  const makePrincipal = async (tenantId, subject, roleKey = null) => {
    const principalId = await repo.transact(fixture(tenantId), async (tx) => {
      const p = await tx.createPrincipal({ externalSubject: subject, identityProvider: "firebase" });
      await tx.createTenantMembership(p.id);
      return p.id;
    });
    if (roleKey) await assign(tenantId, principalId, roleKey);
    TOKENS.set(`tok-${subject}`, subject);
    return { principalId, subject, token: `tok-${subject}` };
  };
  const call = async (actor, input, headers = {}) => {
    const res = await http.handleWorkforceRequest(deps, {
      method: "POST", url: "/workforce/employees", headers: { authorization: `Bearer ${actor.token}`, ...headers },
      body: JSON.stringify(input === undefined ? { operation: "readMyWorkforceCapabilities" } : { operation: "readMyWorkforceCapabilities", input }),
    });
    return { status: res.status, body: JSON.parse(res.body), raw: res.body };
  };

  const admin = await makePrincipal("t1", "firebase-uid-admin", "admin");
  const gm = await makePrincipal("t1", "firebase-uid-gm", "generalManager");
  const technician = await makePrincipal("t1", "firebase-uid-technician", "technician");
  const nobody = await makePrincipal("t1", "firebase-uid-nobody");
  const t2Admin = await makePrincipal("t2", "firebase-uid-t2-admin", "admin");

  await t.test("Administrator: exactly the four Workforce ids -- and none of the other capabilities its Role holds", async () => {
    const res = await call(admin);
    assert.deepEqual([res.status, res.body], [200, { ok: true, operation: "readMyWorkforceCapabilities", result: { capabilities: WORKFORCE_IDS } }]);
    // The Role really does hold the non-Workforce grants: they resolve, and they are simply not disclosed.
    const { resolveOperationalContext } = require("../lib/eosOps/capabilityAuthority.js");
    const ctx = await resolveOperationalContext(repo, pool, { identityProvider: "firebase", externalSubject: admin.subject, requestedTenantId: null });
    assert.ok(ctx.capabilities.has("opportunity.read") && ctx.capabilities.has("inventory.cycleCount.create"));
    assert.doesNotMatch(res.raw, /opportunity|inventory|salesOrder|customer/);
    // Never a Role key, Principal id, subject, provider or tenant.
    assert.ok(!res.raw.includes(admin.principalId));
    assert.deepEqual(Object.keys(res.body.result), ["capabilities"]);
    assert.doesNotMatch(res.raw, /firebase|"admin"|generalManager|technician|"t1"|principalId|roleKey|heldRole|tenant/i);
  });

  await t.test("General Manager: employee.record.read only; its salesOrder.read grant is not returned", async () => {
    const res = await call(gm);
    assert.deepEqual([res.status, res.body.result], [200, { capabilities: ["employee.record.read"] }]);
  });

  await t.test("a technician-like Role holding only non-Workforce grants, and a Principal holding no Role: []", async () => {
    for (const actor of [technician, nobody]) {
      const res = await call(actor);
      assert.deepEqual([res.status, res.body.result], [200, { capabilities: [] }], actor.subject);
    }
  });

  await t.test("a grant change is reflected on the next read -- nothing is cached", async () => {
    const promoted = await makePrincipal("t1", "firebase-uid-promoted", "technician");
    assert.deepEqual((await call(promoted)).body.result.capabilities, []);
    await assign("t1", promoted.principalId, "generalManager");
    assert.deepEqual((await call(promoted)).body.result.capabilities, ["employee.record.read"]);
  });

  await t.test("an inactive membership or an inactive Principal refuses 403 and discloses nothing", async () => {
    const temp = await makePrincipal("t1", "firebase-uid-temp-admin", "admin");
    assert.deepEqual((await call(temp)).body.result.capabilities, WORKFORCE_IDS);
    await q(`UPDATE eos_policy.tenant_memberships SET status = 'disabled' WHERE principal_id = $1`, [temp.principalId]);
    const noMembership = await call(temp);
    assert.deepEqual([noMembership.status, noMembership.body.ok], [403, false]);
    assert.doesNotMatch(noMembership.raw, /admin\.|employee\.record/);
    await q(`UPDATE eos_policy.tenant_memberships SET status = 'active' WHERE principal_id = $1`, [temp.principalId]);
    assert.equal((await call(temp)).status, 200);
    await q(`UPDATE eos_policy.principals SET status = 'disabled' WHERE id = $1`, [temp.principalId]);
    const disabled = await call(temp);
    assert.deepEqual([disabled.status, disabled.body.ok], [403, false]);
    assert.doesNotMatch(disabled.raw, /admin\.|employee\.record/);
  });

  await t.test("tenant-scoped: a foreign x-eos-tenant refuses; a two-tenant Principal gets each tenant's own answer", async () => {
    const foreign = await call(admin, undefined, { "x-eos-tenant": "t2" });
    assert.deepEqual([foreign.status, foreign.body.code], [403, "FORBIDDEN"]);
    assert.deepEqual((await call(t2Admin)).body.result.capabilities, WORKFORCE_IDS);
    const dual = await makePrincipal("t1", "firebase-uid-dual", "admin");
    await repo.transact(fixture("t2"), (tx) => tx.createTenantMembership(dual.principalId));
    const inT1 = await call(dual, undefined, { "x-eos-tenant": "t1" });
    const inT2 = await call(dual, undefined, { "x-eos-tenant": "t2" });
    assert.deepEqual([inT1.status, inT1.body.result.capabilities], [200, WORKFORCE_IDS]);
    assert.deepEqual([inT2.status, inT2.body.result.capabilities], [200, []]);
  });

  await t.test("input: no selector and no authority field is accepted", async () => {
    const selector = await call(gm, { principalId: admin.principalId });
    assert.deepEqual([selector.status, selector.body.code], [400, "AUTHORITY_FIELD_NOT_ACCEPTED"]);
    const other = await call(gm, { employeeId: "e-1" });
    assert.deepEqual([other.status, other.body.code], [400, "INPUT_FIELD_NOT_ACCEPTED"]);
    const asAdmin = await call(gm, { capabilities: WORKFORCE_IDS });
    assert.deepEqual([asAdmin.status, asAdmin.body.code], [400, "AUTHORITY_FIELD_NOT_ACCEPTED"]);
  });

  await t.test("read-only: no write statement, nothing changes, the Workforce read runs in a READ ONLY snapshot; no Firebase module loads", async () => {
    const snapshot = async () => (await q(`SELECT (SELECT count(*) FROM eos_policy.audit_events)::int a, (SELECT count(*) FROM eos_policy.role_capabilities)::int rc,
      (SELECT count(*) FROM eos_policy.user_role_assignments)::int ura, (SELECT max(updated_at) FROM eos_policy.principals) p`)).rows[0];
    const before = await snapshot();
    statements.length = 0;
    await call(admin);
    await call(gm);
    await call(technician);
    assert.deepEqual(await snapshot(), before);
    assert.ok(statements.includes("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"));
    assert.deepEqual(statements.filter((s) => /^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/i.test(s)), [], "the read issued a write");
    const schemas = new Set(statements.flatMap((s) => [...s.matchAll(/\b(eos_[a-z_]+)\./g)].map((m) => m[1])));
    assert.deepEqual([...schemas], ["eos_policy"]);
    const loaded = Object.keys(require.cache).filter((m) => /firebase|firestore/i.test(m));
    assert.deepEqual(loaded, [], "a Firebase module was loaded by the Workforce path");
  });

  await t.test("HTTP end to end through a real node:http listener", async () => {
    const handler = http.createWorkforceHttpHandler({ ...deps, allowedOrigins: ["https://eos.example"] });
    const server = createServer((req, res) => void handler(req, res));
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    try {
      const { port } = server.address();
      const post = (token) => fetch(`http://127.0.0.1:${port}/workforce/employees`, {
        method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", origin: "https://eos.example" },
        body: JSON.stringify({ operation: "readMyWorkforceCapabilities" }),
      });
      const res = await post(gm.token);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("access-control-allow-origin"), "https://eos.example");
      assert.equal(res.headers.get("cache-control"), "no-store");
      assert.deepEqual(await res.json(), { ok: true, operation: "readMyWorkforceCapabilities", result: { capabilities: ["employee.record.read"] } });
      const unauthenticated = await post("tok-unknown");
      assert.equal(unauthenticated.status, 401);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});
