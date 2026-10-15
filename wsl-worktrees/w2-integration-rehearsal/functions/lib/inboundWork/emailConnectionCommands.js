"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startConnectionAuthorization = startConnectionAuthorization;
exports.completeConnectionAuthorization = completeConnectionAuthorization;
exports.testConnection = testConnection;
exports.disconnectConnection = disconnectConnection;
// Email Connections -- THE REAL CONNECTION LIFECYCLE: authorize, complete, test, disconnect.
//
// A CONNECTION IS NOT CONNECTED BECAUSE A TOKEN WAS ISSUED. Consent proves an administrator agreed;
// it does not prove the account they consented as can read the mailbox somebody typed into the mailbox
// form. Completion therefore exchanges the code, stores the credential, and then READS THE CONFIGURED
// MAILBOX. Only that last step sets CONNECTED. A connection that authorizes but cannot read its mailbox
// is recorded as authorized-and-failing, with the reason, which is the state an operator can act on.
//
// THE CALLBACK IS AUTHENTICATED. The provider redirects the administrator's browser to the EOS
// application's own route; the SPA then calls `completeEmailConnectionAuthorization` as the signed-in
// user, with the capability check every other administration write goes through. There is no public
// unauthenticated callback endpoint in this design, which removes a whole class of exposure rather than
// defending it.
const node_crypto_1 = require("node:crypto");
const firestore_1 = require("firebase-admin/firestore");
const collections_1 = require("../constants/collections");
const auditEventWriter_1 = require("../access/auditEventWriter");
const inboundWorkModel_1 = require("./inboundWorkModel");
const emailProvider_1 = require("./emailProvider");
const providerAuthorizationState_1 = require("./providerAuthorizationState");
const providerTransport_1 = require("./providerTransport");
const providerCredentialVault_1 = require("./providerCredentialVault");
async function readConnection(db, connectionId) {
    const snap = await db.collection(collections_1.EMAIL_CONNECTIONS_COLLECTION).doc(connectionId).get();
    if (!snap.exists)
        throw new providerTransport_1.ProviderTransportError("CONFIGURATION_INVALID", "That connection does not exist.");
    return snap.data();
}
function providerOf(connection) {
    const provider = connection.provider;
    if (!(0, emailProvider_1.isEmailProviderId)(provider))
        throw new providerTransport_1.ProviderTransportError("CONFIGURATION_INVALID", "That connection has no valid provider.");
    return provider;
}
/**
 * Step one: mint the state, store it server-side, and hand back the provider URL to send the
 * administrator to. Nothing about the connection changes except that it is now awaiting authorization --
 * an abandoned attempt leaves a connection exactly where it was.
 */
