"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getInboundWorkAttachment = exports.retryEmailDelivery = exports.pollEmailMailboxNow = exports.getEmailProviderReadiness = exports.disconnectEmailConnection = exports.testEmailConnection = exports.completeEmailConnectionAuthorization = exports.startEmailConnectionAuthorization = exports.MAX_INLINE_ATTACHMENT_BYTES = void 0;
// Email Connections -- THE TRANSPORT CALLABLE SURFACE: connect a real mailbox, test it, disconnect it,
// poll it now, retry a failed delivery, and read an attachment's bytes.
//
// EVERY ONE OF THESE IS NON-PRODUCTION ONLY, and the guard is the same one Data Import and the #1811
// delivery seam already use: the runtime's own project identity, checked before any authority is even
// evaluated, refusing `taylor-parts` by name and every registry environment whose role is production.
// Production provider binding, production mailbox polling and production attachment ingestion are not
// authorized, so the code refuses them rather than relying on nobody clicking.
//
// AUTHORITY REUSES #1811's, deliberately: connecting and testing are `administration.emailIntake.manage`,
// and reading an attachment is `service.inboundWork.read` -- the SAME capability that opens the inbound
// request the attachment belongs to. Inventing an `attachment.read` capability would create a permission
// somebody could hold without being able to open the record it describes, which is not a boundary anyone
// wants to administer.
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const effectiveAccessFeed_1 = require("../access/effectiveAccessFeed");
const importTargetGuard_1 = require("../dataImport/importTargetGuard");
const collections_1 = require("../constants/collections");
const inboundWorkModel_1 = require("./inboundWorkModel");
const emailProvider_1 = require("./emailProvider");
const inboundWorkReadService_1 = require("./inboundWorkReadService");
const providerAuthorizationState_1 = require("./providerAuthorizationState");
const providerTransport_1 = require("./providerTransport");
const providerTransportFactory_1 = require("./providerTransportFactory");
const providerCredentialVault_1 = require("./providerCredentialVault");
const attachmentCustody_1 = require("./attachmentCustody");
const emailConnectionCommands_1 = require("./emailConnectionCommands");
const emailDeliveryService_1 = require("./emailDeliveryService");
const REGION = "us-central1";
const ADMIN_EMAIL_INTAKE_MANAGE = "administration.emailIntake.manage";
const INBOUND_WORK_READ = "service.inboundWork.read";
/** Bytes returned inline to the browser. Bigger files need a streaming download, which is P2. */
exports.MAX_INLINE_ATTACHMENT_BYTES = 6 * 1024 * 1024;
function projectId() {
    return process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? "";
}
/** The production boundary. Called FIRST in every callable below, before authority resolution. */
function assertNonProductionRuntime() {
    try {
        (0, importTargetGuard_1.assertNonProductionImportTarget)(projectId());
    }
    catch (err) {
        throw new https_1.HttpsError("failed-precondition", `Real email provider transport is not available in this environment. ${err.message}`);
    }
}
async function requireCapability(uid, capability) {
    let allowed = false;
    try {
        const { decisions } = await (0, effectiveAccessFeed_1.resolveEffectiveAccess)({ principalUid: uid, permissionIds: [capability] });
        allowed = decisions[capability] === true;
    }
    catch (err) {
        console.error(`[emailTransport] capability resolution failed for ${capability}`, err);
        allowed = false;
    }
    if (!allowed)
        throw new https_1.HttpsError("permission-denied", "You are not authorized to perform this action.");
}
function callerUid(request) {
    const uid = request.auth?.uid;
    if (!uid)
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    return uid;
}
/**
 * Domain error -> client error, with the failure code preserved and the provider's own words discarded.
 * An OAuth state refusal is `permission-denied` because that is what it is: the caller presented
 * something EOS will not accept as proof.
 */
