"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readWorkOrderLabor = exports.recordWorkOrderLabor = exports.workDateOf = exports.LABOR_READ_MAX = exports.MAX_LABOR_KEY = exports.MAX_LABOR_NOTES = exports.MAX_LABOR_MINUTES = exports.MIN_LABOR_MINUTES = exports.LABOR_RECORDABLE_WO_STATUSES = exports.LABOR_ENTRY_KINDS = exports.LABOR_TYPES = exports.WORK_ORDER_LABOR_RECORD = exports.WORK_ORDER_LABOR_CORRECT = void 0;
exports.validateLaborRequest = validateLaborRequest;
exports.laborFingerprint = laborFingerprint;
const workOrderQuarantine_1 = require("./workOrderQuarantine");
const node_crypto_1 = require("node:crypto");
const contextualAuthorization_1 = require("./contextualAuthorization");
const workOrderLifecycle_1 = require("./workOrderLifecycle");
const workOrderExecution_1 = require("./workOrderExecution");
const workOrderRecordRead_1 = require("./workOrderRecordRead");
const SCHEMA = "eos_ops";
/** Correcting a labor entry -- including somebody else's. Registered by 1764330000000 with NO grant. */
exports.WORK_ORDER_LABOR_CORRECT = "workOrder.labor.correctEntry";
/** Recording your own time on your own job: the technician's existing field-fact authority. */
exports.WORK_ORDER_LABOR_RECORD = workOrderExecution_1.WORK_ORDER_EXECUTION_RECORD;
exports.LABOR_TYPES = Object.freeze(["ONSITE", "TRAVEL"]);
exports.LABOR_ENTRY_KINDS = Object.freeze(["INTERVAL", "DURATION"]);
exports.LABOR_RECORDABLE_WO_STATUSES = Object.freeze(["ACCEPTED", "EN_ROUTE", "ARRIVED", "WORK_IN_PROGRESS"]);
exports.MIN_LABOR_MINUTES = 1;
exports.MAX_LABOR_MINUTES = 16 * 60;
exports.MAX_LABOR_NOTES = 2000;
exports.MAX_LABOR_KEY = 150;
/** How many entries one Work Order read returns. Totals are computed over ALL entries regardless. */
exports.LABOR_READ_MAX = 200;
const refuse = (code, category, message) => {
    throw new workOrderLifecycle_1.WorkOrderLifecycleError(code, category, message);
};
const ID_SHAPE = (v) => typeof v === "string" && v !== "" && v.trim() === v && v.length <= 200 && !v.includes("/");
const int = (v) => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_KEYS = new Set([
    "workOrderId", "laborType", "entryKind", "startedAtMillis", "endedAtMillis", "workDate", "durationMinutes",
    "notes", "idempotencyKey", "deviceReportedAtMillis", "correctsLaborEntryId",
]);
/** Keys that would name WHOSE time this is. Refused with a reason, never silently dropped. */
const SUBJECT_KEYS = new Set(["technicianId", "employeeId", "actorUid", "principalId"]);
/** The UTC date an interval belongs to, so the same interval always lands on the same day (Firebase parity). */
const workDateOf = (millis) => new Date(millis).toISOString().slice(0, 10);
exports.workDateOf = workDateOf;
function assertDurationInBounds(minutes) {
    if (minutes < exports.MIN_LABOR_MINUTES)
        refuse("DURATION_INVALID", "INVALID_INPUT", `labor must be at least ${exports.MIN_LABOR_MINUTES} minute`);
    if (minutes > exports.MAX_LABOR_MINUTES) {
        refuse("DURATION_INVALID", "INVALID_INPUT", `a single labor entry of ${minutes} minutes exceeds the ${exports.MAX_LABOR_MINUTES}-minute technical bound; split it or correct the times`);
    }
}
/** Validate one labor request. Pure. */
function validateLaborRequest(input) {
    if (!input || typeof input !== "object" || Array.isArray(input))
        refuse("REQUEST_INVALID", "INVALID_INPUT", "request is not an object");
    const d = input;
    for (const k of Object.keys(d)) {
        if (SUBJECT_KEYS.has(k)) {
            refuse("REQUEST_INVALID", "INVALID_INPUT", `unknown field ${k} -- labor is recorded for the caller's own governed Employee, never for somebody named in the payload`);
        }
    }
    const extra = Object.keys(d).filter((k) => !ALLOWED_KEYS.has(k));
    if (extra.length > 0)
        refuse("INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT", `this command does not accept: ${extra.sort().join(", ")}`);
    if (!ID_SHAPE(d.workOrderId))
        refuse("WORK_ORDER_ID_INVALID", "INVALID_INPUT", "a workOrderId is required");
    if (typeof d.idempotencyKey !== "string" || d.idempotencyKey.trim() === "" || d.idempotencyKey.length > exports.MAX_LABOR_KEY) {
        refuse("IDEMPOTENCY_KEY_REQUIRED", "INVALID_INPUT", `an idempotencyKey of at most ${exports.MAX_LABOR_KEY} characters is required`);
    }
    const laborType = d.laborType;
    if (!exports.LABOR_TYPES.includes(laborType)) {
        refuse("REQUEST_INVALID", "INVALID_INPUT", `laborType must be one of ${exports.LABOR_TYPES.join(", ")}`);
    }
    const entryKind = d.entryKind;
    if (!exports.LABOR_ENTRY_KINDS.includes(entryKind)) {
        refuse("REQUEST_INVALID", "INVALID_INPUT", `entryKind must be one of ${exports.LABOR_ENTRY_KINDS.join(", ")}`);
    }
    let notes = null;
    if (d.notes !== undefined && d.notes !== null) {
        if (typeof d.notes !== "string" || d.notes.trim() === "" || d.notes.length > exports.MAX_LABOR_NOTES) {
            refuse("REQUEST_INVALID", "INVALID_INPUT", `notes must be a non-empty string of at most ${exports.MAX_LABOR_NOTES} characters when present`);
        }
        notes = d.notes.trim();
    }
    let deviceReportedAtMillis = null;
    if (d.deviceReportedAtMillis !== undefined && d.deviceReportedAtMillis !== null) {
        deviceReportedAtMillis = int(d.deviceReportedAtMillis);
        if (deviceReportedAtMillis === null || deviceReportedAtMillis < 0) {
            refuse("REQUEST_INVALID", "INVALID_INPUT", "deviceReportedAtMillis must be a non-negative integer");
        }
    }
    let correctsLaborEntryId = null;
    if (d.correctsLaborEntryId !== undefined && d.correctsLaborEntryId !== null) {
        if (!ID_SHAPE(d.correctsLaborEntryId))
            refuse("REQUEST_INVALID", "INVALID_INPUT", "correctsLaborEntryId must be a labor entry id");
        correctsLaborEntryId = d.correctsLaborEntryId;
    }
    const common = {
        workOrderId: d.workOrderId, laborType, entryKind, idempotencyKey: d.idempotencyKey.trim(),
        notes, deviceReportedAtMillis, correctsLaborEntryId,
    };
    if (entryKind === "INTERVAL") {
        const startedAtMillis = int(d.startedAtMillis);
        const endedAtMillis = int(d.endedAtMillis);
        if (startedAtMillis === null || endedAtMillis === null || startedAtMillis < 0) {
            refuse("INTERVAL_INVALID", "INVALID_INPUT", "an INTERVAL entry needs startedAtMillis and endedAtMillis");
        }
        if (d.durationMinutes !== undefined || d.workDate !== undefined) {
            // The duration IS the interval. Accepting both invites two answers that disagree.
            refuse("INTERVAL_INVALID", "INVALID_INPUT", "an INTERVAL entry derives its duration and work date; do not supply them");
        }
        if (endedAtMillis <= startedAtMillis) {
            refuse("INTERVAL_INVALID", "INVALID_INPUT", "labor cannot end before or when it started");
        }
        const durationMinutes = Math.round((endedAtMillis - startedAtMillis) / 60000);
        assertDurationInBounds(durationMinutes);
        return Object.freeze({ ...common, startedAtMillis, endedAtMillis, durationMinutes, workDate: (0, exports.workDateOf)(startedAtMillis) });
    }
    // DURATION: a length and the day it belongs to. NO clock position is invented to fill an interval.
    const durationMinutes = int(d.durationMinutes);
    if (durationMinutes === null)
        refuse("DURATION_INVALID", "INVALID_INPUT", "a DURATION entry needs durationMinutes");
    const workDate = d.workDate;
    if (typeof workDate !== "string" || !ISO_DATE.test(workDate) || Number.isNaN(Date.parse(`${workDate}T00:00:00Z`))
        || (0, exports.workDateOf)(Date.parse(`${workDate}T00:00:00Z`)) !== workDate) {
        refuse("DURATION_INVALID", "INVALID_INPUT", "a DURATION entry needs workDate as a real YYYY-MM-DD date");
    }
    if (d.startedAtMillis !== undefined || d.endedAtMillis !== undefined) {
        refuse("DURATION_INVALID", "INVALID_INPUT", "a DURATION entry has no clock position; supply an INTERVAL entry if the times are known");
    }
    assertDurationInBounds(durationMinutes);
    return Object.freeze({ ...common, startedAtMillis: null, endedAtMillis: null, durationMinutes: durationMinutes, workDate: workDate });
}
/**
 * What the request MEANT, so a replay is told from a conflicting reuse. Firebase parity: notes and the device's
 * clock are not part of it (a retry that re-typed a note is still the same hours).
 */
