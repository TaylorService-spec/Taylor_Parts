"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkOrderInstallError = exports.INSTALLABLE_WORK_ORDER_STATUSES = exports.INSTALL_WORK_ORDER_TYPE = exports.PARTS_COLLECTION = exports.EQUIPMENT_COLLECTION = exports.SERIALIZED_ASSETS_COLLECTION = exports.WORK_ORDERS_COLLECTION = void 0;
exports.validateWorkOrderInstallRequest = validateWorkOrderInstallRequest;
exports.resolveInstallWorkOrder = resolveInstallWorkOrder;
exports.assertWorkOrderInstallable = assertWorkOrderInstallable;
exports.loadWholeUnitPartIds = loadWholeUnitPartIds;
exports.recordWorkOrderEquipmentInstall = recordWorkOrderEquipmentInstall;
const installSerializedAssetCommand_js_1 = require("../equipmentInstall/installSerializedAssetCommand.js");
const serializedAssetReadService_js_1 = require("../serializedAsset/serializedAssetReadService.js");
exports.WORK_ORDERS_COLLECTION = "fieldops_wos";
exports.SERIALIZED_ASSETS_COLLECTION = "serialized_assets";
exports.EQUIPMENT_COLLECTION = "equipment";
exports.PARTS_COLLECTION = "parts";
/**
 * The ONE Work Order type that carries an installation.
 *
 * `INSTALL` is already canonical in WorkOrderType. A second indicator -- requiresEquipmentInstallation
 * or similar -- would be a second way to say what the model already says, and the two would disagree
 * the first time somebody set one without the other.
 */
exports.INSTALL_WORK_ORDER_TYPE = "INSTALL";
/**
 * Work Order statuses from which an installation may be recorded.
 *
 * WORK_IN_PROGRESS only: it is the single state Complete may follow, so recording an installation
 * from anywhere else would produce a machine installed against a job that cannot then be completed.
 * A terminal Work Order is refused outright -- installing against a closed job is a correction, and
 * corrections are not what a closeout screen is for.
 */
exports.INSTALLABLE_WORK_ORDER_STATUSES = Object.freeze(["WORK_IN_PROGRESS"]);
class WorkOrderInstallError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "WorkOrderInstallError";
    }
}
exports.WorkOrderInstallError = WorkOrderInstallError;
const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
/** The keys a caller may send. Notably ABSENT: accountId and locationId -- both come from the Work Order. */
const ALLOWED_KEYS = new Set(["workOrderId", "serializedAssetId", "notes", "idempotencyKey"]);
function validateWorkOrderInstallRequest(input) {
    if (!isPlainObject(input))
        throw new WorkOrderInstallError("REQUEST_INVALID", "request is not an object");
    for (const k of Object.keys(input)) {
        // An accountId or locationId in the payload is not ignored -- it is REFUSED. Silently dropping it
        // would let a caller believe they had chosen a customer, and the mismatch would surface later as
        // an installation somewhere they did not intend.
        if (!ALLOWED_KEYS.has(k)) {
            throw new WorkOrderInstallError("REQUEST_INVALID", `unknown field ${k}` + (k === "accountId" || k === "locationId"
                ? " -- customer and location are derived from the work order, never supplied" : ""));
        }
    }
    const workOrderId = str(input.workOrderId);
    const serializedAssetId = str(input.serializedAssetId);
    const idempotencyKey = str(input.idempotencyKey);
    if (!workOrderId)
        throw new WorkOrderInstallError("REQUEST_INVALID", "workOrderId required");
    if (!serializedAssetId)
        throw new WorkOrderInstallError("REQUEST_INVALID", "serializedAssetId required");
    if (!idempotencyKey)
        throw new WorkOrderInstallError("REQUEST_INVALID", "idempotencyKey required");
    const notes = input.notes === undefined ? undefined : str(input.notes);
    if (input.notes !== undefined && !notes) {
        throw new WorkOrderInstallError("REQUEST_INVALID", "notes must be a non-empty string when present");
    }
    return { workOrderId, serializedAssetId, idempotencyKey, ...(notes ? { notes } : {}) };
}
/** Read the Work Order and say plainly what is wrong with it, if anything. */
async function resolveInstallWorkOrder(db, workOrderId) {
    const snap = await db.collection(exports.WORK_ORDERS_COLLECTION).doc(workOrderId).get();
    if (!snap.exists)
        throw new WorkOrderInstallError("WORK_ORDER_NOT_FOUND", `work order ${workOrderId} not found`);
    const d = snap.data() ?? {};
    return {
        workOrderId,
        status: str(d.status) ?? "",
        type: str(d.type),
        customerId: str(d.customerId),
        locationId: str(d.locationId),
        assignedTechId: str(d.assignedTechId),
        woNumber: str(d.woNumber),
    };
}
/**
 * May this caller record an installation against this Work Order?
 *
 * Deliberately the SAME boundary the Complete action already enforces -- technician, and the one
 * assigned to this specific Work Order. Inventing a separate rule for installation would mean a
 * technician could install on a job they are not allowed to finish, which is a state nobody wants to
 * have to explain.
 */
