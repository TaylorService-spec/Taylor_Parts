// PERFORMANCE GOAL AUTHORING ON EOS, against a real postgres:16 (G-1; Owner direction 2026-10-19; DECISIONS #G-1; resolves OD-B4-3).
//
// It proves, with the actor's capability set stated directly (so nothing here depends on which Roles hold what -- the holders are proved offline, g1GoalAuthoring.test.mjs):
//   1. THE LIFECYCLE: draft -> approve (by SOMEONE ELSE, with a reason) -> a successor supersedes it in ONE transaction (the predecessor's window is closed, its
//      target / version / approval evidence untouched, no instant with two approved versions) -> retire (the window is closed at the retiring day, never deleted).
//   2. VERSIONING: the rules the read model expects -- a first version cannot overlap an approved one, only an APPROVED version is superseded, a successor starts
//      later, two drafts for one predecessor cannot both win (also under concurrency), a migrated draft cannot be approved, a registry refusal writes nothing.
//   3. THE SELF RULES: nobody approves their own draft (SELF_APPROVAL_FORBIDDEN); an employee does not author, approve or retire their own target (SELF_TARGETING_FORBIDDEN).
//   4. REACH, per scope: FIRM / OPERATING_COMPANY / LOCATION / EMPLOYEE exactly as the reads decide it; BUSINESS_UNIT and TEAM are refused; a foreign company's warehouse,
//      employee or goal reads EXACTLY as a nonexistent one.
//   5. IDEMPOTENCY: the same key and request replays and writes nothing; the same key with another request, or another command, is a conflict.
//   6. EVERY refusal leaves ZERO trace (no goal, no command record, no audit row); every applied command writes exactly ONE audit row.
//   7. OFFERED == ACCEPTED: what the options read offers, a command accepts; what it withholds, a command refuses.
import { endPoolAndDrain } from "./support/poolTeardown.mjs";
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
const goals = require("../lib/eosOps/performanceGoalAuthoring.js");
const reads = require("../lib/eosOps/performanceGoalReads.js");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

const CREATE = "performance.goal.create";
const SUPERSEDE = "performance.goal.supersede";
const APPROVE = "performance.goal.approve";
const RETIRE = "performance.goal.retire";
const READ = "performance.goal.read";
const W = [CREATE, SUPERSEDE, APPROVE, RETIRE];
const RECEIVE = "inventory.stock.receive";
const NOW = new Date("2026-12-20T15:00:00.000Z");

