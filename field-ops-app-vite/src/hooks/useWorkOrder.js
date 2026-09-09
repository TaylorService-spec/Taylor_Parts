import { useCallback, useEffect, useState } from "react";
import { WORK_ORDER_READ_RESULT, readScopedWorkOrderById } from "../access/scopedWorkOrderClient.js";
import { loadErrorMessage } from "../domain/loadErrorMessage";

const ENTITY = "work orders";

// Sprint 2.0.3 -- Work Order Experience. Single-document live
// listener, same onSnapshot(doc(...)) shape as useAccount.js/
// useCurrentTechnician.js -- not a new pattern.
//
// H14 -- this hook used to pass NO error callback to onSnapshot, so a
// DENIED or failed Work Order read never resolved -- `loading` stayed
// true forever and WorkOrderDetailPage.jsx's "Loading work order…"
// spun with no error and no recovery, and no consumer could fix it
// because nothing was exposed to check. It now fails closed to a safe
// `error` (loadErrorMessage -- never a raw code/path/id) and clears any
// stale workOrder, so a FAILED read is distinguishable from a
// CONFIRMED absence (a successful read that found no such Work Order)
// and from still loading -- the same discipline useAccount.js already
// applies. Also adds the retry re-subscription and obsolete-callback
// guard useAccount.js established, so callers can offer the same Retry
// affordance.
export function useWorkOrder(workOrderId) {
  const [workOrder, setWorkOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!workOrderId) {
      setWorkOrder(null);
      setError(null);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);
    // KNOWING AN ID DOES NOT BYPASS SCOPE. The server checks the stored assignedTechId against the
    // technician identity it resolved from request.auth.uid, and refuses when they differ -- so this
    // hook cannot be used to read another technician's work by guessing a URL.
    //
    // A SCOPE REFUSAL IS DENIED, NOT "NOT FOUND". That distinction is this hook's existing contract
    // (loadErrorMessage renders a permission message distinct from an absence) and the seam
    // preserves it deliberately rather than collapsing both into a missing record.
    //
    // ONE-SHOT, NOT A SUBSCRIPTION: a governed callable cannot stream. The record page re-reads on
    // navigation and on retry(), which is what it did in practice.
    (async () => {
      const res = await readScopedWorkOrderById(workOrderId);
      if (!active) return;
      if (!res.ok) {
        // Fail closed: clear any stale work order rather than leave a previous id's data on screen
        // looking current, and never render a failure as "no such work order".
        setWorkOrder(null);
        setError(
          loadErrorMessage(
            { code: res.result === WORK_ORDER_READ_RESULT.DENIED ? "permission-denied" : "unavailable" },
            { entity: ENTITY },
          ),
        );
        setLoading(false);
        return;
      }
      // A CONFIRMED ABSENCE: a successful read that found no such record. Null with NO error, which
      // is what tells a caller this is different from the refusal above.
      setWorkOrder(res.workOrder);
      setError(null);
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [workOrderId, attempt]);

  return { workOrder, loading, error, retry };
}
