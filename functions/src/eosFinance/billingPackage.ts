// THE EOS OPERATIONAL BILLING PACKAGE (DECISIONS #196; #145 / #191 §5). See migration 1764450000000 for the record.
//
// BILLING ELIGIBILITY -> OPERATIONAL BILLING PACKAGE, as a governed Finance CONSEQUENCE -- never a client act:
//   * prepared server-side when a Sales Order becomes ELIGIBLE IN FULL (Work Order completion composes it, in the
//     completion transaction, right after the Commercial fulfillment), and by the deterministic recovery
//     `prepareEligibleBillingPackages` for orders that became eligible some other way;
//   * no transport operation creates or edits a package, so no employee can manufacture a package or its amounts, and no
//     Sales or Service employee needs any Finance capability for it to exist.
//
// AMOUNTS come only from governed Commercial inputs, in integer minor units (BigInt), never floating point:
//   line     = billable quantity (the fulfilled quantity of an ELIGIBLE line) x the Sales Order line's accepted unit price;
//   charges  = the Agreement's shipping / install charge / tax / down payment / trade-in (none for a direct order);
//   total    = subtotal + shipping + install + tax;  balance = total - down payment - trade-in   (the Agreement's own arithmetic).
// A missing price is PRICE_EVIDENCE_MISSING; a missing tax value is TAX_EVIDENCE_MISSING -- the package is HELD with that
// exception and the dependent totals are NULL. Nothing absent is ever treated as zero (a governed 0 is a real 0).
//
// HELD, NEVER GUESSED: a Sales Order not ELIGIBLE in full gets no package (partial-billing policy is deferred); a LEASE /
// financed disposition is HELD (FINANCED_DISPOSITION_UNSUPPORTED) rather than billed as a direct sale; a company that does
// not resolve, or CONSOLIDATED, refuses. The customer is the obligor ONLY for a supported direct sale, by an explicit rule.
//
// IDEMPOTENT + IMMUTABLE: the same evidence yields the same package (replayed by content fingerprint); different evidence
// yields a NEW version and the previous one becomes SUPERSEDED -- its content never changes.
import type { Pool, PoolClient } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { ensureExternalCounterparty, FinanceFoundationError, openObligationOn, resolveAccountingDestination, resolveOperatingCompanyFromKey, voidObligationOn, type FinanceActor } from "./financeFoundation";
import { financedConsequenceOn, type FinancedConsequence } from "./financedSale";

type Queryable = Pick<PoolClient, "query">;

// DECISIONS #197 vocabulary: why a package is not READY, never collapsed into a generic "not ready".
export const BILLING_PACKAGE_EXCEPTIONS = Object.freeze([
  "PRICE_EVIDENCE_MISSING", "TAX_NOT_DETERMINED", "UNSUPPORTED_FINANCIAL_OBLIGOR",
  // DECISIONS #200 (financed sales): why a financed package is not READY.
  "FINANCING_NOT_AVAILABLE", "FINANCING_CONTRIBUTION_MISMATCH", "FINANCING_TRADE_IN_UNGOVERNED", "FINANCING_CURRENCY_MISMATCH", "FINANCED_AMOUNT_INVALID",
] as const);
/** Receivable / handoff consequence of a READY direct-sale package (DECISIONS #197). */
export interface ReceivableConsequence {
  readonly receivable: { readonly outcome: "recorded" | "replayed"; readonly obligationId: string } | { readonly outcome: "NOT_REQUIRED_ZERO_TOTAL" };
  readonly handoff: { readonly id: string; readonly status: string; readonly readinessExceptions: readonly string[] } | null;
}

export type BillingPackageOutcome =
  | { readonly outcome: "NOT_ELIGIBLE"; readonly salesOrderId: string; readonly eligibility: string }
  | { readonly outcome: "recorded" | "replayed" | "superseded"; readonly packageId: string; readonly version: number; readonly status: "READY" | "HELD";
      readonly readinessExceptions: readonly string[]; readonly totalMinor: string | null; readonly consequence: ReceivableConsequence | FinancedConsequence | null };

