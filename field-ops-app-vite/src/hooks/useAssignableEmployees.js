import { useEffect, useState } from "react";
import { onSnapshot } from "firebase/firestore";
import { buildAssignableEmployeesQuery } from "../domain/employees";

// Phase 3 -- Platform Assignment Foundation (docs/specifications/
// employee-foundation.md). onSnapshot()-based, not a one-shot read --
// required by this project's established standard (see
// hooks/useFirestoreCollection.js's header comment: a one-shot read
// caused a real, already-fixed bug in the Reorder Request notification
// system, PRs #73/#74).
//
// No companyId parameter -- per architecture review, a tenancy/
// security-relevant filter must be fully implemented and enforced by
// queries and firestore.rules, or be entirely absent. companyId stays
// off every Phase 3 signature (query service, this hook,
// EmployeeAssignmentPicker, provisionEmployeeAccess.js) until Company
// exists as an implemented, rules-enforced entity.
export function useAssignableEmployees({ requiredOperationalRole, requireLinkedUser = true, enabled = true } = {}) {
  const [state, setState] = useState({ employees: [], loading: enabled });

  useEffect(() => {
    if (!enabled) {
      setState({ employees: [], loading: false });
      return;
    }

    setState((prev) => ({ ...prev, loading: true }));
    const q = buildAssignableEmployeesQuery({ requiredOperationalRole, requireLinkedUser });
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        setState({
          employees: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
          loading: false,
          error: null,
        });
      },
      (error) => setState({ employees: [], loading: false, error })
    );

    return unsubscribe;
  }, [requiredOperationalRole, requireLinkedUser, enabled]);

  return { employees: state.employees, loading: state.loading, error: state.error ?? null };
}
