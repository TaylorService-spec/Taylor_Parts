// LIST CRITERIA, HELD IN THE URL — the hook every metadata-driven list uses.
//
// GOVERNANCE: docs/architecture/ADR-013-object-list-metadata-authority.md.
//
// One place that knows criteria live in the address bar, so no screen has to remember. A screen that
// keeps criteria in `useState` instead is not merely different — it silently loses them the moment
// somebody opens a record and comes back, which is the single most common thing a person does with a
// list.
//
// It also writes the criteria to session memory on every change, so an explicit "Back to <list>"
// control can restore the working list without depending on browser history. History sends the
// person who arrived from the list back to the list, and the person who arrived from a dashboard
// tile or a pasted link somewhere arbitrary — the same control behaving several different ways.

import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { fromSearchParams, toSearchParams } from "../metadata/listUrlState.js";
import { rememberListState } from "../navigation/listStateMemory.js";

/**
 * @param def           ListViewDefinition
 * @param entity        EntityDefinition
 * @param listKey       stable key for session memory (usually the nav item key)
 * @param hasCapability optional (capabilityId) => boolean, threaded to the parser
 *
 * @returns { criteria, apply, dropped }
 *   criteria  { filters, sort, search, view, dropped } — already validated against this build
 *   apply     (nextCriteria) => void, writes to the URL and to session memory
 */
export function useListCriteria(def, entity, listKey, { hasCapability = null } = {}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryString = searchParams.toString();

  const criteria = useMemo(
    () => fromSearchParams(queryString, def, entity, { hasCapability }),
    [queryString, def, entity, hasCapability],
  );

  const apply = useCallback((next) => {
    const params = toSearchParams(next, queryString);
    // PUSH, not replace: narrowing a list is a step a person can undo with Back, the same way they
    // would expect anywhere else.
    setSearchParams(params, { replace: false });
    if (listKey) rememberListState(listKey, params.toString());
  }, [queryString, setSearchParams, listKey]);

  return { criteria, apply, dropped: criteria.dropped };
}
