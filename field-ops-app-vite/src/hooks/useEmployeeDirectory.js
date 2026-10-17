import { useEffect, useState } from "react";
import { collection, onSnapshot, query } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { EMPLOYEES_COLLECTION } from "../domain/constants";
// F-UID-1: resolveActorDisplayName is now a pure module in domain/ so it
// can be unit-tested; re-exported here to keep every existing
// `import { ..., resolveActorDisplayName } from ".../useEmployeeDirectory"`
// call site working unchanged.
export { resolveActorDisplayName, UNKNOWN_ACTOR_DISPLAY_NAME } from "../domain/actorDisplayName";

// PR #105 follow-up -- resolves an already-persisted actor uid
// (Reorder Request's assignedToUserId/orderedBy/receivedBy/
// purchasingStartedBy) to a display name for read-only display, same
// admin/dispatcher-only directory read. Deliberately UNFILTERED -- no
// employmentStatus/operationalRoles/userId clause -- because a historical actor
// may since have gone INACTIVE, lost their operationalRoles, or (an
// admin/dispatcher acting in their security role, not an operational one) never
// have had a linked Employee at all. firestore.rules' employees/{employeeId}
// grants admin/dispatcher an unconditional, unfiltered directory read.
//
// FIREBASE EXIT F4 (DECISIONS #247): this hook is now the FIREBASE-ONLY directory. Its remaining consumers are the three
// Financials screens (their finance facts are still Firebase until F7c-2, and the Employee ids they name belong to those facts).
// Every other screen names people through hooks/useGovernedEmployeeDirectory.js (EOS). domain/employees.js, whose only
// remaining export was this query, is folded in here and deleted.
//
// onSnapshot()-based, not a one-shot read -- this project's
// established standard at the time (the generic Firestore collection hook it
// cited was deleted by the Firebase exit, PR-A).
//
// Returns byUserId, a Map<userId, employee> -- a userId with no
// linked Employee record (a plain admin/dispatcher account, or a
// legacy assignment predating this initiative) simply has no entry;
// resolveActorDisplayName() (domain/actorDisplayName.js) maps that case
// to a neutral "Unknown user" label, never the raw uid (F-UID-1).
//
// Also returns byEmployeeId, a Map<employeeDocId, employee> -- ADDITIVE
// (Wave 7 completion, account-scoped Opportunity/Sales Order sections):
// Opportunity.ownerEmployeeId / SalesOrder.ownerEmployeeId are Employee
// DOC ids, not Firebase uids, so byUserId (keyed by the linked userId)
// cannot resolve them. Built from the SAME already-fetched directory
// snapshot -- no second read. Existing consumers that only destructure
// byUserId/loading/error are unaffected.
export function useEmployeeDirectory({ enabled = true } = {}) {
  const [state, setState] = useState({ byUserId: new Map(), byEmployeeId: new Map(), loading: enabled });

  useEffect(() => {
    if (!enabled) {
      setState({ byUserId: new Map(), byEmployeeId: new Map(), loading: false });
      return;
    }

    setState((prev) => ({ ...prev, loading: true }));
    const q = query(collection(db, EMPLOYEES_COLLECTION));
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const byUserId = new Map();
        const byEmployeeId = new Map();
        for (const doc of snap.docs) {
          const employee = { id: doc.id, ...doc.data() };
          if (employee.userId) byUserId.set(employee.userId, employee);
          byEmployeeId.set(doc.id, employee);
        }
        setState({ byUserId, byEmployeeId, loading: false, error: null });
      },
      (error) => setState({ byUserId: new Map(), byEmployeeId: new Map(), loading: false, error })
    );

    return unsubscribe;
  }, [enabled]);

  return {
    byUserId: state.byUserId,
    byEmployeeId: state.byEmployeeId,
    loading: state.loading,
    error: state.error ?? null,
  };
}
