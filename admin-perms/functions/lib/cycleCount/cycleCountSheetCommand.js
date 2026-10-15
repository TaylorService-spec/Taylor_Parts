"use strict";
// Cycle Count A1 -- the SHEET / LINE command family (schema v2). Owner-approved A1 Revision 2,
// Decision #179. Replaces the single-part v1 commands for every deployed caller; the v1 modules remain
// only as frozen Certification-history tooling (see cycleCountCommand.ts header) and no callable reaches them.
//
// The integrity properties of v1 carry over, re-expressed PER LINE:
//   - one sheet per governed location; one line per Part (the line's path derives from the Part);
//   - the expected snapshot is server-computed when the line OPENS, stamped with its real instant, and
//     never recomputed; a discovered Part uses exactly the same authority (D4);
//   - BLIND: no response carries a line's expected value until THAT line is submitted;
//   - counting is observation: submit writes no ledger row;
//   - reconciliation is the only adjustment path, one line per transaction (D6): the line's disposition
//     and its ADJUSTED evidence commit together or not at all -- a partially reconciled line cannot exist;
//     a sheet is reconciled line by line and is therefore resumable, never restartable;
//   - separation of duties and materiality are evaluated per line (D1);
//   - the counted location is admitted by the ONE eligibility policy (P7: a BIN only after its Warehouse
//     passes the conversion gate), and expected quantity is the exact location through the ONE on-hand
//     authority, so RELOCATION_OUT / RELOCATION_IN are counted exactly where they happened.
//
// Every command: one transaction, all reads before any write, one staged audit event, sanitized errors.
Object.defineProperty(exports, "__esModule", { value: true });
exports.CycleCountMalformedStoredRecordError = exports.MAX_LINES_PER_SHEET_TRANSACTION = exports.CYCLE_COUNT_CAPABILITY = void 0;
exports.createCycleCountSheet = createCycleCountSheet;
exports.openCycleCountLine = openCycleCountLine;
exports.submitCycleCountLine = submitCycleCountLine;
exports.reconcileCycleCountLine = reconcileCycleCountLine;
exports.cancelCycleCountLine = cancelCycleCountLine;
exports.cancelCycleCountSheet = cancelCycleCountSheet;
exports.closeCycleCountSheet = closeCycleCountSheet;
const node_crypto_1 = require("node:crypto");
const collections_js_1 = require("../constants/collections.js");
const operationalMovementRepository_js_1 = require("../inventoryLedger/operationalMovementRepository.js");
const cycleCountTypes_js_1 = require("./cycleCountTypes.js");
Object.defineProperty(exports, "CycleCountMalformedStoredRecordError", { enumerable: true, get: function () { return cycleCountTypes_js_1.CycleCountMalformedStoredRecordError; } });
const cycleCountValidation_js_1 = require("./cycleCountValidation.js");
const cycleCountSheetRepository_js_1 = require("./cycleCountSheetRepository.js");
const cycleCountExpectedQuantity_js_1 = require("./cycleCountExpectedQuantity.js");
const cycleCountMateriality_js_1 = require("./cycleCountMateriality.js");
exports.CYCLE_COUNT_CAPABILITY = Object.freeze({
    create: "inventory.cycleCount.create",
    submit: "inventory.cycleCount.submit",
    reconcile: "inventory.cycleCount.reconcile",
    cancel: "inventory.cycleCount.cancel",
});
/** A sheet is cancelled in ONE transaction together with its open lines; beyond this it is refused, never partial. */
exports.MAX_LINES_PER_SHEET_TRANSACTION = 400;
function requireActor(actor) {
    if (!(0, cycleCountSheetRepository_js_1.isPlainObject)(actor) || (actor.kind !== "USER" && actor.kind !== "SYSTEM") || !(0, cycleCountSheetRepository_js_1.isNonEmptyString)(actor.id)) {
        throw new cycleCountTypes_js_1.UnauthorizedCycleCountError("trusted actor context missing");
    }
    return { kind: actor.kind, id: actor.id };
}
function requireString(request, key, onMissing) {
    if (!(0, cycleCountSheetRepository_js_1.isPlainObject)(request) || !(0, cycleCountSheetRepository_js_1.isNonEmptyString)(request[key]))
        throw onMissing();
    return request[key].trim();
}
const sheetRef = (db, sheetId) => db.collection(collections_js_1.CYCLE_COUNTS_COLLECTION).doc(sheetId);
const lineRef = (db, sheetId, partId) => sheetRef(db, sheetId).collection(cycleCountSheetRepository_js_1.CYCLE_COUNT_LINES_SUBCOLLECTION).doc((0, cycleCountSheetRepository_js_1.cycleCountLineId)(partId));
async function readSheet(txn, db, sheetId) {
    const snap = await txn.get(sheetRef(db, sheetId));
    if (!snap.exists)
        throw new cycleCountTypes_js_1.CycleCountSheetNotFoundError();
    // A v1 record (or anything else) at this id is refused, never interpreted: the strict version boundary.
    return (0, cycleCountSheetRepository_js_1.deserializeSheet)(sheetId, snap.data());
}
function requireOpen(sheet, what) {
    if (sheet.status !== "OPEN")
        throw new cycleCountTypes_js_1.CycleCountSheetStatusInvalidError(`sheet is ${sheet.status}; cannot ${what}`);
}
async function readLine(txn, db, sheetId, partId) {
    const snap = await txn.get(lineRef(db, sheetId, partId));
    return snap.exists ? (0, cycleCountSheetRepository_js_1.deserializeLine)(sheetId, snap.id, snap.data()) : null;
}
const ledgerKey = (...parts) => "cycmv_" + (0, node_crypto_1.createHash)("sha256").update(JSON.stringify(["cycle-count-line", ...parts])).digest("hex").slice(0, 40);
// ================================================================================ createCycleCountSheet
async function createCycleCountSheet(request, deps) {
    const actor = requireActor(deps.actor);
    const location = (0, cycleCountValidation_js_1.validateCycleCountLocationRef)((0, cycleCountSheetRepository_js_1.isPlainObject)(request) ? request.location : undefined);
    if (location === null)
        throw new cycleCountTypes_js_1.CycleCountLocationInvalidError("location is not a governed location reference");
    const idempotencyKey = requireString(request, "idempotencyKey", () => new cycleCountTypes_js_1.CycleCountIdempotencyConflictError("idempotencyKey missing"));
    const sheetId = (0, cycleCountSheetRepository_js_1.cycleCountSheetId)(idempotencyKey);
    return deps.db.runTransaction(async (txn) => {
        const now = deps.now();
        if (!(await deps.authorize(txn, actor.id, exports.CYCLE_COUNT_CAPABILITY.create)))
            throw new cycleCountTypes_js_1.UnauthorizedCycleCountError();
        const existing = await txn.get(sheetRef(deps.db, sheetId));
        if (existing.exists) {
            const stored = (0, cycleCountSheetRepository_js_1.deserializeSheet)(sheetId, existing.data());
            if (stored.fingerprint !== (0, cycleCountSheetRepository_js_1.fingerprintSheet)(location, idempotencyKey))
                throw new cycleCountTypes_js_1.CycleCountIdempotencyConflictError();
            return { outcome: "replayed", sheetId, location: stored.location, status: stored.status };
        }
        if (!(await deps.resolveLocationEligible(txn, location))) {
            throw new cycleCountTypes_js_1.CycleCountLocationInvalidError("location is not eligible for counting (inactive, unknown, or a Bin whose Warehouse has not passed the conversion gate)");
        }
        const company = await deps.resolveLocationCompany(txn, location);
        txn.create(sheetRef(deps.db, sheetId), (0, cycleCountSheetRepository_js_1.serializeNewSheet)(sheetId, location, idempotencyKey, actor, now, company));
        deps.stageAudit(txn, { action: "createCycleCountSheet", actorId: actor.id, sheetId, location });
        return { outcome: "applied", sheetId, location, status: "OPEN" };
    });
}
// ================================================================================ openCycleCountLine
/** OPEN a line for a Part -- or return the one that exists. The response carries NO expected value. */
async function openCycleCountLine(request, deps) {
    const actor = requireActor(deps.actor);
    const sheetId = requireString(request, "sheetId", () => new cycleCountTypes_js_1.CycleCountSheetNotFoundError("sheetId missing"));
    const partId = requireString(request, "partId", () => new cycleCountTypes_js_1.CycleCountPartInvalidError("partId missing"));
    return deps.db.runTransaction(async (txn) => {
        const now = deps.now();
        if (!(await deps.authorize(txn, actor.id, exports.CYCLE_COUNT_CAPABILITY.create)))
            throw new cycleCountTypes_js_1.UnauthorizedCycleCountError();
        const sheet = await readSheet(txn, deps.db, sheetId);
        const part = await deps.resolvePart(txn, partId);
        if (part === null)
            throw new cycleCountTypes_js_1.CycleCountPartInvalidError("part not found");
        if (part.partId !== partId)
            throw new cycleCountTypes_js_1.CycleCountPartInvalidError("resolved part identity incoherent");
        // D5: a repeat open (or a second scan of the same Part) resolves to the SAME line. No second snapshot.
        // Decided BEFORE the gates on current state (sheet still OPEN, part still ACTIVE): those judge a NEW
        // line, and a retry of an open that already happened is not one.
        const existing = await readLine(txn, deps.db, sheetId, partId);
        if (existing) {
            if (existing.fingerprint !== (0, cycleCountSheetRepository_js_1.fingerprintLine)(partId, part.trackingMode)) {
                throw new cycleCountTypes_js_1.CycleCountIdempotencyConflictError("the part's tracking mode changed after its line opened");
            }
            return openResponse("replayed", existing);
        }
        requireOpen(sheet, "open a line");
        if (part.active !== true)
            throw new cycleCountTypes_js_1.CycleCountPartInvalidError("part is not active");
        if (!cycleCountTypes_js_1.CYCLE_COUNT_SUPPORTED_TRACKING_MODES.includes(part.trackingMode)) {
            throw new cycleCountTypes_js_1.CycleCountPartInvalidError("tracking mode not supported (LOT deferred)");
        }
        const trackingMode = part.trackingMode;
        // Fail closed if the location stopped being countable after the sheet was created.
        if (!(await deps.resolveLocationEligible(txn, sheet.location))) {
            throw new cycleCountTypes_js_1.CycleCountLocationInvalidError("the sheet's location is no longer eligible for counting");
        }
        // D3/D4: the SAME authority for a planned or a discovered Part. Zero only when the authority says zero.
        const expectedSerialNumbers = trackingMode === "SERIAL"
            ? await (0, cycleCountExpectedQuantity_js_1.computeExpectedSerialsThroughTxn)(txn, deps.db, partId, sheet.location)
            : undefined;
        const expectedQuantity = trackingMode === "NONE"
            ? await (0, cycleCountExpectedQuantity_js_1.computeExpectedQuantityThroughTxn)(txn, deps.db, partId, sheet.location)
            : expectedSerialNumbers.length;
        const data = (0, cycleCountSheetRepository_js_1.serializeNewLine)(partId, trackingMode, expectedQuantity, expectedSerialNumbers, actor, now);
        txn.create(lineRef(deps.db, sheetId, partId), data);
        deps.stageAudit(txn, { action: "openCycleCountLine", actorId: actor.id, sheetId, location: sheet.location, partId });
        return {
            outcome: "applied", sheetId, lineId: (0, cycleCountSheetRepository_js_1.cycleCountLineId)(partId), partId, trackingMode,
            status: "OPEN", expectedSnapshotAt: now.getTime(),
        };
    });
}
function openResponse(outcome, line) {
    // Blind: an existing line is described WITHOUT its expected value unless it has already been submitted
    // (in which case the counter has seen it in their own submit response).
    return {
        outcome, sheetId: line.sheetId, lineId: line.lineId, partId: line.partId, trackingMode: line.trackingMode,
        status: line.status, expectedSnapshotAt: line.expectedSnapshotAt,
    };
}
// ================================================================================ submitCycleCountLine
async function submitCycleCountLine(request, deps) {
    const actor = requireActor(deps.actor);
    const sheetId = requireString(request, "sheetId", () => new cycleCountTypes_js_1.CycleCountSheetNotFoundError("sheetId missing"));
    const partId = requireString(request, "partId", () => new cycleCountTypes_js_1.CycleCountPartInvalidError("partId missing"));
    return deps.db.runTransaction(async (txn) => {
        const now = deps.now();
        if (!(await deps.authorize(txn, actor.id, exports.CYCLE_COUNT_CAPABILITY.submit)))
            throw new cycleCountTypes_js_1.UnauthorizedCycleCountError();
        const sheet = await readSheet(txn, deps.db, sheetId);
        // (A COUNTED line only exists on an OPEN sheet -- close needs every line disposed and sheet cancel
        // needs none counted -- so this gate never stands in front of a submit replay.)
        requireOpen(sheet, "submit a count");
        const line = await readLine(txn, deps.db, sheetId, partId);
        if (!line)
            throw new cycleCountTypes_js_1.CycleCountNotFoundError("that part has no line on this sheet -- open it first");
        if (line.status !== "OPEN" && line.status !== "COUNTED")
            throw new cycleCountTypes_js_1.CycleCountStatusInvalidError(`line is ${line.status}; cannot submit a count`);
        const validated = (0, cycleCountValidation_js_1.validateSubmitCycleCountInput)(request, line.trackingMode);
        if (!validated.valid)
            throw new cycleCountTypes_js_1.CycleCountPartInvalidError(`submit input invalid: ${validated.reason}`);
        if (line.trackingMode === "NONE") {
            const countedQuantity = validated.value.countedQuantity;
            if (line.status === "COUNTED") {
                if (line.countedQuantity !== countedQuantity)
                    throw new cycleCountTypes_js_1.CycleCountIdempotencyConflictError("line was already submitted with a different count");
                return submitResponse("replayed", line, { countedQuantity, variance: line.variance });
            }
            const variance = countedQuantity - line.expectedQuantity;
            txn.update(lineRef(deps.db, sheetId, partId), (0, cycleCountSheetRepository_js_1.lineSubmitFields)(line, actor, now, { countedQuantity, variance }));
            deps.stageAudit(txn, { action: "submitCycleCountLine", actorId: actor.id, sheetId, location: sheet.location, partId, variance });
            return submitResponse("applied", line, { countedQuantity, variance });
        }
        const counted = [...validated.value.countedSerialNumbers].sort();
        if (line.status === "COUNTED") {
            const prior = line.countedSerialNumbers ?? [];
            if (prior.length !== counted.length || !prior.every((s) => counted.includes(s))) {
                throw new cycleCountTypes_js_1.CycleCountIdempotencyConflictError("line was already submitted with different serials");
            }
            return submitResponse("replayed", line, { countedSerialNumbers: counted, serialVariance: line.serialVariance });
        }
        const expected = new Set(line.expectedSerialNumbers ?? []);
        const seen = new Set(counted);
        const serialVariance = {
            missing: [...expected].filter((s) => !seen.has(s)).sort(),
            unexpected: counted.filter((s) => !expected.has(s)),
        };
        txn.update(lineRef(deps.db, sheetId, partId), (0, cycleCountSheetRepository_js_1.lineSubmitFields)(line, actor, now, { countedSerialNumbers: counted, serialVariance }));
        deps.stageAudit(txn, { action: "submitCycleCountLine", actorId: actor.id, sheetId, location: sheet.location, partId, serialVariance });
        return submitResponse("applied", line, { countedSerialNumbers: counted, serialVariance });
    });
}
/** THIS line's expected value crosses the wire here, for the first time -- after the count already has. */
function submitResponse(outcome, line, counted) {
    return {
        outcome, sheetId: line.sheetId, lineId: line.lineId, partId: line.partId, status: "COUNTED",
        ...counted,
        expectedQuantity: line.expectedQuantity,
        ...(line.expectedSerialNumbers === undefined ? {} : { expectedSerialNumbers: line.expectedSerialNumbers }),
    };
}
// ================================================================================ reconcileCycleCountLine
/**
 * The atomic unit (D6): read the line, check capability, enforce SoD, check the transition, require the
 * reason, stage that line's ADJUSTED evidence, record the disposition -- one transaction.
 */
