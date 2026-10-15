"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LaborCommandError = exports.MAX_LABOR_MINUTES = exports.MIN_LABOR_MINUTES = exports.LABOR_RECORDABLE_WO_STATUSES = exports.LABOR_STATUSES = exports.LABOR_ENTRY_KINDS = exports.LABOR_TYPES = exports.LABOR_CORRECT_CAPABILITY = exports.LABOR_RECORD_CAPABILITY = exports.WORK_ORDERS_COLLECTION = exports.LABOR_ENTRIES_COLLECTION = void 0;
exports.workDateOf = workDateOf;
exports.validateLaborRequest = validateLaborRequest;
exports.laborEntryIdFor = laborEntryIdFor;
exports.laborFingerprint = laborFingerprint;
exports.recordWorkOrderLabor = recordWorkOrderLabor;
exports.correctWorkOrderLabor = correctWorkOrderLabor;
exports.projectWorkOrderLabor = projectWorkOrderLabor;
const node_crypto_1 = require("node:crypto");
exports.LABOR_ENTRIES_COLLECTION = "work_order_labor_entries";
exports.WORK_ORDERS_COLLECTION = "fieldops_wos";
/** Recording labor for yourself, on a job that is yours. */
exports.LABOR_RECORD_CAPABILITY = "workOrder.labor.record";
/** Correcting a labor entry -- including somebody else's. A separate authority on purpose. */
exports.LABOR_CORRECT_CAPABILITY = "workOrder.labor.correct";
/**
 * The smallest vocabulary that is still truthful.
 *
 * ONSITE is the work. TRAVEL is time the technician spent getting there, which is real labor, is not
 * onsite work, and is the one distinction field service asks for first.
 *
 * Everything else a payroll system eventually wants -- shop, warranty rework, training, non-job --
 * is deliberately absent. An enum invented ahead of the business decision produces categories nobody
 * defined and reports nobody trusts. Extensible: adding a member is additive, and the union is the
 * only place it can be added.
 */
exports.LABOR_TYPES = Object.freeze(["ONSITE", "TRAVEL"]);
exports.LABOR_ENTRY_KINDS = Object.freeze(["INTERVAL", "DURATION"]);
/**
 * ACTIVE counts. REVERSED does not, and still exists.
 *
 * A correction never deletes. The original entry stays readable with its own author and timestamps,
 * marked REVERSED and pointing at what replaced it -- so "why does this job show six hours when it
 * used to show eight" has an answer that does not require a backup.
 */
exports.LABOR_STATUSES = Object.freeze(["ACTIVE", "REVERSED"]);
/**
 * Work Order states that accept NEW labor.
 *
 * The execution states -- a technician is on site, or travelling to it. A terminal Work Order takes
 * no new labor: recording time against a closed job is a correction, and corrections go through the
 * correction authority where somebody accountable can see them.
 */
exports.LABOR_RECORDABLE_WO_STATUSES = Object.freeze(["ACCEPTED", "EN_ROUTE", "ARRIVED", "WORK_IN_PROGRESS"]);
/**
 * Technical bounds, NOT HR policy.
 *
 * Sixteen hours is not a shift limit anybody has ratified -- it is the point past which a single
 * unbroken labor entry is more likely a typo or a timer left running than a fact. One minute is the
 * smallest unit worth recording. Both are here to stop nonsense reaching the ledger, and neither
 * decides what a working day is.
 */
