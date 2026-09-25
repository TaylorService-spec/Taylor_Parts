// REORDER PERSONA ACCEPTANCE -- which persona may be GIVEN Reorder work, which may SEE the shared
// queue, and why those are two different refusals.
//
// ════════════════════ THE OWNER RULINGS THIS SUITE IS ACCOUNTABLE TO ════════════════════
//
//   "Use Parts personas for Reorder assignment testing. Preferred positive personas: Parts
//    Associate, Parts Manager. Do NOT assign PARTS_OPERATIONS to service-technician-a merely to
//    satisfy a test. Technician may be used as the negative eligibility case."
//
//   "Every governed persona provisioning mutation must carry a specific per-step reason. Do not use
//    one broad reason for the entire provisioning run."
//
// ════════════════════ THE FIXTURE IS THE MEASURED NONPROD WORLD ════════════════════
//
// The personas, their Employee ids, their Job Roles, their qualifications and their scopes are the
// ones MEASURED in nonprod on 2026-09-23, with the real identifiers -- synthetic-np-emp-parts-
// associate, -parts-manager, -service-technician-a -- so a proof here is a proof about the personas
// an acceptance run would actually log in as, not about invented ones. In particular:
//
//   parts-associate   PARTS_OPERATIONS,  NO REORDER_QUEUE   the execution positive AND the scope negative
//   parts-manager     PARTS_OPERATIONS,  REORDER_QUEUE      the oversight positive
//   service-technician-a  SERVICE_TECHNICIAN only           the eligibility negative, NEVER mutated
//
// ONE PERSONA PROVES BOTH ANSWERS. parts-associate is the positive for assignment and the negative
// for queue scope, which is only possible because assignment and queue visibility are separate
// authorities. Granting it a REORDER_QUEUE row to "complete" it would delete the only nonprod
// persona that can prove the scope refusal, and would have to be justified by a test rather than by
// the business -- the same move the ruling forbids for the technician.
//
// ════════════════════ WHAT IS WRITTEN THROUGH A GOVERNED COMMAND, AND WHAT IS NOT ════════════════════
//
// Work Eligibility is seeded through assignEmployeeWorkEligibility, the writer that owns it, so the
// per-step reasons this suite asserts are read back out of real rows and real audit events rather
// than out of a plan object. Everything else -- tenants, principals, links, the reorder request, the
// REORDER_QUEUE scope row -- is ordinary fixture SQL in a THROWAWAY database this test creates and
// drops. That is the existing posture of every *Postgres.test.mjs here and is not a nonprod write.
//
// The REORDER_QUEUE row is fixture SQL for a measured reason, asserted below: the governed writer
// assignEmployeeOperationalScope refuses every scope type except WAREHOUSE, so no command can
// produce one. The three REORDER_QUEUE rows live in nonprod because migration 1761696000000 wrote
// them, not because a command did.
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
const eligibilityCommands = require("../lib/eosWorkforce/commands/employeeWorkEligibilityCommands.js");
const scopeCommands = require("../lib/eosWorkforce/commands/employeeOperationalScopeCommands.js");
const dimensions = require("../scripts/sampleCompany/personaAuthorityDimensions.js");
const { CANONICAL_JOB_ROLE_IDS } = require("../lib/eosWorkforce/jobRoleVocabulary.js");

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

// ── the measured nonprod identifiers. Real ids, deliberately, so a rename breaks this suite. ──
const T = "tenant-reorder-persona-acceptance";
const OPERATING_COMPANY_KEY = "taylor";   // the ONLY key with an ACTIVE row in nonprod
const PARTS_ASSOCIATE = "synthetic-np-emp-parts-associate";
const PARTS_MANAGER = "synthetic-np-emp-parts-manager";
const TECHNICIAN_A = "synthetic-np-emp-service-technician-a";
const PRN = {
  [PARTS_ASSOCIATE]: "prn-parts-associate",
  [PARTS_MANAGER]: "prn-parts-manager",
  [TECHNICIAN_A]: "prn-service-technician-a",
};
const PRN_WORKFORCE_ADMIN = "prn-workforce-admin";
const PRN_REORDER_ASSIGNER = "prn-reorder-assigner";
const RR = "rr_f7090a49-f1b1-40cf-8bde-c7d9a69574af";      // RR-2026-000901, the ORDERED nonprod row
const RR_OTHER = "rr_ab54d29e-ab43-4792-9e7f-4c8b9fc771ae";