test("Performance goal authoring on PostgreSQL: lifecycle, versioning, the self rules, reach, replay and the zero-trace refusals", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `g1_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await endPoolAndDrain(pool);
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], { maxBuffer: 256 * 1024 * 1024,
    cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe",
  });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 8 });
  const q = (text, values = []) => pool.query(text, values);
  const repo = new PostgresPolicyRepository(pool);

  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1')`);
  const principal = async (subject) => repo.transact({ tenantId: "t1", uid: "uid-fixture" }, async (tx) => {
    const p = await tx.createPrincipal({ externalSubject: subject, identityProvider: "firebase" });
    await tx.createTenantMembership(p.id);
    return p.id;
  });
  const mgr = await principal("uid-manager");          // Taylor, Role salesManager (sees salespeople), Employee e-m
  const approver = await principal("uid-approver");    // Taylor, Role salesManager, Employee e-m2 -- the "someone else"
  const rep = await principal("uid-rep");              // Taylor, Role salesperson (sees only herself), Employee e-rep
  const repV = await principal("uid-rep-v");           // Ventana, Role salesperson, Employee e-rep-v
  const taylorUser = await principal("uid-taylor");    // Taylor only, WAREHOUSE scope wh-1 and wh-v (the latter is another company's)
  const ventanaUser = await principal("uid-ventana");  // Ventana only
  const admin = await principal("uid-admin");          // Taylor with an explicit Ventana company-access grant: REACHES BOTH companies
  const nobody = await principal("uid-nobody");        // no Employee link, no company authority

  await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id, operating_company_id, status, source, established_by, updated_by)
           VALUES ('t1','taylor','ACTIVE','fixture','f','f'), ('t1','ventana','ACTIVE','fixture','f','f')`);
  await q(`INSERT INTO eos_policy.tenant_operating_company_keys
             (tenant_id, operating_company_id, operating_company_key, status, provenance, source, established_by, updated_by)
           VALUES ('t1','taylor','sample-co','ACTIVE','NATIVE','fixture','f','f'), ('t1','ventana','ventana-co','ACTIVE','NATIVE','fixture','f','f')`);
  await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id, updated_at)
           VALUES ('e-m','t1','ACTIVE','taylor','2020-01-01T00:00:00Z'), ('e-m2','t1','ACTIVE','taylor','2020-01-01T00:00:00Z'),
                  ('e-rep','t1','ACTIVE','taylor','2020-01-01T00:00:00Z'), ('e-rep-v','t1','ACTIVE','ventana','2020-01-01T00:00:00Z'),
                  ('e-t','t1','ACTIVE','taylor','2020-01-01T00:00:00Z'), ('e-v','t1','ACTIVE','ventana','2020-01-01T00:00:00Z'),
                  ('e-a','t1','ACTIVE','taylor','2020-01-01T00:00:00Z')`);
  await q(`INSERT INTO eos_policy.employee_principal_links (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, asserted_by, assertion_reason, status)
           VALUES ('l-m','t1',$1,'e-m','taylor','OPERATOR_ASSERTED','f','test','active'), ('l-m2','t1',$2,'e-m2','taylor','OPERATOR_ASSERTED','f','test','active'),
                  ('l-r','t1',$3,'e-rep','taylor','OPERATOR_ASSERTED','f','test','active'), ('l-rv','t1',$4,'e-rep-v','ventana','OPERATOR_ASSERTED','f','test','active'),
                  ('l-t','t1',$5,'e-t','taylor','OPERATOR_ASSERTED','f','test','active'), ('l-v','t1',$6,'e-v','ventana','OPERATOR_ASSERTED','f','test','active'),
                  ('l-a','t1',$7,'e-a','taylor','OPERATOR_ASSERTED','f','test','active')`, [mgr, approver, rep, repV, taylorUser, ventanaUser, admin]);
  {
    // Written under the Administration marker, exactly as the governed grantCompanyAuthority command writes it (a trigger refuses any other writer).
    const gc = await pool.connect();
    try {
      await gc.query("BEGIN");
      await gc.query(`SELECT set_config('eos_policy.administration_command', 'on', true)`);
      await gc.query(`INSERT INTO eos_policy.employee_company_authority_grants (id, tenant_id, employee_id, operating_company_id, reason, granted_by)
                      VALUES ('ecag-a-v','t1','e-a','ventana','fixture: reach both companies','f')`);
      await gc.query("COMMIT");
    } catch (e) { await gc.query("ROLLBACK"); throw e; } finally { gc.release(); }
  }
  for (const key of ["salesManager", "salesperson"]) {
    await q(`INSERT INTO eos_policy.roles (id,tenant_id,key,name,origin,created_by,updated_by) VALUES ($1,'t1',$2,$2,'SYSTEM','fixture','fixture')`, [`role-${key}`, key]);
  }
  const assign = (id, principalId, roleKey) => q(
    `INSERT INTO eos_policy.user_role_assignments (id,tenant_id,principal_id,role_id,scope_type,scope_value,status,granted_by,access_version_at_grant,created_by,updated_by)
     VALUES ($1,'t1',$2,$3,'global',NULL,'active','f',0,'f','f')`, [id, principalId, `role-${roleKey}`]);
  await assign("a-m", mgr, "salesManager");
  await assign("a-m2", approver, "salesManager");
  await assign("a-r", rep, "salesperson");
  await assign("a-rv", repV, "salesperson");
  await q(`INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by) VALUES
             ('wh-1','t1','sample-co','North','S','ACTIVE','NATIVE','f','f'), ('wh-2','t1','sample-co','South','S','ACTIVE','NATIVE','f','f'),
             ('wh-v','t1','ventana-co','Valley','S','ACTIVE','NATIVE','f','f')`);
  await q(`INSERT INTO eos_workforce.employee_operational_scopes (id, tenant_id, employee_id, scope_type, scope_id, effective_from, assigned_by)
           VALUES ('os-t-1','t1','e-t','WAREHOUSE','wh-1', now(),'fixture'), ('os-t-v','t1','e-t','WAREHOUSE','wh-v', now(),'fixture')`);

  const actor = (principalId, caps) => ({ tenantId: "t1", principalId, capabilities: new Set(caps) });
  const refusal = async (fn) => { try { await fn(); } catch (err) { return err; } assert.fail("expected a refusal"); };
  const deps = { pool, now: () => NOW };
  let seq = 0;
  const key = (p = "k") => `${p}-${++seq}`;
  const create = (who, caps, input, d = deps) => goals.createPerformanceGoalDraft(d, actor(who, caps), { idempotencyKey: key("c"), ...input });
  const approve = (who, caps, goalId, reason = "Agreed with the owner", extra = {}) => goals.approvePerformanceGoal(deps, actor(who, caps), { goalId, reason, idempotencyKey: key("a"), ...extra });
  const retire = (who, caps, goalId, reason = "No longer measured") => goals.retirePerformanceGoal(deps, actor(who, caps), { goalId, reason, idempotencyKey: key("r") });
  const row = async (id) => (await q(`SELECT to_char(effective_from,'YYYY-MM-DD') f, to_char(effective_to,'YYYY-MM-DD') t, * FROM eos_ops.performance_goals WHERE tenant_id='t1' AND goal_id=$1`, [id])).rows[0];
  const versions = async (target) => (await reads.listPerformanceGoalVersions({ pool }, actor(admin, [READ]), { target })).versions;
  const current = async (target, onDate) => (await reads.listCurrentPerformanceGoals({ pool }, actor(admin, [READ]), { targets: [target], onDate })).results[0];
  const counts = async () => (await q(`SELECT (SELECT count(*)::int FROM eos_ops.performance_goals) g, (SELECT count(*)::int FROM eos_ops.performance_goal_commands) c,
                                              (SELECT count(*)::int FROM eos_policy.audit_events) a,
                                              -- a STATE HASH of every goal row's status / window / version / approval, so a refusal that edits a row without adding one is seen
                                              (SELECT md5(coalesce(string_agg(goal_id || '|' || status || '|' || coalesce(effective_to::text, '') || '|' || version || '|' || coalesce(approved_by_ref, ''), ',' ORDER BY goal_id), ''))
                                                 FROM eos_ops.performance_goals) h`)).rows[0];
  const audits = async (targetId) => (await q(`SELECT action, actor_uid FROM eos_policy.audit_events WHERE target_id = $1 ORDER BY occurred_at, action`, [targetId])).rows;
  /** Insert a goal row directly (a fixture), as the Firebase copy / another instance would have left it. */
  const seed = (over) => {
    const g = { id: `seed-${randomUUID().slice(0, 8)}`, metric: "service.workOrder.pastDue.count", scope: "FIRM", scopeId: null, value: 5, unit: "COUNT", direction: "AT_MOST", currency: null,
      from: "2026-01-01", to: null, status: "DRAFT", version: 1, supersedes: null, author: "p-other", provenance: "NATIVE", ...over };
    return q(`INSERT INTO eos_ops.performance_goals
                (tenant_id, goal_id, metric_id, target_scope_type, target_scope_id, target_value, unit, direction, currency, effective_from, effective_to, status, version,
                 created_by_ref, created_at_ms, approved_by_ref, approved_at_ms, supersedes_goal_id, provenance)
              VALUES ('t1',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,1700000000000,$14,$15,$16,$17)`,
    [g.id, g.metric, g.scope, g.scopeId, g.value, g.unit, g.direction, g.currency, g.from, g.to, g.status, g.version, g.author,
      g.status === "DRAFT" ? null : "p-approver", g.status === "DRAFT" ? null : 1700000100000, g.supersedes, g.provenance]).then(() => g.id);
  };
  const FIRM = { metricId: "service.workOrder.pastDue.count", targetScopeType: "FIRM" };
  const draft = (over = {}) => ({ ...FIRM, targetValue: 5, unit: "COUNT", direction: "AT_MOST", effectiveFrom: "2026-11-01", ...over });

  // ════════════════════ 1. THE LIFECYCLE ════════════════════
  const L = { v1: null, v2: null };
  await t.test("lifecycle: a draft is not a target; the author cannot approve it; someone else does, with a reason", async () => {
    const before = await counts();
    const made = await create(mgr, W, draft());
    L.v1 = made.goalId;
    assert.deepEqual([made.outcome, made.status, made.version, made.supersedesGoalId], ["applied", "DRAFT", 1, null]);
    assert.match(made.goalId, /^goal_[0-9a-f-]{36}$/, "the id is the server's");
    const stored = await row(L.v1);
    assert.deepEqual([stored.status, stored.provenance, stored.created_by_ref, stored.approved_by_ref, stored.approved_at_ms, stored.target_value, stored.f, stored.t],
      ["DRAFT", "NATIVE", mgr, null, null, "5", "2026-11-01", null], "authored by the EOS Principal, native, unapproved");
    assert.equal((await current(FIRM, "2026-11-15")).goal, null, "a DRAFT is never the target in force");

    // Segregation of duties: twice over, and neither a write.
    const self = await refusal(() => approve(mgr, W, L.v1));
    assert.deepEqual([self.code, self.category], ["SELF_APPROVAL_FORBIDDEN", "FORBIDDEN"]);
    assert.equal((await row(L.v1)).status, "DRAFT");
    const mid = await counts();
    assert.deepEqual([mid.g, mid.c, mid.a], [before.g + 1, before.c + 1, before.a + 1], "one goal, one command record, one audit row -- and the refused approval added nothing");

    assert.equal((await refusal(() => approve(approver, W, L.v1, "   "))).code, "REASON_REQUIRED", "a decision without a reason is not governance");
    const ok = await approve(approver, W, L.v1, "Agreed with operations");
    assert.deepEqual([ok.outcome, ok.status, ok.version, ok.supersededGoalId, ok.predecessorClosedAt], ["applied", "APPROVED", 1, null, null]);
    const live = await row(L.v1);
    assert.deepEqual([live.status, live.approved_by_ref, live.created_by_ref, typeof live.approved_at_ms], ["APPROVED", approver, mgr, "string"], "approver and author are two Principals");
    assert.equal((await current(FIRM, "2026-11-15")).goal.targetValue, 5);
    assert.equal((await current(FIRM, "2026-10-31")).goal, null, "not before its start date");
    assert.deepEqual((await audits(L.v1)).map((a) => [a.action, a.actor_uid]), [["createPerformanceGoalDraft", mgr], ["approvePerformanceGoal", approver]]);
    assert.equal((await refusal(() => approve(approver, W, L.v1))).code, "GOAL_NOT_DRAFT", "only a DRAFT may be approved");
  });

  await t.test("lifecycle: a successor supersedes in ONE transaction -- the predecessor's window is closed, its evidence untouched, never two targets in force", async () => {
    const before = await row(L.v1);
    const made = await create(mgr, W, draft({ targetValue: 3, effectiveFrom: "2026-12-01", supersedesGoalId: L.v1 }));
    L.v2 = made.goalId;
    assert.deepEqual([made.status, made.version, made.supersedesGoalId], ["DRAFT", 2, L.v1]);
    assert.equal((await current(FIRM, "2026-12-15")).goal.targetValue, 5, "until it is approved the old target stands");
    const ok = await approve(approver, W, L.v2);
    assert.deepEqual([ok.status, ok.supersededGoalId, ok.predecessorClosedAt], ["APPROVED", L.v1, "2026-11-30"]);
    const old = await row(L.v1);
    assert.deepEqual([old.status, old.t], ["SUPERSEDED", "2026-11-30"]);
    // History is not rewritten: everything but the status and the closing end of the window is what it was.
    for (const col of ["target_value", "version", "f", "created_by_ref", "created_at_ms", "approved_by_ref", "approved_at_ms", "unit", "direction"]) {
      assert.equal(String(old[col]), String(before[col]), `${col} of the predecessor is unchanged`);
    }
    // November's target stays November's: the superseded row keeps its number and its window (the read model resolves only APPROVED versions "on a date", so history is
    // read from the versions, exactly as the management history view reads it).
    const [h1] = await versions(FIRM);
    assert.deepEqual([h1.goalId, h1.targetValue, h1.effectiveFrom, h1.effectiveTo, h1.status], [L.v1, 5, "2026-11-01", "2026-11-30", "SUPERSEDED"]);
    assert.equal((await current(FIRM, "2026-12-15")).goal.targetValue, 3);
    for (const d of ["2026-11-30", "2026-12-01", "2027-03-01"]) assert.equal((await current(FIRM, d)).unavailableReason, null, `no ambiguity on ${d}`);
    assert.deepEqual((await versions(FIRM)).map((v) => [v.version, v.status]), [[1, "SUPERSEDED"], [2, "APPROVED"]]);
    assert.deepEqual((await audits(L.v2)).map((a) => a.action), ["createPerformanceGoalDraft", "supersedePerformanceGoal"]);
  });

  await t.test("lifecycle: retire closes the window at the retiring day (never deleted); a goal not yet started closes at its own start", async () => {
    assert.equal((await refusal(() => retire(approver, W, L.v1))).code, "GOAL_NOT_RETIRABLE", "a superseded version is history, not retirable");
    const out = await retire(approver, W, L.v2, "We stopped measuring this");
    assert.deepEqual([out.status, out.closedAt], ["RETIRED", "2026-12-20"]);
    assert.deepEqual([(await row(L.v2)).status, (await row(L.v2)).t], ["RETIRED", "2026-12-20"]);
    const retired = (await versions(FIRM)).find((v) => v.goalId === L.v2);
    assert.deepEqual([retired.status, retired.targetValue, retired.effectiveFrom, retired.effectiveTo], ["RETIRED", 3, "2026-12-01", "2026-12-20"], "the period it governed stays on record");
    assert.equal((await current(FIRM, "2026-12-21")).goal, null, "after the retirement there is no target");
    assert.deepEqual((await audits(L.v2)).map((a) => a.action), ["createPerformanceGoalDraft", "supersedePerformanceGoal", "retirePerformanceGoal"]);
    assert.equal((await refusal(() => retire(approver, W, L.v2))).code, "GOAL_NOT_RETIRABLE", "a retired goal is not reopened or retired twice");
    // A bounded window is never LENGTHENED by a retire: it closes at its own end.
    const metric = { metricId: "purchasing.purchaseOrder.open.count", targetScopeType: "FIRM" };
    const f = await create(mgr, W, { ...metric, targetValue: 8, unit: "COUNT", direction: "AT_MOST", effectiveFrom: "2026-05-01", effectiveTo: "2026-06-30" });
    await approve(approver, W, f.goalId);
    assert.equal((await retire(approver, W, f.goalId)).closedAt, "2026-06-30");
    assert.equal((await row(f.goalId)).t, "2026-06-30");
    // The retire reason is audited verbatim; the draft's author may retire what someone else approved.
    const g = await create(mgr, W, { ...metric, targetValue: 9, unit: "COUNT", direction: "AT_MOST", effectiveFrom: "2026-07-01" });
    await approve(approver, W, g.goalId);
    assert.equal((await retire(mgr, W, g.goalId)).status, "RETIRED");
  });

  await t.test("versions: a first version after a retired / superseded history is the target's max + 1 -- a number is never reused", async () => {
    const before = await versions(FIRM);
    assert.deepEqual(before.map((v) => v.version), [1, 2]);
    const nxt = await create(mgr, W, draft({ effectiveFrom: "2027-02-01" }));
    assert.equal(nxt.version, 3, "not 1 again");
    assert.deepEqual((await versions(FIRM)).map((v) => v.version), [1, 2, 3]);
    assert.equal((await row(nxt.goalId)).version, 3);
    // The same for the target whose history lives in the retire test (two retired first versions).
    const open = { metricId: "purchasing.purchaseOrder.open.count", targetScopeType: "FIRM", unit: "COUNT", direction: "AT_MOST", targetValue: 7, effectiveFrom: "2029-01-01" };
    assert.equal((await create(mgr, W, open)).version, 3);
  });

  // ════════════════════ 2. VERSIONING ════════════════════
  await t.test("versioning: only an APPROVED version is superseded; a first version cannot overlap an approved one; a successor starts later", async () => {
    const m = { metricId: "service.workOrder.readyToSchedule.count", targetScopeType: "FIRM", unit: "COUNT", direction: "AT_MOST" };
    const a = await create(mgr, W, { ...m, targetValue: 10, effectiveFrom: "2026-11-01" });
    // A DRAFT is replaced by a new draft, never superseded.
    assert.equal((await refusal(() => create(mgr, W, { ...m, targetValue: 9, effectiveFrom: "2026-12-01", supersedesGoalId: a.goalId }))).code, "GOAL_NOT_SUPERSEDABLE");
    await approve(approver, W, a.goalId);
    const before = await counts();
    const clash = await refusal(() => create(mgr, W, { ...m, targetValue: 4, effectiveFrom: "2027-01-01" }));
    assert.deepEqual([clash.code, clash.category], ["GOAL_ALREADY_IN_FORCE", "CONFLICT"]);
    assert.equal((await refusal(() => create(mgr, W, { ...m, targetValue: 4, effectiveFrom: "2026-11-01", supersedesGoalId: a.goalId }))).code, "GOAL_INVALID", "a successor must start AFTER its predecessor began");
    assert.equal((await refusal(() => create(mgr, W, { ...m, targetValue: 4, effectiveFrom: "2026-10-01", supersedesGoalId: a.goalId }))).code, "GOAL_INVALID");
    // A goal id of ANOTHER target (or none) reads the same: nonexistent.
    const other = await create(mgr, W, { metricId: "service.workOrder.partsBlocked.count", targetScopeType: "FIRM", unit: "COUNT", direction: "AT_MOST", targetValue: 2, effectiveFrom: "2026-11-01" });
    for (const id of [other.goalId, "goal_nope"]) {
      const e = await refusal(() => create(mgr, W, { ...m, targetValue: 4, effectiveFrom: "2026-12-01", supersedesGoalId: id }));
      assert.deepEqual([e.code, e.category], ["GOAL_NOT_FOUND", "NOT_FOUND"]);
    }
    const after = await counts();
    assert.deepEqual([after.g, after.c, after.a], [before.g + 1, before.c + 1, before.a + 1], "only the one valid 'other' draft was written");
    // A bounded window ends before a later first version begins: no overlap, so that IS a first version.
    const bounded = await create(mgr, W, { ...m, targetValue: 6, effectiveFrom: "2025-01-01", effectiveTo: "2025-12-31" });
    assert.equal(bounded.version, 2, "numbered max + 1 over the target's versions, even for a window that overlaps none");
  });

  await t.test("versioning: two drafts for one predecessor cannot both win -- also when approved at the same moment", async () => {
    const m = { metricId: "service.workOrder.schedulingConflict.count", targetScopeType: "FIRM", unit: "COUNT", direction: "AT_MOST" };
    const base = await create(mgr, W, { ...m, targetValue: 7, effectiveFrom: "2026-11-01" });
    await approve(approver, W, base.goalId);
    const s1 = await create(mgr, W, { ...m, targetValue: 6, effectiveFrom: "2026-12-01", supersedesGoalId: base.goalId });
    const s2 = await create(mgr, W, { ...m, targetValue: 4, effectiveFrom: "2027-01-01", supersedesGoalId: base.goalId });
    assert.deepEqual([s1.version, s2.version], [2, 3], "versions are the target's max + 1: two drafts for one predecessor never share a number");
    const results = await Promise.allSettled([approve(approver, W, s1.goalId), approve(admin, W, s2.goalId)]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1, "exactly one approval wins");
    const lost = results.find((r) => r.status === "rejected").reason;
    assert.deepEqual([lost.code, lost.category], ["GOAL_NOT_SUPERSEDABLE", "PRECONDITION_FAILED"]);
    const states = await versions({ ...FIRM, metricId: m.metricId });
    assert.equal(states.filter((v) => v.status === "APPROVED").length, 1);
    assert.equal(states.filter((v) => v.status === "DRAFT").length, 1, "the loser is still a draft, untouched");
    for (const d of ["2026-11-15", "2026-12-15", "2027-01-15", "2027-06-01"]) assert.equal((await current({ ...FIRM, metricId: m.metricId }, d)).unavailableReason, null, `no ambiguity on ${d}`);
    // Two UNRELATED drafts for one window (no predecessor) cannot both be approved either.
    const m2 = { metricId: "service.workOrder.partsBlocked.count", targetScopeType: "FIRM", unit: "COUNT", direction: "AT_MOST" };
    const d1 = await create(mgr, W, { ...m2, targetValue: 1, effectiveFrom: "2030-01-01" });
    const d2 = await create(mgr, W, { ...m2, targetValue: 2, effectiveFrom: "2030-01-01" });
    const race = await Promise.allSettled([approve(approver, W, d1.goalId), approve(admin, W, d2.goalId)]);
    assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(race.find((r) => r.status === "rejected").reason.code, "GOAL_ALREADY_IN_FORCE");
  });

  await t.test("versioning: the registry is the vocabulary -- a wrong unit, direction, currency, scope id or an inactive metric is refused with nothing written", async () => {
    const before = await counts();
    const bad = async (over, code) => assert.equal((await refusal(() => create(mgr, W, draft({ effectiveFrom: "2040-01-01", ...over })))).code, code, JSON.stringify(over));
    await bad({ metricId: "no.such.metric" }, "GOAL_INVALID");
    await bad({ metricId: "sales.invoiced.amount" }, "GOAL_INVALID");          // registered, not active for goals (its blocker is named)
    await bad({ unit: "PERCENT" }, "GOAL_INVALID");
    await bad({ direction: "AT_LEAST" }, "GOAL_INVALID");                      // the metric admits AT_MOST only
    await bad({ direction: "SIDEWAYS" }, "GOAL_INVALID");
    await bad({ currency: "USD" }, "GOAL_INVALID");                            // a currency on a count is a category error
    await bad({ targetValue: -1 }, "GOAL_INVALID");
    await bad({ targetValue: 1.5 }, "GOAL_INVALID");
    await bad({ targetValue: "5" }, "GOAL_INVALID");
    await bad({ targetScopeId: "x" }, "GOAL_INVALID");                         // a FIRM goal carries no id
    await bad({ effectiveFrom: "11/01/2026" }, "GOAL_INVALID");
    await bad({ effectiveFrom: "2026-11-01", effectiveTo: "2026-10-01" }, "GOAL_INVALID");
    await bad({ targetScopeType: "TEAM", targetScopeId: "t-1" }, "GOAL_INVALID"); // never bindable
    await bad({ targetScopeType: "FIRM", metricId: "sales.billed.amount", unit: "CURRENCY_MINOR", direction: "AT_LEAST" }, "GOAL_INVALID"); // a currency target needs its currency
    assert.deepEqual(await counts(), before, "zero trace");
  });

  await t.test("versioning: a draft copied from the previous system cannot be approved here -- its author cannot be compared with an approver", async () => {
    const id = await seed({ provenance: "MIGRATED", author: "fb-uid-author", metric: "service.workOrder.pastDue.count", from: "2031-01-01" });
    const before = await counts();
    const e = await refusal(() => approve(approver, W, id));
    assert.deepEqual([e.code, e.category], ["GOAL_AUTHOR_UNPROVABLE", "PRECONDITION_FAILED"]);
    assert.equal((await row(id)).status, "DRAFT");
    assert.deepEqual(await counts(), before);
  });

  // ════════════════════ 3. THE SELF RULES ════════════════════
  const EMP = (id, over = {}) => ({ metricId: "technician.workOrder.open.count", targetScopeType: "EMPLOYEE", targetScopeId: id, unit: "COUNT", direction: "AT_MOST", targetValue: 6, effectiveFrom: "2026-11-01", ...over });

  await t.test("self rules: a manager sets a report's target; nobody authors, approves or retires THEIR OWN target; a draft's author never approves it", async () => {
    const made = await create(mgr, W, EMP("e-rep"));
    assert.equal(made.status, "DRAFT", "a sales manager sees a salesperson");
    const own = await refusal(() => create(mgr, W, EMP("e-m")));
    assert.deepEqual([own.code, own.category], ["SELF_TARGETING_FORBIDDEN", "FORBIDDEN"]);
    // A draft FOR the approver herself is a refusal for her to approve, even though she is not its author.
    const forApprover = await seed({ metric: "technician.workOrder.open.count", scope: "EMPLOYEE", scopeId: "e-m2", unit: "COUNT", from: "2026-11-01", author: mgr });
    const before = await counts();
    assert.equal((await refusal(() => approve(approver, W, forApprover))).code, "SELF_TARGETING_FORBIDDEN");
    assert.equal((await row(forApprover)).status, "DRAFT");
    // ...and an approved target on herself is not hers to retire.
    const approvedOnApprover = await seed({ metric: "technician.workOrder.open.count", scope: "EMPLOYEE", scopeId: "e-m2", unit: "COUNT", from: "2020-01-01", status: "APPROVED", author: mgr });
    assert.equal((await refusal(() => retire(approver, W, approvedOnApprover))).code, "SELF_TARGETING_FORBIDDEN");
    assert.equal((await row(approvedOnApprover)).status, "APPROVED");
    assert.equal((await counts()).a, before.a, "refusals leave no audit row");
    // The author of a draft FOR a report cannot approve it; the other manager can; and an approved target on the report is the manager's to retire.
    assert.equal((await refusal(() => approve(mgr, W, made.goalId))).code, "SELF_APPROVAL_FORBIDDEN");
    assert.equal((await approve(approver, W, made.goalId)).status, "APPROVED");
    // A salesperson (who sees only herself) cannot reach a colleague, and her own target is hers to be given, not to set.
    assert.equal((await refusal(() => create(rep, W, EMP("e-rep")))).code, "SELF_TARGETING_FORBIDDEN");
    assert.equal((await refusal(() => create(rep, W, EMP("e-m")))).code, "GOAL_SCOPE_NOT_REACHABLE");
    assert.equal((await retire(approver, W, made.goalId)).status, "RETIRED");
  });

  await t.test("two-person approval rests on distinct EMPLOYEES: relinking the author's Employee to a new Principal does not make a second person", async () => {
    const px = await principal("uid-author-x");
    const pxNew = await principal("uid-author-x-new");
    await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id, updated_at) VALUES ('e-x','t1','ACTIVE','taylor','2020-01-01T00:00:00Z')`);
    await q(`INSERT INTO eos_policy.employee_principal_links (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, asserted_by, assertion_reason, status)
             VALUES ('l-x','t1',$1,'e-x','taylor','OPERATOR_ASSERTED','f','test','active')`, [px]);
    const metric = { metricId: "purchasing.purchaseOrder.open.count", targetScopeType: "FIRM", unit: "COUNT", direction: "AT_MOST", targetValue: 2, effectiveFrom: "2046-01-01" };
    const made = await create(px, W, metric);
    assert.equal((await row(made.goalId)).author_employee_id, "e-x", "the author's Employee is recorded at draft time");
    // The same human is moved to a NEW Principal (the old link is revoked, the Employee is linked to the new Principal).
    await q(`UPDATE eos_policy.employee_principal_links SET status = 'revoked' WHERE id = 'l-x'`);
    await q(`INSERT INTO eos_policy.employee_principal_links (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, asserted_by, assertion_reason, status)
             VALUES ('l-x2','t1',$1,'e-x','taylor','OPERATOR_ASSERTED','f','test','active')`, [pxNew]);
    const before = await counts();
    const e = await refusal(() => approve(pxNew, W, made.goalId));
    assert.deepEqual([e.code, e.category], ["SELF_APPROVAL_FORBIDDEN", "FORBIDDEN"]);
    assert.match(e.message, /same Employee/);
    assert.deepEqual(await counts(), before, "refused with zero trace");
    assert.equal((await row(made.goalId)).status, "DRAFT");
    // A genuinely different Employee approves; the audit names both Employees and the reason.
    const ok = await approve(approver, W, made.goalId, "Second person confirmed");
    assert.equal(ok.status, "APPROVED");
    const a = (await q(`SELECT after FROM eos_policy.audit_events WHERE target_id = $1 AND action = 'approvePerformanceGoal'`, [made.goalId])).rows[0].after;
    assert.deepEqual([a.authorEmployeeId, a.approverEmployeeId, a.author, a.approver, a.reason], ["e-x", "e-m2", px, approver, "Second person confirmed"]);
    const created = (await q(`SELECT after FROM eos_policy.audit_events WHERE target_id = $1 AND action = 'createPerformanceGoalDraft'`, [made.goalId])).rows[0].after;
    assert.equal(created.authorEmployeeId, "e-x");
    // A draft with NO recorded author Employee (an older row) is still held to the author Principal's CURRENT link.
    const legacy = await seed({ metric: "purchasing.purchaseOrder.open.count", from: "2047-01-01", author: pxNew });
    const beforeLegacy = await counts();
    assert.equal((await refusal(() => approve(pxNew, W, legacy))).code, "SELF_APPROVAL_FORBIDDEN", "the same Principal, whatever the recorded Employee");
    assert.deepEqual(await counts(), beforeLegacy);
  });

  await t.test("disposition: a DRAFT of any provenance is retired with a reason -- never measured, audited, the guards unchanged", async () => {
    const { PERFORMANCE_METRICS } = require("../lib/performance/performanceMetricRegistry.js");
    const inactive = PERFORMANCE_METRICS.find((m) => !m.activeForGoals && m.supportedScopes.includes("FIRM") && m.unit === "COUNT");
    assert.ok(inactive, "the registry has an inactive FIRM count metric to prove a stranded draft can still be disposed of");
    const migrated = await seed({ provenance: "MIGRATED", author: "fb-uid-author", from: "2033-01-01" });
    const stranded = await seed({ provenance: "MIGRATED", author: "fb-uid-author", metric: inactive.metricId, unit: "COUNT", direction: inactive.allowedDirections[0], from: "2033-01-01" });
    const foreignDraft = await seed({ metric: "sales.billed.amount", scope: "OPERATING_COMPANY", scopeId: "ventana", unit: "CURRENCY_MINOR", currency: "USD", direction: "AT_LEAST", from: "2033-03-01" });
    // It cannot be approved here -- the reason it needs a disposition.
    assert.equal((await refusal(() => approve(approver, W, migrated))).code, "GOAL_AUTHOR_UNPROVABLE");
    const before = await counts();
    assert.equal((await refusal(() => retire(approver, [CREATE, APPROVE], migrated))).code, "CAPABILITY_REQUIRED");
    assert.equal((await refusal(() => retire(approver, W, migrated, "  "))).code, "REASON_REQUIRED");
    assert.equal((await refusal(() => retire(taylorUser, W, foreignDraft))).code, "GOAL_NOT_FOUND", "a foreign draft reads as nonexistent");
    assert.deepEqual(await counts(), before, "zero trace");
    const out = await retire(approver, W, migrated, "Copied draft cannot be approved here");
    assert.deepEqual([out.status, out.closedAt, out.discardedDraft], ["RETIRED", null, true]);
    const r = await row(migrated);
    assert.deepEqual([r.status, r.approved_by_ref, r.approved_at_ms, r.f, r.t, r.provenance], ["RETIRED", null, null, "2033-01-01", null, "MIGRATED"], "never approved, its window untouched");
    const a = (await q(`SELECT actor_uid, after FROM eos_policy.audit_events WHERE target_id = $1 AND action = 'retirePerformanceGoal'`, [migrated])).rows;
    assert.equal(a.length, 1);
    assert.deepEqual([a[0].actor_uid, a[0].after.discardedDraft, a[0].after.reason, a[0].after.provenance], [approver, true, "Copied draft cannot be approved here", "MIGRATED"]);
    assert.equal((await refusal(() => retire(approver, W, migrated))).code, "GOAL_NOT_RETIRABLE", "a retired draft is not retired twice");
    assert.equal((await refusal(() => approve(admin, W, migrated))).code, "GOAL_NOT_DRAFT");
    // A draft on a metric since deactivated is still disposable (a stranded goal must not stay stranded).
    assert.equal((await retire(approver, W, stranded, "Metric deactivated")).status, "RETIRED");
    // A NATIVE draft can be discarded by a holder, its own author included; it was never a target.
    const native = await create(mgr, W, draft({ effectiveFrom: "2048-01-01" }));
    assert.equal((await retire(mgr, W, native.goalId, "Entered by mistake")).discardedDraft, true);
    assert.equal((await row(native.goalId)).status, "RETIRED");
    assert.equal((await current(FIRM, "2048-06-01")).goal, null);
    // The retired draft is visible history with its provenance, and cannot be superseded.
    const seen = (await versions(FIRM)).find((v) => v.goalId === native.goalId);
    assert.deepEqual([seen.status, seen.provenance], ["RETIRED", "NATIVE"]);
    assert.equal((await refusal(() => create(mgr, W, draft({ effectiveFrom: "2049-01-01", supersedesGoalId: native.goalId })))).code, "GOAL_NOT_SUPERSEDABLE");
  });

  // ════════════════════ 4. REACH, PER SCOPE ════════════════════
  await t.test("reach: capability, then company, then the scope -- FIRM, company, warehouse and employee, and a foreign one is the generic 'outside your authority'", async () => {
    assert.equal((await refusal(() => create(nobody, W, draft()))).code, "COMPANY_AUTHORITY_REQUIRED", "capability first, then company");
    assert.equal((await refusal(() => create(mgr, [APPROVE, RETIRE], draft()))).code, "CAPABILITY_REQUIRED");
    // FIRM: any caller with company authority (parity with the reads).
    assert.equal((await create(ventanaUser, W, draft({ metricId: "service.workOrder.pastDue.count", effectiveFrom: "2040-01-01" }))).status, "DRAFT");

    // OPERATING_COMPANY
    const CO = (id) => ({ metricId: "sales.billed.amount", targetScopeType: "OPERATING_COMPANY", targetScopeId: id, unit: "CURRENCY_MINOR", direction: "AT_LEAST", currency: "USD", targetValue: 100000, effectiveFrom: "2026-11-01" });
    assert.equal((await create(taylorUser, W, CO("taylor"))).status, "DRAFT");
    const foreignCo = await refusal(() => create(taylorUser, W, CO("ventana")));
    const missingCo = await refusal(() => create(taylorUser, W, CO("nowhere")));
    assert.deepEqual([foreignCo.code, foreignCo.message], [missingCo.code, missingCo.message]);
    assert.equal(foreignCo.code, "GOAL_SCOPE_NOT_REACHABLE");
    assert.equal((await create(admin, W, CO("ventana"))).status, "DRAFT", "an administrator reaching both companies");

    // LOCATION: a warehouse of a company reached AND the WAREHOUSE scope; and the metric's own authority.
    const LOC = (id) => ({ metricId: "receiving.purchaseOrder.receivable.count", targetScopeType: "LOCATION", targetScopeId: id, unit: "COUNT", direction: "AT_MOST", targetValue: 3, effectiveFrom: "2026-11-01" });
    const withReceive = [...W, RECEIVE];
    assert.equal((await create(taylorUser, withReceive, LOC("wh-1"))).status, "DRAFT");
    assert.equal((await refusal(() => create(taylorUser, W, LOC("wh-1")))).code, "METRIC_AUTHORITY_REQUIRED", "a target on a figure the caller may not read");
    const noScope = await refusal(() => create(taylorUser, withReceive, LOC("wh-2")));      // a Taylor warehouse the caller holds no scope for
    const foreignWh = await refusal(() => create(taylorUser, withReceive, LOC("wh-v")));    // another company's warehouse, even WITH a scope row
    const missingWh = await refusal(() => create(taylorUser, withReceive, LOC("wh-nope")));
    for (const e of [noScope, foreignWh, missingWh]) assert.deepEqual([e.code, e.message], ["GOAL_SCOPE_NOT_REACHABLE", missingWh.message]);
    assert.equal((await refusal(() => create(mgr, withReceive, LOC("wh-1")))).code, "GOAL_SCOPE_NOT_REACHABLE", "no WAREHOUSE scope over wh-1");

    // EMPLOYEE: another company's employee and a nonexistent one are the same answer.
    const foreignEmp = await refusal(() => create(mgr, W, EMP("e-rep-v")));
    const missingEmp = await refusal(() => create(mgr, W, EMP("e-nobody")));
    assert.deepEqual([foreignEmp.code, foreignEmp.message], [missingEmp.code, missingEmp.message]);
    assert.equal(foreignEmp.code, "GOAL_SCOPE_NOT_REACHABLE");

    // BUSINESS_UNIT has no EOS authority (OD-B4-4); TEAM is never bindable.
    const bu = await refusal(() => create(admin, W, { metricId: "sales.billed.amount", targetScopeType: "BUSINESS_UNIT", targetScopeId: "bu-1", unit: "CURRENCY_MINOR", direction: "AT_LEAST", currency: "USD", targetValue: 1, effectiveFrom: "2026-11-01" }));
    assert.equal(bu.code, "GOAL_SCOPE_NOT_REACHABLE");
    // A metric whose actual the caller may not read (crm.account.active.count -> customer.record.read).
    assert.equal((await refusal(() => create(taylorUser, W, { metricId: "crm.account.active.count", targetScopeType: "FIRM", unit: "COUNT", direction: "AT_LEAST", targetValue: 1, effectiveFrom: "2026-11-01" }))).code, "METRIC_AUTHORITY_REQUIRED");
    assert.equal((await create(taylorUser, [...W, "customer.record.read"], { metricId: "crm.account.active.count", targetScopeType: "FIRM", unit: "COUNT", direction: "AT_LEAST", targetValue: 1, effectiveFrom: "2026-11-01" })).status, "DRAFT");
  });

  await t.test("reach: a foreign or missing goal id reads EXACTLY as a nonexistent one for approve and retire (never a state, never a reason)", async () => {
    const foreign = [
      await seed({ metric: "sales.billed.amount", scope: "OPERATING_COMPANY", scopeId: "ventana", unit: "CURRENCY_MINOR", currency: "USD", direction: "AT_LEAST", from: "2031-02-01" }),
      await seed({ metric: "receiving.purchaseOrder.receivable.count", scope: "LOCATION", scopeId: "wh-v", from: "2031-02-01" }),
      await seed({ metric: "technician.workOrder.open.count", scope: "EMPLOYEE", scopeId: "e-rep-v", from: "2031-02-01" }),
      await seed({ metric: "sales.billed.amount", scope: "BUSINESS_UNIT", scopeId: "bu-1", unit: "CURRENCY_MINOR", currency: "USD", direction: "AT_LEAST", from: "2031-02-01" }),
    ];
    const approvedForeign = [
      await seed({ metric: "sales.collected.amount", scope: "OPERATING_COMPANY", scopeId: "ventana", unit: "CURRENCY_MINOR", currency: "USD", direction: "AT_LEAST", status: "APPROVED", from: "2020-01-01" }),
      await seed({ metric: "technician.workOrder.open.count", scope: "EMPLOYEE", scopeId: "e-rep-v", status: "APPROVED", from: "2020-01-01" }),
    ];
    const caps = [...W, RECEIVE];
    const before = await counts();
    const missing = await refusal(() => approve(taylorUser, caps, "goal_does_not_exist"));
    assert.deepEqual([missing.code, missing.category], ["GOAL_NOT_FOUND", "NOT_FOUND"]);
    for (const id of foreign) {
      const e = await refusal(() => approve(taylorUser, caps, id));
      assert.deepEqual([e.code, e.category, e.message], [missing.code, missing.category, missing.message], id);
      assert.equal((await row(id)).status, "DRAFT", "and it is untouched");
    }
    const missingRetire = await refusal(() => retire(taylorUser, caps, "goal_does_not_exist"));
    for (const id of approvedForeign) {
      const e = await refusal(() => retire(taylorUser, caps, id));
      assert.deepEqual([e.code, e.category, e.message], [missingRetire.code, missingRetire.category, missingRetire.message], id);
      assert.equal((await row(id)).status, "APPROVED");
    }
    // Reach is decided BEFORE state: a foreign goal in the WRONG state still reads as nonexistent (never "not a draft" / "not approved", which would say it exists).
    for (const id of approvedForeign) assert.deepEqual((await refusal(() => approve(taylorUser, caps, id))).message, missing.message, `approve ${id}`);
    for (const id of foreign) assert.deepEqual((await refusal(() => retire(taylorUser, caps, id))).message, missing.message, `retire ${id}`);
    // The company that DOES own the goal reaches it.
    assert.equal((await approve(admin, caps, foreign[0])).status, "APPROVED");
    const afterLegit = await counts();
    assert.deepEqual([afterLegit.g, afterLegit.c, afterLegit.a], [before.g, before.c + 1, before.a + 1], "only the one legitimate approval wrote anything");
    assert.notEqual(afterLegit.h, before.h, "...and it changed exactly the state it was allowed to");
  });

  // ════════════════════ 5. IDEMPOTENCY ════════════════════
  await t.test("replay: the same key and request returns the stored answer and writes nothing; another request, command or actor under it does not", async () => {
    const m = { metricId: "technician.workOrder.completed.cumulative.count", targetScopeType: "EMPLOYEE", targetScopeId: "e-rep", unit: "COUNT", direction: "AT_LEAST", targetValue: 400, effectiveFrom: "2026-11-01" };
    const input = { ...m, idempotencyKey: "replay-1" };
    const first = await goals.createPerformanceGoalDraft(deps, actor(mgr, W), input);
    const before = await counts();
    const again = await goals.createPerformanceGoalDraft(deps, actor(mgr, W), input);
    assert.deepEqual([again.outcome, again.goalId, again.version, again.status], ["replayed", first.goalId, 1, "DRAFT"]);
    assert.deepEqual(await counts(), before, "a replay writes nothing");
    const conflict = await refusal(() => goals.createPerformanceGoalDraft(deps, actor(mgr, W), { ...input, targetValue: 401 }));
    assert.deepEqual([conflict.code, conflict.category], ["IDEMPOTENCY_CONFLICT", "CONFLICT"]);
    assert.equal((await refusal(() => goals.approvePerformanceGoal(deps, actor(mgr, W), { goalId: first.goalId, reason: "r", idempotencyKey: "replay-1" }))).code, "IDEMPOTENCY_CONFLICT", "another command under the same key");
    // The key is per ACTOR: the same string by another principal is its own record.
    assert.equal((await goals.createPerformanceGoalDraft(deps, actor(approver, W), { ...m, targetValue: 450, effectiveFrom: "2026-11-02", idempotencyKey: "replay-1" })).outcome, "applied");
    // Approve and retire replay too.
    const ap = await goals.approvePerformanceGoal(deps, actor(approver, W), { goalId: first.goalId, reason: "ok", idempotencyKey: "replay-ap" });
    const apBefore = await counts();
    const ap2 = await goals.approvePerformanceGoal(deps, actor(approver, W), { goalId: first.goalId, reason: "ok", idempotencyKey: "replay-ap" });
    assert.deepEqual([ap2.outcome, ap2.status, ap2.version], ["replayed", "APPROVED", ap.version]);
    assert.equal((await refusal(() => goals.approvePerformanceGoal(deps, actor(approver, W), { goalId: first.goalId, reason: "a different reason", idempotencyKey: "replay-ap" }))).code, "IDEMPOTENCY_CONFLICT");
    assert.deepEqual(await counts(), apBefore);
    const rt = await goals.retirePerformanceGoal(deps, actor(approver, W), { goalId: first.goalId, reason: "done", idempotencyKey: "replay-rt" });
    const rt2 = await goals.retirePerformanceGoal(deps, actor(approver, W), { goalId: first.goalId, reason: "done", idempotencyKey: "replay-rt" });
    assert.deepEqual([rt2.outcome, rt2.closedAt], ["replayed", rt.closedAt]);
    // Concurrent duplicates: exactly one applies.
    const dup = { ...m, effectiveFrom: "2026-12-21", targetValue: 12, idempotencyKey: "replay-race" };
    const race = await Promise.allSettled([goals.createPerformanceGoalDraft(deps, actor(mgr, W), dup), goals.createPerformanceGoalDraft(deps, actor(mgr, W), dup)]);
    const settled = race.filter((r) => r.status === "fulfilled").map((r) => r.value);
    assert.equal(settled.length, 2, "both racers are answered, neither with an internal error");
    assert.deepEqual(settled.map((s) => s.outcome).sort(), ["applied", "replayed"]);
    assert.equal(new Set(settled.map((s) => s.goalId)).size, 1, "one goal, however many racers");
    assert.equal((await q(`SELECT count(*)::int n FROM eos_ops.performance_goals WHERE target_value = 12 AND target_scope_id = 'e-rep' AND metric_id = $1`, [m.metricId])).rows[0].n, 1);
  });

  // ════════════════════ 6. ZERO TRACE ════════════════════
  await t.test("zero trace: a battery of refused commands leaves no goal, no command record and no audit row", async () => {
    const before = await counts();
    const g = await seed({ from: "2032-01-01" });
    const afterSeed = await counts();
    const battery = [
      () => create(nobody, W, draft()),
      () => create(mgr, [], draft()),
      () => create(mgr, W, draft({ metricId: "nope" })),
      () => create(mgr, W, EMP("e-m")),
      () => create(mgr, W, EMP("e-rep-v")),
      () => approve(mgr, W, "goal_nope"),
      () => approve(approver, [APPROVE], g, ""),
      () => retire(approver, W, L.v1), // a SUPERSEDED version is history
      () => retire(nobody, W, g),
      () => goals.createPerformanceGoalDraft(deps, actor(mgr, W), { ...draft(), tenantId: "t2", idempotencyKey: "x" }),
      () => goals.createPerformanceGoalDraft(deps, actor(mgr, W), draft()),
    ];
    for (const attempt of battery) await refusal(attempt);
    const after = await counts();
    assert.deepEqual(after, afterSeed, "zero rows in goals, command records and audit events");
    assert.equal(before.g + 1, afterSeed.g);
  });

  // ════════════════════ 7. OFFERED == ACCEPTED ════════════════════
  await t.test("the options read offers exactly what a command accepts and nothing it refuses", async () => {
    assert.equal((await refusal(() => goals.listGoalAuthoringOptions({ pool }, actor(mgr, [READ]), {}))).code, "CAPABILITY_REQUIRED", "read alone authors nothing");
    assert.equal((await refusal(() => goals.listGoalAuthoringOptions({ pool }, actor(nobody, W), {}))).code, "COMPANY_AUTHORITY_REQUIRED");
    assert.equal((await refusal(() => goals.listGoalAuthoringOptions({ pool }, actor(mgr, W), { tenantId: "t2" }))).code, "INPUT_FIELD_NOT_ACCEPTED");

    const o = await goals.listGoalAuthoringOptions({ pool }, actor(mgr, [CREATE]), {});
    assert.equal(o.principalId, mgr);
    assert.deepEqual(o.verbs, { create: true, supersede: false, approve: false, retire: false });
    assert.deepEqual(o.companies, [{ id: "taylor", name: o.companies[0].name }]);
    assert.deepEqual(o.warehouses, [], "no WAREHOUSE scope");
    // Only ACTIVE metrics, only scopes EOS can bind (no BUSINESS_UNIT, no TEAM), and only metrics the caller has authority over.
    const ids = o.metrics.map((m) => m.metricId);
    assert.ok(ids.includes("technician.workOrder.open.count") && ids.includes("service.workOrder.pastDue.count"));
    assert.ok(!ids.includes("sales.invoiced.amount"), "an inactive metric is not offered");
    assert.ok(!ids.includes("crm.account.active.count"), "no authority over its actual (customer.record.read)");
    assert.ok(!ids.includes("receiving.purchaseOrder.receivable.count"), "no authority over its actual (inventory.stock.receive)");
    for (const m of o.metrics) {
      assert.ok(m.supportedScopes.length > 0 && m.supportedScopes.every((s) => ["EMPLOYEE", "LOCATION", "OPERATING_COMPANY", "FIRM"].includes(s)), m.metricId);
      assert.ok(m.allowedDirections.length > 0 && typeof m.displayName === "string" && typeof m.unit === "string");
    }
    const billed = o.metrics.find((m) => m.metricId === "sales.billed.amount");
    assert.deepEqual(billed.supportedScopes.sort(), ["EMPLOYEE", "FIRM", "OPERATING_COMPANY"], "its BUSINESS_UNIT scope is not offered");

    // The people: the SAME set the subject picker read states -- own Employee removed, the other company's removed.
    const subjects = (await reads.listGoalSubjects({ pool }, actor(mgr, [READ]), {})).employeeIds;
    assert.deepEqual(o.employeeIds, subjects);
    assert.ok(o.employeeIds.includes("e-rep") && !o.employeeIds.includes("e-m") && !o.employeeIds.includes("e-rep-v"));
    for (const id of o.employeeIds) {
      assert.equal((await create(mgr, [CREATE], EMP(id, { effectiveFrom: "2041-01-01" }))).status, "DRAFT", `offered ${id} is accepted`);
    }
    assert.equal((await refusal(() => create(mgr, [CREATE], EMP("e-m")))).code, "SELF_TARGETING_FORBIDDEN");
    assert.equal((await refusal(() => create(mgr, [CREATE], EMP("e-rep-v")))).code, "GOAL_SCOPE_NOT_REACHABLE");

    // The warehouses: the ones the command would accept (company reached AND the WAREHOUSE scope).
    const withReceive = await goals.listGoalAuthoringOptions({ pool }, actor(taylorUser, [...W, RECEIVE]), {});
    assert.deepEqual(withReceive.warehouses, [{ id: "wh-1", name: "North" }], "wh-v is another company's, wh-2 has no scope row");
    assert.ok(withReceive.metrics.some((m) => m.metricId === "receiving.purchaseOrder.receivable.count" && m.supportedScopes.includes("LOCATION")));
    const wide = await goals.listGoalAuthoringOptions({ pool }, actor(admin, W), {});
    assert.deepEqual(wide.companies.map((c) => c.id).sort(), ["taylor", "ventana"], "an administrator reaching both companies");
    assert.deepEqual(wide.verbs, { create: true, supersede: true, approve: true, retire: true });
    // The options read writes nothing.
    const before = await counts();
    await goals.listGoalAuthoringOptions({ pool }, actor(admin, W), {});
    assert.deepEqual(await counts(), before);
  });

  await t.test("one audit row per applied command carries the Firebase action names, the actor and the target; none for a refusal or a replay", async () => {
    const rows = (await q(`SELECT action, count(*)::int n FROM eos_policy.audit_events WHERE target_kind = 'performance_goal' GROUP BY action ORDER BY action`)).rows;
    const actions = new Map(rows.map((r) => [r.action, r.n]));
    for (const a of ["createPerformanceGoalDraft", "approvePerformanceGoal", "supersedePerformanceGoal", "retirePerformanceGoal"]) assert.ok(actions.get(a) > 0, a);
    // Every applied command wrote exactly one audit row and exactly one command record; the totals agree.
    const n = (await q(`SELECT (SELECT count(*)::int FROM eos_policy.audit_events WHERE target_kind = 'performance_goal') a, (SELECT count(*)::int FROM eos_ops.performance_goal_commands) c`)).rows[0];
    assert.equal(n.a, n.c);
    const sample = (await q(`SELECT * FROM eos_policy.audit_events WHERE action = 'approvePerformanceGoal' ORDER BY occurred_at LIMIT 1`)).rows[0];
    assert.equal(typeof sample.after.reason, "string", "the reason is a field of the audited state, not only text");
    assert.ok(sample.after.authorEmployeeId && sample.after.approverEmployeeId && sample.after.authorEmployeeId !== sample.after.approverEmployeeId);
    assert.equal(sample.target_kind, "performance_goal");
    assert.equal(sample.actor_uid, approver);
    assert.match(sample.reason, /author=.*approver=/);
    assert.equal(sample.after.outcome, "applied");
  });

  // ════════════════════ 8. G-1b: WHAT GOVERNS A DATE, SCHEDULED VERSIONS, CORRECTIVE REPLACEMENT ════════════════════
  // One dedicated target (receiving.purchaseOrder.receivable.count, FIRM) shared by every scenario below; each scenario lives in its OWN year with BOUNDED windows
  // (so no scenario's window can touch another's) and states "today" through the command's clock.
  const R = { metricId: "receiving.purchaseOrder.receivable.count", targetScopeType: "FIRM" };
  const RC = [...W, RECEIVE];
  const at = (date) => ({ ...deps, now: () => new Date(`${date}T12:00:00.000Z`) });
  const mk = (who, today, input, caps = RC) => goals.createPerformanceGoalDraft(at(today), actor(who, caps), { idempotencyKey: key("c"), ...R, targetValue: 10, unit: "COUNT", direction: "AT_MOST", ...input });
  const ok = (who, today, goalId, reason = "Agreed", extra = {}, caps = RC) => goals.approvePerformanceGoal(at(today), actor(who, caps), { goalId, reason, idempotencyKey: key("a"), ...extra });
  const rt = (who, today, goalId, reason = "Stopped", caps = RC) => goals.retirePerformanceGoal(at(today), actor(who, caps), { goalId, reason, idempotencyKey: key("r"), });
  const cur = async (date) => (await reads.listCurrentPerformanceGoals({ pool }, actor(admin, [READ, RECEIVE]), { targets: [R], onDate: date })).results[0];
  /** The target value in force on each date (null = none), and the proof that no date is ambiguous. */
  const timeline = async (Y, expected) => {
    for (const [md, want] of Object.entries(expected)) {
      const r = await cur(`${Y}-${md}`);
      assert.equal(r.unavailableReason, null, `${Y}-${md} is not ambiguous`);
      assert.equal(r.goal?.targetValue ?? null, want, `${Y}-${md}`);
    }
  };
  /** P (value 10, Y-01-01..Y-12-31) approved; S (value 8) from Y-06-01 replaces it, approved while it is still SCHEDULED. Today = Y-03-01. */
  const scheduled = async (Y) => {
    const D0 = `${Y}-03-01`;
    const p = await mk(mgr, D0, { targetValue: 10, effectiveFrom: `${Y}-01-01`, effectiveTo: `${Y}-12-31` });
    await ok(approver, D0, p.goalId);
    const s = await mk(mgr, D0, { targetValue: 8, effectiveFrom: `${Y}-06-01`, effectiveTo: `${Y}-12-31`, supersedesGoalId: p.goalId });
    await ok(approver, D0, s.goalId);
    return { Y, D0, p: p.goalId, s: s.goalId };
  };
  const statusOf = async (id) => { const r = await row(id); return [r.status, r.f, r.t]; };
  const correct = (x, from, over = {}) => mk(mgr, x.D0, { targetValue: 6, effectiveFrom: `${x.Y}-${from}`, effectiveTo: `${x.Y}-12-31`, supersedesGoalId: x.s, ...over });

  await t.test("G-1b F1: an approved future-dated successor leaves no gap -- the predecessor governs to the day before it, the successor from its start; superseded history stays readable", async () => {
    const x = await scheduled(2031);
    assert.deepEqual(await statusOf(x.p), ["SUPERSEDED", "2031-01-01", "2031-05-31"], "the predecessor's window was closed the day before the successor");
    assert.deepEqual(await statusOf(x.s), ["APPROVED", "2031-06-01", "2031-12-31"]);
    await timeline(2031, { "01-01": 10, "03-01": 10, "05-30": 10, "05-31": 10, "06-01": 8, "06-02": 8, "12-31": 8 });
    assert.equal((await cur("2030-12-31")).goal, null, "before the first window there is no target");
    assert.equal((await cur("2032-01-01")).goal, null, "after the last window there is no target");
    // An historical as-of read of a SUPERSEDED window returns that version, with its number, window and approval evidence.
    const old = (await cur("2031-04-15")).goal;
    assert.deepEqual([old.goalId, old.status, old.targetValue, old.effectiveTo], [x.p, "SUPERSEDED", 10, "2031-05-31"]);
    // The superseded window still counts as governed: a first version may not claim it.
    const before = await counts();
    const e = await refusal(() => mk(mgr, x.D0, { effectiveFrom: "2031-02-01", effectiveTo: "2031-02-28", targetValue: 3 }));
    assert.deepEqual([e.code, e.category], ["GOAL_ALREADY_IN_FORCE", "CONFLICT"]);
    assert.deepEqual(await counts(), before);
  });

  await t.test("G-1b F1: a RETIRED version governs the days before its retire day; a discarded draft and a draft never govern", async () => {
    const Y = 2032, D0 = `${Y}-02-01`;
    const p = await mk(mgr, D0, { effectiveFrom: `${Y}-01-01`, effectiveTo: `${Y}-12-31`, targetValue: 10 });
    await timeline(Y, { "02-15": null });
    await ok(approver, D0, p.goalId);
    await timeline(Y, { "02-15": 10, "03-10": 10 });
    assert.equal((await rt(approver, `${Y}-03-10`, p.goalId)).closedAt, `${Y}-03-10`);
    assert.deepEqual(await statusOf(p.goalId), ["RETIRED", `${Y}-01-01`, `${Y}-03-10`]);
    await timeline(Y, { "01-01": 10, "02-15": 10, "03-09": 10, "03-10": 10, "03-11": null, "12-31": null });
    // A draft that is discarded was never a target: RETIRED without an approver, its window untouched, governing nothing.
    const d = await mk(mgr, `${Y}-04-01`, { effectiveFrom: `${Y}-06-01`, effectiveTo: `${Y}-06-30`, targetValue: 99 });
    await timeline(Y, { "06-15": null });
    const out = await rt(approver, `${Y}-04-02`, d.goalId, "Entered by mistake");
    assert.deepEqual([out.status, out.closedAt], ["RETIRED", null]);
    assert.deepEqual(await statusOf(d.goalId), ["RETIRED", `${Y}-06-01`, `${Y}-06-30`]);
    assert.equal((await q(`SELECT approved_by_ref FROM eos_ops.performance_goals WHERE goal_id = $1`, [d.goalId])).rows[0].approved_by_ref, null);
    await timeline(Y, { "06-15": null });
    // ... and the discarded window is free again.
    assert.equal((await mk(mgr, `${Y}-04-03`, { effectiveFrom: `${Y}-06-10`, effectiveTo: `${Y}-06-20`, targetValue: 5 })).status, "DRAFT");
  });

  await t.test("G-1b F1: two governing versions on one date are still REFUSED as ambiguous (never resolved by order) -- while a pair that does not overlap is not", async () => {
    const m = R.metricId;
    await seed({ metric: m, from: "2033-01-01", to: "2033-12-31", status: "APPROVED", version: 1 });
    await seed({ metric: m, from: "2033-06-01", to: "2033-12-31", status: "SUPERSEDED", version: 2 });
    const bad = await cur("2033-07-01");
    assert.equal(bad.goal, null);
    assert.match(bad.unavailableReason, /GOAL_AMBIGUOUS|failed to close the earlier window/);
    assert.match(bad.unavailableReason, /2 governing goals/);
    const fine = await cur("2033-03-01");
    assert.deepEqual([fine.unavailableReason, fine.goal?.targetValue], [null, 5], "a date covered by one governing version is not ambiguous");
  });

  await t.test("G-1b: an approved version that has not started is SCHEDULED and cannot be retired -- a business refusal, no mutation, no trace; a started one can", async () => {
    const x = await scheduled(2034);
    const before = await counts();
    const e = await refusal(() => rt(approver, x.D0, x.s, "Entered by mistake"));
    assert.deepEqual([e.code, e.category], ["GOAL_SCHEDULED_NOT_RETIRABLE", "PRECONDITION_FAILED"]);
    assert.match(e.message, /hasn't started yet.*corrective replacement for someone else to approve/);
    assert.deepEqual(await counts(), before, "no goal, no command record, no audit row, no state change");
    assert.deepEqual(await statusOf(x.s), ["APPROVED", "2034-06-01", "2034-12-31"]);
    assert.deepEqual(await statusOf(x.p), ["SUPERSEDED", "2034-01-01", "2034-05-31"], "the version before it is untouched");
    await timeline(2034, { "05-31": 10, "06-01": 8 });
    // The day it starts it is in force, and retirable like any other: the window closes at the retire day.
    assert.deepEqual([(await rt(approver, "2034-06-01", x.s)).status, (await row(x.s)).t], ["RETIRED", "2034-06-01"]);
  });

  await t.test("G-1b: a corrective replacement with an EARLIER start supersedes the scheduled version and moves the preceding boundary earlier; the scheduled version never governs", async () => {
    const x = await scheduled(2035);
    const c = await correct(x, "05-10");
    assert.deepEqual([c.status, c.supersedesGoalId], ["DRAFT", x.s]);
    await timeline(2035, { "05-31": 10, "06-01": 8 }); // a draft changes nothing
    const out = await ok(approver, x.D0, c.goalId, "The start date was wrong");
    assert.deepEqual([out.status, out.supersededGoalId, out.correctedScheduledGoalId, out.precedingGoalId, out.precedingClosedAt, out.predecessorClosedAt],
      ["APPROVED", x.s, x.s, x.p, "2035-05-09", null]);
    assert.deepEqual(await statusOf(x.s), ["SUPERSEDED", "2035-06-01", "2035-12-31"], "the scheduled record is kept, its window untouched");
    assert.deepEqual(await statusOf(x.p), ["SUPERSEDED", "2035-01-01", "2035-05-09"]);
    assert.deepEqual(await statusOf(c.goalId), ["APPROVED", "2035-05-10", "2035-12-31"]);
    // Boundary dates (start-1, start, start+1), and the scheduled version's own old start: exactly one version per date, S never.
    await timeline(2035, { "03-01": 10, "05-08": 10, "05-09": 10, "05-10": 6, "05-11": 6, "05-31": 6, "06-01": 6, "06-02": 6, "12-31": 6 });
    assert.equal((await cur("2035-06-01")).goal.goalId, c.goalId);
    // Audit: one row for the correction, carrying both Principals, the reason and the correction; the scheduled version's own audit trail is unchanged.
    assert.deepEqual((await audits(x.s)).map((a) => a.action), ["createPerformanceGoalDraft", "supersedePerformanceGoal"]);
    const a = (await q(`SELECT after FROM eos_policy.audit_events WHERE target_id = $1 AND action = 'supersedePerformanceGoal'`, [c.goalId])).rows[0].after;
    assert.deepEqual([a.correctedScheduledGoal, a.precedingGoalId, a.precedingClosedAt, a.reason, a.approver, a.author], [true, x.p, "2035-05-09", "The start date was wrong", approver, mgr]);
  });

  await t.test("G-1b: a corrective replacement with the SAME start leaves the preceding boundary where it was", async () => {
    const x = await scheduled(2036);
    const c = await correct(x, "06-01");
    const out = await ok(approver, x.D0, c.goalId);
    assert.deepEqual([out.precedingClosedAt, out.predecessorClosedAt], ["2036-05-31", null]);
    assert.deepEqual(await statusOf(x.p), ["SUPERSEDED", "2036-01-01", "2036-05-31"]);
    assert.deepEqual(await statusOf(x.s), ["SUPERSEDED", "2036-06-01", "2036-12-31"]);
    await timeline(2036, { "05-31": 10, "06-01": 6, "06-02": 6, "12-31": 6 });
    assert.equal((await cur("2036-06-01")).goal.goalId, c.goalId, "the new version, not the one it replaced on the same start day");
  });

  await t.test("G-1b: a corrective replacement with a LATER start keeps the preceding version in force until the corrected start -- nothing is lost in between", async () => {
    const x = await scheduled(2037);
    const c = await correct(x, "06-20");
    const out = await ok(approver, x.D0, c.goalId);
    assert.deepEqual([out.precedingClosedAt, out.predecessorClosedAt], ["2037-06-19", null]);
    assert.deepEqual(await statusOf(x.p), ["SUPERSEDED", "2037-01-01", "2037-06-19"], "the boundary set by the scheduled version is a scheduled transition: it moves");
    assert.deepEqual(await statusOf(x.s), ["SUPERSEDED", "2037-06-01", "2037-12-31"]);
    await timeline(2037, { "05-31": 10, "06-01": 10, "06-10": 10, "06-19": 10, "06-20": 6, "06-21": 6, "12-31": 6 });
    assert.equal((await cur("2037-06-10")).goal.goalId, x.p, "the scheduled version never governed 2037-06-01..2037-06-19");
  });

  await t.test("G-1b: a correction never moves an elapsed boundary or governs an elapsed day (refused, not clamped); once the scheduled version HAS started, a replacement is an ordinary supersede", async () => {
    const x = await scheduled(2038);
    const before = await counts();
    // at DRAFT time: today and earlier are refused
    for (const from of ["03-01", "02-15"]) {
      const e = await refusal(() => correct(x, from));
      assert.deepEqual([e.code, e.category], ["GOAL_START_ELAPSED", "INVALID_INPUT"], from);
    }
    // an old start date is the same refusal
    assert.equal((await refusal(() => mk(mgr, x.D0, { effectiveFrom: "2038-01-01", effectiveTo: "2038-12-31", supersedesGoalId: x.s }))).code, "GOAL_START_ELAPSED");
    assert.deepEqual(await counts(), before, "the refusals left no trace");
    // at APPROVAL time: a draft that was valid when written has become elapsed -> refused with every row untouched
    const stale = await correct(x, "05-10");
    const mid = await counts();
    const e = await refusal(() => ok(approver, "2038-05-20", stale.goalId));
    assert.deepEqual([e.code, e.category], ["GOAL_START_ELAPSED", "INVALID_INPUT"]);
    assert.deepEqual(await counts(), mid, "no boundary moved, no state changed, nothing recorded");
    assert.deepEqual(await statusOf(x.p), ["SUPERSEDED", "2038-01-01", "2038-05-31"]);
    assert.deepEqual(await statusOf(x.s), ["APPROVED", "2038-06-01", "2038-12-31"]);
    // after the scheduled version started: a later-starting replacement closes it the day before (it governed its elapsed days), as any supersede does
    const later = await correct(x, "06-15");
    const out = await ok(approver, "2038-06-20", later.goalId);
    assert.deepEqual([out.predecessorClosedAt, out.correctedScheduledGoalId ?? null, out.precedingClosedAt ?? null], ["2038-06-14", null, null]);
    assert.deepEqual(await statusOf(x.s), ["SUPERSEDED", "2038-06-01", "2038-06-14"]);
    assert.deepEqual(await statusOf(x.p), ["SUPERSEDED", "2038-01-01", "2038-05-31"], "the elapsed boundary stayed where it was");
    await timeline(2038, { "05-31": 10, "06-01": 8, "06-14": 8, "06-15": 6, "12-31": 6 });
    assert.equal((await cur("2038-06-10")).goal.goalId, x.s, "a version replaced AFTER it started governed its days");
    assert.equal(stale.supersedesGoalId, x.s);
  });

  await t.test("G-1b: the corrective approval keeps the two-person and capability rules; a corrective replay writes nothing", async () => {
    const x = await scheduled(2039);
    const c = await correct(x, "05-10");
    const before = await counts();
    const self = await refusal(() => ok(mgr, x.D0, c.goalId));
    assert.deepEqual([self.code, self.category], ["SELF_APPROVAL_FORBIDDEN", "FORBIDDEN"]);
    // a caller who may set a first version but not replace, or who may replace but not approve, is refused before anything else
    assert.equal((await refusal(() => mk(mgr, x.D0, { effectiveFrom: "2039-05-10", supersedesGoalId: x.s }, [CREATE, RECEIVE]))).code, "CAPABILITY_REQUIRED");
    assert.equal((await refusal(() => ok(approver, x.D0, c.goalId, "Agreed", {}, [SUPERSEDE, CREATE, RECEIVE]))).code, "CAPABILITY_REQUIRED");
    assert.deepEqual(await counts(), before, "every refusal left no trace");
    assert.deepEqual(await statusOf(x.p), ["SUPERSEDED", "2039-01-01", "2039-05-31"]);
    // the approval applies once and replays
    const input = { goalId: c.goalId, reason: "Agreed", idempotencyKey: "g1b-correct-replay" };
    const first = await goals.approvePerformanceGoal(at(x.D0), actor(approver, RC), input);
    assert.equal(first.outcome, "applied");
    const applied = await counts();
    const again = await goals.approvePerformanceGoal(at(x.D0), actor(approver, RC), input);
    assert.deepEqual([again.outcome, again.precedingClosedAt, again.correctedScheduledGoalId], ["replayed", "2039-05-09", x.s]);
    assert.deepEqual(await counts(), applied, "a replay writes nothing");
    assert.equal((await refusal(() => goals.approvePerformanceGoal(at(x.D0), actor(approver, RC), { ...input, reason: "A different reason" }))).code, "IDEMPOTENCY_CONFLICT");
    // a second approval of the same draft is refused as ever, and a second correction of the already-replaced scheduled version is not possible
    assert.equal((await refusal(() => ok(approver, x.D0, c.goalId))).code, "GOAL_NOT_DRAFT");
    const second = await correct(x, "05-20", { targetValue: 4 }).catch((err) => err);
    assert.equal(second.code, "GOAL_NOT_SUPERSEDABLE", "the scheduled version has been replaced; the replacement is what is scheduled now");
  });

  await t.test("G-1b: an employee does not correct their own scheduled target; a manager does", async () => {
    const metric = { metricId: "technician.workOrder.completed.cumulative.count", targetScopeType: "EMPLOYEE", targetScopeId: "e-rep", unit: "COUNT", direction: "AT_LEAST" };
    const D0 = "2040-03-01";
    const mkE = (who, today, input) => goals.createPerformanceGoalDraft(at(today), actor(who, W), { idempotencyKey: key("c"), ...metric, targetValue: 10, ...input });
    const p = await mkE(mgr, D0, { effectiveFrom: "2040-01-01", effectiveTo: "2040-12-31" });
    await goals.approvePerformanceGoal(at(D0), actor(approver, W), { goalId: p.goalId, reason: "ok", idempotencyKey: key("a") });
    const s = await mkE(mgr, D0, { effectiveFrom: "2040-06-01", effectiveTo: "2040-12-31", targetValue: 12, supersedesGoalId: p.goalId });
    await goals.approvePerformanceGoal(at(D0), actor(approver, W), { goalId: s.goalId, reason: "ok", idempotencyKey: key("a") });
    const before = await counts();
    const e = await refusal(() => mkE(rep, D0, { effectiveFrom: "2040-05-10", effectiveTo: "2040-12-31", supersedesGoalId: s.goalId }));
    assert.deepEqual([e.code, e.category], ["SELF_TARGETING_FORBIDDEN", "FORBIDDEN"]);
    assert.deepEqual(await counts(), before);
    const c = await mkE(mgr, D0, { effectiveFrom: "2040-05-10", effectiveTo: "2040-12-31", supersedesGoalId: s.goalId, targetValue: 11 });
    assert.equal((await goals.approvePerformanceGoal(at(D0), actor(approver, W), { goalId: c.goalId, reason: "ok", idempotencyKey: key("a") })).precedingClosedAt, "2040-05-09");
  });

  // ── chained corrections: a correction of a correction reaches the version that actually governs ──
  const versionList = async () => (await reads.listPerformanceGoalVersions({ pool }, actor(admin, [READ, RECEIVE]), { target: R })).versions;
  /** Every day of the year, in memory over the stored versions: exactly one governing version (the selection throws on two and returns null on none). */
  const everyDay = async (Y, idAt) => {
    const list = await versionList();
    const days = [];
    for (let d = new Date(Date.UTC(Y, 0, 1)); d.getUTCFullYear() === Y; d.setUTCDate(d.getUTCDate() + 1)) days.push(d.toISOString().slice(0, 10));
    assert.equal(days.length, 365 + (Y % 4 === 0 ? 1 : 0));
    for (const day of days) assert.equal(reads.governingGoalFor(list, R, day)?.goalId ?? null, idAt(day), day);
  };
  const full = async (id) => (await q(`SELECT * FROM eos_ops.performance_goals WHERE tenant_id='t1' AND goal_id=$1`, [id])).rows[0];

  for (const [Y, start, closedAt, label] of [
    [2041, "04-20", "04-19", "EARLIER than both the scheduled version (06-01) and the first correction (05-10)"],
    [2042, "05-10", "05-09", "the SAME start as the first correction"],
    [2043, "05-20", "05-19", "BETWEEN the first correction (05-10) and the scheduled version (06-01)"],
    [2044, "06-01", "05-31", "the SAME start as the scheduled version"],
    [2045, "06-10", "06-09", "LATER than both"],
  ]) {
    await t.test(`G-1b: a correction of a correction (start ${start}: ${label}) moves the real predecessor's end, writes to no never-governed row, and leaves one governing version on every day`, async () => {
      const x = await scheduled(Y);                                   // p 01-01..05-31 (SUPERSEDED), s 06-01.. (APPROVED, scheduled)
      const c = await correct(x, "05-10");
      await ok(approver, x.D0, c.goalId);                              // c [05-10..] replaces s: p now ends 05-09, s never governed
      assert.deepEqual(await statusOf(x.p), ["SUPERSEDED", `${Y}-01-01`, `${Y}-05-09`]);
      const sBefore = await full(x.s);
      const c2 = await correct(x, start, { supersedesGoalId: c.goalId, targetValue: 4 });   // the draft is accepted: its guard compares with p, not with s
      assert.equal(c2.supersedesGoalId, c.goalId);
      const out = await ok(approver, x.D0, c2.goalId, "The start moved again");
      assert.deepEqual([out.correctedScheduledGoalId, out.precedingGoalId, out.precedingClosedAt, out.predecessorClosedAt], [c.goalId, x.p, `${Y}-${closedAt}`, null]);
      // the real predecessor moved; the never-governed rows were not written (s untouched entirely; c only changed state, its window is as written)
      assert.deepEqual(await statusOf(x.p), ["SUPERSEDED", `${Y}-01-01`, `${Y}-${closedAt}`]);
      assert.deepEqual(await full(x.s), sBefore, "the first scheduled version is untouched");
      assert.deepEqual(await statusOf(x.s), ["SUPERSEDED", `${Y}-06-01`, `${Y}-12-31`]);
      assert.deepEqual(await statusOf(c.goalId), ["SUPERSEDED", `${Y}-05-10`, `${Y}-12-31`]);
      assert.deepEqual(await statusOf(c2.goalId), ["APPROVED", `${Y}-${start}`, `${Y}-12-31`]);
      // exactly one governing version on every day of the year, no gap, no overlap: p until the day before the final start, c2 from it
      await everyDay(Y, (day) => (day < `${Y}-${start}` ? x.p : c2.goalId));
      await timeline(Y, { [closedAt]: 10, [start]: 4, "12-31": 4 });
    });
  }

  await t.test("G-1b: the approval DAY decides -- the day before the scheduled start is a correction (never governed); the start day is an ordinary supersede (it governed that day)", async () => {
    // the day before: a correction
    const a = await scheduled(2046);
    const ca = await correct(a, "06-15");
    const outA = await ok(approver, "2046-05-31", ca.goalId);
    assert.equal(outA.correctedScheduledGoalId, a.s);
    assert.deepEqual(await statusOf(a.s), ["SUPERSEDED", "2046-06-01", "2046-12-31"], "window untouched");
    await everyDay(2046, (day) => (day < "2046-06-15" ? a.p : ca.goalId));
    assert.equal((await cur("2046-06-01")).goal.goalId, a.p, "the scheduled version never governed its would-be start day");
    // ON the start day: an ordinary supersede
    const b = await scheduled(2047);
    const cb = await correct(b, "06-15");
    const outB = await ok(approver, "2047-06-01", cb.goalId);
    assert.deepEqual([outB.predecessorClosedAt, outB.correctedScheduledGoalId ?? null], ["2047-06-14", null]);
    assert.deepEqual(await statusOf(b.s), ["SUPERSEDED", "2047-06-01", "2047-06-14"]);
    await everyDay(2047, (day) => (day < "2047-06-01" ? b.p : day < "2047-06-15" ? b.s : cb.goalId));
    assert.equal((await cur("2047-06-01")).goal.goalId, b.s, "the old version governed its start day");
    // across midnight UTC the branch and the derivation cannot disagree: both read the approval instant
    const c = await scheduled(2048);
    const cc = await correct(c, "06-15");
    const at2359 = { ...deps, now: () => new Date("2048-05-31T23:59:59.999Z") };
    await goals.approvePerformanceGoal(at2359, actor(approver, RC), { goalId: cc.goalId, reason: "Late on the eve", idempotencyKey: key("a") });
    assert.equal((await versionList()).find((v) => v.goalId === c.s).status, "SUPERSEDED");
    await everyDay(2048, (day) => (day < "2048-06-15" ? c.p : cc.goalId));
    // REGRESSION PIN (HARDEN item 3): a clock that CROSSES midnight UTC between successive reads. The fixed-now stub above would also pass code that reads the clock twice (once for
    // the approval timestamp, once for "today"); this one returns the eve of the scheduled start first and the start day itself on every later read. One read means the
    // branch (correction vs ordinary supersede) and neverGoverned (derived from approved_at) both see the eve, so they agree.
    const d = await scheduled(2050);
    const cd = await correct(d, "06-15");
    const ticks = [new Date("2050-05-31T23:59:59.999Z"), new Date("2050-06-01T00:00:00.000Z")];
    const straddle = { ...deps, now: () => ticks.length > 1 ? ticks.shift() : ticks[0] };
    const outD = await goals.approvePerformanceGoal(straddle, actor(approver, RC), { goalId: cd.goalId, reason: "Approved as the day turns", idempotencyKey: key("a") });
    assert.equal(outD.correctedScheduledGoalId, d.s, "the branch read the eve: a correction, not an ordinary supersede");
    assert.deepEqual(await statusOf(d.s), ["SUPERSEDED", "2050-06-01", "2050-12-31"], "the scheduled version's window is untouched");
    const dList = await versionList();
    assert.equal(reads.neverGoverned(dList.find((v) => v.goalId === d.s), dList), true, "neverGoverned (from approved_at) agrees with the branch");
    assert.equal((await cur("2050-06-01")).goal.goalId, d.p, "the scheduled version never governed its would-be start day");
    await everyDay(2050, (day) => (day < "2050-06-15" ? d.p : cd.goalId));
  });
});
