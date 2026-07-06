import { useEffect, useState } from "react";
import { subscribeAssignedWorkOrders } from "../services/workOrderService";

// PT-002 -- Assigned Work Order Query Layer. Separate from
// useWorkOrders() (which stays unmodified for dispatcher/admin
// callers) -- wraps services/workOrderService.ts's
// subscribeAssignedWorkOrders(), a technician-scoped query, not a
// second full-collection listener.
//
// No UI wires this up yet (that's Epic 6's job, see
// docs/epics/EPIC-6-Technician-Execution-Workspace.md) -- this is
// backend-plumbing only, per this sprint's scope.
export function useAssignedWorkOrders(technicianId) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!technicianId) {
      setData([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    const unsub = subscribeAssignedWorkOrders(
      technicianId,
      (workOrders) => {
        setData(workOrders);
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [technicianId]);

  return { data, loading, error };
}
