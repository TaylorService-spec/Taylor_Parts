// FBR-F1 -- THE VENTANA INVENTORY RELIEF OF AN INTERCOMPANY SALE (Finance Closure, DECISIONS #206).
//
// When Ventana sells stock to Taylor through the governed intercompany purchase / receipt path (#202), Taylor's RECEIPT
// establishes Taylor's ownership and custody (Taylor's warehouse record, Taylor's company key). Ventana's sold stock is NOT
// decremented by inference from that receipt or from the intercompany obligations: it is relieved by THIS explicit, audited
// inventory event, recorded by a Ventana warehouse operator against the correlation:
//
//   * ONE relief per received line (unique) -- no double decrement; the quantity is exactly the line's received quantity;
//   * from a warehouse record OF THE SELLER COMPANY (a shared physical building has one record per company; the record, never
//     the site, decides whose stock it is) -- refused for any other company's warehouse;
//   * an INTERCOMPANY_SALE_RELIEF movement on the seller's own ledger, sourced to the correlation; never an ownership flip of
//     an existing row, never a movement on Taylor's side;
//   * refused when the seller's recorded on-hand at that warehouse cannot cover it (EOS never drives stock negative to make a
//     relief fit -- the shortfall is a real inventory exception to investigate);
//   * quantity-tracked parts only; a serialized unit's intercompany custody needs serial identity this path does not carry.
//
// Authority: inventory.transfer.dispatch (issuing stock out of a warehouse) narrowed by WAREHOUSE scope over the source.
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { authorizeObjectAction, postgresContextualReader } from "./contextualAuthorization.js";
import { lockStockLocation } from "./stockLocationLock.js";

export const INTERCOMPANY_RELIEF_CAPABILITY = "inventory.transfer.dispatch";
export const INTERCOMPANY_RELIEF_MOVEMENT_SOURCE_KIND = "INTERCOMPANY_TRANSACTION";

export class IntercompanyReliefError extends Error {
  constructor(readonly code: string, readonly category: "INVALID_INPUT" | "NOT_FOUND" | "PRECONDITION_FAILED" | "CONFLICT" | "FORBIDDEN", message: string) {
    super(message);
    this.name = "IntercompanyReliefError";
  }
}
const refuse = (code: string, category: IntercompanyReliefError["category"], message: string): never => {
  throw new IntercompanyReliefError(code, category, message);
};

export interface ReliefActor { readonly tenantId: string; readonly principalId: string; readonly capabilities: ReadonlySet<string> }