exports.MIN_LABOR_MINUTES = 1;
exports.MAX_LABOR_MINUTES = 16 * 60;
class LaborCommandError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "LaborCommandError";
    }
}
exports.LaborCommandError = LaborCommandError;
const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v) => (typeof v === "string" && v.trim() !== "" ? v : null);
const int = (v) => typeof v === "number" && Number.isInteger(v) && Number.isFinite(v) ? v : null;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Everything a caller may send. `technicianId` is absent: you record labor for yourself. */
const ALLOWED_KEYS = new Set([
    "workOrderId", "laborType", "entryKind",
    "startedAtMillis", "endedAtMillis", "workDate", "durationMinutes",
    "notes", "idempotencyKey", "deviceReportedAtMillis",
]);
/** The date an interval belongs to, in UTC, so the same interval always lands on the same day. */
function workDateOf(millis) {
    return new Date(millis).toISOString().slice(0, 10);
}
function validateLaborRequest(input) {
    if (!isPlainObject(input))
        throw new LaborCommandError("REQUEST_INVALID", "request is not an object");
    for (const k of Object.keys(input)) {
        if (!ALLOWED_KEYS.has(k)) {
            throw new LaborCommandError("REQUEST_INVALID", `unknown field ${k}` + (k === "technicianId" || k === "actorUid"
                ? " -- labor is recorded for the authenticated technician, never for somebody named in the payload" : ""));
        }
    }
    const workOrderId = str(input.workOrderId);
    const idempotencyKey = str(input.idempotencyKey);
    if (!workOrderId)
        throw new LaborCommandError("REQUEST_INVALID", "workOrderId required");
    if (!idempotencyKey)
        throw new LaborCommandError("REQUEST_INVALID", "idempotencyKey required");
    const laborType = str(input.laborType);
    if (!laborType || !exports.LABOR_TYPES.includes(laborType)) {
        throw new LaborCommandError("REQUEST_INVALID", `laborType must be one of ${exports.LABOR_TYPES.join(", ")}`);
    }
    const entryKind = str(input.entryKind);
    if (!entryKind || !exports.LABOR_ENTRY_KINDS.includes(entryKind)) {
        throw new LaborCommandError("REQUEST_INVALID", `entryKind must be one of ${exports.LABOR_ENTRY_KINDS.join(", ")}`);
    }
    const notes = input.notes === undefined ? undefined : str(input.notes);
    if (input.notes !== undefined && !notes) {
        throw new LaborCommandError("REQUEST_INVALID", "notes must be a non-empty string when present");
    }
    let deviceReportedAtMillis;
    if (input.deviceReportedAtMillis !== undefined) {
        const parsed = int(input.deviceReportedAtMillis);
        if (parsed === null) {
            throw new LaborCommandError("REQUEST_INVALID", "deviceReportedAtMillis must be an integer");
        }
        deviceReportedAtMillis = parsed;
    }
    if (entryKind === "INTERVAL") {
        const startedAtMillis = int(input.startedAtMillis);
        const endedAtMillis = int(input.endedAtMillis);
        if (startedAtMillis === null || endedAtMillis === null) {
            throw new LaborCommandError("INTERVAL_INVALID", "an INTERVAL entry needs startedAtMillis and endedAtMillis");
        }
        if (input.durationMinutes !== undefined || input.workDate !== undefined) {
            // The duration IS the interval. Accepting both invites two answers that disagree.
            throw new LaborCommandError("INTERVAL_INVALID", "an INTERVAL entry derives its duration and work date; do not supply them");
        }
        if (endedAtMillis <= startedAtMillis) {
            throw new LaborCommandError("INTERVAL_INVALID", "labor cannot end before or when it started");
        }
        const durationMinutes = Math.round((endedAtMillis - startedAtMillis) / 60000);
        assertDurationInBounds(durationMinutes);
        return {
            workOrderId, laborType, entryKind, idempotencyKey,
            startedAtMillis, endedAtMillis, durationMinutes,
            workDate: workDateOf(startedAtMillis),
            ...(notes ? { notes } : {}),
            ...(deviceReportedAtMillis !== undefined ? { deviceReportedAtMillis } : {}),
        };
    }
    // DURATION: a length and the day it belongs to. NO clock position is invented to fill an interval.
    const durationMinutes = int(input.durationMinutes);
    const workDate = str(input.workDate);
    if (durationMinutes === null) {
        throw new LaborCommandError("DURATION_INVALID", "a DURATION entry needs durationMinutes");
    }
    if (!workDate || !ISO_DATE.test(workDate)) {
        throw new LaborCommandError("DURATION_INVALID", "a DURATION entry needs workDate as YYYY-MM-DD");
    }
    if (input.startedAtMillis !== undefined || input.endedAtMillis !== undefined) {
        throw new LaborCommandError("DURATION_INVALID", "a DURATION entry has no clock position; supply an INTERVAL entry if the times are known");
    }
    assertDurationInBounds(durationMinutes);
    return {
        workOrderId, laborType, entryKind, idempotencyKey, durationMinutes, workDate,
        ...(notes ? { notes } : {}),
        ...(deviceReportedAtMillis !== undefined ? { deviceReportedAtMillis } : {}),
    };
}
function assertDurationInBounds(minutes) {
    if (minutes < exports.MIN_LABOR_MINUTES) {
        throw new LaborCommandError("DURATION_INVALID", `labor must be at least ${exports.MIN_LABOR_MINUTES} minute`);
    }
    if (minutes > exports.MAX_LABOR_MINUTES) {
        // Not an HR rule. A single unbroken entry this long is a typo or a timer left running.
        throw new LaborCommandError("DURATION_INVALID", `a single labor entry of ${minutes} minutes exceeds the ${exports.MAX_LABOR_MINUTES}-minute technical bound; split it or correct the times`);
    }
}
/** `create` on a derived id IS the idempotency check -- Firestore rejects a duplicate in-transaction. */
function laborEntryIdFor(idempotencyKey) {
    return "lab_" + (0, node_crypto_1.createHash)("sha256")
        .update(JSON.stringify(["workOrderLabor", idempotencyKey])).digest("hex").slice(0, 40);
}
/** What the stored request meant, so a replay can be told from a conflicting reuse of the key. */
function laborFingerprint(req, technicianId) {
    return (0, node_crypto_1.createHash)("sha256").update(JSON.stringify([
        req.workOrderId, technicianId, req.laborType, req.entryKind,
        req.durationMinutes, req.workDate, req.startedAtMillis ?? null, req.endedAtMillis ?? null,
    ])).digest("hex").slice(0, 16);
}
async function readWorkOrder(db, txn, workOrderId) {
    const snap = await txn.get(db.collection(exports.WORK_ORDERS_COLLECTION).doc(workOrderId));
    if (!snap.exists)
        throw new LaborCommandError("WORK_ORDER_NOT_FOUND", `work order ${workOrderId} not found`);
    const d = snap.data() ?? {};
    return { status: str(d.status) ?? "", assignedTechId: str(d.assignedTechId) };
}
/**
 * Record labor the authenticated technician performed.
 *
 * FOR THEMSELVES, ALWAYS. There is no technicianId in the request, and one in the payload is
 * refused rather than ignored -- entering time on somebody else's behalf is a different act with
 * different accountability, and it is not this command.
 */
