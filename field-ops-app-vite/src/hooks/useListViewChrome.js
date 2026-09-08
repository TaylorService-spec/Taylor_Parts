import { useCallback, useEffect, useMemo, useState } from "react";
import { selectableSavedViews } from "../metadata/listViewSummary.js";
import { buildQueryDescriptor } from "../metadata/listRuntime.js";
import { makeCriterion } from "../metadata/listUrlState.js";
import { governedFilterName, governedSourceSpec } from "../metadata/callableListSource.js";
import { countScopedWorkOrders } from "../access/scopedWorkOrderClient.js";

// SAVED VIEWS AND AN HONEST COUNT — the two things every list header needs, once.
//
// ════════════════════ THE COUNT IS AN AGGREGATE, NOT A TALLY ════════════════════
//
// "31 items" is a claim about the whole filtered set. Counting the loaded rows would produce a
// number that is wrong in the reassuring direction — it would read as the total while being one
// screenful — which is the exact failure the Accounts portfolio cards exist to avoid.
//
// So this counts the whole filtered set, over the SAME filters the list query uses. There are two
// paths, and NEITHER touches Firestore:
//
//   a governed source -- the trusted `countGovernedList`, which applies the same capability and the
//   same registered filters as the read behind the same source id;
//
//   the scoped work-order seam -- `countScopedWorkOrders`, which additionally applies the same
//   assignment scope as the list above it, so a technician's number never disagrees with their rows.
//
// THE SECOND PATH IS NOT AN ENHANCEMENT, IT IS A REPAIR. This hook used to run a Firestore
// aggregate for CLIENT_DIRECT entities and return early for everything else -- correct when
// written, since a client-direct aggregate against a deny-all collection fails every time.
// Migrating the entities to governed reads then turned that guard into silent removal of the count
// on Customers, Equipment and Parts: nothing errored, the number simply stopped being there.
// Accepting that would have been a product decision, and a transport migration does not get to make
// one. The Firestore branch is now deleted outright — zero entities declare CLIENT_DIRECT.
//
// EVERY FAILURE PATH RETURNS NULL, NEVER ZERO. Denied, offline, unsupported, or a descriptor the
// runtime refused: the count is simply absent and the header renders no count at all. A zero here
// would state that the business has no work orders because a read failed.
//
// ════════════════════ A SAVED VIEW IS JUST CRITERIA ════════════════════
//
// The metadata already declares them ("Open work" = status IN the open states, sorted by created).
// Selecting one APPLIES its filters and sort to the same URL-backed criteria everything else uses —
// it is not a second state layer. That is why a view survives a refresh, a share, and a trip into a
// record and back: it was never held anywhere but the URL.


/**
 * @param def     ListViewDefinition — supplies savedViews and the collection to count
 * @param entity  EntityDefinition — supplies the collection name and field types
 * @param criteria current URL-backed criteria
 * @param apply   the criteria setter from useListCriteria
 */
export function useListViewChrome(def, entity, criteria, apply) {
  const views = useMemo(() => selectableSavedViews(def), [def]);

  // WHICH VIEW IS ACTIVE IS DERIVED, never held beside the criteria. Holding it separately is how
  // the selector and the chips come to disagree about what is applied — the same reason the Work
  // Order status chip derives from its filters.
  const activeViewId = useMemo(() => {
    const applied = JSON.stringify(
      (criteria?.filters ?? []).map((f) => [f.fieldId, f.operator, f.value]).sort(),
    );
    for (const v of views) {
      const want = JSON.stringify(
        (v.filters ?? []).map((f) => [f.fieldId, f.operator, f.value]).sort(),
      );
      if (want === applied && applied !== "[]") return v.id;
    }
    return null;
  }, [views, criteria]);

  const selectView = useCallback((viewId) => {
    const view = views.find((v) => v.id === viewId);
    if (!view) {
      // Leaving a view clears what the view applied. It does not clear a search term or anything
      // else the person set themselves.
      apply({ ...criteria, filters: [], sort: [] });
      return;
    }
    apply({
      ...criteria,
      filters: (view.filters ?? []).map((f) => makeCriterion({
        fieldId: f.fieldId, operator: f.operator, value: f.value, valueLabel: f.valueLabel ?? null,
      })),
      sort: [...(view.sort ?? [])],
    });
  }, [views, criteria, apply]);

  // ── the count ────────────────────────────────────────────────────────────────────────────
  const [total, setTotal] = useState(null);

  const filterKey = JSON.stringify((criteria?.filters ?? []).map((f) => [f.fieldId, f.operator, f.value]));

  useEffect(() => {
    let cancelled = false;
    setTotal(null);

    // A governed CALLABLE source counts through the trusted callable. Anything else -- UNKNOWN
    // readVia, or a CALLABLE entity whose readCallable is neither a governed source nor the scoped
    // work-order seam (the purpose-built callables, which expose no count) -- honestly has no count
    // available and renders none.
    const governedSourceId = entity?.readVia === "CALLABLE" ? entity?.readCallable ?? null : null;
    const governedSpec = governedSourceId ? governedSourceSpec(governedSourceId) : null;
    // Work Orders count through their own scoped seam -- same authority and same scope as the list
    // above them, so the number never disagrees with the rows. A technician sees the count of THEIR
    // work; a global reader sees all of it. Neither is told which, because neither asked.
    const scopedWorkOrder = governedSourceId === "readScopedWorkOrders";
    // NO CLIENT_DIRECT BRANCH. Zero entities declare it — every list, work orders included, counts
    // through a trusted callable — so the Firestore aggregate this hook used to run is unreachable
    // and is deleted rather than kept as a path nothing takes.
    if (!governedSpec && !scopedWorkOrder) return undefined;

    const { descriptor, errors } = buildQueryDescriptor(def, entity, {
      filters: criteria?.filters ?? [],
      sort: criteria?.sort ?? [],
    });
    // A refused descriptor means no query ran for the list either. Counting something the list is
    // not showing would put a number above an empty table.
    if (errors?.length || !descriptor) return undefined;

    (async () => {
      try {
        if (scopedWorkOrder) {
          const params = {};
          for (const cf of descriptor.filters ?? []) params[governedFilterName(cf.fieldId, cf.operator)] = cf.value;
          const res = await countScopedWorkOrders({ mode: "index", params });
          // NULL on failure, never 0 -- a zero here would state that there is no work.
          if (!cancelled) setTotal(res.ok && typeof res.count === "number" ? res.count : null);
          return;
        }
        if (governedSpec) {
          // Named filters and a source id. No collection, no field, no operator -- the same
          // division the read uses, so a count cannot reach past what the read may see.
          const filters = {};
          for (const cf of descriptor.filters ?? []) {
            filters[governedFilterName(cf.fieldId, cf.operator)] = cf.value;
          }
          const { httpsCallable } = await import("firebase/functions");
          const { functions } = await import("../firebase/firebase.js");
          const res = await httpsCallable(functions, "countGovernedList")({ sourceId: governedSourceId, filters });
          // `atLeast` means the server stopped at its ceiling. Surfaced as the count it is
          // confident of; a caller wanting to render "500+" has the flag on the response.
          if (!cancelled) setTotal(typeof res?.data?.count === "number" ? res.data.count : null);
          return;
        }
        // Unreachable: the guard above returns for anything that is neither a governed source nor
        // the scoped work-order seam, and zero entities declare CLIENT_DIRECT.
      } catch {
        // Denied, offline, or unsupported. NULL, never 0 — see the header comment.
        if (!cancelled) setTotal(null);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def, entity, filterKey]);

  return { activeViewId, selectView, total, views };
}
