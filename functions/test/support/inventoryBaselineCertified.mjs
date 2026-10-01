// TEST FIXTURE: a tenant whose legacy inventory baseline is CERTIFIED (eos_ops.inventory_baseline_cutovers, both stages).
//
// The Inventory writers fail closed until a tenant's baseline is certified by the governed cutover
// (src/eosOps/inventoryBaselineGate.ts; Controller INVENTORY / WAREHOUSE COMPLETION RULINGS, 2026-10-01). Suites that prove a
// writer's OWN behaviour certify their throwaway tenant with this fixture row; the certification path itself -- COPY, VERIFY,
// CERTIFY, and the gate refusing before it -- is proven end to end by inventoryWarehouseJourneyPostgres.test.mjs.
export async function certifyInventoryBaselineFixture(q, tenantId) {
  for (const stage of ["LEDGER", "CUSTODY"]) {
    await q(`INSERT INTO eos_ops.inventory_baseline_cutovers (tenant_id, stage, snapshot_sha256, manifest_sha256, evidence, certified_by)
             VALUES ($1, $2, $3, $3, '{"fixture":true}'::jsonb, 'test-fixture') ON CONFLICT DO NOTHING`, [tenantId, stage, "0".repeat(64)]);
  }
}
