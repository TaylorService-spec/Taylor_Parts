import { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/firebase";

// Additive: an onSnapshot error handler + an `error` field in the return.
// Backward-compatible -- existing callers that destructure only { data,
// loading } are unaffected. Previously a failed listener left `loading` true
// forever with no error surfaced; now it stops loading and exposes the error
// (the Customer Results Dashboard's error state, and a strict improvement for
// every other consumer).
// `enabled` DEFAULTS TO TRUE, so every existing caller is untouched. It exists for surfaces that
// compose this read only for some principals and must not open a subscription their Rules would
// deny -- a denied read costs a round trip and surfaces an error indistinguishable, on screen, from
// a genuine failure. Disabled is IDLE, never empty: `data` stays [] with `loading` false, so a
// caller that reads "no rows" as "none exist" would be wrong, which is why the composition layer
// asks for this only where the scope resolves.
export function useFirestoreCollection(path, enabled = true) {
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
  }, [path, enabled]);

  return { data, loading, error };
}
