import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { WORK_ORDERS_COLLECTION } from "../domain/constants";

// Sprint 2.0.3 -- Work Order Experience. Single-document live
// listener, same onSnapshot(doc(...)) shape as useAccount.js/
// useCurrentTechnician.js -- not a new pattern.
export function useWorkOrder(workOrderId) {
  const [workOrder, setWorkOrder] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workOrderId) {
      setWorkOrder(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsub = onSnapshot(doc(db, WORK_ORDERS_COLLECTION, workOrderId), (snap) => {
      setWorkOrder(snap.exists() ? { id: snap.id, ...snap.data() } : null);
      setLoading(false);
    });

    return () => unsub();
  }, [workOrderId]);

  return { workOrder, loading };
}
