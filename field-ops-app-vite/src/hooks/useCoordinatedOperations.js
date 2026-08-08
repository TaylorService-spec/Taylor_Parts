import { useMemo } from "react";
import { DEFAULT_COORDINATED_OPERATIONS_SOURCE } from "../access/coordinatedOperationsSource.js";
import { buildCoordinatedVisits } from "../domain/coordinatedVisit.js";

// Adapts the injected coordinated-operations SOURCE into the shape the Service/Dispatch and Technician
// surfaces consume: the built coordinated visits (pure projection over the source's Work Orders) plus the
// injected signal/context/name maps. No React state, no I/O — a pure derivation from the source snapshot, so
// the synthetic→governed swap is invisible here. `source` is injectable for tests.
export function useCoordinatedOperations(source = DEFAULT_COORDINATED_OPERATIONS_SOURCE) {
  const snapshot = useMemo(() => (typeof source === "function" ? source() : source), [source]);

  const visits = useMemo(() => {
    if (snapshot.status !== "ready") return [];
    const built = buildCoordinatedVisits(snapshot.workOrders ?? []);
    // Attention-first, then most remaining obligation, then by Sales Order id for stability.
    return [...built].sort((a, b) => {
      const aAtt = a.readiness === "ATTENTION" ? 0 : 1;
      const bAtt = b.readiness === "ATTENTION" ? 0 : 1;
      if (aAtt !== bAtt) return aAtt - bAtt;
      if (b.remaining !== a.remaining) return b.remaining - a.remaining;
      return String(a.salesOrderId).localeCompare(String(b.salesOrderId));
    });
  }, [snapshot]);

  return {
    status: snapshot.status,
    synthetic: snapshot.synthetic === true,
    visits,
    fieldSignalsByWorkOrderId: snapshot.fieldSignalsByWorkOrderId ?? {},
    operationalContextByWorkOrderId: snapshot.operationalContextByWorkOrderId ?? {},
    accountNameById: snapshot.accountNameById ?? {},
    locationNameById: snapshot.locationNameById ?? {},
    salesOrderLabelById: snapshot.salesOrderLabelById ?? {},
  };
}
