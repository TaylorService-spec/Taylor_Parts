import { useEffect, useState } from "react";
import { onSnapshot } from "firebase/firestore";
import { buildEmployeeDirectoryQuery } from "../domain/employees";
// F-UID-1: resolveActorDisplayName is now a pure module in domain/ so it
// can be unit-tested; re-exported here to keep every existing
// `import { ..., resolveActorDisplayName } from ".../useEmployeeDirectory"`
// call site working unchanged.
export { resolveActorDisplayName, UNKNOWN_ACTOR_DISPLAY_NAME } from "../domain/actorDisplayName";

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
// resolveActorDisplayName() (domain/actorDisplayName.js) maps that case
// to a neutral "Unknown user" label, never the raw uid (F-UID-1).
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
