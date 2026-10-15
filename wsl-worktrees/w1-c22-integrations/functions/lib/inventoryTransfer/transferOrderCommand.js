"use strict";
// Enterprise Inventory Phase 4 -- Transfer operating authority: the trusted command family that
// CREATES and MOVES a `transfer_orders` record. Follows receiveInventoryStockCommand.ts's proven
// pattern: one Firestore transaction per action, all reads before any writes (writes buffered and
// flushed after the last read), a deterministic doc id + fingerprint idempotency guard, one staged
// audit event, and a sanitized error taxonomy. Reuses the SAME inventoryLedger TRANSFER_OUT/TRANSFER_IN
// contract Receiving's ledger foundation already exports -- this command is its first live caller.
//
// LIFECYCLE (reuses the EXISTING TRANSFER_ORDER_STATUSES vocabulary -- no new statuses invented):
//   createTransferOrder   : (none) -> REQUESTED
//   dispatchTransferOrder : REQUESTED -> IN_TRANSIT   (stages TRANSFER_OUT ledger effect(s))
//   receiveTransferOrder  : IN_TRANSIT -> COMPLETED   (stages TRANSFER_IN ledger effect(s))
//   cancelTransferOrder   : REQUESTED -> CANCELLED    (domain-safe only -- no movement has occurred yet)
//
// MOVEMENT AUTHORITY: this command OWNS the movement. Nothing else may mutate quantity or a Serialized
// Asset's location -- the UI never writes inventory_transactions/serialized_assets directly (Rules deny
// it; there is no client write path). A Serialized Asset's `currentLocationId` changes ONLY at
// receiveTransferOrder (transfer completion), per the briefing's constraint; dispatchTransferOrder only
// flips its `inventoryState` to IN_TRANSIT (a STATE change, not a LOCATION change) so it stops appearing
// available at the origin while in transit.
//
// TRUCK / MOBILE: a MOBILE endpoint is resolved through the EXISTING Truck Registry's
// `mobile_locations/{locationId}` authority (transferLocationResolver.ts) -- no second Truck object, no
// independent truck quantity store. Truck "inventory" is whatever the ledger + Serialized Asset records
// say is AT that MOBILE location; this command is what makes that true by moving records there.
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransferIntegrityError = exports.TransferMalformedStoredRecordError = exports.TransferIdempotencyConflictError = exports.TransferStatusInvalidError = exports.InsufficientStockError = exports.TransferSerialInvalidError = exports.TransferPartInvalidError = exports.SameLocationError = exports.DestinationInvalidError = exports.OriginInvalidError = exports.TransferNotFoundError = exports.UnauthorizedTransferError = void 0;
exports.createTransferOrder = createTransferOrder;
exports.dispatchTransferOrder = dispatchTransferOrder;
exports.receiveTransferOrder = receiveTransferOrder;
exports.cancelTransferOrder = cancelTransferOrder;
const transferLocationResolver_js_1 = require("./transferLocationResolver.js");
const locationOnHand_js_1 = require("../inventoryLedger/locationOnHand.js");
const node_crypto_1 = require("node:crypto");
const collections_js_1 = require("../constants/collections.js");
const operationalMovementRepository_js_1 = require("../inventoryLedger/operationalMovementRepository.js");
const operationalMovementRepository_js_2 = require("../inventoryLedger/operationalMovementRepository.js");
const serializedAssetRegistration_js_1 = require("../serializedAsset/serializedAssetRegistration.js");
const transferOrderTypes_js_1 = require("./transferOrderTypes.js");
const transferOrderValidation_js_1 = require("./transferOrderValidation.js");
const transferOrderRepository_js_1 = require("./transferOrderRepository.js");
const transferOrderNumbering_js_1 = require("./transferOrderNumbering.js");
// Re-exported for callers/tests that import the error taxonomy alongside the command functions
// (mirrors receiveInventoryStockCommand.ts, which defines its errors locally; here they live in
// transferOrderTypes.ts because transferOrderRepository.ts and transferLocationResolver.ts need them
// too, but this module stays the single place a caller imports both from).
var transferOrderTypes_js_2 = require("./transferOrderTypes.js");
Object.defineProperty(exports, "UnauthorizedTransferError", { enumerable: true, get: function () { return transferOrderTypes_js_2.UnauthorizedTransferError; } });
Object.defineProperty(exports, "TransferNotFoundError", { enumerable: true, get: function () { return transferOrderTypes_js_2.TransferNotFoundError; } });
Object.defineProperty(exports, "OriginInvalidError", { enumerable: true, get: function () { return transferOrderTypes_js_2.OriginInvalidError; } });
Object.defineProperty(exports, "DestinationInvalidError", { enumerable: true, get: function () { return transferOrderTypes_js_2.DestinationInvalidError; } });
Object.defineProperty(exports, "SameLocationError", { enumerable: true, get: function () { return transferOrderTypes_js_2.SameLocationError; } });
Object.defineProperty(exports, "TransferPartInvalidError", { enumerable: true, get: function () { return transferOrderTypes_js_2.TransferPartInvalidError; } });
Object.defineProperty(exports, "TransferSerialInvalidError", { enumerable: true, get: function () { return transferOrderTypes_js_2.TransferSerialInvalidError; } });
Object.defineProperty(exports, "InsufficientStockError", { enumerable: true, get: function () { return transferOrderTypes_js_2.InsufficientStockError; } });
Object.defineProperty(exports, "TransferStatusInvalidError", { enumerable: true, get: function () { return transferOrderTypes_js_2.TransferStatusInvalidError; } });
Object.defineProperty(exports, "TransferIdempotencyConflictError", { enumerable: true, get: function () { return transferOrderTypes_js_2.TransferIdempotencyConflictError; } });
Object.defineProperty(exports, "TransferMalformedStoredRecordError", { enumerable: true, get: function () { return transferOrderTypes_js_2.TransferMalformedStoredRecordError; } });
Object.defineProperty(exports, "TransferIntegrityError", { enumerable: true, get: function () { return transferOrderTypes_js_2.TransferIntegrityError; } });
const CREATE_CAPABILITY = "inventory.transfer.create";
const DISPATCH_CAPABILITY = "inventory.transfer.dispatch";
const RECEIVE_CAPABILITY = "inventory.transfer.receive";
const CANCEL_CAPABILITY = "inventory.transfer.cancel";
function isPlainObject(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}
function str(v) {
    return typeof v === "string" && v.trim() !== "" ? v : null;
}
function requireActor(actor) {
    if (!isPlainObject(actor) || (actor.kind !== "USER" && actor.kind !== "SYSTEM") || !str(actor.id)) {
        throw new transferOrderTypes_js_1.UnauthorizedTransferError("trusted actor context missing");
    }
    return { kind: actor.kind, id: actor.id };
}
function ledgerIdKey(transferOrderId, suffix) {
    return "trfmv_" + (0, node_crypto_1.createHash)("sha256").update(JSON.stringify([transferOrderId, suffix])).digest("hex").slice(0, 40);
}
function serialLedgerIdKey(transferOrderId, suffix, serialNo) {
    return "trfmvsn_" + (0, node_crypto_1.createHash)("sha256").update(JSON.stringify([transferOrderId, suffix, serialNo])).digest("hex").slice(0, 40);
}
// -------- NONE-mode on-hand sufficiency: sum the OPERATIONAL ledger at (partId, location) --------
// Bounded, honest, and single-source-of-truth (the ledger IS the movement authority): RECEIVED /
// RETURNED / TRANSFER_IN are +; TRANSFER_OUT / SCRAPPED are -; ADJUSTED is its own signed delta.
// LIMITATION (documented, not silently resolved): a physical count is an observation and moves no
// stock; only the manager-approved cycle-count reconciliation does, as a signed ADJUSTED that this
// sum already reads. So a location whose on-hand has drifted from a count that was never reconciled
// will not be reflected here. Reconciling it is the count workflow's job, not this transfer
// authority's -- and there is no on-hand/available aggregation authority here to build one on.
async function computeNoneOnHandThroughTxn(txn, db, partId, location) {
    const snap = await txn.get(db.collection(collections_js_1.INVENTORY_TRANSACTIONS_COLLECTION).where("partId", "==", partId));
    let onHand = 0;
    for (const doc of snap.docs) {
        const data = doc.data();
        if ((0, operationalMovementRepository_js_2.classifyLedgerDoc)(data) !== "operational")
            continue;
        let mv;
        try {
            mv = (0, operationalMovementRepository_js_2.deserializeOperationalMovement)(data);
        }
        catch {
            continue; // a malformed operational record is skipped, not trusted -- never inflates on-hand
        }
        const v = mv.value;
        if (v.location.type !== location.type || v.location.locationId !== location.locationId)
            continue;
        // The sign comes from inventoryLedger/locationOnHand.ts -- the ONE place it is decided. This line
        // used to carry its own RECEIVED/TRANSFER/ADJUSTED branches and never learned
        // WORK_ORDER_CONSUMPTION, so after Decision #171 made consumption live it counted consumed stock
        // as still present.
        onHand += (0, locationOnHand_js_1.signedQuantity)(v);
    }
    return onHand;
}
// =====================================================================================================
// createTransferOrder -- (none) -> REQUESTED
// =====================================================================================================
async function createTransferOrder(request, deps) {
    const actor = requireActor(deps.actor);
    return deps.db.runTransaction(async (txn) => {
        const now = deps.now();
        const writes = [];
        // ---- 1. authorization (commit-time authoritative) ----
        if (!(await deps.authorize(txn, actor.id, CREATE_CAPABILITY)))
            throw new transferOrderTypes_js_1.UnauthorizedTransferError();
        // ---- 2. authoritative Part ----
        if (!isPlainObject(request) || !str(request.partId))
            throw new transferOrderTypes_js_1.TransferPartInvalidError("partId missing");
        const part = await deps.resolvePart(txn, request.partId);
        if (part === null)
            throw new transferOrderTypes_js_1.TransferPartInvalidError("part not found");
        if (part.active !== true)
            throw new transferOrderTypes_js_1.TransferPartInvalidError("part is not active");
        if (part.partId !== request.partId)
            throw new transferOrderTypes_js_1.TransferPartInvalidError("resolved part identity incoherent");
        // ---- 3. structural + shape validation, bound to the authoritative Part ----
        const authority = { part: { partId: part.partId, trackingMode: part.trackingMode } };
        const validated = (0, transferOrderValidation_js_1.validateCreateTransferInput)(request, authority);
        if (!validated.valid) {
            const reason = validated.reason ?? "unknown";
            if (reason === "origin_invalid")
                throw new transferOrderTypes_js_1.OriginInvalidError("origin is malformed or not a WAREHOUSE/MOBILE reference");
            if (reason === "destination_invalid")
                throw new transferOrderTypes_js_1.DestinationInvalidError("destination is malformed or not a WAREHOUSE/MOBILE reference");
            if (reason === "same_location")
                throw new transferOrderTypes_js_1.SameLocationError();
            if (reason.startsWith("serial_"))
                throw new transferOrderTypes_js_1.TransferSerialInvalidError(`transfer input invalid: ${reason}`);
            if (reason === "tracking_mode_unsupported")
                throw new transferOrderTypes_js_1.TransferPartInvalidError("tracking mode not supported (LOT deferred)");
            throw new transferOrderTypes_js_1.TransferPartInvalidError(`transfer input invalid: ${reason}`);
        }
        const value = validated.value;
        const transferOrderId = (0, transferOrderRepository_js_1.transferOrderDocId)(value.idempotencyKey);
        const fingerprint = (0, transferOrderRepository_js_1.fingerprintTransferOrder)(value);
        // ---- idempotency read (before any location/stock reads, cheapest fail-fast) ----
        const existingSnap = await txn.get(deps.db.collection(collections_js_1.TRANSFER_ORDERS_COLLECTION).doc(transferOrderId));
        if (existingSnap.exists) {
            const stored = (0, transferOrderRepository_js_1.deserializeTransferOrder)(transferOrderId, existingSnap.data());
            if ((0, transferOrderRepository_js_1.transferOrderDocId)(stored.value.idempotencyKey) !== transferOrderId) {
                throw new transferOrderTypes_js_1.TransferMalformedStoredRecordError("stored idempotencyKey does not derive its document id");
            }
            const storedRecomputed = (0, transferOrderRepository_js_1.fingerprintTransferOrder)(stored.value);
            if (storedRecomputed !== stored.fingerprint)
                throw new transferOrderTypes_js_1.TransferMalformedStoredRecordError("stored fingerprint does not match stored value");
            if (storedRecomputed !== fingerprint)
                throw new transferOrderTypes_js_1.TransferIdempotencyConflictError();
            return { outcome: "replayed", transferOrderId, fingerprint };
        }
        // ---- 4. origin / destination must be ACTIVE governed locations ----
        if (!(await deps.resolveLocationActive(txn, value.origin)))
            throw new transferOrderTypes_js_1.OriginInvalidError("origin is not an active governed location");
        if (!(await deps.resolveLocationActive(txn, value.destination)))
            throw new transferOrderTypes_js_1.DestinationInvalidError("destination is not an active governed location");
        // BIN-P6 / Decision #170: a movement that never leaves its Warehouse is a RELOCATION. Refused here by
        // name, so a Bin-to-Bin move cannot be routed through Transfer and appear to cross a custody boundary.
        // Parentage is read inside this transaction from the governed bin documents.
        {
            const originCustody = await (0, transferLocationResolver_js_1.resolveTransferCustodyWarehouseId)(txn, deps.db, value.origin);
            const destinationCustody = await (0, transferLocationResolver_js_1.resolveTransferCustodyWarehouseId)(txn, deps.db, value.destination);
            if (originCustody !== null && originCustody === destinationCustody)
                throw new transferOrderTypes_js_1.SameCustodyParentError();
        }
        // ---- 5. origin stock sufficiency ----
        if (value.trackingMode === "SERIAL") {
            const serials = value.serialNumbers ?? [];
            for (const serialNo of serials) {
                const assetId = (0, serializedAssetRegistration_js_1.serializedAssetDocId)(part.partId, serialNo);
                const assetSnap = await txn.get(deps.db.collection(collections_js_1.SERIALIZED_ASSETS_COLLECTION).doc(assetId));
                if (!assetSnap.exists)
                    throw new transferOrderTypes_js_1.InsufficientStockError(`serial ${serialNo} is not a known unit of this part`);
                const asset = assetSnap.data() ?? {};
                if (asset.partId !== part.partId)
                    throw new transferOrderTypes_js_1.InsufficientStockError(`serial ${serialNo} belongs to a different part`);
                if (asset.currentLocationId !== value.origin.locationId)
                    throw new transferOrderTypes_js_1.InsufficientStockError(`serial ${serialNo} is not at the origin location`);
                if (asset.inventoryState !== "AVAILABLE")
                    throw new transferOrderTypes_js_1.InsufficientStockError(`serial ${serialNo} is not AVAILABLE for transfer`);
            }
        }
        else {
            const onHand = await computeNoneOnHandThroughTxn(txn, deps.db, part.partId, value.origin);
            if (onHand < value.quantity)
                throw new transferOrderTypes_js_1.InsufficientStockError(`origin on-hand (${onHand}) is less than the requested quantity (${value.quantity})`);
        }
        // ---- 5b. allocate the TO-YYYY-###### reference number ----
        //
        // This is the transaction's LAST read (transferOrderNumbering.ts's allocateTransferOrderNumber does
        // one txn.get + one txn.set on the shared per-year counter doc) — it must run only after every other
        // read above (part/idempotency/location/stock-sufficiency) has completed, because its own tx.set is
        // a real write and Firestore requires all reads before any writes in a transaction. Everything after
        // this point is either a buffered write (flushed below) or deps.stageAudit's own immediate write.
        const { transferOrderNumber } = await (0, transferOrderNumbering_js_1.allocateTransferOrderNumber)(txn, now.getUTCFullYear());
        // ---- 6. stage the create ----
        writes.push({ op: "create", ref: deps.db.collection(collections_js_1.TRANSFER_ORDERS_COLLECTION).doc(transferOrderId), data: (0, transferOrderRepository_js_1.serializeTransferOrder)(value, actor, now, fingerprint, transferOrderNumber) });
        // ---- 7. audit ----
        deps.stageAudit(txn, {
            action: "createTransferOrder",
            actorId: actor.id,
            transferOrderId,
            partId: part.partId,
            quantity: value.quantity,
            origin: value.origin,
            destination: value.destination,
            ...(value.serialNumbers ? { serialCount: value.serialNumbers.length } : {}),
        });
        for (const w of writes) {
            if (w.op === "create")
                txn.create(w.ref, w.data);
            else
                txn.update(w.ref, w.data);
        }
        return { outcome: "applied", transferOrderId, fingerprint, transferOrderNumber };
    });
}
function requireTransferOrderId(request) {
    if (!isPlainObject(request) || !str(request.transferOrderId))
        throw new transferOrderTypes_js_1.TransferNotFoundError("transferOrderId missing");
    return request.transferOrderId;
}
// =====================================================================================================
// dispatchTransferOrder -- REQUESTED -> IN_TRANSIT (stages TRANSFER_OUT effect(s))
// =====================================================================================================
async function dispatchTransferOrder(request, deps) {
    const actor = requireActor(deps.actor);
    const transferOrderId = requireTransferOrderId(request);
    return deps.db.runTransaction(async (txn) => {
        const now = deps.now();
        const writes = [];
        if (!(await deps.authorize(txn, actor.id, DISPATCH_CAPABILITY)))
            throw new transferOrderTypes_js_1.UnauthorizedTransferError();
        const ref = deps.db.collection(collections_js_1.TRANSFER_ORDERS_COLLECTION).doc(transferOrderId);
        const snap = await txn.get(ref);
        if (!snap.exists)
            throw new transferOrderTypes_js_1.TransferNotFoundError();
        const stored = (0, transferOrderRepository_js_1.deserializeTransferOrder)(transferOrderId, snap.data());
        if (stored.status !== "REQUESTED" && stored.status !== "IN_TRANSIT") {
            throw new transferOrderTypes_js_1.TransferStatusInvalidError(`transfer order is ${stored.status}, cannot dispatch`);
        }
        const alreadyDispatched = stored.status === "IN_TRANSIT";
        const part = await deps.resolvePart(txn, stored.value.partId);
        if (part === null || part.partId !== stored.value.partId)
            throw new transferOrderTypes_js_1.TransferPartInvalidError("part not found");
        const ledgerEventBase = {
            type: "TRANSFER_OUT",
            partId: stored.value.partId,
            location: stored.value.origin,
            counterpartyLocation: stored.value.destination,
            sourceObject: { type: "TRANSFER_ORDER", id: transferOrderId },
            actor: { kind: actor.kind, id: actor.id },
            occurredAt: stored.createdAt,
        };
        const isSerial = stored.value.trackingMode === "SERIAL";
        const serials = stored.value.serialNumbers ?? [];
        if (!alreadyDispatched && isSerial) {
            // Re-verify at commit time -- a serial could have moved between create and dispatch.
            for (const serialNo of serials) {
                const assetId = (0, serializedAssetRegistration_js_1.serializedAssetDocId)(part.partId, serialNo);
                const assetSnap = await txn.get(deps.db.collection(collections_js_1.SERIALIZED_ASSETS_COLLECTION).doc(assetId));
                if (!assetSnap.exists)
                    throw new transferOrderTypes_js_1.InsufficientStockError(`serial ${serialNo} is not a known unit of this part`);
                const asset = assetSnap.data() ?? {};
                if (asset.currentLocationId !== stored.value.origin.locationId || asset.inventoryState !== "AVAILABLE") {
                    throw new transferOrderTypes_js_1.InsufficientStockError(`serial ${serialNo} is no longer available at the origin`);
                }
            }
        }
        const ledgerEvents = isSerial
            ? serials.map((serialNo) => ({ ...ledgerEventBase, quantity: 1, serialNo, idempotencyKey: serialLedgerIdKey(transferOrderId, "out", serialNo) }))
            : [{ ...ledgerEventBase, quantity: stored.value.quantity, idempotencyKey: ledgerIdKey(transferOrderId, "out") }];
        const bufferedStore = {
            async read(docId) {
                const s = await txn.get(deps.db.collection(collections_js_1.INVENTORY_TRANSACTIONS_COLLECTION).doc(docId));
                return s.exists ? (s.data() ?? {}) : null;
            },
            create(docId, data) {
                writes.push({ op: "create", ref: deps.db.collection(collections_js_1.INVENTORY_TRANSACTIONS_COLLECTION).doc(docId), data });
            },
        };
        const outcomes = [];
        for (const ev of ledgerEvents) {
            outcomes.push(await (0, operationalMovementRepository_js_1.stageOperationalMovement)(bufferedStore, ev, { partId: part.partId, trackingMode: part.trackingMode }, { now }));
        }
        const ledgerEventIds = outcomes.map((o) => o.docId);
        if (alreadyDispatched) {
            if (outcomes.some((o) => o.outcome !== "replayed"))
                throw new transferOrderTypes_js_1.TransferIntegrityError("transfer already dispatched but ledger did not replay coherently");
            return { outcome: "replayed", transferOrderId, ledgerEventIds };
        }
        if (outcomes.some((o) => o.outcome !== "applied"))
            throw new transferOrderTypes_js_1.TransferIntegrityError("dispatch ledger effect did not apply coherently");
        if (isSerial) {
            for (const serialNo of serials) {
                const assetRef = deps.db.collection(collections_js_1.SERIALIZED_ASSETS_COLLECTION).doc((0, serializedAssetRegistration_js_1.serializedAssetDocId)(part.partId, serialNo));
                writes.push({ op: "update", ref: assetRef, data: { inventoryState: "IN_TRANSIT", updatedAtMillis: now.getTime(), updatedByUid: actor.id } });
            }
        }
        writes.push({ op: "update", ref, data: (0, transferOrderRepository_js_1.transitionFields)("IN_TRANSIT", stored.version + 1, actor, now) });
        deps.stageAudit(txn, {
            action: "dispatchTransferOrder",
            actorId: actor.id,
            transferOrderId,
            partId: stored.value.partId,
            quantity: stored.value.quantity,
            origin: stored.value.origin,
            destination: stored.value.destination,
            ...(isSerial ? { serialCount: serials.length } : {}),
        });
        for (const w of writes) {
            if (w.op === "create")
                txn.create(w.ref, w.data);
            else
                txn.update(w.ref, w.data);
        }
        return { outcome: "applied", transferOrderId, ledgerEventIds };
    });
}
// =====================================================================================================
// receiveTransferOrder -- IN_TRANSIT -> COMPLETED (stages TRANSFER_IN effect(s); Serialized Asset
// LOCATION updates happen HERE, and only here).
// =====================================================================================================
async function receiveTransferOrder(request, deps) {
    const actor = requireActor(deps.actor);
    const transferOrderId = requireTransferOrderId(request);
    return deps.db.runTransaction(async (txn) => {
        const now = deps.now();
        const writes = [];
        if (!(await deps.authorize(txn, actor.id, RECEIVE_CAPABILITY)))
            throw new transferOrderTypes_js_1.UnauthorizedTransferError();
        const ref = deps.db.collection(collections_js_1.TRANSFER_ORDERS_COLLECTION).doc(transferOrderId);
        const snap = await txn.get(ref);
        if (!snap.exists)
            throw new transferOrderTypes_js_1.TransferNotFoundError();
        const stored = (0, transferOrderRepository_js_1.deserializeTransferOrder)(transferOrderId, snap.data());
        if (stored.status !== "IN_TRANSIT" && stored.status !== "COMPLETED") {
            throw new transferOrderTypes_js_1.TransferStatusInvalidError(`transfer order is ${stored.status}, cannot receive`);
        }
        const alreadyReceived = stored.status === "COMPLETED";
        const part = await deps.resolvePart(txn, stored.value.partId);
        if (part === null || part.partId !== stored.value.partId)
            throw new transferOrderTypes_js_1.TransferPartInvalidError("part not found");
        const isSerial = stored.value.trackingMode === "SERIAL";
        const serials = stored.value.serialNumbers ?? [];
        const ledgerEventBase = {
            type: "TRANSFER_IN",
            partId: stored.value.partId,
            location: stored.value.destination,
            counterpartyLocation: stored.value.origin,
            sourceObject: { type: "TRANSFER_ORDER", id: transferOrderId },
            actor: { kind: actor.kind, id: actor.id },
            occurredAt: now.getTime(),
        };
        const ledgerEvents = isSerial
            ? serials.map((serialNo) => ({ ...ledgerEventBase, quantity: 1, serialNo, idempotencyKey: serialLedgerIdKey(transferOrderId, "in", serialNo) }))
            : [{ ...ledgerEventBase, quantity: stored.value.quantity, idempotencyKey: ledgerIdKey(transferOrderId, "in") }];
        const bufferedStore = {
            async read(docId) {
                const s = await txn.get(deps.db.collection(collections_js_1.INVENTORY_TRANSACTIONS_COLLECTION).doc(docId));
                return s.exists ? (s.data() ?? {}) : null;
            },
            create(docId, data) {
                writes.push({ op: "create", ref: deps.db.collection(collections_js_1.INVENTORY_TRANSACTIONS_COLLECTION).doc(docId), data });
            },
        };
        const outcomes = [];
        for (const ev of ledgerEvents) {
            outcomes.push(await (0, operationalMovementRepository_js_1.stageOperationalMovement)(bufferedStore, ev, { partId: part.partId, trackingMode: part.trackingMode }, { now }));
        }
        const ledgerEventIds = outcomes.map((o) => o.docId);
        if (alreadyReceived) {
            if (outcomes.some((o) => o.outcome !== "replayed"))
                throw new transferOrderTypes_js_1.TransferIntegrityError("transfer already received but ledger did not replay coherently");
            return { outcome: "replayed", transferOrderId, ledgerEventIds };
        }
        if (outcomes.some((o) => o.outcome !== "applied"))
            throw new transferOrderTypes_js_1.TransferIntegrityError("receive ledger effect did not apply coherently");
        if (isSerial) {
            for (const serialNo of serials) {
                const assetRef = deps.db.collection(collections_js_1.SERIALIZED_ASSETS_COLLECTION).doc((0, serializedAssetRegistration_js_1.serializedAssetDocId)(part.partId, serialNo));
                // The canonical transfer-completion authority: this is the ONLY place a Serialized Asset's
                // currentLocationId changes as part of a transfer.
                writes.push({
                    op: "update",
                    ref: assetRef,
                    data: { currentLocationId: stored.value.destination.locationId, inventoryState: "AVAILABLE", updatedAtMillis: now.getTime(), updatedByUid: actor.id },
                });
            }
        }
        writes.push({ op: "update", ref, data: (0, transferOrderRepository_js_1.transitionFields)("COMPLETED", stored.version + 1, actor, now) });
        deps.stageAudit(txn, {
            action: "receiveTransferOrder",
            actorId: actor.id,
            transferOrderId,
            partId: stored.value.partId,
            quantity: stored.value.quantity,
            origin: stored.value.origin,
            destination: stored.value.destination,
            ...(isSerial ? { serialCount: serials.length } : {}),
        });
        for (const w of writes) {
            if (w.op === "create")
                txn.create(w.ref, w.data);
            else
                txn.update(w.ref, w.data);
        }
        return { outcome: "applied", transferOrderId, ledgerEventIds };
    });
}
// =====================================================================================================
// cancelTransferOrder -- REQUESTED -> CANCELLED. Domain-safe ONLY: legal iff no movement has been
// dispatched yet (IN_TRANSIT/COMPLETED refuse; a CANCELLED order accepts a replay as a no-op).
// =====================================================================================================
async function cancelTransferOrder(request, deps) {
    const actor = requireActor(deps.actor);
    const transferOrderId = requireTransferOrderId(request);
    return deps.db.runTransaction(async (txn) => {
        const now = deps.now();
        if (!(await deps.authorize(txn, actor.id, CANCEL_CAPABILITY)))
            throw new transferOrderTypes_js_1.UnauthorizedTransferError();
        const ref = deps.db.collection(collections_js_1.TRANSFER_ORDERS_COLLECTION).doc(transferOrderId);
        const snap = await txn.get(ref);
        if (!snap.exists)
            throw new transferOrderTypes_js_1.TransferNotFoundError();
        const stored = (0, transferOrderRepository_js_1.deserializeTransferOrder)(transferOrderId, snap.data());
        if (stored.status === "CANCELLED")
            return { outcome: "replayed", transferOrderId };
        if (stored.status !== "REQUESTED") {
            throw new transferOrderTypes_js_1.TransferStatusInvalidError(`transfer order is ${stored.status}, cancellation is only domain-safe before dispatch`);
        }
        txn.update(ref, (0, transferOrderRepository_js_1.transitionFields)("CANCELLED", stored.version + 1, actor, now));
        deps.stageAudit(txn, {
            action: "cancelTransferOrder",
            actorId: actor.id,
            transferOrderId,
            partId: stored.value.partId,
            quantity: stored.value.quantity,
            origin: stored.value.origin,
            destination: stored.value.destination,
        });
        return { outcome: "applied", transferOrderId };
    });
}
//# sourceMappingURL=transferOrderCommand.js.map