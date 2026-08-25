import { useCallback, useEffect, useState } from "react";
import {
  fetchWorkOrderReadinessContext,
  WORK_ORDER_READINESS_CONTEXT_NOT_READY,
} from "../services/workOrderReadinessContextClient.js";

/**
 * Read-only North Star readiness context. Transport-off is IDLE, not an error banner: the existing
 * Parts Plan already renders readiness honestly as unavailable, and duplicating that absence in the
 * attention band would violate one-fact-one-rendering.
 */
export function useWorkOrderReadinessContext(workOrderId) {
  const [context, setContext] = useState(null);
  const [state, setState] = useState(workOrderId ? "LOADING" : "IDLE");

  const load = useCallback(() => {
    if (!workOrderId) {
      setContext(null);
      setState("IDLE");
      return undefined;
    }

    let cancelled = false;
    setState("LOADING");
    fetchWorkOrderReadinessContext(workOrderId).then((result) => {
      if (cancelled) return;
      if (result?.result) {
        setContext(result.result);
        setState("READY");
        return;
      }
      setContext(null);
      if (result?.errorStatus === WORK_ORDER_READINESS_CONTEXT_NOT_READY) {
        setState("IDLE");
      } else if (result?.errorStatus === "permission-denied") {
        setState("DENIED");
      } else {
        setState("UNAVAILABLE");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [workOrderId]);

  useEffect(() => load(), [load]);

  return { context, state, retry: load };
}
