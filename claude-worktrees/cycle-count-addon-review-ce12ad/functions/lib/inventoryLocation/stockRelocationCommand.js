"use strict";
// STOCK RELOCATION — moving already-owned stock between exact governed locations inside ONE Warehouse.
// BIN-P6 / Decision #170. Specification: docs/specifications/bin-stock-relocation-and-multi-scan.md §5.
//
// ============================ WHAT THIS AUTHORITY IS ============================
//
// The one writer of RELOCATION_OUT / RELOCATION_IN. It moves stock WAREHOUSE-direct ↔ BIN and BIN ↔ BIN
// inside a single custody parent, so the Warehouse aggregate does not change (Decision #160 / ADR-014).
// Anything that crosses a custody boundary -- another Warehouse, a truck -- is a Transfer and is
// refused here by name, so the two authorities never overlap.
//
// ============================ WHAT IT REFUSES TO GUESS ============================
//
// EXACT SOURCE. Sufficiency is read at the stated source location and nowhere else. It never borrows
// from direct Warehouse stock, a sibling Bin, another Warehouse or a truck. Decision #170 Ruling 7: a
// movement cannot invent which child Bin stock came from.
//
// GOVERNED PARENTAGE. A Bin's Warehouse is its document's `warehouseId`. Never the id prefix, never the
// human code, never what the scanner printed.
//
// SERIAL IDENTITY. A serialized unit moves by updating its own `currentLocationId` -- the existing field,
// through the canonical serializedAssetDocId -- never by quantity math, never through a parallel table.
//
// ============================ REPLAY IS BY INTENT, NOT BY CLOCK ============================
//
// Ledger rows are fingerprinted over their whole value, including occurredAt. A retry stamped with a
// fresh clock would therefore read as a CONFLICT, and a warehouse phone on a bad connection retries.
// So the command first looks for its own prior rows: if they all exist it reproduces them from the
// stored row's occurredAt and actor and lets the ledger compare intent. Same intent → replayed, nothing
// written. Different intent under the same key → IDEMPOTENCY_CONFLICT. Some rows present and others
// absent is an integrity failure, never "finish the rest".
Object.defineProperty(exports, "__esModule", { value: true });
exports.RelocationError = exports.MAX_RELOCATION_SERIALS = exports.RELOCATION_ENDPOINT_TYPES = exports.STOCK_RELOCATE_CAPABILITY = void 0;
exports.validateRelocationRequest = validateRelocationRequest;
exports.deriveRelocationId = deriveRelocationId;
exports.relocationRowKey = relocationRowKey;
exports.relocateStock = relocateStock;
const node_crypto_1 = require("node:crypto");
const collections_js_1 = require("../constants/collections.js");
const operationalMovementRepository_js_1 = require("../inventoryLedger/operationalMovementRepository.js");
const operationalMovementTypes_js_1 = require("../inventoryLedger/operationalMovementTypes.js");
const locationOnHand_js_1 = require("../inventoryLedger/locationOnHand.js");
const governedWarehouseValidation_js_1 = require("../warehouseGovernance/governedWarehouseValidation.js");
const serializedAssetRegistration_js_1 = require("../serializedAsset/serializedAssetRegistration.js");
const binCommands_js_1 = require("./binCommands.js");
const binRegistry_js_1 = require("./binRegistry.js");
const putAwayCommand_js_1 = require("./putAwayCommand.js");
exports.STOCK_RELOCATE_CAPABILITY = "inventory.stock.relocate";
exports.RELOCATION_ENDPOINT_TYPES = ["WAREHOUSE", "BIN"];
/** Serial count ceiling per line: one transaction must stay well inside Firestore's write limit. */
exports.MAX_RELOCATION_SERIALS = 100;
class RelocationError extends Error {
    code;
    reason;
    constructor(code, reason) {
        super(reason);
        this.code = code;
        this.reason = reason;
        this.name = "RelocationError";
    }
}
exports.RelocationError = RelocationError;
const isNonBlank = (v) => typeof v === "string" && v.trim() !== "";
const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const ALLOWED_KEYS = new Set([
    "partId", "source", "destination", "quantity", "serialNumbers", "idempotencyKey",
    "recordPlacement", "pickedForWorkOrderId",
]);
function validateEndpoint(ref) {
    if (!isPlainObject(ref))
        return null;
    const keys = Object.keys(ref);
    if (keys.length !== 2 || !keys.every((k) => k === "type" || k === "locationId"))
        return null;
    if (!exports.RELOCATION_ENDPOINT_TYPES.includes(ref.type))
        return null;
    if (!(0, binRegistry_js_1.isSafeIdSegment)(ref.locationId))
        return null;
    return { type: ref.type, locationId: ref.locationId };
}
/** Shape validation only. Nothing about stock, locations or authority is decided here. */
function validateRelocationRequest(input) {
    if (!isPlainObject(input))
        return { valid: false, reason: "not_object" };
    if (Object.keys(input).some((k) => !ALLOWED_KEYS.has(k)))
        return { valid: false, reason: "unknown_field" };
    if (!isNonBlank(input.partId))
        return { valid: false, reason: "part_id_invalid" };
    const source = validateEndpoint(input.source);
    if (source === null)
        return { valid: false, reason: "source_invalid" };
    const destination = validateEndpoint(input.destination);
    if (destination === null)
        return { valid: false, reason: "destination_invalid" };
    if (source.type === destination.type && source.locationId === destination.locationId) {
        return { valid: false, reason: "same_location" };
    }
    if (!isNonBlank(input.idempotencyKey) || input.idempotencyKey.length > 300) {
        return { valid: false, reason: "idempotency_key_invalid" };
    }
    const hasSerials = input.serialNumbers !== undefined;
    const hasQuantity = input.quantity !== undefined;
    if (hasSerials === hasQuantity)
        return { valid: false, reason: "quantity_or_serials_required" };
    let serialNumbers;
    let quantity;
    if (hasSerials) {
        if (!Array.isArray(input.serialNumbers) || input.serialNumbers.length === 0) {
            return { valid: false, reason: "serial_numbers_invalid" };
        }
        if (input.serialNumbers.length > exports.MAX_RELOCATION_SERIALS)
            return { valid: false, reason: "too_many_serials" };
        serialNumbers = [];
        for (const s of input.serialNumbers) {
            if (!isNonBlank(s))
                return { valid: false, reason: "serial_numbers_invalid" };
            serialNumbers.push(s.trim());
        }
        if (new Set(serialNumbers).size !== serialNumbers.length)
            return { valid: false, reason: "serial_repeated" };
    }
    else {
        if (typeof input.quantity !== "number" || !Number.isInteger(input.quantity) || input.quantity <= 0) {
            return { valid: false, reason: "quantity_invalid" };
        }
        quantity = input.quantity;
    }
    const recordPlacement = input.recordPlacement === undefined ? false : input.recordPlacement;
    if (typeof recordPlacement !== "boolean")
        return { valid: false, reason: "record_placement_invalid" };
    if (recordPlacement && destination.type !== "BIN")
        return { valid: false, reason: "placement_requires_bin_destination" };
    const picked = input.pickedForWorkOrderId;
    if (picked !== undefined && (!recordPlacement || !isNonBlank(picked))) {
        return { valid: false, reason: "picked_for_work_order_invalid" };
    }
    return {
        valid: true,
        value: {
            partId: input.partId.trim(),
            source,
            destination,
            ...(quantity !== undefined ? { quantity } : {}),
            ...(serialNumbers !== undefined ? { serialNumbers } : {}),
            idempotencyKey: input.idempotencyKey,
            recordPlacement,
            pickedForWorkOrderId: isNonBlank(picked) ? picked.trim() : null,
        },
    };
}
/** The deterministic relocation identity -- the STOCK_RELOCATION source object id. Path-safe. */
function deriveRelocationId(idempotencyKey) {
    return "srl_" + (0, node_crypto_1.createHash)("sha256").update(idempotencyKey).digest("hex").slice(0, 40);
}
/** Per-row ledger idempotency keys. A serial gets its own pair, so one unit never replays another's. */
function relocationRowKey(idempotencyKey, side, serialNo) {
    return serialNo === undefined
        ? `stockRelocation:${idempotencyKey}:${side}`
        : `stockRelocation:${idempotencyKey}:${side}:${serialNo}`;
}
async function resolveWarehouseActive(txn, db, warehouseId) {
    const snap = await txn.get(db.collection(collections_js_1.WAREHOUSES_COLLECTION).doc(warehouseId));
    if (!snap.exists)
        throw new RelocationError("NOT_FOUND", "warehouse_not_found");
    const parsed = (0, governedWarehouseValidation_js_1.validateGovernedWarehouse)(snap.data(), warehouseId);
    if (!parsed.valid)
        throw new RelocationError("INTEGRITY", "warehouse_unreadable");
    if (parsed.value.status !== "ACTIVE")
        throw new RelocationError("RETIRED_BIN", "warehouse_not_active");
}
/**
 * Resolve an endpoint to its governed custody parent. A BIN's parent comes from its own document -- the
 * one place parentage is stored -- and both the bin and its parent must be ACTIVE.
 */