function toHttpsError(err) {
    if (err instanceof https_1.HttpsError)
        return err;
    if (err instanceof providerAuthorizationState_1.OAuthStateError)
        return new https_1.HttpsError("permission-denied", err.message, { code: err.code });
    if (err instanceof providerTransport_1.ProviderTransportError) {
        const code = err.code === "AUTH_REVOKED" || err.code === "AUTH_EXPIRED" ? "failed-precondition" : err.code === "CONFIGURATION_INVALID" ? "invalid-argument" : "unavailable";
        return new https_1.HttpsError(code, err.message, { code: err.code });
    }
    console.error("[emailTransport] unexpected failure", err);
    return new https_1.HttpsError("internal", "That action is temporarily unavailable.");
}
const commandDeps = () => ({ transportFor: providerTransportFactory_1.transportFor, vault: (0, providerCredentialVault_1.createSecretManagerVault)(projectId()) });
// ── Connect ──────────────────────────────────────────────────────────────────────────────────────
exports.startEmailConnectionAuthorization = (0, https_1.onCall)({ region: REGION, secrets: providerTransportFactory_1.EMAIL_PROVIDER_SECRETS }, async (request) => {
    assertNonProductionRuntime();
    const uid = callerUid(request);
    await requireCapability(uid, ADMIN_EMAIL_INTAKE_MANAGE);
    const d = (request.data ?? {});
    try {
        return await (0, emailConnectionCommands_1.startConnectionAuthorization)((0, firestore_1.getFirestore)(), { connectionId: (0, inboundWorkModel_1.boundedString)(d.connectionId, 255), actorUid: uid, redirectUri: (0, inboundWorkModel_1.boundedString)(d.redirectUri, 500) }, commandDeps());
    }
    catch (err) {
        throw toHttpsError(err);
    }
});
exports.completeEmailConnectionAuthorization = (0, https_1.onCall)({ region: REGION, secrets: providerTransportFactory_1.EMAIL_PROVIDER_SECRETS }, async (request) => {
    assertNonProductionRuntime();
    const uid = callerUid(request);
    await requireCapability(uid, ADMIN_EMAIL_INTAKE_MANAGE);
    const d = (request.data ?? {});
    try {
        return await (0, emailConnectionCommands_1.completeConnectionAuthorization)((0, firestore_1.getFirestore)(), {
            connectionId: (0, inboundWorkModel_1.boundedString)(d.connectionId, 255),
            actorUid: uid,
            state: (0, inboundWorkModel_1.boundedString)(d.state, 500),
            code: (0, inboundWorkModel_1.boundedString)(d.code, 4000),
            redirectUri: (0, inboundWorkModel_1.boundedString)(d.redirectUri, 500),
        }, commandDeps());
    }
    catch (err) {
        throw toHttpsError(err);
    }
});
exports.testEmailConnection = (0, https_1.onCall)({ region: REGION, secrets: providerTransportFactory_1.EMAIL_PROVIDER_SECRETS }, async (request) => {
    assertNonProductionRuntime();
    const uid = callerUid(request);
    await requireCapability(uid, ADMIN_EMAIL_INTAKE_MANAGE);
    try {
        return await (0, emailConnectionCommands_1.testConnection)((0, firestore_1.getFirestore)(), { connectionId: (0, inboundWorkModel_1.boundedString)(request.data?.connectionId, 255), actorUid: uid }, commandDeps());
    }
    catch (err) {
        throw toHttpsError(err);
    }
});
exports.disconnectEmailConnection = (0, https_1.onCall)({ region: REGION, secrets: providerTransportFactory_1.EMAIL_PROVIDER_SECRETS }, async (request) => {
    assertNonProductionRuntime();
    const uid = callerUid(request);
    await requireCapability(uid, ADMIN_EMAIL_INTAKE_MANAGE);
    try {
        return await (0, emailConnectionCommands_1.disconnectConnection)((0, firestore_1.getFirestore)(), { connectionId: (0, inboundWorkModel_1.boundedString)(request.data?.connectionId, 255), actorUid: uid }, commandDeps());
    }
    catch (err) {
        throw toHttpsError(err);
    }
});
/** What this runtime can actually offer, so Administration can say so instead of guessing. */
exports.getEmailProviderReadiness = (0, https_1.onCall)({ region: REGION, secrets: providerTransportFactory_1.EMAIL_PROVIDER_SECRETS }, async (request) => {
    const uid = callerUid(request);
    await requireCapability(uid, "administration.emailIntake.read");
    let productionRefusal = null;
    try {
        (0, importTargetGuard_1.assertNonProductionImportTarget)(projectId());
    }
    catch (err) {
        productionRefusal = err.message;
    }
    return {
        // No secret value, and no hint of one: only whether this runtime has a client at all.
        microsoftConfigured: (0, providerTransportFactory_1.providerClientConfigured)("MICROSOFT_365"),
        googleConfigured: (0, providerTransportFactory_1.providerClientConfigured)("GOOGLE_WORKSPACE"),
        transportAvailable: productionRefusal === null,
        productionRefusal,
    };
});
// ── Deliver ──────────────────────────────────────────────────────────────────────────────────────
async function loadConnectionAndMailbox(mailboxId) {
    const db = (0, firestore_1.getFirestore)();
    const mailbox = await (0, inboundWorkReadService_1.readMailbox)(db, mailboxId);
    if (!mailbox)
        throw new https_1.HttpsError("not-found", "That mailbox is not configured.");
    const snap = await db.collection(collections_1.EMAIL_CONNECTIONS_COLLECTION).doc(mailbox.connectionId).get();
    if (!snap.exists)
        throw new https_1.HttpsError("not-found", "That mailbox's connection no longer exists.");
    const data = snap.data();
    const provider = data.provider;
    if (!(0, emailProvider_1.isEmailProviderId)(provider))
        throw new https_1.HttpsError("failed-precondition", "That connection has no valid provider.");
    return {
        connection: {
            id: snap.id,
            provider,
            tenantOrWorkspace: (0, inboundWorkModel_1.boundedString)(data.tenantOrWorkspace, 255),
            connectedAccount: (0, inboundWorkModel_1.boundedString)(data.connectedAccount, 255),
            inboundEnabled: data.inboundEnabled !== false,
            oauthStatus: (0, inboundWorkModel_1.boundedString)(data.oauthStatus, 60),
        },
        mailbox,
    };
}
/**
 * POLL NOW. The same poll the schedule runs, on demand -- so an administrator finishing a connection can
 * see it work rather than waiting for the next tick. It is not a second delivery path: it calls the same
 * function with the same arguments.
 */
