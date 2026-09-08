// The session-identity callable. A thin adapter: it takes NO payload, and there is nothing in its
// input shape a caller could use to ask about anybody else.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { resolveEmployeeSessionProjection } from "./employeeSessionProjection";

const REGION = "us-central1";

export const resolveCurrentEmployeeSession = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (typeof uid !== "string" || !uid) throw new HttpsError("unauthenticated", "Must be signed in.");
  try {
    return await resolveEmployeeSessionProjection(uid);
  } catch (err) {
    console.error("[employeeSession] resolution failed", err);
    // No id, no linkage state, no record contents in the message.
    throw new HttpsError("internal", "Your session identity could not be resolved.");
  }
});
