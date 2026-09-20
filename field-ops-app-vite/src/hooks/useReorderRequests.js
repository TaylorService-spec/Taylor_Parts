import { useCallback, useEffect, useRef, useState } from "react";
import { collection, doc, getDocs, limit, onSnapshot, orderBy, query, startAfter, where } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { reorderApiClient } from "../services/reorderApiClient.js";
import { REORDER_REQUESTS_COLLECTION, REORDER_REQUEST_STATUS } from "../domain/constants";

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
// firestore.rules' reorder_requests read rule (`allow read: if
// isAdminOrDispatcher();`) is unconditional on document fields, so it
// already supports any query shape (get or list) -- no rule change
// needed. Firestore also doesn't require a composite index for
// queries using only `==` filters (even multiple, as in
// useReorderRequestsAssignedTo below) -- only range/orderBy
// combinations do -- so no firestore.indexes.json change either.
//
// Writes still go exclusively through domain/inventoryReorderRequests.js
// (createReorderRequest/reviewReorderRequest/assignReorderRequest/
// startPurchasing) -- nothing here writes, only reads.
const reorderRequestsRef = collection(db, REORDER_REQUESTS_COLLECTION);

function toDocs(snap) {
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

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

  useEffect(() => {
    if (!enabled) {
      setState({ data: [], loading: false, error: null });
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));
    const q = query(reorderRequestsRef, where("status", "==", status));
    const unsubscribe = onSnapshot(
      q,
      (snap) => setState({ data: toDocs(snap), loading: false, error: null }),
      // W2: preserve the read error instead of swallowing it, so consumers can
      // distinguish a failed read from a genuinely-empty result (mirrors
      // useReorderRequestsByStatuses). err.code is the Firestore SDK error code.
      (err) => setState({ data: [], loading: false, error: err.code ?? "unknown" })
    );

    return unsubscribe;
  }, [status, enabled]);

  return state;
}