const big = (v: unknown): bigint | null => (v === null || v === undefined ? null : BigInt(v as string | number));
const str = (v: bigint | null): string | null => (v === null ? null : v.toString());

/** Prepare (or replay / supersede) the Operational Billing Package of ONE Sales Order, inside the caller's transaction. */
export async function prepareBillingPackageOn(c: Queryable, actor: FinanceActor, input: { readonly salesOrderId: string }): Promise<BillingPackageOutcome> {
  const { rows: so } = await c.query(
    `SELECT so.id, so.state::text AS state, so.operating_company_key, so.account_id, so.currency, so.sales_agreement_id,
            a.is_lease, a.shipping_minor, a.install_charge_minor, a.tax_minor, a.tax_evidence_status, a.down_payment_minor, a.trade_in_minor,
            fa.id AS financing_arrangement_id, fa.status AS financing_status, fa.financing_provider_account_id, fa.customer_contribution_minor,
            fa.currency AS financing_currency
       FROM eos_commercial.sales_orders so
       LEFT JOIN eos_commercial.sales_agreements a ON a.tenant_id = so.tenant_id AND a.id = so.sales_agreement_id
       LEFT JOIN eos_commercial.financing_arrangements fa ON fa.tenant_id = so.tenant_id AND fa.sales_agreement_id = so.sales_agreement_id
      WHERE so.tenant_id = $1 AND so.id = $2 FOR SHARE OF so`, [actor.tenantId, input.salesOrderId]);
  if (!so[0]) throw new FinanceFoundationError("SALES_ORDER_NOT_FOUND", "NOT_FOUND", "no Sales Order with that id");
  const o = so[0];
  const { rows: lines } = await c.query(
    `SELECT * FROM eos_commercial.sales_order_line_billing_eligibility WHERE tenant_id = $1 AND sales_order_id = $2 ORDER BY line_number`,
    [actor.tenantId, input.salesOrderId]);
  // PARTIAL BILLING IS DEFERRED: only an order ELIGIBLE in full (every line, and not cancelled) gets a package.
  const orderEligibility = lines.length === 0 ? "NOT_YET" : lines.some((l) => l.eligibility === "CANCELLED") ? "CANCELLED"
    : lines.every((l) => l.eligibility === "ELIGIBLE") ? "ELIGIBLE" : lines.some((l) => l.eligibility !== "NOT_YET") ? "PARTIALLY_ELIGIBLE" : "NOT_YET";
  if (orderEligibility !== "ELIGIBLE") return Object.freeze({ outcome: "NOT_ELIGIBLE" as const, salesOrderId: input.salesOrderId, eligibility: orderEligibility });

  // ONE governed company (fails closed; CONSOLIDATED refused by resolveOperatingCompany).
  const companyId = await resolveOperatingCompanyFromKey(c, actor.tenantId, o.operating_company_key);
  // A governed financing arrangement makes it a FINANCED_SALE (#200); a bare lease flag without one stays unsupported.
  const disposition = o.sales_agreement_id === null ? "DIRECT_ORDER" : o.financing_arrangement_id ? "FINANCED_SALE" : o.is_lease ? "LEASE" : "SALE";
  const exceptions: string[] = [];
  let counterpartyId: string | null = null;
  let providerCounterpartyId: string | null = null;
  let obligorBasis: "DIRECT_SALE_CUSTOMER" | "FINANCING_PROVIDER_FUNDED" | "UNRESOLVED" = "UNRESOLVED";
  if (disposition === "FINANCED_SALE") {
    // ONE sale, two payers (#200): the commercial customer stays the customer (counterparty for any contribution); the
    // financing provider is Taylor's counterparty for the financed amount.
    counterpartyId = (await ensureExternalCounterparty(c, actor, o.account_id)).id;
    providerCounterpartyId = (await ensureExternalCounterparty(c, actor, o.financing_provider_account_id)).id;
    obligorBasis = "FINANCING_PROVIDER_FUNDED";
    if (o.financing_status === "DECLINED" || o.financing_status === "CANCELLED") exceptions.push("FINANCING_NOT_AVAILABLE");
    // The contribution is the arrangement's stated amount and must be the Agreement's down payment -- never billed twice.
    if (BigInt(o.down_payment_minor ?? 0) !== BigInt(o.customer_contribution_minor)) exceptions.push("FINANCING_CONTRIBUTION_MISMATCH");
    // A trade-in on a financed sale has no ruled place in the composition: held, never guessed.
    if (BigInt(o.trade_in_minor ?? 0) !== 0n) exceptions.push("FINANCING_TRADE_IN_UNGOVERNED");
    if (o.financing_currency !== String(o.currency ?? "USD")) exceptions.push("FINANCING_CURRENCY_MISMATCH");
  } else if (disposition === "LEASE") {
    // A lease / financed disposition: NO obligor is assumed -- neither the customer nor the financing provider. Who Taylor
    // invoices, who remits, when Taylor is entitled and what a provider funds are not governed (DECISIONS #199); HELD.
    exceptions.push("UNSUPPORTED_FINANCIAL_OBLIGOR");
  } else {
    // A SUPPORTED DIRECT SALE: the commercial customer's organization is the obligor, by this explicit rule only.
    counterpartyId = (await ensureExternalCounterparty(c, actor, o.account_id)).id;
    obligorBasis = "DIRECT_SALE_CUSTOMER";
  }

  // Lines + lineage.
  const pkgLines = [];
  let subtotal: bigint | null = 0n;
  for (const l of lines) {
    const { rows: f } = await c.query(
      `SELECT array_agg(id ORDER BY id) AS ids, COALESCE(array_agg(DISTINCT source_work_order_id), '{}') AS wos,
              COALESCE((SELECT array_agg(e ORDER BY e) FROM (SELECT unnest(equipment_ids) e FROM eos_commercial.sales_order_fulfillments x
                         WHERE x.tenant_id = $1 AND x.sales_order_id = $2 AND x.line_number = $3) q), '{}') AS eqs,
              COALESCE((SELECT array_agg(s ORDER BY s) FROM (SELECT unnest(serial_numbers) s FROM eos_commercial.sales_order_fulfillments x
                         WHERE x.tenant_id = $1 AND x.sales_order_id = $2 AND x.line_number = $3) q), '{}') AS sns
         FROM eos_commercial.sales_order_fulfillments WHERE tenant_id = $1 AND sales_order_id = $2 AND line_number = $3`,
      [actor.tenantId, input.salesOrderId, l.line_number]);
    const unit = big(l.unit_price_minor);
    const qty = BigInt(l.fulfilled_qty);
    const extended = unit === null ? null : unit * qty;
    if (unit === null) {
      if (!exceptions.includes("PRICE_EVIDENCE_MISSING")) exceptions.push("PRICE_EVIDENCE_MISSING");
      subtotal = null;
    } else if (subtotal !== null) {
      subtotal += extended as bigint;
    }
    pkgLines.push({ lineNumber: Number(l.line_number), kind: String(l.kind), ref: String(l.ref), businessUnit: String(l.business_unit),
      orderedQty: Number(l.ordered_qty), fulfilledQty: Number(l.fulfilled_qty), billableQty: Number(l.fulfilled_qty),
      unitPriceMinor: str(unit), extendedMinor: str(extended), fulfillmentIds: (f[0].ids ?? []) as string[],
      workOrderIds: (f[0].wos ?? []).filter((x: unknown) => x !== null).sort() as string[], equipmentIds: f[0].eqs as string[], serials: f[0].sns as string[] });
  }

  // Charges: the Agreement's governed values (none for a direct order). TAX IS USED ONLY WHEN ITS EVIDENCE IS DETERMINED
  // (DECISIONS #197): NOT_DETERMINED, a pre-evidence LEGACY_UNVERIFIED Agreement (whose stored 0 may be an omitted tax) and a
  // direct order with no tax source all HOLD the package as TAX_NOT_DETERMINED -- never a zero.
  const shipping = o.sales_agreement_id === null ? null : big(o.shipping_minor);
  const install = o.sales_agreement_id === null ? null : big(o.install_charge_minor);
  const taxEvidence: string = o.sales_agreement_id === null ? "NO_TAX_SOURCE" : String(o.tax_evidence_status);
  const tax = taxEvidence === "DETERMINED" ? big(o.tax_minor) : null;
  const down = o.sales_agreement_id === null ? null : big(o.down_payment_minor);
  const tradeIn = o.sales_agreement_id === null ? null : big(o.trade_in_minor);
  if (tax === null) exceptions.push("TAX_NOT_DETERMINED");
  const total = subtotal === null || tax === null ? null : subtotal + (shipping ?? 0n) + (install ?? 0n) + tax;
  const balance = total === null ? null : total - (down ?? 0n) - (tradeIn ?? 0n);
  // total = customer contribution + financed amount (#200 §5); a non-positive financed amount is not a financed sale.
  const contribution = disposition === "FINANCED_SALE" ? BigInt(o.customer_contribution_minor) : null;
  const financed = disposition === "FINANCED_SALE" && total !== null ? total - (contribution as bigint) : null;
  if (financed !== null && financed <= 0n) exceptions.push("FINANCED_AMOUNT_INVALID");
  const status: "READY" | "HELD" = exceptions.length === 0 ? "READY" : "HELD";
  const currency = String(o.currency ?? "USD");
  const destination = await resolveAccountingDestination(c, actor.tenantId, companyId);

  const content = { companyId, key: o.operating_company_key, customer: o.account_id, counterpartyId, obligorBasis, disposition,
    agreement: o.sales_agreement_id, currency, subtotal: str(subtotal), shipping: str(shipping), install: str(install), tax: str(tax), taxEvidence,
    total: str(total), down: str(down), tradeIn: str(tradeIn), balance: str(balance), status, exceptions, lines: pkgLines,
    // Financed composition only on a financed sale, so a direct sale's content (and fingerprint) is unchanged.
    ...(disposition === "FINANCED_SALE" ? { financing: { arrangement: o.financing_arrangement_id, provider: providerCounterpartyId,
      contribution: str(contribution), financed: str(financed) } } : {}) };
  const fingerprint = createHash("sha256").update(JSON.stringify(content)).digest("hex");

  const { rows: current } = await c.query(
    `SELECT id, version, status, content_fingerprint, readiness_exceptions, total_minor FROM eos_finance.billing_packages
      WHERE tenant_id = $1 AND source_kind = 'SALES_ORDER' AND sales_order_id = $2 AND status IN ('HELD', 'READY') FOR UPDATE`,
    [actor.tenantId, input.salesOrderId]);
  if (current[0] && current[0].content_fingerprint === fingerprint) {
    // A replay re-asserts the READY consequence (idempotent: the same receivable and handoff, never a second).
    const consequence = current[0].status !== "READY" ? null
      : disposition === "FINANCED_SALE" ? await financedConsequenceOn(c, actor, String(current[0].id))
      : (await isCurrentAuthoritative(c, actor, String(current[0].id))) ? await establishPackageReceivableOn(c, actor, String(current[0].id)) : null;
    return Object.freeze({ outcome: "replayed" as const, packageId: String(current[0].id), version: Number(current[0].version),
      status: current[0].status, readinessExceptions: Object.freeze([...current[0].readiness_exceptions]), totalMinor: current[0].total_minor ?? null, consequence });
  }
  const version = current[0] ? Number(current[0].version) + 1 : 1;
  if (current[0]) {
    await c.query(`UPDATE eos_finance.billing_packages SET status = 'SUPERSEDED', status_changed_at = now() WHERE tenant_id = $1 AND id = $2`,
      [actor.tenantId, current[0].id]);
    // A superseded READY package's receivable is VOIDED with reversing facts (never edited in place); its handoff is superseded.
    await retirePackageReceivableOn(c, actor, String(current[0].id), "the billing package was superseded by a new version");
  }
  const packageId = `bpk_${randomUUID()}`;
  await c.query(
    `INSERT INTO eos_finance.billing_packages (id, tenant_id, source_kind, sales_order_id, version, supersedes_package_id, status, readiness_exceptions,
        operating_company_id, operating_company_key, commercial_customer_account_id, counterparty_id, obligor_basis, commercial_disposition,
        sales_agreement_id, currency, subtotal_minor, shipping_minor, install_charge_minor, tax_minor, total_minor, down_payment_minor,
        trade_in_minor, balance_minor, accounting_destination_id, content_fingerprint, prepared_by, tax_evidence_status,
        financing_arrangement_id, financing_provider_counterparty_id, customer_contribution_minor, financed_amount_minor)
     VALUES ($1,$2,'SALES_ORDER',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31)`,
    [packageId, actor.tenantId, input.salesOrderId, version, current[0]?.id ?? null, status, exceptions, companyId, o.operating_company_key,
      o.account_id, counterpartyId, obligorBasis, disposition, o.sales_agreement_id, currency, str(subtotal), str(shipping), str(install),
      str(tax), str(total), str(down), str(tradeIn), str(balance), destination?.id ?? null, fingerprint, actor.principalId, taxEvidence,
      disposition === "FINANCED_SALE" ? o.financing_arrangement_id : null, providerCounterpartyId, str(contribution), str(financed)]);
  for (const [i, l] of pkgLines.entries()) {
    await c.query(
      `INSERT INTO eos_finance.billing_package_lines (package_id, tenant_id, line_number, sales_order_id, sales_order_line_number, kind, ref,
          business_unit, ordered_qty, fulfilled_qty, billable_qty, eligibility, unit_price_minor, extended_minor, price_source,
          fulfillment_ids, source_work_order_ids, equipment_ids, serial_numbers)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'ELIGIBLE',$12,$13,'SALES_ORDER_LINE',$14,$15,$16,$17)`,
      [packageId, actor.tenantId, i + 1, input.salesOrderId, l.lineNumber, l.kind, l.ref, l.businessUnit, l.orderedQty, l.fulfilledQty,
        l.billableQty, l.unitPriceMinor, l.extendedMinor, l.fulfillmentIds, l.workOrderIds, l.equipmentIds, l.serials]);
  }
  await c.query(
    `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at, reason)
     VALUES ($1, $2, 'finance.billingPackage.prepare', $3, 'billing_package', $4, $5::jsonb, $6::jsonb, now(), $7)`,
    [`audit_${randomUUID()}`, actor.tenantId, actor.principalId, packageId,
      current[0] ? JSON.stringify({ supersededPackageId: current[0].id, version: current[0].version }) : null,
      JSON.stringify({ salesOrderId: input.salesOrderId, version, status, readinessExceptions: exceptions, totalMinor: str(total), operatingCompanyId: companyId }),
      "operational billing package prepared from governed Commercial eligibility"]);
  // THE OWNER-RULED CONSEQUENCE (DECISIONS #197): a READY direct-sale package establishes the EOS operational receivable --
  // in THIS transaction, so a READY package can never be observed without it.
  // A FINANCED sale's consequence is HELD until the arrangement is funding-entitled (#200 §11).
  const consequence = status !== "READY" ? null
    : disposition === "FINANCED_SALE" ? await financedConsequenceOn(c, actor, packageId) : await establishPackageReceivableOn(c, actor, packageId);
  return Object.freeze({ outcome: current[0] ? "superseded" as const : "recorded" as const, packageId, version, status,
    readinessExceptions: Object.freeze(exceptions), totalMinor: str(total), consequence });
}

