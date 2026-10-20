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
    // A future goal: created, approved, retired the same day -> closes at its own start.
    const metric = { metricId: "purchasing.purchaseOrder.open.count", targetScopeType: "FIRM" };
    const f = await create(mgr, W, { ...metric, targetValue: 8, unit: "COUNT", direction: "AT_MOST", effectiveFrom: "2027-06-01" });
    await approve(approver, W, f.goalId);
    assert.equal((await retire(approver, W, f.goalId)).closedAt, "2027-06-01");
    assert.equal((await row(f.goalId)).t, "2027-06-01");
    // The retire reason is audited verbatim; the draft's author may retire what someone else approved.
    const g = await create(mgr, W, { ...metric, targetValue: 9, unit: "COUNT", direction: "AT_MOST", effectiveFrom: "2027-08-01" });
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
    const bad = async (over, code) => assert.equal((await refusal(() => create(mgr, W, draft(over)))).code, code, JSON.stringify(over));
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
    const dup = { ...m, effectiveFrom: "2026-11-09", targetValue: 12, idempotencyKey: "replay-race" };
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
});
