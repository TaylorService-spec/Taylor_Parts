"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommercialNumberingError = exports.COMMERCIAL_NUMBER_SERIES = void 0;
exports.commercialNumberYear = commercialNumberYear;
exports.formatCommercialNumber = formatCommercialNumber;
exports.allocateCommercialNumber = allocateCommercialNumber;
exports.COMMERCIAL_NUMBER_SERIES = Object.freeze(["OPPORTUNITY", "SALES_AGREEMENT", "SALES_ORDER"]);
const PREFIX = Object.freeze({
    OPPORTUNITY: "OPP",
    SALES_AGREEMENT: "SA",
    SALES_ORDER: "SO",
});
class CommercialNumberingError extends Error {
    constructor(message) {
        super(message);
        this.name = "CommercialNumberingError";
    }
}
exports.CommercialNumberingError = CommercialNumberingError;
/** The UTC calendar year a number belongs to. */
function commercialNumberYear(at) {
    if (!(at instanceof Date) || Number.isNaN(at.getTime()))
        throw new CommercialNumberingError("a valid allocation instant is required");
    return at.getUTCFullYear();
}
/** `<PREFIX>-<YYYY>-<######>`, identical to the current Firestore formatters. */
function formatCommercialNumber(series, year, sequence) {
    const prefix = PREFIX[series];
    if (!prefix)
        throw new CommercialNumberingError(`unknown commercial number series ${String(series)}`);
    if (!Number.isInteger(year) || !Number.isInteger(sequence) || sequence < 1) {
        throw new CommercialNumberingError("year and sequence must be integers and the sequence must be positive");
    }
    return `${prefix}-${year}-${String(sequence).padStart(6, "0")}`;
}
/**
 * Allocate the next number for (tenant, series, UTC year of `at`) on the caller's OPEN transaction.
 * The caller must hold a transaction: outside one, the increment would commit on its own.
 */
async function allocateCommercialNumber(db, tenantId, series, at) {
    if (typeof tenantId !== "string" || tenantId.trim() === "")
        throw new CommercialNumberingError("tenantId is required");
    if (!exports.COMMERCIAL_NUMBER_SERIES.includes(series))
        throw new CommercialNumberingError(`unknown commercial number series ${String(series)}`);
    const year = commercialNumberYear(at);
    const result = await db.query(`INSERT INTO eos_commercial.number_counters (tenant_id, series, year, last_value)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (tenant_id, series, year)
     DO UPDATE SET last_value = eos_commercial.number_counters.last_value + 1, updated_at = now()
     RETURNING last_value`, [tenantId, series, year]);
    const sequence = Number(result.rows[0].last_value);
    return { series, year, sequence, number: formatCommercialNumber(series, year, sequence) };
}
//# sourceMappingURL=commercialNumbering.js.map