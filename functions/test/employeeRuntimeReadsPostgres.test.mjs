// EMPLOYEE RUNTIME READS against a real postgres:16 -- the Workforce transport end to end.
//
// One disposable database, migrated by the normal runner. The full trusted path runs through the pure request handler
// (and once through a real node:http listener): bearer -> injected verifier -> resolveOperationalContext (Principal,
// membership, Role assignment, role_capabilities) -> Employee read -> HTTP response. Roles, grants, links and business
// rows below exist ONLY in this disposable database.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const http = require("../lib/eosWorkforce/workforceHttp.js");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");

const LIFECYCLE = ["ACTIVE", "ON_LEAVE", "INACTIVE", "TERMINATED", "RETIRED", "CONTRACTOR"];

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

test("Employee runtime reads end to end over the real policy, Workforce and Commercial authorities", { skip: SKIP, concurrency: 1 }, async (t) => {
  let pool;
  const name = `emp_rt_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  const url = dbUrlFor(name);
  migrator(url)("up");
  pool = new pg.Pool({ connectionString: url, max: 8 });
  const q = (text, values = []) => pool.query(text, values);
  const repo = new PostgresPolicyRepository(pool);

  const statements = [];
  let failOn = null;
  const spyPool = new Proxy(pool, {
    get(target, prop) {
      if (prop === "query") return (text, values) => { statements.push(String(text?.text ?? text)); return target.query(text, values); };
      if (prop === "connect") {
        return async () => {
          const client = await target.connect();
          return new Proxy(client, {
            get(c, p) {
              if (p === "query") {
                return (text, values) => {
                  const sql = String(text?.text ?? text);
                  statements.push(sql);
                  if (failOn && failOn.test(sql)) return Promise.reject(new Error(`relation "eos_workforce.employees" password=hunter2 host=10.0.0.7 syntax error at or near SELECT`));
                  return c.query(text, values);
                };
              }
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

  const TOKENS = new Map();
  const verifyToken = async (token) => {
    const subject = TOKENS.get(token);
    if (!subject) throw new Error("invalid token");
    return { externalSubject: subject, identityProvider: "firebase" };
  };
  const deps = { reader: repo, pool: spyPool, verifyToken, allowedOrigins: [] };

  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1'), ('t2','t2','T2')`);
  const fixtureActor = (tenantId) => ({ tenantId, uid: "uid-fixture-admin" });
  const makeActor = async (tenantId, subject, keys = []) => {
    const principalId = await repo.transact(fixtureActor(tenantId), async (tx) => {
      const principal = await tx.createPrincipal({ externalSubject: subject, identityProvider: "firebase" });
      await tx.createTenantMembership(principal.id);
      return principal.id;
    });
    if (keys.length > 0) {
      const role = await repo.transact(fixtureActor(tenantId), (tx) => tx.createRole({ key: `role-${subject}`, name: subject, description: null, origin: "CUSTOM", protected: false }));
      for (const key of keys) {
        await q(`INSERT INTO eos_policy.role_capabilities (id, tenant_id, role_id, capability_id, granted_by, created_by, updated_by)
                 SELECT $1, $2, $3, c.id, 'fixture', 'fixture', 'fixture' FROM eos_policy.capabilities c WHERE c.key = $4`, [`rc_${role.id}_${key}`, tenantId, role.id, key]);
      }
      await repo.transact(fixtureActor(tenantId), async (tx) => {
        const accessVersion = await tx.bumpAccessVersion(principalId);
        return tx.createAssignment({ principalId, roleId: role.id, scopeType: "global", scopeValue: null, status: "active", grantedBy: "fixture", grantedAt: new Date().toISOString(), accessVersionAtGrant: accessVersion });
      });
    }
    const token = `tok-${subject}`;
    TOKENS.set(token, subject);
    return { principalId, token, subject, tenantId };
  };
  let linkSeq = 0;
  const link = (actor, employeeId, tenantId = actor.tenantId, status = "active") =>
    q(`INSERT INTO eos_policy.employee_principal_links (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, status, asserted_by, assertion_reason)
       VALUES ($1, $2, $3, $4, 'taylor', 'OPERATOR_ASSERTED', $5, 'fixture-operator', 'test fixture')`, [`epl-${++linkSeq}`, tenantId, actor.principalId, employeeId, status]);

  const responses = [];
  const call = async (actor, operation, input, headers = {}) => {
    const res = await http.handleWorkforceRequest(deps, {
      method: "POST", url: "/workforce/employees", headers: { authorization: `Bearer ${actor.token}`, ...headers },
      body: JSON.stringify(input === undefined ? { operation } : { operation, input }),
    });
    responses.push(res.body);
    return { status: res.status, body: JSON.parse(res.body) };
  };

  // ── Employees: every lifecycle status, and a foreign-tenant Employee ──
  for (const s of LIFECYCLE) await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id) VALUES ($1,'t1',$2,'taylor')`, [`e-${s.toLowerCase()}`, s]);
  await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id) VALUES
    ('e-owner-a','t1','ACTIVE','taylor'), ('e-acct-b','t1','ACTIVE','ventana'), ('e-page','t1','ACTIVE','taylor'), ('e-t2','t2','ACTIVE','taylor')`);

  // ── Principals ──
  const selves = {};
  for (const s of LIFECYCLE) {
    selves[s] = await makeActor("t1", `firebase-uid-self-${s.toLowerCase()}`);
    await link(selves[s], `e-${s.toLowerCase()}`);
  }
  const reader = await makeActor("t1", "firebase-uid-reader", ["opportunity.read", "salesAgreement.read", "salesOrder.read"]);
  const oppOnly = await makeActor("t1", "firebase-uid-opp-only", ["opportunity.read"]);
  const writerOnly = await makeActor("t1", "firebase-uid-writer-only", ["opportunity.write", "salesOrder.write"]);
  const nobody = await makeActor("t1", "firebase-uid-nobody");
  const t2Reader = await makeActor("t2", "firebase-uid-t2-reader", ["opportunity.read", "salesAgreement.read", "salesOrder.read"]);
  assert.notEqual(reader.principalId, reader.subject);

  const assertNoLeak = (body) => assert.doesNotMatch(JSON.stringify(body), /hunter2|10\.0\.0\.7|syntax error|relation|password|eos_workforce|SELECT/i);

  await t.test("EMP-RT-07: every one of the six lifecycle statuses resolves through the governed link, TERMINATED and RETIRED included", async () => {
    for (const s of LIFECYCLE) {
      const res = await call(selves[s], "readMyEmployeeProfile");
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const r = res.body.result;
      assert.deepEqual([r.employee.employeeId, r.employee.employmentStatus, r.employee.operatingCompanyId], [`e-${s.toLowerCase()}`, s, "taylor"]);
      assert.deepEqual([r.principalLink.principalId, r.principalLink.linkSource, r.principalLink.assertedBy], [selves[s].principalId, "OPERATOR_ASSERTED", "fixture-operator"]);
      assert.deepEqual(Object.keys(r).sort(), ["employee", "principalLink"]);
    }
    const empty = await call(selves.ACTIVE, "readMyEmployeeProfile", {});
    assert.equal(empty.status, 200);
  });

  await t.test("EMP-RT-07: an unlinked or revoked-only Principal refuses 404; a selector in the input refuses 400", async () => {
    const unlinked = await call(nobody, "readMyEmployeeProfile");
    assert.deepEqual([unlinked.status, unlinked.body.code], [404, "EMPLOYEE_PRINCIPAL_LINK_NOT_FOUND"]);
    const revoked = await makeActor("t1", "firebase-uid-revoked");
    await link(revoked, "e-active", "t1", "revoked");
    const r = await call(revoked, "readMyEmployeeProfile");
    assert.deepEqual([r.status, r.body.code], [404, "EMPLOYEE_PRINCIPAL_LINK_NOT_FOUND"]);
    const selector = await call(selves.ACTIVE, "readMyEmployeeProfile", { employeeId: "e-terminated" });
    assert.deepEqual([selector.status, selector.body.code], [400, "INPUT_FIELD_NOT_ACCEPTED"]);
  });

  await t.test("EMP-RT-07: never matches an Employee by external subject or Principal id", async () => {
    const trap = await makeActor("t1", "e-subject-trap");
    await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id) VALUES ('e-subject-trap','t1','ACTIVE','taylor'), ($1,'t1','ACTIVE','taylor')`, [trap.principalId]);
    const unlinked = await call(trap, "readMyEmployeeProfile");
    assert.deepEqual([unlinked.status, unlinked.body.code], [404, "EMPLOYEE_PRINCIPAL_LINK_NOT_FOUND"], "an Employee resolved by subject or Principal id");
    await link(trap, "e-contractor-trap-target", "t1", "revoked");
    await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id) VALUES ('e-linked-for-trap','t1','ON_LEAVE','taylor')`);
    await link(trap, "e-linked-for-trap");
    const linked = await call(trap, "readMyEmployeeProfile");
    assert.equal(linked.status, 200, JSON.stringify(linked.body));
    assert.equal(linked.body.result.employee.employeeId, "e-linked-for-trap");
  });

  await t.test("EMP-RT-07: a link whose Employee belongs to another tenant refuses 412; a link held in another tenant does not answer here", async () => {
    const cross = await makeActor("t1", "firebase-uid-cross-link");
    await link(cross, "e-t2");
    const r = await call(cross, "readMyEmployeeProfile");
    assert.deepEqual([r.status, r.body.code], [412, "EMPLOYEE_PRINCIPAL_LINK_UNRESOLVED"]);

    const dual = await makeActor("t1", "firebase-uid-dual-tenant");
    await repo.transact(fixtureActor("t2"), (tx) => tx.createTenantMembership(dual.principalId));
    await link(dual, "e-t2", "t2");
    const inT1 = await call(dual, "readMyEmployeeProfile", undefined, { "x-eos-tenant": "t1" });
    assert.deepEqual([inT1.status, inT1.body.code], [404, "EMPLOYEE_PRINCIPAL_LINK_NOT_FOUND"]);
    const inT2 = await call(dual, "readMyEmployeeProfile", undefined, { "x-eos-tenant": "t2" });
    assert.deepEqual([inT2.status, inT2.body.result.employee.employeeId], [200, "e-t2"]);
  });

  await t.test("EMP-RT-07: an inactive membership refuses 403 before any Employee is read", async () => {
    const suspended = await makeActor("t1", "firebase-uid-suspended");
    await link(suspended, "e-active-suspended-target", "t1", "revoked");
    await q(`UPDATE eos_policy.tenant_memberships SET status='disabled' WHERE principal_id=$1`, [suspended.principalId]);
    const r = await call(suspended, "readMyEmployeeProfile");
    assert.equal(r.status, 403);
  });

  await t.test("(owner != accountable) fixtures: records owned by A and accountable to B, and the reverse", async () => {
    await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, created_by, updated_by) VALUES ('acct-1','t1','Acct','ACTIVE','x','x'), ('acct-2','t2','Other','ACTIVE','x','x')`);
    const opp = (id, number, owner, accountable, tenant = "t1", acct = "acct-1", complete = true) => q(
      `INSERT INTO eos_commercial.opportunities (id, tenant_id, opportunity_number, account_id, owner_employee_id, accountable_employee_id, operating_company_key, sales_channel, stage, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,'taylor',$7,$8,'x','x')`, [id, tenant, number, acct, owner, accountable, complete ? "RETAIL" : null, complete ? "QUALIFYING" : null]);
    await opp("opp-a-owned-b-acct", "OPP-2026-000001", "e-owner-a", "e-acct-b");
    await opp("opp-b-owned-a-acct", "OPP-2026-000002", "e-acct-b", "e-owner-a");
    await opp("opp-spine-a", "OPP-2026-000003", "e-owner-a", null, "t1", "acct-1", false);
    await opp("opp-t2-a", "OPP-2026-000001", "e-owner-a", "e-owner-a", "t2", "acct-2");
    await q(`INSERT INTO eos_commercial.sales_agreements (id, tenant_id, sales_agreement_number, account_id, owner_employee_id, accountable_employee_id, state, currency, created_by, updated_by)
             VALUES ('sa-a','t1','SA-2026-000001','acct-1','e-owner-a',NULL,'DRAFT','USD','x','x')`);
    await q(`INSERT INTO eos_commercial.sales_orders (id, tenant_id, sales_order_number, account_id, owner_employee_id, accountable_employee_id, operating_company_key, state, sales_channel, currency, booked_at, created_by, updated_by)
             VALUES ('so-b-owned-a-acct','t1','SO-2026-000001','acct-1','e-acct-b','e-owner-a','taylor','CONFIRMED','RETAIL','USD',now(),'x','x')`);
    await q(`INSERT INTO eos_commercial.accountability_handoffs (id, tenant_id, opportunity_id, previous_accountable_employee_id, new_accountable_employee_id, eligibility_policy_id, recorded_by, source, effective_at)
             VALUES ('ah-1','t1','opp-a-owned-b-acct',NULL,'e-owner-a','policy-v1','x','DERIVED_FROM_RECORD_OWNER', now() - interval '2 days'),
                    ('ah-2','t1','opp-a-owned-b-acct','e-owner-a','e-acct-b','policy-v1','x','EXPLICIT', now() - interval '1 day')`);
  });

  const ids = (res) => res.body.result.items.map((i) => i.recordId);

  await t.test("EMP-RT-03 / EMP-RT-04: each record appears under its own axis only, tenant-scoped, spine rows excluded", async () => {
    const ownedA = await call(reader, "listRecordsOwnedByEmployee", { employeeId: "e-owner-a", family: "OPPORTUNITY" });
    assert.equal(ownedA.status, 200, JSON.stringify(ownedA.body));
    assert.deepEqual(ids(ownedA), ["opp-a-owned-b-acct"], "ownership leaked accountability, a spine row, or another tenant's record");
    assert.equal(ownedA.body.result.axis, "RECORD_OWNER");
    const acctA = await call(reader, "listAccountabilitiesForEmployee", { employeeId: "e-owner-a", family: "OPPORTUNITY" });
    assert.deepEqual(ids(acctA), ["opp-b-owned-a-acct"]);
    assert.equal(acctA.body.result.axis, "ACCOUNTABLE_PERSON");
    assert.equal(acctA.body.result.items[0].currentAccountability, null, "no handoff names A on that record");
    const acctB = await call(reader, "listAccountabilitiesForEmployee", { employeeId: "e-acct-b", family: "OPPORTUNITY" });
    assert.deepEqual(ids(acctB), ["opp-a-owned-b-acct"]);
    assert.deepEqual({ ...acctB.body.result.items[0].currentAccountability, effectiveAt: undefined }, { action: "HANDOFF", source: "EXPLICIT", effectiveAt: undefined });
    const ownedB = await call(reader, "listRecordsOwnedByEmployee", { employeeId: "e-acct-b", family: "OPPORTUNITY" });
    assert.deepEqual(ids(ownedB), ["opp-b-owned-a-acct"]);
    assert.equal(ownedB.body.result.items[0].currentAccountability, undefined, "the ownership read carried accountability");

    assert.deepEqual(ids(await call(reader, "listRecordsOwnedByEmployee", { employeeId: "e-owner-a", family: "SALES_AGREEMENT" })), ["sa-a"]);
    assert.deepEqual(ids(await call(reader, "listAccountabilitiesForEmployee", { employeeId: "e-owner-a", family: "SALES_AGREEMENT" })), []);
    assert.deepEqual(ids(await call(reader, "listRecordsOwnedByEmployee", { employeeId: "e-owner-a", family: "SALES_ORDER" })), []);
    assert.deepEqual(ids(await call(reader, "listAccountabilitiesForEmployee", { employeeId: "e-owner-a", family: "SALES_ORDER" })), ["so-b-owned-a-acct"]);
    const item = (await call(reader, "listRecordsOwnedByEmployee", { employeeId: "e-acct-b", family: "SALES_ORDER" })).body.result.items[0];
    assert.deepEqual(Object.keys(item).sort(), ["accountId", "family", "operatingCompanyId", "recordId", "recordNumber", "state", "updatedAt"]);
  });

  await t.test("EMP-RT-03: a TERMINATED Employee stays resolvable; a foreign-tenant or unknown Employee is 404", async () => {
    const terminated = await call(reader, "listRecordsOwnedByEmployee", { employeeId: "e-terminated", family: "OPPORTUNITY" });
    assert.deepEqual([terminated.status, terminated.body.result.items], [200, []]);
    for (const employeeId of ["e-t2", "e-never"]) {
      const res = await call(reader, "listRecordsOwnedByEmployee", { employeeId, family: "OPPORTUNITY" });
      assert.deepEqual([res.status, res.body.code], [404, "EMPLOYEE_NOT_FOUND"], employeeId);
    }
    const fromT2 = await call(t2Reader, "listRecordsOwnedByEmployee", { employeeId: "e-owner-a", family: "OPPORTUNITY" });
    assert.deepEqual([fromT2.status, fromT2.body.code], [404, "EMPLOYEE_NOT_FOUND"], "tenant B resolved tenant A's Employee");
  });

  await t.test("capabilities: each family requires its own existing read capability; a write grant never stands in", async () => {
    for (const [actor, family] of [[nobody, "OPPORTUNITY"], [oppOnly, "SALES_ORDER"], [oppOnly, "SALES_AGREEMENT"], [writerOnly, "OPPORTUNITY"], [writerOnly, "SALES_ORDER"]]) {
      for (const operation of ["listRecordsOwnedByEmployee", "listAccountabilitiesForEmployee"]) {
        const res = await call(actor, operation, { employeeId: "e-owner-a", family });
        assert.deepEqual([res.status, res.body.code], [403, "CAPABILITY_REQUIRED"], `${actor.subject} ${operation} ${family}`);
      }
    }
    assert.equal((await call(oppOnly, "listRecordsOwnedByEmployee", { employeeId: "e-owner-a", family: "OPPORTUNITY" })).status, 200);
  });

  await t.test("input: unserved families, unknown fields, authority fields and bad paging refuse 400", async () => {
    for (const family of ["ACCOUNT", "CONTACT", "WORK_ORDER", "opportunity", undefined]) {
      const res = await call(reader, "listRecordsOwnedByEmployee", { employeeId: "e-owner-a", family });
      assert.deepEqual([res.status, res.body.code], [400, "FAMILY_INVALID"], String(family));
    }
    for (const [input, code] of [
      [{ employeeId: "e-owner-a", family: "OPPORTUNITY", tenantId: "t2" }, "AUTHORITY_FIELD_NOT_ACCEPTED"],
      [{ employeeId: "e-owner-a", family: "OPPORTUNITY", principalId: "p" }, "AUTHORITY_FIELD_NOT_ACCEPTED"],
      [{ employeeId: "e-owner-a", family: "OPPORTUNITY", jobRole: "RETAIL" }, "AUTHORITY_FIELD_NOT_ACCEPTED"],
      [{ employeeId: "e-owner-a", family: "OPPORTUNITY", ownerEmployeeId: "e-acct-b" }, "INPUT_FIELD_NOT_ACCEPTED"],
      [{ employeeId: "e-owner-a", family: "OPPORTUNITY", limit: 9999 }, "PAGE_SIZE_INVALID"],
      [{ employeeId: "e-owner-a", family: "OPPORTUNITY", cursor: "not-a-cursor" }, "CURSOR_INVALID"],
      [{ family: "OPPORTUNITY" }, "EMPLOYEE_ID_REQUIRED"],
    ]) {
      const res = await call(reader, "listRecordsOwnedByEmployee", input);
      assert.deepEqual([res.status, res.body.code], [400, code], JSON.stringify(input));
    }
    const selfAuthority = await call(selves.ACTIVE, "readMyEmployeeProfile", { principalId: reader.principalId });
    assert.deepEqual([selfAuthority.status, selfAuthority.body.code], [400, "AUTHORITY_FIELD_NOT_ACCEPTED"]);
    const foreignTenant = await call(reader, "listRecordsOwnedByEmployee", { employeeId: "e-owner-a", family: "OPPORTUNITY" }, { "x-eos-tenant": "t2" });
    assert.deepEqual([foreignTenant.status, foreignTenant.body.message], [403, "TENANT_NOT_A_MEMBERSHIP"]);
    for (const operation of ["listAssignedWorkForEmployee", "listEmployeeJobRoles", "establishReportingRelationship", "endReportingRelationship"]) {
      const res = await call(reader, operation, { employeeId: "e-owner-a" });
      assert.deepEqual([res.status, res.body.code], [404, "UNKNOWN_OPERATION"], operation);
    }
  });

  await t.test("lists are bounded, deterministic and keyset-paginated; a cursor cannot move to another Employee, family or axis", async () => {
    for (let i = 1; i <= 5; i++) {
      await q(`INSERT INTO eos_commercial.opportunities (id, tenant_id, opportunity_number, account_id, owner_employee_id, accountable_employee_id, operating_company_key, sales_channel, stage, created_by, updated_by)
               VALUES ($1,'t1',$2,'acct-1','e-page','e-page','taylor','RETAIL','IDENTIFIED','x','x')`, [`opp-page-${i}`, `OPP-2026-10000${i}`]);
    }
    const seen = [];
    let cursor;
    const pages = [];
    do {
      const res = await call(reader, "listRecordsOwnedByEmployee", { employeeId: "e-page", family: "OPPORTUNITY", limit: 2, ...(cursor ? { cursor } : {}) });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      pages.push(res.body.result.items.length);
      seen.push(...ids(res));
      cursor = res.body.result.nextCursor;
      assert.equal(res.body.result.truncated, cursor !== null);
    } while (cursor);
    assert.deepEqual(pages, [2, 2, 1]);
    assert.deepEqual(seen, ["opp-page-5", "opp-page-4", "opp-page-3", "opp-page-2", "opp-page-1"]);
    const again = await call(reader, "listRecordsOwnedByEmployee", { employeeId: "e-page", family: "OPPORTUNITY", limit: 5 });
    assert.deepEqual(ids(again), seen, "the ordering is not deterministic");
    const first = await call(reader, "listRecordsOwnedByEmployee", { employeeId: "e-page", family: "OPPORTUNITY", limit: 2 });
    const c = first.body.result.nextCursor;
    for (const [operation, input] of [
      ["listRecordsOwnedByEmployee", { employeeId: "e-owner-a", family: "OPPORTUNITY", cursor: c }],
      ["listRecordsOwnedByEmployee", { employeeId: "e-page", family: "SALES_ORDER", cursor: c }],
      ["listAccountabilitiesForEmployee", { employeeId: "e-page", family: "OPPORTUNITY", cursor: c }],
    ]) {
      const res = await call(reader, operation, input);
      assert.deepEqual([res.status, res.body.code], [400, "CURSOR_INVALID"], `${operation} ${JSON.stringify(input)}`);
    }
  });

  await t.test("a raw database failure is a generic 500 that leaks no SQL, driver or connection detail", async () => {
    failOn = /eos_workforce\.employees/;
    try {
      for (const [actor, operation, input] of [[selves.ACTIVE, "readMyEmployeeProfile", undefined], [reader, "listRecordsOwnedByEmployee", { employeeId: "e-owner-a", family: "OPPORTUNITY" }]]) {
        const res = await call(actor, operation, input);
        assert.deepEqual([res.status, res.body.code, res.body.message], [500, "READ_FAILED", "the read could not be completed"]);
        assertNoLeak(res.body);
      }
    } finally {
      failOn = null;
    }
  });

  await t.test("reads are read-only, touch PostgreSQL authorities only, carry no Job Role, and load no Firebase module", async () => {
    statements.length = 0;
    await call(selves.RETIRED, "readMyEmployeeProfile");
    await call(reader, "listAccountabilitiesForEmployee", { employeeId: "e-acct-b", family: "OPPORTUNITY" });
    await call(reader, "listRecordsOwnedByEmployee", { employeeId: "e-owner-a", family: "SALES_AGREEMENT" });
    const schemas = new Set(statements.flatMap((s) => [...s.matchAll(/\b(eos_[a-z_]+)\./g)].map((m) => m[1])));
    for (const schema of schemas) assert.ok(["eos_policy", "eos_commercial", "eos_workforce"].includes(schema), `unexpected schema ${schema}`);
    assert.ok(schemas.has("eos_workforce") && schemas.has("eos_policy") && schemas.has("eos_commercial"));
    assert.ok(statements.includes("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"));
    assert.deepEqual(statements.filter((s) => /^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(s)), [], "a read issued a write");
    for (const body of responses.filter((b) => JSON.parse(b).ok === true)) assert.doesNotMatch(body, /jobRole|job_role|Job Role|Retail Sales|National Accounts|salesperson/i, "a response carried a Job Role");
    const loaded = Object.keys(require.cache).filter((m) => /firebase|firestore/i.test(m));
    assert.deepEqual(loaded, [], "a Firebase module was loaded by the Workforce path");
  });

  await t.test("EMP-RT-07: two active links for one Principal, or two Principals on one Employee, refuse 409 (corrupted-state fixture)", async () => {
    // The partial unique indexes make this unrepresentable in a governed database; they are dropped HERE ONLY, in this
    // disposable database, to prove the read fails closed rather than choosing one.
    await q(`DROP INDEX eos_policy.employee_principal_links_one_active_per_principal`);
    await q(`DROP INDEX eos_policy.employee_principal_links_one_active_per_employee`);
    const twoLinks = await makeActor("t1", "firebase-uid-two-links");
    await link(twoLinks, "e-inactive");
    await link(twoLinks, "e-owner-a");
    const r = await call(twoLinks, "readMyEmployeeProfile");
    assert.deepEqual([r.status, r.body.code], [409, "EMPLOYEE_PRINCIPAL_LINK_AMBIGUOUS"]);
    const second = await makeActor("t1", "firebase-uid-second-on-active");
    await link(second, "e-acct-b");
    const third = await makeActor("t1", "firebase-uid-third-on-active");
    await link(third, "e-acct-b");
    const shared = await call(second, "readMyEmployeeProfile");
    assert.deepEqual([shared.status, shared.body.code], [409, "EMPLOYEE_PRINCIPAL_LINK_AMBIGUOUS"]);
  });

  await t.test("HTTP end to end through a real node:http listener", async () => {
    const handler = http.createWorkforceHttpHandler({ ...deps, allowedOrigins: ["https://eos.example"] });
    const server = createServer((req, res) => void handler(req, res));
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    try {
      const { port } = server.address();
      const res = await fetch(`http://127.0.0.1:${port}/workforce/employees`, {
        method: "POST", headers: { authorization: `Bearer ${selves.CONTRACTOR.token}`, "content-type": "application/json", origin: "https://eos.example" },
        body: JSON.stringify({ operation: "readMyEmployeeProfile" }),
      });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("access-control-allow-origin"), "https://eos.example");
      const body = await res.json();
      assert.deepEqual([body.operation, body.result.employee.employmentStatus], ["readMyEmployeeProfile", "CONTRACTOR"]);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});
