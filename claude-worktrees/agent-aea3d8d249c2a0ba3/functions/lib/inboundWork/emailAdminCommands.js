"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.upsertEmailConnection = upsertEmailConnection;
exports.upsertEmailMailbox = upsertEmailMailbox;
exports.validateRoutingCondition = validateRoutingCondition;
exports.upsertEmailRoutingRule = upsertEmailRoutingRule;
// Email Connections -- ADMINISTRATION WRITES. Connections, operational mailboxes and routing rules.
//
// SEPARATE AUTHORITY FROM THE QUEUE, deliberately. Connecting or disconnecting a provider is an
// administration act; reviewing and accepting Service work is a Service act. A Service coordinator who can
// work the Inbound Work queue all day cannot reach any function in this file, and an administrator who can
// configure mailboxes holds no authority to accept a job. That split is enforced by two different
// capabilities at the callables, and it is the reason this file is not merged into the decision commands.
const firestore_1 = require("firebase-admin/firestore");
const collections_1 = require("../constants/collections");
const auditEventWriter_1 = require("../access/auditEventWriter");
const emailProvider_1 = require("./emailProvider");
const inboundRouting_1 = require("./inboundRouting");
const inboundWorkModel_1 = require("./inboundWorkModel");
/** A connection is never written as CONNECTED by a form -- only a completed authorization can do that. */
async function upsertEmailConnection(db, input) {
    const config = (0, emailProvider_1.validateConnectionConfig)(input?.config);
    const actorUid = (0, inboundWorkModel_1.boundedString)(input?.actorUid, 255);
    if (!actorUid)
        throw new emailProvider_1.EmailProviderError("An authenticated actor is required.");
    const id = (0, inboundWorkModel_1.boundedString)(input?.id, 255);
    const ref = id ? db.collection(collections_1.EMAIL_CONNECTIONS_COLLECTION).doc(id) : db.collection(collections_1.EMAIL_CONNECTIONS_COLLECTION).doc();
    await db.runTransaction(async (tx) => {
        const existing = await tx.get(ref);
        const base = {
            ...config,
            connectionStatus: existing.exists ? existing.data()?.connectionStatus ?? "CONFIGURED" : "CONFIGURED",
            // OAuth state is owned by the authorization flow, not by this form. A new connection starts
            // NOT_CONNECTED and an existing one keeps whatever the flow last recorded.
            oauthStatus: existing.exists ? existing.data()?.oauthStatus ?? "NOT_CONNECTED" : "NOT_CONNECTED",
            health: existing.exists ? existing.data()?.health ?? "UNKNOWN" : "UNKNOWN",
            lastSuccessfulSync: existing.exists ? existing.data()?.lastSuccessfulSync ?? null : null,
            lastMessageReceived: existing.exists ? existing.data()?.lastMessageReceived ?? null : null,
            updatedBy: actorUid,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
            ...(existing.exists ? {} : { createdBy: actorUid, createdAt: firestore_1.FieldValue.serverTimestamp() }),
        };
        tx.set(ref, base, { merge: true });
        (0, auditEventWriter_1.stageAuditEvent)(tx, {
            actorUid,
            action: "configureEmailConnection",
            targetType: "emailConnection",
            targetId: ref.id,
            outcome: "applied",
            summary: `${existing.exists ? "updated" : "created"} ${config.provider} connection "${config.connectionName}"`,
        });
    });
    return { id: ref.id };
}
async function upsertEmailMailbox(db, input) {
    const config = (0, emailProvider_1.validateMailboxConfig)(input?.config);
    const actorUid = (0, inboundWorkModel_1.boundedString)(input?.actorUid, 255);
    if (!actorUid)
        throw new emailProvider_1.EmailProviderError("An authenticated actor is required.");
    const id = (0, inboundWorkModel_1.boundedString)(input?.id, 255);
    const ref = id ? db.collection(collections_1.EMAIL_MAILBOXES_COLLECTION).doc(id) : db.collection(collections_1.EMAIL_MAILBOXES_COLLECTION).doc();
    await db.runTransaction(async (tx) => {
        const connection = await tx.get(db.collection(collections_1.EMAIL_CONNECTIONS_COLLECTION).doc(config.connectionId));
        if (!connection.exists)
            throw new emailProvider_1.EmailProviderError("That connection does not exist.");
        const existing = await tx.get(ref);
        tx.set(ref, {
            ...config,
            // The mailbox key inbound delivery matches on. Derived by the WRITER so a mailbox cannot be
            // configured in a shape the intake path can never find.
            emailAddressKey: (0, inboundWorkModel_1.normalizeEmailAddress)(config.emailAddress),
            status: input?.status === "DISABLED" ? "DISABLED" : "ACTIVE",
            updatedBy: actorUid,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
            ...(existing.exists ? {} : { createdBy: actorUid, createdAt: firestore_1.FieldValue.serverTimestamp() }),
        }, { merge: true });
        (0, auditEventWriter_1.stageAuditEvent)(tx, {
            actorUid,
            action: "configureEmailMailbox",
            targetType: "emailMailbox",
            targetId: ref.id,
            outcome: "applied",
            summary: `${existing.exists ? "updated" : "created"} ${config.purpose} mailbox ${config.emailAddress}`,
        });
    });
    return { id: ref.id };
}
/** Validate an administrator-authored rule condition into the closed shape the evaluator understands. */
function validateRoutingCondition(raw) {
    const w = (raw ?? {});
    const out = {};
    const senderAddress = (0, inboundWorkModel_1.normalizeEmailAddress)(w.senderAddress);
    if (senderAddress)
        out.senderAddress = senderAddress;
    const senderDomain = (0, inboundWorkModel_1.boundedString)(w.senderDomain, 255).toLowerCase().replace(/^@/, "");
    if (senderDomain)
        out.senderDomain = senderDomain;
    const mailboxId = (0, inboundWorkModel_1.boundedString)(w.mailboxId, 255);
    if (mailboxId)
        out.mailboxId = mailboxId;
    const terms = (v) => (Array.isArray(v) ? v : []).slice(0, 10).map((t) => (0, inboundWorkModel_1.boundedString)(t, 120)).filter(Boolean);
    const subjectContains = terms(w.subjectContains);
    if (subjectContains.length)
        out.subjectContains = subjectContains;
    const bodyContains = terms(w.bodyContains);
    if (bodyContains.length)
        out.bodyContains = bodyContains;
    if (typeof w.hasAttachments === "boolean")
        out.hasAttachments = w.hasAttachments;
    if (Object.keys(out).length === 0) {
        throw new emailProvider_1.EmailProviderError("A routing rule must have at least one condition -- a rule that matches everything is not a rule.");
    }
    return out;
}
async function upsertEmailRoutingRule(db, input) {
    const actorUid = (0, inboundWorkModel_1.boundedString)(input?.actorUid, 255);
    if (!actorUid)
        throw new emailProvider_1.EmailProviderError("An authenticated actor is required.");
    (0, emailProvider_1.assertNoCredentialMaterial)(input?.rule);
    const r = (input?.rule ?? {});
    const name = (0, inboundWorkModel_1.boundedString)(r.name, 120);
    if (!name)
        throw new emailProvider_1.EmailProviderError("A routing rule needs a name.");
    const when = validateRoutingCondition(r.when);
    const then = (0, inboundRouting_1.normalizeOutcome)(r.then);
    if (Object.keys(then).length === 0)
        throw new emailProvider_1.EmailProviderError("A routing rule must set at least one outcome.");
    const order = typeof r.order === "number" && Number.isFinite(r.order) ? Math.floor(r.order) : 100;
    const id = (0, inboundWorkModel_1.boundedString)(input?.id, 255);
    const ref = id ? db.collection(collections_1.EMAIL_ROUTING_RULES_COLLECTION).doc(id) : db.collection(collections_1.EMAIL_ROUTING_RULES_COLLECTION).doc();
    await db.runTransaction(async (tx) => {
        const existing = await tx.get(ref);
        const rule = { name, enabled: r.enabled !== false, order, when, then };
        tx.set(ref, {
            ...rule,
            updatedBy: actorUid,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
            ...(existing.exists ? {} : { createdBy: actorUid, createdAt: firestore_1.FieldValue.serverTimestamp() }),
        }, { merge: true });
        (0, auditEventWriter_1.stageAuditEvent)(tx, {
            actorUid,
            action: "configureEmailRoutingRule",
            targetType: "emailRoutingRule",
            targetId: ref.id,
            outcome: "applied",
            summary: `${existing.exists ? "updated" : "created"} routing rule "${name}"`,
        });
    });
    return { id: ref.id };
}
//# sourceMappingURL=emailAdminCommands.js.map