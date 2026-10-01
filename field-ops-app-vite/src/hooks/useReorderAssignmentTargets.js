// The Reorder assignment picker's Employee source -- the governed EOS read (listReorderAssignmentTargets), replacing the
// Firestore `employees` query (Controller PARTS / PURCHASING / RECEIVING RULINGS, 2026-10-01: "Move the Reorder assignment
// picker off Firestore employees. Use the existing EOS Principal / Employee / eligibility model."). It offers exactly the
// Employees the assign command accepts -- ACTIVE, an active governed login, the current PARTS_OPERATIONS eligibility --
// decided server-side and gated by reorder.request.assign. No uid or login identity is returned or needed: the command
// takes the Employee id.
//
// Same shape as useAssignableEmployees, so EmployeeAssignmentPicker renders it unchanged. Fail closed: a refusal is an
// error, never an empty-looking list.
import { useEffect, useState } from "react";
import { fetchReorderAssignmentTargets } from "../services/partsOperationsReads.js";

export function useReorderAssignmentTargets({ enabled = true, fetchTargets = fetchReorderAssignmentTargets } = {}) {
  const [state, setState] = useState({ employees: [], loading: enabled, error: null, securityRoleWarningCount: 0 });
  useEffect(() => {
    if (!enabled) { setState({ employees: [], loading: false, error: null, securityRoleWarningCount: 0 }); return undefined; }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetchTargets()
      .then((items) => {
        if (cancelled) return;
        const employees = items.map((t) => Object.freeze({ employeeId: t.employeeId, displayName: t.displayName ?? t.employeeId, userId: null }));
        setState({ employees, loading: false, error: null, securityRoleWarningCount: 0 });
      })
      .catch((err) => { if (!cancelled) setState({ employees: [], loading: false, error: err?.code ?? "unavailable", securityRoleWarningCount: 0 }); });
    return () => { cancelled = true; };
  }, [enabled, fetchTargets]);
  return state;
}