function assertWorkOrderInstallable(wo, actor, { requireInProgressState = true } = {}) {
    // TYPE FIRST, and never inferred. A Work Order carrying no type, or a type outside the canonical
    // set, is NOT treated as an installation -- live data contains both, and reading a missing value as
    // INSTALL would silently install machines against jobs nobody classified.
    if (wo.type !== exports.INSTALL_WORK_ORDER_TYPE) {
        throw new WorkOrderInstallError("WORK_ORDER_NOT_INSTALL_TYPE", `work order ${wo.workOrderId} is ${wo.type === null ? "untyped" : `type ${wo.type}`}, not ${exports.INSTALL_WORK_ORDER_TYPE}`);
    }
    // THE STATE CHECK IS SKIPPABLE, AND ONLY FOR RECOVERY.
    //
    // A NEW installation may only be recorded from WORK_IN_PROGRESS. But a technician whose install
    // succeeded and whose completion ALSO succeeded -- and who never saw either response -- is asking
    // about a machine that is genuinely installed on a job that is genuinely done. Refusing that query
    // with "this work order is COMPLETED" would be technically true and practically a lie: it reads as
    // "your installation did not happen".
    //
    // So the caller relaxes this check ONLY on the path that has already established the asset is
    // installed for this exact customer and location. Everything else -- capability, type, ownership --
    // is checked first and is never relaxed.
    if (requireInProgressState && !exports.INSTALLABLE_WORK_ORDER_STATUSES.includes(wo.status)) {
        throw new WorkOrderInstallError("WORK_ORDER_STATE_INVALID", `work order ${wo.workOrderId} is ${wo.status}; an installation may only be recorded from ${exports.INSTALLABLE_WORK_ORDER_STATUSES.join(", ")}`);
    }
    // OWN ASSIGNMENT. Holding equipment.install is not permission to finish somebody else's job.
    if (actor.role !== "technician") {
        throw new WorkOrderInstallError("NOT_ASSIGNED_TECHNICIAN", "work order closeout installation is the assigned technician's path; managers install from the Equipment surface");
    }
    if (!actor.technicianId || wo.assignedTechId !== actor.technicianId) {
        throw new WorkOrderInstallError("NOT_ASSIGNED_TECHNICIAN", `work order ${wo.workOrderId} is not assigned to this technician`);
    }
    if (!wo.customerId) {
        throw new WorkOrderInstallError("WORK_ORDER_MISSING_CUSTOMER", `work order ${wo.workOrderId} has no customer, so there is nobody to install for`);
    }
    if (!wo.locationId) {
        throw new WorkOrderInstallError("WORK_ORDER_MISSING_LOCATION", `work order ${wo.workOrderId} has no location, so there is nowhere to install`);
    }
}
/** Whole-unit Part ids, for deciding whether an asset is a machine at all. */
async function loadWholeUnitPartIds(db) {
    const snap = await db.collection(exports.PARTS_COLLECTION).where("wholeUnit", "==", true).get();
    return new Set(snap.docs.map((d) => d.id));
}
/**
 * Record an installation as part of a Work Order.
 *
 * Returns WITHOUT completing the Work Order -- see the header on why ordering, not atomicity, is the
 * consistency model, and why the lifecycle stays where it lives.
 */
