import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
// THE SCOPED SEAM, not the governed list client. Reorder reads have THREE populations resolved
// by three capabilities -- global queue, a Parts Manager's managed set, a Parts Associate's own
// assignments -- and the server decides which one this principal gets. A single-capability
// source could only have carried one of them.
import { readScopedReorderRequests } from "../access/scopedReorderClient.js";
import {
  subscribeReorderRequestsChanged,
  getReorderRequestsVersion,
} from "../domain/reorderRequestsChanged";
import { REORDER_REQUEST_STATUS } from "../domain/constants";

// Bug fix -- Reorder Request notifications/queues (Notification Panel,
// Parts Manager Queue, Parts Associate Queue, PartDetail.jsx) only
// updated after a browser refresh. Root cause: every hook below used
// to do a one-shot list()/getDocs() read (via
// domain/inventoryReorderRequests.js's reorderRequestsStore), so a
// write in one mounted component (e.g. PartsList.jsx's "Request
// Reorder") never reached another already-mounted component (e.g.
// AppHeader.jsx's Notification Panel) -- there was no shared cache or
// invalidation signal between them, just independent one-shot reads
// taken at each component's own mount time.
//
// Fixed by reusing the realtime pattern already established elsewhere
// in this platform (hooks/useFirestoreCollection.js, 17 existing
// consumers; services/workOrderService.ts's subscribeToWorkOrders()/
// subscribeAssignedWorkOrders()) instead of inventing a new pub-sub or
// cache-invalidation mechanism: every hook here now subscribes
// directly via onSnapshot(), server-side query-filtered (where()) the
// same way subscribeAssignedWorkOrders() filters by assignedTechId.
// External signatures are unchanged -- no caller (PartsList.jsx/
// PartDetail.jsx/AppHeader.jsx) needed to change.
//
// SUPERSEDED, and recorded rather than deleted: the paragraphs above describe an onSnapshot
// design that no longer exists. Rules no longer decide access for reorder_requests -- Firebase
// authenticates and EOS authorizes -- so every read here now resolves reorder.request.read.queue
// server-side through the governed source. The realtime behaviour those paragraphs won IS lost:
// a callable cannot stream, so these are one-shot reads and a queue no longer repaints when
// another component writes. Every caller already re-reads after its own write.
//
// Writes still go exclusively through domain/inventoryReorderRequests.js -- nothing here writes.

// Sprint 2.1.3 -- Reorder Request & Notification Foundation. Filtered
// to PENDING_REVIEW only. Shared by PartsList.jsx (to know which Parts
// already have a pending request) and AppHeader.jsx's NotificationPanel
// (to list them) -- one read implementation, not two. Naturally
// excludes requests once reviewed (Sprint 2.1.4) since they no longer
// have status PENDING_REVIEW -- satisfies "remove completed requests
// from the Notification Panel" without any extra filtering logic.
//
// `enabled` lets a caller skip the read entirely for a role that has no
// firestore.rules read access (technician) -- avoids an unnecessary
// permission-denied console error rather than subscribing and
// discarding.
//
// Sprint 2.1.5 -- Inventory -> Parts Manager Handoff. Built on top of
// useReorderRequestsByStatus() below (one read implementation, not
// two) -- external signature/behavior unchanged.

/**
 * The cross-component refresh signal, as a render-visible value.
 *
 * These reads used onSnapshot so a write in one component refreshed a view in another. A governed
 * callable cannot stream, so the signal supplies that: every hook below takes this version as a
 * useEffect dependency, and a successful reorder write anywhere bumps it, which re-runs the read.
 *
 * useSyncExternalStore rather than a useState+useEffect pair because it is exactly this: an
 * external mutable value React needs to observe, with no tearing between concurrent renders.
 */
function useReorderRequestsVersion() {
  return useSyncExternalStore(subscribeReorderRequestsChanged, getReorderRequestsVersion, getReorderRequestsVersion);
}

// GOVERNED READ, one shape for the four list hooks below.
//
// `reorder_requests` is denied to every client in firestore.rules now; these resolve
// reorder.request.read.queue server-side. The filters are DISPLAY filters and were never an
// access-control boundary -- Rules gated this collection at role level and the capability does
// the same, so the authority is unchanged by this migration.
//
// The error shape is preserved exactly: consumers switch on a string code, so a refused read
// still surfaces as "permission-denied" and anything else as "unknown". A failed read never
// becomes an empty list.
function subscribeGoverned(filters, apply) {
  let active = true;
  readScopedReorderRequests({ mode: "index", params: filters, pageSize: 200 })
    .then((outcome) => {
      if (!active) return;
      apply(
        outcome.ok
          ? { data: outcome.items, loading: false, error: null }
          : { data: [], loading: false, error: outcome.result === "DENIED" ? "permission-denied" : "unknown" },
      );
    });
  return () => {
    active = false;
  };
}
export function useReorderRequests(enabled = true) {
  return useReorderRequestsByStatus(REORDER_REQUEST_STATUS.PENDING_REVIEW, enabled);
}

