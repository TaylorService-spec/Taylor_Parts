import { useEffect, useState } from "react";
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
// `source()` is called EXACTLY ONCE per mount (captured via a lazy useState initializer, never re-invoked on
// re-render) and may return either a plain snapshot object (the synthetic source — fully synchronous, no
// microtask, matching every existing test's render()-then-assert shape) or a Promise (governedOpportunitySource,
// which awaits a httpsCallable) — detected by duck-typing `.then`. The sync path returns real data on the
// very first render; the async path returns an honest `loading: true` until the promise settles.
export function useOpportunities(source = DEFAULT_OPPORTUNITY_SOURCE) {
  const [raw] = useState(() => source());
  const isAsync = raw != null && typeof raw.then === "function";
  const [resolved, setResolved] = useState(null); // { ok: boolean, snap } once an async source settles

  useEffect(() => {
    if (!isAsync) return undefined;
    let cancelled = false;
    raw
      .then((snap) => {
        if (!cancelled) setResolved({ ok: true, snap });
      })
      .catch(() => {
        if (!cancelled) setResolved({ ok: false, snap: UNAVAILABLE_SNAP });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `raw` is the ONE promise captured at mount;
    // `source` itself is not expected to change identity across this hook's real call sites.
  }, [isAsync]);

  if (!isAsync) return toState(raw, false);
  if (resolved === null) return toState(UNAVAILABLE_SNAP, true);
  return toState(resolved.snap, false);
}
