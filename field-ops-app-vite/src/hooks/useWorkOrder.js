import { useCallback, useEffect, useState } from "react";
import { getWorkOrder, onWorkOrderMutation, WORK_ORDER_REFRESH_MS } from "../services/workOrderService";
import { loadErrorMessage } from "../domain/loadErrorMessage";

const ENTITY = "work orders";

// One Work Order's DETAIL over the governed EOS route (readWorkOrder) -- never a Firestore document read.
//
// Same contract the detail page already relies on (H14): a FAILED read clears any stale Work Order and
// sets a safe `error` (loadErrorMessage -- never a raw code/path/id), distinct from a CONFIRMED absence
// (a successful read that found no such Work Order -> workOrder null, error null) and from loading.
// `retry` re-reads. The former live listener is replaced by: an immediate read, a bounded refresh
// interval, and an immediate re-read after any governed Work Order write made from this client.
//
// `notActivated` is true while the authority answers NOT_ACTIVATED; `error` then carries the
// NOT_YET_ACTIVATED copy, never "no such Work Order".
export function useWorkOrder(workOrderId) {
  const [workOrder, setWorkOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notActivated, setNotActivated] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!workOrderId) {
      setWorkOrder(null);
      setError(null);
      setNotActivated(false);
      setLoading(false);
      return undefined;
    }

    let active = true;
    let busy = false;
    setLoading(true);
    setError(null);
    const load = async () => {
      if (busy || !active) return;
      busy = true;
      try {
        const wo = await getWorkOrder(workOrderId);
        if (!active) return;
        setWorkOrder(wo);
        setError(null);
        setNotActivated(false);
        setLoading(false);
      } catch (err) {
        if (!active) return;
        // Fail closed: clear any stale work order, and never render a failure as "no such work order".
        setWorkOrder(null);
        setNotActivated(err?.code === "NOT_ACTIVATED");
        setError(loadErrorMessage(err, { entity: ENTITY }));
        setLoading(false);
      } finally {
        busy = false;
      }
    };
    void load();
    const timer = setInterval(() => { void load(); }, WORK_ORDER_REFRESH_MS);
    const off = onWorkOrderMutation((id) => {
      if (id === null || id === workOrderId) void load();
    });

    return () => {
      active = false;
      clearInterval(timer);
      off();
    };
  }, [workOrderId, attempt]);

  return { workOrder, loading, error, retry, notActivated };
}
