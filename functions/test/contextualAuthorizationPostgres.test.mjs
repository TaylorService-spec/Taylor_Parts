// CONTEXTUAL AUTHORIZATION -- capability first, then only the predicates the action declares.
//
// The thing being defended is a separation: a capability grant says what KIND of action a Principal
// may perform, and nothing about WHICH records. Every test here is a way the two cannot re-merge.
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
const ctx = require("../lib/eosOps/contextualAuthorization.js");
const reorderAssignment = require("../lib/eosOps/reorderAssignmentAuthority.js");

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

const T = "t-ctxauth";
const caps = (...k) => new Set(k);

test("scope is not stored on either grant table -- structurally, not by convention", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `ctxauth_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up",
    "--migrations-dir", "migrations", "--no-check-order"],
  { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe" });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 4 });
  const q = (sql, v = []) => pool.query(sql, v);

  await t.test("no scope column exists on role_capabilities or principal_capabilities", async () => {
    const { rows } = await q(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'eos_policy'
          AND table_name IN ('role_capabilities','principal_capabilities')`);
    const forbidden = ["scope", "scope_type", "scope_value", "own_only", "queue_only",
      "warehouse_id", "company_id", "assignment_required", "condition", "condition_kind"];
    const found = rows.filter((r) => forbidden.includes(r.column_name));
    assert.deepEqual(found, [], "a grant row must answer WHAT, never WHICH");
  });

  // ── fixtures: one tenant, three principals, two employees, one assigned reorder request ──
  await q(`INSERT INTO eos_policy.tenants (id,key,name) VALUES ($1,$1,$1)`, [T]);
  const mk = async (pid, sub) => {
    await q(`INSERT INTO eos_policy.principals (id,external_subject,identity_provider,status)
             VALUES ($1,$2,'firebase','active')`, [pid, sub]);
    await q(`INSERT INTO eos_policy.tenant_memberships (id,tenant_id,principal_id,status)
             VALUES ($1,$2,$3,'active')`, [`mem-${pid}`, T, pid]);
  };
  await mk("prn-tech", "uid-tech");
  await mk("prn-other", "uid-other");
  await mk("prn-service", "uid-service"); // no Employee link at all
  await mk("prn-admin", "uid-admin");     // the assigner; a member, and that is all assignment needs
  for (const [eid, num] of [["emp-tech", "E1"], ["emp-other", "E2"]]) {
    await q(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id,employee_number)
             VALUES ($1,$2,'ACTIVE','taylor',$3)`, [eid, T, num]);
  }
  await q(`INSERT INTO eos_policy.employee_principal_links
             (id,tenant_id,principal_id,employee_id,operating_company_id,link_source,status,asserted_by,assertion_reason)
           VALUES ('lnk-1',$1,'prn-tech','emp-tech','taylor','OPERATOR_ASSERTED','active','fixture','test fixture'),
                  ('lnk-2',$1,'prn-other','emp-other','taylor','OPERATOR_ASSERTED','active','fixture','test fixture')`, [T]);
  await q(`INSERT INTO eos_ops.reorder_requests
             (id,tenant_id,operating_company_key,part_id,warehouse_id,status,requested_quantity,requested_by,updated_by)
           VALUES ('ro-mine',$1,'taylor','p1','w1','PENDING_REVIEW',1,'fixture','fixture'),
                  ('ro-theirs',$1,'taylor','p1','w1','PENDING_REVIEW',1,'fixture','fixture')`, [T]);
  await q(`INSERT INTO eos_ops.reorder_request_assignments
             (id,tenant_id,reorder_request_id,assigned_employee_id,effective_from,provenance,assigned_by_principal_id)
           VALUES ('a1',$1,'ro-mine','emp-tech',now(),'NATIVE','prn-admin'),
                  ('a2',$1,'ro-theirs','emp-other',now(),'NATIVE','prn-admin')`, [T]);

  const reader = ctx.postgresContextualReader(pool);
  const actor = (principalId, ...capKeys) => ({ tenantId: T, principalId, capabilities: caps(...capKeys) });
  const ASSIGNED = [{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }];

  await t.test("capability is checked FIRST, and refuses without touching the record", async () => {
    const d = await ctx.authorizeObjectAction(reader, {
      actor: actor("prn-tech"), capabilityKey: "reorder.request.read.own",
      predicates: ASSIGNED, record: { recordKind: "reorderRequest", recordId: "ro-theirs" },
    });
    assert.equal(d.reason, "CAPABILITY_MISSING");
    assert.equal(d.predicate, undefined, "no record context was evaluated, so none can leak");
  });

  await t.test("TECHNICIAN OWN: exactly the assigned record, and nothing else", async () => {
    const mine = await ctx.authorizeObjectAction(reader, {
      actor: actor("prn-tech", "reorder.request.read.own"), capabilityKey: "reorder.request.read.own",
      predicates: ASSIGNED, record: { recordKind: "reorderRequest", recordId: "ro-mine" },
    });
    assert.equal(mine.allowed, true, "the technician sees their own assigned request");

    const theirs = await ctx.authorizeObjectAction(reader, {
      actor: actor("prn-tech", "reorder.request.read.own"), capabilityKey: "reorder.request.read.own",
      predicates: ASSIGNED, record: { recordKind: "reorderRequest", recordId: "ro-theirs" },
    });
    assert.equal(theirs.allowed, false);
    assert.equal(theirs.reason, "NOT_ASSIGNED", "and does NOT gain queue-wide visibility");
  });

  await t.test("the OWN list predicate restricts in the QUERY, not after it", async () => {
    const p = ctx.ownRecordsPredicate("reorderRequest", "r.id");
    const { rows } = await q(
      `SELECT r.id FROM eos_ops.reorder_requests r WHERE r.tenant_id = $1 AND ${p.sql} ORDER BY r.id`,
      [T, "emp-tech"]);
    assert.deepEqual(rows.map((x) => x.id), ["ro-mine"], "the queue never leaves the database");

    // An ENDED assignment is not a current one. Somebody who handed work over stops seeing it.
    // A SEPARATE record, because the store keeps assignment history append-only and refuses to
    // un-end one -- which is itself the right behaviour and worth not fighting.
    await q(`INSERT INTO eos_ops.reorder_requests
               (id,tenant_id,operating_company_key,part_id,warehouse_id,status,requested_quantity,requested_by,updated_by)
             VALUES ('ro-handed',$1,'taylor','p1','w1','PENDING_REVIEW',1,'fixture','fixture')`, [T]);
    await q(`INSERT INTO eos_ops.reorder_request_assignments
               (id,tenant_id,reorder_request_id,assigned_employee_id,effective_from,provenance,assigned_by_principal_id,
                effective_to,ended_at,ended_by_principal_id,reason)
             VALUES ('a3',$1,'ro-handed','emp-tech',now(),'NATIVE','prn-admin',now(),now(),'prn-admin','handed over')`, [T]);
    const handed = await q(
      `SELECT r.id FROM eos_ops.reorder_requests r WHERE r.tenant_id = $1 AND ${p.sql} ORDER BY r.id`,
      [T, "emp-tech"]);
    assert.deepEqual(handed.rows.map((x) => x.id), ["ro-mine"], "an ended assignment conveys nothing");
  });

  await t.test("the Principal -> Employee bridge is the only route, and it fails closed", async () => {
    const d = await ctx.authorizeObjectAction(reader, {
      actor: actor("prn-service", "reorder.request.read.own"), capabilityKey: "reorder.request.read.own",
      predicates: ASSIGNED, record: { recordKind: "reorderRequest", recordId: "ro-mine" },
    });
    assert.equal(d.reason, "EMPLOYEE_LINK_REQUIRED", "no linked Employee means no record relationship");
    assert.equal(d.predicate, "RECORD_ASSIGNMENT");
  });

  await t.test("a non-Employee Principal still performs purely administrative actions", async () => {
    // The service Principal has no Employee and never will. An action that declares NO
    // Employee-bearing predicate must not ask for one -- otherwise every administrative capability
    // silently requires a workforce record.
    const d = await ctx.authorizeObjectAction(reader, {
      actor: actor("prn-service", "workflowDefinition.read"), capabilityKey: "workflowDefinition.read",
    });
    assert.equal(d.allowed, true);
  });

  await t.test("the decision is identical whether the capability came from a Role or directly", async () => {
    // Scope is independent of grant provenance. The evaluator receives an effective capability set
    // and cannot tell -- which is the point; a direct grant must not imply a different scope.
    const record = { recordKind: "reorderRequest", recordId: "ro-mine" };
    const results = [];
    for (const _ of ["ROLE", "DIRECT", "ROLE_AND_DIRECT"]) {
      results.push(await ctx.authorizeObjectAction(reader, {
        actor: actor("prn-tech", "reorder.request.read.own"), capabilityKey: "reorder.request.read.own",
        predicates: ASSIGNED, record,
      }));
    }
    assert.equal(new Set(results.map((r) => r.reason)).size, 1, "provenance changes nothing");
    assert.equal(results[0].allowed, true);
  });

  await t.test("an unmappable qualification still fails CLOSED and says which", async () => {
    // PARTS_ASSOCIATE used to be this case and is now governed vocabulary. The GUARD remains, for
    // the next legacy operational role somebody tries to treat as an eligibility: an unknown code
    // must read as "the platform cannot decide", never as "you are not eligible".
    const d = await ctx.authorizeObjectAction(reader, {
      actor: actor("prn-tech", "reorder.purchaseOrder.read"), capabilityKey: "reorder.purchaseOrder.read",
      predicates: [{ kind: "WORK_ELIGIBILITY", qualificationCode: "SOME_UNMIGRATED_LEGACY_ROLE" }],
    });
    assert.equal(d.allowed, false);
    assert.equal(d.reason, "WORK_ELIGIBILITY_UNMAPPED");
    assert.equal(d.detail, "SOME_UNMIGRATED_LEGACY_ROLE");
  });

  await t.test("a governed qualification resolves through the workforce authority", async () => {
    await q(`INSERT INTO eos_workforce.employee_work_eligibility
               (id,tenant_id,employee_id,qualification_code,effective_from,assigned_by)
             VALUES ('we1',$1,'emp-tech','SERVICE_TECHNICIAN',now(),'fixture')`, [T]);
    const ok = await ctx.authorizeObjectAction(reader, {
      actor: actor("prn-tech", "x.y"), capabilityKey: "x.y",
      predicates: [{ kind: "WORK_ELIGIBILITY", qualificationCode: "SERVICE_TECHNICIAN" }],
    });
    assert.equal(ok.allowed, true);
    const no = await ctx.authorizeObjectAction(reader, {
      actor: actor("prn-other", "x.y"), capabilityKey: "x.y",
      predicates: [{ kind: "WORK_ELIGIBILITY", qualificationCode: "SERVICE_TECHNICIAN" }],
    });
    assert.equal(no.reason, "WORK_ELIGIBILITY_MISSING");
  });

  await t.test("Operational Scope is NOT Record Assignment", async () => {
    // Two different authorities. Holding warehouse scope must not convey somebody else's request.
    await q(`INSERT INTO eos_ops.warehouses (id,tenant_id,operating_company_key,name,site_label,status,provenance,created_by,updated_by)
             VALUES ('w1',$1,'taylor','Main','Main Site','ACTIVE','NATIVE','fixture','fixture') ON CONFLICT DO NOTHING`, [T]);
    await q(`INSERT INTO eos_workforce.employee_operational_scopes
               (id,tenant_id,employee_id,scope_type,scope_id,effective_from,assigned_by)
             VALUES ('os1',$1,'emp-tech','WAREHOUSE','w1',now(),'fixture')`, [T]);
    const scoped = await ctx.authorizeObjectAction(reader, {
      actor: actor("prn-tech", "x.y"), capabilityKey: "x.y",
      predicates: [{ kind: "OPERATIONAL_SCOPE", scopeType: "WAREHOUSE" }],
    });
    assert.equal(scoped.allowed, true, "the technician works in that warehouse");
    const theirs = await ctx.authorizeObjectAction(reader, {
      actor: actor("prn-tech", "x.y"), capabilityKey: "x.y",
      predicates: ASSIGNED, record: { recordKind: "reorderRequest", recordId: "ro-theirs" },
    });
    assert.equal(theirs.reason, "NOT_ASSIGNED",
      "and still cannot see a colleague's request in the same warehouse");
  });


  await t.test("PARTS_ASSOCIATE is a governed qualification now, not UNMAPPED", async () => {
    assert.equal(ctx.GOVERNED_QUALIFICATION_CODES.has("PARTS_OPERATIONS"), true);
    const d = await ctx.authorizeObjectAction(reader, {
      actor: actor("prn-tech", "reorder.request.read"), capabilityKey: "reorder.request.read",
      predicates: [{ kind: "WORK_ELIGIBILITY", qualificationCode: "PARTS_OPERATIONS" }],
    });
    assert.notEqual(d.reason, "WORK_ELIGIBILITY_UNMAPPED", "the vocabulary exists");
    assert.equal(d.reason, "WORK_ELIGIBILITY_MISSING", "and this Employee simply does not hold it");
    await q(`INSERT INTO eos_workforce.employee_work_eligibility
               (id,tenant_id,employee_id,qualification_code,effective_from,assigned_by)
             VALUES ('we-pa',$1,'emp-tech','PARTS_OPERATIONS',now(),'fixture')`, [T]);
    const ok = await ctx.authorizeObjectAction(reader, {
      actor: actor("prn-tech", "reorder.request.read"), capabilityKey: "reorder.request.read",
      predicates: [{ kind: "WORK_ELIGIBILITY", qualificationCode: "PARTS_OPERATIONS" }],
    });
    assert.equal(ok.allowed, true);
  });

  await t.test("REORDER_QUEUE scope is company-keyed, and the trigger refuses an unknown target", async () => {
    await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id,operating_company_id,status,source,established_by,updated_by)
             VALUES ($1,'taylor','ACTIVE','fixture','fixture','fixture') ON CONFLICT DO NOTHING`, [T]);
    await q(`INSERT INTO eos_policy.tenant_operating_company_keys
               (tenant_id,operating_company_id,operating_company_key,status,provenance,source,established_by,updated_by)
             VALUES ($1,'taylor','taylor','ACTIVE','MIGRATED','fixture','fixture','fixture') ON CONFLICT DO NOTHING`, [T]);
    // The unconditional warehouse foreign key is gone, but the guarantee is not: a scope row still
    // cannot name a target that does not exist, now checked per type.
    await assert.rejects(q(`INSERT INTO eos_workforce.employee_operational_scopes
        (id,tenant_id,employee_id,scope_type,scope_id,effective_from,assigned_by)
      VALUES ('os-bad',$1,'emp-tech','REORDER_QUEUE','no-such-company',now(),'fixture')`, [T]),
    /operating company key/);
    await assert.rejects(q(`INSERT INTO eos_workforce.employee_operational_scopes
        (id,tenant_id,employee_id,scope_type,scope_id,effective_from,assigned_by)
      VALUES ('os-bad2',$1,'emp-tech','WAREHOUSE','no-such-warehouse',now(),'fixture')`, [T]),
    /warehouse/);
  });

  const OWN_PATH = [{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }];
  const QUEUE_PATH = [{ kind: "OPERATIONAL_SCOPE", scopeType: "REORDER_QUEUE", scopeId: "taylor" }];

  await t.test("capability WITHOUT queue scope cannot see the queue", async () => {
    const d = await ctx.authorizeAnyPath(reader, {
      actor: actor("prn-tech", "reorder.request.read"), capabilityKey: "reorder.request.read",
      paths: [OWN_PATH, QUEUE_PATH], record: { recordKind: "reorderRequest", recordId: "ro-theirs" },
    });
    assert.equal(d.allowed, false);
    assert.equal(d.reason, "NOT_ASSIGNED", "the narrowest path's reason, and it is the actionable one");
  });

  await t.test("queue scope WITHOUT the capability grants nothing", async () => {
    await q(`INSERT INTO eos_workforce.employee_operational_scopes
               (id,tenant_id,employee_id,scope_type,scope_id,effective_from,assigned_by)
             VALUES ('os-q-other',$1,'emp-other','REORDER_QUEUE','taylor',now(),'fixture')`, [T]);
    const d = await ctx.authorizeAnyPath(reader, {
      actor: actor("prn-other"), capabilityKey: "reorder.request.read",
      paths: [OWN_PATH, QUEUE_PATH], record: { recordKind: "reorderRequest", recordId: "ro-mine" },
    });
    assert.equal(d.reason, "CAPABILITY_MISSING", "both are required; neither implies the other");
  });

  await t.test("queue scope PLUS capability reaches a record the caller is not assigned to", async () => {
    const d = await ctx.authorizeAnyPath(reader, {
      actor: actor("prn-other", "reorder.request.read"), capabilityKey: "reorder.request.read",
      paths: [OWN_PATH, QUEUE_PATH], record: { recordKind: "reorderRequest", recordId: "ro-mine" },
    });
    assert.equal(d.allowed, true, "the QUEUE path does not need an assignment");
  });

  await t.test("TECHNICIAN: own records only, and no queue by any route", async () => {
    // Assigned -> allowed.
    const mine = await ctx.authorizeAnyPath(reader, {
      actor: actor("prn-tech", "reorder.request.read"), capabilityKey: "reorder.request.read",
      paths: [OWN_PATH, QUEUE_PATH], record: { recordKind: "reorderRequest", recordId: "ro-mine" },
    });
    assert.equal(mine.allowed, true);
    // Not assigned -> refused, even though this Employee holds PARTS_ASSOCIATE eligibility AND an
    // unrelated WAREHOUSE operational scope. Neither is queue scope.
    const theirs = await ctx.authorizeAnyPath(reader, {
      actor: actor("prn-tech", "reorder.request.read"), capabilityKey: "reorder.request.read",
      paths: [OWN_PATH, QUEUE_PATH], record: { recordKind: "reorderRequest", recordId: "ro-theirs" },
    });
    assert.equal(theirs.allowed, false);
    assert.equal(theirs.reason, "NOT_ASSIGNED");
    const { rows } = await q(
      `SELECT scope_type FROM eos_workforce.employee_operational_scopes
        WHERE tenant_id=$1 AND employee_id='emp-tech' AND effective_to IS NULL`, [T]);
    assert.deepEqual(rows.map((r) => r.scope_type), ["WAREHOUSE"], "technician has no REORDER_QUEUE scope");
  });

  await t.test("the two refusals stay distinct", async () => {
    const notAssigned = await ctx.authorizeObjectAction(reader, {
      actor: actor("prn-tech", "reorder.request.read"), capabilityKey: "reorder.request.read",
      predicates: OWN_PATH, record: { recordKind: "reorderRequest", recordId: "ro-theirs" },
    });
    const outsideScope = await ctx.authorizeObjectAction(reader, {
      actor: actor("prn-tech", "reorder.request.read"), capabilityKey: "reorder.request.read",
      predicates: QUEUE_PATH,
    });
    assert.equal(notAssigned.reason, "NOT_ASSIGNED");
    assert.equal(outsideScope.reason, "OUTSIDE_OPERATIONAL_SCOPE");
    assert.notEqual(notAssigned.reason, outsideScope.reason, "these must never be merged");
  });

  // ════════════════ THE CANONICAL PARTS PERSONA ════════════════
  //
  // One Security Role's worth of capability, held identically by two Employees, so that every difference
  // between the two answers below is a WORK ELIGIBILITY fact and nothing else. The qualification is taken from
  // reorderAssignmentAuthority.REORDER_ASSIGNMENT_QUALIFICATION, so the read/persona path and the assignment
  // command cannot drift apart: one constant, two consumers.
  const PARTS_QUALIFICATION = reorderAssignment.REORDER_ASSIGNMENT_QUALIFICATION;
  const PARTS_ELIGIBILITY = [{ kind: "WORK_ELIGIBILITY", qualificationCode: PARTS_QUALIFICATION }];

  await t.test("PERSONA POSITIVE/NEGATIVE: the same Security Role differs only by PARTS_OPERATIONS", async () => {
    assert.equal(PARTS_QUALIFICATION, "PARTS_OPERATIONS", "the Reorder qualification is the Parts one");
    assert.equal(ctx.GOVERNED_QUALIFICATION_CODES.has(PARTS_QUALIFICATION), true, "and it is governed vocabulary");

    for (const [pid, eid, sub, num] of [
      ["prn-parts", "emp-parts", "uid-parts", "E3"],
      ["prn-parts-noqual", "emp-parts-noqual", "uid-parts-noqual", "E4"],
    ]) {
      await q(`INSERT INTO eos_policy.principals (id,external_subject,identity_provider,status)
               VALUES ($1,$2,'firebase','active')`, [pid, sub]);
      await q(`INSERT INTO eos_policy.tenant_memberships (id,tenant_id,principal_id,status)
               VALUES ($1,$2,$3,'active')`, [`mem-${pid}`, T, pid]);
      await q(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id,employee_number)
               VALUES ($1,$2,'ACTIVE','taylor',$3)`, [eid, T, num]);
      await q(`INSERT INTO eos_policy.employee_principal_links
                 (id,tenant_id,principal_id,employee_id,operating_company_id,link_source,status,asserted_by,assertion_reason)
               VALUES ($1,$2,$3,$4,'taylor','OPERATOR_ASSERTED','active','fixture','test fixture')`,
      [`lnk-${eid}`, T, pid, eid]);
    }
    // ONE authority dimension separates them: emp-parts holds the qualification, emp-parts-noqual does not.
    await q(`INSERT INTO eos_workforce.employee_work_eligibility
               (id,tenant_id,employee_id,qualification_code,effective_from,assigned_by)
             VALUES ('we-parts',$1,'emp-parts',$2,now(),'fixture')`, [T, PARTS_QUALIFICATION]);

    // POSITIVE -- capability present AND PARTS_OPERATIONS present.
    for (const key of ["reorder.request.read", "reorder.request.assign"]) {
      const ok = await ctx.authorizeObjectAction(reader, {
        actor: actor("prn-parts", key), capabilityKey: key, predicates: PARTS_ELIGIBILITY,
      });
      assert.deepEqual([ok.allowed, ok.reason], [true, "ALLOWED"], `${key} refused the qualified Parts persona`);
    }

    // NEGATIVE -- the SAME capability set, the same employment status, the same active link, no qualification.
    for (const key of ["reorder.request.read", "reorder.request.assign"]) {
      const no = await ctx.authorizeObjectAction(reader, {
        actor: actor("prn-parts-noqual", key), capabilityKey: key, predicates: PARTS_ELIGIBILITY,
      });
      assert.equal(no.allowed, false);
      assert.equal(no.reason, "WORK_ELIGIBILITY_MISSING", `${key} allowed an unqualified holder of the same Role`);
      assert.equal(no.predicate, "WORK_ELIGIBILITY", "the refusal must name the authority that refused");
    }

    // AND WAREHOUSE_OPERATIONS IS NOT A SUBSTITUTE. Granting the warehouse code to the unqualified persona
    // changes nothing: the two codes are distinct eligibilities and neither is inferred from the other.
    await q(`INSERT INTO eos_workforce.employee_work_eligibility
               (id,tenant_id,employee_id,qualification_code,effective_from,assigned_by)
             VALUES ('we-parts-wh',$1,'emp-parts-noqual','WAREHOUSE_OPERATIONS',now(),'fixture')`, [T]);
    const stillNo = await ctx.authorizeObjectAction(reader, {
      actor: actor("prn-parts-noqual", "reorder.request.read"), capabilityKey: "reorder.request.read",
      predicates: PARTS_ELIGIBILITY,
    });
    assert.equal(stillNo.reason, "WORK_ELIGIBILITY_MISSING",
      "WAREHOUSE_OPERATIONS satisfied a PARTS_OPERATIONS predicate -- the codes have been aliased");
  });

  await t.test("QUEUE SCOPE SEPARATION: the qualification and REORDER_QUEUE fail DIFFERENTLY", async () => {
    // REORDER_QUEUE stays the Operational Scope for shared queue visibility. It answers WHICH RECORDS; the
    // qualification answers WHAT KIND OF WORK. Collapsing them would make one refusal for two questions.
    //
    //   emp-parts        PARTS_OPERATIONS, NO REORDER_QUEUE scope
    //   emp-parts-noqual REORDER_QUEUE scope, NO PARTS_OPERATIONS
    await q(`INSERT INTO eos_workforce.employee_operational_scopes
               (id,tenant_id,employee_id,scope_type,scope_id,effective_from,assigned_by)
             VALUES ('os-q-parts-noqual',$1,'emp-parts-noqual','REORDER_QUEUE','taylor',now(),'fixture')`, [T]);
    const BOTH = [...PARTS_ELIGIBILITY,
      { kind: "OPERATIONAL_SCOPE", scopeType: "REORDER_QUEUE", scopeId: "taylor" }];

    const qualifiedNoScope = await ctx.authorizeObjectAction(reader, {
      actor: actor("prn-parts", "reorder.request.read"), capabilityKey: "reorder.request.read", predicates: BOTH,
    });
    const scopedNoQualification = await ctx.authorizeObjectAction(reader, {
      actor: actor("prn-parts-noqual", "reorder.request.read"), capabilityKey: "reorder.request.read", predicates: BOTH,
    });

    assert.deepEqual([qualifiedNoScope.reason, qualifiedNoScope.predicate],
      ["OUTSIDE_OPERATIONAL_SCOPE", "OPERATIONAL_SCOPE"],
      "the qualified persona must be refused by the SCOPE, naming the scope");
    assert.deepEqual([scopedNoQualification.reason, scopedNoQualification.predicate],
      ["WORK_ELIGIBILITY_MISSING", "WORK_ELIGIBILITY"],
      "the scoped persona must be refused by the QUALIFICATION, naming the qualification");
    assert.notEqual(qualifiedNoScope.reason, scopedNoQualification.reason,
      "the two authorities have been collapsed into one refusal");

    // Holding BOTH is what reaches the queue -- proving neither refusal above was the capability's.
    await q(`INSERT INTO eos_workforce.employee_operational_scopes
               (id,tenant_id,employee_id,scope_type,scope_id,effective_from,assigned_by)
             VALUES ('os-q-parts',$1,'emp-parts','REORDER_QUEUE','taylor',now(),'fixture')`, [T]);
    const both = await ctx.authorizeObjectAction(reader, {
      actor: actor("prn-parts", "reorder.request.read"), capabilityKey: "reorder.request.read", predicates: BOTH,
    });
    assert.equal(both.allowed, true, "qualification plus scope must reach the shared queue");

    // AND THE SCOPE IS STILL NOT THE QUALIFICATION: the queue scope alone, with no eligibility predicate
    // declared, reaches the queue -- which is exactly why the two may never be merged into one key.
    const scopeOnly = await ctx.authorizeObjectAction(reader, {
      actor: actor("prn-parts-noqual", "reorder.request.read"), capabilityKey: "reorder.request.read",
      predicates: [{ kind: "OPERATIONAL_SCOPE", scopeType: "REORDER_QUEUE", scopeId: "taylor" }],
    });
    assert.equal(scopeOnly.allowed, true, "queue visibility is decided by the scope the ACTION declares");
  });

  await t.test("WORK ORDER future compatibility: own-assignment is expressible, and distinct", async () => {
    // Not granted, not wired -- only proved expressible, through the SAME evaluator, as a
    // RECORD_ASSIGNMENT predicate rather than an Operational Scope one.
    await q(`INSERT INTO eos_ops.work_orders (id,tenant_id,operating_company_key,status,work_order_type,priority,provenance,customer_id,location_id,created_by_principal_id,created_at,updated_at)
             VALUES ('wo-1',$1,'taylor','WORK_IN_PROGRESS','SERVICE_CALL',3,'NATIVE','c1','l1','prn-admin',now(),now())`, [T]);
    await q(`INSERT INTO eos_ops.work_order_assignments
               (id,tenant_id,work_order_id,assignee_employee_id,effective_from,provenance,assigned_by_principal_id,source)
             VALUES ('wa1',$1,'wo-1','emp-tech',now(),'NATIVE','prn-admin','SCHEDULE')`, [T]);
    const complete = await ctx.authorizeObjectAction(reader, {
      actor: actor("prn-tech", "workOrder.lifecycle.complete"), capabilityKey: "workOrder.lifecycle.complete",
      predicates: ASSIGNED, record: { recordKind: "workOrder", recordId: "wo-1" },
    });
    assert.equal(complete.allowed, true);
    const other = await ctx.authorizeObjectAction(reader, {
      actor: actor("prn-other", "workOrder.lifecycle.complete"), capabilityKey: "workOrder.lifecycle.complete",
      predicates: ASSIGNED, record: { recordKind: "workOrder", recordId: "wo-1" },
    });
    assert.equal(other.reason, "NOT_ASSIGNED", "another Employee cannot complete somebody's Work Order");
    // Still ungranted in the catalog: expressibility is not authorization.
    const { rows } = await q(
      `SELECT count(*)::int n FROM eos_policy.role_capabilities rc
         JOIN eos_policy.capabilities c ON c.id = rc.capability_id
        WHERE c.key LIKE 'workOrder.lifecycle.%'`);
    assert.equal(rows[0].n, 0, "no lifecycle capability was granted by this slice");
  });
});

test("the evaluator introduces no Firebase and no scope string", () => {
  const src = require("node:fs").readFileSync(
    resolve(FUNCTIONS_DIR, "src/eosOps/contextualAuthorization.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const f of ["firebase", "firestore", "request.auth", "customClaims", "caller.role", "permissionCatalog"]) {
    assert.equal(src.toLowerCase().includes(f.toLowerCase()), false, `the evaluator reaches for ${f}`);
  }
  // Predicate TYPES, not an ambiguous scope string.
  assert.deepEqual([...ctx.CONTEXT_PREDICATE_KINDS].sort(),
    ["OPERATIONAL_SCOPE", "RECORD_ASSIGNMENT", "WORK_ELIGIBILITY"]);
  assert.equal(/scope\s*:\s*string/.test(src), false, "scope must be a typed predicate, never a string");
});