// Sprint 2.1.5 -- Inventory -> Parts Manager Handoff. Same pattern as
// useReorderRequests(), generalized to any single status -- used for
// the Parts Manager Queue (READY_FOR_PARTS_MANAGER), the Purchasing
// Started notification (PURCHASING_IN_PROGRESS), and their
// Notification Panel sections, without a second read implementation.
export function useReorderRequestsByStatus(status, enabled = true) {
  const [state, setState] = useState({ data: [], loading: enabled, error: null });
  const changeVersion = useReorderRequestsVersion();

  useEffect(() => {
    if (!enabled) {
      setState({ data: [], loading: false, error: null });
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));
    return subscribeGoverned({ status }, setState);
  }, [status, enabled, changeVersion]);

  return state;
}

// Sprint 2.1.6 -- Parts Manager -> Parts Associate Assignment. The
// platform's first per-user filtered read, filtered to a specific
// assignedToUserId -- used by the Parts Associate Queue (PartsList.jsx)
// and the Notification Panel's "Assigned to You" section.
// firestore.rules' read access is still role-level (admin/dispatcher,
// unchanged) -- this filter is a server-side query constraint, same as
// subscribeAssignedWorkOrders()'s where() clause, not an access-control
// boundary.
//
// Sprint 2.1.7 -- Purchase Execution Foundation. `status` is an
// explicit parameter (was hardcoded to ASSIGNED_TO_PARTS_ASSOCIATE) so
// this same hook serves both the Parts Associate Queue's "Waiting"
// (ASSIGNED_TO_PARTS_ASSOCIATE) and "In Progress"
// (PURCHASING_IN_PROGRESS) sections, still filtered to one person.
export function useReorderRequestsAssignedTo(userId, status, enabled = true) {
  const [state, setState] = useState({ data: [], loading: enabled, error: null });
  const changeVersion = useReorderRequestsVersion();

  useEffect(() => {
    if (!enabled || !userId) {
      setState({ data: [], loading: false, error: null });
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));
    // assignedToUserId stays a caller-supplied DISPLAY filter, exactly as it is today -- the
    // comment above already records that it was never an access-control boundary, and the
    // capability behind this read is role-level just as the Rule was. Making it a server-derived
    // "me" would be a scope change, which this migration deliberately does not make.
    return subscribeGoverned({ assignedToUserId: userId, status }, setState);
  }, [userId, status, enabled, changeVersion]);

  return state;
}

