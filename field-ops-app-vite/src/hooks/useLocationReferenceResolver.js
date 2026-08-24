import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, documentId, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { LOCATIONS_COLLECTION } from "../domain/constants";
import { REFERENCE_STATE } from "../metadata/referenceResolution.js";

// RESOLVE LOCATION REFERENCES FOR A METADATA LIST, IN ONE BATCHED READ.
//
// The sibling of useAccountReferenceResolver, for the other reference every operational
// list carries. Same contract, same reporting, same batching — a separate hook rather than
// a `collectionName` parameter on that one, because the two differ in the part that
// matters: an Account's display name is `name` and always present, while a Location may be
// named by any of several fields and legitimately by none at all (see pickLocationName).
// Folding them together would mean one of the two entities getting a fallback written for
// the other.
//
// ONE READ FOR THE PAGE, NOT ONE PER ROW. Ids are collected from the loaded rows and read
// with chunked `documentId() in` queries. Resolving inside a cell renderer would issue a
// read per row, which the presentation contract rules out by name.
//
// IT REPORTS WHY, NOT JUST THAT:
//
//   LOADING  → the answer has not arrived. Not "missing".
//   DENIED   → this viewer may not read locations. Says NOTHING about whether the site
//              exists, and the rendered label carries neither a name nor an id.
//   READY    → the read completed. An id with no name genuinely does not resolve.
//   ERROR    → resolution failed; a retry may succeed.
//
// AND IT NEVER FALLS BACK TO THE ID. `domain/installedEquipmentListView.js`'s `resolveName`
// does exactly that (`nameMap.get(id) ?? id`), which is how a Firestore document key
// reaches a screen as content. Returning NOT_FOUND is the whole point: "Location
// unavailable" is a fact about the reference; `loc_8Xy2...` is a fact about the database.

/** Firestore's `in` takes ten values. */
const CHUNK = 10;

export const LOCATION_NAMES_STATUS = Object.freeze({
  IDLE: "IDLE",
  LOADING: "LOADING",
  READY: "READY",
  DENIED: "DENIED",
  ERROR: "ERROR",
});

/**
 * A location's display name.
 *
 * Locations are named inconsistently across the estate — some carry `name`, older ones a
 * `locationName`, and site records sometimes only a `label`. Checked in that order, and a
 * record with none of them resolves to nothing rather than to a street address, which is
 * a different field with different disclosure rules.
 */
export function pickLocationName(data) {
  for (const key of ["name", "locationName", "label"]) {
    const value = data?.[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

/** The batched read, with its outcome. */
export function useLocationNames(locationIds) {
  const [result, setResult] = useState(() => ({ names: new Map(), status: LOCATION_NAMES_STATUS.IDLE }));
  // Stable effect key: sorted, de-duplicated, non-blank ids, so a re-render that changed
  // nothing relevant does not re-read.
  const key = Array.from(new Set((locationIds ?? []).filter(Boolean))).sort().join(",");

  useEffect(() => {
    let cancelled = false;
    const ids = key ? key.split(",") : [];
    if (ids.length === 0) {
      setResult({ names: new Map(), status: LOCATION_NAMES_STATUS.IDLE });
      return undefined;
    }

    setResult((prev) => ({ names: prev.names, status: LOCATION_NAMES_STATUS.LOADING }));

    (async () => {
      const map = new Map();
      let status = LOCATION_NAMES_STATUS.READY;
      try {
        for (let i = 0; i < ids.length; i += CHUNK) {
          const snap = await getDocs(
            query(collection(db, LOCATIONS_COLLECTION), where(documentId(), "in", ids.slice(i, i + CHUNK))),
          );
          snap.forEach((d) => {
            const name = pickLocationName(d.data());
            if (name) map.set(d.id, name);
          });
        }
      } catch (err) {
        status = err?.code === "permission-denied" ? LOCATION_NAMES_STATUS.DENIED : LOCATION_NAMES_STATUS.ERROR;
      }
      // On failure the partial map is DISCARDED. A half-filled map reported as READY would
      // present the ids that happened not to arrive as sites that do not exist.
      if (!cancelled) {
        setResult(status === LOCATION_NAMES_STATUS.READY ? { names: map, status } : { names: new Map(), status });
      }
    })();

    return () => { cancelled = true; };
  }, [key]);

  return result;
}

/**
 * Build a `resolveReference` for a metadata list whose rows carry location references.
 *
 * @param rows     loaded list rows
 * @param fieldIds which REFERENCE columns are location-shaped
 */
export function useLocationReferenceResolver(rows, fieldIds = ["locationId"]) {
  const fields = useMemo(() => new Set(fieldIds), [fieldIds]);

  const locationIds = useMemo(() => {
    const ids = new Set();
    for (const row of rows ?? []) {
      for (const f of fields) {
        const v = row?.[f];
        if (typeof v === "string" && v) ids.add(v);
      }
    }
    return Array.from(ids).sort();
  }, [rows, fields]);

  const { names, status } = useLocationNames(locationIds);

  const resolveReference = useCallback((fieldId, id) => {
    // A field this resolver does not own returns undefined, so it can be composed with the
    // account resolver without either one claiming the other's references.
    if (!fields.has(fieldId)) return undefined;
    if (status === LOCATION_NAMES_STATUS.LOADING || status === LOCATION_NAMES_STATUS.IDLE) {
      return { state: REFERENCE_STATE.LOADING };
    }
    if (status === LOCATION_NAMES_STATUS.DENIED) return { state: REFERENCE_STATE.DENIED };
    if (status === LOCATION_NAMES_STATUS.ERROR) return { state: REFERENCE_STATE.ERROR };
    const name = names.get(id);
    return name ? { state: REFERENCE_STATE.FOUND, label: name } : { state: REFERENCE_STATE.NOT_FOUND };
  }, [fields, names, status]);

  return { resolveReference, status, names };
}
