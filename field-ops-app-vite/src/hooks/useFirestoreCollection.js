import { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/firebase";

// Additive: an onSnapshot error handler + an `error` field in the return.
// Backward-compatible -- existing callers that destructure only { data,
// loading } are unaffected. Previously a failed listener left `loading` true
// forever with no error surfaced; now it stops loading and exposes the error
// (the Customer Results Dashboard's error state, and a strict improvement for
// every other consumer).
export function useFirestoreCollection(path) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const ref = collection(db, path);
    setLoading(true);
    setError(null);

    const unsub = onSnapshot(
      ref,
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
  }, [path]);

  return { data, loading, error };
}
