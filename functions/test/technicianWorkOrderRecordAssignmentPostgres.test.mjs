// TECHNICIAN -> workOrder.record.read -> RECORD_ASSIGNMENT(ASSIGNED_EMPLOYEE), recordKind workOrder.
//
// STATUS: AUTHORIZATION_PENDING_OWNER_APPROVAL. NOTHING HERE IS ACTIVATED.
//
// Migration 1762300800000 grants `workOrder.record.read` FLAT to eleven Roles, `technician` among
// them. A flat grant gives a technician EVERY Work Order in the tenant, which is wider than the legacy
// Rules (`firestore.rules` fieldops_wos: own only). The narrowing is one grant-level condition on the
// ONE cell (ROLE:technician, workOrder.record.read), which narrows nobody else.
//
// WHERE THE CONDITION LIVES IS AN OWNER QUESTION, NOT A CODE QUESTION. The Owner wants Administration
// to be the control plane for grants AND their conditions, so the condition is carried here in TWO
// equivalent forms and proven through both:
//
//   FIXTURE   `PROPOSED_TECHNICIAN_WORK_ORDER_READ_CONDITION`, a test-local catalog row in the shape
//             `grantConditionCatalog` declares. It is a PROPOSAL; `SHIPPED_GRANT_CONDITIONS` stays
//             EMPTY and this file asserts that it does.
//   STORED    the same condition as a row of `eos_policy.capability_grant_conditions` (migration
//             1762214400000), read back through `postgresGrantConditionProvider` -- the path an
//             Administration-written row would take -- inside a throwaway database dropped at the end.
//
// The evaluator behaviour proven below is independent of which one writes the condition.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const model = require("../lib/eosOps/conditionalEntitlement.js");
const composition = require("../lib/eosOps/entitledActionAuthority.js");
const evaluator = require("../lib/eosOps/contextualAuthorization.js");
const capabilityAuthority = require("../lib/eosOps/capabilityAuthority.js");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");

