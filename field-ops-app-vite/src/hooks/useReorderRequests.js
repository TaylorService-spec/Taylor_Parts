import { useCallback, useEffect, useState } from "react";
import { reorderRequestsStore } from "../domain/inventoryReorderRequests";
import { REORDER_REQUEST_STATUS } from "../domain/constants";

// Sprint 2.1.3 -- Reorder Request & Notification Foundation. One-shot
// read (reorderRequestsStore.list(), same list()-then-filter pattern
// already used elsewhere in this app -- no new Firestore query shape),
// filtered client-side to PENDING_REVIEW only. Shared by PartsList.jsx
// (to know which Parts already have a pending request) and
// AppHeader.jsx's NotificationPanel (to list them) -- one read
// implementation, not two. Naturally excludes requests once reviewed
// (Sprint 2.1.4) since they no longer have status PENDING_REVIEW --
// satisfies "remove completed requests from the Notification Panel"
// without any extra filtering logic.
//
// `enabled` lets a caller skip the read entirely for a role that has no
// firestore.rules read access (technician) -- avoids an unnecessary
// permission-denied console error rather than fetching and discarding.
export function useReorderRequests(enabled = true) {
  const [state, setState] = useState({ data: [], loading: enabled });

  useEffect(() => {
    if (!enabled) {
      setState({ data: [], loading: false });
      return;
    }

    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true }));

    reorderRequestsStore
      .list()
      .then((all) => {
        if (cancelled) return;
        setState({
          data: all.filter((r) => r.status === REORDER_REQUEST_STATUS.PENDING_REVIEW),
          loading: false,
        });
      })
      .catch(() => {
        if (!cancelled) setState({ data: [], loading: false });
      });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return state;
}

// Sprint 2.1.4 -- Reorder Review & Decision. Unlike useReorderRequests()
// above, this returns the MOST RECENT Reorder Request for one Part
// regardless of status -- PartDetail.jsx needs to show a pending
// request's review actions AND an already-decided request's outcome
// (status/reviewDecision/reviewNotes), not just pending ones. `refresh`
// lets the caller re-read after submitting a review, so PartDetail
// shows the updated status immediately without a full page reload.
export function useReorderRequestForPart(partId) {
  const [state, setState] = useState({ data: null, loading: true });
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true }));

    reorderRequestsStore
      .list()
      .then((all) => {
        if (cancelled) return;
        const forPart = all.filter((r) => r.partId === partId).sort((a, b) => b.createdAt - a.createdAt);
        setState({ data: forPart[0] ?? null, loading: false });
      })
      .catch(() => {
        if (!cancelled) setState({ data: null, loading: false });
      });

    return () => {
      cancelled = true;
    };
  }, [partId, refreshToken]);

  const refresh = useCallback(() => setRefreshToken((token) => token + 1), []);

  return { ...state, refresh };
}