// Sprint 2.1.4 -- Reorder Review & Decision. Unlike useReorderRequests()
// above, this returns the MOST RECENT Reorder Request for one Part
// regardless of status -- PartDetail.jsx needs to show a pending
// request's review actions AND an already-decided request's outcome
// (status/reviewDecision/reviewNotes), not just pending ones.
//
// Bug fix -- now realtime: the review/assignment/purchasing-start
// cards on PartDetail.jsx update live as the request's status changes,
// without needing a page reload. `refresh` is kept, as a no-op, purely
// for call-site compatibility (PartDetail.jsx destructures and calls
// it after each write) -- it's no longer necessary now that this
// subscribes live, but removing it would mean touching every call site
// for no behavioral gain.
//
// Notification identity fix (docs/specifications/notification-identity.md,
// Issue #145) -- `requestId` is a new, optional second parameter. Every
// Notification Panel item and PartsList.jsx queue link already carries
// its own request's exact document id; this lets a caller resolve THAT
// exact document instead of "whichever request for this part happens
// to be newest," which could silently be a different, terminal request
// for the same part. When `requestId` is falsy, behavior is BYTE-FOR-
// BYTE UNCHANGED from before this fix -- the original partId-only,
// most-recent-by-createdAt query, no status filter, same as every
// direct `/inventory/:partId` visit (bookmark, typed URL) has always
// used and must keep using.
//
// `error` is a new field on the returned state. On the requestId path:
// `"not_found"` (the document doesn't exist), `"mismatch"` (it exists, but
// its own partId disagrees with the partId this hook was called with), or
// a real Firestore SDK error code (e.g. `"permission-denied"`,
// `"unavailable"`) when the read itself fails -- this hook deliberately
// does NOT fall back to the most-recent query on any of these; a caller
// with an explicit-but-wrong id, or a denied/failed read, should see a
// clear failure, not a silently different document or a false empty state.
// On the no-requestId path, `error` is `null` unless the read itself fails,
// in which case it carries the same real Firestore SDK error code (Site-work
// r4 C, Fix 2 -- previously always `null`, silently indistinguishable from
// "no request exists yet"). Existing callers that don't destructure `error`
// are unaffected either way.
export function useReorderRequestForPart(partId, requestId) {
  const [state, setState] = useState({ data: null, loading: true, error: null });

  useEffect(() => {
    setState((prev) => ({ ...prev, loading: true, error: null }));

    if (requestId) {
      let active = true;
      readScopedReorderRequests({ mode: "index", params: { ids: [requestId] }, pageSize: 1 })
        .then((outcome) => {
          if (!active) return;
          if (!outcome.ok) {
            // "not_found" comes ONLY from an empty successful read, never from a failure -- a
            // denied or unavailable read is not the same fact as "this document does not exist",
            // and PartDetail needs to tell them apart.
            setState({
              data: null,
              loading: false,
              error: outcome.result === "DENIED" ? "permission-denied" : "unknown",
            });
            return;
          }
          const data = outcome.items[0] ?? null;
          if (!data) {
            setState({ data: null, loading: false, error: "not_found" });
            return;
          }
          if (data.partId !== partId) {
            setState({ data: null, loading: false, error: "mismatch" });
            return;
          }
          setState({ data, loading: false, error: null });
        });
      return () => {
        active = false;
      };
    }

    // The most-recent request for this part. Sorting stays CLIENT-SIDE and unchanged: the source
    // returns document-id order (exactly what the unordered Firestore query returned), and this
    // hook has always picked the newest itself. Moving the sort server-side would need a second
    // ordering on the source and would change nothing a caller can see.
    let active = true;
    readScopedReorderRequests({ mode: "index", params: { partId }, pageSize: 200 })
      .then((outcome) => {
        if (!active) return;
        if (!outcome.ok) {
          // Preserved from the retrofit this replaces: a failed read must not render identically
          // to "no request exists yet", which hid denied reads from the caller.
          setState({
            data: null,
            loading: false,
            error: outcome.result === "DENIED" ? "permission-denied" : "unknown",
          });
          return;
        }
        const forPart = [...outcome.items].sort((a, b) => b.createdAt - a.createdAt);
        setState({ data: forPart[0] ?? null, loading: false, error: null });
      });

    return () => {
      active = false;
    };
  }, [partId, requestId]);

  const refresh = useCallback(() => {}, []);

  return { ...state, refresh };
}

// Inventory Operational Queue, PR A (docs/specifications/inventory-
// operational-queue.md, "PR A: useReorderRequestsByStatuses() -- with a
// real error state"). Cross-user oversight read: every Reorder Request
// currently in one of the given `statuses`, regardless of assignee --
// unlike useReorderRequestsAssignedTo() above, this does NOT filter by
// uid. Purpose-built for "All Assigned Work" (PartsList.jsx), additive to
// -- never a replacement for -- the personal Waiting/In Progress queues,
// which stay scoped to exactly the signed-in user.
//
// Unlike every other hook in this file, `error` here carries the
// Firestore SDK's own onSnapshot error code (e.g. "permission-denied",
// "unavailable"), not silently swallowed into an empty array -- per the
// Specification's explicit carve-out: this is a NEW hook, not a retrofit
// of an existing one (see that document's "Non-goals" section for why
// the other hooks above are deliberately left unchanged).
//
// Single-field `in` query -- no composite index required, same as every
// other reorder_requests query in this file.
export function useReorderRequestsByStatuses(statuses, enabled = true) {
  const [state, setState] = useState({ data: [], loading: enabled, error: null });
  const changeVersion = useReorderRequestsVersion();

  useEffect(() => {
    if (!enabled || !statuses?.length) {
      setState({ data: [], loading: false, error: null });
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));
    return subscribeGoverned({ statuses }, setState);
  }, [statuses.join(","), enabled, changeVersion]);

  return state;
}

