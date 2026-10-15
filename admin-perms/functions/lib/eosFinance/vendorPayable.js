"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.establishReceiptPayableOn = establishReceiptPayableOn;
exports.retireReceiptPayableOn = retireReceiptPayableOn;
const financeFoundation_1 = require("./financeFoundation");
const obligationHandoff_1 = require("./obligationHandoff");
const addDays = (isoDate, days) => {
    const d = new Date(`${isoDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
};
async function establishReceiptPayableOn(c, actor, receivingId) {
    const { rows: rcv } = await c.query(`SELECT r.id, r.status::text AS status, r.received_at, r.source_purchase_order_id, po.supplier_kind, po.supplier_id, po.purchasing_operating_company_id
       FROM eos_ops.receiving_orders r LEFT JOIN eos_ops.purchase_orders po ON po.tenant_id = r.tenant_id AND po.id = r.source_purchase_order_id
      WHERE r.tenant_id = $1 AND r.id = $2`, [actor.tenantId, receivingId]);
    const r = rcv[0];
    if (!r || r.status === "CANCELLED" || r.supplier_kind !== "EXTERNAL_ORGANIZATION")
        return { status: "NOT_VENDOR_PURCHASE" };
    const { rows: lines } = await c.query(`SELECT line_id FROM eos_ops.receiving_order_lines WHERE tenant_id = $1 AND receiving_order_id = $2`, [actor.tenantId, receivingId]);
    const { rows: ev } = await c.query(`SELECT operating_company_id, extended_cost_minor, currency FROM eos_finance.inventory_acquisition_costs WHERE tenant_id = $1 AND receiving_id = $2`, [actor.tenantId, receivingId]);
    if (lines.length === 0 || ev.length !== lines.length)
        return { status: "COST_EVIDENCE_MISSING" };
    const currencies = new Set(ev.map((e) => e.currency));
    const companies = new Set(ev.map((e) => e.operating_company_id));
    if (currencies.size !== 1 || companies.size !== 1) {
        throw new financeFoundation_1.FinanceFoundationError("RECEIPT_PAYABLE_MIXED", "PRECONDITION_FAILED", "one receipt's payable carries one company and one currency");
    }
    const amount = ev.reduce((n, e) => n + BigInt(e.extended_cost_minor), 0n);
    if (amount === 0n)
        return { status: "NOT_REQUIRED_ZERO_AMOUNT" };
    const company = String(ev[0].operating_company_id);
    const supplier = await (0, financeFoundation_1.counterpartyForSupplier)(c, actor, r.supplier_id ?? null);
    if (!supplier)
        return { status: "SUPPLIER_ORGANIZATION_UNGOVERNED" };
    const { rows: bd } = await c.query(`SELECT to_char(eos_policy.operating_company_business_date($1, $2, $3::timestamptz), 'YYYY-MM-DD') AS d`, [actor.tenantId, company, r.received_at]);
    const businessDate = String(bd[0].d);
    const { rows: terms } = await c.query(`SELECT payment_terms_net_days FROM eos_finance.counterparty_company_profiles
    WHERE tenant_id = $1 AND counterparty_id = $2 AND operating_company_id = $3 AND status = 'ACTIVE'`, [actor.tenantId, supplier.id, company]);
    const netDays = terms[0]?.payment_terms_net_days ?? null;
    const dueOn = netDays === null ? null : addDays(businessDate, Number(netDays));
    const opened = await (0, financeFoundation_1.openObligationOn)(c, actor, {
        operatingCompanyId: company, counterpartyId: supplier.id, kind: "PAYABLE", currency: String(ev[0].currency), sourceDomain: "RECEIVING",
        sourceRecordId: receivingId, originationAmountMinor: amount, basis: "VENDOR_PURCHASE_RECEIVED_NOT_INVOICED",
        effectiveAt: new Date(`${businessDate}T00:00:00Z`), idempotencyKey: `ap:rcv:${receivingId}`, correlationId: r.source_purchase_order_id ?? null, dueOn,
    });
    await (0, obligationHandoff_1.ensureObligationHandoffOn)(c, actor, { obligationId: opened.obligationId, payloadKind: "VENDOR_PAYABLE", correlationId: r.source_purchase_order_id ?? null });
    return { status: "ESTABLISHED", obligationId: opened.obligationId, dueOn };
}
/** A corrected / cancelled receipt voids its payable (reversing facts) and supersedes its handoff -- refused once settled or delivered. */
async function retireReceiptPayableOn(c, actor, input) {
    const { rows } = await c.query(`SELECT id, status FROM eos_finance.obligations WHERE tenant_id = $1 AND idempotency_key = $2`, [actor.tenantId, `ap:rcv:${input.receivingId}`]);
    const o = rows[0];
    if (!o || o.status === "VOID")
        return null;
    await (0, obligationHandoff_1.supersedeObligationHandoffOn)(c, actor, String(o.id));
    await (0, financeFoundation_1.voidObligationOn)(c, actor, { obligationId: String(o.id), reason: input.reason, idempotencyKey: `ap:void:${input.correctionId}` });
    return Object.freeze({ obligationId: String(o.id) });
}
//# sourceMappingURL=vendorPayable.js.map