// THE WAREHOUSE MANAGER REORDER-READ DELTA -- Owner ruling PARTS-404 / RO-02 (2026-10-21, Level 3, APPROVED), stated as DATA so the
// release issues ONE reviewed grant through Administration: never an improvised grant and never a migration grant.
//
//   Warehouse Manager KEEPS reorder.request.create.manual and GAINS reorder.request.read.
//
// WHAT THE GRANT MEANS. reorder.request.read is the unscoped Object authority. WHICH requests a holder reads is decided by context
// (reorderQueueReach.queueReadReach): the company-keyed REORDER_QUEUE reach, which Warehouse Manager does NOT hold, and -- ADDED by
// this ruling, for every holder -- the warehouses of the caller's own WAREHOUSE Operational Scopes that lie inside its operating-company
// authority. So this grant lets a Warehouse Manager read the Reorder Requests of the warehouses it is scoped to, and nothing else:
// not a sibling warehouse, not another company, and none of the management commands (review, cancel, void, assign), which keep
// queueReachKeys.
//
// WHAT IT DELIBERATELY DOES NOT CONTAIN: any other Role (Warehouse Associate, Parts Associate, Technician ...), any purchasing,
// approval or cross-company authority, any new capability, any Operational Scope (a scope is an Employee authority issued through
// the Workforce writer), and any migration.
//
// APPLIED at a controlled release, through the Administration API (`grantObjectActionToRole`), which records the Administration
// decision and the audit row. Not read by any command; nothing changes until Administration applies it.

export const WAREHOUSE_MANAGER_REORDER_READ_RULING = "Owner ruling PARTS-404 / RO-02 (2026-10-21, Level 3)";

export const WAREHOUSE_MANAGER_REORDER_READ_GRANT = Object.freeze({
  roleKey: "warehouseManager",
  capabilityKey: "reorder.request.read",
  // As registered in eos_policy.capabilities by migration 1761696000000 (cap_reorder_request_read).
  objectKey: "reorderRequest",
  actionKey: "read",
  reason: `${WAREHOUSE_MANAGER_REORDER_READ_RULING}: the Warehouse Manager reads the Reorder Requests of the warehouses it is scoped to (additive WAREHOUSE read reach; no queue reach, no management command)`,
});

/** The Administration operation, exactly as the release issues it. */
export function warehouseManagerReorderReadOperations(): readonly { readonly operation: "grantObjectActionToRole"; readonly input: Record<string, unknown> }[] {
  const { roleKey, objectKey, actionKey, reason } = WAREHOUSE_MANAGER_REORDER_READ_GRANT;
  return Object.freeze([Object.freeze({ operation: "grantObjectActionToRole" as const, input: Object.freeze({ roleKey, objectKey, actionKey, reason }) })]);
}
