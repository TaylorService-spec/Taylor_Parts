"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deliverInboundEmailMessage = exports.saveEmailRoutingRule = exports.saveEmailMailbox = exports.saveEmailConnection = exports.getEmailIntakeConfiguration = exports.attachInboundWorkToWorkOrder = exports.declineInboundWork = exports.acceptInboundWork = exports.getInboundWorkRequest = exports.listInboundWork = exports.INBOUND_WORK_ATTACH = exports.INBOUND_WORK_DECLINE = exports.INBOUND_WORK_ACCEPT = exports.INBOUND_WORK_READ = exports.ADMIN_EMAIL_INTAKE_MANAGE = exports.ADMIN_EMAIL_INTAKE_READ = void 0;
// Email Connections + Inbound Work -- the CALLABLE SURFACE. Thin by design: every one of these resolves
// the caller's identity from request.auth (never from the payload), resolves ONE governed capability
// through the trusted effective-access feed, and delegates to the command or read that owns the behavior.
//
// AUTHORITY IS NEVER CLIENT-SUPPLIED. `actorUid` is `request.auth.uid` in every case -- no callable below
// accepts an actor, an operating company, a provider authority, or a decision timestamp from the payload,
// so there is nothing for a client to spoof. The operating company on an intake record comes from the
// mailbox or a routing rule an administrator wrote; the accepting user comes from the authenticated
// session; the acceptance time is a server timestamp.
//
// EXPORT != DEPLOY, REGISTER != GRANT. All six capabilities are registered active:false, so
// resolveEffectivePermission() denies every principal in every environment until a per-environment
// activation AND a governed roleAssignment exist. Production activation is hard-blocked.
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const effectiveAccessFeed_1 = require("../access/effectiveAccessFeed");
const importTargetGuard_1 = require("../dataImport/importTargetGuard");
const workOrderEquipment_1 = require("../workOrderEquipment");
const emailProvider_1 = require("./emailProvider");
const emailAdminCommands_1 = require("./emailAdminCommands");
const inboundIntakeCommand_1 = require("./inboundIntakeCommand");
const inboundDecisionCommands_1 = require("./inboundDecisionCommands");
const inboundWorkReadService_1 = require("./inboundWorkReadService");
const inboundWorkModel_1 = require("./inboundWorkModel");
exports.ADMIN_EMAIL_INTAKE_READ = "administration.emailIntake.read";
exports.ADMIN_EMAIL_INTAKE_MANAGE = "administration.emailIntake.manage";
exports.INBOUND_WORK_READ = "service.inboundWork.read";
exports.INBOUND_WORK_ACCEPT = "service.inboundWork.accept";
exports.INBOUND_WORK_DECLINE = "service.inboundWork.decline";
exports.INBOUND_WORK_ATTACH = "service.inboundWork.attachExisting";
const REGION = "us-central1";
/** Fail-closed capability gate. A resolution failure denies -- it never falls through to allow. */
async function requireCapability(uid, capability) {
    let allowed = false;
    try {
        const { decisions } = await (0, effectiveAccessFeed_1.resolveEffectiveAccess)({ principalUid: uid, permissionIds: [capability] });
        allowed = decisions[capability] === true;
    }
    catch (err) {
        console.error(`[inboundWork] capability resolution failed for ${capability}`, err);
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
/** Map a domain error to the right client-visible failure without leaking internals. */
function toHttpsError(err) {
    if (err instanceof https_1.HttpsError)
        return err;
    if (err instanceof inboundDecisionCommands_1.InboundDecisionError) {
        const code = err.code === "NOT_FOUND" || err.code === "WORK_ORDER_NOT_FOUND"
            ? "not-found"
            : err.code === "ALREADY_DECIDED"
                ? "failed-precondition"
                : "invalid-argument";
        return new https_1.HttpsError(code, err.message);
    }
    if (err instanceof workOrderEquipment_1.WorkOrderEquipmentError || err instanceof emailProvider_1.EmailProviderError || err instanceof inboundWorkModel_1.InboundWorkValidationError) {
        return new https_1.HttpsError("invalid-argument", err.message);
    }
    console.error("[inboundWork] unexpected failure", err);
    return new https_1.HttpsError("internal", "That action is temporarily unavailable.");
}
const requestedStatuses = (raw) => {
    if (!Array.isArray(raw))
        return undefined;
    const out = raw.filter((s) => inboundWorkModel_1.INBOUND_WORK_STATUSES.includes(s));
    return out.length ? out : undefined;
};
// ── Service: the queue and one request's review detail ────────────────────────────────────────────
exports.listInboundWork = (0, https_1.onCall)({ region: REGION }, async (request) => {
    const uid = callerUid(request);
    await requireCapability(uid, exports.INBOUND_WORK_READ);
    try {
        const data = (request.data ?? {});
        return await (0, inboundWorkReadService_1.readInboundWorkQueue)((0, firestore_1.getFirestore)(), {
            statuses: requestedStatuses(data.statuses),
            limit: typeof data.limit === "number" ? data.limit : undefined,
        });
    }
    catch (err) {
        throw toHttpsError(err);
    }
});
exports.getInboundWorkRequest = (0, https_1.onCall)({ region: REGION }, async (request) => {
    const uid = callerUid(request);
    await requireCapability(uid, exports.INBOUND_WORK_READ);
    try {
        const requestId = (0, inboundWorkModel_1.boundedString)(request.data?.requestId, 255);
        const detail = await (0, inboundWorkReadService_1.readInboundWorkRequest)((0, firestore_1.getFirestore)(), requestId);
        if (!detail)
            throw new https_1.HttpsError("not-found", "That inbound request does not exist.");
        return detail;
    }
    catch (err) {
        throw toHttpsError(err);
    }
});
// ── Service: the three decisions ──────────────────────────────────────────────────────────────────
exports.acceptInboundWork = (0, https_1.onCall)({ region: REGION }, async (request) => {
    const uid = callerUid(request);
    await requireCapability(uid, exports.INBOUND_WORK_ACCEPT);
    const d = (request.data ?? {});
    try {
        return await (0, inboundDecisionCommands_1.acceptInboundWorkRequest)((0, firestore_1.getFirestore)(), {
            requestId: (0, inboundWorkModel_1.boundedString)(d.requestId, 255),
            // NOT from the payload, ever.
            actorUid: uid,
            customerId: (0, inboundWorkModel_1.boundedString)(d.customerId, 255),
            locationId: (0, inboundWorkModel_1.boundedString)(d.locationId, 255),
            equipmentId: (0, inboundWorkModel_1.boundedString)(d.equipmentId, 255) || null,
            requestType: d.requestType ?? null,
            priority: d.priority ?? null,
            problemDescription: (0, inboundWorkModel_1.boundedString)(d.problemDescription, 500) || null,
        });
    }
    catch (err) {
        throw toHttpsError(err);
    }
});
exports.declineInboundWork = (0, https_1.onCall)({ region: REGION }, async (request) => {
    const uid = callerUid(request);
    await requireCapability(uid, exports.INBOUND_WORK_DECLINE);
    const d = (request.data ?? {});
    try {
        return await (0, inboundDecisionCommands_1.declineInboundWorkRequest)((0, firestore_1.getFirestore)(), {
            requestId: (0, inboundWorkModel_1.boundedString)(d.requestId, 255),
            actorUid: uid,
            reason: d.reason,
            note: (0, inboundWorkModel_1.boundedString)(d.note, 500) || null,
        });
    }
    catch (err) {
        throw toHttpsError(err);
    }
});
exports.attachInboundWorkToWorkOrder = (0, https_1.onCall)({ region: REGION }, async (request) => {
    const uid = callerUid(request);
    await requireCapability(uid, exports.INBOUND_WORK_ATTACH);
    const d = (request.data ?? {});
    try {
        return await (0, inboundDecisionCommands_1.attachInboundWorkRequest)((0, firestore_1.getFirestore)(), {
            requestId: (0, inboundWorkModel_1.boundedString)(d.requestId, 255),
            actorUid: uid,
            workOrderId: (0, inboundWorkModel_1.boundedString)(d.workOrderId, 255),
        });
    }
    catch (err) {
        throw toHttpsError(err);
    }
});
// ── Administration: configuration ─────────────────────────────────────────────────────────────────
exports.getEmailIntakeConfiguration = (0, https_1.onCall)({ region: REGION }, async (request) => {
    const uid = callerUid(request);
    await requireCapability(uid, exports.ADMIN_EMAIL_INTAKE_READ);
    try {
        return await (0, inboundWorkReadService_1.readEmailIntakeConfiguration)((0, firestore_1.getFirestore)());
    }
    catch (err) {
        throw toHttpsError(err);
    }
});
exports.saveEmailConnection = (0, https_1.onCall)({ region: REGION }, async (request) => {
    const uid = callerUid(request);
    await requireCapability(uid, exports.ADMIN_EMAIL_INTAKE_MANAGE);
    const d = (request.data ?? {});
    try {
        return await (0, emailAdminCommands_1.upsertEmailConnection)((0, firestore_1.getFirestore)(), { id: (0, inboundWorkModel_1.boundedString)(d.id, 255) || null, actorUid: uid, config: d.config });
    }
    catch (err) {
        throw toHttpsError(err);
    }
});
exports.saveEmailMailbox = (0, https_1.onCall)({ region: REGION }, async (request) => {
    const uid = callerUid(request);
    await requireCapability(uid, exports.ADMIN_EMAIL_INTAKE_MANAGE);
    const d = (request.data ?? {});
    try {
        return await (0, emailAdminCommands_1.upsertEmailMailbox)((0, firestore_1.getFirestore)(), {
            id: (0, inboundWorkModel_1.boundedString)(d.id, 255) || null,
            actorUid: uid,
            config: d.config,
            status: d.status === "DISABLED" ? "DISABLED" : "ACTIVE",
        });
    }
    catch (err) {
        throw toHttpsError(err);
    }
});
exports.saveEmailRoutingRule = (0, https_1.onCall)({ region: REGION }, async (request) => {
    const uid = callerUid(request);
    await requireCapability(uid, exports.ADMIN_EMAIL_INTAKE_MANAGE);
    const d = (request.data ?? {});
    try {
        return await (0, emailAdminCommands_1.upsertEmailRoutingRule)((0, firestore_1.getFirestore)(), { id: (0, inboundWorkModel_1.boundedString)(d.id, 255) || null, actorUid: uid, rule: d.rule });
    }
    catch (err) {
        throw toHttpsError(err);
    }
});
/**
 * DELIVER ONE PROVIDER MESSAGE INTO INTAKE -- the non-production delivery seam.
 *
 * WHY IT EXISTS. Real delivery is a provider poll or webhook holding an OAuth token, and no non-production
 * Microsoft 365 / Google Workspace tenant or client registration is available to this repository. Rather
 * than fabricate credentials, this callable takes a message in the PROVIDER'S OWN native shape (a Microsoft
 * Graph message resource, or a Gmail users.messages resource) and runs it through the identical adapter,
 * routing, processing, threading and intake path a real poll would use. When a tenant is bound, the poller
 * calls `ingestInboundMessage` with an adapter-normalized message and nothing else changes.
 *
 * IT IS REFUSED IN PRODUCTION, twice over: the environment guard below (project identity from the runtime,
 * never from the payload -- `taylor-parts` refused by name AND any role:"production" registry entry refused)
 * and the capability itself, which no production environment can activate. It also requires the
 * ADMINISTRATION manage authority, not the Service queue authority -- injecting a message is a
 * configuration/test act, not an operational one.
 */
exports.deliverInboundEmailMessage = (0, https_1.onCall)({ region: REGION }, async (request) => {
    const uid = callerUid(request);
    await requireCapability(uid, exports.ADMIN_EMAIL_INTAKE_MANAGE);
    try {
        // The same non-production boundary Data Import uses, applied to the same question ("may this
        // environment take externally-shaped writes at all"). Reused rather than re-implemented: a second copy
        // of a production-refusal guard is a second thing that can be got wrong.
        (0, importTargetGuard_1.assertNonProductionImportTarget)(process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? "");
    }
    catch (err) {
        throw new https_1.HttpsError("failed-precondition", `Simulated inbound delivery is not available in this environment. ${err.message}`);
    }
    const d = (request.data ?? {});
    const provider = d.provider;
    if (!(0, emailProvider_1.isEmailProviderId)(provider))
        throw new https_1.HttpsError("invalid-argument", "provider must be MICROSOFT_365 or GOOGLE_WORKSPACE.");
    const mailboxId = (0, inboundWorkModel_1.boundedString)(d.mailboxId, 255);
    if (!mailboxId)
        throw new https_1.HttpsError("invalid-argument", "mailboxId is required.");
    try {
        const db = (0, firestore_1.getFirestore)();
        const mailbox = await (0, inboundWorkReadService_1.readMailbox)(db, mailboxId);
        const message = (0, emailProvider_1.normalizeProviderMessage)(provider, d.message, {
            connectionId: mailbox?.connectionId ?? (0, inboundWorkModel_1.boundedString)(d.connectionId, 255),
            mailboxId,
        });
        const rules = mailbox ? await (0, inboundWorkReadService_1.readRoutingRules)(db) : [];
        return await (0, inboundIntakeCommand_1.ingestInboundMessage)(db, { message, mailbox, rules, actorUid: uid });
    }
    catch (err) {
        throw toHttpsError(err);
    }
});
//# sourceMappingURL=inboundWorkCallables.js.map