import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_OPPORTUNITY_SOURCE } from "../access/opportunitySource.js";

const UNAVAILABLE_SNAP = { opportunities: [], accountNameById: {}, status: "unavailable", error: null };

function toState(snap, loading) {
  return {
    opportunities: snap?.opportunities ?? [],
    accountNameById: snap?.accountNameById ?? {},
    status: snap?.status ?? "unavailable",
    loading,
    error: snap?.error ?? null,
  };
}

// React adapter over the Opportunity SOURCE seam (access/opportunitySource.js). The workspace consumes THIS
// hook and never touches the source directly, so swapping the synthetic source for a governed callable read
// is a one-line change at the CALL SITE (pass a different `source`) — no component edit here. `source` is
// injectable purely so tests (and the governed source) can substitute a snapshot; production's real mount
// (App.jsx) passes governedOpportunitySource explicitly.
//
// `source()` is called EXACTLY ONCE per mount on the FIRST render (captured via a lazy useState
// initializer, never re-invoked on re-render or when `source`'s identity changes) and may return either a
// plain snapshot object (the synthetic source — fully synchronous, no microtask, matching every existing
// test's render()-then-assert shape) or a Promise (governedOpportunitySource, which awaits a httpsCallable)
// — detected by duck-typing `.then`. The sync path returns real data on the very first render; the async
// path returns an honest `loading: true` until the promise settles.
//
// `refetch()` (added for the Opportunity write path — Cycle 3b create/transition) re-invokes `source()`
// fresh and replaces the whole snapshot with whatever it returns. This is the ONLY refresh mechanism: after
// a successful createOpportunity/transitionOpportunity, the caller calls refetch() and re-derives the
// pipeline from the AUTHORITATIVE re-read — nothing here (or upstream) ever fabricates/patches a row
// client-side from a command's result. `source` is read through a ref at refetch time so a refetch always
// uses the CURRENT `source` prop, matching how the initial call already behaves at mount.
export function useOpportunities(source = DEFAULT_OPPORTUNITY_SOURCE) {
  const sourceRef = useRef(source);
  sourceRef.current = source;

  const [raw] = useState(() => source()); // the one-shot mount call, unchanged from before refetch existed
  const rawIsAsync = raw != null && typeof raw.then === "function";

  const [snap, setSnap] = useState(() => (rawIsAsync ? null : raw));
  const [loading, setLoading] = useState(rawIsAsync);
  // Bumped by refetch() to force a fresh call; 0 means "still on the mount call captured in `raw`".
  const [refetchGeneration, setRefetchGeneration] = useState(0);

  // Settle the INITIAL (mount) call, if it was async. Runs once — refetches are handled by the effect below.
  useEffect(() => {
    if (!rawIsAsync) return undefined;
    let cancelled = false;
    raw
      .then((s) => {
        if (!cancelled) {
          setSnap(s);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSnap(UNAVAILABLE_SNAP);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `raw` is the ONE promise captured at mount.
  }, [rawIsAsync]);

  // A refetch: re-invoke source() fresh and replace the snapshot with the authoritative result, sync or
  // async. Guarded so the mount generation (0) never double-fires this in addition to the effect above.
  useEffect(() => {
    if (refetchGeneration === 0) return undefined;
    let cancelled = false;
    setLoading(true);
    const result = sourceRef.current();
    if (result != null && typeof result.then === "function") {
      result
        .then((s) => {
          if (!cancelled) {
            setSnap(s);
            setLoading(false);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setSnap(UNAVAILABLE_SNAP);
            setLoading(false);
          }
        });
    } else {
      setSnap(result);
      setLoading(false);
    }
    return () => {
      cancelled = true;
    };
  }, [refetchGeneration]);

  const refetch = useCallback(() => setRefetchGeneration((n) => n + 1), []);

  return { ...toState(snap, loading), refetch };
}
