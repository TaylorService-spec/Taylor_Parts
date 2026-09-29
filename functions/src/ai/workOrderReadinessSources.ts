// GOVERNED SOURCE ADAPTERS FOR WORK ORDER READINESS.
//
// These functions translate existing EOS authority vocabularies into the already-ratified
// `workOrderPartsReadiness` input contract. They do NOT derive readiness and they do NOT create new
// business states. The readiness projection remains the sole owner of READY / ATTENTION / UNKNOWN.

/**
 * NONE and UNAVAILABLE ARE DIFFERENT ANSWERS.
 *
 *   NONE         the governed evidence says there is no procurement for this part.
 *   UNAVAILABLE  this runtime has no authoritative procurement source to ask.
 *
 * Collapsing the second into the first would tell a technician "nothing is on order" when the
 * truthful answer is "nobody here can say". It is the same distinction `truck: UNAVAILABLE`
 * already draws in this projection, and for the same reason.
 */
export type ReadinessProcurementStatus = "PENDING" | "ORDERED" | "RECEIVED" | "NONE" | "UNAVAILABLE";

/**
 * Narrow adapter from the richer Reorder Request lifecycle to the readiness projection's procurement
 * dimension.
 *
 * Only states that EOS itself defines as active purchasing are treated as procurement:
 *   PURCHASING_IN_PROGRESS -> PENDING (domain/constants.js: "purchasing underway")
 *   ORDERED                -> ORDERED
 *   RECEIVED               -> RECEIVED
 *
 * Earlier workflow states are NOT procurement merely because a request exists. In particular,
 * PENDING_REVIEW is awaiting a decision, and READY_FOR_PARTS_MANAGER / ASSIGNED_TO_PARTS_ASSOCIATE
 * have not yet entered purchasing. REJECTED/CANCELLED/VOIDED are terminal non-active states.
 */
export function readinessProcurementStatus(
  reorderStatus: unknown,
): ReadinessProcurementStatus {
  if (reorderStatus === "PURCHASING_IN_PROGRESS") return "PENDING";
  if (reorderStatus === "ORDERED") return "ORDERED";
  if (reorderStatus === "RECEIVED") return "RECEIVED";
  return "NONE";
}

/**
 * If more than one linked request exists for the same WO/part, choose the state with the strongest
 * current procurement evidence. This is a read projection only; it does not decide which request is
 * canonical or mutate duplicate requests.
 *
 * Active ordered work outranks purchasing-in-progress; received is historical completion and is used
 * only when no currently-active purchasing state exists. Everything else resolves to NONE.
 */
export function strongestReadinessProcurementStatus(
  reorderStatuses: readonly unknown[],
): ReadinessProcurementStatus {
  const mapped = reorderStatuses.map(readinessProcurementStatus);
  if (mapped.includes("ORDERED")) return "ORDERED";
  if (mapped.includes("PENDING")) return "PENDING";
  if (mapped.includes("RECEIVED")) return "RECEIVED";
  return "NONE";
}
