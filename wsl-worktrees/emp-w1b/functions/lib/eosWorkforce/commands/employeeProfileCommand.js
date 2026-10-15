"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EMPLOYEE_PROFILE_FIELD_KEYS = exports.EMPLOYEE_PROFILE_UPDATE_ACTION = void 0;
exports.updateEmployeeProfile = updateEmployeeProfile;
const employeeCommandKernel_1 = require("./employeeCommandKernel");
const employeeProfileVocabulary_1 = require("../employeeProfileVocabulary");
exports.EMPLOYEE_PROFILE_UPDATE_ACTION = "employee.profile.update";
/** The closed input vocabulary: Administration / Firestore-command field keys, in the fixed column order. */
exports.EMPLOYEE_PROFILE_FIELD_KEYS = Object.freeze(employeeProfileVocabulary_1.PROFILE_FIELD_MAP.map(([key]) => key));
const COLUMN_BY_KEY = new Map(employeeProfileVocabulary_1.PROFILE_FIELD_MAP.map(([key, column, kind]) => [key, { column, kind }]));
const NORMALIZATION_MESSAGES = Object.freeze({
    NOT_A_STRING: "must be a string or null",
    TOO_LONG: "exceeds 200 characters",
    EMAIL_SHAPE_INVALID: "is not a valid email address",
    CALENDAR_DATE_INVALID: "must be a calendar date (YYYY-MM-DD)",
    EMPLOYEE_NUMBER_SHAPE_INVALID: "must be 1-32 characters of letters, digits, dot, underscore or hyphen, starting with a letter or digit",
});
function prepareChanges(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        (0, employeeCommandKernel_1.refuse)("CHANGES_REQUIRED", "INVALID_INPUT", "changes must be an object of profile field keys");
    const entries = Object.entries(raw);
    if (entries.length === 0)
        (0, employeeCommandKernel_1.refuse)("CHANGES_REQUIRED", "INVALID_INPUT", "changes must name at least one profile field");
    const unknown = entries.map(([k]) => k).filter((k) => !COLUMN_BY_KEY.has(k));
    if (unknown.length > 0)
        (0, employeeCommandKernel_1.refuse)("INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT", `this command does not accept: ${unknown.sort().join(", ")}`);
    const out = new Map();
    // Fixed vocabulary order, never the caller's key order, so the audit trail and result are deterministic.
    for (const key of exports.EMPLOYEE_PROFILE_FIELD_KEYS) {
        if (!Object.prototype.hasOwnProperty.call(raw, key))
            continue;
        const { column, kind } = COLUMN_BY_KEY.get(key);
        const n = (0, employeeProfileVocabulary_1.normalizeProfileValue)(kind, raw[key]);
        if ("code" in n)
            (0, employeeCommandKernel_1.refuse)("PROFILE_FIELD_INVALID", "INVALID_INPUT", `${key} ${NORMALIZATION_MESSAGES[n.code] ?? "is invalid"}`);
        else
            out.set(key, { column, value: n.value });
    }
    return out;
}
async function currentProfile(db, tenantId, employeeId, columns) {
    const select = columns.map((c) => (c === "hire_date" || c === "separation_date" ? `to_char(${c}, 'YYYY-MM-DD') AS ${c}` : c));
    const { rows } = await db.query(`SELECT ${select.join(", ")} FROM eos_workforce.employees WHERE tenant_id = $1 AND id = $2`, [tenantId, employeeId]);
    return rows[0];
}
/** Update governed profile facts of one Employee of the actor's tenant. */
function updateEmployeeProfile(deps, actor, input) {
    return (0, employeeCommandKernel_1.runEmployeeCommand)(deps, actor, () => {
        const i = (0, employeeCommandKernel_1.acceptOnly)(input, ["employeeId", "changes", "reason"]);
        return { employeeId: (0, employeeCommandKernel_1.requireId)(i.employeeId, "employeeId"), changes: prepareChanges(i.changes), reason: (0, employeeCommandKernel_1.optionalReason)(i.reason) };
    }, async (db, p, at) => {
        await (0, employeeCommandKernel_1.lockEmployee)(db, actor.tenantId, p.employeeId);
        const columns = [...p.changes.values()].map((c) => c.column);
        const current = await currentProfile(db, actor.tenantId, p.employeeId, columns);
        const changed = [...p.changes].filter(([, c]) => (current[c.column] ?? null) !== c.value);
        if (changed.length === 0)
            return { outcome: "NO_CHANGE", employeeId: p.employeeId, changedFields: [], auditEventId: null };
        const number = changed.find(([, c]) => c.column === "employee_number")?.[1].value;
        if (number) {
            const held = await db.query(`SELECT 1 FROM eos_workforce.employees WHERE tenant_id = $1 AND id <> $2 AND upper(employee_number) = upper($3)`, [actor.tenantId, p.employeeId, number]);
            if (held.rows.length > 0)
                (0, employeeCommandKernel_1.refuse)("EMPLOYEE_NUMBER_TAKEN", "CONFLICT", "another Employee of this tenant holds that employee number");
        }
        await db.query(`UPDATE eos_workforce.employees SET ${changed.map(([, c], i) => `${c.column} = $${i + 3}`).join(", ")}, updated_at = $${changed.length + 3}
          WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, p.employeeId, ...changed.map(([, c]) => c.value), at]);
        const before = Object.fromEntries(changed.map(([key, c]) => [key, current[c.column] ?? null]));
        const after = Object.fromEntries(changed.map(([key, c]) => [key, c.value]));
        const auditEventId = await (0, employeeCommandKernel_1.appendEmployeeAudit)(db, actor.tenantId, actor.principalId, exports.EMPLOYEE_PROFILE_UPDATE_ACTION, p.employeeId, before, after, p.reason, at);
        return { outcome: "UPDATED", employeeId: p.employeeId, changedFields: changed.map(([key]) => key), auditEventId };
    }, () => new employeeCommandKernel_1.EmployeeCommandError("EMPLOYEE_NUMBER_TAKEN", "CONFLICT", "another Employee of this tenant holds that employee number"));
}
//# sourceMappingURL=employeeProfileCommand.js.map