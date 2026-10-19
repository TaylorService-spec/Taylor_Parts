// THE LINK BETWEEN A SUPPLIER PURCHASE ORDER LINE AND ITS SOURCE REORDER REQUEST (P-1; Owner ruling A, "Linked + closes them").
//
// A request on a supplier PO is ORDERED. Receiving the supplier PO CLOSES the request when ITS LINE is fully received, in the receipt's own
// transaction; a receipt correction that takes the line below fully received REOPENS it (RECEIVED -> ORDERED, exactly as correctReorderReceipt does
// for a Reorder PO); cancelling the PO RELEASES the link and returns the request to PURCHASING_IN_PROGRESS (supplierPurchaseOrderAuthoring.ts).
//
// Every function here runs INSIDE the caller's transaction, takes no pool, and performs NO capability check: the calling command owns authority.
import type { PoolClient } from "pg";
import { closeOutReorderAsReceived } from "./reorderLifecycleCommands.js";

const SCHEMA = "eos_ops";

export interface ReceiptCloseoutInput {
  readonly tenantId: string;
  readonly principalId: string;
  readonly purchaseOrderId: string;
  readonly receivedAt: Date;
  /** Quantity received on each PO line BEFORE this receipt (derived from committed receipts, this one excluded). */
  readonly previouslyReceived: ReadonlyMap<string, number>;
  /** Quantity this receipt takes in per PO line. */
  readonly receivedNow: ReadonlyMap<string, number>;
}

/**
 * Close every linked request whose LINE this receipt completes (cumulative received >= ordered). A line that is only partly received leaves its
 * request ORDERED. The request row is locked before it is read; a request that is not ORDERED any more is left alone (never forced).
 * Returns the ids closed, in line order.
 */
export async function closeLinkedRequestsOnReceipt(client: PoolClient, input: ReceiptCloseoutInput): Promise<string[]> {
  const { rows } = await client.query(
    `SELECT line_id, source_request_id, ordered_quantity FROM ${SCHEMA}.supplier_purchase_order_lines
      WHERE tenant_id = $1 AND purchase_order_id = $2 AND source_request_id IS NOT NULL AND link_released_at IS NULL
      ORDER BY line_id`, [input.tenantId, input.purchaseOrderId]);
  const closed: string[] = [];
  for (const line of rows) {
    const lineId = String(line.line_id);
    const now = input.receivedNow.get(lineId) ?? 0;
    if (now <= 0) continue;
    if ((input.previouslyReceived.get(lineId) ?? 0) + now < Number(line.ordered_quantity)) continue;
    const request = await client.query(
      `SELECT status::text AS status FROM ${SCHEMA}.reorder_requests WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [input.tenantId, line.source_request_id]);
    if (request.rows.length === 0 || request.rows[0].status !== "ORDERED") continue;
    await closeOutReorderAsReceived(client, {
      tenantId: input.tenantId, actorPrincipalId: input.principalId, reorderRequestId: String(line.source_request_id),
      receivedAt: input.receivedAt, reason: "receipt of the supplier purchase order completed this request's line",
    });
    closed.push(String(line.source_request_id));
  }
  return closed;
}

export interface ReceiptReopenInput {
  readonly tenantId: string;
  readonly principalId: string;
  readonly purchaseOrderId: string;
  readonly at: Date;
}

/**
 * After a receipt is VOIDED (its status already CANCELLED in this transaction): reopen every linked request that is RECEIVED while its line is no
 * longer fully received. RECEIVED -> ORDERED, the same transition correctReorderReceipt makes. Returns the ids reopened.
 */
export async function reopenLinkedRequestsAfterVoid(client: PoolClient, input: ReceiptReopenInput): Promise<string[]> {
  const { rows } = await client.query(
    `SELECT l.source_request_id,
            l.ordered_quantity - COALESCE((
              SELECT sum(rl.received_quantity) FROM ${SCHEMA}.receiving_orders ro
                JOIN ${SCHEMA}.receiving_order_lines rl ON rl.tenant_id = ro.tenant_id AND rl.receiving_order_id = ro.id
               WHERE ro.tenant_id = l.tenant_id AND ro.source_kind::text = 'PURCHASE_ORDER' AND ro.source_purchase_order_id = l.purchase_order_id
                 AND ro.status::text <> 'CANCELLED' AND rl.line_id = l.line_id), 0) AS remaining
       FROM ${SCHEMA}.supplier_purchase_order_lines l
      WHERE l.tenant_id = $1 AND l.purchase_order_id = $2 AND l.source_request_id IS NOT NULL AND l.link_released_at IS NULL
      ORDER BY l.line_id`, [input.tenantId, input.purchaseOrderId]);
  const reopened: string[] = [];
  for (const line of rows) {
    if (Number(line.remaining) <= 0) continue;
    const { rowCount } = await client.query(
      `UPDATE ${SCHEMA}.reorder_requests SET status = 'ORDERED', received_at = NULL, received_by_principal_id = NULL, updated_by = $3, updated_at = $4
        WHERE tenant_id = $1 AND id = $2 AND status = 'RECEIVED'`, [input.tenantId, line.source_request_id, input.principalId, input.at]);
    if (rowCount === 1) reopened.push(String(line.source_request_id));
  }
  return reopened;
}
