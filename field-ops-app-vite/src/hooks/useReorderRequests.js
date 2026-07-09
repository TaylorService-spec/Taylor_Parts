import { useCallback, useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase/firebase";
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
  const [state, setState] = useState({ data: [], loading: enabled });

  useEffect(() => {
    if (!enabled) {
      setState({ data: [], loading: false });
      return;
    }

    setState((prev) => ({ ...prev, loading: true }));
    const q = query(reorderRequestsRef, where("status", "==", status));
    const unsubscribe = onSnapshot(
      q,
      (snap) => setState({ data: toDocs(snap), loading: false }),
      () => setState({ data: [], loading: false })
    );

    return unsubscribe;
  }, [status, enabled]);

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
  const [state, setState] = useState({ data: [], loading: enabled });

  useEffect(() => {
    if (!enabled || !userId) {
      setState({ data: [], loading: false });
      return;
    }

    setState((prev) => ({ ...prev, loading: true }));
    const q = query(reorderRequestsRef, where("assignedToUserId", "==", userId), where("status", "==", status));
    const unsubscribe = onSnapshot(
      q,
      (snap) => setState({ data: toDocs(snap), loading: false }),
      () => setState({ data: [], loading: false })
    );

    return unsubscribe;
  }, [userId, status, enabled]);

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
export function useReorderRequestForPart(partId) {
  const [state, setState] = useState({ data: null, loading: true });

  useEffect(() => {
    setState((prev) => ({ ...prev, loading: true }));
    const q = query(reorderRequestsRef, where("partId", "==", partId));
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const forPart = toDocs(snap).sort((a, b) => b.createdAt - a.createdAt);
        setState({ data: forPart[0] ?? null, loading: false });
      },
      () => setState({ data: null, loading: false })
    );

    return unsubscribe;
  }, [partId]);

  const refresh = useCallback(() => {}, []);

  return { ...state, refresh };
}
