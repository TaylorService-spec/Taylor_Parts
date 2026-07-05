import { useEffect, useState } from "react";
import { subscribeToWorkOrder } from "../services/workOrderQueries";

// Work Order Engine v1.2 (Pre-Phase 2 Read Architecture) -- live,
// single-Work-Order subscription. { data, loading } shape matches
// useWorkOrders()/useFirestoreCollection.js. `data` is null both while
// loading and if no such Work Order exists -- check `loading` first if
// you need to tell the two apart.
export function useWorkOrder(id) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) {
      setData(null);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    const unsub = subscribeToWorkOrder(id, (workOrder) => {
      setData(workOrder);
      setLoading(false);
    });

    return () => unsub();
  }, [id]);

  return { data, loading };
}