// Inventory Operational Queue, PR C (docs/specifications/inventory-
// operational-queue.md, "PR C: purpose-built, not shared with PR A --
// and why"). Reorder Request History: deterministic newest-first
// pagination over the terminal statuses (CANCELLED/VOIDED/RECEIVED/
// REJECTED) -- History only ever grows, never churns down, the exact
// opposite of useReorderRequestsByStatuses() above (unordered,
// unbounded-but-small-in-practice). Deliberately NOT onSnapshot-based,
// unlike every other hook in this file: an ordered/paginated view is
// fundamentally a pull (getDocs + cursor), not a push subscription --
// loadMore() is an imperative action with no onSnapshot equivalent, and
// History has no "must never show stale data" requirement the way an
// active work queue does (per the Specification's own "only ever grows"
// reasoning for why this hook doesn't need the live-query treatment).
//
// Depends on C0's index (`reorder_requests`: status ASC, createdAt DESC)
// already being live in production -- this hook makes no
// firestore.indexes.json change of its own, it only queries against
// what C0 deployed.
//
// Final Review correction: the real Firestore call is factored out into
// its own named, exported function (fetchReorderRequestsHistoryPage)
// rather than inlined -- this is the hook's deterministic TEST SEAM.
// Network-level interception cannot reliably force this hook into an
// error/empty state (confirmed: on pages with other onSnapshot()
// listeners already active, e.g. PartsList.jsx, this getDocs() call is
// multiplexed through the same already-open WebChannel connection, not
// issued as its own discrete, interceptable REST request). Injecting a
// replacement implementation at the hook's own boundary instead --
// `fetchPageImpl`, defaulting to the real one -- drives this EXACT hook
// and the EXACT component tree that consumes it into a real error/empty
// render, through the same state machine production traffic uses, with
// no network mocking and no component-level bypass.
export async function fetchReorderRequestsHistoryPage({ statuses, pageSize, cursor }) {
  // GOVERNED, and the page contract is unchanged. `cursor` was already OPAQUE to the hook above --
  // it round-trips whatever this returns as `lastVisible` and never inspects it -- so swapping a
  // Firestore DocumentSnapshot for the server's opaque page token is invisible to every caller.
  // Ordering (createdAt desc) and the status filter are the source's, matching this query exactly.
  // SCOPED, like the queue. A Parts Manager's history is the terminal records they personally
  // reviewed or assigned -- which is what the retired rule gave them -- not the whole business's.
  //
  // The cursor SURVIVES the migration. A scoped history is a union of three branches, and a token
  // meaning one position in one branch would normally mean nothing in the merged result -- but
  // every branch is ordered on the same key, so one position describes the whole merge. The seam
  // mints the token; this hook still treats it as opaque, exactly as it treated the Firestore
  // document snapshot it replaces.
  const outcome = await readScopedReorderRequests({
    mode: "history",
    params: { statuses },
    pageSize,
    cursor: cursor ?? undefined,
  });
  if (!outcome.ok) {
    // The hook catches and reads `err.code`, so the shape it expects is preserved rather than
    // changing this function's failure mode from throw to return.
    const err = new Error("reorder history read failed");
    err.code = outcome.result === "DENIED" ? "permission-denied" : "unknown";
    throw err;
  }
  return {
    docs: outcome.items,
    lastVisible: outcome.nextCursor,
    // `size` STILL, because the hook derives hasMore from `size === pageSize` and that heuristic is
    // deliberately left alone. The server reports an exact `hasMore` (it fetches pageSize + 1),
    // which would be strictly better -- but adopting it changes when "Load More" disappears, and
    // that is a behaviour change rather than a migration. Recorded here, not taken.
    size: outcome.items.length,
  };
}

