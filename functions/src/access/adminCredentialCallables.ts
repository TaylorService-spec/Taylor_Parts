// AUTH-PR-3 -- callable Cloud Function adapters for the admin-initiated
// password-reset commands (adminCredentialCommands.ts). Thin, uniform `onCall`
// wrappers mirroring accessCommandCallables.ts: they add exactly (1) deriving
// actorUid from the AUTHENTICATED SERVER CONTEXT only, never client data; (2)
// mapping the typed command errors to safe public HttpsErrors that never leak
// internal paths or reasons; (3) requiring request.auth.
//
// "Export is not deployment": exporting these from index.ts does NOT deploy
// them. The AUTH-UI-3 Admin surface calls them only against the emulator; no
// native sender is configured (NOT_CONFIGURED_NATIVE_SEND below) until a
// SEPARATE, later Owner production authorization is issued. As wired the command
// FAILS CLOSED on the unconfigured send capability -- it performs ZERO Auth side
// effects (no send, no reset-link generation, no session revocation).
import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
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
  // The caller's own idempotency key -- in progress / recently attempted / reused
  // for a different request.
  if (err instanceof commands.OperationInProgressError) {
    return new HttpsError("aborted", "A reset for this request is already in progress.");
  }
  if (err instanceof commands.RetryCooldownError) {
    return new HttpsError("unavailable", "This request was attempted recently. Please try again shortly.");
  }
  if (err instanceof commands.OperationKeyConflictError) {
    return new HttpsError("already-exists", "This idempotency key was already used for a different request. Use a new key.");
  }
  // A malformed stored operation record fails closed, generically.
  if (err instanceof commands.MalformedOperationError) {
    return new HttpsError("failed-precondition", "The request could not be processed. Please try again with a new idempotency key.");
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

// Resolve the guard facts for a target from Auth + Firestore (AUTH-PR-3.5).
// Conservative/fail-safe: if a fact cannot be determined it defaults to the
// SAFE side (e.g. final-active-admin protection defaults to protect). The exact
// production fact sources (employees reciprocal-link field, break-glass marker,
// active-admin authority) are VERIFIED at the AUTH-PROD-1 gate against the real
// project -- this adapter is emulator/repository-only and NOT deployed/enabled.
async function resolveTargetFacts(targetUid: string): Promise<commands.TargetFacts> {
  const authUser = await getAuth().getUser(targetUid).catch(() => null);
  const authExists = authUser !== null;
  const disabled = authUser?.disabled === true;
  const email = authUser?.email ?? null;

  const db = getFirestore();
  const userSnap = await db.collection("users").doc(targetUid).get();
  const userData = userSnap.exists ? (userSnap.data() as Record<string, unknown>) : undefined;
  const employeeId =
    typeof userData?.employeeId === "string" && (userData.employeeId as string).length > 0
      ? (userData.employeeId as string)
      : null;
  const hasEmployeeLink = employeeId !== null;
  const isBreakGlass = userData?.breakGlass === true || userData?.isBreakGlass === true;

  // Reciprocal Employee<->Auth linkage: employees/{employeeId} must link back to
  // this uid. Accept any of the observed back-link field names.
  let employeeLinkReciprocal = false;
  if (employeeId) {
    const empSnap = await db.collection("employees").doc(employeeId).get();
    const empData = empSnap.exists ? (empSnap.data() as Record<string, unknown>) : undefined;
    employeeLinkReciprocal =
      empData?.userId === targetUid || empData?.authUid === targetUid || empData?.uid === targetUid;
  }

  // Final-active-recoverable-admin protection. If the target is an admin and no
  // OTHER active admin roleAssignment exists, protect. Fail-safe: if the query
  // cannot run, treat an admin target as final (protect).
  const targetIsAdmin = userData?.role === "admin";
  let isFinalActiveAdmin = false;
  if (targetIsAdmin) {
    const activeAdmins = await db
      .collection("roleAssignments")
      .where("roleId", "==", "admin")
      .where("status", "==", "active")
      .get()
      .catch(() => null);
    if (activeAdmins) {
      const others = activeAdmins.docs.filter(
        (d) => (d.data() as { principalUid?: unknown }).principalUid !== targetUid,
      );
      isFinalActiveAdmin = others.length === 0;
    } else {
      isFinalActiveAdmin = true;
    }
  }

  return { authExists, disabled, email, hasEmployeeLink, employeeLinkReciprocal, isBreakGlass, isFinalActiveAdmin };
}

// Resolve the actor authorization facts (Auth + Firestore) for PRE-2. Mirrors
// resolveTargetFacts' sourcing but for the AUTHENTICATED ACTOR -- the uid comes
// only from the callable context (never client data). Fail-safe: an
// undeterminable fact defaults to the DENY side; the command additionally fails
// closed if this resolver throws. The exact production fact sources (active
// account state, employees reciprocal-link field, governed admin authority) are
// VERIFIED at the AUTH-PROD-1 gate against the real project -- this adapter is
// emulator/repository-only and NOT deployed/enabled.
async function resolveActorFacts(actorUid: string): Promise<commands.ActorAuthorizationFacts> {
  const authUser = await getAuth().getUser(actorUid).catch(() => null);
  const authExists = authUser !== null;
  const disabled = authUser?.disabled === true;

  const db = getFirestore();
  const userSnap = await db.collection("users").doc(actorUid).get();
  const userData = userSnap.exists ? (userSnap.data() as Record<string, unknown>) : undefined;
  const isAdmin = userData?.role === "admin";
  const employeeId =
    typeof userData?.employeeId === "string" && (userData.employeeId as string).length > 0
      ? (userData.employeeId as string)
      : null;
  const hasEmployeeLink = employeeId !== null;

  // Reciprocal Employee<->Auth linkage: employees/{employeeId} must link back to
  // this actor uid. Accept any of the observed back-link field names.
  let employeeLinkReciprocal = false;
  if (employeeId) {
    const empSnap = await db.collection("employees").doc(employeeId).get();
    const empData = empSnap.exists ? (empSnap.data() as Record<string, unknown>) : undefined;
    employeeLinkReciprocal =
      empData?.userId === actorUid || empData?.authUid === actorUid || empData?.uid === actorUid;
  }

  return { authExists, disabled, isAdmin, hasEmployeeLink, employeeLinkReciprocal };
}

// The Admin-SDK deps, wired with NOT_CONFIGURED_NATIVE_SEND so NO email is sent
// until an Owner-authorized Firebase-native sender is wired at the AUTH-PROD
// enablement gate (D-DELIVERY-NATIVE, DECISIONS #56 -- NEVER an external
// provider, #54). As wired, the command FAILS CLOSED on the send-capability
// check and performs ZERO Auth side effects (no send, no revocation, and no
// reset-link generation at all -- link generation was removed for the native
// path). Real-Firebase earlier-link consumability + native-send behavior are the
// separate AUTH-PROD-1 verification.
function adminSdkDeps(): commands.AdminResetDeps {
  return {
    resolveActorFacts,
    resolveTargetFacts,
    nativeSend: commands.NOT_CONFIGURED_NATIVE_SEND,
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
    const users = await commands.listResetEligibleUsers(
      {
        actorUid,
        limit: typeof data.limit === "number" ? data.limit : undefined,
      },
      { resolveActorFacts },
    );
    return { users };
  } catch (err) {
    throw mapError(err);
  }
});
