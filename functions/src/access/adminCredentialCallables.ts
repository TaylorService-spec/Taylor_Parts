// AUTH-PR-3 -- callable Cloud Function adapters for the admin-initiated
// password-reset commands (adminCredentialCommands.ts). Thin, uniform `onCall`
// wrappers mirroring accessCommandCallables.ts: they add exactly (1) deriving
// actorUid from the AUTHENTICATED SERVER CONTEXT only, never client data; (2)
// mapping the typed command errors to safe public HttpsErrors that never leak
// internal paths or reasons; (3) requiring request.auth.
//
// Deployed to eos-platform-sandbox under the per-environment activation program;
// NOT deployed to the production project. The AUTH-UI-3 Admin surface calls them
// only against the emulator; no
// native sender is configured (NOT_CONFIGURED_NATIVE_SEND below) until a
// SEPARATE, later Owner production authorization is issued. As wired the command
// FAILS CLOSED on the unconfigured send capability -- it performs ZERO Auth side
// effects (no send, no reset-link generation, no session revocation).
import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import * as commands from "./adminCredentialCommands";
import { resolveEffectiveAccess } from "./effectiveAccessFeed";
import { buildNativeResetSender } from "./oobCodeOutbound";

const REGION = "us-central1";

/** The governed authority for this surface. Registered `active: false`; see resolveActorFacts. */
const CREDENTIAL_RESET_CAPABILITY = "admin.credentialReset.initiate";

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
// SAFE side (e.g. final-active-admin protection defaults to protect). This IS the
// deployed production adapter wired into `initiateAdminPasswordReset` below (see
// `adminSdkDeps()`) -- deployed to eos-platform-sandbox under the per-environment
// activation program, not a test-only stand-in. What remains unverified is the exact
// PRODUCTION fact sources (employees reciprocal-link field, break-glass marker,
// active-admin authority) behaving correctly against the real project's data --
// that is checked at the AUTH-PROD-1 gate, not deployment of this code itself.
export async function resolveTargetFacts(targetUid: string): Promise<commands.TargetFacts> {
  const authUser = await getAuth().getUser(targetUid).catch(() => null);
  const authExists = authUser !== null;
  const disabled = authUser?.disabled === true;
  const email = authUser?.email ?? null;

  const db = getFirestore();
  const userSnap = await db.collection("users").doc(targetUid).get();
  const userData = userSnap.exists ? (userSnap.data() as Record<string, unknown>) : undefined;
  const userEmployeeId = userData?.employeeId;
  const isBreakGlass = userData?.breakGlass === true || userData?.isBreakGlass === true;

  // GOVERNED reciprocal Employee linkage + authoritative employmentStatus, read
  // from the EXACT employees/{employeeId} doc (userId back-link ONLY; no
  // authUid/uid aliases). employmentStatus is trusted only when the link is
  // reciprocal. Shared with the actor path and the list via resolveEmployeeLinkFacts.
  const employeeId =
    typeof userEmployeeId === "string" && userEmployeeId.length > 0 ? userEmployeeId : null;
  let employeeExists = false;
  let employeeUserId: unknown = undefined;
  let employeeEmploymentStatus: unknown = undefined;
  if (employeeId) {
    const empSnap = await db.collection("employees").doc(employeeId).get();
    employeeExists = empSnap.exists;
    const empData = empSnap.exists ? (empSnap.data() as Record<string, unknown>) : undefined;
    employeeUserId = empData?.userId;
    employeeEmploymentStatus = empData?.employmentStatus;
  }
  const link = commands.resolveEmployeeLinkFacts({
    userEmployeeId,
    employeeExists,
    employeeUserId,
    employeeEmploymentStatus,
    uid: targetUid,
  });

  // ════════════════════ FINAL-ACTIVE-RECOVERABLE-ADMIN PROTECTION ════════════════════
  //
  // Whether the TARGET is an administrator now comes from the authoritative governed Role
  // assignments, never from `users/{uid}.role`. The two could disagree, and when they did this
  // protection was evaluated against a person the platform no longer considers an administrator
  // -- or skipped entirely for one it does, which is the direction that loses the last recoverable
  // admin account.
  //
  // ONE QUERY answers both halves: every active admin assignment. The target holds Admin if any
  // names them; they are the FINAL one if no other principal does.
  //
  // FAIL SAFE, in every direction. If the query cannot run, or returns something malformed, the
  // target is PROTECTED rather than reset -- and there is deliberately no fallback to the legacy
  // role, because a fallback is the old authority waiting for an error to reinstate it.
  const activeAdmins = await db
    .collection("roleAssignments")
    .where("roleId", "==", "admin")
    .where("status", "==", "active")
    .get()
    .catch(() => null);
  // The JUDGEMENT is pure and lives with the other evaluators, where it is tested without a
  // database; this adapter only fetches. Values are passed through UNFILTERED, malformed ones
  // included: an entry the resolver cannot read is evidence about the population, and dropping
  // it here would hand a clean-looking set to a function whose whole job is to distrust it.
  const { isFinalActiveAdmin } = commands.resolveFinalActiveAdmin(
    activeAdmins === null
      ? null
      : activeAdmins.docs.map((d) => (d.data() as { principalUid?: unknown }).principalUid),
    targetUid,
  );

  return {
    authExists,
    disabled,
    email,
    hasEmployeeLink: link.hasEmployeeLink,
    employeeLinkReciprocal: link.employeeLinkReciprocal,
    employmentStatus: link.employmentStatus,
    isBreakGlass,
    isFinalActiveAdmin,
  };
}

