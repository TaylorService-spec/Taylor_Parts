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
import { ensureExternalCounterparty, FinanceFoundationError, resolveAccountingDestination, resolveOperatingCompanyFromKey, type FinanceActor } from "./financeFoundation";

type Queryable = Pick<PoolClient, "query">;

export const BILLING_PACKAGE_EXCEPTIONS = Object.freeze([
  "PRICE_EVIDENCE_MISSING", "TAX_EVIDENCE_MISSING", "FINANCED_DISPOSITION_UNSUPPORTED",
] as const);

export type BillingPackageOutcome =
  | { readonly outcome: "NOT_ELIGIBLE"; readonly salesOrderId: string; readonly eligibility: string }
  | { readonly outcome: "recorded" | "replayed" | "superseded"; readonly packageId: string; readonly version: number; readonly status: "READY" | "HELD";
      readonly readinessExceptions: readonly string[]; readonly totalMinor: string | null };

const big = (v: unknown): bigint | null => (v === null || v === undefined ? null : BigInt(v as string | number));
const str = (v: bigint | null): string | null => (v === null ? null : v.toString());

/** Prepare (or replay / supersede) the Operational Billing Package of ONE Sales Order, inside the caller's transaction. */
export async function prepareBillingPackageOn(c: Queryable, actor: FinanceActor, input: { readonly salesOrderId: string }): Promise<BillingPackageOutcome> {
  const { rows: so } = await c.query(
    `SELECT so.id, so.state::text AS state, so.operating_company_key, so.account_id, so.currency, so.sales_agreement_id,
            a.is_lease, a.shipping_minor, a.install_charge_minor, a.tax_minor, a.down_payment_minor, a.trade_in_minor
       FROM eos_commercial.sales_orders so
       LEFT JOIN eos_commercial.sales_agreements a ON a.tenant_id = so.tenant_id AND a.id = so.sales_agreement_id
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
  const disposition = o.sales_agreement_id === null ? "DIRECT_ORDER" : o.is_lease ? "LEASE" : "SALE";
  const exceptions: string[] = [];
  let counterpartyId: string | null = null;
  let obligorBasis: "DIRECT_SALE_CUSTOMER" | "UNRESOLVED" = "UNRESOLVED";
  if (disposition === "LEASE") {
    exceptions.push("FINANCED_DISPOSITION_UNSUPPORTED");
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

  // Charges: the Agreement's governed values (none for a direct order). Tax absent = TAX_EVIDENCE_MISSING, never zero.
  const shipping = o.sales_agreement_id === null ? null : big(o.shipping_minor);
  const install = o.sales_agreement_id === null ? null : big(o.install_charge_minor);
  const tax = o.sales_agreement_id === null ? null : big(o.tax_minor);
  const down = o.sales_agreement_id === null ? null : big(o.down_payment_minor);
  const tradeIn = o.sales_agreement_id === null ? null : big(o.trade_in_minor);
  if (tax === null) exceptions.push("TAX_EVIDENCE_MISSING");
  const total = subtotal === null || tax === null ? null : subtotal + (shipping ?? 0n) + (install ?? 0n) + tax;
  const balance = total === null ? null : total - (down ?? 0n) - (tradeIn ?? 0n);
  const status: "READY" | "HELD" = exceptions.length === 0 ? "READY" : "HELD";
  const currency = String(o.currency ?? "USD");
  const destination = await resolveAccountingDestination(c, actor.tenantId, companyId);

  const content = { companyId, key: o.operating_company_key, customer: o.account_id, counterpartyId, obligorBasis, disposition,
    agreement: o.sales_agreement_id, currency, subtotal: str(subtotal), shipping: str(shipping), install: str(install), tax: str(tax),
    total: str(total), down: str(down), tradeIn: str(tradeIn), balance: str(balance), status, exceptions, lines: pkgLines };
  const fingerprint = createHash("sha256").update(JSON.stringify(content)).digest("hex");

  const { rows: current } = await c.query(
    `SELECT id, version, status, content_fingerprint, readiness_exceptions, total_minor FROM eos_finance.billing_packages
      WHERE tenant_id = $1 AND source_kind = 'SALES_ORDER' AND sales_order_id = $2 AND status IN ('HELD', 'READY') FOR UPDATE`,
    [actor.tenantId, input.salesOrderId]);
  if (current[0] && current[0].content_fingerprint === fingerprint) {
    return Object.freeze({ outcome: "replayed" as const, packageId: String(current[0].id), version: Number(current[0].version),
      status: current[0].status, readinessExceptions: Object.freeze([...current[0].readiness_exceptions]), totalMinor: current[0].total_minor ?? null });
  }
  const version = current[0] ? Number(current[0].version) + 1 : 1;
  if (current[0]) {
    await c.query(`UPDATE eos_finance.billing_packages SET status = 'SUPERSEDED', status_changed_at = now() WHERE tenant_id = $1 AND id = $2`,
      [actor.tenantId, current[0].id]);
  }
  const packageId = `bpk_${randomUUID()}`;
  await c.query(
    `INSERT INTO eos_finance.billing_packages (id, tenant_id, source_kind, sales_order_id, version, supersedes_package_id, status, readiness_exceptions,
        operating_company_id, operating_company_key, commercial_customer_account_id, counterparty_id, obligor_basis, commercial_disposition,
        sales_agreement_id, currency, subtotal_minor, shipping_minor, install_charge_minor, tax_minor, total_minor, down_payment_minor,
        trade_in_minor, balance_minor, accounting_destination_id, content_fingerprint, prepared_by)
     VALUES ($1,$2,'SALES_ORDER',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
    [packageId, actor.tenantId, input.salesOrderId, version, current[0]?.id ?? null, status, exceptions, companyId, o.operating_company_key,
      o.account_id, counterpartyId, obligorBasis, disposition, o.sales_agreement_id, currency, str(subtotal), str(shipping), str(install),
      str(tax), str(total), str(down), str(tradeIn), str(balance), destination?.id ?? null, fingerprint, actor.principalId]);
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
  return Object.freeze({ outcome: current[0] ? "superseded" as const : "recorded" as const, packageId, version, status,
    readinessExceptions: Object.freeze(exceptions), totalMinor: str(total) });
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
