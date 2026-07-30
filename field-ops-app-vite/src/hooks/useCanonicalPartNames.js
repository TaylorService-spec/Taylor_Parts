import { useEffect, useMemo, useRef, useState } from "react";
import { fetchPartMasterList } from "../services/partMasterQueries";
import { PARTS_CATALOG } from "../data/partsCatalog";
import { resolveCanonicalPartNames } from "../domain/partsCatalogView";

// OD-3 -- governed canonical NAME resolution for the reorder-request/purchasing role
// surfaces (PartsManagerHome, PartsAssociateHome). These surfaces render NO Parts
// Catalog list; they only resolve a reorder request's partId -> display name. This
// hook does the one live canonical read and routes it through the SHARED fail-closed
// governed path (fetchPartMasterList -> composeGovernedPartsWorkspace via
// buildPartsCatalogRows -> nameBySkuFromRows, in domain/resolveCanonicalPartNames),
// passing `invalid` through so a denied/unavailable/incomplete/invalid canonical read
// fails closed. Failing closed here degrades ONLY name presentation: `resolveName`
// returns the raw partId (never the static-catalog name, never raw invalid content),
// and `namesUnavailable` is set so the caller can show a bounded inline notice. The
// caller's operational tables (reorder queue, oversight, history, purchasing) are NOT
// this hook's concern and must keep rendering regardless.
//
// Staleness guard (Owner decision #3): the canonical `parts` DATA is global, but the
// PERMISSION to read and keep displaying it is not -- a same-UID role/claims/accessVersion
// change must not leave previously loaded canonical names on screen. The effect is keyed
// on BOTH `uid` and `accessVersion` (threaded from App), so any access change re-runs the
// read and resets the name map to LOADING (prior names become unrenderable immediately,
// before the replacement read settles). A denied replacement read then degrades to raw
// partIds + the bounded notice. Each run also takes a monotonically increasing token and a
// per-run cancel flag, so a stale completion from a prior uid/accessVersion (or after
// unmount) is dropped and can never overwrite the current state.
export function useCanonicalPartNames({ uid, accessVersion } = {}) {
  const [canonicalRead, setCanonicalRead] = useState({ status: "LOADING" });
  const tokenRef = useRef(0);

  useEffect(() => {
    const token = ++tokenRef.current;
    let cancelled = false;
    // Reset to LOADING on a boundary change (uid/accessVersion) so a prior context's
    // names never linger while the fresh read is in flight.
    setCanonicalRead({ status: "LOADING" });
    fetchPartMasterList()
      .then((result) => {
        if (cancelled || token !== tokenRef.current) return;
        if (result.ok) {
          // Pass `invalid` through so the shared composer fails closed on any malformed
          // canonical document (never silently dropped) -- see partsCatalogView
          // composeGovernedPartsWorkspace step 1b.
          setCanonicalRead({ status: "OK", rows: result.parts, invalid: result.invalid });
        } else {
          setCanonicalRead({ status: result.code === "permission-denied" ? "PERMISSION_DENIED" : "UNAVAILABLE" });
        }
      })
      .catch(() => {
        if (cancelled || token !== tokenRef.current) return;
        setCanonicalRead({ status: "UNAVAILABLE" });
      });
    return () => {
      cancelled = true;
    };
  }, [uid, accessVersion]);

  const { namesReady, nameBySku } = useMemo(
    () => resolveCanonicalPartNames({ canonicalRead, staticCatalog: PARTS_CATALOG }),
    [canonicalRead]
  );

  const resolveName = useMemo(
    () => (partId) => nameBySku.get(partId) ?? partId,
    [nameBySku]
  );

  // Only signal "unavailable" once the read has SETTLED to a blocked/invalid state --
  // never during the initial LOADING window (which would flash the notice). During
  // LOADING, resolveName still safely returns the raw partId.
  const settled = canonicalRead.status !== "LOADING";
  const namesUnavailable = settled && !namesReady;

  return { resolveName, namesUnavailable };
}
