// D5 (Read service) — thin onCall adapter for readService.ts, mirroring the on-main pattern of
// access/effectiveAccessFeedCallable.ts: authenticate, derive the caller's identity from the SERVER auth
// context ONLY, wire the real #226 permission resolver, map the service's typed errors to safe
// HttpsErrors, and nothing else — every real decision lives in readService.ts.
//
// INERT IN D5 (by direction): this callable is DELIBERATELY NOT exported from functions/src/index.ts, so
// it is not deployed and no client can invoke it until a separate, later Owner production authorization.
// It resolves `equipment.compatibility.view`, which is registered active:false in the permission catalog
// — so even if it were reachable, the resolver returns DENY for every principal. Activation + role grants
// are the separate #226 gate. Emulator/authorized-path tests drive readService.ts directly with an
// injected permission fixture; they do not go through this adapter's real resolver.
//
// The single most important property: `actorUid` is ALWAYS `request.auth.uid`. `request.data` is never
// read for uid, role, or authority — the accepted shape cannot express a client-claimed identity.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed";
import {
  readCompatibilityForModel,
  readCompatibilityForPart,
  readModelSummary,
  READ_CAPABILITY,
  type ReadServiceDeps,
} from "./readService";
import { InvalidInputError } from "./errors";

const ACCEPTED_KEYS = ["mode", "partId", "equipmentModelId", "cursor", "limit"] as const;
type Mode = "forwardByPart" | "reverseByModel" | "modelSummary";

// Real #226 seam: resolve the (active:false) read capability against the caller's effective access. A
// throwing resolver is treated by readService as a denial. Nothing here activates or grants anything.
function buildDeps(): ReadServiceDeps {
  return {
    db: getFirestore(),
    resolvePermission: async ({ actorUid, capabilityId }) => {
      const { decisions } = await resolveEffectiveAccess({ principalUid: actorUid, permissionIds: [capabilityId] });
      return decisions[capabilityId] === true;
    },
    // Serial-scheme registry wiring is deferred (a governed registry not yet materialized); an empty
    // registry makes any SERIAL_RANGE relationship fail closed as malformed, never silently accepted.
    serialSchemes: {},
  };
}

export const equipmentCompatibilityReadCallable = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");

  const data = request.data as Record<string, unknown> | null;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new HttpsError("invalid-argument", "Request data must be an object.");
  }
  const extraKeys = Object.keys(data).filter((k) => !ACCEPTED_KEYS.includes(k as (typeof ACCEPTED_KEYS)[number]));
  if (extraKeys.length > 0) {
    throw new HttpsError("invalid-argument", `Unrecognized field(s): ${extraKeys.join(", ")}.`);
  }
  const mode = data.mode as Mode;
  const actorUid = request.auth.uid;
  const deps = buildDeps();
  const cursor = data.cursor === undefined ? undefined : (data.cursor as string);
  const limit = data.limit === undefined ? undefined : (data.limit as number);

  try {
    switch (mode) {
      case "forwardByPart":
        return await readCompatibilityForPart(deps, { actorUid, partId: data.partId as string, cursor, limit });
      case "reverseByModel":
        return await readCompatibilityForModel(deps, { actorUid, equipmentModelId: data.equipmentModelId as string, cursor, limit });
      case "modelSummary":
        return await readModelSummary(deps, { actorUid, equipmentModelId: data.equipmentModelId as string });
      default:
        throw new HttpsError("invalid-argument", 'mode must be "forwardByPart", "reverseByModel", or "modelSummary".');
    }
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    if (err instanceof InvalidInputError) throw new HttpsError("invalid-argument", err.message);
    // Never forward an internal message; the read service already degrades data problems to typed
    // dispositions, so reaching here is an unexpected fault.
    throw new HttpsError("unavailable", "Compatibility could not be read right now. Try again shortly.");
  }
});

// Re-exported for the (later, separately authorized) deployment wiring to reference the capability id.
export { READ_CAPABILITY };
