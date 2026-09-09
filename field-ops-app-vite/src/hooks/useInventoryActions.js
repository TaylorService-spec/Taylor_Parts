import { useEffect, useState } from "react";
import { governedCollectionClient } from "../access/governedCollectionClient";

// Sprint 2.1.9 -- Inventory Actions Foundation. The part's own activity history, sorted
// client-side by createdAt descending ("most recent first").
//
// WAS REALTIME, AND NO LONGER NEEDS TO BE. It subscribed via onSnapshot from the start, which was
// right when domain/inventoryActions.js could create entries. That write side was RETIRED (Owner
// ruling 2026-08-30): recordInventoryAction() now throws unconditionally, its writable store handle
// was deleted rather than left standing, and no Cloud Function creates one either.
//
// So `inventory_actions` is append-only history that nothing appends to, and a live subscription to
// a collection nothing writes observes nothing. Moving to a governed one-shot read is exact parity
// here -- measured, not assumed -- unlike hooks/useReorderRequests.js, where onSnapshot was carrying
// real cross-component refresh and needed a replacement signal. If a governed writer is ever
// introduced, that is when this needs one too.

export function useInventoryActionsForPart(partId) {
  const [state, setState] = useState({ data: [], loading: true, error: null });

  useEffect(() => {
    if (!partId) {
      setState({ data: [], loading: false, error: null });
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));
    // GOVERNED READ, resolving the EXISTING inventory.action.read server-side.
    //
    // NO REALTIME IS LOST HERE, and that was measured rather than assumed. `inventory_actions` has
    // NO WRITER: the write side was retired by Owner ruling 2026-08-30, recordInventoryAction()
    // throws unconditionally, the writable store handle was deleted rather than left standing, and
    // no Cloud Function creates one either. The collection is append-only history that nothing
    // appends to any more.
    //
    // A live subscription to a collection nothing writes observes nothing. So unlike the reorder
    // reads -- where onSnapshot was carrying real cross-component refresh and needed a replacement
    // signal -- this is exact parity, not a degradation, and it needs no invalidation mechanism.
    // If a governed writer is ever introduced, THAT is when this needs a refresh signal.
    let active = true;
    governedCollectionClient
      .readGovernedList({
        sourceId: "inventoryActionsForPart",
        filters: { partId },
        pageSize: 200,
      })
      .then((outcome) => {
        if (!active) return;
        if (outcome.ok) {
          // Sorting stays CLIENT-SIDE and unchanged: the source returns document-id order, exactly
          // what the unordered Firestore query returned, and this hook has always sorted by
          // createdAt itself. Ordering server-side would silently EXCLUDE any document missing
          // createdAt -- history quietly losing rows rather than reporting fewer.
          const actions = [...outcome.items].sort((a, b) => b.createdAt - a.createdAt);
          setState({ data: actions, loading: false, error: null });
          return;
        }
        // W2: preserve the read error so the Warehouse Manager part-activity panel can distinguish
        // a failed read from a genuinely-empty history.
        setState({
          data: [],
          loading: false,
          error: outcome.result === "DENIED" ? "permission-denied" : "unknown",
        });
      });

    return () => {
      active = false;
    };
  }, [partId]);

  return state;
}
