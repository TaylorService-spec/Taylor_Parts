import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, getCountFromServer, query, where, limit as fsLimit } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { selectableSavedViews } from "../metadata/listViewSummary.js";
import { buildQueryDescriptor } from "../metadata/listRuntime.js";
import { makeCriterion } from "../metadata/listUrlState.js";

// SAVED VIEWS AND AN HONEST COUNT — the two things every list header needs, once.
//
// ════════════════════ THE COUNT IS AN AGGREGATE, NOT A TALLY ════════════════════
//
// "31 items" is a claim about the whole filtered set. Counting the loaded rows would produce a
// number that is wrong in the reassuring direction — it would read as the total while being one
// screenful — which is the exact failure the Accounts portfolio cards exist to avoid.
//
// So this issues a real `getCountFromServer` aggregate over the SAME filters the list query uses.
// Firestore bills an aggregate at a fraction of a document read, and the same composite index that
// serves the list serves the count, so it adds no index demand.
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

// ════════════════════ AN INJECTED COUNT ════════════════════
//
// An object whose collection has moved off Firestore (the Part Master, onto the Render Catalog API)
// passes `options.count(descriptor)` and is counted by ITS authority over the same descriptor its
// list executes; the Firestore aggregate below is then never CALLED for it -- not as a fallback, not
// at all. Every other object is counted exactly as before.
//
// The Firestore imports stay STATIC and visible. This hook still serves Firestore-backed lists, so the
// dependency is real until the last of them moves; loading it lazily would only hide it from the
// shim-boundary scan, and a dependency is architectural, not a matter of when a module loads.
async function firestoreCount(entity, descriptor) {
  let q = query(collection(db, entity.collection));
  for (const f of descriptor.filters ?? []) {
    const op = f.operator === "IN" ? "in" : f.operator === "ARRAY_CONTAINS" ? "array-contains" : "==";
    q = query(q, where(f.fieldId, op, f.value));
  }
  // Bounded like every other read here. A count over an unbounded collection is still a scan
  // on the server's side of the wire.
  q = query(q, fsLimit(COUNT_CEILING));
  const snap = await getCountFromServer(q);
  return snap.data().count;
}

/**
 * @param def     ListViewDefinition — supplies savedViews and the collection to count
 * @param entity  EntityDefinition — supplies the collection name and field types
 * @param criteria current URL-backed criteria
 * @param apply   the criteria setter from useListCriteria
 * @param options.count optional `(descriptor) => Promise<number|null>`: the object's OWN count
 *                authority. When given, it is the only count consulted -- a failure is null, and no
 *                other source is tried.
 */
export function useListViewChrome(def, entity, criteria, apply, options = {}) {
  const injectedCount = typeof options?.count === "function" ? options.count : null;
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

    // Only CLIENT_DIRECT entities can be counted from here. A CALLABLE entity reads through a
    // trusted function, and issuing a client-direct aggregate against its deny-all collection
    // would fail every time — so it reports no count rather than a permission error. An injected
    // count is the object's own authority and is not subject to that Firestore-shaped rule.
    if (!injectedCount && (entity?.readVia !== "CLIENT_DIRECT" || !entity?.collection)) return undefined;

    const { descriptor, errors } = buildQueryDescriptor(def, entity, {
      filters: criteria?.filters ?? [],
      sort: criteria?.sort ?? [],
    });
    // A refused descriptor means no query ran for the list either. Counting something the list is
    // not showing would put a number above an empty table.
    if (errors?.length || !descriptor) return undefined;

    (async () => {
      try {
        const n = injectedCount ? await injectedCount(descriptor) : await firestoreCount(entity, descriptor);
        // Anything but a real non-negative integer is "no count", never a guess.
        if (!cancelled) setTotal(Number.isSafeInteger(n) && n >= 0 ? n : null);
      } catch {
        // Denied, offline, or unsupported. NULL, never 0 — see the header comment.
        if (!cancelled) setTotal(null);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def, entity, filterKey, injectedCount]);

  return { activeViewId, selectView, total, views };
}
