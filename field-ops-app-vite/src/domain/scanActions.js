import { SCAN_RESOLUTION } from "./scannedIdentity.js";

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
 *     + the caller's resolved role and identity
 *     + the current workflow state / resource relationship
 *       -> permitted actions
 *
 * Nothing is offered that authority would refuse. Equally, nothing is silently
 * hidden: an action the caller cannot take is returned with `enabled: false`
 * and a reason, because "you may not do this" and "this does not exist" are
 * different facts (the same rule the resolver applies to NOT_FOUND).
 *
 * PURE. The caller's resolved role/identity is injected — this module resolves
 * no permissions itself and performs no reads, so it cannot widen access. It
 * also invents no capability id: the derivation MIRRORS what the governed
 * callable enforces, and the server remains the authority.
 *
 * ADR-012 alignment: Capability answers WHAT, the entity+context answer
 * WHERE/TO WHAT, and effective access is derived rather than declared. A
 * persona or a device never appears in this file.
 */

/** Governed action ids this boundary can offer. Deliberately small: each maps
 *  to a real, deployed governed write path. Nothing aspirational. */
/**
 * EXACTLY ONE action, and that is the finding, not an omission.
 *
 * The set previously also carried ADVANCE_WORK_ORDER and VIEW_CONTEXT. Field
 * testing killed both:
 *
 *  - ADVANCE_WORK_ORDER put a full-strength "Complete job" button on a scanned
 *    work order card, pixel-identical to the one for the ACTIVE job a little
 *    further up the same 390px screen. The scanner could close the WRONG JOB.
 *    A scanner records parts; it has no business closing work.
 *  - VIEW_CONTEXT had no destination. It printed "Open this from your job to
 *    continue" to a technician who was already on their job. An action that
 *    cannot act is worse than no action -- it costs a tap and returns a
 *    sentence that is not true.
 *
 * Identity resolution still reports WHAT was scanned for every supported
 * entity. That is useful on its own -- scanning a ticket tells you which job
 * you are holding. It simply does not manufacture something to press.
 */
export const SCAN_ACTIONS = Object.freeze({
  /** Record planned-part usage on the caller's own Work Order.
   *  Governed by updateWorkOrderExecutionData (technician-only, ownership
   *  checked server-side, append-only executionLog). */
  RECORD_PART_USAGE: "RECORD_PART_USAGE",
});

const action = (id, label, { enabled, reason = null, payload = null }) => ({
  id, label, enabled, reason, payload,
});

/**
 * Derive the permitted actions for a resolved scan.
 *
 * `context`:
 *   role           the caller's resolved role
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
    // `role` + `technicianId` mirror what updateWorkOrderExecutionData
    // actually enforces server-side. There is deliberately NO invented
    // capability id here: the permission catalog has no
    // `workOrder.execution.record`, and R-1's governing constraint is not to
    // create permissions merely to make a client look tidy. The client mirrors
    // the real rule; the server remains the authority.
    role = null,
    technicianId = null,
    workOrders = [],
    activeWorkOrder = null,
  } = context;

  switch (identity.entityType) {
    case "PART": {
      const partId = identity.entityId;

      // Usage is recorded against a Work Order, so without one there is
      // nothing to record it on -- state, not permission.
      // Usage is recorded against a Work Order; with none there is nothing to
      // record against, and nothing to press.
      if (!activeWorkOrder) return [];

      // Ownership is the server's decision; this mirrors it so the UI does not
      // offer an action the callable will reject.
      const isOwn = !!technicianId && activeWorkOrder.assignedTechId === technicianId;

      // Only parts actually planned on the job may be recorded against it --
      // updateWorkOrderExecutionData rejects an unplanned sku outright.
      const planned = (activeWorkOrder.inventorySnapshot ?? []).find(
        (row) => row.partId === partId || row.sku === partId,
      );

      // The server's three conditions, mirrored in the same order it applies
      // them: technician role, resolvable identity, own assignment -- plus the
      // planned-sku check the callable also performs.
      let enabled = true;
      let reason = null;
      if (role !== "technician" || !technicianId) {
        enabled = false; reason = "Only the assigned technician can record part usage.";
      } else if (!isOwn) {
        enabled = false; reason = "This work order is not assigned to you.";
      } else if (!planned) {
        enabled = false; reason = "This part is not planned on your current job.";
      }

      return [
        action(SCAN_ACTIONS.RECORD_PART_USAGE, "Record use on this job", {
          enabled, reason,
          // The payload carries what the CONFIRMATION needs to be meaningful:
          // the human part label and the WO number, not internal ids.
          payload: {
            partId,
            sku: planned?.sku ?? partId,
            workOrderId: activeWorkOrder.id,
            woNumber: activeWorkOrder.woNumber ?? activeWorkOrder.id,
            label: planned?.name || partId,
            // The plan quantity, so the experience can compare what is being
            // recorded against what was expected.
            qtyPlanned: typeof planned?.qtyPlanned === "number" ? planned.qtyPlanned : null,
          },
        }),
      ];
    }

    // A scanned work order tells you WHICH JOB you are holding. That is the
    // whole value; it deliberately offers nothing to press (see above).
    case "WORK_ORDER":
      return [];

    // Identity resolves for these, but no governed write path exists that a
    // scan should trigger today. Returning a read-only action is the honest
    // answer -- inventing a movement action here is exactly the failure mode
    // this module was written to prevent.
    case "SERIALIZED_ASSET":
    case "INVENTORY_LOCATION":
    case "EQUIPMENT":
      // Identity resolves; no governed write path exists that a scan should
      // trigger for these today. Inventing one is the failure this module
      // exists to prevent.
      return [];

    default:
      return [];
  }
}

/** Convenience: only the actions the caller may actually invoke right now. */
export function enabledScanActions(identity, context = {}) {
  return deriveScanActions(identity, context).filter((a) => a.enabled);
}