// hasMore is inferred from whether the just-fetched page was full
// (page.length === pageSize) -- the standard Firestore cursor-pagination
// heuristic (no cheap total-count query exists); isEndOfHistory is the
// same signal, exposed under the Specification's own name for the
// "Load More is hidden or disabled, not silently absent" state.
export function useReorderRequestsHistory({ statuses, pageSize = 25, fetchPageImpl = fetchReorderRequestsHistoryPage }) {
  const [state, setState] = useState({ data: [], loading: true, error: null, hasMore: false, isEndOfHistory: false });
  const lastVisibleRef = useRef(null);
  const statusesKey = statuses.join(",");

  const fetchPage = useCallback(
    async (isLoadMore) => {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const { docs: pageDocs, lastVisible, size } = await fetchPageImpl({
          statuses,
          pageSize,
          cursor: isLoadMore ? lastVisibleRef.current : null,
        });
        lastVisibleRef.current = lastVisible ?? lastVisibleRef.current;
        const hasMore = size === pageSize;

        setState((prev) => ({
          data: isLoadMore ? [...prev.data, ...pageDocs] : pageDocs,
          loading: false,
          error: null,
          hasMore,
          isEndOfHistory: !hasMore,
        }));
      } catch (err) {
        setState((prev) => ({ ...prev, loading: false, error: err.code ?? "unknown" }));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- statusesKey is the intentional, stable proxy for `statuses` (see useReorderRequestsByStatuses() above for the identical, already-accepted pattern in this file).
    [statusesKey, pageSize, fetchPageImpl]
  );

  useEffect(() => {
    lastVisibleRef.current = null;
    fetchPage(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusesKey, pageSize, fetchPageImpl]);

  const loadMore = useCallback(() => fetchPage(true), [fetchPage]);

  return { ...state, loadMore };
}

// Issue #100 PR 1b (docs/specifications/inventory-nav-access-alignment.md,
// § "1. PARTS_MANAGER surface"). "Relevant -- not global -- History":
// two independent single-field equality queries, `reviewedBy == uid` and
// `assignedBy == uid`, each one-shot getDocs() (History has no "must
// never show stale data" requirement, same reasoning
// useReorderRequestsHistory() above already documents for the admin/
// dispatcher History view -- this is a personal, typically-small result
// set, not a live work queue), merged and de-duplicated by document id,
// then client-filtered to the four terminal statuses for display. Both
// queries are single-field equality -- no composite index, same as
// every other query in this file (§ "Firestore indexes impact").
const TERMINAL_STATUSES = new Set([
  REORDER_REQUEST_STATUS.CANCELLED,
  REORDER_REQUEST_STATUS.VOIDED,
  REORDER_REQUEST_STATUS.RECEIVED,
  REORDER_REQUEST_STATUS.REJECTED,
]);

export function useReviewedRequestsHistory(uid) {
  const [state, setState] = useState({ data: [], loading: !!uid, error: null });

  useEffect(() => {
    if (!uid) {
      setState({ data: [], loading: false, error: null });
      return;
    }

    let cancelled = false;
    setState({ data: [], loading: true, error: null });

    // STILL TWO INDEPENDENT READS, merged and de-duplicated by id exactly as before. Firestore has
    // no OR across two fields without a composite arrangement, and that has not changed by moving
    // the read server-side -- so the shape stays two queries, not one, and the client-side
    // terminal-status filter stays client-side.
    Promise.all([
      readScopedReorderRequests({ mode: "index", params: { reviewedBy: uid }, pageSize: 200 }),
      readScopedReorderRequests({ mode: "index", params: { assignedBy: uid }, pageSize: 200 }),
    ]).then(([reviewed, assigned]) => {
      if (cancelled) return;
      if (!reviewed.ok || !assigned.ok) {
        // EITHER failing fails the whole read. A merge of one successful half with one refused
        // half is a partial history presented as complete -- the exact "personal history that
        // silently omits records" this hook must not produce.
        const failed = reviewed.ok ? assigned : reviewed;
        setState({
          data: [],
          loading: false,
          error: failed.result === "DENIED" ? "permission-denied" : "unknown",
        });
        return;
      }
      const byId = new Map();
      for (const d of [...reviewed.items, ...assigned.items]) byId.set(d.id, d);
      const relevant = [...byId.values()].filter((d) => TERMINAL_STATUSES.has(d.status));
      setState({ data: relevant, loading: false, error: null });
    });

    return () => {
      cancelled = true;
    };
  }, [uid]);

  return state;
}

// Inventory Operational Queue, PR C. A second, independent function --
// NOT part of useReorderRequestsHistory() above, so a known exact id is
// always reachable regardless of loaded page/filter state (a request
// several pages back, or not yet loaded, is still directly reachable
// without "Load More"-ing through the entire history). Same
// doc()/onSnapshot() pattern useReorderRequestForPart()'s requestId
// branch already uses, above.
export function useReorderRequestById(requestId) {
  const [state, setState] = useState({ data: null, loading: !!requestId, error: null });

  useEffect(() => {
    if (!requestId) {
      setState({ data: null, loading: false, error: null });
      return;
    }

    setState({ data: null, loading: true, error: null });
    let active = true;
    readScopedReorderRequests({ mode: "index", params: { ids: [requestId] }, pageSize: 1 })
      .then((outcome) => {
        if (!active) return;
        if (!outcome.ok) {
          // "not_found" stays reserved for an empty SUCCESSFUL read. A refused or unreachable read
          // is a different fact, and collapsing them would tell a caller a request does not exist
          // when the truth is that they could not look.
          setState({
            data: null,
            loading: false,
            error: outcome.result === "DENIED" ? "permission-denied" : "unknown",
          });
          return;
        }
        const data = outcome.items[0] ?? null;
        setState(
          data
            ? { data, loading: false, error: null }
            : { data: null, loading: false, error: "not_found" },
        );
      });

    return () => {
      active = false;
    };
  }, [requestId]);

  return state;
}
