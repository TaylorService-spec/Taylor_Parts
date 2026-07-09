import { useEffect, useState } from "react";
import { reorderRequestsStore } from "../domain/inventoryReorderRequests";
import { REORDER_REQUEST_STATUS } from "../domain/constants";

// Sprint 2.1.3 -- Reorder Request & Notification Foundation. One-shot
// read (reorderRequestsStore.list(), same list()-then-filter pattern
// already used elsewhere in this app -- no new Firestore query shape),
// filtered client-side to PENDING_REVIEW only. Shared by PartsList.jsx
// (to know which Parts already have a pending request) and
// AppHeader.jsx's NotificationPanel (to list them) -- one read
// implementation, not two.
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
