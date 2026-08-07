import { SCAN_RESOLUTION } from "./scannedIdentity.js";
import { nextFieldAction } from "./fieldWorkOrder.js";

/**
 * F2 — deriving what may be done with a scanned entity.
 *
 * This is the second half of the boundary, and it exists specifically so the
 * scanner never owns an action vocabulary. `PartsScanner` previously held a
 * literal ACTIONS array — receive / use on work order / load truck / cycle
 * count / add to PO — offered identically to everyone regardless of what they
 * were allowed to do, and regardless of what had actually been scanned. A
 * barcode chose the menu.
 *
 * Here the menu is DERIVED:
 *
 *   resolved identity
 *     + entity type
 *     + the caller's effective capabilities
 *     + the current workflow state / resource relationship
 *       -> permitted actions
 *
 * Nothing is offered that authority would refuse. Equally, nothing is silently
 * hidden: an action the caller cannot take is returned with `enabled: false`
 * and a reason, because "you may not do this" and "this does not exist" are
 * different facts (the same rule the resolver applies to NOT_FOUND).
 *
 * PURE. Capabilities are injected — this module resolves no permissions itself
 * and performs no reads, so it cannot widen access.
 *
 * ADR-012 alignment: Capability answers WHAT, the entity+context answer
 * WHERE/TO WHAT, and effective access is derived rather than declared. A
 * persona or a device never appears in this file.
 */

/** Governed action ids this boundary can offer. Deliberately small: each maps
 *  to a real, deployed governed write path. Nothing aspirational. */
export const SCAN_ACTIONS = Object.freeze({
  /** Record planned-part usage on the caller's own Work Order.
   *  Governed by updateWorkOrderExecutionData (technician-only, ownership
   *  checked server-side, append-only executionLog). */
  RECORD_PART_USAGE: "RECORD_PART_USAGE",
  /** Advance the caller's own Work Order through the governed lifecycle. */
  ADVANCE_WORK_ORDER: "ADVANCE_WORK_ORDER",
  /** Open the entity's detail context. A read, still authority-gated. */
  VIEW_CONTEXT: "VIEW_CONTEXT",
});

const action = (id, label, { enabled, reason = null, payload = null }) => ({
  id, label, enabled, reason, payload,
});

/**
 * Derive the permitted actions for a resolved scan.
 *
 * `context`:
 *   capabilities   { [capabilityId]: true }  — what the caller effectively holds
 *   technicianId   the caller's resolved technician identity, or null
 *   workOrders     the caller's own Work Orders (already authorised reads)
 *   activeWorkOrder the Work Order currently being worked, if any
 *
 * Returns [] for anything not RESOLVED: an unidentified thing has no actions,
 * and offering some would mean the scanner had decided something the governed
 * model had not.
 */
export function deriveScanActions(identity, context = {}) {
  if (!identity || identity.resolutionState !== SCAN_RESOLUTION.RESOLVED) return [];

  const {
    capabilities = {},
    technicianId = null,
    workOrders = [],
    activeWorkOrder = null,
  } = context;

  const can = (id) => capabilities[id] === true;

  switch (identity.entityType) {
    case "PART": {
      const partId = identity.entityId;

      // Usage is recorded against a Work Order, so without one there is
      // nothing to record it on -- state, not permission.
      if (!activeWorkOrder) {
        return [action(SCAN_ACTIONS.VIEW_CONTEXT, "View part details", { enabled: true, payload: { partId } })];
      }

      // Ownership is the server's decision; this mirrors it so the UI does not
      // offer an action the callable will reject.
      const isOwn = !!technicianId && activeWorkOrder.assignedTechId === technicianId;

      // Only parts actually planned on the job may be recorded against it --
      // updateWorkOrderExecutionData rejects an unplanned sku outright.
      const planned = (activeWorkOrder.inventorySnapshot ?? []).find(
        (row) => row.partId === partId || row.sku === partId,
      );

      let enabled = true;
      let reason = null;
      if (!can("workOrder.execution.record")) {
        enabled = false; reason = "You do not have permission to record part usage.";
      } else if (!isOwn) {
        enabled = false; reason = "This work order is not assigned to you.";
      } else if (!planned) {
        enabled = false; reason = "This part is not planned on your current job.";
      }

      return [
        action(SCAN_ACTIONS.RECORD_PART_USAGE, "Record use on this job", {
          enabled, reason,
          payload: { partId, sku: planned?.sku ?? partId, workOrderId: activeWorkOrder.id },
        }),
        action(SCAN_ACTIONS.VIEW_CONTEXT, "View part details", { enabled: true, payload: { partId } }),
      ];
    }

    case "WORK_ORDER": {
      const wo = workOrders.find((w) => w.id === identity.entityId || w.woNumber === identity.entityId);
      if (!wo) {
        return [action(SCAN_ACTIONS.VIEW_CONTEXT, "View work order", { enabled: false, reason: "That work order is not among your assigned work." })];
      }
      // The lifecycle step comes from the governed permission matrix, never
      // from a status literal decided here.
      const next = nextFieldAction(wo, technicianId);
      const out = [action(SCAN_ACTIONS.VIEW_CONTEXT, "Open work order", { enabled: true, payload: { workOrderId: wo.id } })];
      if (next) {
        out.unshift(action(SCAN_ACTIONS.ADVANCE_WORK_ORDER, next.label, {
          enabled: true,
          payload: { workOrderId: wo.id, action: next.action },
        }));
      }
      return out;
    }

    // Identity resolves for these, but no governed write path exists that a
    // scan should trigger today. Returning a read-only action is the honest
    // answer -- inventing a movement action here is exactly the failure mode
    // this module was written to prevent.
    case "SERIALIZED_ASSET":
    case "INVENTORY_LOCATION":
    case "EQUIPMENT":
      return [action(SCAN_ACTIONS.VIEW_CONTEXT, "View details", { enabled: true, payload: { entityId: identity.entityId } })];

    default:
      return [];
  }
}

/** Convenience: only the actions the caller may actually invoke right now. */
export function enabledScanActions(identity, context = {}) {
  return deriveScanActions(identity, context).filter((a) => a.enabled);
}
