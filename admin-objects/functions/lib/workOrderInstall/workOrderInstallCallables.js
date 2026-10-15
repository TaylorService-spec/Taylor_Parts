"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordWorkOrderEquipmentInstallCallable = exports.getInstallableEquipmentForWorkOrder = void 0;
// THE TECHNICIAN'S TWO CALLABLES: what can I install, and record that I did.
//
// ============================ WHY A WORK-ORDER-SCOPED READ ============================
//
// `getAvailableEquipment` already returns installable units, and reusing it would have been less
// code. It was NOT reused, for one reason: it is gated on `inventory.serializedAsset.read`, a general
// inventory-browsing capability that the installer technicians do not hold and should not be given.
// Granting it to populate a picker would hand a technician the whole serialized inventory in order to
// let them choose one machine on one job.
//
// So this read is gated on `equipment.install` and scoped by the Work Order: it answers "what may I
// install on THIS job", which is the only question a closeout screen has.
//
// `serialized_assets` remains deny-all to every client, and nothing here changes that. The technician
// never reads the collection; a trusted function reads it on their behalf, having first checked that
// the job is theirs.
//
// ============================ SCAN IS NOT INSTALL ============================
//
// Resolving a scanned serial is a READ. It returns what the serial is and whether it may be
// installed, and it writes nothing at all -- no Equipment, no state change, no completion. Only the
// record callable mutates anything, and only when the technician explicitly confirms.
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const workOrderInstallCommand_js_1 = require("./workOrderInstallCommand.js");
const installSerializedAssetCommand_js_1 = require("../equipmentInstall/installSerializedAssetCommand.js");
const installCallableWiring_js_1 = require("../equipmentInstall/installCallableWiring.js");
const serializedAssetReadService_js_1 = require("../serializedAsset/serializedAssetReadService.js");
const effectiveAccessFeed_js_1 = require("../access/effectiveAccessFeed.js");
const callerContext_js_1 = require("../callerContext.js");
const REGION = { region: "us-central1" };
/** How many units a closeout picker may list. A technician chooses one machine, not a catalogue. */
const INSTALLABLE_LIST_CAP = 200;
const throughTxn = (0, installCallableWiring_js_1.makeResolveInstallPermissionThroughTxn)(installSerializedAssetCommand_js_1.EQUIPMENT_INSTALL_CAPABILITY);
/**
 * Capability, resolved two ways for two different moments.
 *
 * Outside a transaction (the read, and the pre-flight on the write) the trusted feed answers. Inside
 * the install transaction, the transaction-scoped resolver answers, so a revocation mid-flight
 * conflicts the commit. Both ask the same question of the same records; neither is a shortcut.
 */
async function allows(uid, capability) {
    try {
        const { decisions } = await (0, effectiveAccessFeed_js_1.resolveEffectiveAccess)({ principalUid: uid, permissionIds: [capability] });
        return decisions[capability] === true;
    }
    catch (err) {
        console.error(`[workOrderInstall] capability resolution failed for ${capability}`, err);
        return false; // A THROWING resolver is a denial, never an allow.
    }
}
const authorize = (txn, db) => (t, actorId, capability) => (t === null ? allows(actorId, capability) : throughTxn(t, db, actorId));
/** Actor identity from the authenticated session plus users/{uid} -- never from a payload. */
async function resolveActor(uid) {
    const ctx = await (0, callerContext_js_1.getCallerContext)(uid);
    return { kind: "USER", id: uid, technicianId: ctx.technicianId, role: ctx.role };
}
const FAILURE = Object.freeze({
    PERMISSION_DENIED: { status: "permission-denied", message: "You are not authorized to record an equipment installation." },
    WORK_ORDER_NOT_FOUND: { status: "not-found", message: "That work order could not be found." },
    WORK_ORDER_NOT_INSTALL_TYPE: { status: "failed-precondition", message: "This work order is not an installation, so no equipment is installed on it." },
    WORK_ORDER_STATE_INVALID: { status: "failed-precondition", message: "This work order is not in progress, so an installation cannot be recorded against it." },
    NOT_ASSIGNED_TECHNICIAN: { status: "permission-denied", message: "This work order is not assigned to you." },
    WORK_ORDER_MISSING_CUSTOMER: { status: "failed-precondition", message: "This work order has no customer recorded." },
    WORK_ORDER_MISSING_LOCATION: { status: "failed-precondition", message: "This work order has no location recorded." },
    ASSET_NOT_FOUND: { status: "not-found", message: "That serial could not be found." },
    ASSET_NOT_WHOLE_UNIT: { status: "failed-precondition", message: "That serial is not a machine, so it cannot be installed as equipment." },
    ASSET_NOT_INSTALLABLE: { status: "failed-precondition", message: "That unit is not in a state that can be installed." },
    ASSET_INSTALLED_ELSEWHERE: { status: "failed-precondition", message: "That unit is already installed for another customer." },
    REQUEST_INVALID: { status: "invalid-argument", message: "That installation request is not valid." },
});
function toHttps(err) {
    if (err instanceof workOrderInstallCommand_js_1.WorkOrderInstallError) {
        const m = FAILURE[err.code];
        return new https_1.HttpsError(m.status, m.message, err.code);
    }
    if (err instanceof installSerializedAssetCommand_js_1.InstallCommandError) {
        // The install authority's own refusals pass through under their own codes. Renaming them here
        // would give the same condition two names depending on which door it came through.
        return new https_1.HttpsError("failed-precondition", "That unit could not be installed.", err.code);
    }
    console.error("[workOrderInstall] failed", err);
    return new https_1.HttpsError("internal", "The request could not be completed.", "INTERNAL");
}
/**
 * What may be installed on this work order.
 *
 * Read-only. Writes nothing, ever -- including when a scanned serial is supplied.
 */
