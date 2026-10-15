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
exports.listRecordChangeHistory = exports.updateEmployeeProfile = void 0;
// ADMINISTRATION USERS CONSOLIDATION -- the callable adapters for the two new Administration >
// Users surfaces: the governed Employee profile write, and the record-scoped Change History read.
//
// The SAME thin-adapter contract accessCommandCallables.ts sets, and for the same three reasons:
// `actorUid` is derived from the AUTHENTICATED SERVER CONTEXT and from nothing else (a client that
// sends one is ignored -- no adapter below reads `data.actorUid`); the command modules' typed
// errors are mapped to safe public HttpsErrors that never leak a Firestore path, a resolver reason
// code or a stack; and `request.auth` is required at all.
//
// Every authorization, validation and audit decision lives in the command modules and is
// re-implemented nowhere here.
//
// DEPLOYMENT POSTURE, unchanged from every other surface in this file's neighbourhood: these
// deploy to eos-platform-sandbox under the per-environment activation program and are NOT deployed
// to the production project. Both deny today in every environment for the standing platform
// reason -- no principal holds a `roleAssignments` document, so every governed capability
// resolution denies -- which the Users surface states on screen rather than hiding.
const https_1 = require("firebase-functions/v2/https");
const employeeProfile = __importStar(require("./employeeProfileCommands"));
const changeHistory = __importStar(require("./recordChangeHistoryReadService"));
const REGION = "us-central1";
function requireActorUid(request) {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    }
    return request.auth.uid;
}
function asRecord(data) {
    return typeof data === "object" && data !== null ? data : {};
}
function mapError(err) {
    if (err instanceof https_1.HttpsError)
        return err;
    // Entirely about the caller's own submitted input -- which field, which vocabulary. Safe, and
    // the only class of message an edit form can actually act on.
    if (err instanceof employeeProfile.InvalidInputError ||
        err instanceof changeHistory.InvalidInputError) {
        return new https_1.HttpsError("invalid-argument", err.message);
    }
    // The specific denial REASON is access-model internal state. The caller learns that they may
    // not, never why the resolver said so.
    if (err instanceof employeeProfile.UnauthorizedActorError ||
        err instanceof changeHistory.UnauthorizedActorError) {
        return new https_1.HttpsError("permission-denied", "You are not authorized to perform this action.");
    }
    // "The employee does not exist" and "the manager you chose does not exist" are both facts about
    // ids the CALLER submitted, and both are actionable. Neither names a collection path.
    if (err instanceof employeeProfile.EmployeeNotFoundError) {
        return new https_1.HttpsError("not-found", "This employee record could not be found.");
    }
    if (err instanceof employeeProfile.UnknownManagerError) {
        return new https_1.HttpsError("failed-precondition", "The selected manager is not an existing employee.");
    }
    if (err instanceof employeeProfile.IdempotencyKeyConflictError) {
        return new https_1.HttpsError("already-exists", "This request key has already been used for a different request. Try again.");
    }
    // The number the caller themselves submitted is already assigned. Safe to say plainly, and the
    // only thing they can act on -- and deliberately WITHOUT naming who holds it: an administrator
    // editing one record does not need another person's identity to fix their own typo.
    if (err instanceof employeeProfile.EmployeeNumberTakenError) {
        return new https_1.HttpsError("already-exists", "That Employee ID is already assigned to another employee. Choose a different one.");
    }
    return new https_1.HttpsError("internal", "An unexpected error occurred. Please try again.");
}
/**
 * Edit an Employee's profile / employment record.
 *
 * `changes` is a field-key map. The command rejects any key outside its editable set BY NAME,
 * including securityRole, userId and account status -- so this adapter needs no allow-list of its
 * own, and cannot drift from the one that enforces.
 */
exports.updateEmployeeProfile = (0, https_1.onCall)({ region: REGION }, async (request) => {
    const actorUid = requireActorUid(request);
    const data = asRecord(request.data);
    try {
        return await employeeProfile.updateEmployeeProfile({
            actorUid,
            employeeId: data.employeeId,
            changes: asRecord(data.changes),
            idempotencyKey: data.idempotencyKey,
        });
    }
    catch (err) {
        throw mapError(err);
    }
});
/**
 * One record's authoritative change history, newest first.
 *
 * Read-only, mutates nothing, and writes NO Audit Event of its own -- the same posture
 * resolveEffectiveAccessCallable takes, and for a sharper reason here: an audited denied read of
 * the audit trail would let an unauthorized caller append to the trail they were refused.
 */
exports.listRecordChangeHistory = (0, https_1.onCall)({ region: REGION }, async (request) => {
    const actorUid = requireActorUid(request);
    const data = asRecord(request.data);
    try {
        const rows = await changeHistory.listRecordChangeHistory({
            actorUid,
            targetType: data.targetType,
            targetId: data.targetId,
            limit: typeof data.limit === "number" ? data.limit : undefined,
        });
        return { rows };
    }
    catch (err) {
        throw mapError(err);
    }
});
//# sourceMappingURL=administrationUsersCallables.js.map