function laborFingerprint(r, employeeId) {
    return (0, node_crypto_1.createHash)("sha256").update(JSON.stringify([
        r.workOrderId, employeeId, r.laborType, r.entryKind, r.durationMinutes, r.workDate,
        r.startedAtMillis, r.endedAtMillis, r.correctsLaborEntryId,
    ])).digest("hex");
}
const resultOf = (outcome, r) => Object.freeze({
    outcome,
    action: r.corrects_entry_id ? "CORRECT" : "RECORD",
    laborEntryId: String(r.id), workOrderId: String(r.work_order_id), employeeId: String(r.employee_id),
    laborType: r.labor_type, entryKind: r.entry_kind,
    durationMinutes: Number(r.duration_minutes), workDate: dateOnly(r.work_date),
    correctsLaborEntryId: r.corrects_entry_id ?? null,
});
const dateOnly = (v) => {
    if (v === null || v === undefined)
        return null;
    if (typeof v === "string")
        return v.slice(0, 10);
    const d = v;
    // node-pg hands a DATE back as a local-midnight Date; format it in LOCAL time so the calendar day survives.
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const ENTRY_COLUMNS = `id, work_order_id, employee_id, labor_type, entry_kind, duration_minutes, to_char(work_date, 'YYYY-MM-DD') AS work_date,
  started_at, ended_at, notes, corrects_entry_id, recorded_by_principal_id, recorded_at, device_reported_at, request_fingerprint`;
async function insertEntry(client, tenantId, principalId, employeeId, r, fingerprint, now) {
    const { rows } = await client.query(`INSERT INTO ${SCHEMA}.work_order_labor_entries
       (id, tenant_id, work_order_id, employee_id, recorded_by_principal_id, labor_type, entry_kind, duration_minutes, work_date,
        started_at, ended_at, notes, corrects_entry_id, idempotency_key, request_fingerprint, recorded_at, device_reported_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING ${ENTRY_COLUMNS}`, [`wol_${(0, node_crypto_1.randomUUID)()}`, tenantId, r.workOrderId, employeeId, principalId, r.laborType, r.entryKind, r.durationMinutes, r.workDate,
        r.startedAtMillis === null ? null : new Date(r.startedAtMillis), r.endedAtMillis === null ? null : new Date(r.endedAtMillis),
        r.notes, r.correctsLaborEntryId, r.idempotencyKey, fingerprint, now,
        r.deviceReportedAtMillis === null ? null : new Date(r.deviceReportedAtMillis)]);
    return rows[0];
}
async function priorByKey(client, tenantId, principalId, key) {
    const { rows } = await client.query(`SELECT ${ENTRY_COLUMNS} FROM ${SCHEMA}.work_order_labor_entries
      WHERE tenant_id = $1 AND recorded_by_principal_id = $2 AND idempotency_key = $3`, [tenantId, principalId, key]);
    return rows[0];
}
/** Run one labor write in a transaction; a unique-violation race is reported as a retryable CONFLICT. */
async function inTransaction(pool, fn) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const out = await fn(client);
        await client.query("COMMIT");
        return out;
    }
    catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        if (err?.code === "23505") {
            if (err.constraint === "wo_labor_corrected_once") {
                refuse("ENTRY_ALREADY_REVERSED", "CONFLICT", "that labor entry was corrected concurrently; correct its replacement instead");
            }
            refuse("LABOR_CONCURRENT_CHANGE", "CONFLICT", "the same request was recorded concurrently; retry to read its outcome");
        }
        throw err;
    }
    finally {
        client.release();
    }
}
/** RECORD: the caller's OWN time, on their OWN assigned, executing Work Order. */
async function recordOwnLabor(deps, actor, input) {
    const workOrderId = input.workOrderId;
    if (!ID_SHAPE(workOrderId))
        refuse("WORK_ORDER_ID_INVALID", "INVALID_INPUT", "a workOrderId is required");
    // CAPABILITY, THEN OWN ASSIGNMENT -- before the body is interpreted any further (the execution command's order).
    const decision = await (0, contextualAuthorization_1.authorizeObjectAction)(deps.reader, {
        actor: { tenantId: actor.tenantId, principalId: actor.principalId, capabilities: actor.capabilities },
        capabilityKey: exports.WORK_ORDER_LABOR_RECORD,
        predicates: (0, workOrderLifecycle_1.lifecycleContextPredicates)(workOrderLifecycle_1.WORK_ORDER_LIFECYCLE_COMPLETE),
        record: { recordKind: "workOrder", recordId: workOrderId },
    });
    if (!decision.allowed) {
        refuse(decision.reason, "FORBIDDEN", decision.reason === "CAPABILITY_MISSING"
            ? `recording labor requires ${exports.WORK_ORDER_LABOR_RECORD}`
            : "labor may only be recorded by the Employee this Work Order is assigned to");
    }
    const request = validateLaborRequest(input);
    const employeeId = await deps.reader.linkedEmployeeId(actor.tenantId, actor.principalId);
    if (!employeeId)
        refuse("EMPLOYEE_LINK_REQUIRED", "FORBIDDEN", "this Principal is not linked to an eligible Employee");
    const fingerprint = laborFingerprint(request, employeeId);
    const now = (deps.now ?? (() => new Date()))();
    return inTransaction(deps.pool, async (client) => {
        const wo = await client.query(`SELECT status::text AS status FROM ${SCHEMA}.work_orders WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [actor.tenantId, request.workOrderId]);
        if (wo.rows.length === 0)
            refuse("WORK_ORDER_NOT_FOUND", "NOT_FOUND", "the Work Order does not exist in this tenant");
        if (await (0, workOrderQuarantine_1.isQuarantined)(client, actor.tenantId, request.workOrderId))
            refuse(workOrderQuarantine_1.WORK_ORDER_QUARANTINED, "PRECONDITION_FAILED", workOrderQuarantine_1.WORK_ORDER_QUARANTINED_MESSAGE);
        // IDEMPOTENCY, read first: a phone on a bad connection retries; hours must not double.
        const prior = await priorByKey(client, actor.tenantId, actor.principalId, request.idempotencyKey);
        if (prior) {
            if (prior.request_fingerprint !== fingerprint) {
                refuse("IDEMPOTENCY_CONFLICT", "CONFLICT", "this idempotencyKey was already used for a different labor entry");
            }
            return resultOf("REPLAYED", prior);
        }
        // THE ASSIGNMENT AGAIN, under the Work Order lock: a reassignment committed since the decision is not missed.
        const own = await client.query(`SELECT 1 FROM ${SCHEMA}.work_order_assignments
        WHERE tenant_id = $1 AND work_order_id = $2 AND assignee_employee_id = $3 AND effective_to IS NULL`, [actor.tenantId, request.workOrderId, employeeId]);
        if (own.rows.length === 0)
            refuse("NOT_ASSIGNED", "FORBIDDEN", "labor may only be recorded by the Employee this Work Order is assigned to");
        const status = String(wo.rows[0].status);
        if (!exports.LABOR_RECORDABLE_WO_STATUSES.includes(status)) {
            refuse("WORK_ORDER_STATE_INVALID", "PRECONDITION_FAILED", `the Work Order is ${status}; new labor may only be recorded while the job is being executed`);
        }
        if (request.entryKind === "INTERVAL") {
            // One Employee's intervals are checked one writer at a time, so two concurrent entries cannot both pass.
            await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`wo-labor:${actor.tenantId}:${employeeId}`]);
            const overlap = await client.query(`SELECT e.id FROM ${SCHEMA}.work_order_labor_entries e
          WHERE e.tenant_id = $1 AND e.employee_id = $2 AND e.entry_kind = 'INTERVAL'
            AND e.started_at < $4 AND $3 < e.ended_at
            AND NOT EXISTS (SELECT 1 FROM ${SCHEMA}.work_order_labor_entries c WHERE c.tenant_id = e.tenant_id AND c.corrects_entry_id = e.id)
          ORDER BY e.started_at LIMIT 1`, [actor.tenantId, employeeId, new Date(request.startedAtMillis), new Date(request.endedAtMillis)]);
            if (overlap.rows.length > 0) {
                refuse("OVERLAPPING_ENTRY", "PRECONDITION_FAILED", `this time overlaps labor entry ${overlap.rows[0].id}; one Employee cannot be in two places at once`);
            }
        }
        return resultOf("RECORDED", await insertEntry(client, actor.tenantId, actor.principalId, employeeId, request, fingerprint, now));
    });
}
/** CORRECT: append a replacement for an ACTIVE entry of this Work Order. A separate, office-side authority. */
async function correctLabor(deps, actor, input) {
    if (!(actor.capabilities instanceof Set) || !actor.capabilities.has(exports.WORK_ORDER_LABOR_CORRECT)) {
        refuse("CAPABILITY_MISSING", "FORBIDDEN", `correcting labor requires ${exports.WORK_ORDER_LABOR_CORRECT}`);
    }
    const request = validateLaborRequest(input);
    const now = (deps.now ?? (() => new Date()))();
    return inTransaction(deps.pool, async (client) => {
        const wo = await client.query(`SELECT 1 FROM ${SCHEMA}.work_orders WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [actor.tenantId, request.workOrderId]);
        if (wo.rows.length === 0)
            refuse("WORK_ORDER_NOT_FOUND", "NOT_FOUND", "the Work Order does not exist in this tenant");
        if (await (0, workOrderQuarantine_1.isQuarantined)(client, actor.tenantId, request.workOrderId))
            refuse(workOrderQuarantine_1.WORK_ORDER_QUARANTINED, "PRECONDITION_FAILED", workOrderQuarantine_1.WORK_ORDER_QUARANTINED_MESSAGE);
        const original = (await client.query(`SELECT e.id, e.employee_id,
              EXISTS (SELECT 1 FROM ${SCHEMA}.work_order_labor_entries c WHERE c.tenant_id = e.tenant_id AND c.corrects_entry_id = e.id) AS reversed
         FROM ${SCHEMA}.work_order_labor_entries e WHERE e.tenant_id = $1 AND e.id = $2 AND e.work_order_id = $3`, [actor.tenantId, request.correctsLaborEntryId, request.workOrderId])).rows[0];
        if (!original)
            refuse("ENTRY_NOT_FOUND", "NOT_FOUND", `no labor entry ${request.correctsLaborEntryId} on this Work Order`);
        // The corrected entry keeps the ORIGINAL Employee.
        const fingerprint = laborFingerprint(request, String(original.employee_id));
        const prior = await priorByKey(client, actor.tenantId, actor.principalId, request.idempotencyKey);
        if (prior) {
            if (prior.request_fingerprint !== fingerprint) {
                refuse("IDEMPOTENCY_CONFLICT", "CONFLICT", "this idempotencyKey was already used for a different correction");
            }
            return resultOf("REPLAYED", prior);
        }
        if (original.reversed === true) {
            refuse("ENTRY_ALREADY_REVERSED", "CONFLICT", `labor entry ${request.correctsLaborEntryId} was already corrected; correct its replacement instead`);
        }
        return resultOf("RECORDED", await insertEntry(client, actor.tenantId, actor.principalId, String(original.employee_id), request, fingerprint, now));
    });
}
/** recordWorkOrderLabor: RECORD your own time, or -- with correctsLaborEntryId -- CORRECT an entry. */
const recordWorkOrderLabor = (deps, caller, input) => {
    const i = (input ?? {});
    const d = { pool: deps.pool, reader: deps.reader, now: deps.now };
    return i.correctsLaborEntryId !== undefined && i.correctsLaborEntryId !== null
        ? correctLabor(d, caller.actor, i)
        : recordOwnLabor(d, caller.actor, i);
};
exports.recordWorkOrderLabor = recordWorkOrderLabor;
const millis = (v) => (v === null || v === undefined ? null : new Date(v).getTime());
const isoOf = (v) => (v === null || v === undefined ? null : new Date(v).toISOString());
/**
 * readWorkOrderLabor: the time on ONE Work Order, with derived totals -- scoped to a job, never to an Employee
 * ("what has this person worked this month" is a payroll question with different authority). Behind the entitled
 * per-record Work Order read.
 */
