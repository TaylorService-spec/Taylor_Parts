"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InvoiceAuthorityError = void 0;
exports.insertIssuedInvoice = insertIssuedInvoice;
exports.readInvoiceTotals = readInvoiceTotals;
exports.readAccountInvoiceTotals = readAccountInvoiceTotals;
exports.readInvoiceLineAmounts = readInvoiceLineAmounts;
exports.reconcileMigratedInvoice = reconcileMigratedInvoice;
const node_crypto_1 = require("node:crypto");
const operatingCompanyCustody_js_1 = require("./operatingCompanyCustody.js");
const invoiceTotals_js_1 = require("./invoiceTotals.js");
// OWNER RULING (W1 integration): Invoice and Payment are one financial bounded context and
// neither belongs in eos_ops. Migration 1758931200000 establishes `eos_finance` and the Invoice
// authority in it; 1759017600000 extends the same schema with receipts and applications.
const SCHEMA = "eos_finance";
const newId = (prefix) => `${prefix}_${(0, node_crypto_1.randomUUID)()}`;
class InvoiceAuthorityError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "InvoiceAuthorityError";
    }
}
exports.InvoiceAuthorityError = InvoiceAuthorityError;
const requireText = (value, field) => {
    if (typeof value !== "string" || value.trim() === "") {
        throw new InvoiceAuthorityError("REQUIRED", `${field} is required`);
    }
    return value;
};
/**
 * Persist one issued invoice and its lines in ONE transaction.
 *
 * AN INVOICE WITH NO LINES IS REFUSED HERE because SQL cannot refuse it: the "at least one line"
 * rule (invoiceCommands.ts's NO_LINES) spans two tables, so no CHECK can hold it. Migration 008's
 * header says so rather than claiming an enforcement it does not have, and this is the enforcement.
 *
 * Header and lines commit together or not at all. A header without its lines would read as a
 * zero-total invoice through `invoice_totals`, which is exactly the silent wrong number this whole
 * design exists to make impossible.
 */
