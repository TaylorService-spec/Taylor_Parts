"use strict";
// Finance — PURE trusted-read projection (Billing/AR). Projects a stored invoice into the MINIMAL AR read the
// UI needs, DERIVING the AR position from the durable facts (never trusting a possibly-stale stored balance):
// outstanding = total − applied − credits + charges − writeoffs; AR position from outstanding + due date + now.
// No PII: accountId only, no raw UID. Distinct honest states are the caller's job (denied/empty/unavailable);
// this is the per-invoice shape. No I/O.
//
// EVERY FIGURE HERE CARRIES ITS OPERATING COMPANY. Money in this system belongs to one governed
// operating company, stamped on the invoice from its Sales Order and never inferred; a total that
// dissolves that dimension is a figure nobody can act on. So the projection carries `companyId` and
// every aggregate below is available partitioned by it — exactly the discipline the per-currency
// maps already follow, applied to the other dimension that must never be blended.
Object.defineProperty(exports, "__esModule", { value: true });
exports.UNATTRIBUTED_COMPANY = void 0;
exports.deriveOutstandingMinor = deriveOutstandingMinor;
exports.deriveArPosition = deriveArPosition;
exports.projectInvoiceAr = projectInvoiceAr;
exports.summarizeArAging = summarizeArAging;
exports.summarizeArAgingByCompany = summarizeArAgingByCompany;
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
        companyId: typeof inv?.companyId === "string" ? inv.companyId : null,
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
// THE EXPLICIT KEY FOR "NO GOVERNED OPERATING COMPANY".
//
// A fact with no company is NOT dropped and NOT folded into a company. It gets its own key, for the
// same reason `summarizeArAging` keeps `unagedMinor` beside the buckets: the per-company figures
// plus this key reconcile EXACTLY to the consolidated totals, and that reconciliation is the only
// thing that makes a company breakdown trustworthy. Omitting unattributed money would make the
// parts quietly fail to add up to the whole, which is worse than showing it.
exports.UNATTRIBUTED_COMPANY = "UNATTRIBUTED";
const companyKeyOf = (r) => typeof r?.companyId === "string" && r.companyId.trim().length > 0 ? r.companyId : exports.UNATTRIBUTED_COMPANY;
// A/R AGING PER OPERATING COMPANY.
//
// `summarizeArAging` ages the whole visible book at once. For a principal whose reach spans BOTH
// governed companies (CONSOLIDATED, or two OPERATING_COMPANY grants), that single bucket row is a
// figure that silently mixes Taylor and Ventana money: the reader cannot tell whose exposure is
// 61+ days old. Operating company is never inferred in this system, so it must not be dissolved by
// a rollup either.
//
// This does NOT re-decide what aging means. It partitions the reads by their OWN governed
// `companyId` and hands each partition to the one bucketing rule above, so a company's buckets and
// the consolidated buckets can never disagree about the same invoice.
function summarizeArAgingByCompany(reads, nowMillis) {
    const partitions = new Map();
    for (const r of Array.isArray(reads) ? reads : []) {
        const key = companyKeyOf(r);
        const bucket = partitions.get(key);
        if (bucket)
            bucket.push(r);
        else
            partitions.set(key, [r]);
    }
    const out = {};
    for (const [key, list] of partitions) {
        const aged = summarizeArAging(list, nowMillis);
        // A company whose every invoice is settled ages nothing — it contributes no key rather than a
        // row of zeroes, exactly as summarizeArAging omits a currency with nothing owed.
        if (Object.keys(aged).length > 0)
            out[key] = aged;
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
//
// NEITHER ARE OPERATING COMPANIES — and until this breakdown existed, they were. The consolidated
// maps above answer "what does this account owe in total", which is a real question, but for a
// principal who can reach both governed companies they were the ONLY answer available: one figure
// silently spanning Taylor and Ventana, on rows that did not carry a company either. An account is
// not partitioned by operating company (an invoice's company comes from its Sales Order, so one
// account can trade with both), so this was not a theoretical blend.
//
// `byCompany` is that missing dimension, keyed by the invoice's OWN governed companyId with
// UNATTRIBUTED_COMPANY for facts that carry none. It is a partition, not a second opinion: summing
// its per-currency maps reproduces the consolidated maps EXACTLY, which is the property the tests
// pin. A surface that must not mix companies now has a figure it can show; one that legitimately
// wants the consolidated total still has it, and can now tell when that total spans more than one
// company instead of having to assume it does not.
function summarizeAccountAr(reads) {
    const list = Array.isArray(reads) ? reads : [];
    const billedByCurrency = {};
    const collectedByCurrency = {};
    const outstandingByCurrency = {};
    const byCompany = {};
    let openCount = 0;
    let overdueCount = 0;
    for (const r of list) {
        const currency = r.currency ?? "UNSPECIFIED";
        // The consolidated totals and the company slice are accumulated from the SAME row in the SAME
        // pass, so the partition cannot drift from the whole it partitions.
        const company = (byCompany[companyKeyOf(r)] ??= {
            count: 0, openCount: 0, overdueCount: 0,
            billedByCurrency: {}, collectedByCurrency: {}, outstandingByCurrency: {},
        });
        company.count += 1;
        billedByCurrency[currency] = (billedByCurrency[currency] ?? 0) + nn(r.totalMinor);
        company.billedByCurrency[currency] = (company.billedByCurrency[currency] ?? 0) + nn(r.totalMinor);
        collectedByCurrency[currency] = (collectedByCurrency[currency] ?? 0) + nn(r.appliedMinor);
        company.collectedByCurrency[currency] = (company.collectedByCurrency[currency] ?? 0) + nn(r.appliedMinor);
        if (r.outstandingMinor > 0) {
            openCount += 1;
            company.openCount += 1;
            outstandingByCurrency[currency] = (outstandingByCurrency[currency] ?? 0) + r.outstandingMinor;
            company.outstandingByCurrency[currency] = (company.outstandingByCurrency[currency] ?? 0) + r.outstandingMinor;
        }
        if (r.arPosition === "OVERDUE") {
            overdueCount += 1;
            company.overdueCount += 1;
        }
    }
    const companyIds = Object.keys(byCompany).sort();
    return {
        count: list.length, openCount, overdueCount,
        billedByCurrency, collectedByCurrency, outstandingByCurrency,
        byCompany, companyIds, spansMultipleCompanies: companyIds.length > 1,
    };
}
//# sourceMappingURL=financeReadProjection.js.map