async function recordWorkOrderEquipmentInstall(request, deps) {
    const actor = deps.actor;
    if (!isPlainObject(actor) || actor.kind !== "USER" || !str(actor.id)) {
        throw new WorkOrderInstallError("PERMISSION_DENIED", "trusted actor context missing");
    }
    const req = validateWorkOrderInstallRequest(request);
    // CAPABILITY BEFORE ANYTHING IS READ ABOUT THE JOB. A caller who may not install has no business
    // learning which customer a Work Order belongs to.
    if (!(await deps.authorize(null, actor.id, installSerializedAssetCommand_js_1.EQUIPMENT_INSTALL_CAPABILITY))) {
        throw new WorkOrderInstallError("PERMISSION_DENIED", "actor is not authorized to install equipment");
    }
    const wo = await resolveInstallWorkOrder(deps.db, req.workOrderId);
    // Type, ownership, customer and location FIRST -- none of them is ever relaxed. The work order's
    // STATE is checked later, after the asset is known, so a recovery query about an already-installed
    // machine can be answered truthfully even on a job that has since been completed.
    assertWorkOrderInstallable(wo, actor, { requireInProgressState: false });
    const accountId = wo.customerId;
    const locationId = wo.locationId;
    // ---- THE ASSET, and whether this is a retry of something that already worked.
    const assetSnap = await deps.db.collection(exports.SERIALIZED_ASSETS_COLLECTION).doc(req.serializedAssetId).get();
    if (!assetSnap.exists) {
        throw new WorkOrderInstallError("ASSET_NOT_FOUND", `serialized asset ${req.serializedAssetId} not found`);
    }
    // The GOVERNED projection, not the raw document -- provenance fields are stripped before
    // validation, exactly as the install command itself reads an asset.
    const asset = (0, serializedAssetReadService_js_1.projectSerializedAsset)(req.serializedAssetId, assetSnap.data());
    if (asset === null) {
        throw new WorkOrderInstallError("ASSET_NOT_FOUND", `serialized asset ${req.serializedAssetId} cannot be read`);
    }
    // A MACHINE, not a component. A serialized service part has a serial too, and installing one as
    // customer Equipment would put a control board in the installed base as if it were a unit.
    const wholeUnitPartIds = await loadWholeUnitPartIds(deps.db);
    if (!wholeUnitPartIds.has(asset.partId)) {
        throw new WorkOrderInstallError("ASSET_NOT_WHOLE_UNIT", `part ${asset.partId} is not a whole-unit machine`);
    }
    if (asset.currentEquipmentId) {
        // ALREADY INSTALLED. Two very different situations, and conflating them would either lose a
        // machine or duplicate one.
        const eqSnap = await deps.db.collection(exports.EQUIPMENT_COLLECTION).doc(asset.currentEquipmentId).get();
        const eq = eqSnap.exists ? (eqSnap.data() ?? {}) : {};
        const sameJob = str(eq.accountId) === accountId && str(eq.locationId) === locationId;
        if (!sameJob) {
            throw new WorkOrderInstallError("ASSET_INSTALLED_ELSEWHERE", `serialized asset ${req.serializedAssetId} is already installed for another customer or location`);
        }
        // The retry case, answered from the DATABASE rather than from whatever the browser remembers.
        return {
            outcome: "already_installed_for_this_work_order",
            workOrderId: wo.workOrderId,
            equipmentId: asset.currentEquipmentId,
            serializedAssetId: req.serializedAssetId,
            serialNo: asset.serialNo,
            accountId, locationId,
            workOrderStatus: wo.status,
            completionRequired: wo.status !== "COMPLETED" && wo.status !== "CLOSED",
        };
    }
    // NOT a recovery -- this is a genuinely new installation, so the work order's state applies.
    assertWorkOrderInstallable(wo, actor, { requireInProgressState: true });
    if (!installSerializedAssetCommand_js_1.INSTALLABLE_STATES.includes(asset.inventoryState)) {
        throw new WorkOrderInstallError("ASSET_NOT_INSTALLABLE", `serialized asset ${req.serializedAssetId} is ${asset.inventoryState}`);
    }
    // ---- THE ONE AUTHORITY. Everything above decided whether to ask; this is the asking.
    let outcome;
    try {
        outcome = await (0, installSerializedAssetCommand_js_1.installSerializedAsset)({
            serializedAssetId: req.serializedAssetId,
            accountId, locationId,
            name: `${asset.serialNo}`,
            idempotencyKey: req.idempotencyKey,
            ...(req.notes ? { notes: req.notes } : {}),
        }, {
            db: deps.db,
            actor: { kind: "USER", id: actor.id },
            authorize: (txn, actorId, capability) => deps.authorize(txn, actorId, capability),
            stageAudit: deps.stageAudit,
            now: deps.now,
            // The origin, established here by reading the Work Order -- never taken from the request.
            sourceContext: { kind: "WORK_ORDER", workOrderId: wo.workOrderId },
        });
    }
    catch (err) {
        // The install authority's refusals are its own and are not re-translated into this command's
        // vocabulary -- an ALREADY_INSTALLED from the transaction means something raced us, and saying so
        // in its own words is more useful than renaming it.
        if (err instanceof installSerializedAssetCommand_js_1.InstallCommandError)
            throw err;
        throw err;
    }
    return {
        outcome: outcome.outcome,
        workOrderId: wo.workOrderId,
        equipmentId: outcome.equipmentId,
        serializedAssetId: outcome.serializedAssetId,
        serialNo: outcome.serialNo,
        accountId, locationId,
        // Re-read from the Work Order as it was BEFORE this command -- this command does not complete it,
        // and reporting a status it did not cause would be a claim it has no right to make.
        workOrderStatus: wo.status,
        completionRequired: true,
    };
}
//# sourceMappingURL=workOrderInstallCommand.js.map