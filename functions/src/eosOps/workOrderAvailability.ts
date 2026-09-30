// SCAFFOLD (Work Order cutover completion pass, 2026-09-30): reserved operations, implemented by their lane.
// Until implemented each refuses NOT_YET_IMPLEMENTED -- never a Firebase fallback.
import { WorkOrderLifecycleError } from "./workOrderLifecycle";
import type { WorkOrderOp } from "./workOrderOperationTypes";
const notYet = (name: string): WorkOrderOp => async () => {
  throw new WorkOrderLifecycleError("NOT_YET_IMPLEMENTED", "UNAVAILABLE", `${name} is not implemented yet`);
};
export const readTechnicianAvailability: WorkOrderOp = notYet("readTechnicianAvailability");
export const setTechnicianWorkingHours: WorkOrderOp = notYet("setTechnicianWorkingHours");
export const recordTechnicianUnavailability: WorkOrderOp = notYet("recordTechnicianUnavailability");
export const endTechnicianUnavailability: WorkOrderOp = notYet("endTechnicianUnavailability");
export const findAvailableTechnicianSlots: WorkOrderOp = notYet("findAvailableTechnicianSlots");

/** A warning that rides on a successful placement (never a refusal). */
export interface AvailabilityWarning { readonly code: string; readonly message: string }

/**
 * THE PLACEMENT AVAILABILITY CHECK every governed schedule / reschedule / dispatch calls, inside its transaction,
 * after eligibility and before the write. It REFUSES (throws WorkOrderLifecycleError) when the Employee is not
 * available for [start, end) and returns the warnings to carry on success.
 *
 * SCAFFOLD: the availability lane implements it. Until then it states that availability was not consulted.
 */
export async function checkTechnicianAvailability(
  _client: import("pg").PoolClient,
  _input: { readonly tenantId: string; readonly employeeId: string; readonly operatingCompanyKey: string; readonly start: Date; readonly end: Date },
): Promise<readonly AvailabilityWarning[]> {
  return Object.freeze([Object.freeze({
    code: "AVAILABILITY_NOT_MODELED",
    message: "technician working hours and blocked time have no PostgreSQL authority; neither was consulted for this placement",
  })]);
}
