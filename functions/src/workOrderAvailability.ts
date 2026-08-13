// Technician double-booking guard (Work Order Engine). Dispatch assigns a technician to a Work Order; without
// this guard `transitionWorkOrder` would set `assignedTechId` unconditionally, so the SAME technician could be
// dispatched to two Work Orders at once — a double-booking the dispatch/availability model (TECH_STATUS,
// getTechnicianAvailability, dispatch scoring) treats as invalid. Pure so it is unit-testable without Firestore.

import type { WorkOrder, WorkOrderStatus } from "./types/workOrder";

// Statuses in which a dispatched technician is actively occupied by a Work Order. Assigning them to another one
// while in any of these is a double-booking. Pre-dispatch statuses carry no assignedTechId; terminal statuses
// (COMPLETED / CLOSED / CANCELLED) free the technician.
export const OCCUPYING_STATUSES: ReadonlySet<WorkOrderStatus> = new Set<WorkOrderStatus>([
  "DISPATCHED",
  "ACCEPTED",
  "EN_ROUTE",
  "ARRIVED",
  "WORK_IN_PROGRESS",
]);

export function isOccupyingStatus(status: WorkOrderStatus): boolean {
  return OCCUPYING_STATUSES.has(status);
}

type OtherAssignment = Pick<WorkOrder, "id"> & { assignedTechId?: string; status: WorkOrderStatus };

/**
 * Return the id of a Work Order that would be double-booked by dispatching `assignedTechId` to `workOrderId`, or
 * null if the technician is free. `others` are the technician's other Work Orders (typically fetched by
 * `assignedTechId`); the current Work Order is excluded (re-dispatching the same one is not a conflict), as are
 * assignments to a different technician and any Work Order in a non-occupying (pre-dispatch/terminal) status.
 */
export function findDoubleBookingConflict(
  assignedTechId: string,
  workOrderId: string,
  others: readonly OtherAssignment[],
): string | null {
  for (const wo of others) {
    if (!wo || wo.id === workOrderId) continue; // re-dispatch of the same WO is fine
    if (wo.assignedTechId !== assignedTechId) continue; // a different technician
    if (isOccupyingStatus(wo.status)) return wo.id; // already occupied → double-booking
  }
  return null;
}
