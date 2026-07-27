// AUTH-PR-3 -- callable Cloud Function adapters for the admin-initiated
// password-reset commands (adminCredentialCommands.ts). Thin, uniform `onCall`
// wrappers mirroring accessCommandCallables.ts: they add exactly (1) deriving
// actorUid from the AUTHENTICATED SERVER CONTEXT only, never client data; (2)
// mapping the typed command errors to safe public HttpsErrors that never leak
// internal paths or reasons; (3) requiring request.auth.
//
// "Export is not deployment": exporting these from index.ts does NOT deploy
// them. No Admin UI is wired to call them and no email provider is configured
// (NOT_CONFIGURED_DELIVERY below) until a SEPARATE, later Owner production
// authorization is issued. As deployed with NOT_CONFIGURED_DELIVERY, a routine
// call generates a reset link, sends NO email, and performs NO revocation.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";
import * as commands from "./adminCredentialCommands";

const REGION = "us-central1";

function mapError(err: unknown): HttpsError {
  if (err instanceof HttpsError) return err;
  // Client's own submitted input (bad idempotencyKey/mode) -- safe to reflect.
  if (err instanceof commands.InvalidInputError) {
    return new HttpsError("invalid-argument", err.message);
  }
  // About the ACTOR's authorization, never the target -- reason withheld.
  if (err instanceof commands.UnauthorizedActorError) {
    return new HttpsError("permission-denied", "You are not authorized to perform this action.");
  }
  // The actor's own action choice (self-reset) -- not a target-eligibility leak.
  if (err instanceof commands.ProtectedAccountError) {
    return new HttpsError("failed-precondition", err.message);
  }
  // System capability state (not target-specific).
  if (err instanceof commands.DeliveryUnavailableError) {
    return new HttpsError("unavailable", "Password reset delivery is not available. Please try again later.");
  }
  // The caller's own idempotency key -- in progress / recently attempted.
  if (err instanceof commands.OperationInProgressError) {
    return new HttpsError("aborted", "A reset for this request is already in progress.");
  }
  if (err instanceof commands.RetryCooldownError) {
    return new HttpsError("unavailable", "This request was attempted recently. Please try again shortly.");
  }
  // A genuine stage failure -- deliberately GENERIC (never the target-eligibility
  // reason, provider error, path, link, or token; those live only in audit).
  if (err instanceof commands.AdminResetStageError) {
    return new HttpsError("unavailable", "The request could not be completed. Please try again.");
  }
  // Never leak an unrecognized error's message, class name, or stack.
  return new HttpsError("internal", "An unexpected error occurred. Please try again.");
}

function requireAuthUid(request: CallableRequest): string {
  if (!request.auth || typeof request.auth.uid !== "string" || request.auth.uid.length === 0) {
    throw new HttpsError("unauthenticated", "Authentication is required.");
  }
  return request.auth.uid;
}

// The Admin-SDK deps, wired with NOT_CONFIGURED_DELIVERY so no email is sent
// until an Owner-approved provider (D-EMAIL-DELIVERY) is added here.
function adminSdkDeps(): commands.AdminResetDeps {
  return {
    generateResetLink: (email: string) => getAuth().generatePasswordResetLink(email),
    revokeRefreshTokens: (uid: string) => getAuth().revokeRefreshTokens(uid),
    getRecoverableEmail: async (uid: string) => {
      const user = await getAuth().getUser(uid).catch(() => null);
      return user?.email ?? null;
    },
    delivery: commands.NOT_CONFIGURED_DELIVERY,
  };
}

export const initiateAdminPasswordReset = onCall({ region: REGION }, async (request) => {
  const actorUid = requireAuthUid(request);
  const data = (request.data ?? {}) as { targetUid?: unknown; mode?: unknown; idempotencyKey?: unknown };
  try {
    const outcome = await commands.initiateAdminPasswordReset(
      {
        actorUid,
        targetUid: typeof data.targetUid === "string" ? data.targetUid : "",
        idempotencyKey: typeof data.idempotencyKey === "string" ? data.idempotencyKey : "",
        mode: data.mode as commands.ResetMode | undefined,
      },
      adminSdkDeps(),
    );
    // Neutral status only -- never the reset link, token, target email, or a
    // target-eligibility / delivery-outcome reason.
    return outcome;
  } catch (err) {
    throw mapError(err);
  }
});

export const listResetEligibleUsers = onCall({ region: REGION }, async (request) => {
  const actorUid = requireAuthUid(request);
  const data = (request.data ?? {}) as { limit?: unknown };
  try {
    const users = await commands.listResetEligibleUsers({
      actorUid,
      limit: typeof data.limit === "number" ? data.limit : undefined,
    });
    return { users };
  } catch (err) {
    throw mapError(err);
  }
});