// ════════════════════ "MY ASSIGNED WORK", AFTER THE REORDER DOMAIN CUTOVER ════════════════════
//
// This was `where("assignedToUserId", "==", userId)` -- a Firestore query scoped by a FIREBASE UID.
// A uid is not an Employee, so that filter was only ever right by coincidence of provisioning, and
// it could not be right at all for an Employee whose login was re-provisioned.
//
// It now asks the governed PostgreSQL authority instead. The server resolves the CALLER to an
// Employee through an active employee_principal_link and scopes the read by the governed assignment;
// the browser no longer states, or knows, whose work it is asking for. There is deliberately no
// userId parameter: a caller that could name someone else's work is a caller that could read it.
//
// A Principal with no active Employee link gets an empty list, which is the honest answer rather
// than an error -- an unlinked Principal is not an Employee and has no assigned work.
//
// NOT A LIVE SUBSCRIPTION. The Firestore onSnapshot listener is gone with the Firestore read; this
// fetches once per (status, enabled) change. The screens using it already render a loading and an
// error state, and a stale queue is a smaller problem than a queue scoped by the wrong identity.
export function useMyAssignedReorderRequests(status, enabled = true, deps = {}) {
  // The client is an INJECTION SEAM, not reactive state. Holding it in a ref keeps it out of the
  // effect's dependencies: a caller that passes an inline `{ client }` object would otherwise hand
  // this a new identity on every render, and the effect would re-read, re-render and re-read again.
  const clientRef = useRef(deps.client ?? reorderApiClient);
  clientRef.current = deps.client ?? reorderApiClient;
  const [state, setState] = useState({ data: [], loading: enabled, error: null });

  useEffect(() => {
    if (!enabled) {
      setState({ data: [], loading: false, error: null });
      return undefined;
    }
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    clientRef.current.call("readMyAssignedReorders")
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          // The refusal is preserved, not flattened: "you hold no capability" and "the service is
          // unreachable" are different answers and the screen renders them differently.
          setState({ data: [], loading: false, error: res.reason ?? res.code });
          return;
        }
        const all = Array.isArray(res.result) ? res.result : [];
        setState({ data: status ? all.filter((r) => r.status === status) : all, loading: false, error: null });
      })
      .catch(() => { if (!cancelled) setState({ data: [], loading: false, error: "unknown" }); });
    return () => { cancelled = true; };
  }, [status, enabled]);

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
      const ref = doc(db, REORDER_REQUESTS_COLLECTION, requestId);
      const unsubscribe = onSnapshot(
        ref,
        (snap) => {
          if (!snap.exists()) {
            setState({ data: null, loading: false, error: "not_found" });
            return;
          }
          const data = { id: snap.id, ...snap.data() };
          if (data.partId !== partId) {
            setState({ data: null, loading: false, error: "mismatch" });
            return;
          }
          setState({ data, loading: false, error: null });
        },
        // Site-work r4 C, Fix 2: preserve the real read error (mirrors
        // useReorderRequestById/useReorderRequestsByStatus above) instead of
        // discarding it into "not_found" -- a denied/failed read is not the same
        // fact as "this document does not exist", and a caller (PartDetail.jsx)
        // needs to tell them apart. "not_found" now only ever comes from the
        // snap.exists() check above, never from this error callback.
        (err) => setState({ data: null, loading: false, error: err.code ?? "unknown" })
      );

      return unsubscribe;
    }

    const q = query(reorderRequestsRef, where("partId", "==", partId));
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const forPart = toDocs(snap).sort((a, b) => b.createdAt - a.createdAt);
        setState({ data: forPart[0] ?? null, loading: false, error: null });
      },
      // Site-work r4 C, Fix 2: preserve the real read error instead of discarding
      // it to null -- a failed read on the no-requestId (most-recent-for-part)
      // path used to render identically to "no request exists yet", hiding a
      // denied/unavailable read from the caller.
      (err) => setState({ data: null, loading: false, error: err.code ?? "unknown" })
    );

    return unsubscribe;
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

  useEffect(() => {
    if (!enabled || !statuses?.length) {
      setState({ data: [], loading: false, error: null });
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));
    const q = query(reorderRequestsRef, where("status", "in", statuses));
    const unsubscribe = onSnapshot(
      q,
      (snap) => setState({ data: toDocs(snap), loading: false, error: null }),
      (err) => setState({ data: [], loading: false, error: err.code ?? "unknown" })
    );

    return unsubscribe;
  }, [statuses.join(","), enabled]);

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
  const constraints = [where("status", "in", statuses), orderBy("createdAt", "desc"), limit(pageSize)];
  if (cursor) constraints.push(startAfter(cursor));
  const snap = await getDocs(query(reorderRequestsRef, ...constraints));
  return {
    docs: toDocs(snap),
    lastVisible: snap.docs.length ? snap.docs[snap.docs.length - 1] : null,
    size: snap.docs.length,
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

    Promise.all([
      getDocs(query(reorderRequestsRef, where("reviewedBy", "==", uid))),
      getDocs(query(reorderRequestsRef, where("assignedBy", "==", uid))),
    ])
      .then(([reviewedSnap, assignedSnap]) => {
        if (cancelled) return;
        const byId = new Map();
        for (const d of [...toDocs(reviewedSnap), ...toDocs(assignedSnap)]) byId.set(d.id, d);
        const relevant = [...byId.values()].filter((d) => TERMINAL_STATUSES.has(d.status));
        setState({ data: relevant, loading: false, error: null });
      })
      .catch((err) => {
        if (!cancelled) setState({ data: [], loading: false, error: err.code ?? "unknown" });
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
    const ref = doc(db, REORDER_REQUESTS_COLLECTION, requestId);
    const unsubscribe = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setState({ data: null, loading: false, error: "not_found" });
          return;
        }
        setState({ data: { id: snap.id, ...snap.data() }, loading: false, error: null });
      },
      (err) => setState({ data: null, loading: false, error: err.code ?? "unknown" })
    );

    return unsubscribe;
  }, [requestId]);

  return state;
}
