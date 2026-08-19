import { useCallback, useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { WORK_ORDERS_COLLECTION } from "../domain/constants";
import { loadErrorMessage } from "../domain/loadErrorMessage";

const ENTITY = "work orders";

// Sprint 2.0.3 -- Work Order Experience. Single-document live
// listener, same onSnapshot(doc(...)) shape as useAccount.js/
// useCurrentTechnician.js -- not a new pattern.
//
// H14 -- this hook used to pass NO error callback to onSnapshot, so a
// DENIED or failed Work Order read never resolved -- `loading` stayed
// true forever and WorkOrderDetailPage.jsx's "Loading work order…"
// spun with no error and no recovery, and no consumer could fix it
// because nothing was exposed to check. It now fails closed to a safe
// `error` (loadErrorMessage -- never a raw code/path/id) and clears any
// stale workOrder, so a FAILED read is distinguishable from a
// CONFIRMED absence (a successful read that found no such Work Order)
// and from still loading -- the same discipline useAccount.js already
// applies. Also adds the retry re-subscription and obsolete-callback
// guard useAccount.js established, so callers can offer the same Retry
// affordance.
export function useWorkOrder(workOrderId) {
  const [workOrder, setWorkOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!workOrderId) {
      setWorkOrder(null);
      setError(null);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);
    const unsub = onSnapshot(
      doc(db, WORK_ORDERS_COLLECTION, workOrderId),
      (snap) => {
        if (!active) return;
        setWorkOrder(snap.exists() ? { id: snap.id, ...snap.data() } : null);
        setError(null);
        setLoading(false);
      },
      (err) => {
        if (!active) return;
        // Fail closed: clear any stale work order rather than leave a
        // previous id's data on screen looking current, and never render a
        // failure as "no such work order".
        setWorkOrder(null);
        setError(loadErrorMessage(err, { entity: ENTITY }));
        setLoading(false);
      }
    );

    return () => {
      active = false;
      unsub();
    };
  }, [workOrderId, attempt]);

  return { workOrder, loading, error, retry };
}
