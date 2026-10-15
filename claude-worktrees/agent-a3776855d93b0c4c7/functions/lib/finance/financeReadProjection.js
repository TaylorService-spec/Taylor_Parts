"use strict";
// Finance — PURE trusted-read projection (Billing/AR). Projects a stored invoice into the MINIMAL AR read the
// UI needs, DERIVING the AR position from the durable facts (never trusting a possibly-stale stored balance):
// outstanding = total − applied − credits + charges − writeoffs; AR position from outstanding + due date + now.
// No PII: accountId only, no raw UID. Distinct honest states are the caller's job (denied/empty/unavailable);
// this is the per-invoice shape. No I/O.
Object.defineProperty(exports, "__esModule", { value: true });
exports.deriveOutstandingMinor = deriveOutstandingMinor;
exports.deriveArPosition = deriveArPosition;
exports.projectInvoiceAr = projectInvoiceAr;
exports.summarizeAccountAr = summarizeAccountAr;
const nn = (v) => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : 0);
const DAY = 24 * 60 * 60 * 1000;
// AR OUTSTANDING derived from facts (reconcilable; the same formula the payment/adjustment commands maintain).
function deriveOutstandingMinor(inv) {
    return nn(inv.totalMinor) - nn(inv.appliedMinor) - nn(inv.creditsMinor) + nn(inv.chargesMinor) - nn(inv.writeOffMinor);
}
// Factual AR position (what is OWED — distinct from the invoice's payment STATE). SETTLED = nothing owed
// (by payment AND/OR credit/write-off — the read exposes the invoice state separately so a written-off invoice
// is not misread as "paid"). daysOverdue is factual; NO aging buckets (deployment policy).
function deriveArPosition(inv, nowMillis) {
    if (inv?.state === "VOID")
        return { position: "VOID", daysOverdue: null };
    if (deriveOutstandingMinor(inv) <= 0)
        return { position: "SETTLED", daysOverdue: null };
    const due = typeof inv?.dueDate === "number" ? inv.dueDate : null;
    if (due == null || typeof nowMillis !== "number")
        return { position: "UNKNOWN", daysOverdue: null };
    if (nowMillis > due)
        return { position: "OVERDUE", daysOverdue: Math.floor((nowMillis - due) / DAY) };
    return { position: "CURRENT", daysOverdue: 0 };
}
// Project one stored invoice (by id) into the minimal AR read. Amounts as integer minor units.
function projectInvoiceAr(invoiceId, inv, nowMillis) {
    const { position, daysOverdue } = deriveArPosition(inv ?? {}, nowMillis);
    return {
        invoiceId,
        invoiceNumber: typeof inv?.invoiceNumber === "string" ? inv.invoiceNumber : null,
        accountId: typeof inv?.accountId === "string" ? inv.accountId : null,
        salesOrderId: typeof inv?.salesOrderId === "string" ? inv.salesOrderId : null,
        currency: typeof inv?.currency === "string" ? inv.currency : null,
        state: typeof inv?.state === "string" ? inv.state : null,
        totalMinor: nn(inv?.totalMinor),
        appliedMinor: nn(inv?.appliedMinor),
        creditsMinor: nn(inv?.creditsMinor),
        chargesMinor: nn(inv?.chargesMinor),
        writeOffMinor: nn(inv?.writeOffMinor),
        outstandingMinor: deriveOutstandingMinor(inv ?? {}),
        dueDate: typeof inv?.dueDate === "number" ? inv.dueDate : null,
        arPosition: position,
        daysOverdue,
    };
}
// Summarize a set of AR reads for an account view — honest counts + the total open balance (all same currency;
// mixed currencies are surfaced, never summed blindly).
function summarizeAccountAr(reads) {
    const list = Array.isArray(reads) ? reads : [];
    const outstandingByCurrency = {};
    let openCount = 0;
    let overdueCount = 0;
    for (const r of list) {
        if (r.outstandingMinor > 0)
            openCount += 1;
        if (r.arPosition === "OVERDUE")
            overdueCount += 1;
        if (r.outstandingMinor > 0) {
            const currency = r.currency ?? "UNSPECIFIED";
            outstandingByCurrency[currency] = (outstandingByCurrency[currency] ?? 0) + r.outstandingMinor;
        }
    }
    return { count: list.length, openCount, overdueCount, outstandingByCurrency };
}
//# sourceMappingURL=financeReadProjection.js.map