async function startConnectionAuthorization(db, input, deps) {
    const now = (deps.now ?? Date.now)();
    const connectionId = (0, inboundWorkModel_1.boundedString)(input?.connectionId, 255);
    const actorUid = (0, inboundWorkModel_1.boundedString)(input?.actorUid, 255);
    const redirectUri = (0, inboundWorkModel_1.boundedString)(input?.redirectUri, 500);
    if (!connectionId || !actorUid)
        throw new providerTransport_1.ProviderTransportError("CONFIGURATION_INVALID", "connectionId and an authenticated actor are required.");
    const connection = await readConnection(db, connectionId);
    const provider = providerOf(connection);
    const adapter = deps.transportFor(provider);
    const issued = (0, providerAuthorizationState_1.issueAuthorizationState)({ connectionId, provider, redirectUri, initiatedByUid: actorUid }, { now, randomBytes: deps.randomBytes ?? node_crypto_1.randomBytes });
    // The state is stored by its HASH. A read of this collection yields nothing that can be presented at
    // the callback, and the PKCE verifier beside it never leaves the server.
    await db.collection(collections_1.EMAIL_OAUTH_STATES_COLLECTION).doc(issued.stateKey).set(issued.record);
    await db.collection(collections_1.EMAIL_CONNECTIONS_COLLECTION).doc(connectionId).set({ oauthStatus: "PENDING_AUTHORIZATION", authorizationStartedAt: now, updatedBy: actorUid, updatedAt: firestore_1.FieldValue.serverTimestamp() }, { merge: true });
    await (0, auditEventWriter_1.recordStandaloneAuditEvent)({
        actorUid,
        action: "connectionAuthorizationStarted",
        targetType: "emailConnection",
        targetId: connectionId,
        outcome: "applied",
        summary: `started ${provider} authorization`,
    });
    return {
        authorizationUrl: adapter.buildAuthorizationUrl({
            tenantOrWorkspace: (0, inboundWorkModel_1.boundedString)(connection.tenantOrWorkspace, 255),
            connectedAccount: (0, inboundWorkModel_1.boundedString)(connection.connectedAccount, 255),
            redirectUri,
            state: issued.state,
            codeChallenge: issued.codeChallenge,
        }),
        state: issued.state,
        expiresAt: issued.record.expiresAt,
    };
}
/**
 * Step two: validate the state, exchange the code, take custody of the refresh token, and prove the
 * configured mailboxes are readable.
 *
 * ORDER MATTERS. The state is consumed BEFORE the exchange, in a transaction, so a replayed callback
 * cannot race a legitimate one into two exchanges. The credential is stored BEFORE the mailbox check, so
 * a mailbox that fails validation still leaves a connection an administrator can test and fix rather than
 * one that consented and then lost its token.
 */
