"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DELIVERY_BATCH_LIMIT = void 0;
exports.recordDeliveryFailure = recordDeliveryFailure;
exports.pollMailboxOnce = pollMailboxOnce;
exports.retryDelivery = retryDelivery;
exports.stageDeliveryCycleAudit = stageDeliveryCycleAudit;
const collections_1 = require("../constants/collections");
const auditEventWriter_1 = require("../access/auditEventWriter");
const inboundWorkModel_1 = require("./inboundWorkModel");
const emailProvider_1 = require("./emailProvider");
const inboundIntakeCommand_1 = require("./inboundIntakeCommand");
const inboundWorkReadService_1 = require("./inboundWorkReadService");
const providerTransport_1 = require("./providerTransport");
const providerCredentialVault_1 = require("./providerCredentialVault");
const attachmentCustody_1 = require("./attachmentCustody");
/** How many messages one poll of one mailbox will take in. Bounded so a backlog drains steadily. */
exports.DELIVERY_BATCH_LIMIT = 25;
const emptyResult = (mailboxId) => ({
    mailboxId,
    fetched: 0,
    created: 0,
    duplicates: 0,
    threadMatched: 0,
    attachmentsStored: 0,
    attachmentsFailed: 0,
    failures: 0,
    truncated: false,
    transportFailure: null,
});
/**
 * Record one transport failure so it is visible, classified and retryable.
 *
 * Keyed deterministically per (mailbox, subject-of-failure) so a repeating failure increments an attempt
 * count on ONE record instead of filling the exceptions list with the same sentence a hundred times.
 */
