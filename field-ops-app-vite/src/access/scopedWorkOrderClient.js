// The client transport for the scoped Work Order read seam.
//
// Work Orders are the ONE read whose authority is not global, so they do not go through
// governedCollectionClient's `readGovernedList` -- that client speaks the governed-source
// vocabulary (sourceId + registered filters), and this seam speaks a different one (a registered
// MODE + that mode's declared parameters) precisely because the server has to add a scope predicate
// the caller neither supplies nor can see.
//
// WHAT THIS FILE MAY NOT DO. It never sends an actor uid, "me", or an assignedTechId, and it never
// claims WHO IS ASKING. The server derives the technician identity from request.auth.uid and forces
// the assignment predicate in.
//
// The "assigned" mode does carry a technicianId, and the distinction is the point: it names WHOSE
// assignments are wanted, which is a business input, not a claim about the caller. It is not
// authority and cannot be used as any -- a principal scoped to their own assignments may name only
// themselves and is REFUSED otherwise, and naming somebody else is possible only for a principal
// who already holds the global work-order read.
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
export async function readScopedWorkOrders({ mode, params, sortKey, pageSize, cursor } = {}) {
  try {
    const d = await invoke("readScopedWorkOrders", {
      mode,
      ...(params ? { params } : {}),
      ...(sortKey ? { sortKey } : {}),
      ...(pageSize ? { pageSize } : {}),
      ...(cursor ? { cursor } : {}),
    });
    return {
      ok: true,
      result: WORK_ORDER_READ_RESULT.OK,
      items: Array.isArray(d?.items) ? d.items : [],
      hasMore: Boolean(d?.hasMore),
      // The token for the NEXT page. Opaque, and bound server-side to the mode that issued it.
      nextCursor: d?.nextCursor ?? null,
      // Which scope the SERVER applied. Reported so a surface can say "your assigned work" honestly
      // rather than implying it is showing everything.
      scope: d?.scope ?? null,
    };
  } catch (err) {
    return { ok: false, result: classify(err), items: [], hasMore: false, nextCursor: null, scope: null };
  }
}

// The exhaustion ceiling. NOT a truncation point: reaching it FAILS the read rather than returning
// a short population, because the two consumers below net totals over the result and a total
// computed on a silently-shortened input is not partial -- it is wrong, presented as complete.
const MAX_PAGES = 200;

/**
 * EVERY Work Order this principal may see, by paging the governed seam to exhaustion.
 *
 * The callers that need this -- the operations board (which replaced an unfiltered collection
 * listener) and the analytics metrics (which net over the whole collection) -- have a COMPLETE
 * population as part of what they mean. Returning one bounded page and calling the result a total
 * would be exactly the failure this seam exists to prevent.
 *
 * NO SILENT TRUNCATION: a partial result is only ever returned with ok:false and no rows.
 *
 * @param {{ mode?: string, params?: Record<string, unknown>, pageSize?: number }} [options]
 */
export async function readAllScopedWorkOrders({ mode = "all", params, pageSize = 500 } = {}) {
  const items = [];
  let cursor = null;
  let scope = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    // eslint-disable-next-line no-await-in-loop -- the pages are sequential by construction: each
    // one needs the cursor the previous one returned.
    const res = await readScopedWorkOrders({ mode, params, pageSize, cursor: cursor ?? undefined });
    if (!res.ok) return { ok: false, result: res.result, items: [], scope: null };
    items.push(...res.items);
    scope = res.scope ?? scope;
    if (!res.hasMore || !res.nextCursor) {
      return { ok: true, result: WORK_ORDER_READ_RESULT.OK, items, scope };
    }
    cursor = res.nextCursor;
  }
  // The ceiling was reached with more still to come. Reported as a FAILURE with no rows: a caller
  // handed these would net a total over a population it believes is complete.
  return { ok: false, result: WORK_ORDER_READ_RESULT.UNAVAILABLE, items: [], scope: null };
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
 * The CALLER'S OWN technician profile.
 *
 * Takes no argument, and could not take one: the whole point is that the browser cannot name
 * which technician it is asking about. The server resolves the identity from request.auth.uid.
 *
 * `{ ok: true, technicianId: null, technician: null }` is a CONFIRMED absence -- this principal
 * has no technician linkage -- and means something different from a failed read. The consuming
 * hook renders those differently, which is why the two are not collapsed.
 */
export async function readSelfTechnician() {
  try {
    const d = await invoke("readSelfTechnician", {});
    return {
      ok: true,
      result: WORK_ORDER_READ_RESULT.OK,
      technicianId: d?.technicianId ?? null,
      technician: d?.technician ?? null,
    };
  } catch (err) {
    return { ok: false, result: classify(err), technicianId: null, technician: null };
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
