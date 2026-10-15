"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkOrderNumberingError = exports.WORK_ORDER_NUMBER_PATTERN = void 0;
exports.workOrderNumberYear = workOrderNumberYear;
exports.formatWorkOrderNumber = formatWorkOrderNumber;
exports.allocateWorkOrderNumber = allocateWorkOrderNumber;
const SCHEMA = "eos_ops";
/** WO-YYYY-###### -- the format the target's CHECK constraint enforces and legacy already used. */
exports.WORK_ORDER_NUMBER_PATTERN = /^WO-[0-9]{4}-[0-9]{6,}$/;
class WorkOrderNumberingError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "WorkOrderNumberingError";
    }
}
exports.WorkOrderNumberingError = WorkOrderNumberingError;
/** The year the number carries. UTC, so the same instant never produces two different years. */
function workOrderNumberYear(at) {
    if (!(at instanceof Date) || Number.isNaN(at.getTime())) {
        throw new WorkOrderNumberingError("NUMBER_CLOCK_INVALID", "a Work Order number needs a real instant");
    }
    return at.getUTCFullYear();
}
/**
 * Six digits, and NOT truncated once a year outgrows six.
 *
 * The CHECK is `[0-9]{6,}`, so the sixth digit is a floor rather than a cap. Truncating at six would
 * start re-issuing numbers on the 1,000,000th Work Order -- silently, and only in the busiest year.
 */
function formatWorkOrderNumber(year, sequence) {
    if (!Number.isInteger(year) || year < 1970 || year > 9999) {
        throw new WorkOrderNumberingError("NUMBER_YEAR_INVALID", `year ${year} is outside the governed range`);
    }
    if (!Number.isInteger(sequence) || sequence < 1) {
        throw new WorkOrderNumberingError("NUMBER_SEQUENCE_INVALID", "a sequence starts at 1");
    }
    return `WO-${year}-${String(sequence).padStart(6, "0")}`;
}
/**
 * Allocate the next Work Order number for a tenant and year.
 *
 * ONE STATEMENT. The INSERT ... ON CONFLICT DO UPDATE ... RETURNING takes the counter row's lock and
 * returns the incremented value together, so two concurrent creates serialize on that row rather than
 * both reading the same maximum and colliding on the unique index. There is no SELECT max() anywhere in
 * this module, and a test asserts that by reading its own source.
 */
async function allocateWorkOrderNumber(db, tenantId, at) {
    if (typeof tenantId !== "string" || tenantId.trim() === "") {
        throw new WorkOrderNumberingError("NUMBER_TENANT_REQUIRED", "a Work Order number is only allocatable within a tenant");
    }
    const year = workOrderNumberYear(at);
    const { rows } = await db.query(`INSERT INTO ${SCHEMA}.work_order_number_counters (tenant_id, year, last_value)
     VALUES ($1, $2, 1)
     ON CONFLICT (tenant_id, year)
     DO UPDATE SET last_value = ${SCHEMA}.work_order_number_counters.last_value + 1, updated_at = now()
     RETURNING last_value`, [tenantId, year]);
    const sequence = Number(rows[0].last_value);
    return Object.freeze({ year, sequence, number: formatWorkOrderNumber(year, sequence) });
}
//# sourceMappingURL=workOrderNumbering.js.map