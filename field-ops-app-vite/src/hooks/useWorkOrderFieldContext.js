import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase/firebase";

/**
 * F1 — reads the trusted minimal field-context projection for ONE Work Order.
 *
 * Calls `getWorkOrderFieldContext`, which returns only
 * `{ workOrderId, customer: { state, displayName }, site: { state, displayLabel } }`
 * for the caller's OWN assigned Work Order. The request carries `workOrderId`
 * only — there is deliberately no way to ask for an arbitrary customer or
 * location — and the server derives those references from the governed Work
 * Order itself.
 *
 * FAILURE SEMANTICS, which the whole F1 honesty contract rests on:
 *   - a DENIAL (permission-denied / unauthenticated / failed-precondition /
 *     not-found) sets `denied`, so the experience can say "you may not see
 *     this";
 *   - a RESOLVED/ABSENT/UNRESOLVED response is DATA, and is passed through
 *     untouched so the experience can say "there is nothing here" or "we
 *     couldn't produce a name" instead.
 * These must never be collapsed into one another, so this hook keeps them on
 * separate fields rather than folding a denial into a null result.
 */
export function useWorkOrderFieldContext(workOrderId) {
  const [context, setContext] = useState(null);
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!workOrderId) {
      setContext(null);
      setDenied(false);
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setDenied(false);

    httpsCallable(functions, "getWorkOrderFieldContext")({ workOrderId })
      .then((res) => {
        if (cancelled) return;
        setContext(res?.data ?? null);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        // Fail closed and fail HONESTLY: a failure here means the caller may
        // not read this context, not that the Work Order has no customer.
        setContext(null);
        setDenied(true);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [workOrderId]);

  return { context, denied, loading };
}
