import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { INVENTORY_ACTIONS_COLLECTION } from "../domain/constants";
import { INVENTORY_ACTIONS_UNAVAILABLE } from "../domain/inventoryActionsAvailability.js";
import { EOS_SESSION_SOURCE } from "../access/eosSessionSource.js";
import { boundedRead, READ_TIMEOUT_MS } from "../access/boundedRead.js";
import { readArchivedNotes } from "../services/legacyInventoryNotesClient.js";

// FIREBASE EXIT B3 (DECISIONS #B3; Owner ruling 8): WHICH SOURCE ANSWERS is decided once at BUILD time by the F1 flag. Where an EOS API is
// declared the notes come from the READ-ONLY EOS ARCHIVE (eos_ops.legacy_inventory_action_notes, listLegacyInventoryActionNotes,
// inventory.action.read) -- never Firestore, so the build makes no Firebase request. Everywhere else the frozen Firestore collection is the sole
// source, exactly as before. The notes are ARCHIVED EVIDENCE of what was once recorded, never current facts and never stock movements; the
// archive is empty until an Owner-authorized copy loads it (the copy is HELD), and `archiveLoaded` is how a screen tells "nothing has been
// archived here" from "this Part has no archived notes".

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
function useInventoryActionsFromFirestore(partId) {
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

function useArchivedInventoryActionNotes(partId) {
  const [state, setState] = useState({ partId, data: [], loading: Boolean(partId), error: null, archiveLoaded: null });

  useEffect(() => {
    if (!partId) { setState({ partId, data: [], loading: false, error: null, archiveLoaded: null }); return undefined; }
    let cancelled = false;
    setState({ partId, data: [], loading: true, error: null, archiveLoaded: null });
    // BOUNDED: a read that never answers settles as an error, never an infinite "Loading".
    boundedRead(
      (signal) => readArchivedNotes(partId, { signal }).then((ok) => ({ ok: true, ...ok }), (err) => ({ ok: false, error: err?.code ?? "unknown" })),
      READ_TIMEOUT_MS,
      { ok: false, error: "UNREACHABLE" },
    ).then((answer) => {
      if (cancelled) return;
      setState(answer.ok
        ? { partId, data: answer.rows, loading: false, error: null, archiveLoaded: answer.archiveLoaded }
        : { partId, data: [], loading: false, error: answer.error, archiveLoaded: null });
    });
    return () => { cancelled = true; };
  }, [partId]);

  // A different Part never sees the previous Part's answer, not even for the render before the new read starts.
  return state.partId === partId ? state : { partId, data: [], loading: Boolean(partId), error: null, archiveLoaded: null };
}

export const useInventoryActionsForPart = EOS_SESSION_SOURCE ? useArchivedInventoryActionNotes : useInventoryActionsFromFirestore;
