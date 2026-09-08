// The scoped Reorder read seam's callable surface.
//
// A thin adapter. It maps a wire payload onto the service's input and decides NOTHING -- the service
// owns the modes, the clauses, the scope predicate and the union. `actorUid` is never taken from the
// payload: it comes from request.auth.uid, which is the whole point.
//
// EXPORT != DEPLOY.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  InvalidInputError,
  UnauthorizedActorError,
  readScopedReorderRequests as readService,
} from "./scopedReorderReadService";

const REGION = "us-central1";

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * A SCOPE refusal is permission-denied, never invalid-argument and never a silent empty page. The
 * caller has nothing to fix in its request; it is being told what it may see.
 */
function mapError(err: unknown): HttpsError {
  if (err instanceof HttpsError) return err;
  if (err instanceof UnauthorizedActorError) return new HttpsError("permission-denied", err.message);
  if (err instanceof InvalidInputError) return new HttpsError("invalid-argument", err.message);
  return new HttpsError("internal", "The reorder read could not be completed.");
}

export const readScopedReorderRequests = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (typeof uid !== "string" || !uid) throw new HttpsError("unauthenticated", "Must be signed in.");
  const data = asRecord(request.data);
  try {
    return await readService({
      actorUid: uid,
      mode: data.mode as string,
      params: asRecord(data.params),
      pageSize: typeof data.pageSize === "number" ? data.pageSize : undefined,
      cursor: typeof data.cursor === "string" ? data.cursor : undefined,
    });
  } catch (err) {
    throw mapError(err);
  }
});
