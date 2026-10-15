"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InstallCommandError = exports.INSTALLED_STATE = exports.INSTALLABLE_STATES = exports.EQUIPMENT_INSTALL_CAPABILITY = exports.LOCATIONS_COLLECTION = exports.ACCOUNTS_COLLECTION = exports.EQUIPMENT_COLLECTION = void 0;
exports.validateInstallRequest = validateInstallRequest;
exports.equipmentDocIdFor = equipmentDocIdFor;
exports.installFingerprint = installFingerprint;
exports.installSerializedAsset = installSerializedAsset;
const node_crypto_1 = require("node:crypto");
const collections_js_1 = require("../constants/collections.js");
const serializedAssetReadService_js_1 = require("../serializedAsset/serializedAssetReadService.js");
exports.EQUIPMENT_COLLECTION = "equipment";
exports.ACCOUNTS_COLLECTION = "accounts";
exports.LOCATIONS_COLLECTION = "locations";
/**
 * The capability this command requires. Declared `active: false`. Measured 2026-09-12: held by the
 * purpose-built equipmentInstaller Role (access/governedBusinessRoles.ts) and ACTIVATED in
 * platform-sandbox (config/environments.json); production neither activates nor grants it.
 */
exports.EQUIPMENT_INSTALL_CAPABILITY = "equipment.install";
/**
 * Lifecycle states from which a unit may be installed.
 *
 * A SUBSET, and deliberately not "anything that is not INSTALLED". The states below are the ones
 * where the unit is in settled company custody and available to hand over:
 *
 *   AVAILABLE   on the shelf, unreserved
 *   RESERVED    set aside, presumably for this very job
 *   STAGED      picked and waiting to go out
 *   DELIVERED   physically at the customer, not yet linked
 *
 * The excluded ones are excluded for a reason, not by oversight:
 *
 *   RECEIVED    arrived at the dock and not yet put away -- installing it would skip custody
 *   LOADED      on a van as cargo
 *   IN_TRANSIT  mid-transfer; a transfer's own commit would race this one
 *   INSTALLED   already somebody's
 */
exports.INSTALLABLE_STATES = Object.freeze(["AVAILABLE", "RESERVED", "STAGED", "DELIVERED"]);
exports.INSTALLED_STATE = "INSTALLED";
class InstallCommandError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "InstallCommandError";
    }
}
exports.InstallCommandError = InstallCommandError;
const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v) => typeof v === "string" && v.trim() !== "" ? v : null;
/** The keys a caller may send. Anything else denies the whole request. */
const ALLOWED_KEYS = new Set([
    "serializedAssetId", "accountId", "locationId", "name",
    "installedDate", "assetTag", "notes", "idempotencyKey",
]);
function validateInstallRequest(input) {
    if (!isPlainObject(input))
        throw new InstallCommandError("REQUEST_INVALID", "request is not an object");
    for (const k of Object.keys(input)) {
        if (!ALLOWED_KEYS.has(k))
            throw new InstallCommandError("REQUEST_INVALID", `unknown field ${k}`);
    }
    const serializedAssetId = str(input.serializedAssetId);
    const accountId = str(input.accountId);
    const locationId = str(input.locationId);
    const name = str(input.name);
    const idempotencyKey = str(input.idempotencyKey);
    if (!serializedAssetId)
        throw new InstallCommandError("REQUEST_INVALID", "serializedAssetId required");
    if (!accountId)
        throw new InstallCommandError("REQUEST_INVALID", "accountId required");
    if (!locationId)
        throw new InstallCommandError("REQUEST_INVALID", "locationId required");
    // `name` is the human reference in the Equipment register and Rules require it. A caller that does
    // not supply one is not helped by a generated placeholder nobody chose.
    if (!name)
        throw new InstallCommandError("REQUEST_INVALID", "name required");
    if (!idempotencyKey)
        throw new InstallCommandError("REQUEST_INVALID", "idempotencyKey required");
    const optional = (k) => {
        const v = input[k];
        if (v === undefined)
            return undefined;
        const s = str(v);
        if (!s)
            throw new InstallCommandError("REQUEST_INVALID", `${k} must be a non-empty string when present`);
        return s;
    };
    return {
        serializedAssetId, accountId, locationId, name, idempotencyKey,
        installedDate: optional("installedDate"),
        assetTag: optional("assetTag"),
        notes: optional("notes"),
    };
}
/**
 * The Equipment document id, DERIVED from the request identity.
 *
 * Derived rather than allocated for the same reason the receiving and transfer commands derive
 * theirs: `create` on a derived id IS the idempotency check. Firestore rejects a create on an
 * existing document, inside the transaction, with no separate existence race.
 */
