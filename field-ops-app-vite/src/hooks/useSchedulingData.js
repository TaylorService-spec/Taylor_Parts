import { useWorkOrders } from "./useWorkOrders";
import { useFirestoreCollection } from "./useFirestoreCollection";
import { TECHNICIANS_COLLECTION } from "../domain/constants";

// Scheduling workspace data hook -- composes the two GOVERNED reads the weekly board needs, with NO new
// read model: the canonical Work Order subscription (useWorkOrders -> subscribeToWorkOrders on
// fieldops_wos, the same admin/dispatcher read Control Tower uses) and the technicians collection (the
// governed technician entity, read the same way Control Tower reads it). Shaping into the week view model
// is domain/schedulingWorkspace.js's job; this hook only supplies raw governed data + loading/error.
//
// KNOWN LIMITATION (inherited, not introduced here): the technicians read surfaces a real error, but
// useWorkOrders/subscribeToWorkOrders currently registers NO onSnapshot error callback -- a fieldops_wos
// read failure leaves that half stuck loading with no error. In practice the intended personas
// (admin/dispatcher) can read fieldops_wos, so this is unlikely; a proper fix (add an onError to
// subscribeToWorkOrders and thread it here) is a shared-hook change tracked as a follow-on, deliberately
// out of this repo-only increment's scope.
export function useSchedulingData() {
  const { data: workOrders, loading: woLoading } = useWorkOrders();
  const { data: technicians, loading: techLoading, error: techError } = useFirestoreCollection(TECHNICIANS_COLLECTION);

  return {
    workOrders,
    technicians,
    loading: woLoading || techLoading,
    error: techError ?? null,
  };
}
