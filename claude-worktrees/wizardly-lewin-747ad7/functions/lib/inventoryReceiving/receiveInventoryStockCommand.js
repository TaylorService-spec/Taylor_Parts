"use strict";
// Enterprise Inventory -- EI Phase-2 Receiving: the trusted `receiveInventoryStock` command. One
// Firestore transaction, all-or-nothing, governed by the ratified spec
// (docs/specifications/enterprise-inventory-receiving-phase2.md §7). Reuses the merged Phase-A
// receiving repository + the merged inventoryLedger repository; touches no existing writer.
//
// HEADER CORRECTED 2026-09-02 (FIN-BLOCK-003 reconciliation). This block previously said the command
// was "INERT, UNEXPORTED", "NOT exported from functions/src/index.ts; no callable; production-inert
// (no caller)". That described Phase B and became false when Phase C wired it: the callable is
// defined at `inventoryReceiving/receivingCallables.ts:220` and exported from
// `functions/src/index.ts` as `receiveInventoryStock`.
//
// The staleness was worth correcting rather than leaving: a reader asking "could receiving carry a
// cost fact?" -- exactly the FIN-BLOCK-003 question -- would have read this header, concluded the
// receiving path was not live, and stopped looking. It IS live, and it records NO monetary value of
// any kind, which is a materially different finding from "the path does not run".
//
// WHAT IS STILL TRUE, and is the reason the correction is narrow: exporting a callable is not
// deployment authorization, and this command writes no cost. The receipt it stages carries quantity,
// part, location, actor and time -- there is no unit cost, extended cost or currency on a receipt,
// and none is derived from the purchase order it receives against.
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
const receivingRepository_js_1 = require("./receivingRepository.js");
const receivingSourceResolver_js_1 = require("./receivingSourceResolver.js");
const receivingBatchValidation_js_1 = require("./receivingBatchValidation.js");
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
    // ONE REQUEST CONTRACT, TWO AUTHORITIES. The legacy transport shape IS the one-line case of the
    // batch shape -- same top-level keys, same line keys, with `expectedQuantity` optional. So there is
    // no translation step and no second domain service: the legacy payload passes through unchanged and
    // is distinguished only by `source.type`, which the resolver validates against a closed set.
    //
    // Nothing about the source is inspected here. Which authority a request addresses, and whether its
    // identity fields are coherent, is the resolver's single responsibility -- checking a legacy field
    // here would have made a canonical request fail before it ever reached the discriminator.
    const batch = request;
    // FAIL FAST on a request that cannot possibly resolve, BEFORE opening a transaction. This is a
    // shape check only -- it asserts that an authority was named and that the name is in the closed
    // set. Everything else about the source (identity coherence, existence, receivable state) belongs
    // to the resolver, which needs reads.
    //
    // Deliberately AUTHORITY-AGNOSTIC. The check that used to live here demanded a reorderRequestId,
    // which was correct when there was one authority and would now reject every canonical request
    // before it ever reached the discriminator.
    const declaredSource = batch.source;
    if (!isPlainObject(declaredSource))
        throw new SourceNotReceivableError("source missing");
    if (!receivingTypes_js_1.RECEIVING_SOURCE_TYPES.includes(declaredSource.type)) {
        throw new SourceNotReceivableError("source type is not a supported receiving authority");
    }
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
        // ---- 2. SOURCE AUTHORITY (read). Canonical: the concurrency anchor (see the transaction-order
        // spec §1). Legacy: read-only, never written -- its immutability contract is preserved. ----
        const resolved = await (0, receivingSourceResolver_js_1.resolveReceivingSource)(txn, deps.db, batch.source);
        if (deps.__afterSourceReadHook)
            await deps.__afterSourceReadHook();
        // ---- 3. LINKED REORDER REQUEST (LEGACY ONLY) ----
        //
        // A canonical purchase order has no reorder request. Reading one would be inventing a link, and
        // transitioning one would be closing a workflow the receipt has nothing to do with.
        let reqRef = null;
        let reqStatus = null;
        if (!resolved.isCanonical) {
            const reorderRequestId = resolved.reorderRequestId;
            reqRef = deps.db.collection(REORDER_REQUESTS_COLLECTION).doc(reorderRequestId);
            const reqSnap = await txn.get(reqRef);
            if (!reqSnap.exists)
                throw new SourceNotFoundError("reorder request not found");
            const req = reqSnap.data() ?? {};
            reqStatus = req.status;
            const legacyPartId = resolved.canonical.lines[0].partId;
            if (req.partId !== legacyPartId)
                throw new SourceNotReceivableError("reorder request partId does not match purchase order");
            if (req.purchaseOrderId !== undefined && req.purchaseOrderId !== reorderRequestId) {
                throw new SourceNotReceivableError("reorder request purchaseOrderId incoherent");
            }
        }
        // ---- 4. PART authority, once per DISTINCT part on the submitted lines ----
        //
        // Deduplicated deliberately: two lines for the same part must resolve to the SAME Part record, and
        // reading it twice would allow two answers to one question. Resolved from the PO's own line
        // definitions rather than from the caller's claimed partId -- the caller's claim is checked
        // against the PO in validation, and resolving what the caller said would let a wrong claim pick
        // which Part authority to consult.
        const submittedLineIds = Array.isArray(batch.lines)
            ? batch.lines.map((l) => (isPlainObject(l) ? str(l.lineId) : null)).filter((v) => v !== null)
            : [];
        // A LEGACY receipt's line label is the caller's own and does not match the normalized "L1", so it
        // is matched by position rather than by id -- a legacy order has exactly one line, so "the line
        // being received" is unambiguous. Canonical receipts match by id, which is the only thing that
        // distinguishes several lines.
        const targetedLines = resolved.isCanonical
            ? resolved.derived.lines.filter((l) => submittedLineIds.includes(l.lineId))
            : resolved.derived.lines;
        const distinctPartIds = [...new Set(targetedLines.map((l) => l.partId))];
        const partsByPartId = new Map();
        for (const partId of distinctPartIds) {
            const part = await deps.resolvePart(txn, partId);
            if (part === null)
                throw new PartInvalidError("part not found");
            if (part.partId !== partId)
                throw new PartInvalidError("resolved part identity incoherent");
            partsByPartId.set(partId, part);
        }
        // ---- 5. DESTINATION location (active) ----
        if (!isPlainObject(batch.receivingLocation))
            throw new DestinationInvalidError("destination missing");
        const locActive = await deps.resolveLocationActive(txn, batch.receivingLocation);
        if (locActive !== true)
            throw new DestinationInvalidError("destination is not an active governed location");
        if (deps.__afterLocationReadHook)
            await deps.__afterLocationReadHook();
        // ---- 6. VALIDATE THE WHOLE BATCH -- before any write, so a rejected batch leaves nothing ----
        const validated = (0, receivingBatchValidation_js_1.validateReceivingBatch)(batch, { resolved, partsByPartId });
        if (!validated.valid) {
            if (validated.reason === "tracking_mode_unsupported")
                throw new PartInvalidError("tracking mode not supported (LOT deferred)");
            if (validated.reason === "part_inactive")
                throw new PartInvalidError("part is not active");
            throw new SourceNotReceivableError(`receiving input invalid: ${validated.reason}`);
        }
        const value = validated.value;
        // ---- 7. RECEIPT IDENTITY, per namespace ----
        //
        // Legacy keeps its key-only derivation exactly (deployed callers hold receipts at those ids).
        // Canonical is TARGET-SCOPED, so the same raw client key against a different purchase order is a
        // different receipt rather than a false replay of the first one.
        const receivingId = resolved.isCanonical
            ? (0, receivingRepository_js_1.canonicalReceivingOrderDocId)({
                operation: "receiveInventoryStock",
                sourceType: receivingTypes_js_1.CANONICAL_SOURCE_TYPE,
                purchaseOrderId: resolved.purchaseOrderId,
                actorId: actor.id,
                idempotencyKey: value.idempotencyKey,
            })
            : (0, receivingRepository_js_1.receivingOrderDocId)(value.idempotencyKey);
        // ---- occurredAt STABILITY: the ledger event's business time is the Receiving Order's authoritative
        // createdAt, so an exact retry at a later clock reproduces the same fingerprint (replay, not conflict).
        const receivingStore = bufferedStore(receivingTypes_js_1.RECEIVING_ORDERS_COLLECTION);
        const existingReceiving = await receivingStore.read(receivingId);
        const occurredAtMillis = existingReceiving === null ? now.getTime() : (0, receivingRepository_js_1.deserializeReceivingOrder)(existingReceiving).createdAt;
        // ---- 8. stage the Receiving Order through the ONE core (reads the idempotency doc; buffers the
        // create if applying) ----
        const receivingWriteIndex = writes.length;
        const receivingOutcome = await (0, receivingRepository_js_1.stageReceivingOrderValue)(receivingStore, value, receivingId, { actor, now });
        // ---- 8b. RECEIVING ORDER REFERENCE NUMBER (RO-YYYY-######) -- allocated ONLY on a genuine new
        // create, never on replay. allocateReceivingOrderNumber performs a READ ONLY here; its counter
        // WRITE is buffered so it flushes atomically with everything else. ----
        if (receivingOutcome.outcome === "applied") {
            const allocated = await (0, receivingOrderNumbering_js_1.allocateReceivingOrderNumber)(txn, now.getUTCFullYear());
            writes[receivingWriteIndex].data.receivingOrderNumber = allocated.receivingOrderNumber;
            writes.push({ op: "set", ref: allocated.counterWrite.ref, data: allocated.counterWrite.data });
        }
        // ---- 9. stage the RECEIVED ledger effect(s), PER LINE ----
        //
        // NONE  -> exactly one event per line carrying that line's received quantity.
        // SERIAL-> one event PER UNIT, each quantity 1 and carrying its serialNo. Not a choice made here:
        //          the ledger's own validator requires quantity === 1 and a serialNo for a SERIAL part.
        // The single append-only ledger stays the one movement authority; this only stages the shape it
        // already defines. NO new ledger vocabulary -- every event is RECEIVED.
        const ledgerStore = bufferedStore(collections_js_1.INVENTORY_TRANSACTIONS_COLLECTION);
        const ledgerOutcomes = [];
        const serializedAssetIds = [];
        let anySerial = false;
        for (const line of value.lines) {
            const part = partsByPartId.get(line.partId);
            if (part === undefined)
                throw new ReceivingIntegrityError("part authority missing for a validated line");
            const isSerialLine = line.trackingMode === "SERIAL";
            if (isSerialLine)
                anySerial = true;
            const lineSerials = line.serialNumbers ?? [];
            const ledgerEventBase = {
                type: "RECEIVED",
                partId: line.partId,
                location: { type: value.receivingLocation.type, locationId: value.receivingLocation.locationId },
                sourceObject: { type: "RECEIVING_ORDER", id: receivingId },
                actor: { kind: actor.kind, id: actor.id },
                occurredAt: occurredAtMillis,
            };
            const ledgerEvents = isSerialLine
                ? lineSerials.map((serialNo) => ({
                    ...ledgerEventBase,
                    quantity: 1,
                    serialNo,
                    idempotencyKey: ledgerSerialIdempotencyKey(receivingId, line.lineId, serialNo),
                }))
                : [{ ...ledgerEventBase, quantity: line.receivedQuantity, idempotencyKey: ledgerLineIdempotencyKey(receivingId, line.lineId) }];
            for (const ev of ledgerEvents) {
                ledgerOutcomes.push(await (0, operationalMovementRepository_js_1.stageOperationalMovement)(ledgerStore, ev, { partId: line.partId, trackingMode: part.trackingMode }, { now }));
            }
            // ---- 9b. SERIAL: activate one Serialized Asset per unit, in THIS transaction ----
            //
            // Identity is deterministic on (partId, serialNo), so `create` IS the uniqueness check -- there
            // is no read-then-write race. A pre-existing document is only acceptable when THIS receipt
            // created it (activatedByReceivingId matches), which is the replay case; any other owner means
            // the same physical unit is being received twice, and the whole receipt fails closed.
            if (isSerialLine) {
                for (const serialNo of lineSerials) {
                    const assetId = (0, serializedAssetRegistration_js_1.serializedAssetDocId)(line.partId, serialNo);
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
                                partId: line.partId,
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
        }
        const ledgerEventIds = ledgerOutcomes.map((o) => o.docId);
        const ledgerEventId = ledgerEventIds[0];
        // ---- 10. PER-LINE RESULT, derived. Computed for BOTH the apply and replay paths so a replayed
        // receipt reports the same truthful progress as the original. ----
        // Keyed by the PO's OWN line id, not the receipt's. They are the same for canonical; for legacy
        // the receipt carries the caller's label while the PO line is "L1", so a naive key would report
        // receivedNow: 0 for the very line just received.
        const receiptByLineId = resolved.isCanonical
            ? new Map(value.lines.map((l) => [l.lineId, l.receivedQuantity]))
            : new Map([[resolved.derived.lines[0].lineId, value.lines[0].receivedQuantity]]);
        const perLine = resolved.derived.lines.map((l) => {
            const receivedNow = receiptByLineId.get(l.lineId) ?? 0;
            // On a REPLAY the derivation already includes this receipt (it is committed), so adding it again
            // would double-count. `alreadyCounted` is what keeps the replayed answer equal to the original.
            const alreadyCounted = receivingOutcome.outcome === "replayed";
            const previouslyReceived = alreadyCounted ? l.receivedQuantity - receivedNow : l.receivedQuantity;
            const remainingAfter = Math.max(0, l.orderedQuantity - previouslyReceived - receivedNow);
            return {
                lineId: l.lineId,
                partId: l.partId,
                orderedQuantity: l.orderedQuantity,
                previouslyReceived,
                receivedNow,
                remainingQuantity: remainingAfter,
                state: remainingAfter === 0 ? "RECEIVED" : previouslyReceived + receivedNow === 0 ? "NOT_RECEIVED" : "PARTIALLY_RECEIVED",
            };
        });
        const fullyReceived = perLine.every((l) => l.remainingQuantity === 0);
        const derivedState = fullyReceived
            ? "RECEIVED"
            : perLine.every((l) => l.previouslyReceived + l.receivedNow === 0)
                ? "NOT_RECEIVED"
                : "PARTIALLY_RECEIVED";
        // ---- 11. decide apply vs replay (coherence: receiving and EVERY ledger effect must agree) ----
        const replayResult = {
            receivingId,
            purchaseOrderId: resolved.purchaseOrderId,
            sourceType: resolved.sourceType,
            ledgerEventId,
            ledgerEventIds,
            lines: perLine,
            derivedState,
            storedStatus: resolved.storedStatus,
            ...(anySerial ? { serializedAssetIds } : {}),
        };
        if (receivingOutcome.outcome === "replayed") {
            if (ledgerOutcomes.some((o) => o.outcome !== "replayed"))
                throw new ReceivingIntegrityError("receiving replayed but ledger did not");
            return { outcome: "replayed", ...replayResult };
        }
        if (ledgerOutcomes.some((o) => o.outcome !== "applied"))
            throw new ReceivingIntegrityError("receiving applied but ledger did not");
        // ---- 12. LIFECYCLE writes, per authority ----
        let storedStatusAfter = resolved.storedStatus;
        if (resolved.isCanonical) {
            // THE CONCURRENCY SERIALIZATION POINT. The version increment is written on EVERY canonical
            // receipt, including a partial one, because that is what makes a concurrent transaction which
            // read the prior version abort and retry against committed state. It is concurrency control
            // ONLY -- it never represents quantity received, quantity remaining, receipt count, or business
            // progress.
            const poUpdate = {
                version: resolved.version + 1,
                updatedAt: firestore_1.Timestamp.fromDate(now),
            };
            // Stored lifecycle moves to RECEIVED only when every line has zero remaining. A partial receipt
            // leaves it SENT. There is deliberately NO persisted PARTIALLY_RECEIVED status -- partial
            // progress is derived from the receipts, so it cannot drift from them.
            if (fullyReceived) {
                poUpdate.status = RECEIVED;
                storedStatusAfter = RECEIVED;
            }
            writes.push({ op: "update", ref: resolved.poRef, data: poUpdate });
        }
        else {
            // LEGACY: transition ONLY reorder_requests ORDERED -> RECEIVED. The legacy PO document is never
            // written. Legacy receipts are full-quantity by validation, so this always completes the order.
            if (reqStatus !== ORDERED)
                throw new SourceNotReceivableError("reorder request is not ORDERED");
            writes.push({ op: "update", ref: reqRef, data: { status: RECEIVED, receivedAt: firestore_1.Timestamp.fromDate(now), receivedBy: actor.id } });
        }
        // ---- 13. one immutable audit event (sanitized) ----
        const totalQuantity = value.lines.reduce((sum, l) => sum + l.receivedQuantity, 0);
        deps.stageAudit(txn, {
            action: "receiveInventoryStock",
            actorId: actor.id,
            receivingId,
            ...(resolved.reorderRequestId === undefined ? {} : { reorderRequestId: resolved.reorderRequestId }),
            purchaseOrderId: resolved.purchaseOrderId,
            sourceType: resolved.sourceType,
            // The single-line fields are kept ONLY when the receipt really is one line, so an existing
            // reader is unaffected and a multi-line receipt never reports one part as if it were the whole
            // receipt. lineCount/totalQuantity describe the batch honestly in both cases.
            ...(value.lines.length === 1 ? { partId: value.lines[0].partId, quantity: value.lines[0].receivedQuantity } : {}),
            lineCount: value.lines.length,
            totalQuantity,
            locationType: value.receivingLocation.type,
            locationId: value.receivingLocation.locationId,
            ledgerEventId,
            ...(anySerial ? { serialCount: serializedAssetIds.length } : {}),
        });
        // ---- 14. flush all buffered writes. The LEGACY purchase order is never written. Commit is
        // all-or-nothing (the enclosing runTransaction). ----
        for (const w of writes) {
            if (w.op === "create")
                txn.create(w.ref, w.data);
            else if (w.op === "set")
                txn.set(w.ref, w.data);
            else
                txn.update(w.ref, w.data);
        }
        return { outcome: "applied", ...replayResult, storedStatus: storedStatusAfter };
    });
}
//# sourceMappingURL=receiveInventoryStockCommand.js.map