"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pollEmailMailboxes = exports.MAX_MAILBOXES_PER_TICK = exports.DELIVERY_SYSTEM_ACTOR = void 0;
exports.runDeliveryCycle = runDeliveryCycle;
// Email Connections -- THE SCHEDULE. The thing that makes delivery automatic rather than something an
// administrator remembers to press.
//
// ONE FUNCTION, EVERY ENABLED MAILBOX, EVERY FIVE MINUTES. Five minutes is a service business's tolerance
// for "a warranty email arrived", not a technical constant: a minute would quadruple the provider calls
// for no operational difference, and fifteen would have a dispatcher refreshing the queue.
//
// IT REFUSES PRODUCTION, from the runtime's own project identity, before it reads anything. Production
// mailbox polling is not authorized; a schedule that silently started running there the day somebody
// deployed it would be exactly the accident the guard exists to prevent.
//
// EXPORT IS NOT DEPLOY. Nothing schedules until this function is deployed to an environment, and
// deploying it is a separate, Owner-executed action.
const scheduler_1 = require("firebase-functions/v2/scheduler");
const firestore_1 = require("firebase-admin/firestore");
const collections_1 = require("../constants/collections");
const importTargetGuard_1 = require("../dataImport/importTargetGuard");
const inboundWorkModel_1 = require("./inboundWorkModel");
const emailProvider_1 = require("./emailProvider");
const inboundWorkReadService_1 = require("./inboundWorkReadService");
const providerTransportFactory_1 = require("./providerTransportFactory");
const providerCredentialVault_1 = require("./providerCredentialVault");
const attachmentCustody_1 = require("./attachmentCustody");
const emailDeliveryService_1 = require("./emailDeliveryService");
/** The system actor delivery runs as. Never a person: nobody pressed anything. */
exports.DELIVERY_SYSTEM_ACTOR = "system-email-delivery";
/** How many mailboxes one tick will poll. A bound, not a limit anybody is expected to hit. */
exports.MAX_MAILBOXES_PER_TICK = 20;
/**
 * The pure-ish core: poll every enabled mailbox once, collecting results. Exported separately from the
 * schedule so a test can run exactly what the schedule runs, with its own database and adapters, without
 * a scheduler.
 */
async function runDeliveryCycle(db, deps) {
    const actorUid = deps.actorUid ?? exports.DELIVERY_SYSTEM_ACTOR;
    const mailboxSnap = await db
        .collection(collections_1.EMAIL_MAILBOXES_COLLECTION)
        .where("status", "==", "ACTIVE")
        .limit(exports.MAX_MAILBOXES_PER_TICK)
        .get();
    const results = [];
    for (const doc of mailboxSnap.docs) {
        const mailbox = await (0, inboundWorkReadService_1.readMailbox)(db, doc.id);
        if (!mailbox || mailbox.inboundEnabled === false)
            continue;
        const connectionSnap = await db.collection(collections_1.EMAIL_CONNECTIONS_COLLECTION).doc(mailbox.connectionId).get();
        if (!connectionSnap.exists)
            continue;
        const data = connectionSnap.data();
        const provider = data.provider;
        // A connection that has never been authorized, or whose authorization was revoked, is skipped
        // silently rather than failing loudly every five minutes: it is a configuration state, not an
        // incident, and Administration already shows it as NOT_CONNECTED.
        if (!(0, emailProvider_1.isEmailProviderId)(provider) || data.oauthStatus !== "CONNECTED" || data.inboundEnabled === false)
            continue;
        const connection = {
            id: connectionSnap.id,
            provider,
            tenantOrWorkspace: (0, inboundWorkModel_1.boundedString)(data.tenantOrWorkspace, 255),
            connectedAccount: (0, inboundWorkModel_1.boundedString)(data.connectedAccount, 255),
            inboundEnabled: true,
            oauthStatus: "CONNECTED",
        };
        try {
            results.push(await (0, emailDeliveryService_1.pollMailboxOnce)(db, connection, { ...mailbox, deliveryCursor: doc.data().deliveryCursor }, {
                adapter: deps.transportFor(provider),
                vault: deps.vaultFor(deps.projectId),
                store: deps.store,
                actorUid,
                now: deps.now,
            }));
        }
        catch (err) {
            // One mailbox's unexpected failure must not stop the others: this loop is the only thing standing
            // between a misconfigured mailbox and every other mailbox in the company.
            console.error(`[emailDelivery] mailbox ${doc.id} failed`, err instanceof Error ? err.message : err);
        }
    }
    return results;
}
exports.pollEmailMailboxes = (0, scheduler_1.onSchedule)({
    region: "us-central1",
    schedule: "every 5 minutes",
    timeoutSeconds: 540,
    secrets: providerTransportFactory_1.EMAIL_PROVIDER_SECRETS,
    retryCount: 0,
}, async () => {
    const projectId = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? "";
    try {
        (0, importTargetGuard_1.assertNonProductionImportTarget)(projectId);
    }
    catch (err) {
        // Refused, loudly and harmlessly: no read, no provider call, no write.
        console.warn(`[emailDelivery] refusing to poll in this environment: ${err.message}`);
        return;
    }
    const results = await runDeliveryCycle((0, firestore_1.getFirestore)(), {
        transportFor: providerTransportFactory_1.transportFor,
        vaultFor: providerCredentialVault_1.createSecretManagerVault,
        store: (0, attachmentCustody_1.createCloudAttachmentStore)(),
        projectId,
    });
    const totals = results.reduce((sum, r) => ({ fetched: sum.fetched + r.fetched, created: sum.created + r.created, failures: sum.failures + r.failures }), { fetched: 0, created: 0, failures: 0 });
    console.log(`[emailDelivery] polled ${results.length} mailbox(es): ${totals.fetched} fetched, ${totals.created} new, ${totals.failures} failed`);
});
//# sourceMappingURL=emailDeliverySchedule.js.map