exports.getInstallableEquipmentForWorkOrder = (0, https_1.onCall)(REGION, async (request) => {
    if (!request.auth?.uid)
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    const db = (0, firestore_1.getFirestore)();
    const uid = request.auth.uid;
    try {
        const workOrderId = typeof (request.data ?? {}).workOrderId === "string" ? request.data.workOrderId.trim() : "";
        if (!workOrderId)
            throw new workOrderInstallCommand_js_1.WorkOrderInstallError("REQUEST_INVALID", "workOrderId required");
        const scannedSerial = typeof (request.data ?? {}).serialNo === "string" ? request.data.serialNo.trim() : null;
        if (!(await allows(uid, installSerializedAssetCommand_js_1.EQUIPMENT_INSTALL_CAPABILITY))) {
            throw new workOrderInstallCommand_js_1.WorkOrderInstallError("PERMISSION_DENIED", "not authorized to install equipment");
        }
        const actor = await resolveActor(uid);
        const wo = await (0, workOrderInstallCommand_js_1.resolveInstallWorkOrder)(db, workOrderId);
        // The SAME eligibility the write path enforces. A read that answered for a job the caller may not
        // finish would leak which machines are available to somebody who cannot use them.
        (0, workOrderInstallCommand_js_1.assertWorkOrderInstallable)(wo, actor);
        const wholeUnitPartIds = await (0, workOrderInstallCommand_js_1.loadWholeUnitPartIds)(db);
        const partsSnap = await db.collection(workOrderInstallCommand_js_1.PARTS_COLLECTION).where("wholeUnit", "==", true).get();
        const partById = new Map(partsSnap.docs.map((d) => [d.id, d.data() ?? {}]));
        // Query by STATE, then filter to whole units in memory. `serialized_assets` has no wholeUnit field
        // -- that lives on the Part -- so a single query cannot express both halves.
        const assetsSnap = await db.collection(workOrderInstallCommand_js_1.SERIALIZED_ASSETS_COLLECTION)
            .where("inventoryState", "in", [...installSerializedAssetCommand_js_1.INSTALLABLE_STATES]).limit(INSTALLABLE_LIST_CAP * 2).get();
        const units = [];
        for (const doc of assetsSnap.docs) {
            const asset = (0, serializedAssetReadService_js_1.projectSerializedAsset)(doc.id, doc.data());
            if (asset === null)
                continue; // malformed: omitted, never fabricated
            if (asset.currentEquipmentId)
                continue; // belongs to somebody already
            if (!wholeUnitPartIds.has(asset.partId))
                continue; // a component, not a machine
            if (scannedSerial && asset.serialNo !== scannedSerial)
                continue;
            const part = partById.get(asset.partId) ?? {};
            units.push({
                serializedAssetId: doc.id,
                serialNo: asset.serialNo,
                partId: asset.partId,
                // The display fields a technician needs to confirm they have the right box in front of them.
                productName: typeof part.name === "string" ? part.name : null,
                equipmentModelId: typeof part.equipmentModelId === "string" ? part.equipmentModelId : null,
                inventoryState: asset.inventoryState,
                currentLocationId: asset.currentLocationId,
            });
            if (units.length >= INSTALLABLE_LIST_CAP)
                break;
        }
        return {
            status: "ready",
            workOrder: {
                workOrderId: wo.workOrderId,
                woNumber: wo.woNumber,
                // Inherited, and returned so the UI can DISPLAY them read-only rather than offer them.
                customerId: wo.customerId,
                locationId: wo.locationId,
                status: wo.status,
                type: wo.type,
            },
            installableStates: [...installSerializedAssetCommand_js_1.INSTALLABLE_STATES],
            workOrderStates: [...workOrderInstallCommand_js_1.INSTALLABLE_WORK_ORDER_STATUSES],
            units,
            truncated: units.length >= INSTALLABLE_LIST_CAP,
            // Said explicitly so no caller has to infer it: looking is not installing.
            mutated: false,
        };
    }
    catch (err) {
        throw toHttps(err);
    }
});
/**
 * Record the installation. Step ONE of closeout -- the Work Order is completed separately.
 *
 * See workOrderInstallCommand's header: install first, complete after, so a completed job whose
 * installation failed cannot exist.
 */
exports.recordWorkOrderEquipmentInstallCallable = (0, https_1.onCall)(REGION, async (request) => {
    if (!request.auth?.uid)
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    const db = (0, firestore_1.getFirestore)();
    const uid = request.auth.uid;
    try {
        const actor = await resolveActor(uid);
        return await (0, workOrderInstallCommand_js_1.recordWorkOrderEquipmentInstall)(request.data, {
            db,
            actor,
            authorize: authorize(null, db),
            stageAudit: installCallableWiring_js_1.stageInstallAuditEvent,
            now: () => new Date(),
        });
    }
    catch (err) {
        throw toHttps(err);
    }
});
//# sourceMappingURL=workOrderInstallCallables.js.map