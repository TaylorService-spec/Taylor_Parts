"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SETTLEMENT_DIRECTION = exports.SETTLES = exports.SETTLEMENT_KINDS = void 0;
exports.recordFinancialSettlement = recordFinancialSettlement;
exports.applyFinancialSettlement = applyFinancialSettlement;
exports.reverseSettlementApplication = reverseSettlementApplication;
exports.voidFinancialSettlement = voidFinancialSettlement;
exports.reconcileFinancialSettlement = reconcileFinancialSettlement;
exports.readSettlementOn = readSettlementOn;
exports.readSettlement = readSettlement;
const node_crypto_1 = require("node:crypto");
const financeFoundation_1 = require("./financeFoundation");
exports.SETTLEMENT_KINDS = Object.freeze(["CUSTOMER_PAYMENT", "PROVIDER_FUNDING", "VENDOR_PAYMENT", "INTERCOMPANY_PAYMENT", "INTERCOMPANY_RECEIPT"]);
const DIRECTION = Object.freeze({
    CUSTOMER_PAYMENT: "RECEIPT", PROVIDER_FUNDING: "RECEIPT", INTERCOMPANY_RECEIPT: "RECEIPT", VENDOR_PAYMENT: "DISBURSEMENT", INTERCOMPANY_PAYMENT: "DISBURSEMENT",
});
exports.SETTLEMENT_DIRECTION = DIRECTION;
/** Which obligation kind each settlement kind settles (the database enforces the same pairing). */
exports.SETTLES = Object.freeze({
    CUSTOMER_PAYMENT: "RECEIVABLE", PROVIDER_FUNDING: "FUNDING_RECEIVABLE", VENDOR_PAYMENT: "PAYABLE",
    INTERCOMPANY_PAYMENT: "INTERCOMPANY_PAYABLE", INTERCOMPANY_RECEIPT: "INTERCOMPANY_RECEIVABLE",
});
const METHODS = ["CHECK", "ACH", "WIRE", "CARD", "CASH", "OTHER"];
const refuse = (code, category, message) => {
    throw new financeFoundation_1.FinanceFoundationError(code, category, message);
};
const text = (v, name, max = 200) => {
    if (typeof v !== "string" || v.trim() === "" || v.length > max)
        refuse(`${name.toUpperCase()}_REQUIRED`, "INVALID_INPUT", `${name} is required`);
    return v.trim();
};
const optText = (v, name, max = 200) => (v === undefined || v === null ? null : text(v, name, max));
function only(i, allowed) {
    const extra = Object.keys(i ?? {}).filter((k) => !allowed.includes(k));
    if (extra.length > 0)
        refuse("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `not accepted: ${extra.sort().join(", ")}`);
}
const positiveMinor = (v, name) => {
    if (!Number.isSafeInteger(v) || v <= 0)
        refuse("AMOUNT_INVALID", "INVALID_INPUT", `${name} is a positive whole number of minor units`);
    return BigInt(v);
};
async function tx(pool, fn) {
    const c = await pool.connect();
    try {
        await c.query("BEGIN");
        const out = await fn(c);
        await c.query("COMMIT");
        return out;
    }
    catch (err) {
        await c.query("ROLLBACK").catch(() => undefined);
        if (err instanceof financeFoundation_1.FinanceFoundationError)
            throw err;
        const m = /^([A-Z][A-Z0-9_]+):\s*(.*)$/s.exec(err?.message ?? "");
        if (m)
            refuse(m[1], m[1].includes("NOT_FOUND") ? "NOT_FOUND" : "CONFLICT", m[2]);
        throw err;
    }
    finally {
        c.release();
    }
}
/** The company's business date today (its governed time zone, #203). */
async function businessToday(db, tenantId, companyId) {
    const { rows } = await db.query(`SELECT to_char(eos_policy.operating_company_business_date($1, $2, now()), 'YYYY-MM-DD') AS d`, [tenantId, companyId]);
    return String(rows[0].d);
}
/** A DATE column as YYYY-MM-DD. node-postgres parses DATE as LOCAL midnight, so the local parts are the stored date. */
const dateOnly = (v) => {
    if (typeof v === "string")
        return v.slice(0, 10);
    const d = v;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const settlementView = (r, b) => Object.freeze({
    id: String(r.id), operatingCompanyId: String(r.operating_company_id), counterpartyId: String(r.counterparty_id), kind: String(r.kind),
    direction: String(r.direction), amountMinor: String(r.amount_minor), currency: String(r.currency),
    businessDate: dateOnly(r.business_date),
    recordedAt: new Date(r.recorded_at).toISOString(), sourceReference: String(r.source_reference), method: r.method ?? null, status: String(r.status),
    correlationId: r.correlation_id ?? null, replacesSettlementId: r.replaces_settlement_id ?? null, notes: r.notes ?? null, recordedBy: String(r.recorded_by),
    voidReason: r.void_reason ?? null,
    ...(b ? { appliedMinor: String(b.applied_minor), unappliedMinor: String(b.unapplied_minor) } : {}),
});
async function recordFinancialSettlement(pool, actor, input) {
    only(input, ["operatingCompanyId", "counterparty", "kind", "amountMinor", "currency", "businessDate", "sourceReference",
        "method", "correlationId", "notes", "replacesSettlementId", "idempotencyKey"]);
    const kind = input.kind;
    if (!exports.SETTLEMENT_KINDS.includes(kind))
        refuse("SETTLEMENT_KIND_INVALID", "INVALID_INPUT", `kind is one of ${exports.SETTLEMENT_KINDS.join(", ")}`);
    const amount = positiveMinor(input.amountMinor, "amountMinor");
    if (typeof input.currency !== "string" || !/^[A-Z]{3}$/.test(input.currency))
        refuse("CURRENCY_INVALID", "INVALID_INPUT", "currency is an ISO 4217 code");
    const reference = text(input.sourceReference, "sourceReference");
    const method = input.method === undefined || input.method === null ? null : (METHODS.includes(String(input.method)) ? String(input.method)
        : refuse("METHOD_INVALID", "INVALID_INPUT", `method is one of ${METHODS.join(", ")}`));
    const key = text(input.idempotencyKey, "idempotencyKey");
    const cp = input.counterparty;
    if (!cp || typeof cp !== "object")
        refuse("COUNTERPARTY_REQUIRED", "INVALID_INPUT", "counterparty is { kind: EXTERNAL_ORGANIZATION, crmAccountId } or { kind: INTERNAL_OPERATING_COMPANY, operatingCompanyId }");
    if (input.businessDate !== undefined && (typeof input.businessDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.businessDate))) {
        refuse("BUSINESS_DATE_INVALID", "INVALID_INPUT", "businessDate is YYYY-MM-DD");
    }
    const fingerprint = (0, node_crypto_1.createHash)("sha256").update(JSON.stringify([input.operatingCompanyId, cp, kind, String(amount), input.currency, input.businessDate ?? null,
        reference, method, input.correlationId ?? null, input.notes ?? null, input.replacesSettlementId ?? null])).digest("hex");
    return tx(pool, async (c) => {
        const { rows: prior } = await c.query(`SELECT s.*, b.applied_minor, b.unapplied_minor FROM eos_finance.settlements s
      JOIN eos_finance.settlement_balances b ON b.tenant_id = s.tenant_id AND b.settlement_id = s.id WHERE s.tenant_id = $1 AND s.idempotency_key = $2`, [actor.tenantId, key]);
        if (prior[0]) {
            if (prior[0].request_fingerprint !== fingerprint)
                refuse("IDEMPOTENCY_KEY_REUSED", "CONFLICT", "that idempotency key recorded a different settlement");
            return Object.freeze({ outcome: "replayed", settlement: settlementView(prior[0], prior[0]) });
        }
        const company = await (0, financeFoundation_1.resolveOperatingCompany)(c, actor.tenantId, input.operatingCompanyId);
        const counterparty = cp.kind === "EXTERNAL_ORGANIZATION" ? await (0, financeFoundation_1.ensureExternalCounterparty)(c, actor, cp.crmAccountId)
            : cp.kind === "INTERNAL_OPERATING_COMPANY" ? await (0, financeFoundation_1.ensureInternalCounterparty)(c, actor, cp.operatingCompanyId)
                : refuse("COUNTERPARTY_REQUIRED", "INVALID_INPUT", "counterparty.kind is EXTERNAL_ORGANIZATION or INTERNAL_OPERATING_COMPANY");
        const today = await businessToday(c, actor.tenantId, company);
        const businessDate = input.businessDate ?? today;
        // EOS records evidence of a settlement that HAPPENED: never a future one.
        if (businessDate > today)
            refuse("BUSINESS_DATE_IN_FUTURE", "INVALID_INPUT", `a settlement is recorded on or before the company's business date (${today})`);
        let replaces = null;
        if (input.replacesSettlementId !== undefined && input.replacesSettlementId !== null) {
            replaces = text(input.replacesSettlementId, "replacesSettlementId");
            const { rows: old } = await c.query(`SELECT * FROM eos_finance.settlements WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [actor.tenantId, replaces]);
            const o = old[0] ?? refuse("SETTLEMENT_NOT_FOUND", "NOT_FOUND", "the settlement to replace does not exist");
            if (o.status !== "VOID")
                refuse("SETTLEMENT_NOT_VOID", "PRECONDITION_FAILED", "only a VOID settlement is replaced");
            const { rowCount: replacedAlready } = await c.query(`SELECT 1 FROM eos_finance.settlements WHERE tenant_id = $1 AND replaces_settlement_id = $2`, [actor.tenantId, replaces]);
            if (replacedAlready)
                refuse("SETTLEMENT_ALREADY_REPLACED", "CONFLICT", "that VOID settlement already has its replacement");
            if (o.operating_company_id !== company || o.counterparty_id !== counterparty.id || o.kind !== kind) {
                refuse("SETTLEMENT_REPLACEMENT_MISMATCH", "PRECONDITION_FAILED", "a replacement keeps the company, counterparty and kind");
            }
        }
        const id = `stl_${(0, node_crypto_1.randomUUID)()}`;
        await c.query(`INSERT INTO eos_finance.settlements (id, tenant_id, operating_company_id, counterparty_id, kind, direction, amount_minor, currency, business_date,
          source_reference, method, correlation_id, replaces_settlement_id, notes, idempotency_key, request_fingerprint, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`, [id, actor.tenantId, company, counterparty.id, kind, DIRECTION[kind], amount.toString(), input.currency, businessDate, reference, method,
            optText(input.correlationId, "correlationId"), replaces, optText(input.notes, "notes", 2000), key, fingerprint, actor.principalId]);
        return Object.freeze({ outcome: "recorded", settlement: await readSettlementOn(c, actor.tenantId, id) });
    });
}
// ════════════════════ apply ════════════════════
/** A financed sale's arrangement becomes FUNDED once its FUNDING_RECEIVABLE is fully settled by applied provider funding. */
async function markFundedIfFullyReceived(c, actor, obligationId, settlementId) {
    const b = await (0, financeFoundation_1.readObligationBalance)(c, actor.tenantId, obligationId);
    if (!b || b.kind !== "FUNDING_RECEIVABLE" || b.outstandingMinor !== 0n)
        return null;
    const { rows } = await c.query(`SELECT fa.id, fa.status FROM eos_finance.obligations o JOIN eos_finance.billing_packages p ON p.tenant_id = o.tenant_id AND p.id = o.source_record_id
       JOIN eos_commercial.financing_arrangements fa ON fa.tenant_id = p.tenant_id AND fa.id = p.financing_arrangement_id
      WHERE o.tenant_id = $1 AND o.id = $2 AND o.source_domain = 'BILLING_PACKAGE' FOR UPDATE OF fa`, [actor.tenantId, obligationId]);
    const fa = rows[0];
    if (!fa || fa.status !== "FUNDING_ENTITLED")
        return null;
    await c.query(`UPDATE eos_commercial.financing_arrangements SET status = 'FUNDED', updated_by = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, fa.id, actor.principalId]);
    await c.query(`INSERT INTO eos_commercial.financing_arrangement_events (id, tenant_id, arrangement_id, from_status, to_status, reason, provider_reference, evidence_id, recorded_by, idempotency_key)
     VALUES ($1,$2,$3,'FUNDING_ENTITLED','FUNDED',$4,NULL,NULL,$5,$6)`, [`fev_${(0, node_crypto_1.randomUUID)()}`, actor.tenantId, fa.id, `provider funding received and applied in full (settlement ${settlementId})`, actor.principalId, `funded:${obligationId}`]);
    return String(fa.id);
}
async function applyFinancialSettlement(pool, actor, input) {
    only(input, ["settlementId", "applications", "idempotencyKey"]);
    const settlementId = text(input.settlementId, "settlementId");
    const key = text(input.idempotencyKey, "idempotencyKey");
    if (!Array.isArray(input.applications) || input.applications.length === 0 || input.applications.length > 50) {
        refuse("APPLICATIONS_REQUIRED", "INVALID_INPUT", "applications is a list of 1-50 { obligationId, amountMinor }");
    }
    const items = input.applications.map((a) => {
        const o = (a ?? {});
        only(o, ["obligationId", "amountMinor"]);
        return { obligationId: text(o.obligationId, "obligationId"), amount: positiveMinor(o.amountMinor, "amountMinor") };
    });
    if (new Set(items.map((i) => i.obligationId)).size !== items.length)
        refuse("APPLICATION_DUPLICATED", "INVALID_INPUT", "an obligation appears once per application request");
    return tx(pool, async (c) => {
        const { rows: s } = await c.query(`SELECT * FROM eos_finance.settlements WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [actor.tenantId, settlementId]);
        const st = s[0] ?? refuse("SETTLEMENT_NOT_FOUND", "NOT_FOUND", "no settlement with that id");
        const out = [];
        const funded = [];
        for (const item of items) {
            const appKey = `${key}:${item.obligationId}`;
            const { rows: done } = await c.query(`SELECT * FROM eos_finance.settlement_applications WHERE tenant_id = $1 AND idempotency_key = $2`, [actor.tenantId, appKey]);
            if (done[0]) {
                if (done[0].settlement_id !== settlementId || BigInt(done[0].amount_minor) !== item.amount)
                    refuse("IDEMPOTENCY_KEY_REUSED", "CONFLICT", "that key applied something different");
                out.push({ outcome: "replayed", applicationId: String(done[0].id), obligationId: item.obligationId });
                continue;
            }
            const applicationId = `sap_${(0, node_crypto_1.randomUUID)()}`;
            const fact = await (0, financeFoundation_1.insertSettlementFactOn)(c, actor, { obligationId: item.obligationId, amountMinor: item.amount,
                effectiveAt: new Date(`${dateOnly(st.business_date)}T00:00:00Z`),
                idempotencyKey: `stlapp:${applicationId}`, sourceRecordId: settlementId, correlationId: st.correlation_id ?? null });
            await c.query(`INSERT INTO eos_finance.settlement_applications (id, tenant_id, settlement_id, obligation_id, amount_minor, settlement_fact_id, idempotency_key, applied_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [applicationId, actor.tenantId, settlementId, item.obligationId, item.amount.toString(), fact.fact.id, appKey, actor.principalId]);
            const f = await markFundedIfFullyReceived(c, actor, item.obligationId, settlementId);
            if (f)
                funded.push(f);
            out.push({ outcome: "recorded", applicationId, obligationId: item.obligationId });
        }
        const balances = await Promise.all(items.map((i) => (0, financeFoundation_1.readObligationBalance)(c, actor.tenantId, i.obligationId)));
        return Object.freeze({ settlement: await readSettlementOn(c, actor.tenantId, settlementId), applications: out, fundedArrangements: funded,
            obligations: balances.map((b) => b && { obligationId: b.obligationId, kind: b.kind, status: b.status, outstandingMinor: b.outstandingMinor.toString() }) });
    });
}
// ════════════════════ correct ════════════════════
async function reverseSettlementApplication(pool, actor, input) {
    only(input, ["applicationId", "reason", "idempotencyKey"]);
    const applicationId = text(input.applicationId, "applicationId");
    const reason = text(input.reason, "reason", 500);
    const key = text(input.idempotencyKey, "idempotencyKey");
    return tx(pool, async (c) => {
        const { rows } = await c.query(`SELECT * FROM eos_finance.settlement_applications WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [actor.tenantId, applicationId]);
        const a = rows[0] ?? refuse("APPLICATION_NOT_FOUND", "NOT_FOUND", "no settlement application with that id");
        if (a.status === "REVERSED")
            return Object.freeze({ outcome: "replayed", applicationId, settlement: await readSettlementOn(c, actor.tenantId, a.settlement_id) });
        // A FUNDED arrangement is terminal: un-receiving provider money is a provider-side correction, never an EOS rewrite.
        const { rows: fa } = await c.query(`SELECT fa.status FROM eos_finance.obligations o JOIN eos_finance.billing_packages p ON p.tenant_id = o.tenant_id AND p.id = o.source_record_id
         JOIN eos_commercial.financing_arrangements fa ON fa.tenant_id = p.tenant_id AND fa.id = p.financing_arrangement_id
        WHERE o.tenant_id = $1 AND o.id = $2 AND o.kind = 'FUNDING_RECEIVABLE'`, [actor.tenantId, a.obligation_id]);
        if (fa[0]?.status === "FUNDED")
            refuse("FINANCING_FUNDED", "CONFLICT", "the arrangement is FUNDED; reversing provider funding is a provider-side correction");
        const reversal = await (0, financeFoundation_1.reverseFactOn)(c, actor, { factId: String(a.settlement_fact_id), reason, idempotencyKey: `stlrev:${applicationId}:${key}` });
        await c.query(`UPDATE eos_finance.settlement_applications SET status = 'REVERSED', reversal_fact_id = $3, reversed_by = $4, reversed_at = now(), reversal_reason = $5
      WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, applicationId, reversal.fact.id, actor.principalId, reason]);
        const b = await (0, financeFoundation_1.readObligationBalance)(c, actor.tenantId, String(a.obligation_id));
        return Object.freeze({ outcome: "reversed", applicationId, reversalFactId: reversal.fact.id, settlement: await readSettlementOn(c, actor.tenantId, a.settlement_id),
            obligation: b && { obligationId: b.obligationId, status: b.status, outstandingMinor: b.outstandingMinor.toString() } });
    });
}
async function voidFinancialSettlement(pool, actor, input) {
    only(input, ["settlementId", "reason"]);
    const settlementId = text(input.settlementId, "settlementId");
    const reason = text(input.reason, "reason", 500);
    return tx(pool, async (c) => {
        const { rows } = await c.query(`SELECT * FROM eos_finance.settlements WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [actor.tenantId, settlementId]);
        const s = rows[0] ?? refuse("SETTLEMENT_NOT_FOUND", "NOT_FOUND", "no settlement with that id");
        if (s.status === "VOID")
            return Object.freeze({ outcome: "replayed", settlement: await readSettlementOn(c, actor.tenantId, settlementId) });
        await c.query(`UPDATE eos_finance.settlements SET status = 'VOID', voided_by = $3, voided_at = now(), void_reason = $4 WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, settlementId, actor.principalId, reason]);
        return Object.freeze({ outcome: "voided", settlement: await readSettlementOn(c, actor.tenantId, settlementId) });
    });
}
// ════════════════════ reconcile ════════════════════
async function reconcileFinancialSettlement(pool, actor, input) {
    only(input, ["settlementId", "externalReference", "externalAmountMinor", "reason", "idempotencyKey"]);
    const settlementId = text(input.settlementId, "settlementId");
    const reference = text(input.externalReference, "externalReference");
    if (!Number.isSafeInteger(input.externalAmountMinor) || input.externalAmountMinor < 0) {
        refuse("AMOUNT_INVALID", "INVALID_INPUT", "externalAmountMinor is a whole number of minor units");
    }
    const key = text(input.idempotencyKey, "idempotencyKey");
    return tx(pool, async (c) => {
        const { rows: prior } = await c.query(`SELECT * FROM eos_finance.settlement_reconciliations WHERE tenant_id = $1 AND idempotency_key = $2`, [actor.tenantId, key]);
        if (prior[0])
            return Object.freeze({ outcome: "replayed", reconciliation: reconciliationView(prior[0]) });
        const { rows } = await c.query(`SELECT * FROM eos_finance.settlements WHERE tenant_id = $1 AND id = $2 FOR SHARE`, [actor.tenantId, settlementId]);
        const s = rows[0] ?? refuse("SETTLEMENT_NOT_FOUND", "NOT_FOUND", "no settlement with that id");
        if (s.status === "VOID")
            refuse("SETTLEMENT_VOID", "PRECONDITION_FAILED", "a VOID settlement is not reconciled");
        const outcome = BigInt(input.externalAmountMinor) === BigInt(s.amount_minor) ? "RECONCILED" : "MISMATCH";
        const reason = optText(input.reason, "reason", 500);
        if (outcome === "MISMATCH" && reason === null)
            refuse("REASON_REQUIRED", "INVALID_INPUT", "a mismatch states what the external system shows");
        const { rows: done } = await c.query(`INSERT INTO eos_finance.settlement_reconciliations (id, tenant_id, settlement_id, external_reference, external_amount_minor, outcome, reason, idempotency_key, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [`srec_${(0, node_crypto_1.randomUUID)()}`, actor.tenantId, settlementId, reference, String(input.externalAmountMinor), outcome, reason, key, actor.principalId]);
        return Object.freeze({ outcome: "recorded", reconciliation: reconciliationView(done[0]) });
    });
}
const reconciliationView = (r) => Object.freeze({
    id: String(r.id), settlementId: String(r.settlement_id), externalReference: String(r.external_reference), externalAmountMinor: String(r.external_amount_minor),
    outcome: String(r.outcome), reason: r.reason ?? null, recordedBy: String(r.recorded_by), recordedAt: new Date(r.recorded_at).toISOString(),
});
// ════════════════════ reads ════════════════════
async function readSettlementOn(db, tenantId, settlementId) {
    const { rows } = await db.query(`SELECT s.*, b.applied_minor, b.unapplied_minor FROM eos_finance.settlements s
    JOIN eos_finance.settlement_balances b ON b.tenant_id = s.tenant_id AND b.settlement_id = s.id WHERE s.tenant_id = $1 AND s.id = $2`, [tenantId, settlementId]);
    if (!rows[0])
        return refuse("SETTLEMENT_NOT_FOUND", "NOT_FOUND", "no settlement with that id");
    const { rows: apps } = await db.query(`SELECT * FROM eos_finance.settlement_applications WHERE tenant_id = $1 AND settlement_id = $2 ORDER BY applied_at, id`, [tenantId, settlementId]);
    const { rows: recs } = await db.query(`SELECT * FROM eos_finance.settlement_reconciliations WHERE tenant_id = $1 AND settlement_id = $2 ORDER BY recorded_at, id`, [tenantId, settlementId]);
    const latest = recs[recs.length - 1];
    return Object.freeze({
        ...settlementView(rows[0], rows[0]),
        reconciliationStatus: rows[0].status === "VOID" ? "NOT_APPLICABLE" : latest ? String(latest.outcome) : "UNRECONCILED",
        applications: apps.map((a) => Object.freeze({ id: String(a.id), obligationId: String(a.obligation_id), amountMinor: String(a.amount_minor), status: String(a.status),
            appliedBy: String(a.applied_by), appliedAt: new Date(a.applied_at).toISOString(), reversalReason: a.reversal_reason ?? null })),
        reconciliations: recs.map(reconciliationView),
    });
}
async function readSettlement(pool, tenantId, settlementId) {
    return readSettlementOn(pool, tenantId, text(settlementId, "settlementId"));
}
//# sourceMappingURL=settlement.js.map