/**
 * THE EOS OPERATIONAL RECEIVABLE of ONE READY Billing Package, inside the caller's transaction (DECISIONS #197).
 *
 * Owner ruling: for a supported DIRECT SALE, the READY package establishes the receivable -- EOS operational truth that money
 * is owed; NOT the accounting invoice, NOT a GL posting, NOT recognition, NOT provider acknowledgement. Reuses the foundation:
 * an eos_finance.obligations RECEIVABLE toward the package's governed counterparty (the customer organization, by the
 * DIRECT_SALE_CUSTOMER rule only), opened through openObligationOn, whose origination fact is the foundation's own invariant
 * (balances derive from facts). Amount = the package total, exactly -- nothing is re-priced. One per package (unique index +
 * idempotency key). Then the provider-neutral accounting handoff: READY_FOR_DELIVERY when the company has a destination,
 * otherwise PENDING_DESTINATION with ACCOUNTING_DESTINATION_MISSING -- the receivable stands either way. Nothing is sent.
 */
export async function establishPackageReceivableOn(c: Queryable, actor: FinanceActor, packageId: string): Promise<ReceivableConsequence> {
  const { rows } = await c.query(`SELECT * FROM eos_finance.billing_packages WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, packageId]);
  const p = rows[0];
  if (!p) throw new FinanceFoundationError("BILLING_PACKAGE_NOT_FOUND", "NOT_FOUND", "no billing package with that id");
  if (p.status !== "READY") throw new FinanceFoundationError("BILLING_PACKAGE_NOT_READY", "PRECONDITION_FAILED", "only a READY package establishes a receivable");
  if (p.obligor_basis !== "DIRECT_SALE_CUSTOMER" || p.counterparty_id === null) {
    throw new FinanceFoundationError("UNSUPPORTED_FINANCIAL_OBLIGOR", "PRECONDITION_FAILED", "only a supported direct sale establishes a customer receivable");
  }
  // CURRENT AUTHORITATIVE REQUIREMENTS ONLY (Controller correction 2026-10-02): a package READY under the pre-evidence rules
  // (tax_evidence_status NULL -- e.g. a LEGACY_UNVERIFIED Agreement's stored 0) is historical and immutable; it never becomes
  // receivable truth. Only a package whose tax came from DETERMINED evidence establishes one.
  if (p.tax_evidence_status !== "DETERMINED") {
    throw new FinanceFoundationError("TAX_NOT_DETERMINED", "PRECONDITION_FAILED",
      "the package's tax is not from governed DETERMINED evidence; it establishes no receivable");
  }
  const total = BigInt(p.total_minor);
  if (total === 0n) return Object.freeze({ receivable: Object.freeze({ outcome: "NOT_REQUIRED_ZERO_TOTAL" as const }), handoff: null });
  const opened = await openObligationOn(c, actor, {
    operatingCompanyId: p.operating_company_id, counterpartyId: p.counterparty_id, kind: "RECEIVABLE", currency: p.currency,
    sourceDomain: "BILLING_PACKAGE", sourceRecordId: packageId, originationAmountMinor: total, basis: "OPERATIONAL_BILLING_PACKAGE",
    effectiveAt: p.prepared_at, idempotencyKey: `ar:bpk:${packageId}`, correlationId: p.sales_order_id,
  });
  // The provider-neutral handoff (one per package).
  const destination = await resolveAccountingDestination(c, actor.tenantId, p.operating_company_id);
  await c.query(
    `INSERT INTO eos_finance.accounting_handoffs (id, tenant_id, operating_company_id, billing_package_id, obligation_id, accounting_destination_id,
        payload_kind, payload_version, payload_fingerprint, status, readiness_exceptions, idempotency_key, correlation_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,'OPERATIONAL_BILLING_PACKAGE',$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (tenant_id, billing_package_id) DO NOTHING`,
    [`aho_${randomUUID()}`, actor.tenantId, p.operating_company_id, packageId, opened.obligationId, destination?.id ?? null, Number(p.version),
      p.content_fingerprint, destination ? "READY_FOR_DELIVERY" : "PENDING_DESTINATION", destination ? [] : ["ACCOUNTING_DESTINATION_MISSING"],
      `handoff:bpk:${packageId}`, p.sales_order_id, actor.principalId]);
  const { rows: h } = await c.query(`SELECT id, status, readiness_exceptions FROM eos_finance.accounting_handoffs WHERE tenant_id = $1 AND billing_package_id = $2`,
    [actor.tenantId, packageId]);
  return Object.freeze({
    receivable: Object.freeze({ outcome: opened.outcome, obligationId: opened.obligationId }),
    handoff: Object.freeze({ id: String(h[0].id), status: String(h[0].status), readinessExceptions: Object.freeze([...h[0].readiness_exceptions]) }),
  });
}

async function isCurrentAuthoritative(c: Queryable, actor: FinanceActor, packageId: string): Promise<boolean> {
  const { rows } = await c.query(`SELECT tax_evidence_status, obligor_basis FROM eos_finance.billing_packages WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, packageId]);
  return rows[0]?.tax_evidence_status === "DETERMINED" && rows[0]?.obligor_basis === "DIRECT_SALE_CUSTOMER";
}

