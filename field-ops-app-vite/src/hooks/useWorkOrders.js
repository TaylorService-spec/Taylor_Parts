import { useEffect, useState } from "react";
import { subscribeToWorkOrders } from "../services/workOrderService";

// Work Order Engine v1.2 -- thin wrapper around
// services/workOrderService.ts's subscribeToWorkOrders(), returning the
// same { data, loading } shape hooks/useFirestoreCollection.js already
// returns for fieldops_jobs/fieldops_technicians, so ControlTower.jsx
// treats all three collections the same way.
export function useWorkOrders() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const unsub = subscribeToWorkOrders(
      (workOrders) => {
        setData(workOrders);
        setError(null);
        setLoading(false);
      },
      (err) => {
        // Fail VISIBLY. A swallowed permission-denied left this surface
        // spinning indefinitely for a technician, who cannot read the
        // collection unfiltered.
        setError(err);
        setData([]);
        setLoading(false);
      },
    );

    return () => unsub();
  }, []);

  return { data, loading, error };
}
