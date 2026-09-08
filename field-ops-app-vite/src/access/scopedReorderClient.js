// The client transport for the scoped Reorder read seam.
//
// Reorder requests do not go through `readGovernedList`: that client speaks the governed-source
// vocabulary (one capability, one population), and reorder reads have THREE populations resolved by
// three different capabilities. The server picks which one this principal gets and adds the
// predicate; nothing here can influence that choice.
//
// WHAT THIS FILE MAY NOT DO. It never sends an actor uid, "me", or a claim about who is asking.
//
// It DOES send `reviewedBy`, `assignedBy` and `assignedToUserId` when a surface filters on them,
// and the distinction is the point: in the retired Rules those fields were SCOPE, and here they are
// DISPLAY. The server applies the scope predicate on top of them, per branch, as a conjunction --
// so naming somebody else yields a SMALLER set, never a different one. The single case that could
// be mistaken for authority, an own-scoped caller naming another assignee, is REFUSED server-side.
//
// Resolves rather than rejects, matching governedCollectionClient, so callers keep DENIED distinct
// from UNAVAILABLE instead of parsing an error dialect.
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase/firebase";

export const REORDER_READ_RESULT = Object.freeze({
  OK: "OK",
  DENIED: "DENIED",
  INVALID: "INVALID",
  UNAVAILABLE: "UNAVAILABLE",
});

function classify(err) {
  const raw = typeof err?.code === "string" ? err.code : "";
  const code = raw.startsWith("functions/") ? raw.slice("functions/".length) : raw;
  if (code === "permission-denied" || code === "unauthenticated") return REORDER_READ_RESULT.DENIED;
  if (code === "invalid-argument") return REORDER_READ_RESULT.INVALID;
  return REORDER_READ_RESULT.UNAVAILABLE;
}

/**
 * One page of Reorder Requests, in a registered mode.
 *
 * The parameter types are DECLARED rather than inferred: this file is plain JS consumed by
 * checked TypeScript, and without them the destructuring default types the argument as
 * `{ mode?: string }` alone -- so a real call site passing `params` fails to compile.
 *
 * @param {{
 *   mode?: "index" | "history",
 *   params?: Record<string, unknown>,
 *   pageSize?: number,
 *   cursor?: string | null,
 * }} [options]
 *   mode    -- "index" or "history". Never a collection and never a query.
 *   params  -- values for that mode's DECLARED parameters. A name the mode does not declare is
 *              refused by the server rather than ignored.
 *   cursor  -- an opaque token from a previous page of the SAME mode, passed back verbatim.
 */
export async function readScopedReorderRequests({ mode = "index", params, pageSize, cursor } = {}) {
  try {
    const res = await httpsCallable(functions, "readScopedReorderRequests")({
      mode,
      ...(params ? { params } : {}),
      ...(pageSize ? { pageSize } : {}),
      ...(cursor ? { cursor } : {}),
    });
    const d = res?.data ?? {};
    return {
      ok: true,
      result: REORDER_READ_RESULT.OK,
      items: Array.isArray(d.items) ? d.items : [],
      hasMore: Boolean(d.hasMore),
      // Opaque, and minted by the server. Passed back verbatim; never parsed, never constructed.
      nextCursor: typeof d.nextCursor === "string" ? d.nextCursor : null,
      // Which scope the SERVER applied. Reported so a surface can say "the requests you manage"
      // honestly rather than implying it is showing the whole queue.
      scope: d.scope ?? null,
    };
  } catch (err) {
    return { ok: false, result: classify(err), items: [], hasMore: false, nextCursor: null, scope: null };
  }
}