async function completeConnectionAuthorization(db, input, deps) {
    const now = (deps.now ?? Date.now)();
    const connectionId = (0, inboundWorkModel_1.boundedString)(input?.connectionId, 255);
    const actorUid = (0, inboundWorkModel_1.boundedString)(input?.actorUid, 255);
    const code = (0, inboundWorkModel_1.boundedString)(input?.code, 4000);
    const redirectUri = (0, inboundWorkModel_1.boundedString)(input?.redirectUri, 500);
    const stateKey = (0, providerAuthorizationState_1.hashAuthorizationState)((0, inboundWorkModel_1.boundedString)(input?.state, 500));
    if (!connectionId || !actorUid || !code) {
        throw new providerTransport_1.ProviderTransportError("CONFIGURATION_INVALID", "connectionId, an authenticated actor and an authorization code are all required.");
    }
    const connection = await readConnection(db, connectionId);
    const provider = providerOf(connection);
    const stateRef = db.collection(collections_1.EMAIL_OAUTH_STATES_COLLECTION).doc(stateKey);
    // CONSUME-THEN-EXCHANGE. Single-use is enforced by the transaction, not by a later check: two
    // simultaneous callbacks cannot both pass this, and the loser gets STATE_ALREADY_USED.
    let stateRecord;
    try {
        stateRecord = await db.runTransaction(async (tx) => {
            const snap = await tx.get(stateRef);
            const record = snap.exists ? snap.data() : null;
            const usable = (0, providerAuthorizationState_1.assertAuthorizationStateUsable)(record, { connectionId, provider, redirectUri, actorUid, now });
            tx.update(stateRef, { consumedAt: now });
            return usable;
        });
    }
    catch (err) {
        await (0, auditEventWriter_1.recordStandaloneAuditEvent)({
            actorUid,
            action: "connectionAuthorizationFailed",
            targetType: "emailConnection",
            targetId: connectionId,
            outcome: "denied",
            summary: `authorization refused: ${err instanceof providerAuthorizationState_1.OAuthStateError ? err.code : "STATE_UNKNOWN"}`,
        });
        throw err;
    }
    const adapter = deps.transportFor(provider);
    let reference;
    try {
        const tokens = await adapter.exchangeAuthorizationCode({
            code,
            codeVerifier: stateRecord.codeVerifier,
            redirectUri,
            tenantOrWorkspace: (0, inboundWorkModel_1.boundedString)(connection.tenantOrWorkspace, 255),
        });
        if (!tokens.refreshToken) {
            // Without a refresh token the connection would work until the first access token expired and then
            // stop, which is worse than refusing now: the provider was not asked for offline access, or the
            // administrator has consented before and the provider did not re-issue one.
            throw new providerTransport_1.ProviderTransportError("CONFIGURATION_INVALID", "The provider returned no refresh token. Reauthorize and accept the offline access prompt.");
        }
        reference = await deps.vault.put(connectionId, tokens.refreshToken);
        (0, providerCredentialVault_1.forgetAccessToken)(connectionId);
    }
    catch (err) {
        await db.collection(collections_1.EMAIL_CONNECTIONS_COLLECTION).doc(connectionId).set({ oauthStatus: "NOT_CONNECTED", connectionStatus: "FAILED", health: "FAILED", lastProviderErrorAt: now, providerErrorCode: err instanceof providerTransport_1.ProviderTransportError ? err.code : "CONFIGURATION_INVALID" }, { merge: true });
        await (0, auditEventWriter_1.recordStandaloneAuditEvent)({
            actorUid,
            action: "connectionAuthorizationFailed",
            targetType: "emailConnection",
            targetId: connectionId,
            outcome: "denied",
            summary: `token exchange failed: ${err instanceof providerTransport_1.ProviderTransportError ? err.code : "CONFIGURATION_INVALID"}`,
        });
        throw err;
    }
    const validation = await validateConfiguredMailboxes(db, connectionId, adapter, deps, now);
    const health = validation.failed === 0 && validation.checked > 0 ? "HEALTHY" : validation.checked === 0 ? "UNKNOWN" : "FAILED";
    await db.collection(collections_1.EMAIL_CONNECTIONS_COLLECTION).doc(connectionId).set({
        oauthStatus: "CONNECTED",
        // CONNECTED means "can read the configured mailboxes", which is the claim that matters
        // operationally. A connection that authorized but cannot read one is FAILED and says why.
        connectionStatus: validation.failed === 0 ? "CONNECTED" : "FAILED",
        health,
        credentialSecretName: reference.secretName,
        credentialVersion: reference.version,
        authorizedAt: now,
        authorizedBy: actorUid,
        lastTokenRefreshAt: now,
        lastHealthCheckAt: now,
        providerErrorCode: validation.failed === 0 ? null : "MAILBOX_ACCESS_DENIED",
        updatedBy: actorUid,
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
    }, { merge: true });
    await (0, auditEventWriter_1.recordStandaloneAuditEvent)({
        actorUid,
        action: "connectionAuthorized",
        targetType: "emailConnection",
        targetId: connectionId,
        outcome: validation.failed === 0 ? "applied" : "uncertain",
        summary: `${provider} authorized; ${validation.checked} mailbox(es) checked, ${validation.failed} unreadable`,
    });
    return {
        connectionId,
        oauthStatus: "CONNECTED",
        connectionStatus: validation.failed === 0 ? "CONNECTED" : "FAILED",
        health,
        detail: validation.detail,
        mailboxesValidated: validation.checked,
    };
}
/** Read every configured mailbox on this connection with the granted authority. Writes each result down. */
async function validateConfiguredMailboxes(db, connectionId, adapter, deps, now) {
    const snap = await db.collection(collections_1.EMAIL_MAILBOXES_COLLECTION).where("connectionId", "==", connectionId).limit(25).get();
    if (snap.empty)
        return { checked: 0, failed: 0, detail: "Authorized. No mailboxes are configured on this connection yet." };
    const { resolveAccessToken } = await import("./providerCredentialVault.js");
    const connection = await readConnection(db, connectionId);
    const accessToken = await resolveAccessToken(db, deps.vault, adapter, {
        connectionId,
        tenantOrWorkspace: (0, inboundWorkModel_1.boundedString)(connection.tenantOrWorkspace, 255),
    });
    let failed = 0;
    const details = [];
    for (const doc of snap.docs) {
        const address = (0, inboundWorkModel_1.boundedString)(doc.data().emailAddress, 255);
        const result = await adapter.validateMailboxAccess({ accessToken, mailboxAddress: address });
        if (!result.ok)
            failed += 1;
        details.push(result.detail);
        await doc.ref.set({ mailboxValidatedAt: now, mailboxReadable: result.ok, mailboxValidationDetail: (0, inboundWorkModel_1.boundedString)(result.detail, 300) }, { merge: true });
    }
    return { checked: snap.size, failed, detail: details.slice(0, 3).join(" ") };
}
/**
 * TEST CONNECTION. Reads, and does nothing else: no message is ingested, nothing is sent, no provider-side
 * state is touched, and no EOS record other than the health fields changes. A test that created work would
 * be a test nobody dares run.
 */