async function insertIssuedInvoice(pool, input) {
    const tenantId = requireText(input?.tenantId, "tenantId");
    const operatingCompanyKey = (0, operatingCompanyCustody_js_1.requireOperatingCompanyKey)(input?.operatingCompanyKey);
    const invoiceNumber = requireText(input?.invoiceNumber, "invoiceNumber");
    const accountId = requireText(input?.accountId, "accountId");
    const salesOrderId = requireText(input?.salesOrderId, "salesOrderId");
    const currency = requireText(input?.currency, "currency");
    const issuedBy = requireText(input?.issuedBy, "issuedBy");
    if (!(input?.dueDate instanceof Date) || Number.isNaN(input.dueDate.getTime())) {
        throw new InvoiceAuthorityError("DUE_DATE_INVALID", "dueDate is required — AR aging begins there");
    }
    const lines = Array.isArray(input?.lines) ? input.lines : [];
    if (lines.length === 0)
        throw new InvoiceAuthorityError("NO_LINES", "an invoice must have at least one line");
    // Validate every line through the ONE shared derivation before opening a transaction, so a
    // caller sees the command core's refusal rather than a constraint name. The derived values are
    // deliberately discarded — the database generates them.
    lines.forEach((line, i) => {
        requireText(line?.salesOrderLineId, `line ${i} salesOrderLineId`);
        requireText(line?.kind, `line ${i} kind`);
        requireText(line?.ref, `line ${i} ref`);
        (0, invoiceTotals_js_1.deriveInvoiceLineAmounts)(line, `line ${i}`);
    });
    const invoiceId = newId("inv");
    const lineIds = lines.map(() => newId("invl"));
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await client.query(`INSERT INTO ${SCHEMA}.invoices
         (id, tenant_id, operating_company_key, invoice_number, account_id, sales_order_id,
          currency, due_date, issued_by, tax_provenance)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [invoiceId, tenantId, operatingCompanyKey, invoiceNumber, accountId, salesOrderId,
            currency, input.dueDate, issuedBy, input.taxProvenance ?? null]);
        for (let i = 0; i < lines.length; i++) {
            const l = lines[i];
            // NOTE the columns that are absent: subtotal_minor, taxable_base_minor and line_total_minor
            // are GENERATED ALWAYS. Adding them here would not merely be redundant — Postgres would
            // refuse the statement, which is the guarantee.
            await client.query(`INSERT INTO ${SCHEMA}.invoice_lines
           (id, tenant_id, invoice_id, sales_order_line_id, line_kind, line_ref, business_unit_id,
            billable_qty, unit_price_minor, discount_minor, tax_minor)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`, [lineIds[i], tenantId, invoiceId, l.salesOrderLineId, l.kind, l.ref, l.businessUnitId ?? null,
                l.billableQty, l.unitPriceMinor, l.discountMinor ?? 0, l.taxMinor]);
        }
        await client.query("COMMIT");
    }
    catch (err) {
        await client.query("ROLLBACK");
        throw err;
    }
    finally {
        client.release();
    }
    const totals = await readInvoiceTotals(pool, { tenantId, invoiceId });
    if (!totals)
        throw new InvoiceAuthorityError("NOT_FOUND", `invoice ${invoiceId} vanished after commit`);
    return { invoiceId, lineIds, totals: totals.totals };
}
// The view returns BIGINT, which node-postgres delivers as a STRING to avoid silently truncating
// values beyond Number.MAX_SAFE_INTEGER. Converting blindly with Number() would reintroduce
// exactly the precision loss the BIGINT choice avoids, so a value that cannot survive the trip is
// refused rather than rounded.
const bigintToSafeInt = (value, field) => {
    if (typeof value === "number") {
        if (!Number.isSafeInteger(value))
            throw new InvoiceAuthorityError("AMOUNT_UNREPRESENTABLE", `${field} is not a safe integer`);
        return value;
    }
    if (typeof value !== "string")
        throw new InvoiceAuthorityError("AMOUNT_UNREPRESENTABLE", `${field} is missing`);
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || String(parsed) !== value) {
        throw new InvoiceAuthorityError("AMOUNT_UNREPRESENTABLE", `${field} "${value}" exceeds exact JavaScript integer range`);
    }
    return parsed;
};
const toTotalsRow = (row) => ({
    invoiceId: row.invoice_id,
    tenantId: row.tenant_id,
    operatingCompanyKey: row.operating_company_key,
    accountId: row.account_id,
    salesOrderId: row.sales_order_id,
    currency: row.currency,
    dueDate: row.due_date,
    isVoid: row.is_void === true,
    totals: {
        lineCount: bigintToSafeInt(row.line_count, "line_count"),
        subtotalMinor: bigintToSafeInt(row.subtotal_minor, "subtotal_minor"),
        discountMinor: bigintToSafeInt(row.discount_minor, "discount_minor"),
        taxableBaseMinor: bigintToSafeInt(row.taxable_base_minor, "taxable_base_minor"),
        taxMinor: bigintToSafeInt(row.tax_minor, "tax_minor"),
        totalMinor: bigintToSafeInt(row.total_minor, "total_minor"),
    },
});
/** One invoice's money, summed from its lines by the database. Null when there is no such invoice. */
async function readInvoiceTotals(pool, scope) {
    const tenantId = requireText(scope?.tenantId, "tenantId");
    const invoiceId = requireText(scope?.invoiceId, "invoiceId");
    const { rows } = await pool.query(`SELECT * FROM ${SCHEMA}.invoice_totals WHERE tenant_id = $1 AND invoice_id = $2`, [tenantId, invoiceId]);
    return rows.length === 0 ? null : toTotalsRow(rows[0]);
}
/**
 * An account's invoices, newest first — the ONE scope the deployed read path actually uses
 * (financeReadCallables.ts's listAccountInvoiceAr is `.where("accountId", "==", accountId)`).
 *
 * The AR overlay is deliberately absent: outstanding, applied and payment state are derived from
 * payment application facts, which belong to the Payment lane. This returns what is BILLED.
 */
async function readAccountInvoiceTotals(pool, scope) {
    const tenantId = requireText(scope?.tenantId, "tenantId");
    const accountId = requireText(scope?.accountId, "accountId");
    const limit = Number.isSafeInteger(scope?.limit) && scope.limit > 0 ? scope.limit : 100;
    const { rows } = await pool.query(`SELECT t.* FROM ${SCHEMA}.invoice_totals t
      WHERE t.tenant_id = $1 AND t.account_id = $2
      ORDER BY t.due_date DESC, t.invoice_id
      LIMIT $3`, [tenantId, accountId, limit]);
    return rows.map(toTotalsRow);
}
/** One invoice's stored line amounts, as the database generated them. */
async function readInvoiceLineAmounts(pool, scope) {
    const tenantId = requireText(scope?.tenantId, "tenantId");
    const invoiceId = requireText(scope?.invoiceId, "invoiceId");
    const { rows } = await pool.query(`SELECT subtotal_minor, discount_minor, taxable_base_minor, tax_minor, line_total_minor
       FROM ${SCHEMA}.invoice_lines
      WHERE tenant_id = $1 AND invoice_id = $2
      ORDER BY id`, [tenantId, invoiceId]);
    return rows.map((r) => ({
        subtotalMinor: bigintToSafeInt(r.subtotal_minor, "subtotal_minor"),
        discountMinor: bigintToSafeInt(r.discount_minor, "discount_minor"),
        taxableBaseMinor: bigintToSafeInt(r.taxable_base_minor, "taxable_base_minor"),
        taxMinor: bigintToSafeInt(r.tax_minor, "tax_minor"),
        lineTotalMinor: bigintToSafeInt(r.line_total_minor, "line_total_minor"),
    }));
}
function reconcileMigratedInvoice(input) {
    const invoiceId = requireText(input?.invoiceId, "invoiceId");
    const fromSourceLines = (0, invoiceTotals_js_1.sumInvoiceLineAmounts)(input?.sourceLineAmounts ?? []);
    const target = input?.targetTotals;
    if (!target)
        throw new InvoiceAuthorityError("REQUIRED", "targetTotals is required");
    const stored = input?.sourceStoredTotals ?? {};
    const sourceInternallyConsistent = stored.subtotalMinor === fromSourceLines.subtotalMinor &&
        stored.discountMinor === fromSourceLines.discountMinor &&
        stored.taxMinor === fromSourceLines.taxMinor &&
        stored.totalMinor === fromSourceLines.totalMinor;
    // The comparison that matters is source LINES against target lines: the lines are the durable
    // facts, and the target has no header aggregate to compare a header to.
    const differences = [];
    const fields = ["lineCount", "subtotalMinor", "discountMinor", "taxableBaseMinor", "taxMinor", "totalMinor"];
    for (const field of fields) {
        const sourceValue = fromSourceLines[field];
        const targetValue = target[field];
        if (typeof targetValue !== "number" || sourceValue !== targetValue) {
            differences.push({ field, sourceValue: typeof sourceValue === "number" ? sourceValue : null, targetValue });
        }
    }
    return {
        invoiceId,
        sourceInternallyConsistent,
        targetMatchesSourceLines: differences.length === 0,
        status: differences.length === 0 ? "IN_SYNC" : "DRIFT",
        differences,
    };
}
//# sourceMappingURL=invoiceAuthority.js.map