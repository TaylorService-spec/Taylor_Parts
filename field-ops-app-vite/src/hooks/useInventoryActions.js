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
//
// THE COLLECTION REFERENCE IS MADE INSIDE THE HOOK, never at module scope (Firebase exit B2). In an EOS-only sign-in build
// `db` is null (the Firebase module is aliased to an inert stand-in), and `collection(null, ...)` THROWS: at module scope
// that threw while the lazy screen chunk evaluated, taking the whole Part Detail / Warehouse Manager screen into the route
// boundary. Here a null `db` is a settled read state instead, and only the legacy-notes panel says so.
export const INVENTORY_ACTIONS_UNAVAILABLE = "unavailable-in-this-build";

export function useInventoryActionsForPart(partId) {
  const [state, setState] = useState({ data: [], loading: true, error: null });

  useEffect(() => {
    if (!partId) {
      setState({ data: [], loading: false, error: null });
      return;
    }

    if (!db) {
      setState({ data: [], loading: false, error: INVENTORY_ACTIONS_UNAVAILABLE });
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));
    const q = query(collection(db, INVENTORY_ACTIONS_COLLECTION), where("partId", "==", partId));
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const actions = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => b.createdAt - a.createdAt);
        setState({ data: actions, loading: false, error: null });
      },
      // W2: preserve the read error so the Warehouse Manager part-activity
      // panel can distinguish a failed read from a genuinely-empty history.
      (err) => setState({ data: [], loading: false, error: err.code ?? "unknown" })
    );

    return unsubscribe;
  }, [partId]);

  return state;
}