async function resolveEndpoint(txn, db, ref) {
    if (ref.type === "WAREHOUSE") {
        await resolveWarehouseActive(txn, db, ref.locationId);
        return { ref, custodyWarehouseId: ref.locationId, binCode: null };
    }
    const snap = await txn.get(db.collection(binCommands_js_1.BINS_COLLECTION).doc(ref.locationId));
    if (!snap.exists)
        throw new RelocationError("NOT_FOUND", "bin_not_found");
    const bin = snap.data() ?? {};
    if (bin.schemaVersion !== binRegistry_js_1.BIN_SCHEMA_VERSION || !isNonBlank(bin.warehouseId) || !isNonBlank(bin.code)) {
        throw new RelocationError("INTEGRITY", "bin_unreadable");
    }
    if (bin.status !== "ACTIVE")
        throw new RelocationError("RETIRED_BIN", "bin_not_active");
    await resolveWarehouseActive(txn, db, bin.warehouseId);
    return { ref, custodyWarehouseId: bin.warehouseId, binCode: bin.code };
}
function buildRowEvents(req, part, relocationId, actorId, occurredAt) {
    const base = {
        partId: part.partId,
        sourceObject: { type: "STOCK_RELOCATION", id: relocationId },
        actor: { kind: "USER", id: actorId },
        occurredAt,
    };
    const serials = req.serialNumbers ?? [];
    if (serials.length === 0) {
        return [
            { ...base, type: "RELOCATION_OUT", location: req.source, counterpartyLocation: req.destination,
                quantity: req.quantity, idempotencyKey: relocationRowKey(req.idempotencyKey, "out") },
            { ...base, type: "RELOCATION_IN", location: req.destination, counterpartyLocation: req.source,
                quantity: req.quantity, idempotencyKey: relocationRowKey(req.idempotencyKey, "in") },
        ];
    }
    return serials.flatMap((serialNo) => [
        { ...base, type: "RELOCATION_OUT", location: req.source, counterpartyLocation: req.destination,
            quantity: 1, serialNo, idempotencyKey: relocationRowKey(req.idempotencyKey, "out", serialNo) },
        { ...base, type: "RELOCATION_IN", location: req.destination, counterpartyLocation: req.source,
            quantity: 1, serialNo, idempotencyKey: relocationRowKey(req.idempotencyKey, "in", serialNo) },
    ]);
}
async function relocateStock(request, deps) {
    const validated = validateRelocationRequest(request);
    if (!validated.valid)
        throw new RelocationError("INVALID", validated.reason);
    const req = validated.value;
    const relocationId = deriveRelocationId(req.idempotencyKey);
    const serials = req.serialNumbers ?? [];
    return deps.db.runTransaction(async (txn) => {
        // ---- 1. authority: each capability independently, through the transaction ----
        if (!(await deps.authorize(txn, deps.db, deps.actor.id, exports.STOCK_RELOCATE_CAPABILITY))) {
            throw new RelocationError("DENIED", "relocate_not_authorized");
        }
        if (req.recordPlacement && !(await deps.authorize(txn, deps.db, deps.actor.id, putAwayCommand_js_1.PLACEMENT_RECORD_CAPABILITY))) {
            // Holding relocate does not imply placement, and holding placement never implies relocate.
            throw new RelocationError("DENIED", "placement_not_authorized");
        }
        // ---- 2. part authority: tracking mode from the Part Master, never from the request ----
        const part = await deps.resolvePart(txn, deps.db, req.partId);
        if (part === null)
            throw new RelocationError("NOT_FOUND", "part_not_found");
        if (!part.active)
            throw new RelocationError("INVALID", "part_not_active");
        if (part.trackingMode === "LOT")
            throw new RelocationError("INVALID", "lot_not_supported");
        const isSerial = part.trackingMode === "SERIAL";
        if (isSerial !== serials.length > 0) {
            throw new RelocationError("INVALID", isSerial ? "serial_numbers_required" : "serial_numbers_not_allowed");
        }
        // ---- 3. prior write? replay by intent ----
        const rowKeys = isSerial
            ? serials.flatMap((s) => [relocationRowKey(req.idempotencyKey, "out", s), relocationRowKey(req.idempotencyKey, "in", s)])
            : [relocationRowKey(req.idempotencyKey, "out"), relocationRowKey(req.idempotencyKey, "in")];
        const rowSnaps = await Promise.all(rowKeys.map((k) => txn.get(deps.db.collection(collections_js_1.INVENTORY_TRANSACTIONS_COLLECTION).doc((0, operationalMovementRepository_js_1.operationalMovementDocId)(k)))));
        const present = rowSnaps.filter((s) => s.exists).length;
        if (present > 0 && present < rowSnaps.length)
            throw new RelocationError("INTEGRITY", "partial_prior_relocation");
        const writes = [];
        const bufferedStore = {
            async read(docId) {
                const s = await txn.get(deps.db.collection(collections_js_1.INVENTORY_TRANSACTIONS_COLLECTION).doc(docId));
                return s.exists ? (s.data() ?? {}) : null;
            },
            create(docId, data) {
                writes.push({ op: "create", ref: deps.db.collection(collections_js_1.INVENTORY_TRANSACTIONS_COLLECTION).doc(docId), data });
            },
        };
        const partAuthority = { partId: part.partId, trackingMode: part.trackingMode };
        const now = deps.now();
        if (present === rowSnaps.length) {
            // Reproduce the original rows from their own stored clock and actor, then let the ledger
            // compare intent. A different part/location/quantity/serial under this key is a conflict.
            let stored;
            try {
                stored = (0, operationalMovementRepository_js_1.deserializeOperationalMovement)(rowSnaps[0].data()).value;
            }
            catch (err) {
                if (err instanceof operationalMovementTypes_js_1.MalformedStoredRecordError)
                    throw new RelocationError("INTEGRITY", "stored_row_malformed");
                throw err;
            }
            const events = buildRowEvents(req, part, relocationId, stored.actor.id, stored.occurredAt);
            const movementIds = [];
            try {
                for (const ev of events) {
                    const o = await (0, operationalMovementRepository_js_1.stageOperationalMovement)(bufferedStore, ev, partAuthority, { now });
                    if (o.outcome !== "replayed")
                        throw new RelocationError("INTEGRITY", "replay_incoherent");
                    movementIds.push(o.docId);
                }
            }
            catch (err) {
                if (err instanceof operationalMovementTypes_js_1.IdempotencyConflictError)
                    throw new RelocationError("IDEMPOTENCY_CONFLICT", "idempotency_key_reused");
                if (err instanceof operationalMovementTypes_js_1.MalformedStoredRecordError)
                    throw new RelocationError("INTEGRITY", "stored_row_malformed");
                throw err;
            }
            const placementIds = req.recordPlacement
                ? (0, putAwayCommand_js_1.buildPlacementEntries)({
                    warehouseId: "", binId: req.destination.locationId, binCode: "", partId: part.partId,
                    idempotencyKey: req.idempotencyKey, pickedForWorkOrderId: req.pickedForWorkOrderId, note: null,
                    serialNumbers: serials, quantity: req.quantity ?? 0, now, actorId: deps.actor.id,
                }).map((e) => e.id)
                : [];
            return {
                outcome: "replayed", relocationId, partId: part.partId, source: req.source,
                destination: req.destination, quantity: isSerial ? null : (req.quantity ?? null),
                serialNumbers: serials, movementIds, placementIds,
            };
        }
        // ---- 4. endpoints: governed, ACTIVE, same custody parent ----
        const source = await resolveEndpoint(txn, deps.db, req.source);
        const destination = await resolveEndpoint(txn, deps.db, req.destination);
        if (source.custodyWarehouseId !== destination.custodyWarehouseId) {
            // Crossing a Warehouse is crossing a custody boundary. That is a Transfer, by name.
            throw new RelocationError("CROSS_WAREHOUSE", "different_custody_parents_use_transfer");
        }
        // ---- 5. exact-source sufficiency ----
        const assetRefs = serials.map((s) => deps.db.collection(collections_js_1.SERIALIZED_ASSETS_COLLECTION).doc((0, serializedAssetRegistration_js_1.serializedAssetDocId)(part.partId, s)));
        if (isSerial) {
            const assetSnaps = await Promise.all(assetRefs.map((r) => txn.get(r)));
            assetSnaps.forEach((snap, i) => {
                if (!snap.exists)
                    throw new RelocationError("NOT_FOUND", `serial_not_found:${i}`);
                const a = snap.data() ?? {};
                if (a.partId !== part.partId)
                    throw new RelocationError("NOT_FOUND", `serial_wrong_part:${i}`);
                if (a.currentLocationId !== req.source.locationId)
                    throw new RelocationError("SERIAL_NOT_AT_SOURCE", `serial_elsewhere:${i}`);
                if (a.inventoryState !== "AVAILABLE" || (a.currentEquipmentId !== undefined && a.currentEquipmentId !== null)) {
                    throw new RelocationError("SERIAL_NOT_AT_SOURCE", `serial_not_available:${i}`);
                }
            });
        }
        else {
            const ledger = await txn.get(deps.db.collection(collections_js_1.INVENTORY_TRANSACTIONS_COLLECTION).where("partId", "==", part.partId));
            const movements = [];
            for (const doc of ledger.docs) {
                const data = doc.data();
                if ((0, operationalMovementRepository_js_1.classifyLedgerDoc)(data) !== "operational")
                    continue;
                try {
                    movements.push((0, operationalMovementRepository_js_1.deserializeOperationalMovement)(data).value);
                }
                catch {
                    // A malformed row is skipped, never trusted: it can only ever REDUCE what we are willing to
                    // move, never inflate it.
                }
            }
            const atSource = (0, locationOnHand_js_1.sumExactLocationOnHand)(movements, req.source);
            if (atSource < req.quantity)
                throw new RelocationError("INSUFFICIENT_STOCK", "exact_source_short");
        }
        // ---- 6. placement records (put-away), read before any write ----
        const placementEntries = req.recordPlacement
            ? (0, putAwayCommand_js_1.buildPlacementEntries)({
                warehouseId: destination.custodyWarehouseId,
                binId: req.destination.locationId,
                binCode: destination.binCode,
                partId: part.partId,
                idempotencyKey: req.idempotencyKey,
                pickedForWorkOrderId: req.pickedForWorkOrderId,
                note: null,
                serialNumbers: serials,
                quantity: req.quantity ?? 0,
                now,
                actorId: deps.actor.id,
            })
            : [];
        const placementSnaps = await Promise.all(placementEntries.map((e) => txn.get(deps.db.collection(putAwayCommand_js_1.BIN_PLACEMENTS_COLLECTION).doc(e.id))));
        if (placementSnaps.some((s) => s.exists))
            throw new RelocationError("INTEGRITY", "placement_without_movement");
        // ---- 7. stage the ledger pair (reads inside staging are idempotency probes only) ----
        const movementIds = [];
        for (const ev of buildRowEvents(req, part, relocationId, deps.actor.id, now.getTime())) {
            const o = await (0, operationalMovementRepository_js_1.stageOperationalMovement)(bufferedStore, ev, partAuthority, { now });
            if (o.outcome !== "applied")
                throw new RelocationError("INTEGRITY", "fresh_relocation_replayed");
            movementIds.push(o.docId);
        }
        // ---- 8. serial custody moves with the ledger, in the same commit ----
        for (const ref of assetRefs) {
            writes.push({
                op: "update", ref,
                data: { currentLocationId: req.destination.locationId, updatedAtMillis: now.getTime(), updatedByUid: deps.actor.id },
            });
        }
        for (const e of placementEntries) {
            writes.push({ op: "create", ref: deps.db.collection(putAwayCommand_js_1.BIN_PLACEMENTS_COLLECTION).doc(e.id), data: e.data });
        }
        deps.stageAudit(txn, {
            actorId: deps.actor.id,
            relocationId,
            partId: part.partId,
            source: req.source,
            destination: req.destination,
            quantity: isSerial ? serials.length : req.quantity,
            serialCount: serials.length,
            placementRecorded: req.recordPlacement,
        });
        for (const w of writes) {
            if (w.op === "create")
                txn.create(w.ref, w.data);
            else
                txn.update(w.ref, w.data);
        }
        return {
            outcome: "relocated", relocationId, partId: part.partId, source: req.source,
            destination: req.destination, quantity: isSerial ? null : req.quantity,
            serialNumbers: serials, movementIds, placementIds: placementEntries.map((e) => e.id),
        };
    });
}
//# sourceMappingURL=stockRelocationCommand.js.map