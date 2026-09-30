import { useWorkOrders } from "./useWorkOrders";
import { useWorkOrderTechnicians } from "./useWorkOrderTechnicians";

// Scheduling workspace data hook -- composes the two GOVERNED reads the weekly board needs:
//   - Work Orders: listWorkOrders over the EOS route (useWorkOrders), optionally narrowed to a scheduled
//     window ({ scheduledFrom, scheduledTo } ISO instants) by the caller.
//   - Technicians: the governed Work Order roster (listWorkOrderTechnicians), whose `id` is the EMPLOYEE
//     id -- the same id a Work Order's scheduledTechId / assignedTechId now carries. NOT fieldops_technicians.
// Shaping into the week view model is domain/schedulingWorkspace.js's job.
//
// Either failure propagates: a refused/failed read must not be swallowed into a false-empty week that
// renders identically to a genuinely empty schedule. NOT_ACTIVATED propagates as itself (`notActivated`).
//
// NOTE: the unscheduled backlog (READY_TO_DISPATCH, no window) has no scheduled window, so a window
// filter would hide it; the default (no window) reads the bounded office list instead.
export function useSchedulingData({ scheduledFrom = null, scheduledTo = null } = {}) {
  const filters = scheduledFrom && scheduledTo ? { scheduledFrom, scheduledTo } : null;
  const { data: workOrders, loading: woLoading, error: woError, truncated, notActivated: woNotActivated } =
    useWorkOrders(true, { filters });
  const { data: technicians, loading: techLoading, error: techError, notActivated: techNotActivated } = useWorkOrderTechnicians();

  return {
    workOrders,
    technicians,
    loading: woLoading || techLoading,
    error: woError ?? techError ?? null,
    truncated,
    notActivated: Boolean(woNotActivated || techNotActivated),
  };
}