/**
 * A superseded package's receivable is VOIDED (reversing facts; refused once settled) and its handoff SUPERSEDED, with any
 * open delivery exception resolved by the correction (DECISIONS #198). FAILS CLOSED once the handoff is in delivery or
 * ACKNOWLEDGED: the provider may hold a document for it, and reversing that is a provider act no package is allowed to fake.
 */
export async function retirePackageReceivableOn(c: Queryable, actor: FinanceActor, packageId: string, reason: string): Promise<void> {
  const { rows: delivered } = await c.query(
    `SELECT status FROM eos_finance.accounting_handoffs WHERE tenant_id = $1 AND billing_package_id = $2 AND status IN ('DELIVERY_IN_PROGRESS', 'ACKNOWLEDGED') FOR UPDATE`,
    [actor.tenantId, packageId]);
  if (delivered[0]) {
    throw new FinanceFoundationError("ACCOUNTING_HANDOFF_DELIVERED", "CONFLICT",
      `the package's accounting handoff is ${delivered[0].status}; it cannot be superseded without a provider-side correction`);
  }
  // A financed package whose provider payment is already owed / made is not silently re-versioned (#200): correcting it
  // would void the provider's funding receivable -- a provider-side matter, refused here.
  const { rows: entitled } = await c.query(
    `SELECT fa.status FROM eos_finance.billing_packages p JOIN eos_commercial.financing_arrangements fa ON fa.tenant_id = p.tenant_id AND fa.id = p.financing_arrangement_id
      WHERE p.tenant_id = $1 AND p.id = $2 AND fa.status IN ('FUNDING_ENTITLED', 'FUNDED')`, [actor.tenantId, packageId]);
  if (entitled[0]) {
    throw new FinanceFoundationError("FINANCED_PACKAGE_FUNDING_ENTITLED", "CONFLICT",
      `the package's financing is ${entitled[0].status}; it cannot be superseded without a provider-side correction`);
  }
  await c.query(
    `UPDATE eos_finance.accounting_handoff_exceptions x SET status = 'RESOLVED', resolved_by = $3, resolved_at = now(), resolution = 'SUPERSEDED_BY_CORRECTED_PACKAGE'
      FROM eos_finance.accounting_handoffs h WHERE h.tenant_id = x.tenant_id AND h.id = x.handoff_id AND x.tenant_id = $1 AND h.billing_package_id = $2 AND x.status = 'OPEN'`,
    [actor.tenantId, packageId, actor.principalId]);
  const { rows } = await c.query(`SELECT id, kind FROM eos_finance.obligations WHERE tenant_id = $1 AND source_domain = 'BILLING_PACKAGE' AND source_record_id = $2 ORDER BY kind`,
    [actor.tenantId, packageId]);
  // Every receivable of the package (a financed package may carry a funding receivable and a contribution receivable).
  for (const r of rows) {
    await voidObligationOn(c, actor, { obligationId: String(r.id), reason, idempotencyKey: r.kind === "RECEIVABLE" ? `ar:void:${packageId}` : `${String(r.kind).toLowerCase()}:void:${packageId}` });
  }
  await c.query(`UPDATE eos_finance.accounting_handoffs SET status = 'SUPERSEDED', updated_at = now() WHERE tenant_id = $1 AND billing_package_id = $2 AND status <> 'SUPERSEDED'`,
    [actor.tenantId, packageId]);
}

