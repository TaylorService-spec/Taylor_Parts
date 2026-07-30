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
// Staleness guard (Owner decision #3): the canonical `parts` read is GLOBAL catalog
// data -- identical for every authorized viewer, not scoped to a user, access version,
// or a specific request -- so a late resolve cannot present access-inappropriate data;
// a revoked read simply returns PERMISSION_DENIED and degrades to partIds. Even so, we
// never let a stale async result apply: each run takes a monotonically increasing token
// and a per-run cancel flag, so only the latest in-flight read for the current mount is
// applied, and a resolve after unmount or after `uid` changes is dropped. The optional
// `accessVersion` is included in the reset key so that if a caller ever threads it, an
// access-version change re-runs the read as well.
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
