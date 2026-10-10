// ADMINISTRATOR FULL ACCESS -- the Reorder queue (Owner ruling 2026-10-09; defect: "reading the Reorder queue requires the
// REORDER_QUEUE Operational Scope" on the Inventory & Supply Overview for the Administrator).
//
// The queue read is the capability (reorder.request.read) AND the company-keyed REORDER_QUEUE Operational Scope of the
// caller's linked Employee (reorderLifecycleCommands.requireQueueReach). That model is unchanged here. The Administrator
// holds the capability through `admin`; what it lacked was the governed Employee scope, which is issued through the
// Workforce writer (assignEmployeeOperationalScope) by a DIFFERENT authorized principal -- self-scoping stays refused.
//   - the Administrator without the scope is refused exactly as reported;
//   - with REORDER_QUEUE for each company key, the Administrator reads the queue;
//   - a capability holder WITHOUT the scope (technician) stays refused; a non-holder stays refused; the Administrator
//     still cannot scope its own Employee.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { serviceBaselineTenant } from "./support/serviceBaselineTenant.mjs";

const require = createRequire(import.meta.url);
const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const T = "t-admin-rq";

test("Administrator reaches the Reorder queue through the governed REORDER_QUEUE scope; others stay refused", { skip: SKIP, concurrency: false }, async (t) => {
  const { q, person, call, pool } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: T, prefix: "admrq" });
  const { assignEmployeeOperationalScope } = require("../lib/eosWorkforce/commands/employeeOperationalScopeCommands.js");
  const { resolveOperationalContext } = require("../lib/eosOps/capabilityAuthority.js");
  const { postgresGrantConditionProvider } = require("../lib/eosOps/entitledActionAuthority.js");

  const administrator = await person("uid-admrq-administrator", ["admin"], { id: "e-admrq-admin", name: "Casey Admin" });
  // A SECOND principal holding admin.employeeOperationalScope.write. (Since #224/#228 the nonprod seed issues the
  // Administrator NO scope -- the protected Administrator reaches queues by standing -- but the governed model proven here,
  // a scope issued by a different authorized principal and self-scoping refused, is unchanged.)
  const otherAdministrator = await person("uid-admrq-other-admin", ["admin"], { id: "e-admrq-other", name: "Morgan Other" });
  const technician = await person("uid-admrq-tech", ["technician"], { id: "e-admrq-tech", name: "Sofia Tech", technician: true });
  const nobody = await person("uid-admrq-nobody", [], { id: "e-admrq-nobody", name: "Gen Employee" });
  const queue = (who) => call(who, "/operations/inventory", "readReorderQueue", {});
  // The transport answers the CATEGORY (FORBIDDEN); the refusal is named in the message.
  const refusedOutsideScope = (r) => {
    assert.equal(r.status, 403, JSON.stringify(r.body).slice(0, 300));
    assert.equal(r.body.code, "FORBIDDEN");
    assert.match(r.body.message, /reading the Reorder queue requires the REORDER_QUEUE Operational Scope/);
  };

  await t.test("the reported defect is closed by STANDING (DECISIONS #224): the Administrator reads the queue with NO scope", async () => {
    // PR-2: a protected Administrator administers every authorized company's queue without an Employee REORDER_QUEUE scope.
    const r = await queue(administrator);
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
    const held = (await q(`SELECT count(*)::int n FROM eos_workforce.employee_operational_scopes WHERE tenant_id=$1 AND employee_id='e-admrq-admin'`, [T])).rows[0].n;
    assert.equal(held, 0, "no scope row was needed or created");
  });

  // The governed writer, as a different authorized principal -- the same command the nonprod seed issues as the Owner persona.
  const actorOf = async (who) => {
    const ctx = await resolveOperationalContext(serviceRepo(), pool, { identityProvider: "firebase", externalSubject: who.subject, requestedTenantId: null }, postgresGrantConditionProvider(pool));
    return { tenantId: T, principalId: ctx.principalContext.uid, capabilities: ctx.capabilities, conditionallyHeld: ctx.conditionallyHeld, scopedHeld: ctx.scopedHeld, entitlements: ctx.entitlements };
  };
  function serviceRepo() {
    const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
    return new PostgresPolicyRepository(pool);
  }

  await t.test("the Administrator may not scope its own Employee (the guard is unchanged)", async () => {
    await assert.rejects(
      assignEmployeeOperationalScope({ pool }, await actorOf(administrator), { employeeId: "e-admrq-admin", scopeType: "REORDER_QUEUE", scopeId: "taylor", reason: "self" }),
      (err) => err.code === "OPERATIONAL_SCOPE_SELF");
  });

  await t.test("an UNKEYED company's queue cannot be issued (why nonprod issues taylor only: Ventana is unkeyed there)", async () => {
    await assert.rejects(
      assignEmployeeOperationalScope({ pool }, await actorOf(otherAdministrator), { employeeId: "e-admrq-admin", scopeType: "REORDER_QUEUE", scopeId: "unkeyed-co", reason: "x" }),
      (err) => err.code === "REORDER_QUEUE_NOT_FOUND");
  });

  await t.test("the correction: REORDER_QUEUE:taylor, issued by another authorized principal -> the queue reads", async () => {
    await assignEmployeeOperationalScope({ pool }, await actorOf(otherAdministrator),
      { employeeId: "e-admrq-admin", scopeType: "REORDER_QUEUE", scopeId: "taylor", reason: "Owner ruling 2026-10-09: Administrator full access" });
    const r = await queue(administrator);
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
    assert.ok(Array.isArray(r.body.result));
    const held = (await q(`SELECT scope_id FROM eos_workforce.employee_operational_scopes WHERE tenant_id=$1 AND employee_id='e-admrq-admin' AND scope_type='REORDER_QUEUE' AND effective_to IS NULL ORDER BY 1`, [T])).rows.map((r) => r.scope_id);
    assert.deepEqual(held, ["taylor"], "one keyed company is enough to read the queue");
    // No Work Eligibility came with it (ADMIN_IMPLIES_NO_WORK_ELIGIBILITY).
    assert.equal(Number((await q(`SELECT count(*)::int n FROM eos_workforce.employee_work_eligibility WHERE tenant_id=$1 AND employee_id='e-admrq-admin'`, [T])).rows[0].n), 0);
  });

  await t.test("unauthorized roles stay refused", async () => {
    refusedOutsideScope(await queue(technician)); // holds reorder.request.read, no scope
    const none = await queue(nobody); // no reorder.request.read at all
    assert.equal(none.status, 403);
    assert.equal(none.body.code, "FORBIDDEN");
    assert.match(none.body.message, /reorder\.request\.read/);
  });
});
