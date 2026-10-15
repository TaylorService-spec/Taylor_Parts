"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OBLIGATION_PAYLOAD_CONTRACT_VERSION = exports.OBLIGATION_PAYLOAD_CONTRACT = void 0;
exports.ensureObligationHandoffOn = ensureObligationHandoffOn;
exports.supersedeObligationHandoffOn = supersedeObligationHandoffOn;
exports.buildObligationPayload = buildObligationPayload;
const node_crypto_1 = require("node:crypto");
const financeFoundation_1 = require("./financeFoundation");
const operatingCompanyBusinessTime_1 = require("../eosOps/operatingCompanyBusinessTime");
exports.OBLIGATION_PAYLOAD_CONTRACT = "eos.accounting.operational-obligation";
exports.OBLIGATION_PAYLOAD_CONTRACT_VERSION = 1;
const refuse = (code, category, message) => {
    throw new financeFoundation_1.FinanceFoundationError(code, category, message);
};
const dateOnly = (v) => {
    if (v === null || v === undefined)
        return null;
    if (typeof v === "string")
        return v.slice(0, 10);
    const d = v;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
/** One handoff for ONE obligation, toward its own company's destination (idempotent). */
async function ensureObligationHandoffOn(c, actor, input) {
    const { rows: ob } = await c.query(`SELECT o.*, b.originated_minor FROM eos_finance.obligations o
    JOIN eos_finance.obligation_balances b ON b.tenant_id = o.tenant_id AND b.obligation_id = o.id WHERE o.tenant_id = $1 AND o.id = $2`, [actor.tenantId, input.obligationId]);
    const o = ob[0] ?? refuse("OBLIGATION_NOT_FOUND", "NOT_FOUND", "no obligation with that id");
    const destination = await (0, financeFoundation_1.resolveAccountingDestination)(c, actor.tenantId, o.operating_company_id);
    // The handoff's identity fingerprint: what is handed off (the payload adds the destination at delivery time).
    const fingerprint = (0, node_crypto_1.createHash)("sha256").update(JSON.stringify([o.id, o.kind, String(o.originated_minor), o.currency, o.operating_company_id, o.counterparty_id])).digest("hex");
    await c.query(`INSERT INTO eos_finance.accounting_handoffs (id, tenant_id, operating_company_id, billing_package_id, obligation_id, accounting_destination_id,
        payload_kind, payload_version, payload_fingerprint, status, readiness_exceptions, idempotency_key, correlation_id, created_by)
     VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (tenant_id, idempotency_key) DO NOTHING`, [`aho_${(0, node_crypto_1.randomUUID)()}`, actor.tenantId, o.operating_company_id, o.id, destination?.id ?? null, input.payloadKind, exports.OBLIGATION_PAYLOAD_CONTRACT_VERSION,
        fingerprint, destination ? "READY_FOR_DELIVERY" : "PENDING_DESTINATION", destination ? [] : ["ACCOUNTING_DESTINATION_MISSING"],
        `handoff:obl:${o.id}`, input.correlationId, actor.principalId]);
    const { rows: h } = await c.query(`SELECT id, status, readiness_exceptions FROM eos_finance.accounting_handoffs WHERE tenant_id = $1 AND idempotency_key = $2`, [actor.tenantId, `handoff:obl:${o.id}`]);
    return Object.freeze({ id: String(h[0].id), status: String(h[0].status), readinessExceptions: Object.freeze([...h[0].readiness_exceptions]) });
}
/**
 * The obligation's source was superseded: its handoff is SUPERSEDED (open delivery exceptions resolved). FAILS CLOSED once the
 * handoff is in delivery or ACKNOWLEDGED -- the provider may hold a document, and reversing that is a provider act.
 */
async function supersedeObligationHandoffOn(c, actor, obligationId) {
    const { rows } = await c.query(`SELECT id, status FROM eos_finance.accounting_handoffs WHERE tenant_id = $1 AND obligation_id = $2 AND billing_package_id IS NULL FOR UPDATE`, [actor.tenantId, obligationId]);
    const h = rows[0];
    if (!h)
        return;
    if (h.status === "DELIVERY_IN_PROGRESS" || h.status === "ACKNOWLEDGED") {
        refuse("ACCOUNTING_HANDOFF_DELIVERED", "CONFLICT", `the obligation's accounting handoff is ${h.status}; it cannot be superseded without a provider-side correction`);
    }
    await c.query(`UPDATE eos_finance.accounting_handoff_exceptions SET status = 'RESOLVED', resolved_by = $3, resolved_at = now(), resolution = 'SUPERSEDED_BY_CORRECTED_PACKAGE'
    WHERE tenant_id = $1 AND handoff_id = $2 AND status = 'OPEN'`, [actor.tenantId, h.id, actor.principalId]);
    if (h.status !== "SUPERSEDED") {
        await c.query(`UPDATE eos_finance.accounting_handoffs SET status = 'SUPERSEDED', updated_at = now() WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, h.id]);
    }
}
/** The provider-neutral payload of an obligation-anchored handoff, fail closed (the obligation is the handoff's own, not VOID). */
async function buildObligationPayload(db, tenantId, h, d) {
    const { rows: or } = await db.query(`SELECT o.*, b.originated_minor FROM eos_finance.obligations o
    JOIN eos_finance.obligation_balances b ON b.tenant_id = o.tenant_id AND b.obligation_id = o.id WHERE o.tenant_id = $1 AND o.id = $2`, [tenantId, h.obligation_id]);
    const o = or[0];
    const expected = h.payload_kind === "INTERCOMPANY_OBLIGATION" ? ["INTERCOMPANY_PAYABLE", "INTERCOMPANY_RECEIVABLE"] : ["PAYABLE"];
    if (!o || o.status === "VOID" || !expected.includes(o.kind) || o.operating_company_id !== h.operating_company_id) {
        refuse("PAYLOAD_OBLIGATION_MISMATCH", "PRECONDITION_FAILED", "the handoff's obligation is not exactly its own, live obligation -- nothing is delivered");
    }
    const { rows: cr } = await db.query(`SELECT c.id, c.kind, c.crm_account_id, c.operating_company_id, a.name FROM eos_finance.financial_counterparties c
       LEFT JOIN eos_crm.accounts a ON a.tenant_id = c.tenant_id AND a.id = c.crm_account_id WHERE c.tenant_id = $1 AND c.id = $2`, [tenantId, o.counterparty_id]);
    const cp = cr[0];
    // The obligation date is the ORIGINATING company's business date of its first origination fact (the governed business-time
    // resolver, never a hardcoded zone or a UTC calendar cut).
    const { rows: oi } = await db.query(`SELECT min(effective_at) AS at FROM eos_finance.financial_facts
    WHERE tenant_id = $1 AND obligation_id = $2 AND fact_class = 'OBLIGATION' AND reverses_fact_id IS NULL`, [tenantId, o.id]);
    const obligationDate = oi[0]?.at ? await (0, operatingCompanyBusinessTime_1.businessDateOn)(db, tenantId, String(o.operating_company_id), oi[0].at) : null;
    const base = {
        contract: { name: exports.OBLIGATION_PAYLOAD_CONTRACT, version: 1 },
        semantics: "OPERATIONAL_OBLIGATION_NOT_AN_ACCOUNTING_DOCUMENT",
        handoff: { id: String(h.id), idempotencyKey: String(h.idempotency_key), correlationId: h.correlation_id ?? null },
        operatingCompany: { id: String(h.operating_company_id) },
        destination: { id: String(d.id), externalCompanyRef: d.external_company_ref ?? null },
        obligation: { id: String(o.id), kind: String(o.kind), amountMinor: BigInt(o.originated_minor).toString(), currency: String(o.currency),
            obligationDate, dueOn: dateOnly(o.due_on), sourceDomain: String(o.source_domain), sourceRecordId: String(o.source_record_id) },
        counterparty: { counterpartyId: String(cp.id), kind: String(cp.kind), crmAccountId: cp.crm_account_id ?? null, operatingCompanyId: cp.operating_company_id ?? null, name: cp.name ?? null },
    };
    if (h.payload_kind === "INTERCOMPANY_OBLIGATION") {
        const { rows: tr } = await db.query(`SELECT * FROM eos_finance.intercompany_transactions WHERE tenant_id = $1 AND id = $2`, [tenantId, o.source_record_id]);
        const t = tr[0] ?? refuse("PAYLOAD_OBLIGATION_MISMATCH", "PRECONDITION_FAILED", "the intercompany correlation is missing");
        const buyer = o.kind === "INTERCOMPANY_PAYABLE";
        return Object.freeze({ ...base, intercompany: { correlationId: String(t.id), buyerOperatingCompanyId: String(t.buyer_operating_company_id),
                sellerOperatingCompanyId: String(t.seller_operating_company_id), side: buyer ? "BUYER_PAYABLE" : "SELLER_RECEIVABLE",
                otherSideObligationId: (buyer ? t.seller_obligation_id : t.buyer_obligation_id) ?? null, purchaseOrderId: t.purchase_order_id ?? null, receivingId: String(t.source_record_id) } });
    }
    const { rows: rr } = await db.query(`SELECT r.id, r.source_purchase_order_id, po.supplier_id FROM eos_ops.receiving_orders r
    LEFT JOIN eos_ops.purchase_orders po ON po.tenant_id = r.tenant_id AND po.id = r.source_purchase_order_id WHERE r.tenant_id = $1 AND r.id = $2`, [tenantId, o.source_record_id]);
    return Object.freeze({ ...base, purchase: { receivingId: String(o.source_record_id), purchaseOrderId: rr[0]?.source_purchase_order_id ?? null, supplierId: rr[0]?.supplier_id ?? null } });
}
//# sourceMappingURL=obligationHandoff.js.map