/** Attach the company's accounting destination to handoffs still PENDING_DESTINATION (configured later). Nothing is sent. */
export async function refreshAccountingHandoffs(pool: Pool, actor: FinanceActor) {
  const { rows } = await pool.query(
    `SELECT h.id, d.id AS destination_id FROM eos_finance.accounting_handoffs h
       JOIN eos_finance.accounting_destinations d ON d.tenant_id = h.tenant_id AND d.operating_company_id = h.operating_company_id AND d.status = 'ACTIVE'
      WHERE h.tenant_id = $1 AND h.status = 'PENDING_DESTINATION'`, [actor.tenantId]);
  for (const r of rows) {
    await pool.query(`UPDATE eos_finance.accounting_handoffs SET accounting_destination_id = $3, status = 'READY_FOR_DELIVERY', readiness_exceptions = '{}', updated_at = now()
      WHERE tenant_id = $1 AND id = $2 AND status = 'PENDING_DESTINATION'`, [actor.tenantId, r.id, r.destination_id]);
  }
  return Object.freeze({ attached: rows.length });
}

/**
 * DETERMINISTIC RECOVERY: every READY direct-sale package whose tax is from DETERMINED evidence and that lacks its receivable
 * gets it, idempotently, each in its own transaction. A package READY under the pre-evidence rules is SKIPPED -- it stays
 * immutable history and is never promoted into receivable truth (Controller correction 2026-10-02). Server-side only; no route.
 */