function equipmentDocIdFor(idempotencyKey) {
    return "eq_" + (0, node_crypto_1.createHash)("sha256").update(JSON.stringify(["equipmentInstall", idempotencyKey]))
        .digest("hex").slice(0, 40);
}
/** What the stored request meant, so a replay can be told from a conflicting reuse of the key. */
function installFingerprint(req) {
    return (0, node_crypto_1.createHash)("sha256").update(JSON.stringify([
        req.serializedAssetId, req.accountId, req.locationId, req.name,
        req.installedDate ?? null, req.assetTag ?? null,
    ])).digest("hex").slice(0, 16);
}
/**
 * Install one serialized asset as customer Equipment.
 *
 * ONE TRANSACTION. Creating the Equipment record and linking the asset are two writes describing one
 * fact, and a world where either happened without the other is worse than a world where neither did:
 * an Equipment record nothing points at is a customer machine with no unit behind it, and an asset
 * marked INSTALLED with no Equipment is a unit that has left inventory and arrived nowhere.
 */
async function installSerializedAsset(request, deps) {
    const actor = deps.actor;
    if (!isPlainObject(actor) || (actor.kind !== "USER" && actor.kind !== "SYSTEM") || !str(actor.id)) {
        throw new InstallCommandError("PERMISSION_DENIED", "trusted actor context missing");
    }
    const req = validateInstallRequest(request);
    const equipmentId = equipmentDocIdFor(req.idempotencyKey);
    const fingerprint = installFingerprint(req);
    return deps.db.runTransaction(async (txn) => {
        const now = deps.now();
        const writes = [];
        // ---- 1. AUTHORIZATION, read through the transaction so a concurrent revocation conflicts.
        if (!(await deps.authorize(txn, actor.id, exports.EQUIPMENT_INSTALL_CAPABILITY))) {
            throw new InstallCommandError("PERMISSION_DENIED", "actor is not authorized to install equipment");
        }
        // ---- 2. IDEMPOTENCY. A prior Equipment at this derived id means this exact request already ran.
        const equipmentRef = deps.db.collection(exports.EQUIPMENT_COLLECTION).doc(equipmentId);
        const existing = await txn.get(equipmentRef);
        if (existing.exists) {
            const stored = existing.data() ?? {};
            if (stored.installFingerprint !== fingerprint) {
                throw new InstallCommandError("IDEMPOTENCY_CONFLICT", "idempotencyKey was already used for a different installation");
            }
            return {
                outcome: "replayed",
                serializedAssetId: req.serializedAssetId,
                equipmentId,
                serialNo: String(stored.serialNumber ?? ""),
                accountId: String(stored.accountId ?? ""),
                locationId: String(stored.locationId ?? ""),
                state: exports.INSTALLED_STATE,
            };
        }
        // ---- 3. THE ASSET.
        const assetRef = deps.db.collection(collections_js_1.SERIALIZED_ASSETS_COLLECTION).doc(req.serializedAssetId);
        const assetSnap = await txn.get(assetRef);
        if (!assetSnap.exists)
            throw new InstallCommandError("ASSET_NOT_FOUND", "serialized asset not found");
        // THE PRODUCT'S OWN PROJECTION, not a second reader. A stored asset carries provenance fields
        // (schemaVersion, createdAtMillis, activatedByReceivingId, ...) that the VALUE validator's strict
        // allow-list rejects; projectSerializedAsset plucks the governed value subset first and returns
        // null for anything malformed, unknown-stated, or carrying a contradictory INSTALLED/link pairing.
        // Validating the raw document here would have refused every genuine asset in existence.
        const asset = (0, serializedAssetReadService_js_1.projectSerializedAsset)(req.serializedAssetId, assetSnap.data());
        if (asset === null) {
            throw new InstallCommandError("ASSET_MALFORMED", "stored serialized asset is malformed or foreign");
        }
        // ALREADY INSTALLED is checked on the LINK, not on the state. The two are kept in step by the
        // asset contract, and the link is the fact that matters: a unit pointing at an Equipment record
        // belongs to somebody, whatever its state field says.
        if (asset.currentEquipmentId !== null) {
            throw new InstallCommandError("ALREADY_INSTALLED", `serialized asset is already installed as equipment ${asset.currentEquipmentId}`);
        }
        if (!exports.INSTALLABLE_STATES.includes(asset.inventoryState)) {
            throw new InstallCommandError("STATE_NOT_INSTALLABLE", `serialized asset is ${asset.inventoryState}; installable states are ${exports.INSTALLABLE_STATES.join("/")}`);
        }
        // ---- 4. THE CUSTOMER AND THE PLACE.
        const accountSnap = await txn.get(deps.db.collection(exports.ACCOUNTS_COLLECTION).doc(req.accountId));
        if (!accountSnap.exists)
            throw new InstallCommandError("ACCOUNT_NOT_FOUND", "customer not found");
        const locationSnap = await txn.get(deps.db.collection(exports.LOCATIONS_COLLECTION).doc(req.locationId));
        if (!locationSnap.exists)
            throw new InstallCommandError("LOCATION_NOT_FOUND", "customer location not found");
        // THE SAME INTEGRITY RULES ENFORCE, checked here because this command bypasses Rules entirely.
        // `equipmentLocationBelongsToAccount` is the client-path guard; a trusted writer that skipped the
        // equivalent check would be the one hole in it.
        const locationAccount = (locationSnap.data() ?? {}).accountId;
        if (locationAccount !== req.accountId) {
            throw new InstallCommandError("LOCATION_NOT_OF_ACCOUNT", `location ${req.locationId} belongs to ${String(locationAccount)}, not ${req.accountId}`);
        }
        // ---- 5. THE TWO WRITES THAT ARE ONE FACT.
        writes.push({
            op: "create",
            ref: equipmentRef,
            data: {
                accountId: req.accountId,
                locationId: req.locationId,
                name: req.name,
                status: "ACTIVE",
                serialNumber: asset.serialNo,
                ...(req.assetTag === undefined ? {} : { assetTag: req.assetTag }),
                ...(req.installedDate === undefined ? {} : { installedDate: req.installedDate }),
                ...(req.notes === undefined ? {} : { notes: req.notes }),
                // THE LINK BACK. Equipment carried no reference to the unit behind it; without this the
                // relationship would be navigable in one direction only, and a serial would be the only
                // thread connecting a customer's machine to the asset it came from.
                serializedAssetId: req.serializedAssetId,
                partId: asset.partId,
                installFingerprint: fingerprint,
                installedFromLocationId: asset.currentLocationId,
                createdAt: now.getTime(),
                updatedAt: now.getTime(),
                createdBy: actor.id,
                updatedBy: actor.id,
            },
        });
        writes.push({
            op: "update",
            ref: assetRef,
            data: {
                inventoryState: exports.INSTALLED_STATE,
                currentEquipmentId: equipmentId,
                updatedAtMillis: now.getTime(),
                updatedByUid: actor.id,
            },
        });
        deps.stageAudit(txn, {
            actorId: actor.id,
            serializedAssetId: req.serializedAssetId,
            equipmentId,
            accountId: req.accountId,
            locationId: req.locationId,
            serialNo: asset.serialNo,
            priorLocationId: asset.currentLocationId,
            priorState: asset.inventoryState,
            ...(deps.sourceContext ? { sourceContext: deps.sourceContext } : {}),
        });
        for (const w of writes) {
            if (w.op === "create")
                txn.create(w.ref, w.data);
            else
                txn.update(w.ref, w.data);
        }
        return {
            outcome: "installed",
            serializedAssetId: req.serializedAssetId,
            equipmentId,
            serialNo: asset.serialNo,
            accountId: req.accountId,
            locationId: req.locationId,
            state: exports.INSTALLED_STATE,
        };
    });
}
//# sourceMappingURL=installSerializedAssetCommand.js.map