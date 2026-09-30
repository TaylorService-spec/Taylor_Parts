import { useEffect, useState } from "react";
import { callWorkOrderApi } from "../services/workOrderApiClient.js";

/**
 * F1 — reads the governed field context for ONE Work Order.
 *
 * Calls `readWorkOrderFieldContext` on the EOS Work Order route (POST /operations/work-orders), which answers from
 * the PostgreSQL Work Order, CRM, Equipment and Catalog authorities behind the entitled per-record Work Order read.
 * The request carries `workOrderId` only -- there is deliberately no way to ask for an arbitrary customer or
 * location -- and the server derives those references from the governed Work Order itself. There is no Firebase
 * callable behind this and no fallback to one.
 *
 * The response keeps the F1 fields every consumer reads,
 * `{ workOrderId, customer: { state, displayName }, site: { state, displayLabel } }`, and adds subdomains that each
 * state their availability (equipment, parts, assignment, execution, and `inventory: { state: "NOT_YET_ACTIVATED" }`).
 *
 * FAILURE SEMANTICS, which the whole F1 honesty contract rests on:
 *   - a DENIAL or any failed read (FORBIDDEN / NOT_FOUND / NOT_ACTIVATED / unreachable) sets `denied`, so the
 *     experience can say "you may not see this" -- never "there is no customer";
 *   - a RESOLVED/ABSENT/UNRESOLVED response is DATA, and is passed through untouched.
 * `failure` carries the category and the server's reason, so a screen can tell NOT_ACTIVATED from a refusal.
 */
export function useWorkOrderFieldContext(workOrderId, deps = {}) {
  const call = deps.call ?? callWorkOrderApi;
  const [context, setContext] = useState(null);
  const [denied, setDenied] = useState(false);
  const [failure, setFailure] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!workOrderId) {
      setContext(null);
      setDenied(false);
      setFailure(null);
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setDenied(false);
    setFailure(null);

    Promise.resolve(call("readWorkOrderFieldContext", { workOrderId }))
      .catch(() => ({ ok: false, code: "UNREACHABLE", reason: null }))
      .then((res) => {
        if (cancelled) return;
        if (res?.ok) {
          setContext(res.result ?? null);
          setLoading(false);
          return;
        }
        // Fail closed and fail HONESTLY: a failure here means the caller may not read this context (or it is not
        // available yet), not that the Work Order has no customer.
        setContext(null);
        setDenied(true);
        setFailure({ code: res?.code ?? null, reason: res?.reason ?? null });
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [workOrderId, call]);

  return { context, denied, failure, loading };
}
