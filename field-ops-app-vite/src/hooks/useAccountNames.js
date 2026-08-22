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
// be used on technician surfaces. That fix now EXISTS and is neither of the two
// options this comment used to name: F1 built a trusted WorkOrder-keyed identity
// projection (hooks/useWorkOrderFieldContext + domain/fieldCurrentJob), so no
// customerName denormalization and no Rules widening were required. Technician
// surfaces resolve identity through that path; callers here are admin/dispatcher.
//
// The "fall back to the raw id" behaviour below is the MAP contract, not a display
// contract: an unresolved id must never be rendered as the customer name. Render
// through shared/ui/CustomerIdentity, which keeps RESOLVED / NOT_AUTHORIZED /
// ABSENT / UNRESOLVED distinct.
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * How the batched read turned out.
 *
 * WHY THE STATUS EXISTS. This hook used to `catch {}` and return whatever it had, which made three
 * different situations indistinguishable to every caller: the read had not finished, the read was
 * DENIED, and the account genuinely does not exist. A missing entry meant all three.
 *
 * That is not a cosmetic distinction. Telling an operator a customer "no longer exists" when the
 * truth is that their role cannot read it reports a data defect that is not there -- and it states
 * a conclusion about a record the viewer was never entitled to observe.
 */
export const ACCOUNT_NAMES_STATUS = Object.freeze({
  /** No ids were requested. No read was issued. */
  IDLE: "IDLE",
  /** A read is in flight. A missing entry means "not yet", not "not there". */
  LOADING: "LOADING",
  /** The read completed. A missing entry now genuinely means the account does not exist. */
  READY: "READY",
  /** Rules refused the read. Nothing can be concluded about any id. */
  DENIED: "DENIED",
  /** The read failed for a non-authorization reason. Possibly transient. */
  ERROR: "ERROR",
});

/**
 * The batched read, with its outcome.
 *
 * One implementation; `useAccountNames` below is the Map-only view of it, kept so existing callers
 * are untouched.
 */
export function useAccountNamesWithStatus(accountIds) {
  const [result, setResult] = useState(() => ({ names: new Map(), status: ACCOUNT_NAMES_STATUS.IDLE }));
  // Stable effect key: sorted, de-duplicated, non-blank ids.
  const key = Array.from(new Set((accountIds ?? []).filter(Boolean))).sort().join(",");

  useEffect(() => {
    let cancelled = false;
    const ids = key ? key.split(",") : [];
    if (ids.length === 0) {
      setResult({ names: new Map(), status: ACCOUNT_NAMES_STATUS.IDLE });
      return undefined;
    }

    setResult((prev) => ({ names: prev.names, status: ACCOUNT_NAMES_STATUS.LOADING }));

    (async () => {
      const map = new Map();
      let status = ACCOUNT_NAMES_STATUS.READY;
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
      } catch (err) {
        // DENIED IS KEPT SEPARATE from every other failure. A refusal is permanent for this viewer
        // and says nothing about whether the record exists; anything else may succeed on a retry.
        status = err?.code === "permission-denied" ? ACCOUNT_NAMES_STATUS.DENIED : ACCOUNT_NAMES_STATUS.ERROR;
      }
      // On failure the partial map is discarded: a half-filled map read as READY would report the
      // ids that happened not to arrive as nonexistent.
      if (!cancelled) {
        setResult(status === ACCOUNT_NAMES_STATUS.READY ? { names: map, status } : { names: new Map(), status });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [key]);

  return result;
}

/** Map-only view, for callers that predate the status and do not need it. */
export function useAccountNames(accountIds) {
  return useAccountNamesWithStatus(accountIds).names;
}
