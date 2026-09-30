import { useCallback, useEffect, useState } from "react";
import { listWorkOrderTechnicians } from "../services/workOrderService";

// The technicians a Work Order may be scheduled / dispatched to -- the GOVERNED roster
// (listWorkOrderTechnicians), never the fieldops_technicians collection.
//
//   useWorkOrderTechnicians()            the board roster: every eligible Employee, each carrying its
//                                        operatingCompanyId so the board never offers one across companies.
//   useWorkOrderTechnicians(workOrderId) the picker for ONE job: only its operating company's Employees.
//
// Each row's `id` IS the Employee id -- the same id a Work Order's assignedTechId / scheduledTechId now
// carries (domain/workOrderAdapter.js), so lanes and pickers line up. A picker is discovery only; the
// server re-checks every predicate on the command.
//
// Returns { data, loading, error, notActivated, operatingCompanyId, retry }. `error` is the raw
// WorkOrderApiError (render it through loadErrorMessage); a refused read is never an empty roster.
export function useWorkOrderTechnicians(workOrderId = null, { enabled = true } = {}) {
  const [state, setState] = useState({ data: [], loading: enabled, error: null, operatingCompanyId: null });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) {
      setState({ data: [], loading: false, error: null, operatingCompanyId: null });
      return undefined;
    }
    let active = true;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    listWorkOrderTechnicians(workOrderId || null)
      .then((res) => {
        if (active) setState({ data: res.items, loading: false, error: null, operatingCompanyId: res.operatingCompanyId });
      })
      .catch((error) => {
        if (active) setState({ data: [], loading: false, error, operatingCompanyId: null });
      });
    return () => {
      active = false;
    };
  }, [workOrderId, enabled, attempt]);

  return { ...state, retry, notActivated: state.error?.code === "NOT_ACTIVATED" };
}