async function recordWorkOrderLabor(request, deps) {
    const actor = deps.actor;
    if (!isPlainObject(actor) || actor.kind !== "USER" || !str(actor.id)) {
        throw new LaborCommandError("PERMISSION_DENIED", "trusted actor context missing");
    }
    const req = validateLaborRequest(request);
    if (!(await deps.authorize(null, actor.id, exports.LABOR_RECORD_CAPABILITY))) {
        throw new LaborCommandError("PERMISSION_DENIED", "actor is not authorized to record labor");
    }
    const technicianId = str(actor.technicianId);
    if (!technicianId) {
        // A principal with the capability but no technician identity has nobody to record labor FOR.
        throw new LaborCommandError("NOT_ASSIGNED_TECHNICIAN", "this principal is not linked to a technician, so there is nobody to record labor for");
    }
    const entryId = laborEntryIdFor(req.idempotencyKey);
    const fingerprint = laborFingerprint(req, technicianId);
    const entryRef = deps.db.collection(exports.LABOR_ENTRIES_COLLECTION).doc(entryId);
    return deps.db.runTransaction(async (txn) => {
        const now = deps.now();
        // ---- IDEMPOTENCY, read first. A phone on a bad connection retries; hours must not double.
        const existingSnap = await txn.get(entryRef);
        if (existingSnap.exists) {
            const existing = existingSnap.data() ?? {};
            if (existing.fingerprint !== fingerprint) {
                throw new LaborCommandError("IDEMPOTENCY_CONFLICT", "this idempotency key was already used for a different labor entry");
            }
            return {
                outcome: "replayed",
                laborEntryId: entryId, workOrderId: req.workOrderId, technicianId,
                durationMinutes: req.durationMinutes, laborType: req.laborType,
                entryKind: req.entryKind, workDate: req.workDate,
            };
        }
        // ---- AUTHORIZATION AGAINST THE JOB, through the transaction.
        if (!(await deps.authorize(txn, actor.id, exports.LABOR_RECORD_CAPABILITY))) {
            throw new LaborCommandError("PERMISSION_DENIED", "actor is not authorized to record labor");
        }
        const wo = await readWorkOrder(deps.db, txn, req.workOrderId);
        if (wo.assignedTechId !== technicianId) {
            throw new LaborCommandError("NOT_ASSIGNED_TECHNICIAN", "labor may only be recorded on a work order assigned to you");
        }
        if (!exports.LABOR_RECORDABLE_WO_STATUSES.includes(wo.status)) {
            throw new LaborCommandError("WORK_ORDER_STATE_INVALID", `work order is ${wo.status}; new labor may only be recorded while the job is being executed`);
        }
        // ---- OVERLAP, for INTERVAL entries only.
        //
        // A DURATION entry has no clock position, so it CANNOT be checked -- and pretending otherwise
        // would be the schema lying about what it knows. Stated here rather than silently skipped.
        if (req.entryKind === "INTERVAL") {
            const sameDay = await txn.get(deps.db.collection(exports.LABOR_ENTRIES_COLLECTION)
                .where("technicianId", "==", technicianId)
                .where("workDate", "==", req.workDate)
                .where("status", "==", "ACTIVE"));
            for (const doc of sameDay.docs) {
                const e = doc.data() ?? {};
                if (e.entryKind !== "INTERVAL")
                    continue;
                const s = int(e.startedAtMillis), en = int(e.endedAtMillis);
                if (s === null || en === null)
                    continue;
                if (req.startedAtMillis < en && s < req.endedAtMillis) {
                    throw new LaborCommandError("OVERLAPPING_ENTRY", `this time overlaps labor entry ${doc.id}; one technician cannot be in two places at once`);
                }
            }
        }
        txn.create(entryRef, {
            schemaVersion: 1,
            laborEntryId: entryId,
            workOrderId: req.workOrderId,
            technicianId,
            // The PRINCIPAL as well as the technician identity: one is who the platform authenticated, the
            // other is who the work order is assigned to, and an investigation may need either.
            recordedByUid: actor.id,
            laborType: req.laborType,
            entryKind: req.entryKind,
            durationMinutes: req.durationMinutes,
            workDate: req.workDate,
            ...(req.startedAtMillis !== undefined ? { startedAtMillis: req.startedAtMillis } : {}),
            ...(req.endedAtMillis !== undefined ? { endedAtMillis: req.endedAtMillis } : {}),
            ...(req.notes ? { notes: req.notes } : {}),
            status: "ACTIVE",
            fingerprint,
            idempotencyKey: req.idempotencyKey,
            // TWO TIMESTAMPS, AND THEY ARE NOT THE SAME FACT.
            //
            // `recordedAtMillis` is the server's: when the platform accepted this. `deviceReportedAtMillis`
            // is what the phone said, present only when the phone said something -- typically because the
            // entry was captured offline hours earlier.
            //
            // A device clock is not an accounting authority. It can be wrong, and it can be set. But
            // rewriting the work time to the sync time would be worse: it would move real work to the
            // moment the signal came back. So both are kept, neither is overwritten, and anything that
            // later needs to reason about the difference can see it.
            recordedAtMillis: now.getTime(),
            ...(req.deviceReportedAtMillis !== undefined ? { deviceReportedAtMillis: req.deviceReportedAtMillis } : {}),
        });
        deps.stageAudit(txn, {
            actorId: actor.id, laborEntryId: entryId, workOrderId: req.workOrderId, technicianId,
            laborType: req.laborType, durationMinutes: req.durationMinutes, workDate: req.workDate,
            action: "record",
        });
        return {
            outcome: "recorded",
            laborEntryId: entryId, workOrderId: req.workOrderId, technicianId,
            durationMinutes: req.durationMinutes, laborType: req.laborType,
            entryKind: req.entryKind, workDate: req.workDate,
        };
    });
}
/**
 * Correct a labor entry by REVERSING it and recording what it should have been.
 *
 * Never an overwrite. The original keeps its author, its timestamps and its values, and gains
 * `status: REVERSED` plus a pointer to the replacement -- so a total that changed can always be
 * explained, by whom and when, without a backup.
 *
 * A separate capability from recording, because correcting somebody else's recorded time is a
 * different act with different accountability. A technician fixing their own typo and a manager
 * adjusting a crew's hours are not the same authority even when the keystrokes match.
 */
