import { useEffect, useState } from "react";
import { subscribeToDispatcherQueue } from "../services/workOrderQueries";

// Work Order Engine v1.2 (Pre-Phase 2 Read Architecture) -- Work Orders
// currently awaiting a dispatcher action (CREATED/READY_TO_DISPATCH/
// SCHEDULED -- see workOrderQueries.ts's DISPATCHER_QUEUE_STATUSES for
// the exact definition and its rationale). Built ahead of the actual
// Dispatcher Queue UI (Phase 2) so that feature has a query to consume
// rather than writing its own Firestore access.
export function useDispatcherQueue() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = subscribeToDispatcherQueue((workOrders) => {
      setData(workOrders);
      setLoading(false);
    });

    return () => unsub();
  }, []);

  return { data, loading };
}
