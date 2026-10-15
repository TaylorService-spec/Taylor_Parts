// GOVERNED NONPROD REPLAY = 542 (UI corrections integration readiness, 2026-10-08).
//
// The repository alone reproduces the governed nonprod authority: the authority baseline (migrations + canonical catalog +
// activation), D-A, and EVERY recorded Administration delta, applied in ruling order through the Administration API, yield
// exactly nonprod's census -- 94 migrations, 128 capabilities, 542 grants -- with no refusal. Each stage's count is pinned so a
// new delta, a changed one or a missing input is caught here rather than discovered as a local/nonprod divergence.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { serviceBaselineTenant } from "./support/serviceBaselineTenant.mjs";

const require = createRequire(import.meta.url);
const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const T = "taylor-nonprod";
const d = (m) => require(`../lib/adminPolicy/${m}.js`);

test("the recorded decisions replay the governed nonprod authority exactly: 94 / 128 / 542 (+ SUP-1: 95 / 135, no grant)", { skip: SKIP, concurrency: false }, async (t) => {
  const { q, admin } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: T, prefix: "govreplay" });
  const count = async () => (await q(`SELECT count(*)::int n FROM eos_policy.role_capabilities WHERE tenant_id=$1`, [T])).rows[0].n;
  const apply = async (ops) => { for (const { operation, input } of ops) { const r = await admin(operation, input); assert.equal(r.ok, true, `${operation} ${JSON.stringify(input)} -> ${r.code} ${r.message}`); } return count(); };
  const roles = d("recordedAdministrationRolesDelta");

  assert.equal(await count(), 495, "baseline + D-A + Service activation");
  for (const ch of roles.RECORDED_TENANT_SALES_CHANNELS) {
    await q(`INSERT INTO eos_policy.tenant_sales_channels (tenant_id,sales_channel,status,source,established_by,updated_by) VALUES ($1,$2,'ACTIVE','replay','replay','replay') ON CONFLICT DO NOTHING`, [T, ch]);
  }
  assert.equal(await apply(roles.commercialSharedContextOperations()), 499, "D-B Commercial Shared Context (+4)");
  assert.equal(await apply(d("salesManagerParityDelta").salesManagerActivationOperations()), 500, "Sales Manager separation (-1) + parity (+2)");
  assert.equal(await apply(d("serviceActivationAuthorityDelta").serviceExperienceOperations()), 501, "Service Experience (+1)");
  assert.equal(await apply(d("recordedActivationDecisionsDelta").recordedActivationOperations()), 513, "recorded Catalog/Reorder + self-scheduling (+12)");
  assert.equal(await apply(roles.operationalConfigurationAdministratorOperations()), 513, "DQ-033 creates a Role, no grant");
  assert.equal(await apply(d("partsPurchasingReceivingDelta").partsPurchasingReceivingOperations()), 519, "Parts / Purchasing / Receiving (+6)");
  assert.equal(await apply(d("purchasingFinanceClosureDelta").purchasingFinanceClosureOperations()), 519, "Purchasing -> Finance closure (grant and revoke net 0)");
  assert.equal(await apply(d("inventoryWarehouseActivationDelta").inventoryWarehouseGrantOperations()), 526, "Inventory / Warehouse (+7)");
  assert.equal(await apply(d("equipmentActivationDelta").equipmentActivationOperations()), 535, "Equipment (+9)");
  assert.equal(await apply(d("truckInventoryActivationDelta").truckInventoryActivationOperations()), 542, "Truck Inventory (+7)");
  // D-2 (OWNER APPROVAL REQUIRED): admin loses finance.refund.record + finance.adjustment.record (-2); partsManager x adjustment
  // is already revoked by the closure delta above, so its repeat is a no-op.
  assert.equal(await apply(d("financeExecutionAdminSeparationDelta").financeExecutionAdminSeparationOperations()), 540, "Finance execution / Administration separation (-2)");
  const held = async (role) => new Set((await q(`SELECT c.key FROM eos_policy.role_capabilities rc JOIN eos_policy.roles r ON r.id=rc.role_id AND r.tenant_id=rc.tenant_id
    JOIN eos_policy.capabilities c ON c.id=rc.capability_id WHERE rc.tenant_id=$1 AND r.key=$2`, [T, role])).rows.map((r) => r.key));
  for (const role of ["admin", "partsManager"]) for (const k of ["finance.refund.record", "finance.adjustment.record"]) assert.equal((await held(role)).has(k), false, `${role} x ${k}`);
  for (const role of d("financeExecutionAdminSeparationDelta").FINANCE_EXECUTION_HOLDER_ROLE_KEYS) {
    for (const k of ["finance.refund.record", "finance.adjustment.record"]) assert.equal((await held(role)).has(k), true, `${role} keeps ${k}`);
  }
  const decisions = (await q(`SELECT role_key, capability_key FROM eos_policy.role_capability_decisions WHERE tenant_id=$1 AND decision='ADMIN_REVOKED' AND superseded_at IS NULL
    AND capability_key IN ('finance.refund.record','finance.adjustment.record') ORDER BY 1,2`, [T])).rows.map((r) => `${r.role_key}:${r.capability_key}`);
  assert.deepEqual(decisions, ["admin:finance.adjustment.record", "admin:finance.refund.record", "partsManager:finance.adjustment.record"], "each revoke is an ADMIN_REVOKED decision");

  const migrations = readdirSync(new URL("../migrations", import.meta.url)).filter((f) => f.endsWith(".sql")).length;
  assert.equal((await q(`SELECT count(*)::int n FROM public.pgmigrations`)).rows[0].n, migrations);
  assert.equal(migrations, 99); // 98 -> 99: 1764570000000 Financial Policy withdraw / cancel (#232 Phase 3) -- schema only, no capability, no grant. // 94 -> 95: 1764530000000 (SUP-1 supplier terms + COMMERCIAL keys, granted to NO Role). 95 -> 96: 1764540000000 (grant-impact preview never-commit fence; triggers only)
  // 96 -> 97: 1764550000000 EOS native login -- schema only; no capability, no grant, so the counts do not move.
  // 97 -> 98: 1764560000000 Financial Policy foundation -- four finance.policy.* keys, granted to NO Role, so the grant counts do not move.
  assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.capabilities`)).rows[0].n, 139); // 128 -> 135: the four inventory.supplierTerms.* + three inventory.catalog.cost.* keys; 135 -> 139: the four finance.policy.* keys
  // Replaying again adds nothing (idempotent), and the delta files introduce no Role beyond the two they record.
  assert.equal(await apply(d("truckInventoryActivationDelta").truckInventoryActivationOperations()), 540);
  assert.equal(await apply(d("financeExecutionAdminSeparationDelta").financeExecutionAdminSeparationOperations()), 540, "the separation replays as a no-op");
  for (const key of ["commercialSharedContext", "operationalConfigurationAdministrator"]) {
    assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.roles WHERE tenant_id=$1 AND key=$2`, [T, key])).rows[0].n, 1, key);
  }
});