const WO_READ = "workOrder.record.read";
const ASSIGNED = Object.freeze({ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" });

/** THE PROPOSAL. Not in SHIPPED_GRANT_CONDITIONS; pending Owner approval of where it is administered. */
const PROPOSED_TECHNICIAN_WORK_ORDER_READ_CONDITION = Object.freeze({
  grantor: Object.freeze({ kind: "ROLE", roleKey: "technician" }),
  capabilityKey: WO_READ,
  condition: Object.freeze({ paths: [[ASSIGNED]], recordKind: "workOrder" }),
});

/** Holders of workOrder.record.read per migration 1762300800000, and one Role that does not hold it. */
const UNCONDITIONAL_HOLDERS = Object.freeze(["admin", "dispatcher", "fieldManager"]);
const NON_HOLDER = "officeManager";

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

test("the proposed technician condition, as a catalog row, is well-formed and inert", () => {
  const catalog = model.grantConditionCatalog([PROPOSED_TECHNICIAN_WORK_ORDER_READ_CONDITION]);
  assert.equal(catalog.size, 1);
  const c = catalog.get(`ROLE:technician|${WO_READ}`);
  assert.deepEqual(c.paths, [[ASSIGNED]]);
  assert.equal(c.recordKind, "workOrder");
  assert.equal(model.conditionNeedsRecord(c), true);
  // Not a WITHHELD cell: the production guard accepts it.
  assert.doesNotThrow(() => model.assertNoWithheldGrantConditions(catalog));
  // A stored JSON round trip decides the same catalog -- the Administration-written form.
  const fromRows = model.grantConditionCatalogFromRows([{ grantScope: "ROLE", grantorKey: "technician",
    capabilityKey: WO_READ, condition: JSON.parse(JSON.stringify(PROPOSED_TECHNICIAN_WORK_ORDER_READ_CONDITION.condition)) }]);
  assert.deepEqual([...fromRows.entries()], [...catalog.entries()]);
  // AND IT IS NOT ACTIVATED.
  assert.equal(model.SHIPPED_GRANT_CONDITIONS.size, 0, "the proposal leaked into the shipped catalog");
});

test("technician workOrder.record.read by RECORD ASSIGNMENT, against PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `tcwo_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up",
    "--migrations-dir", "migrations", "--no-check-order"],
  { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe" });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 6 });
  const q = (sql, v = []) => pool.query(sql, v);
  const repo = new PostgresPolicyRepository(pool);

  const TENANT = "t-tc-wo";
  const COMPANY = "sample-co-synthetic";
  await q(`INSERT INTO eos_policy.tenants (id,key,name) VALUES ($1,$1,$1)`, [TENANT]);
  await q(`INSERT INTO eos_policy.tenant_operating_companies
             (tenant_id,operating_company_id,status,source,established_by,updated_by)
           VALUES ($1,$2,'ACTIVE','lane-tc','fixture','fixture')`, [TENANT, COMPANY]);

  // ---- Roles and grants: exactly the migration's shape for the cells this proof touches.
  const fixture = { tenantId: TENANT, uid: "uid-lane-tc" };
  const roleIds = {};
  for (const key of ["technician", ...UNCONDITIONAL_HOLDERS, NON_HOLDER]) {
    roleIds[key] = (await repo.transact(fixture, (tx) =>
      tx.createRole({ key, name: key, description: null, origin: "CUSTOM", protected: false }))).id;
  }
  for (const roleKey of ["technician", ...UNCONDITIONAL_HOLDERS]) {
    const r = await q(
      `INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
       SELECT $1,$2,$3,c.id,'fixture','fixture','fixture' FROM eos_policy.capabilities c WHERE c.key = $4`,
      [`rc-${roleKey}-wo-read`, TENANT, roleIds[roleKey], WO_READ]);
    assert.equal(r.rowCount, 1, `${WO_READ} is not in the migrated capability vocabulary`);
  }
  // The officeManager Role holds something else, so its refusal is about THIS key, not an empty Role.
  await q(`INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
           SELECT 'rc-office-other',$1,$2,c.id,'fixture','fixture','fixture' FROM eos_policy.capabilities c
            WHERE c.key = 'admin.principalAccess.read'`, [TENANT, roleIds[NON_HOLDER]]);

  const makePrincipal = async (subject, roleKeys) => {
    const principalId = await repo.transact(fixture, async (tx) => {
      const p = await tx.createPrincipal({ externalSubject: subject, identityProvider: "firebase" });
      await tx.createTenantMembership(p.id);
      return p.id;
    });
    for (const roleKey of roleKeys) {
      await repo.transact(fixture, async (tx) => {
        const accessVersion = await tx.bumpAccessVersion(principalId);
        return tx.createAssignment({ principalId, roleId: roleIds[roleKey], scopeType: "global", scopeValue: null,
          status: "active", grantedBy: "fixture", grantedAt: new Date().toISOString(), accessVersionAtGrant: accessVersion });
      });
    }
    return { principalId, subject, roleKeys };
  };
  const makeEmployee = async (key) => {
    await q(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id,employee_number)
             VALUES ($1,$2,'ACTIVE',$3,$4)`, [`emp-${key}`, TENANT, COMPANY, `TC-${key}`.slice(0, 32)]);
    return `emp-${key}`;
  };
  const link = (id, principalId, employeeId, status = "active") =>
    q(`INSERT INTO eos_policy.employee_principal_links
         (id,tenant_id,principal_id,employee_id,operating_company_id,link_source,status,asserted_by,assertion_reason)
       VALUES ($1,$2,$3,$4,$5,'OPERATOR_ASSERTED',$6,'fixture','lane tc fixture')`,
    [id, TENANT, principalId, employeeId, COMPANY, status]);

  const techA = await makePrincipal("uid-tc-tech-a", ["technician"]);
  const techB = await makePrincipal("uid-tc-tech-b", ["technician"]);
  const techUnlinked = await makePrincipal("uid-tc-tech-unlinked", ["technician"]);
  const techRevoked = await makePrincipal("uid-tc-tech-revoked", ["technician"]);
  const techAndDispatcher = await makePrincipal("uid-tc-tech-dispatch", ["technician", "dispatcher"]);
  const holders = {};
  for (const roleKey of UNCONDITIONAL_HOLDERS) holders[roleKey] = await makePrincipal(`uid-tc-${roleKey}`, [roleKey]);
  const office = await makePrincipal("uid-tc-office", [NON_HOLDER]);

  const empA = await makeEmployee("tech-a");
  const empB = await makeEmployee("tech-b");
  const empRevoked = await makeEmployee("tech-revoked");
  const empTD = await makeEmployee("tech-dispatch");
  await link("lnk-a", techA.principalId, empA);
  await link("lnk-b", techB.principalId, empB);
  await link("lnk-rev", techRevoked.principalId, empRevoked, "revoked");
  await link("lnk-td", techAndDispatcher.principalId, empTD);
  // techUnlinked: no link at all.

  // ---- Work Orders. The creator is the dispatcher Principal -- the RECORD's actor/ownership facts.
  const DISPATCHER = holders.dispatcher.principalId;
  const WO = { A: "wo-tc-a", B: "wo-tc-b", HISTORY: "wo-tc-history", REVOKED: "wo-tc-revoked", UNASSIGNED: "wo-tc-none" };
  for (const [i, id] of Object.values(WO).entries()) {
    await q(`INSERT INTO eos_ops.work_orders
               (id,tenant_id,operating_company_key,work_order_number,status,work_order_type,priority,
                customer_id,location_id,provenance,created_by_principal_id,updated_by_principal_id,created_at,updated_at)
             VALUES ($1,$2,$3,$4,'SCHEDULED','SERVICE_CALL',2,'cust-1','loc-1','NATIVE',$5,$5,now(),now())`,
    [id, TENANT, COMPANY, `WO-2026-${String(900001 + i)}`, DISPATCHER]);
  }
  const openAssignment = (id, workOrderId, employeeId, source = "SCHEDULE", reason = null) =>
    q(`INSERT INTO eos_ops.work_order_assignments
         (id,tenant_id,work_order_id,assignee_employee_id,source,reason,effective_from,assigned_by_principal_id,provenance)
       VALUES ($1,$2,$3,$4,$5,$6,now() - interval '1 hour',$7,'NATIVE')`,
    [id, TENANT, workOrderId, employeeId, source, reason, DISPATCHER]);
  const closeAssignment = (id, endSource, endReason) =>
    q(`UPDATE eos_ops.work_order_assignments
          SET effective_to = now(), end_source = $2, end_reason = $3, ended_by_principal_id = $4
        WHERE tenant_id = $1 AND id = $5 AND effective_to IS NULL`,
    [TENANT, endSource, endReason, DISPATCHER, id]);
  await openAssignment("woa-a-1", WO.A, empA);
  await openAssignment("woa-b-1", WO.B, empB);
  await openAssignment("woa-hist-1", WO.HISTORY, empA);
  assert.equal((await closeAssignment("woa-hist-1", "UNSCHEDULE", "fixture: history only")).rowCount, 1);
  await openAssignment("woa-rev-1", WO.REVOKED, empRevoked);

  // ---- The two condition sources. FIXTURE: a test-local catalog. STORED: a relation row.
  const fixtureCatalog = model.grantConditionCatalog([PROPOSED_TECHNICIAN_WORK_ORDER_READ_CONDITION]);
  await q(`INSERT INTO eos_policy.capability_grant_conditions
             (id,tenant_id,grant_scope,grantor_key,capability_key,condition,status,established_by,updated_by)
           VALUES ('gc-tc-wo-read',$1,'ROLE','technician',$2,$3::jsonb,'ACTIVE','lane-tc','lane-tc')`,
  [TENANT, WO_READ, JSON.stringify(PROPOSED_TECHNICIAN_WORK_ORDER_READ_CONDITION.condition)]);

  const inputFor = (p) => ({ identityProvider: "firebase", externalSubject: p.subject, requestedTenantId: null });
  const SOURCES = {
    FIXTURE: (p) => capabilityAuthority.resolveOperationalContext(repo, pool, inputFor(p), () => fixtureCatalog),
    STORED: (p) => composition.resolveEntitledOperationalContext(repo, pool, inputFor(p)),
  };
  const actorOf = (ctx) => ({ tenantId: ctx.principalContext.tenantId, principalId: ctx.principalContext.uid,
    capabilities: ctx.capabilities, entitlements: ctx.entitlements });

  // A reader that records every statement, so "the evaluator reads assignments only" is measured.
  const recording = () => {
    const statements = [];
    const db = { query: (sql, v) => { statements.push(String(sql)); return pool.query(sql, v); } };
    return [statements, evaluator.postgresContextualReader(db)];
  };
  const decide = async (source, principal, recordId, reader) => {
    const ctx = await SOURCES[source](principal);
    const [statements, rec] = recording();
    const d = await composition.authorizeOperationalAction(reader ?? rec, actorOf(ctx), { capabilityKey: WO_READ, recordId });
    return { d, statements, ctx };
  };
  const snapshot = async () => ({
    workOrders: (await q(`SELECT to_jsonb(w) j FROM eos_ops.work_orders w WHERE tenant_id=$1 ORDER BY id`, [TENANT])).rows.map((r) => r.j),
    assignments: (await q(`SELECT to_jsonb(a) j FROM eos_ops.work_order_assignments a WHERE tenant_id=$1 ORDER BY id`, [TENANT])).rows.map((r) => r.j),
    links: (await q(`SELECT to_jsonb(l) j FROM eos_policy.employee_principal_links l WHERE tenant_id=$1 ORDER BY id`, [TENANT])).rows.map((r) => r.j),
  });

  for (const source of Object.keys(SOURCES)) {
    await t.test(`[${source}] the technician entitlement IS conditioned; every other holder's is not`, async () => {
      const tech = await SOURCES[source](techA);
      const reaching = model.entitlementsFor(await tech.entitlements(), WO_READ);
      assert.equal(reaching.length, 1);
      assert.deepEqual(reaching[0].grantor, { kind: "ROLE", roleKey: "technician" });
      assert.deepEqual(reaching[0].condition.paths, [[ASSIGNED]]);
      assert.equal(reaching[0].condition.recordKind, "workOrder");
      for (const roleKey of UNCONDITIONAL_HOLDERS) {
        const ctx = await SOURCES[source](holders[roleKey]);
        assert.equal(model.hasUnconditionalEntitlement(await ctx.entitlements(), WO_READ), true, roleKey);
      }
    });

    await t.test(`[${source}] (a) assignment resolves through Employee identity; no active link is refused, not tenant-wide`, async () => {
      const { d, statements } = await decide(source, techA, WO.A);
      assert.equal(d.allowed, true);
      assert.equal(d.outcome, "ALLOWED");
      assert.equal(d.viaCondition, true, "allowed THROUGH the condition, not around it");
      assert.deepEqual(d.viaGrantor, { kind: "ROLE", roleKey: "technician" });
      // Principal -> ACTIVE employee_principal_links -> assignee_employee_id, in that order.
      assert.equal(statements.length, 2);
      assert.match(statements[0], /FROM eos_policy\.employee_principal_links[\s\S]*status = 'active'/);
      assert.match(statements[1], /FROM eos_ops\.work_order_assignments[\s\S]*assignee_employee_id = \$3[\s\S]*effective_to IS NULL/);
      // No link, and a REVOKED link, are both refused on EVERY Work Order -- including one assigned
      // to the revoked link's Employee.
      for (const [who, p] of [["unlinked", techUnlinked], ["revoked", techRevoked]]) {
        for (const id of Object.values(WO)) {
          const r = (await decide(source, p, id)).d;
          assert.equal(r.allowed, false, `${who} technician read ${id}`);
          assert.equal(r.outcome, "EMPLOYEE_LINK_REQUIRED", `${who} on ${id}`);
          assert.equal(r.predicate, "RECORD_ASSIGNMENT");
        }
      }
    });

    await t.test(`[${source}] (b) a technician cannot read another technician's Work Order`, async () => {
      const mineB = (await decide(source, techB, WO.B)).d;
      assert.equal(mineB.allowed, true);
      const theirs = (await decide(source, techA, WO.B)).d;
      assert.equal(theirs.allowed, false);
      assert.equal(theirs.outcome, "NOT_ASSIGNED");
      assert.equal(theirs.predicate, "RECORD_ASSIGNMENT");
      assert.equal((await decide(source, techB, WO.A)).d.outcome, "NOT_ASSIGNED");
      assert.equal((await decide(source, techA, WO.UNASSIGNED)).d.outcome, "NOT_ASSIGNED");
      assert.equal((await decide(source, techA, "wo-does-not-exist")).d.outcome, "NOT_ASSIGNED",
        "a missing record is indistinguishable from someone else's");
    });
  }

  await t.test("(c)(d)(e) reassignment changes FUTURE access; ownership and history are untouched by evaluation", async () => {
    const workOrderBefore = (await q(`SELECT to_jsonb(w) j FROM eos_ops.work_orders w WHERE id=$1`, [WO.A])).rows[0].j;

    // BEFORE: A reads, B does not -- under both sources.
    for (const source of Object.keys(SOURCES)) {
      assert.equal((await decide(source, techA, WO.A)).d.allowed, true, source);
      assert.equal((await decide(source, techB, WO.A)).d.outcome, "NOT_ASSIGNED", source);
    }

    // REASSIGN, with the table's own open/closed semantics: close A's interval (effective_to,
    // end_source, end_reason, ended_by_principal_id written once) and open B's.
    assert.equal((await closeAssignment("woa-a-1", "DISPATCH_REASSIGN", "reassigned to B")).rowCount, 1);
    await openAssignment("woa-a-2", WO.A, empB, "DISPATCH_REASSIGN", "reassigned to B");

    const before = await snapshot();
    const statements = [];
    for (const source of Object.keys(SOURCES)) {
      // (c) AFTER: the old assignee loses, the new one gains. Each request resolves afresh.
      const oldA = await decide(source, techA, WO.A);
      assert.equal(oldA.d.allowed, false, `${source}: the previous assignee kept access`);
      assert.equal(oldA.d.outcome, "NOT_ASSIGNED");
      const newB = await decide(source, techB, WO.A);
      assert.equal(newB.d.allowed, true, `${source}: the new assignee did not gain access`);
      assert.equal(newB.d.viaCondition, true);
      // (e) A CLOSED interval never grants: A's ended row on WO.A, and the history-only Work Order.
      assert.equal((await decide(source, techA, WO.HISTORY)).d.outcome, "NOT_ASSIGNED", `${source}: history granted`);
      statements.push(...oldA.statements, ...newB.statements);
    }
    const after = await snapshot();

    // (d) The evaluator read ONLY the link and the assignment relation, and only with SELECT.
    assert.ok(statements.length > 0);
    for (const s of statements) {
      assert.match(s.trim(), /^SELECT\b/, `the evaluator issued a non-SELECT: ${s}`);
      assert.doesNotMatch(s, /eos_ops\.work_orders\b/, "the evaluator read the Work Order record itself");
      assert.match(s, /FROM (eos_policy\.employee_principal_links|eos_ops\.work_order_assignments)\b/);
    }
    // (d) Record ownership/accountability is NOT changed by assignment: the Work Order row -- including
    //     created_by_principal_id / updated_by_principal_id -- is byte-identical after reassignment.
    const workOrderAfter = (await q(`SELECT to_jsonb(w) j FROM eos_ops.work_orders w WHERE id=$1`, [WO.A])).rows[0].j;
    assert.deepEqual(workOrderAfter, workOrderBefore, "reassignment rewrote the Work Order record");
    assert.equal(workOrderAfter.created_by_principal_id, DISPATCHER);
    assert.equal(workOrderAfter.updated_by_principal_id, DISPATCHER);
    // (d)(e) Evaluation mutated NOTHING: Work Orders, assignment history and links are identical.
    assert.deepEqual(after, before, "evaluating a read mutated governed rows");

    // (e) The history is still HISTORY: A's row is closed, whole, and still names A.
    const history = (await q(`SELECT id, assignee_employee_id, effective_to IS NOT NULL AS closed, end_source
                                FROM eos_ops.work_order_assignments WHERE tenant_id=$1 AND work_order_id=$2
                               ORDER BY effective_from, id`, [TENANT, WO.A])).rows;
    assert.deepEqual(history, [
      { id: "woa-a-1", assignee_employee_id: empA, closed: true, end_source: "DISPATCH_REASSIGN" },
      { id: "woa-a-2", assignee_employee_id: empB, closed: false, end_source: null },
    ]);
    // ...and the table itself refuses to rewrite or delete it, so no evaluator ever could.
    await assert.rejects(() => q(`UPDATE eos_ops.work_order_assignments SET effective_to = NULL WHERE id='woa-a-1'`),
      /history is not rewritten/);
    await assert.rejects(() => q(`DELETE FROM eos_ops.work_order_assignments WHERE id='woa-a-1'`), /never deleted/);
  });

  for (const source of Object.keys(SOURCES)) {
    await t.test(`[${source}] (f) unconditional holders still read ALL at zero context reads; a non-holder is refused`, async () => {
      for (const roleKey of UNCONDITIONAL_HOLDERS) {
        for (const id of [...Object.values(WO), "wo-does-not-exist"]) {
          const { d, statements } = await decide(source, holders[roleKey], id);
          assert.equal(d.allowed, true, `${roleKey} lost ${id}`);
          assert.equal(d.viaCondition, false);
          assert.equal(d.contextEvaluated, false, `${roleKey} acquired a context requirement`);
          assert.deepEqual(d.viaGrantor, { kind: "ROLE", roleKey });
          assert.equal(statements.length, 0, `${roleKey} caused a context read`);
        }
      }
      // UNION: a Principal holding technician AND an unconditioned holder Role reads all, unconditionally.
      const both = await decide(source, techAndDispatcher, WO.B);
      assert.equal(both.d.allowed, true);
      assert.deepEqual(both.d.viaGrantor, { kind: "ROLE", roleKey: "dispatcher" });
      assert.equal(both.statements.length, 0);
      // A Role without the grant: CAPABILITY_MISSING, having read nothing.
      const refused = await decide(source, office, WO.A);
      assert.equal(refused.d.allowed, false);
      assert.equal(refused.d.outcome, "CAPABILITY_MISSING");
      assert.equal(refused.d.contextEvaluated, false);
      assert.equal(refused.statements.length, 0);
    });

    await t.test(`[${source}] (g) no tenant-wide fallback for a technician under any path`, async () => {
      // No record supplied: the condition cannot be answered, so it refuses -- never "all records".
      for (const recordId of [undefined, "", "   "]) {
        const d = (await decide(source, techB, recordId)).d;
        assert.equal(d.allowed, false, `recordId ${JSON.stringify(recordId)} allowed`);
        assert.equal(d.outcome, "NOT_ASSIGNED");
        assert.equal(d.detail, "no record supplied");
      }
      // The contextual authority throws: CONTEXT_AUTHORITY_UNAVAILABLE, never an allow.
      const dead = { linkedEmployeeId: async () => { throw new Error("connection terminated"); },
        hasWorkEligibility: async () => { throw new Error("x"); }, hasOperationalScope: async () => { throw new Error("x"); },
        isAssignedEmployee: async () => { throw new Error("connection terminated"); } };
      const outage = (await decide(source, techB, WO.A, dead)).d;
      assert.equal(outage.allowed, false);
      assert.equal(outage.outcome, "CONTEXT_AUTHORITY_UNAVAILABLE");
      // A reader answering only the link then failing on the assignment: still unavailable.
      const pgReader = evaluator.postgresContextualReader(pool);
      const half = { ...pgReader, isAssignedEmployee: async () => { throw new Error("relation missing"); } };
      assert.equal((await decide(source, techB, WO.A, half)).d.outcome, "CONTEXT_AUTHORITY_UNAVAILABLE");
      // The entitlement resolver fails, returns nothing, or returns junk: refused.
      const ctx = await SOURCES[source](techB);
      const base = actorOf(ctx);
      for (const entitlements of [async () => { throw new Error("store unreadable"); }, async () => [], async () => null]) {
        const d = await composition.authorizeOperationalAction(pgReader, { ...base, entitlements }, { capabilityKey: WO_READ, recordId: WO.A });
        assert.equal(d.allowed, false);
        assert.ok(["CONTEXT_AUTHORITY_UNAVAILABLE", "CAPABILITY_MISSING"].includes(d.outcome), d.outcome);
      }
      // A caller cannot strip the condition: dropping the conditioned entitlement leaves NO entitlement.
      const stripped = await composition.authorizeOperationalAction(pgReader,
        { ...base, entitlements: async () => (await ctx.entitlements()).filter((e) => e.capabilityKey !== WO_READ) },
        { capabilityKey: WO_READ, recordId: WO.B });
      assert.equal(stripped.allowed, false);
      assert.equal(stripped.outcome, "CAPABILITY_MISSING");
    });
  }

  await t.test("[STORED] (g) an unreadable or malformed condition store refuses; it never reads as unconditioned", async () => {
    // Malformed stored condition: the provider throws, the production resolver rejects.
    await q(`UPDATE eos_policy.capability_grant_conditions SET condition = '{"paths": []}'::jsonb WHERE id='gc-tc-wo-read'`);
    await assert.rejects(() => composition.resolveEntitledOperationalContext(repo, pool, inputFor(techB)),
      /a condition with no path is not a condition/);
    const lazy = await capabilityAuthority.resolveOperationalContext(repo, pool, inputFor(techB),
      composition.postgresGrantConditionProvider(pool));
    const d = await composition.authorizeOperationalAction(evaluator.postgresContextualReader(pool), actorOf(lazy),
      { capabilityKey: WO_READ, recordId: WO.B });
    assert.equal(d.allowed, false);
    assert.equal(d.outcome, "CONTEXT_AUTHORITY_UNAVAILABLE");
    // A recordKind outside the governed set is refused too.
    await q(`UPDATE eos_policy.capability_grant_conditions
                SET condition = '{"paths": [[{"kind":"RECORD_ASSIGNMENT","relation":"ASSIGNED_EMPLOYEE"}]], "recordKind":"anything"}'::jsonb
              WHERE id='gc-tc-wo-read'`);
    await assert.rejects(() => composition.resolveEntitledOperationalContext(repo, pool, inputFor(techB)),
      /RECORD_ASSIGNMENT needs a governed recordKind/);
    // Restore the proposal row.
    await q(`UPDATE eos_policy.capability_grant_conditions SET condition = $1::jsonb WHERE id='gc-tc-wo-read'`,
      [JSON.stringify(PROPOSED_TECHNICIAN_WORK_ORDER_READ_CONDITION.condition)]);
    assert.equal((await decide("STORED", techB, WO.B)).d.allowed, true);
  });

  await t.test("nothing was activated: the shipped catalog is still empty", () => {
    assert.equal(model.SHIPPED_GRANT_CONDITIONS.size, 0);
  });
});
