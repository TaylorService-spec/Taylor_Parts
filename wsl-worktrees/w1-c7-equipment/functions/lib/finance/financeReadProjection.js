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
exports.summarizeArAging = summarizeArAging;
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
function summarizeArAging(reads, nowMillis) {
    const out = {};
    for (const r of Array.isArray(reads) ? reads : []) {
        if (!(r.outstandingMinor > 0))
            continue; // nothing owed, nothing to age
        const currency = r.currency ?? "UNSPECIFIED";
        const b = (out[currency] ??= {
            totalOutstandingMinor: 0, currentMinor: 0, days1to30Minor: 0,
            days31to60Minor: 0, days61PlusMinor: 0, unagedMinor: 0,
        });
        b.totalOutstandingMinor += r.outstandingMinor;
        // Recomputed from the invoice's own facts, not read off the projection, so the bucket and the
        // row can never disagree about the same invoice.
        const { position, daysOverdue } = deriveArPosition({ state: r.state ?? undefined, totalMinor: r.totalMinor, appliedMinor: r.appliedMinor,
            creditsMinor: r.creditsMinor, chargesMinor: r.chargesMinor, writeOffMinor: r.writeOffMinor,
            dueDate: r.dueDate ?? undefined }, nowMillis);
        if (position === "UNKNOWN")
            b.unagedMinor += r.outstandingMinor;
        else if (position === "CURRENT" || daysOverdue === null || daysOverdue <= 0)
            b.currentMinor += r.outstandingMinor;
        else if (daysOverdue <= 30)
            b.days1to30Minor += r.outstandingMinor;
        else if (daysOverdue <= 60)
            b.days31to60Minor += r.outstandingMinor;
        else
            b.days61PlusMinor += r.outstandingMinor;
    }
    return out;
}
// Summarize a set of AR reads — honest counts plus the lifecycle totals, EACH PER CURRENCY.
//
// THE CONSOLIDATED TOTALS LIVE HERE, in the one canonical summary, for a specific reason: a client
// given only per-company rollups must either add them up itself — presenting a scoped slice as a
// book-wide figure — or refuse to show the number at all. Summing the already-authorized atomic
// facts is the server's job, because the server is what knows which facts the caller may see.
//
// BILLED is the invoice total; COLLECTED is the maintained appliedMinor projection of the payment
// applications — the SAME meaning the per-company/per-salesperson rollups use, so one word cannot
// mean two things on two pages. OUTSTANDING counts only invoices that still owe something, which is
// why it is not simply billed − collected.
//
// Currencies are never blended: each is its own key, and a caller that wants one number must first
// decide an FX policy this system does not have.
function summarizeAccountAr(reads) {
    const list = Array.isArray(reads) ? reads : [];
    const billedByCurrency = {};
    const collectedByCurrency = {};
    const outstandingByCurrency = {};
    let openCount = 0;
    let overdueCount = 0;
    for (const r of list) {
        const currency = r.currency ?? "UNSPECIFIED";
        billedByCurrency[currency] = (billedByCurrency[currency] ?? 0) + nn(r.totalMinor);
        collectedByCurrency[currency] = (collectedByCurrency[currency] ?? 0) + nn(r.appliedMinor);
        if (r.outstandingMinor > 0) {
            openCount += 1;
            outstandingByCurrency[currency] = (outstandingByCurrency[currency] ?? 0) + r.outstandingMinor;
        }
        if (r.arPosition === "OVERDUE")
            overdueCount += 1;
    }
    return { count: list.length, openCount, overdueCount, billedByCurrency, collectedByCurrency, outstandingByCurrency };
}
//# sourceMappingURL=financeReadProjection.js.map