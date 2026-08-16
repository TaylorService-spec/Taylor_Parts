import { useEffect, useMemo, useState } from "react";
import { DEFAULT_COORDINATED_OPERATIONS_SOURCE } from "../access/coordinatedOperationsSource.js";
import { buildCoordinatedVisits } from "../domain/coordinatedVisit.js";

const UNAVAILABLE_SNAP = {
  status: "unavailable",
  synthetic: false,
  workOrders: [],
  fieldSignalsByWorkOrderId: {},
  operationalContextByWorkOrderId: {},
  accountNameById: {},
  locationNameById: {},
  salesOrderLabelById: {},
  error: null,
};

// Adapts the injected coordinated-operations SOURCE into the shape the Service/Dispatch and Technician
// surfaces consume: the built coordinated visits (pure projection over the source's Work Orders) plus the
// injected signal/context/name maps. The synthetic→governed swap is invisible here — the production default
// (access/coordinatedOperationsSource.js's DEFAULT_COORDINATED_OPERATIONS_SOURCE) is now the GOVERNED
// callable read, which is ASYNC (a Promise), while the synthetic fixture source used by tests/stories is
// SYNCHRONOUS. `source()` is called EXACTLY ONCE per mount (a lazy useState initializer) and its result is
// duck-typed for `.then` to tell the two apart -- matching hooks/useOpportunities.js's own pattern exactly.
// The sync path renders real data on the very first render (unchanged from before this hook supported
// async); the async path renders an honest `loading: true` until the promise settles, and `status:"loading"`
// distinct from "ready"/"denied"/"unavailable" so a loading source is never mistaken for an empty or denied
// one. `source` is injectable purely so tests can substitute a snapshot.
export function useCoordinatedOperations(source = DEFAULT_COORDINATED_OPERATIONS_SOURCE) {
  const [raw] = useState(() => source());
  const rawIsAsync = raw != null && typeof raw.then === "function";

  const [snapshot, setSnapshot] = useState(() => (rawIsAsync ? null : raw));
  const [loading, setLoading] = useState(rawIsAsync);

  useEffect(() => {
    if (!rawIsAsync) return undefined;
    let cancelled = false;
    raw
      .then((s) => {
        if (!cancelled) {
          setSnapshot(s);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSnapshot(UNAVAILABLE_SNAP);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `raw` is the ONE promise captured at mount.
  }, [rawIsAsync]);

  const snap = snapshot ?? UNAVAILABLE_SNAP;

  const visits = useMemo(() => {
    if (snap.status !== "ready") return [];
    const built = buildCoordinatedVisits(snap.workOrders ?? []);
    // Attention-first, then most remaining obligation, then by Sales Order id for stability.
    return [...built].sort((a, b) => {
      const aAtt = a.readiness === "ATTENTION" ? 0 : 1;
      const bAtt = b.readiness === "ATTENTION" ? 0 : 1;
      if (aAtt !== bAtt) return aAtt - bAtt;
      if (b.remaining !== a.remaining) return b.remaining - a.remaining;
      return String(a.salesOrderId).localeCompare(String(b.salesOrderId));
    });
  }, [snap]);

  return {
    status: loading ? "loading" : snap.status,
    loading,
    synthetic: snap.synthetic === true,
    visits,
    fieldSignalsByWorkOrderId: snap.fieldSignalsByWorkOrderId ?? {},
    operationalContextByWorkOrderId: snap.operationalContextByWorkOrderId ?? {},
    accountNameById: snap.accountNameById ?? {},
    locationNameById: snap.locationNameById ?? {},
    salesOrderLabelById: snap.salesOrderLabelById ?? {},
  };
}
