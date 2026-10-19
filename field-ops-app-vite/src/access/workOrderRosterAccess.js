// MAY THIS CALLER READ THE TECHNICIAN ROSTER (listWorkOrderTechnicians)?
//
// The server refuses the read (403 CAPABILITY_MISSING) unless the caller holds workOrder.lifecycle.schedule OR
// workOrder.lifecycle.dispatch (eosOps/workOrderQueries.ts). Screens that merely RESOLVE assignee names are mounted by
// anyone holding the Work Order surface -- the assigned technician included -- so they ask the caller's own capability set
// (readMyWorkOrderCapabilities, the set every command re-checks) before making the read, instead of provoking a 403.
// Without the roster, names still resolve from the rows themselves (assigneeDisplayName), which is all a technician needs.
//
// Fail closed: `caps.has` is false while the set is loading or failed, so nothing office-side fires early.
import { WORK_ORDER_ACTION_CAPABILITY } from "./sessionAccess.js";

/** @param {{ has: (key: string) => boolean }} caps  the useMyWorkOrderCapabilities() result. */
export const canReadWorkOrderRoster = (caps) =>
  Boolean(caps?.has?.(WORK_ORDER_ACTION_CAPABILITY.Schedule) || caps?.has?.(WORK_ORDER_ACTION_CAPABILITY.Dispatch));
