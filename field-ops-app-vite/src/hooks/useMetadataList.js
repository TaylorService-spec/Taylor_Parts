import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildQueryDescriptor } from "../metadata/listRuntime.js";
import { buildListPresentation } from "../metadata/listPresentation.js";
import { fetchPage as fetchFirestorePage } from "../metadata/firestoreListSource.js";
import { fetchPage as fetchCallablePage } from "../metadata/callableListSource.js";

// Drives a metadata list: descriptor -> page -> presentation model.
//
// It owns paging state and nothing else. Every judgement — which filters are legal, the
// sort order, the bound, which of the four states applies, what each state says — already
// belongs to a pure module, and re-deciding any of it here would put the honest version
// and the rendered version in two places.
//
// PAGES ACCUMULATE, they do not replace. "Load more" on a table that swapped the page out
// would lose the rows the reader was already looking at. Changing filters or sort DOES
// reset, because those rows answer a different question.
//
// ROUTES BY THE ENTITY'S DECLARED `readVia`, mirroring MetadataRecordPage.jsx's own
// `selectListSource` for the RELATED surface (X-INDEX-SURFACE-CALLABLE-READ). Before this,
// every INDEX list read Firestore unconditionally, so any entity declaring
// `readVia: "CALLABLE"` over a deny-all collection (opportunity, salesOrder today) could
// not have an INDEX surface at all — it would report permission-denied to every caller,
// including one genuinely holding the capability. See `selectListSource` below for the
// exact dispatch and why it is duplicated here rather than imported from the page module.
function selectListSource(entity) {
  if (entity?.readVia === "CLIENT_DIRECT") return fetchFirestorePage;
  if (entity?.readVia === "CALLABLE" && entity.readCallable) return fetchCallablePage;
  // UNKNOWN readVia, or CALLABLE with no readCallable declared: a misconfigured entity,
  // never a live read to attempt. Returning null here (rather than falling back to
  // fetchFirestorePage) is the fix — silently defaulting to Firestore is what would repeat
  // the exact defect this dispatch exists to close. Two routers reading the SAME entity
  // field and disagreeing on what it means is this program's most-repeated defect, so this
  // mirrors MetadataRecordPage.jsx's `selectListSource` shape and failure behavior exactly
  // rather than inventing a second vocabulary. Not imported from that module: this hook's
  // write scope does not include it, and a hook reaching into a page component would be a
  // worse layering violation than duplicating a five-line dispatch.
  return null;
}

export function useMetadataList(def, entity, { filters = [], sort = [], enabled = true } = {}) {
  const [rows, setRows] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(enabled);
  const [errorStatus, setErrorStatus] = useState(null);
  const cursorRef = useRef(null);
  // Guards against a slow first page landing after a filter change and overwriting the
  // newer result — the stale-response race that shows a user rows they just filtered out.
  const requestRef = useRef(0);

  const filterKey = JSON.stringify(filters);
  const sortKey = JSON.stringify(sort);

  const { descriptor, errors } = useMemo(
    () => buildQueryDescriptor(def, entity, { filters, sort }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [def, entity, filterKey, sortKey]
  );

  const load = useCallback(
    async ({ append }) => {
      if (!descriptor || !enabled) return;
      const token = (requestRef.current += 1);
      const source = selectListSource(entity);
      if (!source) {
        // Misconfigured entity (UNKNOWN readVia, or CALLABLE with no readCallable
        // declared) — never falls through to fetchFirestorePage, which is the exact
        // defect this dispatch exists to close: it would issue a live getDocs against
        // what may be a deny-all collection and report every viewer denied, permanently,
        // even one holding the real capability. Surfaced as "unavailable", the same choice
        // MetadataRecordPage.jsx's useRelatedListPresentation makes for the identical
        // case — never "denied" (no authorization check ran) and never empty (no read was
        // attempted). No source is touched.
        setErrorStatus("unavailable");
        setRows([]);
        setHasMore(false);
        cursorRef.current = null;
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const page = await source(descriptor, { cursorDoc: append ? cursorRef.current : null });
        if (token !== requestRef.current) return;
        setRows((prev) => (append ? [...prev, ...page.rows] : page.rows));
        setHasMore(page.hasMore);
        cursorRef.current = page.nextCursorDoc;
        setErrorStatus(null);
      } catch (e) {
        if (token !== requestRef.current) return;
        // DENIED and UNAVAILABLE stay distinct all the way down. Collapsing a rules
        // rejection into "could not load" tells someone to retry a read that will never
        // succeed, and hides that the real answer is about access.
        setErrorStatus(e?.code === "permission-denied" ? "denied" : "unavailable");
        setRows([]);
        setHasMore(false);
        cursorRef.current = null;
      } finally {
        if (token === requestRef.current) setLoading(false);
      }
    },
    [descriptor, enabled, entity]
  );

  useEffect(() => {
    cursorRef.current = null;
    if (!enabled) return;
    // A descriptor the runtime refused is a definition problem, not a failed read. It
    // must not present as a retryable outage.
    if (!descriptor) {
      setErrorStatus("unavailable");
      setRows([]);
      setLoading(false);
      return;
    }
    load({ append: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [descriptor, enabled]);

  const presentation = useMemo(
    () =>
      buildListPresentation({
        def,
        entity,
        page: errorStatus ? null : { rows, hasMore },
        loading,
        errorStatus,
        filtersActive: filters.length > 0,
      }),
    [def, entity, rows, hasMore, loading, errorStatus, filters.length]
  );

  return {
    presentation,
    descriptorErrors: errors,
    loadMore: () => load({ append: true }),
    retry: () => load({ append: false }),
  };
}
