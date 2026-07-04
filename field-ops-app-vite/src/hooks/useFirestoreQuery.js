import { useEffect, useState } from "react";
import { collection, query, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/firebase";

// Same onSnapshot/loading contract as useFirestoreCollection, but accepts
// Firestore query constraints (where()/orderBy()/etc.) so a screen can
// subscribe to a filtered slice of a collection instead of the whole
// thing. Kept as a separate hook rather than extending
// useFirestoreCollection so every existing caller of that simpler,
// path-only hook is unaffected.
//
// enabled: when false, skips subscribing entirely. Needed for screens
// where a query constraint's value (e.g. the signed-in user's linked
// technicianId) isn't known yet on first render.
export function useFirestoreQuery(path, constraints = [], enabled = true) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const constraintsKey = constraints.map(String).join("|");

  useEffect(() => {
    if (!enabled) {
      setData([]);
      setLoading(true);
      return;
    }

    const ref = query(collection(db, path), ...constraints);

    const unsub = onSnapshot(ref, (snap) => {
      setData(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });

    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, enabled, constraintsKey]);

  return { data, loading };
}
