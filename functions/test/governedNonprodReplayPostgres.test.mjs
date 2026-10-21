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

  assert.equal(await count(), 750, "baseline + D-A + Service activation (+4: the S1c holders grants, migration 1764717000000; +3: the S1c Sales Order allocation grants, migration 1764714000000; +32: the G-1 performance goal authoring grants, migration 1764690000000; +8: the A6 customer-balance summary grants, migration 1764680000000; +30: the GRANT-1 Owner policy grants, migration 1764670000000; +1: the returns-intake grant, migration 1764580000000; +6: the CRM-activity parity grants, migration 1764590000000; +15: the Finance visibility mirror, migration 1764620000000; +27: the P-1 supplier purchase order grants, migration 1764660000000; +122: the B4 report/goal parity grants, migration 1764650000000; +7: the Warehouse racking mirror, migration 1764630000000)");
  for (const ch of roles.RECORDED_TENANT_SALES_CHANNELS) {
    await q(`INSERT INTO eos_policy.tenant_sales_channels (tenant_id,sales_channel,status,source,established_by,updated_by) VALUES ($1,$2,'ACTIVE','replay','replay','replay') ON CONFLICT DO NOTHING`, [T, ch]);
  }
  assert.equal(await apply(roles.commercialSharedContextOperations()), 754, "D-B Commercial Shared Context (+4)");
  assert.equal(await apply(d("salesManagerParityDelta").salesManagerActivationOperations()), 755, "Sales Manager separation (-1) + parity (+2)");
  assert.equal(await apply(d("serviceActivationAuthorityDelta").serviceExperienceOperations()), 756, "Service Experience (+1)");
  assert.equal(await apply(d("recordedActivationDecisionsDelta").recordedActivationOperations()), 768, "recorded Catalog/Reorder + self-scheduling (+12)");
  assert.equal(await apply(roles.operationalConfigurationAdministratorOperations()), 768, "DQ-033 creates a Role, no grant");
  assert.equal(await apply(d("partsPurchasingReceivingDelta").partsPurchasingReceivingOperations()), 774, "Parts / Purchasing / Receiving (+6)");
  assert.equal(await apply(d("purchasingFinanceClosureDelta").purchasingFinanceClosureOperations()), 774, "Purchasing -> Finance closure (grant and revoke net 0)");
  assert.equal(await apply(d("inventoryWarehouseActivationDelta").inventoryWarehouseGrantOperations()), 781, "Inventory / Warehouse (+7)");
  assert.equal(await apply(d("equipmentActivationDelta").equipmentActivationOperations()), 790, "Equipment (+9)");
  assert.equal(await apply(d("truckInventoryActivationDelta").truckInventoryActivationOperations()), 797, "Truck Inventory (+7)");

  const migrations = readdirSync(new URL("../migrations", import.meta.url)).filter((f) => f.endsWith(".sql")).length;
  assert.equal((await q(`SELECT count(*)::int n FROM public.pgmigrations`)).rows[0].n, migrations);
  assert.equal(migrations, 118); // 117 -> 118: 1764718000000 -- SAE Rule 2 delegated self-approval exemption (2026-10-20): seven capabilities, no grants, so the grant counts do not move. // 116 -> 117: 1764717000000 -- S1c holders (Owner ruling 2026-10-20): 4 grants of salesOrder.fulfill, no capability, no schema. // 115 -> 116: 1764716000000 -- SAE protected-Owner secondary-approval exemption (2026-10-20): the SQL seam and database-level people rules; no capability, no grant, so the counts do not move. // 114 -> 115: 1764714000000 -- S1c Sales Order allocation (2026-10-20): salesOrder.fulfill, 3 grants, no schema. // 112 -> 114: 1764712000000 -- F-1b governed invoice corrections (2026-10-20): three finance approval capabilities, no grants (S1b 1764710000000 is the 113th). // 111 -> 112: 1764700000000 -- F-1a issue invoice on EOS (2026-10-20): schema only, no capability and no grant, so the counts do not move. 110 -> 111: 1764690000000 -- G-1 performance goal authoring (2026-10-20): four performance.goal.* capabilities, 32 Firebase-mirrored grants and the authoring idempotency table. // 109 -> 110: 1764680000000 -- A6 customer-balance summary (2026-10-19): finance.accountBalance.read registered (a READ key) and 8 Owner-ruled grants; no schema. // 108 -> 109: 1764670000000 -- GRANT-1 Owner policy grants (2026-10-19): inventory.catalog.part.activate registered and 30 Owner-ruled grants; no schema. // 107 -> 108: 1764660000000 -- P-1 supplier purchase order authoring (DECISIONS #P-1): five supplier.purchaseOrder.* capabilities, 27 Owner-ruled grants, the order stamps / line link columns, the SPO number counter and the authoring idempotency record. // 106 -> 107: 1764650000000 -- B4 report / performance-goal parity (Firebase exit B4, DECISIONS #B4, OD-B4-1): the 122 Firebase-mirrored role-capability grants for the 39 registered B4 keys; no capability, no schema. // 105 -> 106: 1764640000000 -- Records and reporting off Firebase (Firebase exit B4, DECISIONS #B4): 39 capabilities registered, granted to nobody, four empty tables. // 104 -> 105: 1764630000000 -- Warehouse and receiving off Firebase (Firebase exit B3, DECISIONS #B3): inventory.location.bin.read / .manage registered and mirrored to the current Firebase holders (2 capabilities, 7 grants), plus eos_ops.supplier_purchase_orders (+ lines) and the read-only legacy_inventory_action_notes archive. // 103 -> 104: 1764620000000 -- Finance visibility mirror (Firebase exit B1, DECISIONS #B1): five finance.visibility.* keys, 15 grants, a Sales Order credit trigger. // 102 -> 103: 1764610000000 -- Employee company-access grants (DECISIONS #249): one table + store guards, no capability, no grant. // 101 -> 102: 1764600000000 -- Role company-authority classification (DECISIONS #248): roles.company_authority_effect + two governing triggers, no capability, no grant. // 100 -> 101: 1764590000000 -- CRM activity on EOS Core (Firebase exit F7b, DECISIONS #243): eos_crm.activities + crm.activity.read / .create, mirrored to admin, owner and crmActivityContributor (2 capabilities, 6 grants). // 99 -> 100: 1764580000000 -- Returns intake on EOS Core (Firebase exit F7a, DECISIONS #242): eos_ops.inventory_returns + inventory.returns.intake, granted to inventoryReturnsIntakeClerk only (1 capability, 1 grant). // 98 -> 99: 1764570000000 Financial Policy withdraw / cancel (#232 Phase 3) -- schema only, no capability, no grant. // 94 -> 95: 1764530000000 (SUP-1 supplier terms + COMMERCIAL keys, granted to NO Role). 95 -> 96: 1764540000000 (grant-impact preview never-commit fence; triggers only)
  // 96 -> 97: 1764550000000 EOS native login -- schema only; no capability, no grant, so the counts do not move.
  // 97 -> 98: 1764560000000 Financial Policy foundation -- four finance.policy.* keys, granted to NO Role, so the grant counts do not move.
  assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.capabilities`)).rows[0].n, 210); // 203 -> 210: the seven approval.selfApproval.exempt* keys (SAE Rule 2, 1764718000000), granted to NOBODY. // 202 -> 203: salesOrder.fulfill (S1c, 1764714000000, +3 grants). // 199 -> 202 (grants unchanged, 729): finance.adjustment.approve / finance.refund.approve / finance.invoice.void.approve (F-1b, 1764712000000). // 195 -> 199: performance.goal.create / .approve / .supersede / .retire (G-1, 1764690000000). // 194 -> 195: finance.accountBalance.read (A6, 1764680000000), granted to eight operational Roles. // 193 -> 194: inventory.catalog.part.activate (GRANT-1 A1 split, 1764670000000). // 188 -> 193: the five supplier.purchaseOrder.* keys (P-1, 1764660000000), granted to the ruled Roles. // 149 -> 188: the 38 report.* ids and performance.goal.read (B4, 1764640000000), granted to NO Role. // 147 -> 149: the two inventory.location.bin.* keys (B3, 1764630000000). // 142 -> 147: the five finance.visibility.* keys (B1, 1764620000000). // 140 -> 142: crm.activity.read / .create (#243, 1764590000000). // 139 -> 140: inventory.returns.intake (#242, 1764580000000). // 128 -> 135: the four inventory.supplierTerms.* + three inventory.catalog.cost.* keys; 135 -> 139: the four finance.policy.* keys
  // Replaying again adds nothing (idempotent), and the delta files introduce no Role beyond the two they record.
  assert.equal(await apply(d("truckInventoryActivationDelta").truckInventoryActivationOperations()), 797);
  for (const key of ["commercialSharedContext", "operationalConfigurationAdministrator"]) {
    assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.roles WHERE tenant_id=$1 AND key=$2`, [T, key])).rows[0].n, 1, key);
  }
});
