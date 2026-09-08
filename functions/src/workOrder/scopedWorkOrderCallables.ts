// The scoped Work Order read seam's callable surface.
//
// Thin adapters. They map a wire payload onto the service's input and decide NOTHING -- the service
// owns the modes, the clauses, the ordering and the scope. In particular `actorUid` is never taken
// from the payload: it comes from request.auth.uid, which is the whole point.
//
// EXPORT != DEPLOY.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  InvalidInputError,
  UnauthorizedActorError,
  countScopedWorkOrders as countService,
  readScopedWorkOrderById as readByIdService,
  readScopedWorkOrders as readService,
  readSelfTechnician as readSelfTechnicianService,
} from "./scopedWorkOrderReadService";

const REGION = "us-central1";

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * Map a service error onto an HttpsError.
 *
 * A SCOPE refusal is permission-denied, never invalid-argument and never a silent empty page. The
 * caller has nothing to fix in its request; it is being told what it may see.
 */
function mapError(err: unknown): HttpsError {
  if (err instanceof HttpsError) return err;
  if (err instanceof UnauthorizedActorError) return new HttpsError("permission-denied", err.message);
  if (err instanceof InvalidInputError) return new HttpsError("invalid-argument", err.message);
  return new HttpsError("internal", "The work order read could not be completed.");
}

function requireUid(request: { auth?: { uid?: string } | null }): string {
  const uid = request.auth?.uid;
  if (typeof uid !== "string" || !uid) throw new HttpsError("unauthenticated", "Must be signed in.");
  return uid;
}

export const readScopedWorkOrders = onCall({ region: REGION }, async (request) => {
  const actorUid = requireUid(request);
  const data = asRecord(request.data);
  try {
    return await readService({
      actorUid,
      mode: data.mode as string,
      params: asRecord(data.params),
      sortKey: typeof data.sortKey === "string" ? data.sortKey : undefined,
      pageSize: typeof data.pageSize === "number" ? data.pageSize : undefined,
    });
  } catch (err) {
    throw mapError(err);
  }
});

export const countScopedWorkOrders = onCall({ region: REGION }, async (request) => {
  const actorUid = requireUid(request);
  const data = asRecord(request.data);
  try {
    return await countService({
      actorUid,
      mode: data.mode as string,
      params: asRecord(data.params),
    });
  } catch (err) {
    throw mapError(err);
  }
});

// The caller own technician profile. Takes NO input beyond authentication -- the whole point is
// that the caller cannot name which technician.
export const readSelfTechnician = onCall({ region: REGION }, async (request) => {
  const actorUid = requireUid(request);
  try {
    return await readSelfTechnicianService(actorUid);
  } catch (err) {
    throw mapError(err);
  }
});

export const readScopedWorkOrderById = onCall({ region: REGION }, async (request) => {
  const actorUid = requireUid(request);
  const data = asRecord(request.data);
  try {
    return await readByIdService({ actorUid, workOrderId: data.workOrderId as string });
  } catch (err) {
    throw mapError(err);
  }
});
