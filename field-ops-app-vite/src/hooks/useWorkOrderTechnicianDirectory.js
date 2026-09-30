import { useMemo } from "react";
import { useWorkOrderTechnicians } from "./useWorkOrderTechnicians";
import { mergeTechnicianDirectories, techniciansFromWorkOrders } from "../domain/workOrderAdapter.js";

// The technician directory a Work Order DISPLAY surface resolves assignee names against, in the same
// { data, loading, error } shape useFirestoreCollection returned -- but keyed by EMPLOYEE id, because the
// governed Work Orders' assignedTechId / scheduledTechId are Employee ids now (domain/workOrderAdapter.js).
// fieldops_technicians ids can never match them, so that collection is not read here.
//
//   data   the governed roster (listWorkOrderTechnicians) merged with the assignee names the Work Order
//          rows already carry (assigneeDisplayName) -- a name is resolvable even for an assignee the
//          roster no longer lists.
//   error  the roster read's failure, EXCEPT a FORBIDDEN one: a viewer who may not schedule/dispatch is
//          not refused a name the rows already state, so FORBIDDEN degrades to row-carried names only
//          (reported as `rosterError`, never hidden as "no technicians").
export function useWorkOrderTechnicianDirectory(workOrders, { enabled = true } = {}) {
  const roster = useWorkOrderTechnicians(null, { enabled });
  const derived = useMemo(() => techniciansFromWorkOrders(workOrders), [workOrders]);
  const data = useMemo(() => mergeTechnicianDirectories(roster.data, derived), [roster.data, derived]);
  const forbidden = roster.error?.code === "FORBIDDEN";
  return {
    data,
    loading: roster.loading,
    error: roster.error && !forbidden ? roster.error : null,
    rosterError: roster.error ?? null,
    notActivated: roster.notActivated,
  };
}