export async function establishReceivablesForReadyPackages(pool: Pool, actor: FinanceActor) {
  const { rows } = await pool.query(
    `SELECT p.id FROM eos_finance.billing_packages p
      WHERE p.tenant_id = $1 AND p.status = 'READY' AND p.obligor_basis = 'DIRECT_SALE_CUSTOMER' AND p.total_minor > 0
        AND p.tax_evidence_status = 'DETERMINED'  -- a pre-evidence (legacy) READY package is skipped, never promoted
        AND NOT EXISTS (SELECT 1 FROM eos_finance.obligations o WHERE o.tenant_id = p.tenant_id AND o.source_domain = 'BILLING_PACKAGE' AND o.source_record_id = p.id)
      ORDER BY p.prepared_at, p.id`, [actor.tenantId]);
  const out = [];
  for (const r of rows) {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      out.push({ packageId: String(r.id), ...(await establishPackageReceivableOn(c, actor, String(r.id))) });
      await c.query("COMMIT");
    } catch (err) {
      await c.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
  }
  return Object.freeze(out);
}

/** The same, in its own transaction. */
export async function prepareBillingPackage(pool: Pool, actor: FinanceActor, input: { readonly salesOrderId: string }): Promise<BillingPackageOutcome> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const out = await prepareBillingPackageOn(c, actor, input);
    await c.query("COMMIT");
    return out;
  } catch (err) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

/**
 * DETERMINISTIC RECOVERY / RE-EVALUATION: every Sales Order ELIGIBLE in full whose current package is missing or HELD is
 * prepared again from governed facts (idempotent: unchanged evidence replays). Server-side only; no route.
 */
export async function prepareEligibleBillingPackages(pool: Pool, actor: FinanceActor, opts: { readonly limit?: number } = {}) {
  const limit = Number.isSafeInteger(opts.limit) && (opts.limit as number) > 0 ? (opts.limit as number) : 500;
  const { rows } = await pool.query(
    `SELECT e.sales_order_id FROM eos_commercial.sales_order_line_billing_eligibility e
      WHERE e.tenant_id = $1
      GROUP BY e.sales_order_id HAVING bool_and(e.eligibility = 'ELIGIBLE')
         AND NOT EXISTS (SELECT 1 FROM eos_finance.billing_packages p WHERE p.tenant_id = $1 AND p.sales_order_id = e.sales_order_id AND p.status = 'READY')
      ORDER BY e.sales_order_id LIMIT $2`, [actor.tenantId, limit]);
  const results = [];
  for (const r of rows) results.push(await prepareBillingPackage(pool, actor, { salesOrderId: String(r.sales_order_id) }));
  return Object.freeze(results);
}