const REORDER_READ = "reorder.request.read";
const WORKFORCE_ADMIN_CAPS = new Set(["admin.employeeWorkEligibility.write", "admin.employeeOperationalScope.write"]);
const caps = (...k) => new Set(k);
// WAVE 10 / LANE AR. Lane AJ made `entitlements` a REQUIRED field on the governed command actor and
// Lane AQ narrowed it to a required RESOLVER -- a pre-computed value, even a correct one, is refused
// with ACTOR_CONTEXT_REQUIRED because it is not a resolution against the live grant and condition
// stores. This suite was written on a branch that had neither, so its actor carried no entitlements
// at all. The resolver below is the shape AQ's own caller migration uses
// (test/employeeProfileCommand.test.mjs): the actor's capabilities, declared as the unconditioned
// ROLE grants they are here. It adds no authority -- `capabilities` is still what the flat gate
// reads first, and every negative case in this file is refused by that gate exactly as before.
const entitlement = require("../lib/eosOps/conditionalEntitlement.js");
const actorWith = (principalId, capabilities) => ({
  tenantId: T,
  principalId,
  capabilities,
  entitlements: async () => entitlement.entitlementsFrom(
    [...capabilities].map((capabilityKey) => ({
      grantor: { kind: "ROLE", roleKey: "admin" }, capabilityKey,
    })),
  ),
});

/** The predicate an action declares when it asks "may this Employee be given Parts work?". */
const QUALIFIED = [{ kind: "WORK_ELIGIBILITY", qualificationCode: reorderAssignment.REORDER_ASSIGNMENT_QUALIFICATION }];
/** The predicates the SHARED QUEUE read declares: qualified for the work AND scoped to the queue. */
const QUEUE = [
  { kind: "WORK_ELIGIBILITY", qualificationCode: reorderAssignment.REORDER_ASSIGNMENT_QUALIFICATION },
  { kind: "OPERATIONAL_SCOPE", scopeType: "REORDER_QUEUE", scopeId: OPERATING_COMPANY_KEY },
];
const OWN = [{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }];

