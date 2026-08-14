import { useWorkOrders } from "./useWorkOrders";
import { useFirestoreCollection } from "./useFirestoreCollection";
import { TECHNICIANS_COLLECTION } from "../domain/constants";

// Scheduling workspace data hook -- composes the two GOVERNED reads the weekly board needs, with NO new
// read model: the canonical Work Order subscription (useWorkOrders -> subscribeToWorkOrders on
// fieldops_wos, the same admin/dispatcher read Control Tower uses) and the technicians collection (the
// governed technician entity, read the same way Control Tower reads it). Shaping into the week view model
// is domain/schedulingWorkspace.js's job; this hook only supplies raw governed data + loading/error.
//
// Both reads surface a real error (useWorkOrders/subscribeToWorkOrders registers an onSnapshot error
// callback -- see src/hooks/useWorkOrders.js's "Fail VISIBLY" comment, PR #875) and either failure must
// propagate here: a denied/failed fieldops_wos read must not be swallowed into a false-empty week that
// SchedulingWorkspace renders identically to a genuinely empty schedule.
export function useSchedulingData() {
  const { data: workOrders, loading: woLoading, error: woError } = useWorkOrders();
  const { data: technicians, loading: techLoading, error: techError } = useFirestoreCollection(TECHNICIANS_COLLECTION);

  return {
    workOrders,
    technicians,
    loading: woLoading || techLoading,
    error: woError ?? techError ?? null,
  };
}
