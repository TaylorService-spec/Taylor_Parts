// THE LEGACY INVENTORY-ACTION NOTES ARCHIVE -- READ ONLY (Firebase exit B3; Owner ruling 8 of the Firebase-exit batch plan, 2026-10-17).
//
// Firestore `inventory_actions` is a frozen, retired audit trail (Owner ruling 2026-08-30): free-text notes from before Receiving,
// Transfers and Cycle Counts owned their movements. They were never reconciled with the inventory ledger, so they are NOT current
// facts: a note is evidence of what someone once recorded, never of what moved. Ruling 8 says to retire the display only if no unique
// information is lost, and otherwise to provide an EOS archive path -- this is that path, and it is READ ONLY: nothing in the
// application writes the table, no row is ever a ledger movement or stock authority (inventoryActionRetirementContract), and it is
// EMPTY until an Owner-authorized copy loads it (the copy is HELD).
//
// Gated by inventory.action.read -- the existing EOS key the Firestore read rule's holders were carried onto (migration
// 1761523200000). No new capability, no new holder.
import type { Pool } from "pg";
import { ReceiveStockError, ID_SHAPE, type ReceivingPrincipalActor } from "./receiveReorderStockCommand.js";

export const LEGACY_NOTES_READ_CAPABILITY = "inventory.action.read";
const SCHEMA = "eos_ops";
const NOTES_LIMIT = 200;

/**
 * One Part's archived notes, newest first (the source's own client-stamped time). `archiveLoaded` is true when ANY note has been
 * archived for the tenant: an empty answer on a loaded archive means "no notes for this part"; on an unloaded one it means only
 * "nothing has been archived here yet", which the screen must not present as "no notes were ever recorded".
 */
export async function listLegacyInventoryActionNotes(deps: { readonly pool: Pool }, actor: ReceivingPrincipalActor, input: Record<string, unknown>) {
  if (!actor || !ID_SHAPE(actor.tenantId) || !(actor.capabilities instanceof Set) || !actor.capabilities.has(LEGACY_NOTES_READ_CAPABILITY)) {
    throw new ReceiveStockError("CAPABILITY_REQUIRED", "FORBIDDEN", `this read requires ${LEGACY_NOTES_READ_CAPABILITY}`);
  }
  if (typeof input !== "object" || input === null || Array.isArray(input) || Object.keys(input).some((k) => k !== "partId")) {
    throw new ReceiveStockError("INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT", "this read accepts only partId");
  }
  if (!ID_SHAPE(input.partId)) throw new ReceiveStockError("PART_ID_REQUIRED", "INVALID_INPUT", "partId is required");
  const loaded = await deps.pool.query(`SELECT EXISTS (SELECT 1 FROM ${SCHEMA}.legacy_inventory_action_notes WHERE tenant_id = $1) AS loaded`, [actor.tenantId]);
  const { rows } = await deps.pool.query(
    `SELECT id, transaction_type, quantity_delta, reason, created_by_ref, created_at_ms FROM ${SCHEMA}.legacy_inventory_action_notes
      WHERE tenant_id = $1 AND part_id = $2 ORDER BY created_at_ms DESC NULLS LAST, id LIMIT ${NOTES_LIMIT}`, [actor.tenantId, input.partId]);
  return {
    partId: input.partId,
    archiveLoaded: loaded.rows[0].loaded === true,
    // The note's own words and the FIREBASE uid it stored, verbatim: evidence, not a reference to an EOS Principal.
    items: rows.map((r) => ({
      id: String(r.id), transactionType: String(r.transaction_type), quantityDelta: r.quantity_delta === null ? null : Number(r.quantity_delta),
      reason: (r.reason as string | null) ?? null, createdBy: (r.created_by_ref as string | null) ?? null,
      createdAt: r.created_at_ms === null ? null : Number(r.created_at_ms),
    })),
  };
}