async function testConnection(db, input, deps) {
    const now = (deps.now ?? Date.now)();
    const connectionId = (0, inboundWorkModel_1.boundedString)(input?.connectionId, 255);
    const actorUid = (0, inboundWorkModel_1.boundedString)(input?.actorUid, 255);
    const connection = await readConnection(db, connectionId);
    const provider = providerOf(connection);
    const adapter = deps.transportFor(provider);
    let health;
    let detail;
    let checked = 0;
    try {
        const validation = await validateConfiguredMailboxes(db, connectionId, adapter, deps, now);
        checked = validation.checked;
        health = validation.checked === 0 ? "DEGRADED" : validation.failed === 0 ? "HEALTHY" : "FAILED";
        detail =
            validation.checked === 0
                ? "The credential works, but no mailbox is configured on this connection yet."
                : validation.detail;
    }
    catch (err) {
        health = "FAILED";
        detail =
            err instanceof providerTransport_1.ProviderTransportError && err.code === "AUTH_REVOKED"
                ? "The stored authorization is no longer accepted by the provider. Reauthorize this connection."
                : err instanceof Error
                    ? err.message
                    : "The provider could not be reached.";
    }
    await db.collection(collections_1.EMAIL_CONNECTIONS_COLLECTION).doc(connectionId).set({ health, lastHealthCheckAt: now, ...(health === "FAILED" ? { lastProviderErrorAt: now } : {}) }, { merge: true });
    await (0, auditEventWriter_1.recordStandaloneAuditEvent)({
        actorUid,
        action: "connectionHealthChecked",
        targetType: "emailConnection",
        targetId: connectionId,
        outcome: health === "HEALTHY" ? "applied" : "uncertain",
        summary: `connection test: ${health} (${checked} mailbox(es) checked)`,
    });
    return { health, detail, checked };
}
/**
 * DISCONNECT. The credential is destroyed, not merely unreferenced -- "disconnected" has to mean the
 * stored authorization is gone, or it is a label rather than a state. Intake stops because the connection
 * can no longer mint a token, and every intake record it already produced is untouched.
 */
async function disconnectConnection(db, input, deps) {
    const now = (deps.now ?? Date.now)();
    const connectionId = (0, inboundWorkModel_1.boundedString)(input?.connectionId, 255);
    const actorUid = (0, inboundWorkModel_1.boundedString)(input?.actorUid, 255);
    await readConnection(db, connectionId);
    await deps.vault.destroy(connectionId);
    (0, providerCredentialVault_1.forgetAccessToken)(connectionId);
    await db.collection(collections_1.EMAIL_CONNECTIONS_COLLECTION).doc(connectionId).set({
        oauthStatus: "REVOKED",
        connectionStatus: "NOT_CONNECTED",
        health: "UNKNOWN",
        inboundEnabled: false,
        credentialSecretName: null,
        credentialVersion: null,
        disconnectedAt: now,
        updatedBy: actorUid,
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
    }, { merge: true });
    await (0, auditEventWriter_1.recordStandaloneAuditEvent)({
        actorUid,
        action: "connectionDisconnected",
        targetType: "emailConnection",
        targetId: connectionId,
        outcome: "applied",
        summary: "disconnected and destroyed the stored authorization",
    });
    return { connectionId, oauthStatus: "REVOKED" };
}
//# sourceMappingURL=emailConnectionCommands.js.map