async function correctWorkOrderLabor(request, deps) {
    const actor = deps.actor;
    if (!isPlainObject(actor) || actor.kind !== "USER" || !str(actor.id)) {
        throw new LaborCommandError("PERMISSION_DENIED", "trusted actor context missing");
    }
    if (!isPlainObject(request))
        throw new LaborCommandError("REQUEST_INVALID", "request is not an object");
    const correctsLaborEntryId = str(request.correctsLaborEntryId);
    if (!correctsLaborEntryId) {
        throw new LaborCommandError("REQUEST_INVALID", "correctsLaborEntryId required");
    }
    const { correctsLaborEntryId: _drop, ...rest } = request;
    const req = validateLaborRequest(rest);
    if (!(await deps.authorize(null, actor.id, exports.LABOR_CORRECT_CAPABILITY))) {
        throw new LaborCommandError("PERMISSION_DENIED", "actor is not authorized to correct labor");
    }
    const entryId = laborEntryIdFor(req.idempotencyKey);
    const originalRef = deps.db.collection(exports.LABOR_ENTRIES_COLLECTION).doc(correctsLaborEntryId);
    const replacementRef = deps.db.collection(exports.LABOR_ENTRIES_COLLECTION).doc(entryId);
    return deps.db.runTransaction(async (txn) => {
        const now = deps.now();
        const originalSnap = await txn.get(originalRef);
        if (!originalSnap.exists) {
            throw new LaborCommandError("ENTRY_NOT_FOUND", `labor entry ${correctsLaborEntryId} not found`);
        }
        const original = originalSnap.data() ?? {};
        if (original.status === "REVERSED") {
            // Correcting a correction chains forward from the CURRENT entry, not back through history.
            throw new LaborCommandError("ENTRY_ALREADY_REVERSED", `labor entry ${correctsLaborEntryId} was already corrected; correct its replacement instead`);
        }
        const technicianId = str(original.technicianId);
        if (!technicianId)
            throw new LaborCommandError("ENTRY_NOT_FOUND", "the original entry names no technician");
        const existingSnap = await txn.get(replacementRef);
        const fingerprint = laborFingerprint(req, technicianId);
        if (existingSnap.exists) {
            if ((existingSnap.data() ?? {}).fingerprint !== fingerprint) {
                throw new LaborCommandError("IDEMPOTENCY_CONFLICT", "this idempotency key was already used for a different correction");
            }
            return {
                outcome: "replayed",
                laborEntryId: entryId, reversedLaborEntryId: correctsLaborEntryId,
                workOrderId: req.workOrderId, technicianId,
                durationMinutes: req.durationMinutes, laborType: req.laborType,
                entryKind: req.entryKind, workDate: req.workDate,
            };
        }
        // The corrected entry keeps the ORIGINAL technician. A correction fixes what was recorded, it
        // does not move labor from one person to another -- that would be two facts wearing one hat.
        txn.create(replacementRef, {
            schemaVersion: 1,
            laborEntryId: entryId,
            workOrderId: req.workOrderId,
            technicianId,
            recordedByUid: actor.id,
            laborType: req.laborType,
            entryKind: req.entryKind,
            durationMinutes: req.durationMinutes,
            workDate: req.workDate,
            ...(req.startedAtMillis !== undefined ? { startedAtMillis: req.startedAtMillis } : {}),
            ...(req.endedAtMillis !== undefined ? { endedAtMillis: req.endedAtMillis } : {}),
            ...(req.notes ? { notes: req.notes } : {}),
            status: "ACTIVE",
            correctsLaborEntryId,
            fingerprint,
            idempotencyKey: req.idempotencyKey,
            recordedAtMillis: now.getTime(),
        });
        // The original is MARKED, never removed.
        txn.update(originalRef, {
            status: "REVERSED",
            reversedByLaborEntryId: entryId,
            reversedByUid: actor.id,
            reversedAtMillis: now.getTime(),
        });
        deps.stageAudit(txn, {
            actorId: actor.id, laborEntryId: entryId, workOrderId: req.workOrderId, technicianId,
            laborType: req.laborType, durationMinutes: req.durationMinutes, workDate: req.workDate,
            action: "correct", correctsLaborEntryId,
        });
        return {
            outcome: "recorded",
            laborEntryId: entryId, reversedLaborEntryId: correctsLaborEntryId,
            workOrderId: req.workOrderId, technicianId,
            durationMinutes: req.durationMinutes, laborType: req.laborType,
            entryKind: req.entryKind, workDate: req.workDate,
        };
    });
}
/**
 * The Work Order's labor totals — a PROJECTION, derived on read.
 *
 * `workOrder.laborHours` is not written by this domain and must not become the source of truth: a
 * denormalised total drifts from the entries the moment a correction lands, and then two numbers
 * disagree with nobody able to say which is right.
 *
 * REVERSED entries are excluded from the totals and are still returned, because "what did this job
 * cost in time" and "what was recorded and later corrected" are different questions.
 */
function projectWorkOrderLabor(entries) {
    let totalMinutes = 0, onsiteMinutes = 0, travelMinutes = 0, activeEntries = 0, reversedEntries = 0;
    for (const e of Array.isArray(entries) ? entries : []) {
        const minutes = int(e?.durationMinutes) ?? 0;
        if (e?.status === "REVERSED") {
            reversedEntries += 1;
            continue;
        }
        if (e?.status !== "ACTIVE")
            continue;
        activeEntries += 1;
        totalMinutes += minutes;
        if (e.laborType === "ONSITE")
            onsiteMinutes += minutes;
        else if (e.laborType === "TRAVEL")
            travelMinutes += minutes;
    }
    return { totalMinutes, onsiteMinutes, travelMinutes, activeEntries, reversedEntries };
}
//# sourceMappingURL=workOrderLaborCommand.js.map