export async function relieveIntercompanySaleInventory(deps: { readonly pool: Pool }, actor: ReliefActor, input: Record<string, unknown>) {
  const allowed = ["intercompanyTransactionId", "receivingLineId", "sourceWarehouseId", "reason", "idempotencyKey"];
  const extra = Object.keys(input ?? {}).filter((k) => !allowed.includes(k));
  if (extra.length) refuse("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `not accepted: ${extra.sort().join(", ")}`);
  const str = (v: unknown, name: string, max = 200): string => {
    if (typeof v !== "string" || v.trim() === "" || v.length > max) refuse(`${name.toUpperCase()}_REQUIRED`, "INVALID_INPUT", `${name} is required`);
    return (v as string).trim();
  };
  const correlationId = str(input.intercompanyTransactionId, "intercompanyTransactionId");
  const lineId = str(input.receivingLineId, "receivingLineId");
  const warehouseId = str(input.sourceWarehouseId, "sourceWarehouseId");
  const reason = str(input.reason, "reason", 500);
  const key = str(input.idempotencyKey, "idempotencyKey");
  if (!actor.capabilities.has(INTERCOMPANY_RELIEF_CAPABILITY)) refuse("CAPABILITY_REQUIRED", "FORBIDDEN", `this command requires ${INTERCOMPANY_RELIEF_CAPABILITY}`);

  const c: PoolClient = await deps.pool.connect();
  try {
    await c.query("BEGIN");
    const { rows: prior } = await c.query(`SELECT * FROM eos_ops.intercompany_inventory_reliefs WHERE tenant_id = $1 AND idempotency_key = $2`, [actor.tenantId, key]);
    if (prior[0]) {
      if (prior[0].intercompany_transaction_id !== correlationId || prior[0].receiving_line_id !== lineId) refuse("IDEMPOTENCY_KEY_REUSED", "CONFLICT", "that key relieved something else");
      await c.query("COMMIT");
      return Object.freeze({ outcome: "replayed" as const, reliefId: String(prior[0].id), movementId: String(prior[0].movement_id), quantity: Number(prior[0].quantity) });
    }
    const { rows: tr } = await c.query(`SELECT * FROM eos_finance.intercompany_transactions WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [actor.tenantId, correlationId]);
    const t = tr[0] ?? refuse("INTERCOMPANY_TRANSACTION_NOT_FOUND", "NOT_FOUND", "no intercompany transaction with that id");
    if (t.status === "SUPERSEDED_BY_RECEIPT_CORRECTION") refuse("INTERCOMPANY_SUPERSEDED", "PRECONDITION_FAILED", "the intercompany receipt was corrected; its replacement carries its own relief");
    const { rows: ln } = await c.query(`SELECT * FROM eos_ops.receiving_order_lines WHERE tenant_id = $1 AND receiving_order_id = $2 AND line_id = $3`,
      [actor.tenantId, t.source_record_id, lineId]);
    const line = ln[0] ?? refuse("RECEIPT_LINE_NOT_FOUND", "NOT_FOUND", "no such line on the intercompany receipt");
    if (String(line.tracking_mode) !== "NONE") refuse("RELIEF_SERIAL_UNSUPPORTED", "PRECONDITION_FAILED", "a serialized unit's intercompany relief needs serial identity this path does not carry");
    const { rows: done } = await c.query(`SELECT 1 FROM eos_ops.intercompany_inventory_reliefs WHERE tenant_id = $1 AND intercompany_transaction_id = $2 AND receiving_line_id = $3`,
      [actor.tenantId, correlationId, lineId]);
    if (done[0]) refuse("INTERCOMPANY_ALREADY_RELIEVED", "CONFLICT", "that received line's seller inventory was already relieved");
    // The SELLER's key (the governed binding), and a warehouse RECORD of that company.
    const { rows: sk } = await c.query(`SELECT operating_company_key FROM eos_policy.tenant_operating_company_keys WHERE tenant_id = $1 AND operating_company_id = $2 AND status = 'ACTIVE'`,
      [actor.tenantId, t.seller_operating_company_id]);
    const sellerKey = sk[0]?.operating_company_key ?? refuse("SELLER_KEY_UNBOUND", "PRECONDITION_FAILED", "the seller company has no active operating key");
    const { rows: wh } = await c.query(`SELECT id, operating_company_key, status FROM eos_ops.warehouses WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, warehouseId]);
    const w = wh[0] ?? refuse("WAREHOUSE_NOT_FOUND", "NOT_FOUND", "no such warehouse");
    if (w.operating_company_key !== sellerKey) refuse("RELIEF_WAREHOUSE_NOT_SELLERS", "PRECONDITION_FAILED", "relief comes from the SELLER company's own warehouse record, never another company's");
    const scoped = await authorizeObjectAction(postgresContextualReader(c), {
      actor, capabilityKey: INTERCOMPANY_RELIEF_CAPABILITY, predicates: [{ kind: "OPERATIONAL_SCOPE" as const, scopeType: "WAREHOUSE", scopeId: warehouseId }],
    });
    if (!scoped.allowed) refuse(scoped.reason, "FORBIDDEN", scoped.reason === "OUTSIDE_OPERATIONAL_SCOPE" ? "that warehouse is outside your warehouse scope" : "not authorized to relieve this inventory");
    const qty = Number(line.received_quantity);
    await lockStockLocation(c, actor.tenantId, String(line.part_id), "WAREHOUSE", warehouseId);
    const { rows: oh } = await c.query(`SELECT COALESCE(SUM(quantity_delta), 0)::int AS n FROM eos_ops.inventory_movements
      WHERE tenant_id = $1 AND part_id = $2 AND location_type = 'WAREHOUSE' AND location_id = $3 AND operating_company_key = $4`,
      [actor.tenantId, line.part_id, warehouseId, sellerKey]);
    if (Number(oh[0].n) < qty) refuse("RELIEF_EXCEEDS_ON_HAND", "PRECONDITION_FAILED", `the seller's recorded on-hand (${oh[0].n}) cannot cover ${qty}; investigate the inventory first`);
    const movementId = `mov_${randomUUID()}`;
    await c.query(
      `INSERT INTO eos_ops.inventory_movements (id, tenant_id, part_id, tracking_mode, location_type, location_id, movement_type, quantity_delta, serial_number,
          source_kind, source_id, idempotency_key, occurred_at, created_by, operating_company_key)
       VALUES ($1,$2,$3,'NONE','WAREHOUSE',$4,'INTERCOMPANY_SALE_RELIEF',$5,NULL,$6,$7,$8,now(),$9,$10)`,
      [movementId, actor.tenantId, line.part_id, warehouseId, -qty, INTERCOMPANY_RELIEF_MOVEMENT_SOURCE_KIND, correlationId, `icrelief:${correlationId}:${lineId}`, actor.principalId, sellerKey]);
    const reliefId = `icr_${randomUUID()}`;
    await c.query(
      `INSERT INTO eos_ops.intercompany_inventory_reliefs (id, tenant_id, intercompany_transaction_id, receiving_id, receiving_line_id, part_id, quantity,
          seller_operating_company_key, source_warehouse_id, movement_id, reason, idempotency_key, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [reliefId, actor.tenantId, correlationId, t.source_record_id, lineId, line.part_id, qty, sellerKey, warehouseId, movementId, reason, key, actor.principalId]);
    await c.query("COMMIT");
    return Object.freeze({ outcome: "recorded" as const, reliefId, movementId, quantity: qty, sellerOperatingCompanyKey: sellerKey, sourceWarehouseId: warehouseId });
  } catch (err) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}
