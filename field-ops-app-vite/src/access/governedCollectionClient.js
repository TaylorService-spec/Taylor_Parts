// GOVERNED LIST READS, client seam.
//
// The single path by which this app reads governed business data now that firestore.rules decides
// nothing. Each source is served by its own capability, resolved server-side by `readGovernedList`
// against a closed registry.
//
// THE CLIENT NAMES A SOURCE, NOT A COLLECTION. `accountContacts` is an EOS concept; the Firestore
// path behind it never crosses the wire, and neither does a where() clause, a sort field or a raw
// cursor. Those are levers -- a collection name chooses what is read, a where() clause is a query
// language over someone else's data, a sort field is an ordering oracle, a raw cursor is a position
// in a result set nobody handed out. All of them are registry-owned, server-side.
//
// PAGES ARE REAL. `nextCursor` is opaque and is only ever echoed back, never constructed here. A
// caller that ignores it gets the first page and `hasMore: true`, which is a truthful partial
// answer -- unlike a capped read, which returns a partial answer that looks complete.
//
// WHY A SEAM RATHER THAN httpsCallable AT EACH CALL SITE. The same reason
// administrationUsersClient.js exists: one place maps a rejection to an honest outcome, so no hook
// has to decide for itself what a failure MEANS -- and no hook can accidentally decide that a
// failure means "empty".
//
// DENIED AND UNAVAILABLE STAY DISTINCT, and neither is ever an empty list. A screen that renders []
// for a refused read tells the user this company has no customers, no contacts, no equipment. That
// is a false statement about the business, produced by a permission error.
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase/firebase";

const CALLABLE = "readGovernedList";

export const READ_RESULT = Object.freeze({
  OK: "OK",
  DENIED: "DENIED",
  INVALID: "INVALID",
  UNAVAILABLE: "UNAVAILABLE",
});

/**
 * One page of one governed source.
 *
 * @param sourceId  An EOS source name the server registry carries ("accountContacts"). NOT a
 *                  collection: the client never names a Firestore path.
 * @param filters   Values for that source's DECLARED filter names. Names only -- the client cannot
 *                  introduce a field, an operator or a clause.
 * @param cursor    The opaque token a previous page returned. Never constructed here.
 * @returns `{ ok, result, items, nextCursor, hasMore }` -- resolves, never rejects.
 */
export async function readGovernedList({ sourceId, filters, pageSize, cursor } = {}) {
  try {
    const res = await httpsCallable(functions, CALLABLE)({
      sourceId,
      ...(filters ? { filters } : {}),
      ...(pageSize ? { pageSize } : {}),
      ...(cursor ? { cursor } : {}),
    });
    const d = res?.data ?? {};
    return {
      ok: true,
      result: READ_RESULT.OK,
      items: Array.isArray(d.items) ? d.items : [],
      nextCursor: typeof d.nextCursor === "string" ? d.nextCursor : null,
      hasMore: d.hasMore === true,
    };
  } catch (err) {
    const code = String(err?.code ?? "").replace(/^functions\//, "");
    // `invalid-argument` is the one class a developer can act on -- an undeclared filter name, an
    // unregistered sourceId, a cursor from another source -- and it is a programming error rather
    // than a user-facing one, so it stays distinguishable instead of folding into UNAVAILABLE.
    const result =
      code === "permission-denied" || code === "unauthenticated"
        ? READ_RESULT.DENIED
        : code === "invalid-argument"
          ? READ_RESULT.INVALID
          : READ_RESULT.UNAVAILABLE;
    return {
      ok: false,
      result,
      items: [],
      nextCursor: null,
      hasMore: false,
      message: result === READ_RESULT.INVALID ? err?.message : null,
    };
  }
}

export const governedCollectionClient = { readGovernedList };
