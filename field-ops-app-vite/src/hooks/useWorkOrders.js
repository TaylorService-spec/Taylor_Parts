import { useEffect, useState } from "react";
import { subscribeToWorkOrders } from "../services/workOrderQueries";

// Work Order Engine v1.2 -- thin wrapper around
// services/workOrderQueries.ts's subscribeToWorkOrders(), returning the
// same { data, loading } shape hooks/useFirestoreCollection.js already
// returns for fieldops_jobs/fieldops_technicians, so ControlTower.jsx
// treats all three collections the same way.
export function useWorkOrders() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = subscribeToWorkOrders((workOrders) => {
      setData(workOrders);
      setLoading(false);
    });

    return () => unsub();
  }, []);

  return { data, loading };
}
