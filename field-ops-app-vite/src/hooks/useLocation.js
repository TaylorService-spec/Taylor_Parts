import { useCallback, useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { LOCATIONS_COLLECTION } from "../domain/constants";
import { loadErrorMessage } from "../domain/loadErrorMessage";
import { useLocation as useLocationEosApi } from "./crm/eosApi/useLocation.js";

// Build-time CRM authority route (domain/crmAuthorityRoute.js): true only in a platform-sandbox build.
const CRM_VIA_EOS_API = typeof __APP_CRM_VIA_EOS_API__ === "boolean" && __APP_CRM_VIA_EOS_API__;

const ENTITY = "locations";

// Sprint 2.0.3 -- Work Order Experience. Single-document live
// listener for one Location, same shape as useAccount.js/
// useWorkOrder.js. Used by WorkOrderDetailPage.jsx to resolve
// workOrder.locationId to a display label for admin/dispatcher only
// -- see that file's header comment for why this is never attempted
// for the technician role.
//
// H14 -- this hook used to pass NO error callback to onSnapshot, so a
// DENIED or failed Location read never resolved -- `loading` stayed
// true forever with no error surfaced. It now fails closed to a safe
// `error` (loadErrorMessage -- never a raw code/path/id) and clears any
// stale location, matching useAccount.js/useWorkOrder.js's discipline,
// plus the same retry re-subscription and obsolete-callback guard.
function useLocationFirestore(locationId) {
  const [location, setLocation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!locationId) {
      setLocation(null);
      setError(null);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);
    const unsub = onSnapshot(
      doc(db, LOCATIONS_COLLECTION, locationId),
      (snap) => {
        if (!active) return;
        setLocation(snap.exists() ? { id: snap.id, ...snap.data() } : null);
        setError(null);
        setLoading(false);
      },
      (err) => {
        if (!active) return;
        setLocation(null);
        setError(loadErrorMessage(err, { entity: ENTITY }));
        setLoading(false);
      }
    );

    return () => {
      active = false;
      unsub();
    };
  }, [locationId, attempt]);

  return { location, loading, error, retry };
}

// ════════════════════ BUILD-TIME CRM AUTHORITY ROUTE ════════════════════
// `useLocation` is selected ONCE, from the build's environment (domain/crmAuthorityRoute.js): a platform-sandbox build
// uses the EOS API implementation (hooks/crm/eosApi/useLocation.js); every other build -- production included -- uses the legacy
// Firestore implementation above, unchanged. No runtime switch and no fallback between the two.
export const useLocation = CRM_VIA_EOS_API ? useLocationEosApi : useLocationFirestore;
