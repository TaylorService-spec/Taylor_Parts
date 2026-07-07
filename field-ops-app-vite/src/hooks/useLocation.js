import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { LOCATIONS_COLLECTION } from "../domain/constants";

// Sprint 2.0.3 -- Work Order Experience. Single-document live
// listener for one Location, same shape as useAccount.js/
// useWorkOrder.js. Used by WorkOrderDetailPage.jsx to resolve
// workOrder.locationId to a display label for admin/dispatcher only
// -- see that file's header comment for why this is never attempted
// for the technician role.
export function useLocation(locationId) {
  const [location, setLocation] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!locationId) {
      setLocation(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsub = onSnapshot(doc(db, LOCATIONS_COLLECTION, locationId), (snap) => {
      setLocation(snap.exists() ? { id: snap.id, ...snap.data() } : null);
      setLoading(false);
    });

    return () => unsub();
  }, [locationId]);

  return { location, loading };
}
