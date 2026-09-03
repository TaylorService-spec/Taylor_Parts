// usePerformanceGoals -- one bounded goal read per dashboard render, keyed by the targets the
// viewer's governed context produced.
//
// ONE CALL, NOT ONE PER TILE. Every target the dashboard will draw is asked in a single request, so
// a screen with nine goal tiles makes one round trip rather than nine. That is not only a
// performance choice: nine independent reads could return at nine different moments, and a dashboard
// that fills in one target at a time reads as though the numbers are still being decided.
//
// The result is indexed by (metricId, scopeType, scopeId) so a tile can look up its own answer
// without knowing the order of the request.

import { useEffect, useMemo, useRef, useState } from "react";
import { fetchCurrentPerformanceGoals } from "../services/performanceGoalClient.js";

export const GOAL_FEED_STATUS = Object.freeze({
  IDLE: "IDLE",
  LOADING: "LOADING",
  READY: "READY",
  DENIED: "DENIED",
  UNAVAILABLE: "UNAVAILABLE",
});

export function goalKey(metricId, targetScopeType, targetScopeId) {
  return `${metricId}::${targetScopeType}::${targetScopeId ?? ""}`;
}

/**
 * @param targets from domain/dashboardComposition.js `goalTargetsFor(ctx)`.
 * @param onDate  ISO date the targets are resolved as of. The CALLER owns the clock.
 */
export function usePerformanceGoals(targets, onDate) {
  const [state, setState] = useState({ status: GOAL_FEED_STATUS.IDLE, byKey: new Map() });

  // The request identity, so a re-render with an equivalent target list does not refetch. Targets
  // are rebuilt on every render by goalTargetsFor(); comparing their CONTENT rather than their
  // reference is what stops that from becoming a request loop.
  const signature = useMemo(
    () => (Array.isArray(targets) ? targets.map((t) => goalKey(t.metricId, t.targetScopeType, t.targetScopeId)).sort().join("|") : ""),
    [targets],
  );

  const latest = useRef(0);

  useEffect(() => {
    if (!signature || !onDate) {
      setState({ status: GOAL_FEED_STATUS.IDLE, byKey: new Map() });
      return undefined;
    }
    const requestId = ++latest.current;
    let cancelled = false;
    setState((prev) => ({ ...prev, status: GOAL_FEED_STATUS.LOADING }));

    (async () => {
      const { result, errorStatus } = await fetchCurrentPerformanceGoals(targets, onDate);
      // Two guards, and they are not the same guard: `cancelled` handles unmount, `requestId` handles
      // an out-of-order response from a superseded request. Without the second, a slow first request
      // can land after a fast second one and overwrite fresher data with staler data.
      if (cancelled || requestId !== latest.current) return;

      if (errorStatus) {
        setState({
          status: errorStatus === "denied" ? GOAL_FEED_STATUS.DENIED : GOAL_FEED_STATUS.UNAVAILABLE,
          byKey: new Map(),
        });
        return;
      }
      const byKey = new Map();
      for (const r of result?.results ?? []) {
        byKey.set(goalKey(r.metricId, r.targetScopeType, r.targetScopeId), r);
      }
      setState({ status: GOAL_FEED_STATUS.READY, byKey });
    })();

    return () => { cancelled = true; };
    // `targets` is deliberately absent: `signature` is its content-identity, and depending on the
    // array itself would refetch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, onDate]);

  return state;
}
