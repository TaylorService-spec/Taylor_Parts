import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { JOBS_COLLECTION } from "../domain/constants";

// F-RULES-1 read-scoping -- technician-facing scoped read of fieldops_jobs.
// Unlike useFirestoreCollection(JOBS_COLLECTION) (a full-collection listener
// used by the admin/dispatcher surfaces), this issues a query constrained to
// the caller's own technicianId, so the LIST is provably authorized under the
// scoped read rule (a technician's unconstrained read is denied). This is the
// client half of the read-scoping interlock: the Rules require exactly the
// query this hook makes.
//
// Fail-closed: no technicianId (unmapped user, or mapping not yet resolved)
// -> empty result, no broad fallback. Single-field `technicianId ==` equality
// is auto-single-field-indexed, so no composite index is required.
export function useAssignedJobs(technicianId) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!technicianId) {
      setData([]);
      setLoading(false);
      setError(null);
      return undefined;
    }

    setLoading(true);
    setError(null);

    const q = query(
      collection(db, JOBS_COLLECTION),
      where("technicianId", "==", technicianId)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        setData(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setError(null);
        setLoading(false);
      },
      (err) => {
        setError(err);
        setData([]);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [technicianId]);

  return { data, loading, error };
}
