"use strict";
// Enterprise Inventory -- EI Phase-2 Receiving, Phase B: the INERT, UNEXPORTED trusted
// `receiveInventoryStock` command. One Firestore transaction, all-or-nothing, governed by the ratified
// spec (docs/specifications/enterprise-inventory-receiving-phase2.md §7). NOT exported from
// functions/src/index.ts; no callable; production-inert (no caller). Reuses the merged Phase-A receiving
// repository + the merged inventoryLedger repository; touches no existing writer.
//
// The server-derived ACTOR is TRUSTED COMMAND CONTEXT (deps.actor, derived by the caller from
// request.auth.uid) -- it is NEVER read from the untrusted request payload. Authorization and audit are
// INJECTED seams (Phase C registers the real capability + AuditAction). The command reads authorization
// commit-time through the transaction (so a concurrent revocation conflicts the commit), performs ALL
// Firestore reads before any writes (writes buffered + flushed after the last read), never writes
// reorder_purchase_orders (byte-identical), transitions only reorder_requests ORDERED->RECEIVED, and
// stages exactly one RECEIVED ledger event + one immutable audit event.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SerialIdentityConflictError = exports.ReceivingIntegrityError = exports.PartInvalidError = exports.DestinationInvalidError = exports.SourceNotReceivableError = exports.SourceNotFoundError = exports.UnauthorizedReceivingError = exports.ReceiveCommandError = void 0;
exports.receiveInventoryStock = receiveInventoryStock;
const node_crypto_1 = require("node:crypto");
const firestore_1 = require("firebase-admin/firestore");
const collections_js_1 = require("../constants/collections.js");
const serializedAssetRegistration_js_1 = require("../serializedAsset/serializedAssetRegistration.js");
const operationalMovementRepository_js_1 = require("../inventoryLedger/operationalMovementRepository.js");
const receivingTypes_js_1 = require("./receivingTypes.js");
const receivingValidation_js_1 = require("./receivingValidation.js");
const receivingRepository_js_1 = require("./receivingRepository.js");
const receivingOrderNumbering_js_1 = require("./receivingOrderNumbering.js");
const REORDER_PURCHASE_ORDERS_COLLECTION = "reorder_purchase_orders";
const REORDER_REQUESTS_COLLECTION = "reorder_requests";
const RECEIVE_CAPABILITY = "inventory.stock.receive";
const ORDERED = "ORDERED";
const RECEIVED = "RECEIVED";
class ReceiveCommandError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = new.target.name;
    }
}
exports.ReceiveCommandError = ReceiveCommandError;
class UnauthorizedReceivingError extends ReceiveCommandError {
    constructor(m = "actor is not authorized to receive stock") { super("PERMISSION_DENIED", m); }
}
exports.UnauthorizedReceivingError = UnauthorizedReceivingError;
class SourceNotFoundError extends ReceiveCommandError {
    constructor(m) { super("SOURCE_NOT_FOUND", m); }
}
exports.SourceNotFoundError = SourceNotFoundError;
class SourceNotReceivableError extends ReceiveCommandError {
    constructor(m) { super("SOURCE_NOT_RECEIVABLE", m); }
}
exports.SourceNotReceivableError = SourceNotReceivableError;
class DestinationInvalidError extends ReceiveCommandError {
    constructor(m) { super("DESTINATION_INVALID", m); }
}
exports.DestinationInvalidError = DestinationInvalidError;
class PartInvalidError extends ReceiveCommandError {
    constructor(m) { super("PART_INVALID", m); }
}
exports.PartInvalidError = PartInvalidError;
class ReceivingIntegrityError extends ReceiveCommandError {
    constructor(m) { super("RECEIVING_INTEGRITY", m); }
}
exports.ReceivingIntegrityError = ReceivingIntegrityError;
// A serial already registered by a DIFFERENT receipt: the same physical unit cannot be received twice.
class SerialIdentityConflictError extends ReceiveCommandError {
    constructor(m = "serial number is already registered to another receipt") { super("SERIAL_IDENTITY_CONFLICT", m); }
}
exports.SerialIdentityConflictError = SerialIdentityConflictError;
function isPlainObject(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}
function str(v) { return typeof v === "string" && v.trim() !== "" ? v : null; }
// Collision-free deterministic per-line ledger idempotency key: sha256 over a JSON tuple of the fixed
// receivingId + lineId (JSON quoting makes the components unambiguous, unlike raw delimiter concatenation).
function ledgerLineIdempotencyKey(receivingId, lineId) {
    return "recvln_" + (0, node_crypto_1.createHash)("sha256").update(JSON.stringify([receivingId, lineId])).digest("hex").slice(0, 40);
}
// SERIAL receipts stage ONE ledger event PER UNIT (the ledger requires quantity === 1 and a serialNo for
// SERIAL-tracked parts -- see inventoryLedger/operationalMovementValidation.ts). Each therefore needs its
// own idempotency key, derived from the same fixed inputs so an exact retry reproduces it exactly.
function ledgerSerialIdempotencyKey(receivingId, lineId, serialNo) {
    return "recvsn_" + (0, node_crypto_1.createHash)("sha256").update(JSON.stringify([receivingId, lineId, serialNo])).digest("hex").slice(0, 40);
}
// The trusted command. `request` is the UNTRUSTED receive payload ONLY (no actor). The server-derived
// actor comes from deps.actor (trusted context).
async function receiveInventoryStock(request, deps) {
    const actor = deps.actor;
    if (!isPlainObject(actor) || (actor.kind !== "USER" && actor.kind !== "SYSTEM") || !str(actor.id)) {
        throw new UnauthorizedReceivingError("trusted actor context missing");
    }
    if (!isPlainObject(request))
        throw new SourceNotReceivableError("request is not an object");
    const source = request.source;
    if (!isPlainObject(source) || !str(source.reorderRequestId))
        throw new SourceNotReceivableError("source reorderRequestId missing");
    const reorderRequestId = source.reorderRequestId;
    return deps.db.runTransaction(async (txn) => {
        const now = deps.now();
        // Buffered writes: created/updated only AFTER all reads (Firestore requires reads-before-writes).
        const writes = [];
        const bufferedStore = (collection) => ({
            async read(docId) { const snap = await txn.get(deps.db.collection(collection).doc(docId)); return snap.exists ? (snap.data() ?? {}) : null; },
            create(docId, data) { writes.push({ op: "create", ref: deps.db.collection(collection).doc(docId), data }); },
        });
        // ---- 1. AUTHORIZATION (commit-time authoritative; read through the txn) ----
        const authorized = await deps.authorize(txn, actor.id, RECEIVE_CAPABILITY);
        if (!authorized)
            throw new UnauthorizedReceivingError();
        if (deps.__afterAuthReadHook)
            await deps.__afterAuthReadHook();
        // ---- 3. SOURCE PO (read-only; never written) ----
        const poRef = deps.db.collection(REORDER_PURCHASE_ORDERS_COLLECTION).doc(reorderRequestId);
        const poSnap = await txn.get(poRef);
        if (!poSnap.exists)
            throw new SourceNotFoundError("purchase order not found");
        const po = poSnap.data() ?? {};
        if (po.status !== ORDERED)
            throw new SourceNotReceivableError("purchase order is not ORDERED");
        if (po.reorderRequestId !== reorderRequestId)
            throw new SourceNotReceivableError("purchase order identity incoherent");
        const poPartId = str(po.partId);
        if (poPartId === null)
            throw new SourceNotReceivableError("purchase order partId invalid");
        if (typeof po.orderedQuantity !== "number" || !Number.isFinite(po.orderedQuantity) || po.orderedQuantity <= 0) {
            throw new SourceNotReceivableError("purchase order orderedQuantity invalid");
        }
        const orderedQuantity = po.orderedQuantity;
        // ---- 4. LINKED REORDER REQUEST (read) ----
        const reqRef = deps.db.collection(REORDER_REQUESTS_COLLECTION).doc(reorderRequestId);
        const reqSnap = await txn.get(reqRef);
        if (!reqSnap.exists)
            throw new SourceNotFoundError("reorder request not found");
        const req = reqSnap.data() ?? {};
        if (req.partId !== poPartId)
            throw new SourceNotReceivableError("reorder request partId does not match purchase order");
        if (req.purchaseOrderId !== undefined && req.purchaseOrderId !== reorderRequestId)
            throw new SourceNotReceivableError("reorder request purchaseOrderId incoherent");
        if (deps.__afterSourceReadHook)
            await deps.__afterSourceReadHook();
        // ---- 6. PART authority (active + NONE) ----
        const part = await deps.resolvePart(txn, poPartId);
        if (part === null)
            throw new PartInvalidError("part not found");
        if (part.active !== true)
            throw new PartInvalidError("part is not active");
        if (part.partId !== poPartId)
            throw new PartInvalidError("resolved part identity incoherent");
        // ---- 5. DESTINATION location (active) ----
        if (!isPlainObject(request.receivingLocation))
            throw new DestinationInvalidError("destination missing");
        const locActive = await deps.resolveLocationActive(txn, request.receivingLocation);
        if (locActive !== true)
            throw new DestinationInvalidError("destination is not an active governed location");
        if (deps.__afterLocationReadHook)
            await deps.__afterLocationReadHook();
        // ---- 7. validate + bind the receiving value against the authoritative Part + orderedQuantity ----
        const authority = { part: { partId: part.partId, trackingMode: part.trackingMode }, orderedQuantity };
        const validated = (0, receivingValidation_js_1.validateReceivingOrderInput)(request, authority);
        if (!validated.valid) {
            if (validated.reason === "tracking_mode_unsupported")
                throw new PartInvalidError("tracking mode not supported (LOT deferred)");
            throw new SourceNotReceivableError(`receiving input invalid: ${validated.reason}`);
        }
        const value = validated.value;
        const line = value.lines[0];
        const receivingId = (0, receivingRepository_js_1.receivingOrderDocId)(value.idempotencyKey);
        // ---- occurredAt STABILITY: the ledger event's business time is the Receiving Order's authoritative
        // createdAt, so an exact retry at a later clock reproduces the same fingerprint (replay, not conflict).
        // On apply the order is created with createdAt = now, so occurredAt = now; on replay we read the
        // stored order's createdAt (malformed stored -> fail closed here).
        const receivingStore = bufferedStore(receivingTypes_js_1.RECEIVING_ORDERS_COLLECTION);
        const existingReceiving = await receivingStore.read(receivingId);
        const occurredAtMillis = existingReceiving === null ? now.getTime() : (0, receivingRepository_js_1.deserializeReceivingOrder)(existingReceiving).createdAt;
        // ---- 8. stage the Receiving Order (reads idempotency doc; buffers create if applying) ----
        const receivingWriteIndex = writes.length;
        const receivingOutcome = await (0, receivingRepository_js_1.stageReceivingOrder)(receivingStore, request, authority, { actor, now });
        // ---- 8b. RECEIVING ORDER REFERENCE NUMBER (RO-YYYY-######) -- allocated ONLY on a genuine new
        // create, never on replay (a replayed receipt keeps its original number; nothing new is ever
        // issued for the same idempotencyKey). allocateReceivingOrderNumber performs a READ ONLY here --
        // see receivingOrderNumbering.ts's module header for why its counter WRITE is deferred rather than
        // committed immediately (this command buffers every write and flushes them together at the very
        // end, after the SERIAL identity reads below, so a real write here would break that ordering). The
        // counter's pending write is pushed onto this command's own write buffer so it flushes atomically
        // with the Receiving Order create, the ledger event(s), and any Serialized Asset activations.
        if (receivingOutcome.outcome === "applied") {
            const allocated = await (0, receivingOrderNumbering_js_1.allocateReceivingOrderNumber)(txn, now.getUTCFullYear());
            writes[receivingWriteIndex].data.receivingOrderNumber = allocated.receivingOrderNumber;
            writes.push({ op: "set", ref: allocated.counterWrite.ref, data: allocated.counterWrite.data });
        }
        // ---- 9. stage the RECEIVED ledger effect(s) (reads ledger idempotency docs; buffers creates) ----
        //
        // NONE  -> exactly one event carrying the whole received quantity (unchanged behavior).
        // SERIAL-> one event PER UNIT, each quantity 1 and carrying its serialNo. That is not a choice made
        //          here: the ledger's own validator requires quantity === 1 and a serialNo for a
        //          SERIAL-tracked part (inventoryLedger/operationalMovementValidation.ts). The single
        //          append-only ledger stays the one movement authority; this only stages the shape it
        //          already defines.
        const ledgerStore = bufferedStore(collections_js_1.INVENTORY_TRANSACTIONS_COLLECTION);
        const isSerial = line.trackingMode === "SERIAL";
        const serialNumbers = line.serialNumbers ?? [];
        if (isSerial && serialNumbers.length !== orderedQuantity) {
            // Defensive: the validator already binds this to the authoritative ordered quantity.
            throw new ReceivingIntegrityError("serial count does not match the ordered quantity");
        }
        const ledgerEventBase = {
            type: "RECEIVED",
            partId: part.partId,
            location: { type: value.receivingLocation.type, locationId: value.receivingLocation.locationId },
            sourceObject: { type: "RECEIVING_ORDER", id: receivingId },
            actor: { kind: actor.kind, id: actor.id },
            occurredAt: occurredAtMillis,
        };
        const ledgerEvents = isSerial
            ? serialNumbers.map((serialNo) => ({
                ...ledgerEventBase,
                quantity: 1,
                serialNo,
                idempotencyKey: ledgerSerialIdempotencyKey(receivingId, line.lineId, serialNo),
            }))
            : [{ ...ledgerEventBase, quantity: orderedQuantity, idempotencyKey: ledgerLineIdempotencyKey(receivingId, line.lineId) }];
        const ledgerOutcomes = [];
        for (const ev of ledgerEvents) {
            ledgerOutcomes.push(await (0, operationalMovementRepository_js_1.stageOperationalMovement)(ledgerStore, ev, { partId: part.partId, trackingMode: part.trackingMode }, { now }));
        }
        const ledgerEventIds = ledgerOutcomes.map((o) => o.docId);
        const ledgerEventId = ledgerEventIds[0];
        // ---- 9b. SERIAL: activate one Serialized Asset per unit, in THIS transaction ----
        //
        // Identity is deterministic on (partId, serialNo), so `create` IS the uniqueness check -- there is no
        // read-then-write race. A pre-existing document is only acceptable when THIS receipt created it
        // (activatedByReceivingId matches), which is the replay case; any other owner means the same physical
        // unit is being received twice, and the whole receipt fails closed.
        const serializedAssetIds = [];
        if (isSerial) {
            for (const serialNo of serialNumbers) {
                const assetId = (0, serializedAssetRegistration_js_1.serializedAssetDocId)(part.partId, serialNo);
                const assetRef = deps.db.collection(collections_js_1.SERIALIZED_ASSETS_COLLECTION).doc(assetId);
                const assetSnap = await txn.get(assetRef); // read stays before the buffered write flush
                if (assetSnap.exists) {
                    const existing = assetSnap.data() ?? {};
                    if (existing.activatedByReceivingId !== receivingId)
                        throw new SerialIdentityConflictError();
                    // Same receipt -> replay; do not re-create.
                }
                else {
                    writes.push({
                        op: "create",
                        ref: assetRef,
                        data: (0, serializedAssetRegistration_js_1.buildSerializedAssetForReceipt)({
                            partId: part.partId,
                            serialNo,
                            locationId: value.receivingLocation.locationId,
                            receivingId,
                            actorId: actor.id,
                            now,
                        }),
                    });
                }
                serializedAssetIds.push(assetId);
            }
        }
        // ---- decide apply vs replay (coherence: receiving and EVERY ledger effect must agree) ----
        if (receivingOutcome.outcome === "replayed") {
            if (ledgerOutcomes.some((o) => o.outcome !== "replayed"))
                throw new ReceivingIntegrityError("receiving replayed but ledger did not");
            return { outcome: "replayed", receivingId, ledgerEventId, ledgerEventIds, ...(isSerial ? { serializedAssetIds } : {}) };
        }
        if (ledgerOutcomes.some((o) => o.outcome !== "applied"))
            throw new ReceivingIntegrityError("receiving applied but ledger did not");
        // ---- 10. transition ONLY reorder_requests ORDERED -> RECEIVED (apply path) ----
        if (req.status !== ORDERED)
            throw new SourceNotReceivableError("reorder request is not ORDERED");
        writes.push({ op: "update", ref: reqRef, data: { status: RECEIVED, receivedAt: firestore_1.Timestamp.fromDate(now), receivedBy: actor.id } });
        // ---- 12. one immutable audit event (sanitized) ----
        deps.stageAudit(txn, {
            action: "receiveInventoryStock",
            actorId: actor.id,
            receivingId,
            reorderRequestId,
            partId: part.partId,
            quantity: orderedQuantity,
            locationType: value.receivingLocation.type,
            locationId: value.receivingLocation.locationId,
            ledgerEventId,
            ...(isSerial ? { serialCount: serialNumbers.length } : {}),
        });
        // ---- 13. flush all buffered writes. reorder_purchase_orders is never written. Commit is
        // all-or-nothing (the enclosing runTransaction). ----
        for (const w of writes) {
            if (w.op === "create")
                txn.create(w.ref, w.data);
            else if (w.op === "set")
                txn.set(w.ref, w.data);
            else
                txn.update(w.ref, w.data);
        }
        return { outcome: "applied", receivingId, ledgerEventId, ledgerEventIds, ...(isSerial ? { serializedAssetIds } : {}) };
    });
}
//# sourceMappingURL=receiveInventoryStockCommand.js.map