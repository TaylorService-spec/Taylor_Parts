"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serialNumberKey = serialNumberKey;
exports.resolveInboundCandidates = resolveInboundCandidates;
const workOrderInstallCommand_1 = require("../workOrderInstall/workOrderInstallCommand");
const inboundProcessing_1 = require("./inboundProcessing");
const inboundWorkModel_1 = require("./inboundWorkModel");
const CONTACTS_COLLECTION = "contacts";
/** The comparison key `equipment.serialNumberKey` holds -- derived exactly as equipmentImportCommand does. */
function serialNumberKey(serial) {
    return (0, inboundWorkModel_1.boundedString)(serial, inboundWorkModel_1.MAX_EXTRACTED_FIELD_LENGTH).toUpperCase().replace(/\s+/g, "");
}
const candidate = (id, rawValue, matchedOn) => ({
    id,
    rawValue: (0, inboundWorkModel_1.boundedString)(rawValue, inboundWorkModel_1.MAX_EXTRACTED_FIELD_LENGTH),
    confidence: id ? "EXACT" : "NONE",
    matchedOn: id ? matchedOn : "",
});
/**
 * Resolve the customer / location / equipment suggestions for one inbound message.
 *
 * EQUIPMENT FIRST, because a serial is the strongest identifier in a service email and it carries the
 * account and site with it. The sender address is only consulted for the customer, and only when the
 * serial produced nothing -- a vendor emailing on a customer's behalf must not silently retarget a request
 * that already named a machine.
 *
 * `limit(2)` everywhere: two hits means the key is not unique in this data, and the honest answer is then
 * NONE plus the raw value, not the first row.
 */
async function resolveInboundCandidates(db, input) {
    const serialRaw = (0, inboundWorkModel_1.boundedString)(input?.serialNumber, inboundWorkModel_1.MAX_EXTRACTED_FIELD_LENGTH);
    const sender = (0, inboundWorkModel_1.normalizeEmailAddress)(input?.senderEmail);
    let customerCandidate = inboundProcessing_1.NO_CANDIDATE;
    let locationCandidate = inboundProcessing_1.NO_CANDIDATE;
    let equipmentCandidate = serialRaw ? candidate(null, serialRaw, "") : inboundProcessing_1.NO_CANDIDATE;
    if (serialRaw) {
        const key = serialNumberKey(serialRaw);
        const snap = await db.collection(workOrderInstallCommand_1.EQUIPMENT_COLLECTION).where("serialNumberKey", "==", key).limit(2).get();
        if (snap.size === 1) {
            const doc = snap.docs[0];
            const data = doc.data();
            equipmentCandidate = candidate(doc.id, serialRaw, "serialNumberKey");
            const accountId = (0, inboundWorkModel_1.boundedString)(data.accountId, 255);
            const locationId = (0, inboundWorkModel_1.boundedString)(data.locationId, 255);
            if (accountId)
                customerCandidate = candidate(accountId, serialRaw, "equipmentAccount");
            if (locationId)
                locationCandidate = candidate(locationId, serialRaw, "equipmentLocation");
        }
    }
    if (!customerCandidate.id && sender) {
        const snap = await db.collection(CONTACTS_COLLECTION).where("email", "==", sender).limit(2).get();
        if (snap.size === 1) {
            const accountId = (0, inboundWorkModel_1.boundedString)(snap.docs[0].data().accountId, 255);
            customerCandidate = accountId ? candidate(accountId, sender, "contactEmail") : candidate(null, sender, "");
        }
        else {
            customerCandidate = candidate(null, sender, "");
        }
    }
    return { customerCandidate, locationCandidate, equipmentCandidate };
}
//# sourceMappingURL=inboundCandidateResolution.js.map