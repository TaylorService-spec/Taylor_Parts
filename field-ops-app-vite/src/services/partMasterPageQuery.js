// ONE PAGE OF THE PART MASTER, on the canonical metadata runtime.
//
// GOVERNANCE: docs/architecture/ADR-013-object-list-metadata-authority.md §8, §18.
// Replaces the convergence-retired `fetchPartMasterPage({ plan })`, which took a query plan from the
// pilot architecture and translated it to Firestore itself.
//
// ============================ THE DEFECT CONVERGENCE FOUND ============================
//
// The retired version appended an EXPLICIT `orderBy("partId", "asc")` as a tie-break, on the
// reasoning that two parts sharing a number must not swap places between reads. The reasoning was
// right and the implementation was not: `partId` is a stored FIELD, so
//
//     where(status ==) + orderBy(internalPartNumber) + orderBy(partId)
//
// demands a composite index on (status, internalPartNumber, partId). The repository declares
// (status, internalPartNumber) — Firestore appends `__name__` implicitly, and for `parts` the
// document id IS the partId. So every filtered Parts query would have failed at read time with
// "index required", in front of a user, on a surface nobody touched. CI was green throughout,
// because nothing verified the pilot's filter promises against real indexes.
//
// The canonical runtime had already solved this: it appends `__name__` as the tiebreaker, IN THE
// SAME DIRECTION as the clause before it, which is what keeps the query on the index Firestore
// maintains for free. That correction is why this module now translates nothing of its own.
//
// ============================ WHY THIS READ EXISTS AT ALL ============================
//
// `useMetadataList` is the general path and most lists should use it. Part Master keeps a thin read
// of its own for exactly one reason: `toPartListView` SEPARATES malformed documents from valid ones
// and reports how many were excluded. A catalog-administration surface has to be able to say "9
// records need review", and a generic list source has nowhere to put that.
//
// Everything else — which filters are legal, the total sort order, the bound, the +1 truncation
// probe, the cursor rule — belongs to the runtime and is not re-implemented here. This module owns
// the row PROJECTION and nothing more.
import { fetchPage } from "../metadata/firestoreListSource.js";
import { toPartListView } from "../domain/partMasterView";

/**
 * Fetch one page described by a bounded query descriptor.
 *
 * @param descriptor from metadata/listRuntime.buildQueryDescriptor
 * @param cursor     the `nextCursor` from a previous call (a Firestore document snapshot)
 *
 * Resolves `{ ok:true, parts, invalid, hasMore, nextCursor }` or `{ ok:false, code }` where code is
 * "permission-denied" (denied by Rules) or "unavailable".
 */
export async function fetchPartMasterPage({ descriptor = null, cursor = null } = {}) {
  if (!descriptor) return { ok: false, code: "unavailable" };
  try {
    const page = await fetchPage(descriptor, { cursorDoc: cursor });
    // `fetchPage` returns plain row objects keyed by `id`; the Part view expects `{ id, data }`.
    const view = toPartListView(page.rows.map(({ id, ...data }) => ({ id, data })));
    return {
      ok: true,
      ...view,
      hasMore: page.hasMore,
      // A Firestore CURSOR IS A DOCUMENT, not a set of values. Passing it back opaquely means this
      // screen never has to know that, and never has to reconstruct one from rendered fields.
      nextCursor: page.nextCursorDoc,
    };
  } catch (err) {
    return { ok: false, code: err && err.code === "permission-denied" ? "permission-denied" : "unavailable" };
  }
}
