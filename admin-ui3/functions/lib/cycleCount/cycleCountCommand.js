"use strict";
// FROZEN -- CERTIFICATION HISTORY ONLY (Decision #179). This is the v1 single-part Cycle Count family.
// No deployed function reaches it: index.ts exports only the A1 sheet/line callables
// (cycleCountSheetCallables.ts). It remains solely because the frozen Certification tooling
// (functions/scripts/certificationWorld/*) and its tests drive it. Do not extend it and do not wire it
// to a callable, and do not read a v1 record from the sheet/line authority.
// Enterprise Inventory -- Cycle Count operating authority: the trusted command family that CREATES,
// RECORDS, and RECONCILES a `cycle_counts` record. Follows receiveInventoryStockCommand.ts /
// transferOrderCommand.ts's proven pattern: one Firestore transaction per action, all reads before any
// writes (writes buffered and flushed after the last read), a deterministic doc id + fingerprint
// idempotency guard, one staged audit event per action, and a sanitized error taxonomy.
//
// MOVEMENT AUTHORITY BOUNDARY: this command never moves stock between locations (that remains Transfer's
// exclusive authority) and never overwrites stock truth directly. reconcileCycleCount corrects the
// expected-quantity authority ONLY by staging an ADJUSTED ledger event -- the same operational-ledger
// contract Transfer/Receiving already write -- so the correction is evidence-backed and auditable, never
// a silent field overwrite.
//
// SERIAL "MISSING" DISPOSITION (the smallest isolated Owner decision this module could not resolve on its
// own -- see the report): the governed serialized_assets lifecycle (serializedAsset/types.ts's
// SERIALIZED_ASSET_STATES) is an exact 8-value set with NO "missing/lost" terminal state, and it is
// mirrored verbatim from the frontend's serializedAssetIdentity.js contract -- inventing a 9th state here
// would be a material, cross-cutting governance change outside a Cycle Count authority's scope. This
// command therefore stages ADJUSTED ledger EVIDENCE for every missing serial (so the fact a unit did not
// reconcile at this location is durably recorded and audited) but does NOT flip the serialized_assets
// document's inventoryState -- the unit remains AVAILABLE at its last-known location until a future,
// separately-authorized decision defines what "confirmed missing" means for that registry. The same
// posture applies to "unexpected" serials found during a count: they are recorded as evidence (never
// silently relocated into this location, which would be an uninvited Transfer).
Object.defineProperty(exports, "__esModule", { value: true });
exports.CycleCountIntegrityError = exports.CycleCountMalformedStoredRecordError = exports.CycleCountIdempotencyConflictError = exports.CycleCountStatusInvalidError = exports.CycleCountReasonRequiredError = exports.CycleCountPartInvalidError = exports.CycleCountLocationInvalidError = exports.CycleCountNotFoundError = exports.CycleCountSelfApprovalError = exports.UnauthorizedCycleCountError = void 0;
exports.createCycleCount = createCycleCount;
exports.submitCycleCount = submitCycleCount;
exports.reconcileCycleCount = reconcileCycleCount;
exports.cancelCycleCount = cancelCycleCount;
const node_crypto_1 = require("node:crypto");
const collections_js_1 = require("../constants/collections.js");
const operationalMovementRepository_js_1 = require("../inventoryLedger/operationalMovementRepository.js");
const cycleCountTypes_js_1 = require("./cycleCountTypes.js");
const cycleCountValidation_js_1 = require("./cycleCountValidation.js");
const cycleCountRepository_js_1 = require("./cycleCountRepository.js");
const cycleCountExpectedQuantity_js_1 = require("./cycleCountExpectedQuantity.js");
const cycleCountMateriality_js_1 = require("./cycleCountMateriality.js");
var cycleCountTypes_js_2 = require("./cycleCountTypes.js");
Object.defineProperty(exports, "UnauthorizedCycleCountError", { enumerable: true, get: function () { return cycleCountTypes_js_2.UnauthorizedCycleCountError; } });
Object.defineProperty(exports, "CycleCountSelfApprovalError", { enumerable: true, get: function () { return cycleCountTypes_js_2.CycleCountSelfApprovalError; } });
Object.defineProperty(exports, "CycleCountNotFoundError", { enumerable: true, get: function () { return cycleCountTypes_js_2.CycleCountNotFoundError; } });
Object.defineProperty(exports, "CycleCountLocationInvalidError", { enumerable: true, get: function () { return cycleCountTypes_js_2.CycleCountLocationInvalidError; } });
Object.defineProperty(exports, "CycleCountPartInvalidError", { enumerable: true, get: function () { return cycleCountTypes_js_2.CycleCountPartInvalidError; } });
Object.defineProperty(exports, "CycleCountReasonRequiredError", { enumerable: true, get: function () { return cycleCountTypes_js_2.CycleCountReasonRequiredError; } });
Object.defineProperty(exports, "CycleCountStatusInvalidError", { enumerable: true, get: function () { return cycleCountTypes_js_2.CycleCountStatusInvalidError; } });
Object.defineProperty(exports, "CycleCountIdempotencyConflictError", { enumerable: true, get: function () { return cycleCountTypes_js_2.CycleCountIdempotencyConflictError; } });
Object.defineProperty(exports, "CycleCountMalformedStoredRecordError", { enumerable: true, get: function () { return cycleCountTypes_js_2.CycleCountMalformedStoredRecordError; } });
Object.defineProperty(exports, "CycleCountIntegrityError", { enumerable: true, get: function () { return cycleCountTypes_js_2.CycleCountIntegrityError; } });
const CREATE_CAPABILITY = "inventory.cycleCount.create";
const SUBMIT_CAPABILITY = "inventory.cycleCount.submit";
const RECONCILE_CAPABILITY = "inventory.cycleCount.reconcile";
const CANCEL_CAPABILITY = "inventory.cycleCount.cancel";
function isPlainObject(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}
function str(v) {
    return typeof v === "string" && v.trim() !== "" ? v : null;
}
function requireActor(actor) {
    if (!isPlainObject(actor) || (actor.kind !== "USER" && actor.kind !== "SYSTEM") || !str(actor.id)) {
        throw new cycleCountTypes_js_1.UnauthorizedCycleCountError("trusted actor context missing");
    }
    return { kind: actor.kind, id: actor.id };
}
function serialLedgerIdKey(cycleCountId, suffix, serialNo) {
    return "cycmv_" + (0, node_crypto_1.createHash)("sha256").update(JSON.stringify([cycleCountId, suffix, serialNo])).digest("hex").slice(0, 40);
}
function noneLedgerIdKey(cycleCountId) {
    return "cycmv_" + (0, node_crypto_1.createHash)("sha256").update(JSON.stringify([cycleCountId, "adjust"])).digest("hex").slice(0, 40);
}
// =====================================================================================================
// createCycleCount -- (none) -> OPEN. Snapshots expected quantity/serials from the ledger/registry
// authority at creation time (never accepted from input).
// =====================================================================================================
async function createCycleCount(request, deps) {
    const actor = requireActor(deps.actor);
    return deps.db.runTransaction(async (txn) => {
        const now = deps.now();
        if (!(await deps.authorize(txn, actor.id, CREATE_CAPABILITY)))
            throw new cycleCountTypes_js_1.UnauthorizedCycleCountError();
        if (!isPlainObject(request) || !str(request.partId))
            throw new cycleCountTypes_js_1.CycleCountPartInvalidError("partId missing");
        const part = await deps.resolvePart(txn, request.partId);
        if (part === null)
            throw new cycleCountTypes_js_1.CycleCountPartInvalidError("part not found");
        if (part.active !== true)
            throw new cycleCountTypes_js_1.CycleCountPartInvalidError("part is not active");
        if (part.partId !== request.partId)
            throw new cycleCountTypes_js_1.CycleCountPartInvalidError("resolved part identity incoherent");
        const authority = { part: { partId: part.partId, trackingMode: part.trackingMode } };
        const validated = (0, cycleCountValidation_js_1.validateCreateCycleCountInput)(request, authority);
        if (!validated.valid) {
            const reason = validated.reason ?? "unknown";
            if (reason === "location_invalid")
                throw new cycleCountTypes_js_1.CycleCountLocationInvalidError("location is malformed or not a WAREHOUSE/MOBILE reference");
            if (reason === "tracking_mode_unsupported")
                throw new cycleCountTypes_js_1.CycleCountPartInvalidError("tracking mode not supported (LOT deferred)");
            throw new cycleCountTypes_js_1.CycleCountPartInvalidError(`cycle count input invalid: ${reason}`);
        }
        const inputValue = validated.value;
        // ---- idempotency read (before location/ledger reads, cheapest fail-fast) ----
        const idempotencyKey = inputValue.idempotencyKey;
        const cycleCountId = (0, cycleCountRepository_js_1.cycleCountDocId)(idempotencyKey);
        const existingSnap = await txn.get(deps.db.collection(collections_js_1.CYCLE_COUNTS_COLLECTION).doc(cycleCountId));
        const requestFingerprint = (0, cycleCountRepository_js_1.fingerprintCycleCount)(inputValue);
        if (existingSnap.exists) {
            // A replay is judged against the STORED identity (taken at first create), NEVER a freshly
            // recomputed expected-quantity snapshot -- the snapshot is intentionally frozen at creation time,
            // so a later ledger movement must not make an already-created count's replay look like a conflict.
            const stored = (0, cycleCountRepository_js_1.deserializeCycleCount)(cycleCountId, existingSnap.data());
            if ((0, cycleCountRepository_js_1.cycleCountDocId)(stored.value.idempotencyKey) !== cycleCountId) {
                throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored idempotencyKey does not derive its document id");
            }
            const storedRecomputed = (0, cycleCountRepository_js_1.fingerprintCycleCount)((0, cycleCountRepository_js_1.toIdentity)(stored.value));
            if (storedRecomputed !== stored.fingerprint)
                throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored fingerprint does not match stored value");
            if (storedRecomputed !== requestFingerprint)
                throw new cycleCountTypes_js_1.CycleCountIdempotencyConflictError();
            return {
                outcome: "replayed",
                cycleCountId,
                fingerprint: stored.fingerprint,
                partId: stored.value.partId,
                trackingMode: stored.value.trackingMode,
                location: stored.value.location,
                expectedQuantity: stored.value.expectedQuantity,
                ...(stored.value.expectedSerialNumbers === undefined ? {} : { expectedSerialNumbers: stored.value.expectedSerialNumbers }),
                status: stored.status,
            };
        }
        if (!(await deps.resolveLocationActive(txn, inputValue.location))) {
            throw new cycleCountTypes_js_1.CycleCountLocationInvalidError("location is not an active governed location");
        }
        // ---- compute the expected-quantity snapshot from the authority (ledger for NONE, registry for SERIAL) ----
        const expectedSerialNumbers = inputValue.trackingMode === "SERIAL" ? await (0, cycleCountExpectedQuantity_js_1.computeExpectedSerialsThroughTxn)(txn, deps.db, part.partId, inputValue.location) : undefined;
        const expectedQuantity = inputValue.trackingMode === "NONE"
            ? await (0, cycleCountExpectedQuantity_js_1.computeExpectedQuantityThroughTxn)(txn, deps.db, part.partId, inputValue.location)
            : expectedSerialNumbers.length;
        const value = { ...inputValue, expectedQuantity, ...(expectedSerialNumbers === undefined ? {} : { expectedSerialNumbers }) };
        txn.create(deps.db.collection(collections_js_1.CYCLE_COUNTS_COLLECTION).doc(cycleCountId), (0, cycleCountRepository_js_1.serializeCycleCount)(value, actor, now, requestFingerprint));
        deps.stageAudit(txn, { action: "createCycleCount", actorId: actor.id, cycleCountId, partId: part.partId, location: value.location });
        return {
            outcome: "applied",
            cycleCountId,
            fingerprint: requestFingerprint,
            partId: value.partId,
            trackingMode: value.trackingMode,
            location: value.location,
            expectedQuantity: value.expectedQuantity,
            ...(expectedSerialNumbers === undefined ? {} : { expectedSerialNumbers }),
            status: "OPEN",
        };
    });
}
// =====================================================================================================
// submitCycleCount -- OPEN -> COUNTED. Records the counted quantity/serials and computes variance
// evidence. Stages NO ledger writes (pure recording) -- reconcileCycleCount is what corrects the
// authority, and only after a reason is supplied when required.
// =====================================================================================================
async function submitCycleCount(request, deps) {
    const actor = requireActor(deps.actor);
    if (!isPlainObject(request) || !str(request.cycleCountId))
        throw new cycleCountTypes_js_1.CycleCountNotFoundError("cycleCountId missing");
    const cycleCountId = request.cycleCountId;
    return deps.db.runTransaction(async (txn) => {
        const now = deps.now();
        if (!(await deps.authorize(txn, actor.id, SUBMIT_CAPABILITY)))
            throw new cycleCountTypes_js_1.UnauthorizedCycleCountError();
        const ref = deps.db.collection(collections_js_1.CYCLE_COUNTS_COLLECTION).doc(cycleCountId);
        const snap = await txn.get(ref);
        if (!snap.exists)
            throw new cycleCountTypes_js_1.CycleCountNotFoundError();
        const stored = (0, cycleCountRepository_js_1.deserializeCycleCount)(cycleCountId, snap.data());
        if (stored.status !== "OPEN" && stored.status !== "COUNTED") {
            throw new cycleCountTypes_js_1.CycleCountStatusInvalidError(`cycle count is ${stored.status}, cannot submit a count`);
        }
        const alreadySubmitted = stored.status === "COUNTED";
        const validated = (0, cycleCountValidation_js_1.validateSubmitCycleCountInput)(request, stored.value.trackingMode);
        if (!validated.valid)
            throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError(`submit input invalid: ${validated.reason}`);
        const submitted = validated.value;
        if (stored.value.trackingMode === "NONE") {
            const countedQuantity = submitted.countedQuantity;
            const variance = countedQuantity - stored.value.expectedQuantity;
            if (alreadySubmitted) {
                if (stored.countedQuantity !== countedQuantity) {
                    throw new cycleCountTypes_js_1.CycleCountIdempotencyConflictError("cycle count was already submitted with a different counted quantity");
                }
                return { outcome: "replayed", cycleCountId, status: stored.status, countedQuantity, variance: stored.variance, expectedQuantity: stored.value.expectedQuantity };
            }
            txn.update(ref, (0, cycleCountRepository_js_1.submitFields)(stored.version + 1, actor, now, countedQuantity, undefined, variance, undefined));
            deps.stageAudit(txn, { action: "submitCycleCount", actorId: actor.id, cycleCountId, partId: stored.value.partId, location: stored.value.location, variance });
            return { outcome: "applied", cycleCountId, status: "COUNTED", countedQuantity, variance, expectedQuantity: stored.value.expectedQuantity };
        }
        // SERIAL
        const counted = submitted.countedSerialNumbers;
        const expectedSet = new Set(stored.value.expectedSerialNumbers ?? []);
        const countedSet = new Set(counted);
        const missing = [...expectedSet].filter((s) => !countedSet.has(s)).sort();
        const unexpected = [...countedSet].filter((s) => !expectedSet.has(s)).sort();
        const serialVariance = { missing, unexpected };
        if (alreadySubmitted) {
            const priorCounted = new Set(stored.countedSerialNumbers ?? []);
            const same = priorCounted.size === countedSet.size && [...priorCounted].every((s) => countedSet.has(s));
            if (!same)
                throw new cycleCountTypes_js_1.CycleCountIdempotencyConflictError("cycle count was already submitted with different counted serials");
            return {
                outcome: "replayed",
                cycleCountId,
                status: stored.status,
                countedSerialNumbers: counted,
                serialVariance: stored.serialVariance,
                expectedSerialNumbers: stored.value.expectedSerialNumbers,
            };
        }
        txn.update(ref, (0, cycleCountRepository_js_1.submitFields)(stored.version + 1, actor, now, undefined, counted, undefined, serialVariance));
        deps.stageAudit(txn, { action: "submitCycleCount", actorId: actor.id, cycleCountId, partId: stored.value.partId, location: stored.value.location, serialVariance });
        return {
            outcome: "applied",
            cycleCountId,
            status: "COUNTED",
            countedSerialNumbers: counted,
            serialVariance,
            expectedSerialNumbers: stored.value.expectedSerialNumbers,
        };
    });
}
// =====================================================================================================
// reconcileCycleCount -- COUNTED -> RECONCILED (decision APPROVE, the default) or COUNTED -> REJECTED
// (decision REJECT). This is the manager review step: expected vs. counted vs. variance was already
// computed and frozen at submit time (submitCycleCount never lets the counter see it change after the
// fact); this command is where a manager DISPOSES of that variance.
//
//   APPROVE: requires a reason on any non-zero variance; stages ADJUSTED ledger evidence (never
//            overwrites stock truth directly) -- unchanged from this command's pre-M23 behavior.
//   REJECT : requires a reason on any non-zero variance (a dispute needs the same justification an
//            adjustment would); stages NO ledger writes at all -- the expected-quantity authority is
//            left exactly as it was, the count is simply recorded as disputed for follow-up (e.g. a
//            recount), never silently treated as a correction.
//
// SEPARATION OF DUTIES (Owner ruling, M23): whichever way a manager disposes of it, the disposing actor
// may not be the SAME principal who submitted this count (`stored.submittedBy`) when the variance is
// MATERIAL (cycleCountMateriality.ts) -- CycleCountSelfApprovalError, enforced inside this same
// transaction, so it cannot be bypassed by a client that simply omits the check. A record whose variance
// is not material (or is zero) has nothing to separate duties over, so the same principal may dispose of
// it either way -- forcing a second reviewer onto every rounding-level discrepancy would just make small
// counts slower without buying any real integrity.
//
// Idempotent (a retried APPROVE replays the same ledgerEventIds; a retried REJECT replays the same
// empty set); atomic; a decision cannot be changed after the fact (an already-RECONCILED count cannot
// later be REJECTed, or vice versa -- STATUS_INVALID).
// =====================================================================================================
async function reconcileCycleCount(request, deps) {
    const actor = requireActor(deps.actor);
    if (!isPlainObject(request) || !str(request.cycleCountId))
        throw new cycleCountTypes_js_1.CycleCountNotFoundError("cycleCountId missing");
    const cycleCountId = request.cycleCountId;
    const validatedReq = (0, cycleCountValidation_js_1.validateReconcileCycleCountInput)(request);
    if (!validatedReq.valid)
        throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError(`reconcile input invalid: ${validatedReq.reason}`);
    const suppliedReason = validatedReq.value.reason;
    const decision = validatedReq.value.decision;
    const isReject = decision === "REJECT";
    return deps.db.runTransaction(async (txn) => {
        const now = deps.now();
        const writes = [];
        if (!(await deps.authorize(txn, actor.id, RECONCILE_CAPABILITY)))
            throw new cycleCountTypes_js_1.UnauthorizedCycleCountError();
        const ref = deps.db.collection(collections_js_1.CYCLE_COUNTS_COLLECTION).doc(cycleCountId);
        const snap = await txn.get(ref);
        if (!snap.exists)
            throw new cycleCountTypes_js_1.CycleCountNotFoundError();
        const stored = (0, cycleCountRepository_js_1.deserializeCycleCount)(cycleCountId, snap.data());
        if (stored.status !== "COUNTED" && stored.status !== "RECONCILED" && stored.status !== "REJECTED") {
            throw new cycleCountTypes_js_1.CycleCountStatusInvalidError(`cycle count is ${stored.status}, cannot reconcile (submit a count first)`);
        }
        const alreadyDecided = stored.status === "RECONCILED" || stored.status === "REJECTED";
        if (alreadyDecided) {
            const priorWasReject = stored.status === "REJECTED";
            if (priorWasReject !== isReject) {
                throw new cycleCountTypes_js_1.CycleCountStatusInvalidError(`cycle count was already ${stored.status}, its decision cannot be changed`);
            }
        }
        const part = await deps.resolvePart(txn, stored.value.partId);
        if (part === null || part.partId !== stored.value.partId)
            throw new cycleCountTypes_js_1.CycleCountPartInvalidError("part not found");
        const isSerial = stored.value.trackingMode === "SERIAL";
        const discrepancyUnits = isSerial
            ? (stored.serialVariance?.missing.length ?? 0) + (stored.serialVariance?.unexpected.length ?? 0)
            : Math.abs(stored.variance ?? 0);
        const hasVariance = discrepancyUnits > 0;
        if (hasVariance && !alreadyDecided && !suppliedReason)
            throw new cycleCountTypes_js_1.CycleCountReasonRequiredError();
        if (hasVariance && !alreadyDecided) {
            // Fail-closed: submitCycleCount (post-M23) always writes submittedBy, so its absence on a
            // COUNTED record with a variance means the stored record predates that write or is otherwise
            // malformed -- refuse rather than silently allow an unattributable self-approval.
            if (stored.submittedBy === undefined) {
                throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored cycle count is COUNTED with a variance but has no submittedBy");
            }
            const expectedUnits = isSerial ? (stored.value.expectedSerialNumbers?.length ?? 0) : stored.value.expectedQuantity;
            const isMaterial = (0, cycleCountMateriality_js_1.isMaterialCycleCountVariance)(discrepancyUnits, expectedUnits, (0, cycleCountMateriality_js_1.resolveCycleCountMaterialityConfig)());
            if (isMaterial && actor.id === stored.submittedBy)
                throw new cycleCountTypes_js_1.CycleCountSelfApprovalError();
        }
        const bufferedStore = {
            async read(docId) {
                const s = await txn.get(deps.db.collection(collections_js_1.INVENTORY_TRANSACTIONS_COLLECTION).doc(docId));
                return s.exists ? (s.data() ?? {}) : null;
            },
            create(docId, data) {
                writes.push({ op: "create", ref: deps.db.collection(collections_js_1.INVENTORY_TRANSACTIONS_COLLECTION).doc(docId), data });
            },
        };
        const ledgerEventIds = [];
        // REJECT never stages ledger evidence, even when there is a variance -- rejecting a count is a
        // statement that the count itself is not trusted as a correction, not a correction in the other
        // direction. Only APPROVE (isReject === false) reaches the stageOperationalMovement calls below.
        if (!isReject && isSerial) {
            // Missing serials get ADJUSTED ledger EVIDENCE (see this module's header note on why the
            // serialized_assets registry itself is intentionally NOT flipped). "Unexpected" serials are
            // recorded as evidence on the cycle count document only (already staged at submit time) -- they
            // are never staged as a ledger movement here, since doing so without a genuine Transfer would be
            // an uninvited relocation of stock this authority does not own.
            for (const serialNo of stored.serialVariance?.missing ?? []) {
                const ev = {
                    type: "ADJUSTED",
                    partId: stored.value.partId,
                    location: stored.value.location,
                    quantity: 1,
                    sourceObject: { type: "ADJUSTMENT", id: cycleCountId },
                    actor: { kind: actor.kind, id: actor.id },
                    occurredAt: now.getTime(),
                    serialNo,
                    idempotencyKey: serialLedgerIdKey(cycleCountId, "missing", serialNo),
                };
                const outcome = await (0, operationalMovementRepository_js_1.stageOperationalMovement)(bufferedStore, ev, { partId: part.partId, trackingMode: part.trackingMode }, { now });
                ledgerEventIds.push(outcome.docId);
                if (!alreadyDecided && outcome.outcome !== "applied")
                    throw new cycleCountTypes_js_1.CycleCountIntegrityError("reconciliation ledger effect did not apply coherently");
                if (alreadyDecided && outcome.outcome !== "replayed")
                    throw new cycleCountTypes_js_1.CycleCountIntegrityError("cycle count already decided but ledger did not replay coherently");
            }
        }
        else if (!isReject && (stored.variance ?? 0) !== 0) {
            const ev = {
                type: "ADJUSTED",
                partId: stored.value.partId,
                location: stored.value.location,
                quantity: stored.variance,
                sourceObject: { type: "ADJUSTMENT", id: cycleCountId },
                actor: { kind: actor.kind, id: actor.id },
                occurredAt: now.getTime(),
                idempotencyKey: noneLedgerIdKey(cycleCountId),
            };
            const outcome = await (0, operationalMovementRepository_js_1.stageOperationalMovement)(bufferedStore, ev, { partId: part.partId, trackingMode: part.trackingMode }, { now });
            ledgerEventIds.push(outcome.docId);
            if (!alreadyDecided && outcome.outcome !== "applied")
                throw new cycleCountTypes_js_1.CycleCountIntegrityError("reconciliation ledger effect did not apply coherently");
            if (alreadyDecided && outcome.outcome !== "replayed")
                throw new cycleCountTypes_js_1.CycleCountIntegrityError("cycle count already decided but ledger did not replay coherently");
        }
        if (alreadyDecided) {
            const priorIds = new Set(stored.ledgerEventIds ?? []);
            const same = priorIds.size === ledgerEventIds.length && ledgerEventIds.every((id) => priorIds.has(id));
            if (!same)
                throw new cycleCountTypes_js_1.CycleCountIntegrityError("cycle count already decided but ledger evidence did not replay coherently");
            return {
                outcome: "replayed",
                cycleCountId,
                status: stored.status,
                ledgerEventIds,
                ...(stored.reviewDecision === undefined ? {} : { reviewDecision: stored.reviewDecision }),
                ...(stored.reconciliationReason === undefined ? {} : { reconciliationReason: stored.reconciliationReason }),
            };
        }
        writes.push({ op: "update", ref, data: (0, cycleCountRepository_js_1.reconcileFields)(stored.version + 1, actor, now, suppliedReason, ledgerEventIds, decision) });
        deps.stageAudit(txn, {
            action: isReject ? "rejectCycleCount" : "reconcileCycleCount",
            actorId: actor.id,
            cycleCountId,
            partId: stored.value.partId,
            location: stored.value.location,
            ...(isSerial ? { serialVariance: stored.serialVariance } : { variance: stored.variance }),
        });
        for (const w of writes) {
            if (w.op === "create")
                txn.create(w.ref, w.data);
            else
                txn.update(w.ref, w.data);
        }
        return {
            outcome: "applied",
            cycleCountId,
            status: isReject ? "REJECTED" : "RECONCILED",
            ledgerEventIds,
            reviewDecision: decision,
            ...(suppliedReason === null ? {} : { reconciliationReason: suppliedReason }),
        };
    });
}
// =====================================================================================================
// cancelCycleCount -- OPEN -> CANCELLED. Domain-safe ONLY: legal iff no count has been submitted yet.
// =====================================================================================================
async function cancelCycleCount(request, deps) {
    const actor = requireActor(deps.actor);
    if (!isPlainObject(request) || !str(request.cycleCountId))
        throw new cycleCountTypes_js_1.CycleCountNotFoundError("cycleCountId missing");
    const cycleCountId = request.cycleCountId;
    return deps.db.runTransaction(async (txn) => {
        const now = deps.now();
        if (!(await deps.authorize(txn, actor.id, CANCEL_CAPABILITY)))
            throw new cycleCountTypes_js_1.UnauthorizedCycleCountError();
        const ref = deps.db.collection(collections_js_1.CYCLE_COUNTS_COLLECTION).doc(cycleCountId);
        const snap = await txn.get(ref);
        if (!snap.exists)
            throw new cycleCountTypes_js_1.CycleCountNotFoundError();
        const stored = (0, cycleCountRepository_js_1.deserializeCycleCount)(cycleCountId, snap.data());
        if (stored.status === "CANCELLED")
            return { outcome: "replayed", cycleCountId, status: "CANCELLED" };
        if (stored.status !== "OPEN") {
            throw new cycleCountTypes_js_1.CycleCountStatusInvalidError(`cycle count is ${stored.status}, cancellation is only domain-safe before a count is submitted`);
        }
        txn.update(ref, (0, cycleCountRepository_js_1.cancelFields)(stored.version + 1, actor, now));
        deps.stageAudit(txn, { action: "cancelCycleCount", actorId: actor.id, cycleCountId, partId: stored.value.partId, location: stored.value.location });
        return { outcome: "applied", cycleCountId, status: "CANCELLED" };
    });
}
//# sourceMappingURL=cycleCountCommand.js.map