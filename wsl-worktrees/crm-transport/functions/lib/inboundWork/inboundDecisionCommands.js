"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InboundDecisionError = void 0;
exports.workOrderTypeForRequestType = workOrderTypeForRequestType;
exports.acceptInboundWorkRequest = acceptInboundWorkRequest;
exports.declineInboundWorkRequest = declineInboundWorkRequest;
exports.attachInboundWorkRequest = attachInboundWorkRequest;
// Email Connections + Inbound Work -- THE THREE GOVERNED DECISIONS: accept, decline, attach to existing.
//
// ACCEPT IS THE WHOLE POINT OF THE FEATURE, and it is one server-authoritative transaction, not a sequence
// of client writes. Everything it must be true about is proven inside that transaction: the intake exists
// and is still undecided, the chosen customer / location / equipment really exist and belong together, the
// Work Order is created through the SAME governed createWorkOrderRecord core an admin uses by hand, the
// intake is linked to it, and the audit event commits with the write or not at all.
//
// TWO CLICKS CANNOT MAKE TWO WORK ORDERS. The intake's own status is the idempotency substrate: the second
// transaction reads ACCEPTED, writes nothing, and returns the SAME workItemId the first one created. That
// is stronger than a client-supplied idempotency key, because it holds for two different clients, a retry
// after a lost response, and a double-submit alike.
//
// MASTER DATA IS NOT TOUCHED. Accepting uses the reviewer's chosen ids for the Work Order. If the email
// spells the site address differently, or names a contact EOS does not have, no Customer / Location /
// Contact / Equipment record is created or edited here -- proposing a master-data change is the governance
// product's job (Verenward Data Governance, or whichever platform the customer uses), and base EOS silently
// rewriting mastered data from an unauthenticated email would be the worst possible version of "helpful".
const firestore_1 = require("firebase-admin/firestore");
const collections_1 = require("../constants/collections");
const auditEventWriter_1 = require("../access/auditEventWriter");
const createWorkOrder_1 = require("../createWorkOrder");
const workOrderInstallCommand_1 = require("../workOrderInstall/workOrderInstallCommand");
const workOrderEquipment_1 = require("../workOrderEquipment");
const inboundWorkModel_1 = require("./inboundWorkModel");
const ACCOUNTS_COLLECTION = "accounts";
const LOCATIONS_COLLECTION = "locations";
class InboundDecisionError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "InboundDecisionError";
        this.code = code;
    }
}
exports.InboundDecisionError = InboundDecisionError;
/** Inbound classification -> the governed Work Order type. PARTS/OTHER are ordinary service calls. */
function workOrderTypeForRequestType(requestType) {
    switch (requestType) {
        case "WARRANTY":
            return "WARRANTY";
        case "INSTALL":
            return "INSTALL";
        case "PM":
            return "PM";
        default:
            return "SERVICE_CALL";
    }
}
async function acceptInboundWorkRequest(db, input) {
    const requestId = (0, inboundWorkModel_1.boundedString)(input?.requestId, 255);
    const actorUid = (0, inboundWorkModel_1.boundedString)(input?.actorUid, 255);
    const customerId = (0, inboundWorkModel_1.boundedString)(input?.customerId, 255);
    const locationId = (0, inboundWorkModel_1.boundedString)(input?.locationId, 255);
    const equipmentId = (0, inboundWorkModel_1.boundedString)(input?.equipmentId, 255) || null;
    if (!requestId)
        throw new InboundDecisionError("INVALID_INPUT", "requestId is required.");
    if (!actorUid)
        throw new InboundDecisionError("INVALID_INPUT", "An authenticated actor is required.");
    if (!customerId)
        throw new InboundDecisionError("INVALID_INPUT", "A customer must be selected before accepting.");
    if (!locationId)
        throw new InboundDecisionError("INVALID_INPUT", "A location must be selected before accepting.");
    const requestRef = db.collection(collections_1.INBOUND_WORK_REQUESTS_COLLECTION).doc(requestId);
    const year = new Date().getFullYear();
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(requestRef);
        if (!snap.exists)
            throw new InboundDecisionError("NOT_FOUND", "That inbound request does not exist.");
        const data = snap.data();
        const status = data.status;
        // REPLAY, NOT A SECOND WORK ORDER. An already-accepted intake returns what it created.
        if (status === "ACCEPTED" && (0, inboundWorkModel_1.boundedString)(data.workItemId, 255)) {
            const workItemId = (0, inboundWorkModel_1.boundedString)(data.workItemId, 255);
            const wo = await tx.get(db.collection(collections_1.WORK_ORDERS_COLLECTION).doc(workItemId));
            return { requestId, workItemId, woNumber: (0, inboundWorkModel_1.boundedString)(wo.data()?.woNumber, 64) || null, replayed: true };
        }
        if (!inboundWorkModel_1.DECIDABLE_STATUSES.has(status)) {
            throw new InboundDecisionError("ALREADY_DECIDED", `This request is ${status} and can no longer be accepted.`);
        }
        const requestType = (0, inboundWorkModel_1.isInboundRequestType)(input.requestType)
            ? input.requestType
            : (0, inboundWorkModel_1.isInboundRequestType)(data.requestType)
                ? data.requestType
                : null;
        const type = workOrderTypeForRequestType(requestType);
        (0, workOrderEquipment_1.assertEquipmentAllowedForType)(type, equipmentId ?? undefined);
        // IDENTITY IS PROVEN FROM THE STORED RECORDS, INSIDE THE TRANSACTION. The reviewer's picker filtered
        // the choices, and a filter is a convenience for the person choosing -- it is not evidence.
        const [customerSnap, locationSnap] = await Promise.all([
            tx.get(db.collection(ACCOUNTS_COLLECTION).doc(customerId)),
            tx.get(db.collection(LOCATIONS_COLLECTION).doc(locationId)),
        ]);
        if (!customerSnap.exists)
            throw new InboundDecisionError("CUSTOMER_NOT_FOUND", "The selected customer does not exist.");
        if (!locationSnap.exists)
            throw new InboundDecisionError("LOCATION_NOT_FOUND", "The selected location does not exist.");
        const locationAccountId = (0, inboundWorkModel_1.boundedString)(locationSnap.data()?.accountId, 255);
        if (locationAccountId && locationAccountId !== customerId) {
            throw new InboundDecisionError("LOCATION_CUSTOMER_MISMATCH", "The selected location belongs to a different customer.");
        }
        if (equipmentId) {
            const eqSnap = await tx.get(db.collection(workOrderInstallCommand_1.EQUIPMENT_COLLECTION).doc(equipmentId));
            const eq = eqSnap.data();
            (0, workOrderEquipment_1.assertEquipmentIntegrity)({ exists: eqSnap.exists, accountId: (0, inboundWorkModel_1.boundedString)(eq?.accountId, 255) || null, locationId: (0, inboundWorkModel_1.boundedString)(eq?.locationId, 255) || null }, { customerId, locationId });
        }
        const priority = input.priority === 1 || input.priority === 2 || input.priority === 3 || input.priority === 4
            ? input.priority
            : data.priority === 1 || data.priority === 2 || data.priority === 3 || data.priority === 4
                ? data.priority
                : 3;
        // NO RE-TYPING. The complaint the Work Order carries is the problem the message described, unless the
        // reviewer corrected it. Falling back to the subject keeps a Work Order from being created blank when
        // extraction found nothing.
        const complaint = (0, inboundWorkModel_1.boundedString)(input.problemDescription, 500) ||
            (0, inboundWorkModel_1.boundedString)(data.problemDescription, 500) ||
            (0, inboundWorkModel_1.boundedString)(data.subject, 500) ||
            "Inbound request";
        const externalReference = (0, inboundWorkModel_1.boundedString)(data.externalReference, 120);
        const authorizationNumber = (0, inboundWorkModel_1.boundedString)(data.authorizationNumber, 120);
        const created = await (0, createWorkOrder_1.createWorkOrderRecord)(db, tx, {
            customerId,
            locationId,
            priority,
            type,
            complaint,
            ...(equipmentId ? { equipmentId } : {}),
            inboundWorkRequestId: requestId,
            ...(externalReference ? { externalReference } : {}),
            ...(authorizationNumber ? { authorizationNumber } : {}),
        }, year);
        tx.update(requestRef, {
            status: "ACCEPTED",
            decision: "ACCEPTED",
            decisionReason: null,
            decisionBy: actorUid,
            decisionAt: firestore_1.FieldValue.serverTimestamp(),
            customerId,
            customerLocationId: locationId,
            equipmentId,
            requestType,
            priority,
            problemDescription: complaint,
            workItemId: created.id,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
        // TWO EVENTS, ONE TRANSACTION, and both are needed to answer the question this trail exists for.
        // The first is the DECISION, filed against the inbound request: who accepted it and when. The second
        // is the CREATE, filed against the Work Order -- the plain createWorkOrder callable writes exactly
        // this event for a hand-made Work Order, and an accepted one must not be the single Work Order in the
        // estate whose creation has no event under its own id. Reading either way round works: from the Work
        // Order back to the request that caused it, or from the request forward to the job it became.
        (0, auditEventWriter_1.stageAuditEvent)(tx, {
            actorUid,
            action: "acceptInboundWorkRequest",
            targetType: "inboundWorkRequest",
            targetId: requestId,
            outcome: "applied",
            summary: `accepted inbound request and created work order ${created.woNumber}`,
        });
        (0, auditEventWriter_1.stageAuditEvent)(tx, {
            actorUid,
            action: "createWorkOrder",
            targetType: "workOrder",
            targetId: created.id,
            outcome: "applied",
            summary: `created work order ${created.woNumber} from inbound request ${requestId}`,
        });
        return { requestId, workItemId: created.id, woNumber: created.woNumber, replayed: false };
    });
}
/** Declined intake is RETAINED, never deleted: decline reasons are a reporting fact and an audit fact. */
async function declineInboundWorkRequest(db, input) {
    const requestId = (0, inboundWorkModel_1.boundedString)(input?.requestId, 255);
    const actorUid = (0, inboundWorkModel_1.boundedString)(input?.actorUid, 255);
    if (!requestId)
        throw new InboundDecisionError("INVALID_INPUT", "requestId is required.");
    if (!actorUid)
        throw new InboundDecisionError("INVALID_INPUT", "An authenticated actor is required.");
    if (!(0, inboundWorkModel_1.isInboundDeclineReason)(input?.reason))
        throw new InboundDecisionError("INVALID_INPUT", "A valid decline reason is required.");
    const note = (0, inboundWorkModel_1.boundedString)(input?.note, 500) || null;
    const requestRef = db.collection(collections_1.INBOUND_WORK_REQUESTS_COLLECTION).doc(requestId);
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(requestRef);
        if (!snap.exists)
            throw new InboundDecisionError("NOT_FOUND", "That inbound request does not exist.");
        const status = snap.data().status;
        if (status === "DECLINED")
            return { requestId, replayed: true };
        if (!inboundWorkModel_1.DECIDABLE_STATUSES.has(status)) {
            throw new InboundDecisionError("ALREADY_DECIDED", `This request is ${status} and can no longer be declined.`);
        }
        tx.update(requestRef, {
            status: "DECLINED",
            decision: "DECLINED",
            decisionReason: input.reason,
            decisionNote: note,
            decisionBy: actorUid,
            decisionAt: firestore_1.FieldValue.serverTimestamp(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
        (0, auditEventWriter_1.stageAuditEvent)(tx, {
            actorUid,
            action: "declineInboundWorkRequest",
            targetType: "inboundWorkRequest",
            targetId: requestId,
            outcome: "applied",
            summary: `declined inbound request (${input.reason})`,
        });
        return { requestId, replayed: false };
    });
}
/**
 * The message belongs to work that already exists. The intake, its original message and its attachments are
 * preserved against that Work Order and NO new Work Order is created -- which is the same protection thread
 * association gives automatically, made available to a reviewer who recognises the connection themselves.
 */
async function attachInboundWorkRequest(db, input) {
    const requestId = (0, inboundWorkModel_1.boundedString)(input?.requestId, 255);
    const actorUid = (0, inboundWorkModel_1.boundedString)(input?.actorUid, 255);
    const workOrderId = (0, inboundWorkModel_1.boundedString)(input?.workOrderId, 255);
    if (!requestId)
        throw new InboundDecisionError("INVALID_INPUT", "requestId is required.");
    if (!actorUid)
        throw new InboundDecisionError("INVALID_INPUT", "An authenticated actor is required.");
    if (!workOrderId)
        throw new InboundDecisionError("INVALID_INPUT", "A Work Order must be selected.");
    const requestRef = db.collection(collections_1.INBOUND_WORK_REQUESTS_COLLECTION).doc(requestId);
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(requestRef);
        if (!snap.exists)
            throw new InboundDecisionError("NOT_FOUND", "That inbound request does not exist.");
        const data = snap.data();
        const status = data.status;
        if (status === "ATTACHED" && (0, inboundWorkModel_1.boundedString)(data.workItemId, 255) === workOrderId) {
            return { requestId, workItemId: workOrderId, replayed: true };
        }
        if (!inboundWorkModel_1.DECIDABLE_STATUSES.has(status)) {
            throw new InboundDecisionError("ALREADY_DECIDED", `This request is ${status} and can no longer be attached.`);
        }
        const woSnap = await tx.get(db.collection(collections_1.WORK_ORDERS_COLLECTION).doc(workOrderId));
        if (!woSnap.exists)
            throw new InboundDecisionError("WORK_ORDER_NOT_FOUND", "That Work Order does not exist.");
        const wo = woSnap.data();
        tx.update(requestRef, {
            status: "ATTACHED",
            decision: "ATTACHED",
            decisionBy: actorUid,
            decisionAt: firestore_1.FieldValue.serverTimestamp(),
            workItemId: workOrderId,
            // The Work Order's own customer/location become the intake's resolved references: the record it is
            // filed against is the authority on who it is for, never the email.
            customerId: (0, inboundWorkModel_1.boundedString)(wo.customerId, 255) || null,
            customerLocationId: (0, inboundWorkModel_1.boundedString)(wo.locationId, 255) || null,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
        (0, auditEventWriter_1.stageAuditEvent)(tx, {
            actorUid,
            action: "attachInboundWorkRequest",
            targetType: "inboundWorkRequest",
            targetId: requestId,
            outcome: "applied",
            summary: `attached inbound request to work order ${(0, inboundWorkModel_1.boundedString)(wo.woNumber, 64) || workOrderId}`,
        });
        return { requestId, workItemId: workOrderId, replayed: false };
    });
}
//# sourceMappingURL=inboundDecisionCommands.js.map