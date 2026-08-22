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
// X-ENTITY-SINGLE-READCALLABLE: a list view MAY declare its own `readCallable`, honored
// ahead of the entity's — an INDEX list reading a CALLABLE entity through the unscoped
// callable its RELATED sibling cannot use (opportunity.index -> listOpportunityContext,
// vs. the entity's own account-scoped listOpportunitiesForAccount). A list view that
// declares nothing (`def.readCallable` null/undefined, the default `makeListViewDefinition`
// produces) falls straight through to the entity's own value — the exact value
// `buildQueryDescriptor` already put on the descriptor — so this is a no-op for every list
// view that predates this field. Mirrors MetadataRecordPage.jsx's identical resolver
// exactly, for the same X-UNCONSUMED-DECLARATION-PATTERN reason `selectListSource` below
// duplicates that module's dispatch rather than importing it.
function resolveReadCallable(def, entity) {
  return def?.readCallable || entity?.readCallable || null;
}

function selectListSource(entity, def) {
  if (entity?.readVia === "CLIENT_DIRECT") return fetchFirestorePage;
  if (entity?.readVia === "CALLABLE" && resolveReadCallable(def, entity)) return fetchCallablePage;
  // UNKNOWN readVia, or CALLABLE with no readCallable resolved (neither the list view nor
  // the entity declares one): a misconfigured entity, never a live read to attempt.
  // Returning null here (rather than falling back to fetchFirestorePage) is the fix —
  // silently defaulting to Firestore is what would repeat the exact defect this dispatch
  // exists to close. Two routers reading the SAME entity field and disagreeing on what it
  // means is this program's most-repeated defect, so this mirrors MetadataRecordPage.jsx's
  // `selectListSource` shape and failure behavior exactly rather than inventing a second
  // vocabulary. Not imported from that module: this hook's write scope does not include
  // it, and a hook reaching into a page component would be a worse layering violation than
  // duplicating a five-line dispatch.
  return null;
}

// `resolveReference` is threaded, not invented here.
//
// Every REFERENCE column on every metadata-driven list rendered "Unresolved reference" -- Sales
// Orders showed it on all 14 rows while all 14 accountIds resolved to a real customer -- because
// this hook accepted no resolver and buildListPresentation therefore received none. cellValue was
// behaving correctly: with no way to resolve, the only honest output is to say so rather than print
// a document id.
//
// THE HOOK STILL READS NOTHING. It is generic across 27 definitions and cannot know which governed
// read backs a given reference, so it takes the resolver from the caller -- the party that already
// fetched or joined the referenced entity -- exactly as listPresentation's own contract describes.
// Resolving here would mean a Firestore read from generic code and, worse, one read per row.
export function useMetadataList(def, entity, { filters = [], sort = [], enabled = true, resolveReference = null } = {}) {
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
      const source = selectListSource(entity, def);
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
        // The descriptor buildQueryDescriptor produced always carries the ENTITY's
        // readCallable (listRuntime.js is outside this hook's write scope, so it cannot be
        // taught the list view's override directly). Re-stamping it here with the resolved
        // value — the list view's own if it declared one, otherwise the entity's,
        // identical to what was already there — is what lets a declared override actually
        // reach callableListSource.fetchPage instead of being silently ignored, without
        // touching anything else buildQueryDescriptor decided (parent scope, sort, bound).
        // A no-op for CLIENT_DIRECT and for every list view that declares nothing.
        const effectiveDescriptor =
          entity?.readVia === "CALLABLE"
            ? Object.freeze({ ...descriptor, readCallable: resolveReadCallable(def, entity) })
            : descriptor;
        const page = await source(effectiveDescriptor, { cursorDoc: append ? cursorRef.current : null });
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
    [descriptor, enabled, entity, def]
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
        resolveReference,
      }),
    [def, entity, rows, hasMore, loading, errorStatus, filters.length, resolveReference]
  );

  return {
    presentation,
    // The RAW rows, so a caller can collect the ids its REFERENCE columns point at and resolve them
    // in ONE batched read. Without this, a caller wanting to resolve references would have to
    // re-read the list itself -- or resolve per rendered cell, which is the N+1 pattern the
    // presentation contract explicitly rules out.
    rows,
    descriptorErrors: errors,
    loadMore: () => load({ append: true }),
    retry: () => load({ append: false }),
  };
}
