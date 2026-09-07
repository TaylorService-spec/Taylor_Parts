// GOVERNED COLLECTION READS, client seam.
//
// The single path by which this app reads a registered collection now that firestore.rules decides
// nothing. Each collection is served by its own capability, resolved server-side by
// `readGovernedCollection` against a closed registry -- the client cannot name a collection the
// registry does not carry, nor filter on a field its entry does not declare.
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

const CALLABLE = "readGovernedCollection";

export const READ_RESULT = Object.freeze({
  OK: "OK",
  DENIED: "DENIED",
  INVALID: "INVALID",
  UNAVAILABLE: "UNAVAILABLE",
});

/**
 * Read one governed collection.
 *
 * @param collection  A key the server-side registry carries. Anything else is refused there.
 * @param filters     `[{ field, op, value }]`, each declared by that collection's registry entry.
 * @returns `{ ok, result, rows }` -- resolves, never rejects.
 */
export async function readGovernedCollection({ collection, filters, limit } = {}) {
  try {
    const res = await httpsCallable(functions, CALLABLE)({
      collection,
      ...(filters?.length ? { filters } : {}),
      ...(limit ? { limit } : {}),
    });
    const rows = res?.data?.rows;
    return { ok: true, result: READ_RESULT.OK, rows: Array.isArray(rows) ? rows : [] };
  } catch (err) {
    const code = String(err?.code ?? "").replace(/^functions\//, "");
    // `invalid-argument` is the one class a developer can act on -- an undeclared filter, an
    // unregistered collection -- and it is a programming error rather than a user-facing one, so it
    // stays distinguishable instead of being folded into UNAVAILABLE.
    const result =
      code === "permission-denied" || code === "unauthenticated"
        ? READ_RESULT.DENIED
        : code === "invalid-argument"
          ? READ_RESULT.INVALID
          : READ_RESULT.UNAVAILABLE;
    return { ok: false, result, rows: [], message: result === READ_RESULT.INVALID ? err?.message : null };
  }
}

export const governedCollectionClient = { readGovernedCollection };
