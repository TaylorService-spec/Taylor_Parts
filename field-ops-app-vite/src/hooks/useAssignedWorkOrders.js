import { useEffect, useState } from "react";
import { subscribeAssignedWorkOrders } from "../services/workOrderService";
import { loadErrorMessage } from "../domain/loadErrorMessage";

const ENTITY = "work orders";

// The signed-in person's OWN Work Orders -- ONLY from the governed listMyAssignedWorkOrders read. The
// SERVER resolves the caller to an EOS Employee (active employee_principal_link) and returns that
// Employee's open assignments; the browser passes no technician id and compares no identities.
//
// Returns { data, loading, error, employeeId, unlinked, notActivated }:
//   employeeId    the Employee the server resolved (the id assignedTechId now carries), or null.
//   unlinked      the read succeeded and this login is linked to no Employee -- a real answer, not an error.
//   notActivated  the Work Order authority is NOT_YET_ACTIVATED; `error` is the safe copy saying so.
//   error         already a SAFE string (loadErrorMessage), never a raw code.
//
// A legacy positional argument (the old technicianId) is IGNORED -- whose work this is is not the
// browser's question. Pass `{ enabled: false }` to stay idle, `{ includeCompleted: true }` to include
// COMPLETED work (CLOSED / CANCELLED never), `{ withDetail: false }` to skip the per-row detail read.
export function useAssignedWorkOrders(options = undefined) {
  const opts = options && typeof options === "object" ? options : {};
  const enabled = opts.enabled !== false;
  const includeCompleted = opts.includeCompleted === true;
  // Technician surfaces read planned/used parts, notes and lifecycle timestamps, which only the
  // governed DETAIL carries -- so the detail is read by default (bounded; see workOrderService).
  const withDetail = opts.withDetail !== false;
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(null);
  const [employeeId, setEmployeeId] = useState(null);
  const [resolved, setResolved] = useState(false);
  const [notActivated, setNotActivated] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setData([]);
      setLoading(false);
      setError(null);
      setResolved(false);
      setNotActivated(false);
      return undefined;
    }
    setLoading(true);
    setError(null);
    const unsub = subscribeAssignedWorkOrders(
      (workOrders, meta) => {
        setData(workOrders);
        setEmployeeId(meta?.employeeId ?? null);
        setResolved(true);
        setNotActivated(false);
        setError(null);
        setLoading(false);
      },
      (err) => {
        setData([]);
        setNotActivated(err?.code === "NOT_ACTIVATED");
        setError(loadErrorMessage(err, { entity: ENTITY }));
        setLoading(false);
      },
      { includeCompleted, withDetail },
    );
    return () => unsub();
  }, [enabled, includeCompleted, withDetail]);

  return { data, loading, error, employeeId, unlinked: resolved && !error && employeeId === null, notActivated };
}
