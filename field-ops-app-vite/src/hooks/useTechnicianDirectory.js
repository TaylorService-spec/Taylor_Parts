import { useCallback, useEffect, useRef, useState } from "react";
import { governedCollectionClient } from "../access/governedCollectionClient";
import { subscribeToTechnicianDirectoryChange } from "../domain/technicianDirectoryChanged.js";

// The technician directory, for the operations and dispatch surfaces.
//
// ════════════════════ REALTIME PARITY, STATED HONESTLY ════════════════════
//
//   old  Firestore push (onSnapshot on fieldops_technicians)
//   new  automatic governed refresh, bounded <= 5 seconds
//
// This IS a behaviour change and is written down as one. It is not byte-for-byte parity and must
// never be described as such: an update that used to arrive in milliseconds now arrives within five
// seconds. What the observable requirement actually demands is preserved -- a dispatcher with an
// open board sees a technician become AVAILABLE without reloading the browser -- and Dispatch.jsx's
// assignable-technician filter (`t.status === AVAILABLE`) is the surface that requires it.
//
// WHY POLLING AND NOT A PUSH CHANNEL. A governed callable cannot stream, and the alternatives (SSE,
// WebSockets, a second Firebase data channel) are realtime INFRASTRUCTURE -- a standing commitment
// far larger than the one screen behaviour that needs it. Bounded polling is the smallest mechanism
// that satisfies the requirement, and it carries no new transport, no new authority and no new
// deployment surface: it is the same governed read, repeated.
//
// COST IS BOUNDED DELIBERATELY. The interval is suspended while the document is hidden, so a
// forgotten background tab costs nothing; it resumes -- with an immediate read, not after another
// full interval -- when the tab is shown or the window is focused again.
const POLL_MS = 5000;
const SOURCE_ID = "technicianDirectory";

/**
 * @param enabled  Defaults true, matching the hook this replaces. Disabled is IDLE, never empty:
 *                 `data` stays [] with `loading` false, so a caller that reads "no rows" as "none
 *                 exist" would be wrong -- which is why the composition layer asks for this only
 *                 where the scope resolves.
 */
export function useTechnicianDirectory(enabled = true) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(null);

  // The last GOOD directory. A failed refresh must not erase a directory the dispatcher is
  // currently working from and replace it with an empty list -- that would read as "no technicians
  // exist", which is a claim about the business rather than about the network. On failure the rows
  // stay and the error is surfaced beside them.
  const lastGoodRef = useRef([]);
  const activeRef = useRef(true);

  const fetchNow = useCallback(async () => {
    const page = await governedCollectionClient.readGovernedList({ sourceId: SOURCE_ID, pageSize: 200 });
    if (!activeRef.current) return;
    if (!page.ok) {
      // Keep the last good rows. `error` is what tells a caller the list may be stale.
      setData(lastGoodRef.current);
      setError(new Error(page.result));
      setLoading(false);
      return;
    }
    lastGoodRef.current = page.items;
    setData(page.items);
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setData([]);
      setError(null);
      setLoading(false);
      return undefined;
    }

    activeRef.current = true;
    setLoading(true);
    setError(null);
    lastGoodRef.current = [];

    // Immediately on mount, then on the interval.
    fetchNow();

    let timer = null;
    const startPolling = () => {
      if (timer === null) timer = setInterval(fetchNow, POLL_MS);
    };
    const stopPolling = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    const onVisibility = () => {
      if (document.hidden) {
        stopPolling();
        return;
      }
      // Returning to a tab reads IMMEDIATELY rather than waiting out another interval -- the whole
      // point is that a dispatcher who comes back to the board is not looking at stale rows.
      fetchNow();
      startPolling();
    };
    const onFocus = () => {
      fetchNow();
      startPolling();
    };

    if (!document.hidden) startPolling();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    // A same-session technician mutation (creating one today) refreshes immediately rather than
    // waiting for the next tick.
    const unsubscribeChange = subscribeToTechnicianDirectoryChange(fetchNow);

    return () => {
      activeRef.current = false;
      stopPolling();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      unsubscribeChange();
    };
  }, [enabled, fetchNow]);

  return { data, loading, error };
}
