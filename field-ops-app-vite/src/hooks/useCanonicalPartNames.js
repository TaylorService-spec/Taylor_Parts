import { useEffect, useMemo, useRef, useState } from "react";
import { fetchPartMasterList } from "../services/partMasterQueries";
import { PARTS_CATALOG } from "../data/partsCatalog";
import { resolveCanonicalPartNames, partNamesBoundaryKey, selectCanonicalReadForKey } from "../domain/partsCatalogView";

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
// Staleness guard (Owner decision #3; Codex P1/P2): the canonical `parts` DATA is global,
// but the PERMISSION to read and keep displaying it is not -- a same-UID role/claims/
// accessVersion change must not leave previously loaded canonical names on screen, not even
// for one render/paint. We store the read TAGGED with the boundary key (uid + accessVersion)
// it was produced under, and during render we select it ONLY when its key matches the
// current render's boundary key (partNamesBoundaryKey / selectCanonicalReadForKey). On any
// mismatch the selection is LOADING SYNCHRONOUSLY on that same render -- so when accessVersion
// changes, the prior name map is gone on the first render under the new boundary, before the
// effect runs. The effect (keyed on the boundary key) then issues the replacement read; its
// result is stored under the new key. A monotonically increasing token + per-run cancel flag
// mean a stale completion from a prior boundary (or after unmount) is dropped, and even if it
// weren't, its stored key would no longer match the current render key.
// `enabled` (default true): when false, NO canonical read is issued -- for callers that must
// not read `parts` unless the surface is authorized (e.g. AppHeader only reads for a role that
// can see reorder notifications; a technician never triggers a permission-denied read). While
// disabled, resolveName fails closed to the raw partId exactly as under any BLOCKED read.
export function useCanonicalPartNames({ uid, accessVersion, enabled = true } = {}) {
  const currentKey = partNamesBoundaryKey(uid, accessVersion);
  const [stored, setStored] = useState({ key: currentKey, read: { status: "LOADING" } });
  const tokenRef = useRef(0);

  useEffect(() => {
    // Bump the token unconditionally so any prior boundary's in-flight read is staled even when
    // we now skip reading (e.g. access just dropped).
    const token = ++tokenRef.current;
    if (!enabled) return undefined; // no read issued
    let cancelled = false;
    // Mark this boundary's read as LOADING (keyed) so an in-flight read is attributed to the
    // current boundary and never confused with a prior one.
    setStored({ key: currentKey, read: { status: "LOADING" } });
    fetchPartMasterList()
      .then((result) => {
        if (cancelled || token !== tokenRef.current) return;
        // Pass `invalid` through so the shared composer fails closed on any malformed
        // canonical document (never silently dropped) -- see partsCatalogView
        // composeGovernedPartsWorkspace step 1b.
        const read = result.ok
          ? { status: "OK", rows: result.parts, invalid: result.invalid }
          : { status: result.code === "permission-denied" ? "PERMISSION_DENIED" : "UNAVAILABLE" };
        setStored({ key: currentKey, read });
      })
      .catch(() => {
        if (cancelled || token !== tokenRef.current) return;
        setStored({ key: currentKey, read: { status: "UNAVAILABLE" } });
      });
    return () => {
      cancelled = true;
    };
  }, [currentKey, enabled]);

  // Render-time key match -- old-boundary data is never used, synchronously. When disabled we
  // never present a name map (LOADING -> empty map -> resolveName degrades to the raw partId).
  const canonicalRead = enabled ? selectCanonicalReadForKey(stored, currentKey) : { status: "LOADING" };

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
