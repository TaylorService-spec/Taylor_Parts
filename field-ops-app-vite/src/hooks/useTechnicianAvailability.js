import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { readTechnicianAvailability } from "../services/schedulingCommandClient.js";

// The board's ONLY source of technician working hours and blocked time.
//
// ════════════════════ WHY A CALLABLE AND NOT A SUBSCRIPTION ════════════════════
//
// `technician_working_availability` and `technician_blocked_time` DENY CLIENT READS -- deployed, and
// proved live by the Scheduling Functional Gate (a dispatcher's own ID token gets 403 on both). There
// is no onSnapshot to attach, and adding one would fail closed and look like a bug.
//
// So availability is a windowed READ, refreshed when the window changes, while Work Orders stay on
// their existing live subscription (useWorkOrders). That split is deliberate and worth being precise
// about, because it decides what the board is honest about:
//
//   PLACEMENTS are live. A colleague scheduling a job appears without a refresh.
//   AVAILABILITY is a snapshot. A shift edited elsewhere while this board is open is not seen until
//   the window changes or a placement command completes.
//
// The second is acceptable in a way the first would not be: working hours change on the order of
// weeks, placements change on the order of minutes, and every placement is validated against
// availability BY THE SERVER regardless of what this board is displaying. A stale shift line can
// mislead a dispatcher's planning; it cannot produce a bad commit.
//
// `refresh()` is exposed so a completed placement can re-read -- a command that just consumed
// capacity should not leave the lane reporting the capacity it had a moment ago.
//
// ════════════════════ ABSENT IS NOT EMPTY ════════════════════
//
// A technician with no record comes back `workingAvailability: null` / `availableMinutes: null`. This
// hook passes that through UNTOUCHED -- no `?? 0`, no `|| {}`, no default row. Consumers branch on
// null. See domain/dispatchBoardGeometry.js for why a 0% here would be a lie about the business.
export function useTechnicianAvailability({ startMillis, endMillis, technicianIds, enabled = true }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(Boolean(enabled));
  const [error, setError] = useState(null);

  // The id list is an array literal at most call sites, so it would be a new reference every render
  // and re-fire the effect forever. Keyed on its content instead.
  const idKey = useMemo(
    () => (Array.isArray(technicianIds) ? [...technicianIds].sort().join(",") : ""),
    [technicianIds],
  );

  // Guards against a slow earlier response overwriting a newer one when the dispatcher moves through
  // days quickly -- last request wins, not last response.
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    if (!enabled || startMillis == null || endMillis == null) return;
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    setLoading(true);

    const ids = idKey ? idKey.split(",") : undefined;
    const res = await readTechnicianAvailability({ startMillis, endMillis, technicianIds: ids });
    if (requestSeq.current !== seq) return;

    if (res.errorStatus) {
      // The technician read failing is its OWN state (artifact 1c) -- never folded into the Work
      // Order read's failure, and never rendered as "no technicians exist yet".
      setError({ status: res.errorStatus, code: res.errorCode ?? null });
      setData(null);
    } else {
      setError(null);
      setData(res.result ?? null);
    }
    setLoading(false);
  }, [enabled, startMillis, endMillis, idKey]);

  useEffect(() => {
    load();
  }, [load]);

  /** Availability keyed by technician id, for the lane renderers. Absent id = absent record. */
  const byTechnicianId = useMemo(() => {
    const map = new Map();
    for (const view of data?.technicians ?? []) map.set(view.technicianId, view);
    return map;
  }, [data]);

  return { data, byTechnicianId, loading, error, refresh: load };
}
