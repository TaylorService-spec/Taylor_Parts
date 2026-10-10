// THE NINE APPROVED MANAGEMENT ACTIONS BY STANDING (Owner O1 ADMIN class, G2, G3; DECISIONS #227 / PR-4b).
//
// A protected Administrator's resolved context holds the nine management keys with no grant, and the commands they gate
// admit it through the capability check -- every other check (lifecycle state, reason, reach, single void, audit) still
// runs. No O1 WORKER key, no reserved key (G7) and no other business key arrives with standing.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { serviceBaselineTenant } from "./support/serviceBaselineTenant.mjs";

const require = createRequire(import.meta.url);
const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const T = "t-pmgmt";

test("PostgreSQL: standing resolves the nine management actions and nothing executional", { skip: SKIP, concurrency: false }, async (t) => {
  const { pool, repo, person } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: T, prefix: "pmgmt" });
  const { PROTECTED_ADMINISTRATOR_MANAGEMENT_CAPABILITIES } = require("../lib/adminPolicy/protectedAdministrator.js");
  const { ADMINISTRATOR_EXECUTION_CAPABILITIES } = require("../lib/eosOps/administrationReach.js");
  const { resolveOperationalContext } = require("../lib/eosOps/capabilityAuthority.js");
  const { postgresGrantConditionProvider } = require("../lib/eosOps/entitledActionAuthority.js");
  const { voidReorderPurchaseOrder, reviewReorderRequest, cancelReorderRequest } = require("../lib/eosOps/reorderLifecycleCommands.js");
  const ctxOf = (subject) => resolveOperationalContext(repo, pool, { identityProvider: "firebase", externalSubject: subject, requestedTenantId: null }, postgresGrantConditionProvider(pool));
  const registered = new Set((await pool.query(`SELECT key FROM eos_policy.capabilities`)).rows.map((r) => r.key));
  const admin = await ctxOf("uid-pmgmt-admin");
  await person("uid-pmgmt-disp", ["dispatcher"]);
  const dispatcher = await ctxOf("uid-pmgmt-disp");
  const actorOf = (ctx) => ({ tenantId: T, principalId: ctx.principalContext.uid, capabilities: ctx.capabilities });

  await t.test("the Administrator's flat capability set holds every registered management key; no WORKER or reserved key", () => {
    for (const key of PROTECTED_ADMINISTRATOR_MANAGEMENT_CAPABILITIES) {
      if (!registered.has(key)) continue;
      assert.equal(admin.capabilities.has(key), true, `${key} by standing`);
      assert.equal(admin.protectedAdministratorKeys.has(key), true, `${key} carries the standing provenance`);
    }
    for (const key of ADMINISTRATOR_EXECUTION_CAPABILITIES) assert.equal(admin.protectedAdministratorKeys.has(key), false, `${key} never by standing`);
    assert.equal(admin.capabilities.has("salesAgreement.tradeIn.approve"), false, "G7 stays reserved");
  });

  await t.test("the commands' capability gates admit the Administrator and still refuse a non-holder; the other checks still run", async () => {
    const missing = "rr_00000000-0000-4000-8000-000000000000";
    // G3 void: past the capability gate the PO's own company reach decides -- a PO that does not exist is refused as unreachable.
    await assert.rejects(voidReorderPurchaseOrder({ pool }, actorOf(admin), { reorderRequestId: missing, voidReason: "management void" }),
      (e) => e.code === "OUTSIDE_VOID_REACH");
    await assert.rejects(voidReorderPurchaseOrder({ pool }, actorOf(admin), { reorderRequestId: missing }),
      (e) => e.code === "VOID_REASON_REQUIRED", "a void still states its reason");
    await assert.rejects(voidReorderPurchaseOrder({ pool }, actorOf(dispatcher), { reorderRequestId: missing, voidReason: "x" }),
      (e) => e.code === "CAPABILITY_REQUIRED");
    for (const [run, input] of [[reviewReorderRequest, { reorderRequestId: missing, decision: "APPROVED" }],
      [cancelReorderRequest, { reorderRequestId: missing, reason: "management cancel" }]]) {
      await assert.rejects(run({ pool }, actorOf(admin), input), (e) => e.code !== "CAPABILITY_REQUIRED" && e.code !== "ACTOR_CONTEXT_REQUIRED",
        `${run.name}: the Administrator passes the capability gate`);
    }
  });
});
