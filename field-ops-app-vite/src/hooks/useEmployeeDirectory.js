import { useEffect, useState } from "react";
import { governedCollectionClient } from "../access/governedCollectionClient";
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
// firestore.rules' isAdminOrDispatcher() -- i.e. by the legacy users/{uid}.role. Firebase
// authenticates; EOS authorizes. It now reads the `employeeDirectory` governed source, which
// resolves `workforce.directory.read` server-side, and the client-direct `employees` read is denied
// in Rules. The client names a SOURCE, never the collection behind it.
//
// ONE-SHOT rather than a live subscription, because a callable cannot stream. Stated, not hidden:
// a directory change no longer repaints open screens by itself. Every consumer already re-reads the
// data it mutates, and a momentarily stale NAME is a smaller problem than the client holding a
// standing subscription to the whole workforce.
//
// AND IT PAGES TO EXHAUSTION rather than taking the first page, which is the one place a capped
// read would do real damage here: these are LOOKUP MAPS. A partial map resolves some names and
// returns undefined for the rest, and undefined renders as "Unknown user" -- a truncated read would
// show real people as unknown, silently, with nothing on screen to suggest a page boundary.
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
export function useEmployeeDirectory({ enabled = true, client = governedCollectionClient } = {}) {
  const [state, setState] = useState({ byUserId: new Map(), byEmployeeId: new Map(), loading: enabled });

  useEffect(() => {
    if (!enabled) {
      setState({ byUserId: new Map(), byEmployeeId: new Map(), loading: false });
      return;
    }

    setState((prev) => ({ ...prev, loading: true }));
    let live = true;
    // PAGED, and the directory needs ALL of it: byUserId/byEmployeeId are lookup maps, and a partial
    // map resolves some names and silently returns undefined for the rest -- which renders as
    // "Unknown user" for real people. So this follows nextCursor to exhaustion rather than taking
    // the first page. Bounded by the registry's own maxPageSize per request, not unbounded here.
    (async () => {
      const all = [];
      let cursor = null;
      let outcome;
      do {
        outcome = await client.readGovernedList({ sourceId: "employeeDirectory", pageSize: 200, cursor });
        if (!outcome.ok) break;
        all.push(...outcome.items);
        cursor = outcome.nextCursor;
      } while (cursor);
      return { outcome, all };
    })().then(({ outcome, all }) => {
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
      for (const employee of all) {
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
