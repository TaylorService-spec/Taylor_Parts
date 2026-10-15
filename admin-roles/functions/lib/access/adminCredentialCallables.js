"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.listResetEligibleUsers = exports.initiateAdminPasswordReset = exports.DEPLOYED_NATIVE_SENDER = void 0;
exports.resolveTargetFacts = resolveTargetFacts;
exports.resolveActorFacts = resolveActorFacts;
exports.actorAuthorizationDeps = actorAuthorizationDeps;
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
const https_1 = require("firebase-functions/v2/https");
const auth_1 = require("firebase-admin/auth");
const firestore_1 = require("firebase-admin/firestore");
const commands = __importStar(require("./adminCredentialCommands"));
const oobCodeOutbound_1 = require("./oobCodeOutbound");
const REGION = "us-central1";
function mapError(err) {
    if (err instanceof https_1.HttpsError)
        return err;
    // Client's own submitted input (bad idempotencyKey/mode) -- safe to reflect.
    if (err instanceof commands.InvalidInputError) {
        return new https_1.HttpsError("invalid-argument", err.message);
    }
    // About the ACTOR's authorization, never the target -- reason withheld.
    if (err instanceof commands.UnauthorizedActorError) {
        return new https_1.HttpsError("permission-denied", "You are not authorized to perform this action.");
    }
    // The actor's own action choice (self-reset) -- not a target-eligibility leak.
    if (err instanceof commands.ProtectedAccountError) {
        return new https_1.HttpsError("failed-precondition", err.message);
    }
    // System capability state (not target-specific).
    if (err instanceof commands.DeliveryUnavailableError) {
        return new https_1.HttpsError("unavailable", "Password reset delivery is not available. Please try again later.");
    }
    // The caller's own idempotency key -- in progress / recently attempted / reused
    // for a different request.
    if (err instanceof commands.OperationInProgressError) {
        return new https_1.HttpsError("aborted", "A reset for this request is already in progress.");
    }
    if (err instanceof commands.RetryCooldownError) {
        return new https_1.HttpsError("unavailable", "This request was attempted recently. Please try again shortly.");
    }
    if (err instanceof commands.OperationKeyConflictError) {
        return new https_1.HttpsError("already-exists", "This idempotency key was already used for a different request. Use a new key.");
    }
    // A malformed stored operation record fails closed, generically.
    if (err instanceof commands.MalformedOperationError) {
        return new https_1.HttpsError("failed-precondition", "The request could not be processed. Please try again with a new idempotency key.");
    }
    // A genuine stage failure -- deliberately GENERIC (never the target-eligibility
    // reason, provider error, path, link, or token; those live only in audit).
    if (err instanceof commands.AdminResetStageError) {
        return new https_1.HttpsError("unavailable", "The request could not be completed. Please try again.");
    }
    // Never leak an unrecognized error's message, class name, or stack.
    return new https_1.HttpsError("internal", "An unexpected error occurred. Please try again.");
}
function requireAuthUid(request) {
    if (!request.auth || typeof request.auth.uid !== "string" || request.auth.uid.length === 0) {
        throw new https_1.HttpsError("unauthenticated", "Authentication is required.");
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
async function resolveTargetFacts(targetUid) {
    const authUser = await (0, auth_1.getAuth)().getUser(targetUid).catch(() => null);
    const authExists = authUser !== null;
    const disabled = authUser?.disabled === true;
    const email = authUser?.email ?? null;
    const db = (0, firestore_1.getFirestore)();
    const userSnap = await db.collection("users").doc(targetUid).get();
    const userData = userSnap.exists ? userSnap.data() : undefined;
    const userEmployeeId = userData?.employeeId;
    const isBreakGlass = userData?.breakGlass === true || userData?.isBreakGlass === true;
    // GOVERNED reciprocal Employee linkage + authoritative employmentStatus, read
    // from the EXACT employees/{employeeId} doc (userId back-link ONLY; no
    // authUid/uid aliases). employmentStatus is trusted only when the link is
    // reciprocal. Shared with the actor path and the list via resolveEmployeeLinkFacts.
    const employeeId = typeof userEmployeeId === "string" && userEmployeeId.length > 0 ? userEmployeeId : null;
    let employeeExists = false;
    let employeeUserId = undefined;
    let employeeEmploymentStatus = undefined;
    if (employeeId) {
        const empSnap = await db.collection("employees").doc(employeeId).get();
        employeeExists = empSnap.exists;
        const empData = empSnap.exists ? empSnap.data() : undefined;
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
            const others = activeAdmins.docs.filter((d) => d.data().principalUid !== targetUid);
            isFinalActiveAdmin = others.length === 0;
        }
        else {
            isFinalActiveAdmin = true;
        }
    }
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
async function resolveActorFacts(actorUid) {
    const authUser = await (0, auth_1.getAuth)().getUser(actorUid).catch(() => null);
    const authExists = authUser !== null;
    const disabled = authUser?.disabled === true;
    const db = (0, firestore_1.getFirestore)();
    const userSnap = await db.collection("users").doc(actorUid).get();
    const userData = userSnap.exists ? userSnap.data() : undefined;
    const isAdmin = userData?.role === "admin";
    const userEmployeeId = userData?.employeeId;
    // Read the EXACT reciprocally-linked Employee document (governed userId back-link
    // only) and its authoritative employmentStatus. The pure resolver enforces the
    // exact-userId contract and only trusts employmentStatus when the link is reciprocal.
    const employeeId = typeof userEmployeeId === "string" && userEmployeeId.length > 0 ? userEmployeeId : null;
    let employeeExists = false;
    let employeeUserId = undefined;
    let employeeEmploymentStatus = undefined;
    if (employeeId) {
        const empSnap = await db.collection("employees").doc(employeeId).get();
        employeeExists = empSnap.exists;
        const empData = empSnap.exists ? empSnap.data() : undefined;
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
        isAdmin,
        hasEmployeeLink: link.hasEmployeeLink,
        employeeLinkReciprocal: link.employeeLinkReciprocal,
        employmentStatus: link.employmentStatus,
    };
}
// Single source of the actor-authorization gate for BOTH callables: the deployed
// production adapter `resolveActorFacts`. Exported so the Auth+Firestore emulator
// suite exercises the exact function the callables wire (no divergent test path).
function actorAuthorizationDeps() {
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
exports.DEPLOYED_NATIVE_SENDER = (0, oobCodeOutbound_1.buildNativeResetSender)(null);
function adminSdkDeps() {
    return {
        ...actorAuthorizationDeps(),
        resolveTargetFacts,
        nativeSend: exports.DEPLOYED_NATIVE_SENDER,
    };
}
exports.initiateAdminPasswordReset = (0, https_1.onCall)({ region: REGION }, async (request) => {
    const actorUid = requireAuthUid(request);
    const data = (request.data ?? {});
    try {
        const outcome = await commands.initiateAdminPasswordReset({
            actorUid,
            targetUid: typeof data.targetUid === "string" ? data.targetUid : "",
            idempotencyKey: typeof data.idempotencyKey === "string" ? data.idempotencyKey : "",
            mode: data.mode,
        }, adminSdkDeps());
        // Neutral status only -- never the reset link, token, target email, or a
        // target-eligibility / delivery-outcome reason.
        return outcome;
    }
    catch (err) {
        throw mapError(err);
    }
});
exports.listResetEligibleUsers = (0, https_1.onCall)({ region: REGION }, async (request) => {
    const actorUid = requireAuthUid(request);
    const data = (request.data ?? {});
    try {
        const users = await commands.listResetEligibleUsers({
            actorUid,
            limit: typeof data.limit === "number" ? data.limit : undefined,
        }, actorAuthorizationDeps());
        return { users };
    }
    catch (err) {
        throw mapError(err);
    }
});
//# sourceMappingURL=adminCredentialCallables.js.map