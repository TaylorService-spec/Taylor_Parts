import { useEffect, useState } from "react";
import { workforceDirectoryClient } from "../access/workforceDirectoryClient";
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
// NO LONGER A FIRESTORE READ AT ALL. This was an onSnapshot over `employees`, authorized by
// firestore.rules' isAdminOrDispatcher() -- i.e. by the legacy users/{uid}.role. Owner direction is
// that Firebase gives access to the system and decides nothing else; permission comes from the Role
// and object permissions administered in Admin. So it now calls the governed
// `listWorkforceDirectory`, which resolves `workforce.directory.read` server-side, and the
// client-direct `employees` read is denied in Rules.
//
// ONE-SHOT rather than a live subscription, because a callable cannot stream. Stated, not hidden:
// a directory change no longer repaints open screens by itself. Every consumer already re-reads the
// data it mutates, and a momentarily stale NAME is a smaller problem than the client holding a
// standing subscription to the whole workforce.
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
export function useEmployeeDirectory({ enabled = true, client = workforceDirectoryClient } = {}) {
  const [state, setState] = useState({ byUserId: new Map(), byEmployeeId: new Map(), loading: enabled });

  useEffect(() => {
    if (!enabled) {
      setState({ byUserId: new Map(), byEmployeeId: new Map(), loading: false });
      return;
    }

    setState((prev) => ({ ...prev, loading: true }));
    let live = true;
    client.listWorkforceDirectory().then((outcome) => {
      if (!live) return;
      if (!outcome.ok) {
        // A refused or unreachable read is an ERROR, never an empty directory. Rendering [] here
        // would tell every consumer the company has no employees -- the manager link would read
        // "Unavailable", the picker would look empty, and nothing would say why.
        setState({
          byUserId: new Map(),
          byEmployeeId: new Map(),
          loading: false,
          error: new Error(`workforce directory ${outcome.result}`),
        });
        return;
      }
      const byUserId = new Map();
      const byEmployeeId = new Map();
      for (const employee of outcome.employees) {
        if (employee.userId) byUserId.set(employee.userId, employee);
        byEmployeeId.set(employee.id, employee);
      }
      setState({ byUserId, byEmployeeId, loading: false, error: null });
    });
    return () => {
      live = false;
    };
  }, [enabled, client]);

  return {
    byUserId: state.byUserId,
    byEmployeeId: state.byEmployeeId,
    loading: state.loading,
    error: state.error ?? null,
  };
}
