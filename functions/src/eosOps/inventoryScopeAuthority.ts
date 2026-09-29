// INVENTORY LOCATION -> WAREHOUSE SCOPE, and the per-act scope rule (Controller rulings DQ-017 / DQ-024,
// 2026-09-28). The ONE place EOS answers "which governed warehouse scope does work at this inventory
// location need", for every inventory command on the EOS operations transport (Cycle Count now, Transfer
// when its engine exists).
//
// ════════════════════ THE RESOLUTION (read, never inferred) ════════════════════
//
//   WAREHOUSE  its own id                                         (eos_ops.warehouses)
//   BIN        its immutable parent warehouse                      (eos_ops.bins.warehouse_id)
//   MOBILE     its CURRENT explicit scope binding, and only that   (eos_ops.mobile_location_scope_bindings)
//
// A truck location is NEVER placed in a scope from the technician, the driver, the current user, a
// Firebase uid, a customer, a tenant default, the truck's descriptive home warehouse, or any other
// incidental relationship. No current binding -> MOBILE_SCOPE_BINDING_MISSING, fail closed.
//
// ════════════════════ THE PER-ACT RULE (DQ-024) ════════════════════
//
// Scope follows the inventory location ACTED UPON:
//   initiate / remove / ship (create, cancel, dispatch)  -> the ORIGIN's warehouse scope
//   receive / put-away                                   -> the DESTINATION's warehouse scope
// An act is NOT required to satisfy both ends merely because the record has two. An act that genuinely
// acts on both sides would name both; none of the Transfer acts does.
import type { PoolClient } from "pg";

type Queryable = Pick<PoolClient, "query">;

export type InventoryLocationType = "WAREHOUSE" | "BIN" | "MOBILE";
export interface InventoryLocationRef {
  readonly type: InventoryLocationType;
  readonly locationId: string;
}

export interface ResolvedScopeLocation {
  readonly type: InventoryLocationType;
  readonly locationId: string;
  /** The governed warehouse whose WAREHOUSE operational scope governs work at this location. */
  readonly scopeWarehouseId: string;
  /** The location's own authored operating company key (a MOBILE location states its own). */
  readonly operatingCompanyKey: string;
  /** The location -- and for a BIN its warehouse -- is ACTIVE. Reads may proceed on inactive; new work may not. */
  readonly active: boolean;
}

export type InventoryScopeRefusal =
  | "LOCATION_TYPE_INVALID"
  | "LOCATION_NOT_FOUND"
  | "MOBILE_SCOPE_BINDING_MISSING";

export class InventoryScopeError extends Error {
  constructor(readonly code: InventoryScopeRefusal, message: string) {
    super(message);
    this.name = "InventoryScopeError";
  }
}

/** Resolve one inventory location to the warehouse whose scope governs it. Fails closed; never guesses. */
export async function resolveScopeLocation(db: Queryable, tenantId: string, ref: { readonly type: unknown; readonly locationId: string }): Promise<ResolvedScopeLocation> {
  if (ref.type === "WAREHOUSE") {
    const { rows } = await db.query<{ status: string; operating_company_key: string }>(
      `SELECT status::text AS status, operating_company_key FROM eos_ops.warehouses WHERE tenant_id = $1 AND id = $2`,
      [tenantId, ref.locationId]);
    if (!rows[0]) throw new InventoryScopeError("LOCATION_NOT_FOUND", "no warehouse with that id");
    return { type: "WAREHOUSE", locationId: ref.locationId, scopeWarehouseId: ref.locationId,
      operatingCompanyKey: rows[0].operating_company_key, active: rows[0].status === "ACTIVE" };
  }
  if (ref.type === "BIN") {
    const { rows } = await db.query<{ bin_status: string; warehouse_id: string; warehouse_status: string; operating_company_key: string }>(
      `SELECT b.status::text AS bin_status, b.warehouse_id, w.status::text AS warehouse_status, w.operating_company_key
         FROM eos_ops.bins b JOIN eos_ops.warehouses w ON w.tenant_id = b.tenant_id AND w.id = b.warehouse_id
        WHERE b.tenant_id = $1 AND b.id = $2`,
      [tenantId, ref.locationId]);
    if (!rows[0]) throw new InventoryScopeError("LOCATION_NOT_FOUND", "no bin with that id");
    const r = rows[0];
    return { type: "BIN", locationId: ref.locationId, scopeWarehouseId: r.warehouse_id, operatingCompanyKey: r.operating_company_key,
      active: r.bin_status === "ACTIVE" && r.warehouse_status === "ACTIVE" };
  }
  if (ref.type === "MOBILE") {
    const { rows: loc } = await db.query<{ active: boolean; operating_company_key: string }>(
      `SELECT active, operating_company_key FROM eos_ops.mobile_locations
        WHERE tenant_id = $1 AND location_type = 'MOBILE' AND location_id = $2`,
      [tenantId, ref.locationId]);
    if (!loc[0]) throw new InventoryScopeError("LOCATION_NOT_FOUND", "no truck location with that id");
    const { rows: bound } = await db.query<{ warehouse_id: string }>(
      `SELECT warehouse_id FROM eos_ops.mobile_location_scope_bindings
        WHERE tenant_id = $1 AND location_type = 'MOBILE' AND location_id = $2 AND effective_to IS NULL`,
      [tenantId, ref.locationId]);
    if (!bound[0]) {
      throw new InventoryScopeError("MOBILE_SCOPE_BINDING_MISSING",
        "this truck location has no governed warehouse scope binding, so no one's warehouse scope reaches it");
    }
    return { type: "MOBILE", locationId: ref.locationId, scopeWarehouseId: bound[0].warehouse_id,
      operatingCompanyKey: loc[0].operating_company_key, active: loc[0].active === true };
  }
  throw new InventoryScopeError("LOCATION_TYPE_INVALID", "location type must be WAREHOUSE, BIN or MOBILE");
}

// ════════════════════ Transfer: which end each act is scoped by ════════════════════

export const TRANSFER_ACTS = Object.freeze(["create", "cancel", "dispatch", "receive", "putAway"] as const);
export type TransferAct = (typeof TRANSFER_ACTS)[number];

/** DQ-024: the ORIGIN for initiate/remove/ship, the DESTINATION for receive/put-away. Exactly one end each. */
export const TRANSFER_ACT_SCOPE_END: Readonly<Record<TransferAct, "ORIGIN" | "DESTINATION">> = Object.freeze({
  create: "ORIGIN",
  cancel: "ORIGIN",
  dispatch: "ORIGIN",
  receive: "DESTINATION",
  putAway: "DESTINATION",
});

/**
 * The warehouse scope a Transfer act requires: resolve ONLY the end the act works on. The other end is
 * not resolved at all -- so a missing binding on the far end neither blocks nor grants anything.
 */
export async function requiredTransferScope(
  db: Queryable, tenantId: string, act: TransferAct,
  transfer: { readonly origin: InventoryLocationRef; readonly destination: InventoryLocationRef },
): Promise<ResolvedScopeLocation> {
  const end = TRANSFER_ACT_SCOPE_END[act];
  if (!end) throw new InventoryScopeError("LOCATION_TYPE_INVALID", `unknown transfer act ${String(act)}`);
  return resolveScopeLocation(db, tenantId, end === "ORIGIN" ? transfer.origin : transfer.destination);
}