exports.pollEmailMailboxNow = (0, https_1.onCall)({ region: REGION, secrets: providerTransportFactory_1.EMAIL_PROVIDER_SECRETS, timeoutSeconds: 300 }, async (request) => {
    assertNonProductionRuntime();
    const uid = callerUid(request);
    await requireCapability(uid, ADMIN_EMAIL_INTAKE_MANAGE);
    const mailboxId = (0, inboundWorkModel_1.boundedString)(request.data?.mailboxId, 255);
    try {
        const { connection, mailbox } = await loadConnectionAndMailbox(mailboxId);
        const db = (0, firestore_1.getFirestore)();
        const cursorSnap = await db.collection(collections_1.EMAIL_MAILBOXES_COLLECTION).doc(mailboxId).get();
        return await (0, emailDeliveryService_1.pollMailboxOnce)(db, connection, { ...mailbox, deliveryCursor: cursorSnap.data()?.deliveryCursor }, { adapter: (0, providerTransportFactory_1.transportFor)(connection.provider), vault: (0, providerCredentialVault_1.createSecretManagerVault)(projectId()), store: (0, attachmentCustody_1.createCloudAttachmentStore)(), actorUid: uid });
    }
    catch (err) {
        throw toHttpsError(err);
    }
});
/** Retry one recorded delivery failure after the operator has fixed whatever caused it. */
exports.retryEmailDelivery = (0, https_1.onCall)({ region: REGION, secrets: providerTransportFactory_1.EMAIL_PROVIDER_SECRETS, timeoutSeconds: 300 }, async (request) => {
    assertNonProductionRuntime();
    const uid = callerUid(request);
    await requireCapability(uid, ADMIN_EMAIL_INTAKE_MANAGE);
    const failureId = (0, inboundWorkModel_1.boundedString)(request.data?.failureId, 400);
    try {
        const db = (0, firestore_1.getFirestore)();
        const failure = await db.collection(collections_1.EMAIL_DELIVERY_FAILURES_COLLECTION).doc(failureId).get();
        if (!failure.exists)
            throw new https_1.HttpsError("not-found", "That delivery failure no longer exists.");
        const mailboxId = (0, inboundWorkModel_1.boundedString)(failure.data().mailboxId, 255);
        const { connection, mailbox } = await loadConnectionAndMailbox(mailboxId);
        const cursorSnap = await db.collection(collections_1.EMAIL_MAILBOXES_COLLECTION).doc(mailboxId).get();
        return await (0, emailDeliveryService_1.retryDelivery)(db, connection, { ...mailbox, deliveryCursor: cursorSnap.data()?.deliveryCursor }, failureId, { adapter: (0, providerTransportFactory_1.transportFor)(connection.provider), vault: (0, providerCredentialVault_1.createSecretManagerVault)(projectId()), store: (0, attachmentCustody_1.createCloudAttachmentStore)(), actorUid: uid });
    }
    catch (err) {
        throw toHttpsError(err);
    }
});
// ── Read an attachment ───────────────────────────────────────────────────────────────────────────
/**
 * The ONLY route to attachment bytes.
 *
 * Authority is the inbound request's, resolved server-side; the storage key is read from the record
 * rather than accepted from the caller, so there is no key to guess and no way to name a different
 * object. The bytes come back inline, base64, bounded -- a signed URL would hand out a credential that
 * outlives the authorization check, and a streaming endpoint is a public surface this does not need.
 */
