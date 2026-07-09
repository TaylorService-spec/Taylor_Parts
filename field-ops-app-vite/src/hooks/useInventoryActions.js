import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { INVENTORY_ACTIONS_COLLECTION } from "../domain/constants";

// Sprint 2.1.9 -- Inventory Actions Foundation. Realtime from the
// start (not a one-shot read that would need the same fix
// hooks/useReorderRequests.js needed post-2.1.7) -- subscribes via
// onSnapshot(), server-side query-filtered with where("partId", ...),
// same pattern as useReorderRequests.js/subscribeAssignedWorkOrders().
// Sorted client-side by createdAt descending ("most recent first"),
// same as useReorderRequestForPart()'s sort. Read-only: writes go
// exclusively through domain/inventoryActions.js's
// recordInventoryAction().
const inventoryActionsRef = collection(db, INVENTORY_ACTIONS_COLLECTION);

export function useInventoryActionsForPart(partId) {
  const [state, setState] = useState({ data: [], loading: true });

  useEffect(() => {
    if (!partId) {
      setState({ data: [], loading: false });
      return;
    }

    setState((prev) => ({ ...prev, loading: true }));
    const q = query(inventoryActionsRef, where("partId", "==", partId));
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const actions = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => b.createdAt - a.createdAt);
        setState({ data: actions, loading: false });
      },
      () => setState({ data: [], loading: false })
    );

    return unsubscribe;
  }, [partId]);

  return state;
}