test("Reorder persona acceptance: Parts personas positive, Technician negative, queue scope separate",
  { skip: SKIP, concurrency: 1 }, async (t) => {
    const name = `reorderpersona_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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

    // ──────────────── the world, exactly as measured ────────────────
    await q(`INSERT INTO eos_policy.tenants (id,key,name) VALUES ($1,'taylor-nonprod',$1)`, [T]);
    await q(`INSERT INTO eos_policy.tenant_operating_companies
               (tenant_id, operating_company_id, status, source, established_by, updated_by)
             VALUES ($1,'taylor','ACTIVE','fixture','fixture','fixture')`, [T]);
    await q(`INSERT INTO eos_policy.tenant_operating_company_keys
               (tenant_id, operating_company_id, operating_company_key, status, provenance, source, established_by, updated_by)
             VALUES ($1,'taylor',$2,'ACTIVE','NATIVE','fixture','fixture','fixture')`, [T, OPERATING_COMPANY_KEY]);
    const mkPrincipal = async (pid) => {
      await q(`INSERT INTO eos_policy.principals (id,external_subject,identity_provider,status)
               VALUES ($1,$2,'firebase','active')`, [pid, `uid-${pid}`]);
      await q(`INSERT INTO eos_policy.tenant_memberships (id,tenant_id,principal_id,status)
               VALUES ($1,$2,$3,'active')`, [`mem-${pid}`, T, pid]);
    };
    for (const pid of [...Object.values(PRN), PRN_WORKFORCE_ADMIN, PRN_REORDER_ASSIGNER]) await mkPrincipal(pid);
    let n = 0;
    for (const eid of [PARTS_ASSOCIATE, PARTS_MANAGER, TECHNICIAN_A]) {
      await q(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id,employee_number)
               VALUES ($1,$2,'ACTIVE','taylor',$3)`, [eid, T, `E${++n}`]);
      await q(`INSERT INTO eos_policy.employee_principal_links
                 (id,tenant_id,principal_id,employee_id,operating_company_id,link_source,status,asserted_by,assertion_reason)
               VALUES ($1,$2,$3,$4,'taylor','OPERATOR_ASSERTED','active','fixture','persona acceptance fixture')`,
      [`lnk-${eid}`, T, PRN[eid], eid]);
    }
    await q(`INSERT INTO eos_ops.reorder_requests
               (id,tenant_id,operating_company_key,part_id,warehouse_id,status,requested_quantity,requested_by,updated_by)
             VALUES ($1,$3,$4,'p1','w1','ORDERED',1,'fixture','fixture'),
                    ($2,$3,$4,'p1','w1','ORDERED',1,'fixture','fixture')`,
    [RR, RR_OTHER, T, OPERATING_COMPANY_KEY]);

    // ──────────────── AC6: the governed writer, carrying PER-STEP reasons ────────────────
    //
    // The reasons are NOT written by this test. They are produced by the provisioning path, one per
    // step, and this test only checks that what the command recorded is what the path composed.
    const plan = dimensions.planPersonaAuthorityDimensions();
    const eligibilitySteps = plan.filter(
      (s) => s.command === "assignEmployeeWorkEligibility"
        && [PARTS_ASSOCIATE, PARTS_MANAGER, TECHNICIAN_A].includes(s.input.employeeId));
    const workforceAdmin = actorWith(PRN_WORKFORCE_ADMIN, WORKFORCE_ADMIN_CAPS);
    for (const step of eligibilitySteps) {
      const result = await eligibilityCommands.assignEmployeeWorkEligibility({ pool }, workforceAdmin, step.input);
      assert.equal(result.outcome, "ASSIGNED", `${step.input.employeeId} ${step.input.qualificationCode}`);
    }

    await t.test("AC6: every governed persona provisioning mutation carries its OWN specific reason", async () => {
      // 50, not the 48 of the previous revision and not the 13 measured before lane BI completed the canonical
      // test workforce. The +2 is the Owner ruling of 2026-09-25: the Job Role catalog moved from the fixture's
      // fourteen entries to the canonical SIXTEEN positions in src/eosWorkforce/jobRoleVocabulary.ts, so the plan
      // carries two more createJobRole steps. Nothing about the per-Employee mutations changed. The number is
      // pinned for the same reason it always was -- so that the per-step assertions below are known to run over
      // THE WHOLE provisioning run and not just the Parts slice this suite is named for.
      assert.equal(plan.length, 50, "the whole persona provisioning run, not just the Parts slice");

      // FOUR COMMAND KINDS, AND ONE OF THEM CANNOT CARRY A REASON -- which is a property of the
      // governed command, not an omission in the plan. `createJobRole` writes a TENANT CATALOG entry
      // (a vocabulary row: id + display name) and its parameter contract is
      // `acceptOnly(input, ["jobRoleId", "displayName"])`, so a `reason` handed to it would be
      // REFUSED as unknown input. It is audited by the catalog audit path under the Job Role id, not
      // by a per-Employee reason. The other three ARE per-Employee mutations and every one of them
      // carries its own reason. Both halves are asserted, so neither can drift: if a reason is ever
      // added to a catalog step, or dropped from a mutation step, this fails.
      // The catalog count is READ FROM THE ONE VOCABULARY rather than restated, so that the next ruling that
      // adds or removes a position moves this expectation with it instead of turning this suite red for a reason
      // that has nothing to do with Reorder. The other three are per-Employee counts and stay literal.
      assert.equal(CANONICAL_JOB_ROLE_IDS.length, 16, "the canonical vocabulary is the ruled sixteen");
      const BY_COMMAND = { createJobRole: CANONICAL_JOB_ROLE_IDS.length, assignEmployeeJobRole: 21,
        assignEmployeeWorkEligibility: 7, assignEmployeeOperationalScope: 6 };
      const counted = {};
      for (const s of plan) counted[s.command] = (counted[s.command] ?? 0) + 1;
      assert.deepEqual(counted, BY_COMMAND, "the provisioning plan's command mix moved");

      const catalogSteps = plan.filter((s) => s.command === "createJobRole");
      for (const step of catalogSteps) {
        assert.equal(Object.hasOwn(step.input, "reason"), false,
          `createJobRole carries a reason, which the governed command refuses as unknown input`);
        assert.deepEqual(Object.keys(step.input).sort(), ["displayName", "jobRoleId"]);
      }

      // EVERY PER-EMPLOYEE MUTATION CARRIES ITS OWN SPECIFIC REASON. 34 of them, 34 distinct reasons:
      // one broad reason for the run is what the ruling forbids, and so is two steps sharing one.
      const mutations = plan.filter((s) => s.command !== "createJobRole");
      assert.equal(mutations.length, 34);
      const reasons = mutations.map((s) => s.input.reason);
      assert.equal(new Set(reasons).size, mutations.length,
        "no two governed mutations share a reason -- one broad reason for the run is what the ruling forbids");
      const DIMENSION_OF = {
        assignEmployeeJobRole: dimensions.DIMENSION_JOB_ROLE,
        assignEmployeeWorkEligibility: dimensions.DIMENSION_WORK_ELIGIBILITY,
        assignEmployeeOperationalScope: dimensions.DIMENSION_OPERATIONAL_SCOPE,
      };
      for (const step of mutations) {
        const dimension = DIMENSION_OF[step.command];
        assert.ok(dimension, `${step.command} has no declared authority dimension`);
        const target = step.command === "assignEmployeeWorkEligibility" ? step.input.qualificationCode
          : step.command === "assignEmployeeJobRole" ? step.input.jobRoleId
            : `${step.input.scopeType}:${step.input.scopeId}`;
        assert.ok(step.input.reason, `${step.command} for ${step.input.employeeId} carries no reason`);
        assert.ok(step.input.reason.includes(step.input.employeeId), `${step.input.reason} does not name its persona`);
        assert.ok(step.input.reason.includes(dimension), `${step.input.reason} does not name its authority dimension`);
        assert.ok(step.input.reason.includes(target), `${step.input.reason} does not name its target`);
        assert.ok(step.input.reason.length <= dimensions.RECORDED_REASON_MAX_LENGTH,
          "a reason the governed command would refuse is caught at plan time");
      }
    });

    await t.test("AC6: the reason reaches the ROW and the AUDIT EVENT, not just the plan", async () => {
      const { rows } = await q(
        `SELECT employee_id, qualification_code, reason FROM eos_workforce.employee_work_eligibility
          WHERE tenant_id = $1 AND effective_to IS NULL ORDER BY employee_id`, [T]);
      assert.equal(rows.length, 3);
      for (const row of rows) {
        const step = eligibilitySteps.find(
          (s) => s.input.employeeId === row.employee_id && s.input.qualificationCode === row.qualification_code);
        assert.ok(step, `${row.employee_id} holds a qualification no planned step asked for`);
        assert.equal(row.reason, step.input.reason);
        assert.ok(row.reason.includes(row.employee_id) && row.reason.includes(dimensions.DIMENSION_WORK_ELIGIBILITY)
          && row.reason.includes(row.qualification_code),
        "the stored reason identifies the persona and the dimension WITHOUT the manifest beside it");
      }
      const audit = await q(
        `SELECT target_id, reason FROM eos_policy.audit_events
          WHERE tenant_id = $1 AND actor_uid = $2 ORDER BY target_id`, [T, PRN_WORKFORCE_ADMIN]);
      assert.equal(audit.rows.length, 3, "one audit event per governed mutation");
      assert.equal(new Set(audit.rows.map((r) => r.reason)).size, 3, "and three DIFFERENT recorded reasons");
      for (const row of audit.rows) assert.ok(row.reason.includes(row.target_id));
    });

    await t.test("AC6: one broad reason for the whole run is REFUSED, not merely discouraged", () => {
      const broad = structuredClone(dimensions.MANIFEST);
      for (const row of [...broad.workEligibility, ...broad.operationalScopes]) {
        row.reason = "PERSONA FIXTURE: nonprod persona authority dimension provisioning run 2026-09-23.";
      }
      assert.throws(
        () => dimensions.planPersonaAuthorityDimensions(broad),
        (err) => err.code === "RUN_LEVEL_REASON_REFUSED",
        "a single run-level sentence pasted down the manifest must refuse the run");
      // ...and a reason that says nothing about the step is refused before it can be written.
      const vague = structuredClone(dimensions.MANIFEST);
      vague.workEligibility[0].reason = "PERSONA FIXTURE: seed";
      assert.throws(() => dimensions.planPersonaAuthorityDimensions(vague),
        (err) => err.code === "REASON_NOT_SPECIFIC");
    });

    await t.test("AC6: the provisioning path accepts NO run-level reason from its caller", async () => {
      // The strongest form of the ruling: there is nowhere for a broad reason to be supplied. An
      // options object carrying one is simply not read, so the recorded reasons are unchanged.
      const withBroadReason = await dimensions.seedPersonaAuthorityDimensions(
        { commands: {} }, actorWith(PRN_WORKFORCE_ADMIN, WORKFORCE_ADMIN_CAPS),
        { apply: false, reason: "PERSONA FIXTURE: nonprod provisioning run", auditReason: "seed" });
      assert.equal(withBroadReason.applied, false);
      assert.deepEqual(withBroadReason.plan.map((s) => s.input.reason), plan.map((s) => s.input.reason));
      const composed = dimensions.composeStepReason(
        "parts-associate", PARTS_ASSOCIATE, dimensions.DIMENSION_WORK_ELIGIBILITY, "PARTS_OPERATIONS",
        "a rationale long enough to be specific");
      assert.ok(composed.includes("parts-associate") && composed.includes(PARTS_ASSOCIATE)
        && composed.includes("PARTS_OPERATIONS"));
    });

    // ──────────────── the queue scope row, and why a command could not write it ────────────────
    await t.test("MEASURED GAP: no governed command can write a REORDER_QUEUE scope", async () => {
      await assert.rejects(
        () => scopeCommands.assignEmployeeOperationalScope({ pool }, workforceAdmin, {
          employeeId: PARTS_MANAGER, scopeType: "REORDER_QUEUE", scopeId: OPERATING_COMPANY_KEY,
          reason: "PERSONA FIXTURE: parts-manager OPERATIONAL_SCOPE REORDER_QUEUE:taylor -- oversight persona queue visibility",
        }),
        (err) => err.code === "OPERATIONAL_SCOPE_TYPE_INVALID",
        "assignEmployeeOperationalScope resolves WAREHOUSE targets only; REORDER_QUEUE is in the vocabulary and in the DB trigger, but has no resolver in the writer");
      // So the nonprod REORDER_QUEUE rows came from migration 1761696000000, and this fixture row is
      // written the same way. Reported, not repaired: extending the writer is the workforce
      // authority's change, not this lane's, and inventing a second writer here would be worse.
      await q(`INSERT INTO eos_workforce.employee_operational_scopes
                 (id,tenant_id,employee_id,scope_type,scope_id,effective_from,assigned_by,reason)
               VALUES ($1,$2,$3,'REORDER_QUEUE',$4,now(),'fixture',$5)`,
      [`eos_${randomUUID()}`, T, PARTS_MANAGER, OPERATING_COMPANY_KEY,
        "preserved from the legacy reorder.request.read.queue capability held by this Employee's Principal"]);
    });

    const reader = ctx.postgresContextualReader(pool);

    // ──────────────── AC1 / AC5: Parts Associate is the execution positive ────────────────
    await t.test("AC1: the qualification Reorder assignment requires is PARTS_OPERATIONS", () => {
      assert.equal(reorderAssignment.REORDER_ASSIGNMENT_QUALIFICATION, "PARTS_OPERATIONS");
      assert.notEqual(reorderAssignment.REORDER_ASSIGNMENT_QUALIFICATION, "WAREHOUSE_OPERATIONS");
    });

    await t.test("AC1: Parts Associate is ALLOWED, holding PARTS_OPERATIONS and NOTHING else", async () => {
      const decision = await ctx.authorizeObjectAction(reader, {
        actor: actorWith(PRN[PARTS_ASSOCIATE], caps(reorderAssignment.REORDER_REQUEST_ASSIGN)),
        capabilityKey: reorderAssignment.REORDER_REQUEST_ASSIGN, predicates: QUALIFIED,
      });
      assert.deepEqual({ allowed: decision.allowed, reason: decision.reason }, { allowed: true, reason: "ALLOWED" });

      // WAREHOUSE_OPERATIONS is NOT required and NOT held -- the two codes never stand in for each other.
      const warehouse = await q(
        `SELECT 1 FROM eos_workforce.employee_work_eligibility
          WHERE tenant_id=$1 AND employee_id=$2 AND qualification_code='WAREHOUSE_OPERATIONS' AND effective_to IS NULL`,
        [T, PARTS_ASSOCIATE]);
      assert.equal(warehouse.rows.length, 0);
      // and no REORDER_QUEUE scope: assignment is CASE A and demands none.
      const scope = await q(
        `SELECT 1 FROM eos_workforce.employee_operational_scopes
          WHERE tenant_id=$1 AND employee_id=$2 AND effective_to IS NULL`, [T, PARTS_ASSOCIATE]);
      assert.equal(scope.rows.length, 0, "the execution positive holds NO Operational Scope at all");
    });

    await t.test("AC5: the governed command assigns the Reorder Request to Parts Associate", async () => {
      const result = await reorderAssignment.assignReorderRequestToEmployee(
        { pool }, actorWith(PRN_REORDER_ASSIGNER, caps(reorderAssignment.REORDER_REQUEST_ASSIGN)),
        { reorderRequestId: RR, employeeId: PARTS_ASSOCIATE,
          reason: "Persona acceptance: Reorder assignment to the Parts Associate execution persona" });
      assert.equal(result.outcome, "ASSIGNED");
      assert.equal(result.assignedEmployeeId, PARTS_ASSOCIATE);
      const { rows } = await q(
        `SELECT assigned_employee_id, provenance::text AS provenance, assigned_by_principal_id
           FROM eos_ops.reorder_request_assignments
          WHERE tenant_id=$1 AND reorder_request_id=$2 AND effective_to IS NULL`, [T, RR]);
      assert.deepEqual(rows, [{
        assigned_employee_id: PARTS_ASSOCIATE, provenance: "NATIVE", assigned_by_principal_id: PRN_REORDER_ASSIGNER,
      }], "the ASSIGNEE is an Employee and the ACTOR is a Principal -- two columns, two concepts");
      assert.ok(await reorderAssignment.isCallerTheAssignedEmployee(pool, T, PRN[PARTS_ASSOCIATE], RR));
    });

    // ──────────────── AC2: Parts Manager is the oversight positive ────────────────
    await t.test("AC2: Parts Manager may be assigned, and the prior assignment is ENDED not duplicated", async () => {
      const result = await reorderAssignment.assignReorderRequestToEmployee(
        { pool }, actorWith(PRN_REORDER_ASSIGNER, caps(reorderAssignment.REORDER_REQUEST_ASSIGN)),
        { reorderRequestId: RR, employeeId: PARTS_MANAGER,
          reason: "Persona acceptance: oversight handoff to the Parts Manager persona" });
      assert.equal(result.outcome, "REASSIGNED");
      const { rows } = await q(
        `SELECT assigned_employee_id, effective_to IS NULL AS current FROM eos_ops.reorder_request_assignments
          WHERE tenant_id=$1 AND reorder_request_id=$2 ORDER BY effective_from, assigned_employee_id`, [T, RR]);
      assert.deepEqual(rows, [
        { assigned_employee_id: PARTS_ASSOCIATE, current: false },
        { assigned_employee_id: PARTS_MANAGER, current: true },
      ]);
      // ENDED IS NOT CURRENT: the associate stops being the assignee the moment the work moves on.
      assert.equal(await reorderAssignment.isCallerTheAssignedEmployee(pool, T, PRN[PARTS_ASSOCIATE], RR), false);
      assert.equal(await reorderAssignment.isCallerTheAssignedEmployee(pool, T, PRN[PARTS_MANAGER], RR), true);
    });

    await t.test("AC2: Parts Manager SEES the shared queue, on current Role authority", async () => {
      const decision = await ctx.authorizeObjectAction(reader, {
        actor: actorWith(PRN[PARTS_MANAGER], caps(REORDER_READ)), capabilityKey: REORDER_READ, predicates: QUEUE,
      });
      assert.deepEqual({ allowed: decision.allowed, reason: decision.reason }, { allowed: true, reason: "ALLOWED" });
    });

    // ──────────────── AC3: the Technician is the negative, and STAYS negative ────────────────
    await t.test("AC3: the governed command REFUSES the Technician, naming the qualification", async () => {
      await assert.rejects(
        () => reorderAssignment.assignReorderRequestToEmployee(
          { pool }, actorWith(PRN_REORDER_ASSIGNER, caps(reorderAssignment.REORDER_REQUEST_ASSIGN)),
          { reorderRequestId: RR_OTHER, employeeId: TECHNICIAN_A }),
        (err) => err.code === "EMPLOYEE_NOT_ASSIGNABLE" && err.category === "PRECONDITION_FAILED"
          && err.message.includes("PARTS_OPERATIONS"));
      const { rows } = await q(
        `SELECT 1 FROM eos_ops.reorder_request_assignments WHERE tenant_id=$1 AND assigned_employee_id=$2`,
        [T, TECHNICIAN_A]);
      assert.equal(rows.length, 0, "a refused assignment leaves NO row behind");
    });

    await t.test("AC3: the Technician holds SERVICE_TECHNICIAN and was never given PARTS_OPERATIONS", async () => {
      const { rows } = await q(
        `SELECT qualification_code FROM eos_workforce.employee_work_eligibility
          WHERE tenant_id=$1 AND employee_id=$2 AND effective_to IS NULL ORDER BY qualification_code`, [T, TECHNICIAN_A]);
      assert.deepEqual(rows.map((r) => r.qualification_code), ["SERVICE_TECHNICIAN"],
        "the negative case is only a negative case while nobody mutates it to pass");
      assert.ok(!dimensions.MANIFEST.personas["service-technician-a"].workEligibility.includes("PARTS_OPERATIONS"));
      assert.ok(!dimensions.MANIFEST.personas["service-technician-b"].workEligibility.includes("PARTS_OPERATIONS"));
      assert.ok(!dimensions.MANIFEST.personas["contract-technician"].workEligibility.includes("PARTS_OPERATIONS"));
    });

    // ──────────────── AC3 + AC4: TWO refusals, and they are not the same refusal ────────────────
    await t.test("AC4: qualified but UNSCOPED cannot see the shared queue", async () => {
      const decision = await ctx.authorizeObjectAction(reader, {
        actor: actorWith(PRN[PARTS_ASSOCIATE], caps(REORDER_READ)), capabilityKey: REORDER_READ, predicates: QUEUE,
      });
      assert.equal(decision.allowed, false);
      assert.equal(decision.reason, "OUTSIDE_OPERATIONAL_SCOPE");
      assert.equal(decision.predicate, "OPERATIONAL_SCOPE");
      assert.equal(decision.detail, `REORDER_QUEUE:${OPERATING_COMPANY_KEY}`);
    });

    await t.test("AC4: the two refusals are DISTINGUISHABLE -- reason, predicate and detail all differ", async () => {
      const unscoped = await ctx.authorizeObjectAction(reader, {
        actor: actorWith(PRN[PARTS_ASSOCIATE], caps(REORDER_READ)), capabilityKey: REORDER_READ, predicates: QUEUE,
      });
      const unqualified = await ctx.authorizeObjectAction(reader, {
        actor: actorWith(PRN[TECHNICIAN_A], caps(REORDER_READ)), capabilityKey: REORDER_READ, predicates: QUEUE,
      });
      assert.equal(unqualified.reason, "WORK_ELIGIBILITY_MISSING");
      assert.equal(unqualified.predicate, "WORK_ELIGIBILITY");
      assert.equal(unqualified.detail, "PARTS_OPERATIONS");

      assert.notEqual(unscoped.reason, unqualified.reason);
      assert.notEqual(unscoped.predicate, unqualified.predicate);
      assert.notEqual(unscoped.detail, unqualified.detail);
      // BOTH are denials, so "distinguishable" is about WHICH authority refused, not about the verdict.
      assert.equal(unscoped.allowed, false);
      assert.equal(unqualified.allowed, false);
      // THE ORDER IS THE PROOF. The technician fails at the FIRST predicate and never reaches the
      // scope one, so "missing qualification" can never be reported as "outside scope".
      assert.notEqual(unqualified.reason, "OUTSIDE_OPERATIONAL_SCOPE");
    });

    await t.test("AC4: the scope refusal is not reachable by holding the qualification", async () => {
      // Qualification and scope are separate authorities. parts-associate holds the first and not the
      // second; if holding the first ever satisfied the second, this returns ALLOWED.
      const decision = await ctx.authorizeObjectAction(reader, {
        actor: actorWith(PRN[PARTS_ASSOCIATE], caps(REORDER_READ)), capabilityKey: REORDER_READ,
        predicates: [{ kind: "OPERATIONAL_SCOPE", scopeType: "REORDER_QUEUE", scopeId: OPERATING_COMPANY_KEY }],
      });
      assert.equal(decision.reason, "OUTSIDE_OPERATIONAL_SCOPE");
    });

    await t.test("AC4: the unscoped persona still reaches their OWN assigned record", async () => {
      // The separation cuts both ways. Lacking queue scope is not lacking everything: an assignment is
      // its own path to the record, which is why a scope refusal must not be reported as a denial of
      // the capability itself.
      await reorderAssignment.assignReorderRequestToEmployee(
        { pool }, actorWith(PRN_REORDER_ASSIGNER, caps(reorderAssignment.REORDER_REQUEST_ASSIGN)),
        { reorderRequestId: RR_OTHER, employeeId: PARTS_ASSOCIATE,
          reason: "Persona acceptance: the OWN-record path for the unscoped execution persona" });
      const own = await ctx.authorizeObjectAction(reader, {
        actor: actorWith(PRN[PARTS_ASSOCIATE], caps(REORDER_READ)), capabilityKey: REORDER_READ,
        predicates: OWN, record: { recordKind: "reorderRequest", recordId: RR_OTHER },
      });
      assert.equal(own.allowed, true);

      // And the LIST is restricted in the query, so the queue never leaves the database.
      const p = ctx.ownRecordsPredicate("reorderRequest", "r.id");
      const { rows } = await q(
        `SELECT r.id FROM eos_ops.reorder_requests r WHERE r.tenant_id = $1 AND ${p.sql} ORDER BY r.id`,
        [T, PARTS_ASSOCIATE]);
      assert.deepEqual(rows.map((x) => x.id), [RR_OTHER],
        "one assigned request, not the queue -- the reassigned RR is no longer theirs");
    });

    await t.test("AC4: a missing capability names NO predicate, so neither refusal leaks", async () => {
      const decision = await ctx.authorizeObjectAction(reader, {
        actor: actorWith(PRN[TECHNICIAN_A], caps()), capabilityKey: REORDER_READ, predicates: QUEUE,
      });
      assert.equal(decision.reason, "CAPABILITY_MISSING");
      assert.equal(decision.predicate, undefined);
    });
  });