// Resolve the actor authorization facts (Auth + Firestore) for PRE-2. Mirrors
// resolveTargetFacts' sourcing but for the AUTHENTICATED ACTOR -- the uid comes
// only from the callable context (never client data). Fail-safe: an
// undeterminable fact defaults to the DENY side; the command additionally fails
// closed if this resolver throws. This IS the deployed production adapter (see
// `actorAuthorizationDeps()` below, wired into both exported callables) -- deployed
// to eos-platform-sandbox under the per-environment activation program. What remains
// unverified is the exact PRODUCTION fact sources (active account state, employees
// reciprocal-link field, governed admin authority) behaving correctly against the
// real project's data -- that is checked at the AUTH-PROD-1 gate, not deployment of
// this code itself.
export async function resolveActorFacts(actorUid: string): Promise<commands.ActorAuthorizationFacts> {
  const authUser = await getAuth().getUser(actorUid).catch(() => null);
  const authExists = authUser !== null;
  const disabled = authUser?.disabled === true;

  const db = getFirestore();
  const userSnap = await db.collection("users").doc(actorUid).get();
  const userData = userSnap.exists ? (userSnap.data() as Record<string, unknown>) : undefined;
  const userEmployeeId = userData?.employeeId;

  // ════════════════════ THE ACTOR'S AUTHORITY IS A CAPABILITY ════════════════════
  //
  // This was `userData?.role === "admin"` -- the legacy string, read off a Firestore document,
  // deciding who could reset another person's credentials. It was the last server-side
  // authorization the platform answered from Firebase data rather than from EOS.
  //
  // `admin.credentialReset.initiate` is `active: false` and is excluded even from
  // per-environment sandbox activation, so this resolves FALSE in every environment today and
  // the command fails closed. Deliberate: activation is a separate production/security gate,
  // and no legacy fallback exists to make an emulator authorize in the meantime.
  const holdsCredentialResetCapability = await resolveCredentialResetCapability(actorUid);

  // Read the EXACT reciprocally-linked Employee document (governed userId back-link
  // only) and its authoritative employmentStatus. The pure resolver enforces the
  // exact-userId contract and only trusts employmentStatus when the link is reciprocal.
  const employeeId =
    typeof userEmployeeId === "string" && userEmployeeId.length > 0 ? userEmployeeId : null;
  let employeeExists = false;
  let employeeUserId: unknown = undefined;
  let employeeEmploymentStatus: unknown = undefined;
  if (employeeId) {
    const empSnap = await db.collection("employees").doc(employeeId).get();
    employeeExists = empSnap.exists;
    const empData = empSnap.exists ? (empSnap.data() as Record<string, unknown>) : undefined;
    employeeUserId = empData?.userId;
    employeeEmploymentStatus = empData?.employmentStatus;
  }

  const link = commands.resolveEmployeeLinkFacts({
    userEmployeeId,
    employeeExists,
    employeeUserId,
    employeeEmploymentStatus,
    uid: actorUid,
  });

  return {
    authExists,
    disabled,
    holdsCredentialResetCapability,
    hasEmployeeLink: link.hasEmployeeLink,
    employeeLinkReciprocal: link.employeeLinkReciprocal,
    employmentStatus: link.employmentStatus,
  };
}

/**
 * Resolve the credential-reset capability for one principal. FAIL-CLOSED.
 *
 * A resolver that throws is a DENIAL, never an allow. A capability check whose error path lets
 * the caller through is worse than no check at all, because it looks like one -- and this
 * particular caller is asking to reset somebody else's credentials.
 */
async function resolveCredentialResetCapability(principalUid: string): Promise<boolean> {
  try {
    const { decisions } = await resolveEffectiveAccess({
      principalUid,
      permissionIds: [CREDENTIAL_RESET_CAPABILITY],
    });
    return decisions[CREDENTIAL_RESET_CAPABILITY] === true;
  } catch (err) {
    console.error("[adminCredential] capability resolution failed", err);
    return false;
  }
}

// Single source of the actor-authorization gate for BOTH callables: the deployed
// production adapter `resolveActorFacts`. Exported so the Auth+Firestore emulator
// suite exercises the exact function the callables wire (no divergent test path).
export function actorAuthorizationDeps(): commands.ActorAuthorizationDeps {
  return { resolveActorFacts };
}

// The deployed native sender is built through the FAIL-CLOSED builder with NO config
// (`null`): validateNativeSendConfig fails -> the builder returns the `outbound: null`
// sender, so `isConfigured()` is false and the command performs ZERO Auth side effects
// (no send, no revocation, no reset-link generation) and no email is ever sent. The
// concrete accounts:sendOobCode outbound (oobCodeOutbound.ts) exists but is wired only
// at a later, separately authorized AUTH-PROD config/enablement gate that supplies a
// validated config + Secret Manager credential (D-NATIVE-SEND-CONFIG; never an external
// provider, #54). Real-Firebase native-send is the separate D-PROD-1C verification.
export const DEPLOYED_NATIVE_SENDER = buildNativeResetSender(null);

function adminSdkDeps(): commands.AdminResetDeps {
  return {
    ...actorAuthorizationDeps(),
    resolveTargetFacts,
    nativeSend: DEPLOYED_NATIVE_SENDER,
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
      actorAuthorizationDeps(),
    );
    return { users };
  } catch (err) {
    throw mapError(err);
  }
});
