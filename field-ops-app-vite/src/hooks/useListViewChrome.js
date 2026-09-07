import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, getCountFromServer, query, where, limit as fsLimit } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { selectableSavedViews } from "../metadata/listViewSummary.js";
import { buildQueryDescriptor } from "../metadata/listRuntime.js";
import { makeCriterion } from "../metadata/listUrlState.js";
import { governedFilterName, governedSourceSpec } from "../metadata/callableListSource.js";

// SAVED VIEWS AND AN HONEST COUNT — the two things every list header needs, once.
//
// ════════════════════ THE COUNT IS AN AGGREGATE, NOT A TALLY ════════════════════
//
// "31 items" is a claim about the whole filtered set. Counting the loaded rows would produce a
// number that is wrong in the reassuring direction — it would read as the total while being one
// screenful — which is the exact failure the Accounts portfolio cards exist to avoid.
//
// So this counts the whole filtered set, over the SAME filters the list query uses. There are two
// paths because there are two kinds of list:
//
//   CLIENT_DIRECT -- a `getCountFromServer` aggregate. Firestore bills it at a fraction of a
//   document read, and the same composite index that serves the list serves the count.
//
//   CALLABLE over a governed source -- the trusted `countGovernedList`, which applies the same
//   capability and the same registered filters as the read behind the same source id.
//
// THE SECOND PATH IS NOT AN ENHANCEMENT, IT IS A REPAIR. This hook used to return early for any
// non-CLIENT_DIRECT entity -- correct when written, since a client-direct aggregate against a
// deny-all collection fails every time. Migrating 15 entities to the governed read path then
// turned that guard into silent removal of the count on Customers, Equipment and Parts: nothing
// errored, the number simply stopped being there. Accepting that would have been a product
// decision, and a transport migration does not get to make one.
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

const COUNT_CEILING = 10000;

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

    // A governed CALLABLE source counts through the trusted callable; a CLIENT_DIRECT entity
    // counts through a Firestore aggregate. Anything else -- UNKNOWN readVia, or a CALLABLE
    // entity whose readCallable is not a governed source (the purpose-built callables, which
    // expose no count) -- honestly has no count available and renders none.
    const governedSourceId = entity?.readVia === "CALLABLE" ? entity?.readCallable ?? null : null;
    const governedSpec = governedSourceId ? governedSourceSpec(governedSourceId) : null;
    if (!governedSpec && (entity?.readVia !== "CLIENT_DIRECT" || !entity?.collection)) return undefined;

    const { descriptor, errors } = buildQueryDescriptor(def, entity, {
      filters: criteria?.filters ?? [],
      sort: criteria?.sort ?? [],
    });
    // A refused descriptor means no query ran for the list either. Counting something the list is
    // not showing would put a number above an empty table.
    if (errors?.length || !descriptor) return undefined;

    (async () => {
      try {
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
        let q = query(collection(db, entity.collection));
        for (const f of descriptor.filters ?? []) {
          const op = f.operator === "IN" ? "in" : f.operator === "ARRAY_CONTAINS" ? "array-contains" : "==";
          q = query(q, where(f.fieldId, op, f.value));
        }
        // Bounded like every other read here. A count over an unbounded collection is still a scan
        // on the server's side of the wire.
        q = query(q, fsLimit(COUNT_CEILING));
        const snap = await getCountFromServer(q);
        if (!cancelled) setTotal(snap.data().count);
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