async function recordDeliveryFailure(db, input) {
    const id = `${input.mailboxId}__${input.subjectId}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 400);
    const ref = db.collection(collections_1.EMAIL_DELIVERY_FAILURES_COLLECTION).doc(id);
    const disposition = (0, providerTransport_1.dispositionOf)(input.code);
    const attempts = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const previous = snap.exists ? Number(snap.data().attempts ?? 0) : 0;
        const next = previous + 1;
        const exhausted = disposition !== "REQUIRES_ADMIN_ACTION" && next >= providerTransport_1.MAX_DELIVERY_ATTEMPTS;
        tx.set(ref, {
            connectionId: input.connectionId,
            mailboxId: input.mailboxId,
            subjectId: input.subjectId,
            // The CODE is the operator-facing fact. No provider body, no token, no raw payload -- an
            // exceptions list is read by people and copied into tickets.
            code: input.code,
            detail: (0, inboundWorkModel_1.boundedString)(input.detail, 300),
            disposition: exhausted ? "REQUIRES_ADMIN_ACTION" : disposition,
            attempts: next,
            exhausted,
            status: exhausted ? "DELIVERY_RETRY_EXHAUSTED" : "OPEN",
            nextAttemptAt: exhausted ? null : input.now + (0, providerTransport_1.nextRetryDelayMs)(next, input.retryAfterSeconds ?? null),
            firstFailedAt: snap.exists ? snap.data().firstFailedAt ?? input.now : input.now,
            lastFailedAt: input.now,
        }, { merge: true });
        return next;
    });
    const exhausted = disposition !== "REQUIRES_ADMIN_ACTION" && attempts >= providerTransport_1.MAX_DELIVERY_ATTEMPTS;
    await (0, auditEventWriter_1.recordStandaloneAuditEvent)({
        actorUid: input.actorUid,
        action: "providerDeliveryFailed",
        targetType: "emailMailbox",
        targetId: input.mailboxId,
        outcome: "denied",
        summary: `delivery failure ${input.code} (attempt ${attempts}${exhausted ? ", retries exhausted" : ""})`,
    });
    return { id, attempts, exhausted };
}
/** Clear a resolved failure. Called on the next success, so a fixed connection stops shouting. */
async function clearDeliveryFailures(db, mailboxId) {
    const snap = await db.collection(collections_1.EMAIL_DELIVERY_FAILURES_COLLECTION).where("mailboxId", "==", mailboxId).where("status", "==", "OPEN").limit(50).get();
    await Promise.all(snap.docs.map((doc) => doc.ref.update({ status: "RESOLVED", resolvedAt: Date.now() })));
}
async function updateConnectionHealth(db, connectionId, patch) {
    await db.collection(collections_1.EMAIL_CONNECTIONS_COLLECTION).doc(connectionId).set(patch, { merge: true });
}
/**
 * Poll ONE mailbox once.
 *
 * The shape is deliberately linear: credential, list, fetch, ingest, attachments, cursor. Each step's
 * failure is classified and recorded, and the cursor advances only over messages that were actually taken
 * in -- a message that could not be fetched leaves the cursor where it was, so the next poll sees it again
 * rather than stepping over it silently. Reprocessing is safe (intake deduplicates); skipping is not.
 */
async function pollMailboxOnce(db, connection, mailbox, deps) {
    const now = (deps.now ?? Date.now)();
    const result = emptyResult(mailbox.id);
    if (mailbox.status === "DISABLED" || mailbox.inboundEnabled === false || connection.inboundEnabled === false)
        return result;
    let accessToken;
    try {
        accessToken = await (0, providerCredentialVault_1.resolveAccessToken)(db, deps.vault, deps.adapter, {
            connectionId: connection.id,
            tenantOrWorkspace: connection.tenantOrWorkspace,
        });
    }
    catch (err) {
        const code = err instanceof providerTransport_1.ProviderTransportError ? err.code : "CONFIGURATION_INVALID";
        result.transportFailure = code;
        await recordDeliveryFailure(db, {
            connectionId: connection.id,
            mailboxId: mailbox.id,
            subjectId: "credential",
            code,
            detail: err instanceof Error ? err.message : "The connection credential could not be used.",
            now,
            actorUid: deps.actorUid,
        });
        await updateConnectionHealth(db, connection.id, {
            health: "FAILED",
            oauthStatus: code === "AUTH_REVOKED" ? "REVOKED" : code === "AUTH_EXPIRED" ? "EXPIRED" : "CONNECTED",
            connectionStatus: "FAILED",
            lastProviderErrorAt: now,
            providerErrorCode: code,
        });
        return result;
    }
    const limit = Math.max(1, Math.min(deps.limit ?? exports.DELIVERY_BATCH_LIMIT, 100));
    const startingCursor = mailbox.deliveryCursor ?? { value: null };
    // FAILING THE LIST is one outcome with one recording, whatever produced it -- so it is written once
    // here rather than at each of the three places the list can go wrong.
    const failList = async (err) => {
        const code = err instanceof providerTransport_1.ProviderTransportError ? err.code : "PROVIDER_UNAVAILABLE";
        result.transportFailure = code;
        await recordDeliveryFailure(db, {
            connectionId: connection.id,
            mailboxId: mailbox.id,
            subjectId: "list",
            code,
            detail: err instanceof Error ? err.message : "The mailbox could not be listed.",
            retryAfterSeconds: err instanceof providerTransport_1.ProviderTransportError ? err.retryAfterSeconds : null,
            now,
            actorUid: deps.actorUid,
        });
        await updateConnectionHealth(db, connection.id, {
            health: (0, providerTransport_1.dispositionOf)(code) === "REQUIRES_ADMIN_ACTION" ? "FAILED" : "DEGRADED",
            lastProviderErrorAt: now,
            providerErrorCode: code,
        });
        return result;
    };
    let listed;
    try {
        listed = await deps.adapter.listNewMessageIds({ accessToken, mailboxAddress: mailbox.emailAddress, cursor: startingCursor, limit });
    }
    catch (err) {
        if (!(err instanceof providerTransport_1.ProviderTransportError) || err.code !== "CURSOR_EXPIRED")
            return failList(err);
        // RECOVERY, not failure: the provider will not honour our resume point, so this poll re-lists a
        // bounded recent window and lets intake's duplicate protection absorb the overlap.
        try {
            listed = await deps.adapter.listNewMessageIds({
                accessToken,
                mailboxAddress: mailbox.emailAddress,
                cursor: { value: startingCursor.value, expired: true },
                limit,
            });
        }
        catch (recoveryError) {
            return failList(recoveryError);
        }
    }
    const rules = await (0, inboundWorkReadService_1.readRoutingRules)(db);
    let lastGoodCursor = listed.cursor;
    let lastMessageReceivedAt = 0;
    result.truncated = listed.truncated;
    for (const messageId of listed.messageIds) {
        try {
            const raw = await deps.adapter.fetchMessage({ accessToken, mailboxAddress: mailbox.emailAddress, messageId });
            const message = (0, emailProvider_1.normalizeProviderMessage)(connection.provider, raw, { connectionId: connection.id, mailboxId: mailbox.id });
            const outcome = await (0, inboundIntakeCommand_1.ingestInboundMessage)(db, { message, mailbox, rules, actorUid: deps.actorUid });
            result.fetched += 1;
            if (outcome.outcome === "CREATED" || outcome.outcome === "AMBIGUOUS" || outcome.outcome === "FAILED")
                result.created += 1;
            if (outcome.outcome === "DUPLICATE")
                result.duplicates += 1;
            if (outcome.outcome === "THREAD_MATCH")
                result.threadMatched += 1;
            if (message.receivedAt > lastMessageReceivedAt)
                lastMessageReceivedAt = message.receivedAt;
            if (message.attachments.length > 0 && mailbox.attachmentPolicy !== "IGNORE") {
                const custody = await (0, attachmentCustody_1.fetchAndStoreAttachments)(db, outcome.requestId, {
                    store: deps.store,
                    adapter: deps.adapter,
                    accessToken,
                    mailboxAddress: mailbox.emailAddress,
                    actorUid: deps.actorUid,
                    now: () => now,
                });
                result.attachmentsStored += custody.stored;
                result.attachmentsFailed += custody.failed;
                if (custody.failed > 0) {
                    await recordDeliveryFailure(db, {
                        connectionId: connection.id,
                        mailboxId: mailbox.id,
                        subjectId: `attachments_${outcome.requestId}`,
                        code: "ATTACHMENT_FETCH_FAILED",
                        detail: `${custody.failed} attachment(s) on this message could not be retrieved.`,
                        now,
                        actorUid: deps.actorUid,
                    });
                }
            }
        }
        catch (err) {
            result.failures += 1;
            const code = err instanceof providerTransport_1.ProviderTransportError ? err.code : "MESSAGE_FETCH_FAILED";
            await recordDeliveryFailure(db, {
                connectionId: connection.id,
                mailboxId: mailbox.id,
                subjectId: `message_${messageId}`,
                code,
                detail: err instanceof Error ? err.message : "The message could not be taken in.",
                retryAfterSeconds: err instanceof providerTransport_1.ProviderTransportError ? err.retryAfterSeconds : null,
                now,
                actorUid: deps.actorUid,
            });
            // The cursor does NOT advance past a message this poll could not take in.
            lastGoodCursor = startingCursor;
            break;
        }
    }
    await db.collection(collections_1.EMAIL_MAILBOXES_COLLECTION).doc(mailbox.id).set({
        deliveryCursor: lastGoodCursor,
        lastPolledAt: now,
        ...(result.fetched > 0 ? { lastSuccessfulDeliveryAt: now } : {}),
        ...(lastMessageReceivedAt > 0 ? { lastMessageReceivedAt } : {}),
    }, { merge: true });
    if (result.failures === 0) {
        await clearDeliveryFailures(db, mailbox.id);
        await updateConnectionHealth(db, connection.id, {
            health: "HEALTHY",
            connectionStatus: "CONNECTED",
            lastSuccessfulSync: now,
            ...(lastMessageReceivedAt > 0 ? { lastMessageReceived: lastMessageReceivedAt } : {}),
            providerErrorCode: null,
        });
    }
    return result;
}
/**
 * Retry one recorded failure, from the Exceptions surface.
 *
 * A retry is the SAME poll, not a special path: the credential is re-resolved (which is what makes a
 * reauthorized connection start working again), the cached access token is dropped first so a stale one
 * cannot be reused, and the outcome is recorded the same way.
 */
async function retryDelivery(db, connection, mailbox, failureId, deps) {
    (0, providerCredentialVault_1.forgetAccessToken)(connection.id);
    const result = await pollMailboxOnce(db, connection, mailbox, deps);
    if (result.transportFailure === null && result.failures === 0) {
        await db
            .collection(collections_1.EMAIL_DELIVERY_FAILURES_COLLECTION)
            .doc(failureId)
            .set({ status: "RESOLVED", resolvedAt: (deps.now ?? Date.now)() }, { merge: true });
    }
    return result;
}
/** Audit that a delivery cycle ran, with counts. Staged by the scheduler, not by each message. */
function stageDeliveryCycleAudit(writer, input) {
    (0, auditEventWriter_1.stageAuditEvent)(writer, {
        actorUid: input.actorUid,
        action: "providerDeliveryCycle",
        targetType: "emailMailbox",
        targetId: input.mailboxId,
        outcome: input.result.transportFailure ? "denied" : "applied",
        summary: `polled mailbox: ${input.result.fetched} fetched, ${input.result.created} new, ${input.result.duplicates} duplicate, ${input.result.attachmentsStored} attachment(s) stored`,
    });
}
//# sourceMappingURL=emailDeliveryService.js.map