async function reconcileCycleCountLine(request, deps) {
    const actor = requireActor(deps.actor);
    const sheetId = requireString(request, "sheetId", () => new cycleCountTypes_js_1.CycleCountSheetNotFoundError("sheetId missing"));
    const partId = requireString(request, "partId", () => new cycleCountTypes_js_1.CycleCountPartInvalidError("partId missing"));
    const v = (0, cycleCountValidation_js_1.validateReconcileCycleCountInput)(request);
    if (!v.valid)
        throw new cycleCountTypes_js_1.CycleCountPartInvalidError(`reconcile input invalid: ${v.reason}`);
    const { reason, decision } = v.value;
    const isReject = decision === "REJECT";
    return deps.db.runTransaction(async (txn) => {
        const now = deps.now();
        const writes = [];
        if (!(await deps.authorize(txn, actor.id, exports.CYCLE_COUNT_CAPABILITY.reconcile)))
            throw new cycleCountTypes_js_1.UnauthorizedCycleCountError();
        const sheet = await readSheet(txn, deps.db, sheetId);
        const line = await readLine(txn, deps.db, sheetId, partId);
        if (!line)
            throw new cycleCountTypes_js_1.CycleCountNotFoundError("that part has no line on this sheet");
        // Replay is decided BEFORE the sheet gate: reconciling the last line and then closing the sheet
        // must not turn a lost-response retry of that reconcile into SHEET_STATUS_INVALID.
        if (line.status === "RECONCILED" || line.status === "REJECTED") {
            // Replay: the decision cannot change, and the evidence it produced must still be there.
            if ((line.status === "REJECTED") !== isReject)
                throw new cycleCountTypes_js_1.CycleCountStatusInvalidError(`line was already ${line.status}; the decision cannot change`);
            // ...and neither can its reason: a different reason under a "replay" would be silently dropped.
            if ((line.reconciliationReason ?? null) !== (reason ?? null)) {
                throw new cycleCountTypes_js_1.CycleCountIdempotencyConflictError("line was already decided with a different reason");
            }
            for (const id of line.ledgerEventIds ?? []) {
                const s = await txn.get(deps.db.collection(collections_js_1.INVENTORY_TRANSACTIONS_COLLECTION).doc(id));
                if (!s.exists)
                    throw new cycleCountTypes_js_1.CycleCountIntegrityError("a decided line's ledger evidence is missing");
            }
            return decisionResponse("replayed", line, line.ledgerEventIds ?? [], line.status, line.reconciliationReason ?? null);
        }
        requireOpen(sheet, "reconcile a line");
        if (line.status !== "COUNTED")
            throw new cycleCountTypes_js_1.CycleCountStatusInvalidError(`line is ${line.status}; submit a count first`);
        const isSerial = line.trackingMode === "SERIAL";
        const discrepancy = isSerial
            ? (line.serialVariance?.missing.length ?? 0) + (line.serialVariance?.unexpected.length ?? 0)
            : Math.abs(line.variance ?? 0);
        if (discrepancy > 0 && !reason)
            throw new cycleCountTypes_js_1.CycleCountReasonRequiredError();
        if (discrepancy > 0) {
            if (!line.submittedBy)
                throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("COUNTED line with a variance has no submittedBy");
            const expectedUnits = isSerial ? (line.expectedSerialNumbers?.length ?? 0) : line.expectedQuantity;
            // D1: THIS line's materiality against THIS line's expected units -- no sheet-level formula.
            if ((0, cycleCountMateriality_js_1.isMaterialCycleCountVariance)(discrepancy, expectedUnits, (0, cycleCountMateriality_js_1.resolveCycleCountMaterialityConfig)()) && actor.id === line.submittedBy) {
                throw new cycleCountTypes_js_1.CycleCountSelfApprovalError();
            }
        }
        const part = await deps.resolvePart(txn, partId);
        if (part === null || part.partId !== partId)
            throw new cycleCountTypes_js_1.CycleCountPartInvalidError("part not found");
        const store = {
            async read(docId) {
                const s = await txn.get(deps.db.collection(collections_js_1.INVENTORY_TRANSACTIONS_COLLECTION).doc(docId));
                return s.exists ? (s.data() ?? {}) : null;
            },
            create(docId, data) {
                writes.push({ ref: deps.db.collection(collections_js_1.INVENTORY_TRANSACTIONS_COLLECTION).doc(docId), data });
            },
        };
        const ledgerEventIds = [];
        const stage = async (ev) => {
            const outcome = await (0, operationalMovementRepository_js_1.stageOperationalMovement)(store, ev, { partId: part.partId, trackingMode: part.trackingMode }, { now });
            if (outcome.outcome !== "applied")
                throw new cycleCountTypes_js_1.CycleCountIntegrityError("adjustment evidence already existed for an undecided line");
            ledgerEventIds.push(outcome.docId);
        };
        const base = {
            type: "ADJUSTED", partId, location: sheet.location,
            sourceObject: { type: "ADJUSTMENT", id: sheetId },
            actor: { kind: actor.kind, id: actor.id }, occurredAt: now.getTime(),
        };
        // REJECT stages nothing: rejecting says the count is not trusted, not that the books move the other way.
        if (!isReject && isSerial) {
            for (const serialNo of line.serialVariance?.missing ?? []) {
                await stage({ ...base, quantity: 1, serialNo, idempotencyKey: ledgerKey(sheetId, partId, "missing", serialNo) });
            }
        }
        else if (!isReject && (line.variance ?? 0) !== 0) {
            await stage({ ...base, quantity: line.variance, idempotencyKey: ledgerKey(sheetId, partId, "adjust") });
        }
        writes.push({ ref: lineRef(deps.db, sheetId, partId), data: (0, cycleCountSheetRepository_js_1.lineDecisionFields)(line, actor, now, decision, reason, ledgerEventIds) });
        deps.stageAudit(txn, {
            action: isReject ? "rejectCycleCountLine" : "reconcileCycleCountLine", actorId: actor.id, sheetId, location: sheet.location, partId,
            ...(isSerial ? { serialVariance: line.serialVariance } : { variance: line.variance }),
        });
        for (const w of writes) {
            if (w.ref.path.startsWith(collections_js_1.INVENTORY_TRANSACTIONS_COLLECTION + "/"))
                txn.create(w.ref, w.data);
            else
                txn.update(w.ref, w.data);
        }
        return decisionResponse("applied", line, ledgerEventIds, isReject ? "REJECTED" : "RECONCILED", reason);
    });
}
function decisionResponse(outcome, line, ledgerEventIds, status, reason) {
    return {
        outcome, sheetId: line.sheetId, lineId: line.lineId, partId: line.partId, status, ledgerEventIds: [...ledgerEventIds],
        ...(reason ? { reconciliationReason: reason } : {}),
    };
}
// ================================================================================ cancel / close
async function cancelCycleCountLine(request, deps) {
    const actor = requireActor(deps.actor);
    const sheetId = requireString(request, "sheetId", () => new cycleCountTypes_js_1.CycleCountSheetNotFoundError("sheetId missing"));
    const partId = requireString(request, "partId", () => new cycleCountTypes_js_1.CycleCountPartInvalidError("partId missing"));
    return deps.db.runTransaction(async (txn) => {
        const now = deps.now();
        if (!(await deps.authorize(txn, actor.id, exports.CYCLE_COUNT_CAPABILITY.cancel)))
            throw new cycleCountTypes_js_1.UnauthorizedCycleCountError();
        const sheet = await readSheet(txn, deps.db, sheetId);
        const line = await readLine(txn, deps.db, sheetId, partId);
        if (!line)
            throw new cycleCountTypes_js_1.CycleCountNotFoundError();
        // Replay first: a cancelled line stays answerable after its sheet is cancelled or closed.
        if (line.status === "CANCELLED")
            return { outcome: "replayed", sheetId, partId, status: "CANCELLED" };
        requireOpen(sheet, "cancel a line");
        if (line.status !== "OPEN")
            throw new cycleCountTypes_js_1.CycleCountStatusInvalidError(`line is ${line.status}; only a line not yet counted can be cancelled`);
        txn.update(lineRef(deps.db, sheetId, partId), (0, cycleCountSheetRepository_js_1.lineCancelFields)(line, actor, now));
        deps.stageAudit(txn, { action: "cancelCycleCountLine", actorId: actor.id, sheetId, location: sheet.location, partId });
        return { outcome: "applied", sheetId, partId, status: "CANCELLED" };
    });
}
async function readAllLines(txn, db, sheetId) {
    const snap = await txn.get(sheetRef(db, sheetId).collection(cycleCountSheetRepository_js_1.CYCLE_COUNT_LINES_SUBCOLLECTION).limit(exports.MAX_LINES_PER_SHEET_TRANSACTION + 1));
    if (snap.size > exports.MAX_LINES_PER_SHEET_TRANSACTION) {
        throw new cycleCountTypes_js_1.CycleCountSheetStatusInvalidError(`sheet has more than ${exports.MAX_LINES_PER_SHEET_TRANSACTION} lines; it cannot change state in one transaction`);
    }
    return snap.docs.map((d) => (0, cycleCountSheetRepository_js_1.deserializeLine)(sheetId, d.id, d.data()));
}
/** OPEN -> CANCELLED, only while no line has been counted. Its open lines are cancelled with it. */
async function cancelCycleCountSheet(request, deps) {
    const actor = requireActor(deps.actor);
    const sheetId = requireString(request, "sheetId", () => new cycleCountTypes_js_1.CycleCountSheetNotFoundError("sheetId missing"));
    return deps.db.runTransaction(async (txn) => {
        const now = deps.now();
        if (!(await deps.authorize(txn, actor.id, exports.CYCLE_COUNT_CAPABILITY.cancel)))
            throw new cycleCountTypes_js_1.UnauthorizedCycleCountError();
        const sheet = await readSheet(txn, deps.db, sheetId);
        if (sheet.status === "CANCELLED")
            return { outcome: "replayed", sheetId, status: "CANCELLED" };
        requireOpen(sheet, "cancel it");
        const lines = await readAllLines(txn, deps.db, sheetId);
        if (lines.some((l) => l.status === "COUNTED" || l.status === "RECONCILED" || l.status === "REJECTED")) {
            throw new cycleCountTypes_js_1.CycleCountSheetStatusInvalidError("a counted sheet cannot be cancelled -- dispose of its lines and close it");
        }
        for (const l of lines.filter((x) => x.status === "OPEN"))
            txn.update(lineRef(deps.db, sheetId, l.partId), (0, cycleCountSheetRepository_js_1.lineCancelFields)(l, actor, now));
        txn.update(sheetRef(deps.db, sheetId), (0, cycleCountSheetRepository_js_1.sheetStatusFields)("CANCELLED", sheet.version + 1, actor, now));
        deps.stageAudit(txn, { action: "cancelCycleCountSheet", actorId: actor.id, sheetId, location: sheet.location });
        return { outcome: "applied", sheetId, status: "CANCELLED" };
    });
}
/** OPEN -> CLOSED, only when every non-cancelled line is RECONCILED or REJECTED (verified here, inside the transaction). */
async function closeCycleCountSheet(request, deps) {
    const actor = requireActor(deps.actor);
    const sheetId = requireString(request, "sheetId", () => new cycleCountTypes_js_1.CycleCountSheetNotFoundError("sheetId missing"));
    return deps.db.runTransaction(async (txn) => {
        const now = deps.now();
        if (!(await deps.authorize(txn, actor.id, exports.CYCLE_COUNT_CAPABILITY.reconcile)))
            throw new cycleCountTypes_js_1.UnauthorizedCycleCountError();
        const sheet = await readSheet(txn, deps.db, sheetId);
        if (sheet.status === "CLOSED")
            return { outcome: "replayed", sheetId, status: "CLOSED" };
        requireOpen(sheet, "close it");
        const lines = await readAllLines(txn, deps.db, sheetId);
        const live = lines.filter((l) => l.status !== "CANCELLED");
        if (live.length === 0)
            throw new cycleCountTypes_js_1.CycleCountSheetStatusInvalidError("a sheet with no counted line is cancelled, not closed");
        if (live.some((l) => l.status !== "RECONCILED" && l.status !== "REJECTED")) {
            throw new cycleCountTypes_js_1.CycleCountSheetStatusInvalidError("every line must be reconciled or rejected before the sheet closes");
        }
        txn.update(sheetRef(deps.db, sheetId), (0, cycleCountSheetRepository_js_1.sheetStatusFields)("CLOSED", sheet.version + 1, actor, now));
        deps.stageAudit(txn, { action: "closeCycleCountSheet", actorId: actor.id, sheetId, location: sheet.location });
        return { outcome: "applied", sheetId, status: "CLOSED" };
    });
}
//# sourceMappingURL=cycleCountSheetCommand.js.map