exports.getInboundWorkAttachment = (0, https_1.onCall)({ region: REGION }, async (request) => {
    const uid = callerUid(request);
    await requireCapability(uid, INBOUND_WORK_READ);
    const d = (request.data ?? {});
    const requestId = (0, inboundWorkModel_1.boundedString)(d.requestId, 255);
    const providerAttachmentId = (0, inboundWorkModel_1.boundedString)(d.providerAttachmentId, 255);
    try {
        const db = (0, firestore_1.getFirestore)();
        const snap = await db.collection(collections_1.INBOUND_WORK_REQUESTS_COLLECTION).doc(requestId).get();
        if (!snap.exists)
            throw new https_1.HttpsError("not-found", "That inbound request does not exist.");
        const refs = snap.data().attachmentRefs;
        const match = (Array.isArray(refs) ? refs : []).find((r) => (0, inboundWorkModel_1.boundedString)(r?.providerAttachmentId, 255) === providerAttachmentId);
        if (!match)
            throw new https_1.HttpsError("not-found", "That attachment is not part of this request.");
        const storageKey = (0, inboundWorkModel_1.boundedString)(match.storageKey, 500);
        if (!storageKey || match.custody !== "STORED") {
            throw new https_1.HttpsError("failed-precondition", "That attachment has not been retrieved yet. Retry it from Administration → Email & Communications.");
        }
        const size = typeof match.size === "number" ? match.size : 0;
        if (size > exports.MAX_INLINE_ATTACHMENT_BYTES) {
            throw new https_1.HttpsError("failed-precondition", "That attachment is too large to open here. Downloading large files is a later capability.");
        }
        const bytes = await (0, attachmentCustody_1.createCloudAttachmentStore)().get(storageKey);
        if (!bytes)
            throw new https_1.HttpsError("not-found", "The stored attachment could not be read.");
        return {
            filename: (0, inboundWorkModel_1.boundedString)(match.filename, 255),
            // The DECLARED type, travelling as data. The bytes were stored as application/octet-stream and are
            // returned base64 for the client to save -- never rendered.
            declaredMimeType: (0, inboundWorkModel_1.boundedString)(match.mimeType, 255),
            size: bytes.length,
            contentHash: (0, inboundWorkModel_1.boundedString)(match.contentHash, 128),
            contentBase64: bytes.toString("base64"),
        };
    }
    catch (err) {
        throw toHttpsError(err);
    }
});
//# sourceMappingURL=emailTransportCallables.js.map