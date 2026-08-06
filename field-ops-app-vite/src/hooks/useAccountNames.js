import { useEffect, useState } from "react";
import { collection, getDocs, query, where, documentId } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { ACCOUNTS_COLLECTION } from "../domain/constants";

// W4 (human-readable IDs). Resolves a SET of account ids -> Map<accountId, name>,
// for surfaces that render many work orders and must show a human-readable
// customer name instead of the opaque customerId the WorkOrder doc carries
// (fieldops_wos has no customerName field). One-shot getDocs, chunked into
// Firestore `documentId() in` queries (<=10 ids each); re-fetches only when the
// id set changes. Account names change rarely, so a live listener per account
// would be wasteful. On a denied/unavailable read the map is left unresolved and
// callers fall back to the raw id (never a blank).
//
// Requires the caller's role to have accounts read access (admin/dispatcher).
// Technicians are deliberately NOT granted accounts read, so this hook must not
// be used on technician surfaces -- their opaque-id fix needs a WorkOrder
// customerName denormalization (backend) or a scoped Rules grant, not this hook.
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function useAccountNames(accountIds) {
  const [names, setNames] = useState(() => new Map());
  // Stable effect key: sorted, de-duplicated, non-blank ids.
  const key = Array.from(new Set((accountIds ?? []).filter(Boolean))).sort().join(",");

  useEffect(() => {
    let cancelled = false;
    const ids = key ? key.split(",") : [];
    if (ids.length === 0) {
      setNames(new Map());
      return undefined;
    }

    (async () => {
      const map = new Map();
      try {
        for (const idChunk of chunk(ids, 10)) {
          const snap = await getDocs(
            query(collection(db, ACCOUNTS_COLLECTION), where(documentId(), "in", idChunk))
          );
          snap.forEach((d) => {
            const name = d.data()?.name;
            if (typeof name === "string" && name) map.set(d.id, name);
          });
        }
      } catch {
        // denied/unavailable -> leave unresolved; callers fall back to the id
      }
      if (!cancelled) setNames(map);
    })();

    return () => {
      cancelled = true;
    };
  }, [key]);

  return names;
}
