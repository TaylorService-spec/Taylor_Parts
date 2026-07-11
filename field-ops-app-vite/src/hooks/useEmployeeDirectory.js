import { useEffect, useState } from "react";
import { onSnapshot } from "firebase/firestore";
import { buildEmployeeDirectoryQuery } from "../domain/employees";

// PR #105 follow-up -- resolves an already-persisted actor uid
// (Reorder Request's assignedToUserId/orderedBy/receivedBy/
// purchasingStartedBy) to a display name for read-only display, same
// admin/dispatcher-only directory read useAssignableEmployees.js
// already relies on (see domain/employees.js's
// buildEmployeeDirectoryQuery() for why this is unfiltered).
// onSnapshot()-based, not a one-shot read -- this project's
// established standard (see hooks/useFirestoreCollection.js's header
// comment).
//
// Returns byUserId, a Map<userId, employee> -- a userId with no
// linked Employee record (a plain admin/dispatcher account, or a
// legacy assignment predating this initiative) simply has no entry;
// callers fall back to displaying the raw uid in that case, never an
// error.
export function useEmployeeDirectory({ enabled = true } = {}) {
  const [state, setState] = useState({ byUserId: new Map(), loading: enabled });

  useEffect(() => {
    if (!enabled) {
      setState({ byUserId: new Map(), loading: false });
      return;
    }

    setState((prev) => ({ ...prev, loading: true }));
    const q = buildEmployeeDirectoryQuery();
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const byUserId = new Map();
        for (const doc of snap.docs) {
          const employee = { id: doc.id, ...doc.data() };
          if (employee.userId) byUserId.set(employee.userId, employee);
        }
        setState({ byUserId, loading: false, error: null });
      },
      (error) => setState({ byUserId: new Map(), loading: false, error })
    );

    return unsubscribe;
  }, [enabled]);

  return { byUserId: state.byUserId, loading: state.loading, error: state.error ?? null };
}

// Resolves a stored actor uid to a display name, falling back to the
// raw uid when no linked Employee record exists (or the directory is
// still loading) -- never blank, never an error state.
export function resolveActorDisplayName(userId, byUserId) {
  if (!userId) return userId;
  return byUserId?.get(userId)?.displayName ?? userId;
}
