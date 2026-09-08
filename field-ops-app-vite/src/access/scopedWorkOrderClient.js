// The client transport for the scoped Work Order read seam.
//
// Work Orders are the ONE read whose authority is not global, so they do not go through
// governedCollectionClient's `readGovernedList` -- that client speaks the governed-source
// vocabulary (sourceId + registered filters), and this seam speaks a different one (a registered
// MODE + that mode's declared parameters) precisely because the server has to add a scope predicate
// the caller neither supplies nor can see.
//
// WHAT THIS FILE MAY NOT DO. It never sends a technician id, an actor uid, "me", or an
// assignedTechId. There is no parameter for any of them on any mode; the server derives the
// technician identity from request.auth.uid and forces the assignment predicate in. A browser that
// wanted to read someone else's work has nothing to put it in.
//
// Resolves rather than rejects, matching governedCollectionClient, so callers keep DENIED distinct
// from UNAVAILABLE instead of parsing an error dialect.
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase/firebase";

export const WORK_ORDER_READ_RESULT = Object.freeze({
  OK: "OK",
  DENIED: "DENIED",
  INVALID: "INVALID",
  UNAVAILABLE: "UNAVAILABLE",
});

function classify(err) {
  const raw = typeof err?.code === "string" ? err.code : "";
  const code = raw.startsWith("functions/") ? raw.slice("functions/".length) : raw;
  if (code === "permission-denied" || code === "unauthenticated") return WORK_ORDER_READ_RESULT.DENIED;
  if (code === "invalid-argument") return WORK_ORDER_READ_RESULT.INVALID;
  return WORK_ORDER_READ_RESULT.UNAVAILABLE;
}

async function invoke(name, payload) {
  return (await httpsCallable(functions, name)(payload))?.data;
}

/**
 * One page of Work Orders, in a registered mode.
 *
 * @param mode      A registered query mode ("accountRecent", "byEquipment", "index", ...). Never a
 *                  collection and never a query.
 * @param params    Values for that mode's DECLARED parameters. A name the mode does not declare is
 *                  refused by the server rather than ignored.
 * @param sortKey   A sort TOKEN the mode registered. The server chooses the field.
 */
export async function readScopedWorkOrders({ mode, params, sortKey, pageSize } = {}) {
  try {
    const d = await invoke("readScopedWorkOrders", {
      mode,
      ...(params ? { params } : {}),
      ...(sortKey ? { sortKey } : {}),
      ...(pageSize ? { pageSize } : {}),
    });
    return {
      ok: true,
      result: WORK_ORDER_READ_RESULT.OK,
      items: Array.isArray(d?.items) ? d.items : [],
      hasMore: Boolean(d?.hasMore),
      // Which scope the SERVER applied. Reported so a surface can say "your assigned work" honestly
      // rather than implying it is showing everything.
      scope: d?.scope ?? null,
    };
  } catch (err) {
    return { ok: false, result: classify(err), items: [], hasMore: false, scope: null };
  }
}

/** The aggregate, behind the same authority and the same scope as the read. */
export async function countScopedWorkOrders({ mode, params } = {}) {
  try {
    const d = await invoke("countScopedWorkOrders", { mode, ...(params ? { params } : {}) });
    return {
      ok: true,
      result: WORK_ORDER_READ_RESULT.OK,
      // A number or NULL. Never 0 on failure -- see the caller-side contract; a count of 0 rendered
      // for a failed read states that there is no work, in the calmest possible way.
      count: typeof d?.count === "number" ? d.count : null,
      atLeast: Boolean(d?.atLeast),
      scope: d?.scope ?? null,
    };
  } catch (err) {
    return { ok: false, result: classify(err), count: null, atLeast: false, scope: null };
  }
}

/**
 * One Work Order by id.
 *
 * Knowing an id does not bypass scope: a technician gets the record only when it is assigned to
 * their server-resolved identity, and a scope failure comes back DENIED rather than as an absence.
 * `{ ok: true, workOrder: null }` is a CONFIRMED absence and means something different.
 */
export async function readScopedWorkOrderById(workOrderId) {
  try {
    const d = await invoke("readScopedWorkOrderById", { workOrderId });
    return { ok: true, result: WORK_ORDER_READ_RESULT.OK, workOrder: d?.workOrder ?? null, scope: d?.scope ?? null };
  } catch (err) {
    return { ok: false, result: classify(err), workOrder: null, scope: null };
  }
}