const readWorkOrderLabor = async (deps, caller, input) => {
    const i = (input ?? {});
    const extra = Object.keys(i).filter((k) => k !== "workOrderId");
    if (extra.length > 0)
        refuse("INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT", `this read does not accept: ${extra.sort().join(", ")}`);
    const workOrderId = i.workOrderId;
    const decision = await (0, workOrderRecordRead_1.authorizeWorkOrderRecordRead)(deps.reader, caller.operational, workOrderId);
    if (!decision.allowed)
        refuse(String(decision.outcome), "FORBIDDEN", "this Work Order may not be read by this caller");
    const tenantId = caller.operational.tenantId;
    const wo = await deps.pool.query(`SELECT status::text AS status FROM ${SCHEMA}.work_orders WHERE tenant_id = $1 AND id = $2`, [tenantId, workOrderId]);
    if (wo.rows.length === 0)
        refuse("WORK_ORDER_NOT_FOUND", "NOT_FOUND", "the Work Order does not exist in this tenant");
    if (await (0, workOrderQuarantine_1.isQuarantined)(deps.pool, tenantId, workOrderId))
        refuse(workOrderQuarantine_1.WORK_ORDER_QUARANTINED, "PRECONDITION_FAILED", workOrderQuarantine_1.WORK_ORDER_QUARANTINED_MESSAGE);
    const { rows } = await deps.pool.query(`SELECT e.id, e.employee_id, e.labor_type, e.entry_kind, e.duration_minutes, to_char(e.work_date, 'YYYY-MM-DD') AS work_date,
            e.started_at, e.ended_at, e.notes, e.corrects_entry_id, e.recorded_by_principal_id, e.recorded_at, e.device_reported_at,
            c.id AS reversed_by, emp.preferred_name, emp.display_name, emp.first_name, emp.last_name
       FROM ${SCHEMA}.work_order_labor_entries e
       LEFT JOIN ${SCHEMA}.work_order_labor_entries c ON c.tenant_id = e.tenant_id AND c.corrects_entry_id = e.id
       LEFT JOIN eos_workforce.employees emp ON emp.tenant_id = e.tenant_id AND emp.id = e.employee_id
      WHERE e.tenant_id = $1 AND e.work_order_id = $2
      ORDER BY e.recorded_at, e.id
      LIMIT ${exports.LABOR_READ_MAX + 1}`, [tenantId, workOrderId]);
    const totals = (await deps.pool.query(`SELECT COALESCE(SUM(e.duration_minutes) FILTER (WHERE c.id IS NULL), 0)::int AS total,
            COALESCE(SUM(e.duration_minutes) FILTER (WHERE c.id IS NULL AND e.labor_type = 'ONSITE'), 0)::int AS onsite,
            COALESCE(SUM(e.duration_minutes) FILTER (WHERE c.id IS NULL AND e.labor_type = 'TRAVEL'), 0)::int AS travel,
            count(*) FILTER (WHERE c.id IS NULL)::int AS active, count(*) FILTER (WHERE c.id IS NOT NULL)::int AS reversed
       FROM ${SCHEMA}.work_order_labor_entries e
       LEFT JOIN ${SCHEMA}.work_order_labor_entries c ON c.tenant_id = e.tenant_id AND c.corrects_entry_id = e.id
      WHERE e.tenant_id = $1 AND e.work_order_id = $2`, [tenantId, workOrderId])).rows[0];
    const canRecord = (await (0, contextualAuthorization_1.authorizeObjectAction)(deps.reader, {
        actor: caller.actor, capabilityKey: exports.WORK_ORDER_LABOR_RECORD,
        predicates: (0, workOrderLifecycle_1.lifecycleContextPredicates)(workOrderLifecycle_1.WORK_ORDER_LIFECYCLE_COMPLETE), record: { recordKind: "workOrder", recordId: workOrderId },
    })).allowed;
    const name = (r) => {
        if (r.preferred_name)
            return String(r.preferred_name);
        if (r.display_name)
            return String(r.display_name);
        const joined = [r.first_name, r.last_name].filter((v) => typeof v === "string" && v !== "").join(" ");
        return joined === "" ? null : joined;
    };
    const entries = rows.slice(0, exports.LABOR_READ_MAX).map((r) => Object.freeze({
        laborEntryId: String(r.id), employeeId: String(r.employee_id), employeeDisplayName: name(r),
        recordedByPrincipalId: String(r.recorded_by_principal_id), laborType: String(r.labor_type), entryKind: String(r.entry_kind),
        durationMinutes: Number(r.duration_minutes), workDate: String(r.work_date),
        startedAtMillis: millis(r.started_at), endedAtMillis: millis(r.ended_at),
        status: r.reversed_by ? "REVERSED" : "ACTIVE",
        correctsLaborEntryId: r.corrects_entry_id ?? null, reversedByLaborEntryId: r.reversed_by ?? null,
        notes: r.notes ?? null, recordedAt: isoOf(r.recorded_at), deviceReportedAt: isoOf(r.device_reported_at),
    }));
    return Object.freeze({
        status: "ready",
        workOrderId,
        workOrderStatus: String(wo.rows[0].status),
        entries: Object.freeze(entries),
        truncated: rows.length > exports.LABOR_READ_MAX,
        // REVERSED entries are RETURNED and excluded from the totals: "what did this job cost in time" and "what was
        // recorded and later corrected" are different questions.
        totals: Object.freeze({
            totalMinutes: Number(totals.total), onsiteMinutes: Number(totals.onsite), travelMinutes: Number(totals.travel),
            activeEntries: Number(totals.active), reversedEntries: Number(totals.reversed),
        }),
        // The contract, returned so a client never hardcodes a copy of it.
        laborTypes: [...exports.LABOR_TYPES],
        entryKinds: [...exports.LABOR_ENTRY_KINDS],
        recordableStatuses: [...exports.LABOR_RECORDABLE_WO_STATUSES],
        maxMinutes: exports.MAX_LABOR_MINUTES,
        canRecord,
        canCorrect: caller.actor.capabilities instanceof Set && caller.actor.capabilities.has(exports.WORK_ORDER_LABOR_CORRECT),
    });
};
exports.readWorkOrderLabor = readWorkOrderLabor;
//# sourceMappingURL=workOrderLabor.js.map