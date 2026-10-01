// THE INVENTORY BASELINE GATE -- the fail-closed half of the Inventory cutover (Controller INVENTORY / WAREHOUSE
// COMPLETION RULINGS, 2026-10-01: "The cutover must fail closed if prerequisites are not proven").
//
// The placement, relocation, transfer, cycle-count and serialized-acquire writers are { firestore: FROZEN,
// postgres: ACTIVE } in code. A merged flip deploys before the governed baseline COPY runs, so every one of those
// writers ALSO requires the tenant's baseline to be CERTIFIED (eos_ops.inventory_baseline_cutovers, both stages), and
// until it is answers NOT_ACTIVATED -- exactly as an INACTIVE writer does. Only the governed cutover tool writes the
// certification (migration/inventoryBaselineCutover.ts), and only after its VERIFY reconciled the legacy ledger and
// serialized custody with zero blocking refusals.
//
// Receiving (already ACTIVE / PROVEN) and every READ are deliberately NOT gated: they never depended on the legacy
// baseline, and gating them would take away proven behaviour.
import type { PoolClient } from "pg";

type Queryable = Pick<PoolClient, "query">;

export const INVENTORY_BASELINE_STAGES = Object.freeze(["LEDGER", "CUSTODY"] as const);
export type InventoryBaselineStage = (typeof INVENTORY_BASELINE_STAGES)[number];

/** True when every baseline stage is certified for the tenant. */
export async function isInventoryBaselineCertified(db: Queryable, tenantId: string): Promise<boolean> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(DISTINCT stage)::int AS n FROM eos_ops.inventory_baseline_cutovers WHERE tenant_id = $1 AND stage = ANY($2)`,
    [tenantId, INVENTORY_BASELINE_STAGES as unknown as string[]]);
  return (rows[0]?.n ?? 0) === INVENTORY_BASELINE_STAGES.length;
}

/** The refusal every gated writer answers while the baseline is uncertified. */
export const INVENTORY_BASELINE_NOT_CERTIFIED_MESSAGE =
  "the inventory baseline has not been certified for this tenant; EOS inventory writes open only after the governed baseline COPY is verified";
