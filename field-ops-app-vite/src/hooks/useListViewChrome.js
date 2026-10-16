import { useCallback, useEffect, useMemo, useState } from "react";
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
// So the count comes ONLY from the object's own count authority, injected as `options.count(descriptor)` and run
// over the same descriptor its list executes (the Part Master's Render Catalog `countParts`). A list without one
// shows no count. The Firestore `getCountFromServer` aggregate this hook used to fall back to was removed by the
// Firebase exit (PR-B, 2026-10-15): every list that mounts this hook either injects a count or reads through EOS /
// a callable, so that branch never ran.
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

    // Only an object's own injected count authority is consulted; without one there is no count.
    if (!injectedCount) return undefined;

    const { descriptor, errors } = buildQueryDescriptor(def, entity, {
      filters: criteria?.filters ?? [],
      sort: criteria?.sort ?? [],
    });
    // A refused descriptor means no query ran for the list either. Counting something the list is
    // not showing would put a number above an empty table.
    if (errors?.length || !descriptor) return undefined;

    (async () => {
      try {
        const n = await injectedCount(descriptor);
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
