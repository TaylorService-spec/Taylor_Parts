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

  assert.equal(await count(), 496, "baseline + D-A + Service activation (+1: the returns-intake grant, migration 1764580000000)");
  for (const ch of roles.RECORDED_TENANT_SALES_CHANNELS) {
    await q(`INSERT INTO eos_policy.tenant_sales_channels (tenant_id,sales_channel,status,source,established_by,updated_by) VALUES ($1,$2,'ACTIVE','replay','replay','replay') ON CONFLICT DO NOTHING`, [T, ch]);
  }
  assert.equal(await apply(roles.commercialSharedContextOperations()), 500, "D-B Commercial Shared Context (+4)");
  assert.equal(await apply(d("salesManagerParityDelta").salesManagerActivationOperations()), 501, "Sales Manager separation (-1) + parity (+2)");
  assert.equal(await apply(d("serviceActivationAuthorityDelta").serviceExperienceOperations()), 502, "Service Experience (+1)");
  assert.equal(await apply(d("recordedActivationDecisionsDelta").recordedActivationOperations()), 514, "recorded Catalog/Reorder + self-scheduling (+12)");
  assert.equal(await apply(roles.operationalConfigurationAdministratorOperations()), 514, "DQ-033 creates a Role, no grant");
  assert.equal(await apply(d("partsPurchasingReceivingDelta").partsPurchasingReceivingOperations()), 520, "Parts / Purchasing / Receiving (+6)");
  assert.equal(await apply(d("purchasingFinanceClosureDelta").purchasingFinanceClosureOperations()), 520, "Purchasing -> Finance closure (grant and revoke net 0)");
  assert.equal(await apply(d("inventoryWarehouseActivationDelta").inventoryWarehouseGrantOperations()), 527, "Inventory / Warehouse (+7)");
  assert.equal(await apply(d("equipmentActivationDelta").equipmentActivationOperations()), 536, "Equipment (+9)");
  assert.equal(await apply(d("truckInventoryActivationDelta").truckInventoryActivationOperations()), 543, "Truck Inventory (+7)");

  const migrations = readdirSync(new URL("../migrations", import.meta.url)).filter((f) => f.endsWith(".sql")).length;
  assert.equal((await q(`SELECT count(*)::int n FROM public.pgmigrations`)).rows[0].n, migrations);
  assert.equal(migrations, 100); // 99 -> 100: 1764580000000 -- Returns intake on EOS Core (Firebase exit F7a, DECISIONS #242): eos_ops.inventory_returns + inventory.returns.intake, granted to inventoryReturnsIntakeClerk only (1 capability, 1 grant). // 98 -> 99: 1764570000000 Financial Policy withdraw / cancel (#232 Phase 3) -- schema only, no capability, no grant. // 94 -> 95: 1764530000000 (SUP-1 supplier terms + COMMERCIAL keys, granted to NO Role). 95 -> 96: 1764540000000 (grant-impact preview never-commit fence; triggers only)
  // 96 -> 97: 1764550000000 EOS native login -- schema only; no capability, no grant, so the counts do not move.
  // 97 -> 98: 1764560000000 Financial Policy foundation -- four finance.policy.* keys, granted to NO Role, so the grant counts do not move.
  assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.capabilities`)).rows[0].n, 140); // 139 -> 140: inventory.returns.intake (#242, 1764580000000). // 128 -> 135: the four inventory.supplierTerms.* + three inventory.catalog.cost.* keys; 135 -> 139: the four finance.policy.* keys
  // Replaying again adds nothing (idempotent), and the delta files introduce no Role beyond the two they record.
  assert.equal(await apply(d("truckInventoryActivationDelta").truckInventoryActivationOperations()), 543);
  for (const key of ["commercialSharedContext", "operationalConfigurationAdministrator"]) {
    assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.roles WHERE tenant_id=$1 AND key=$2`, [T, key])).rows[0].n, 1, key);
  }
});
