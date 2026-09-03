import { useEffect, useState } from "react";
import { subscribeToWorkOrders } from "../services/workOrderService";

// Work Order Engine v1.2 -- thin wrapper around
// services/workOrderService.ts's subscribeToWorkOrders(), returning the
// same { data, loading } shape hooks/useFirestoreCollection.js already
// returns for fieldops_jobs/fieldops_technicians, so ControlTower.jsx
// treats all three collections the same way.
// `enabled` DEFAULTS TO TRUE, so every existing caller is untouched. It exists for surfaces that
// compose this read alongside others and must not open an unfiltered subscription for a viewer whose
// Rules would deny it -- a denied read costs a round trip and returns an error state that is
// indistinguishable, on screen, from a genuine failure. Disabled is IDLE, never empty: `data` stays
// [] and `loading` false, and callers that treat "no rows" as "nothing exists" would be wrong, which
// is why the composition layer asks for this only where the scope resolves.
export function useWorkOrders(enabled = true) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!enabled) {
      setData([]);
      setError(null);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
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
    // `enabled` IS a dependency. Without it the gate is evaluated once on mount and never again, so a
    // surface whose scope resolves asynchronously (warehouse ids, capabilities) would stay
    // permanently idle while reporting no error -- the silent-empty failure this hook already fails
    // visibly to avoid.
  }, [enabled]);

  return { data, loading, error };
}
