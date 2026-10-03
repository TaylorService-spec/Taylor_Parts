// THE RENTAL OPERATIONAL BILLING PACKAGE (DECISIONS #207 §charge; the frozen #196/#197 package path, source RENTAL_CHARGE).
//
// One governed rental charge -> one package (disposition RENTAL, obligor basis RENTAL_CUSTOMER: the rental customer's organization
// owes the rent, by this explicit rule) -> READY establishes the customer RECEIVABLE and the provider-neutral accounting handoff
// through the SAME foundation functions a direct sale uses (establishPackageReceivableOn / ensurePackageHandoffOn). A charge
// whose tax is NOT_DETERMINED is HELD (TAX_NOT_DETERMINED -- never a zero); a later tax determination prepares a new version
// that supersedes the HELD one. Content is immutable; replays return the same package. No Sales Order, no Sales Agreement, no
// financing arrangement and no ownership transfer is ever written here.
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { ensureExternalCounterparty, FinanceFoundationError, resolveAccountingDestination, resolveOperatingCompanyFromKey, type FinanceActor } from "../eosFinance/financeFoundation";
import { establishPackageReceivableOn, retirePackageReceivableOn, type ReceivableConsequence } from "../eosFinance/billingPackage";

type Queryable = Pick<PoolClient, "query">;

export interface RentalPackageOutcome {
  readonly outcome: "recorded" | "replayed" | "superseded";
  readonly packageId: string;
  readonly version: number;
  readonly status: "READY" | "HELD";
  readonly readinessExceptions: readonly string[];
  readonly totalMinor: string | null;
  readonly consequence: ReceivableConsequence | null;
}

const LINE_KIND: Readonly<Record<string, string>> = Object.freeze({ PERIOD: "RENTAL_PERIOD", DELIVERY: "RENTAL_DELIVERY", INSTALL: "RENTAL_INSTALL" });

export async function prepareRentalChargePackageOn(c: Queryable, actor: FinanceActor, chargeId: string): Promise<RentalPackageOutcome> {
  const { rows: cr } = await c.query(
    `SELECT ch.*, g.rental_agreement_number, g.operating_company_key, g.account_id, g.currency AS agreement_currency
       FROM eos_rental.rental_charges ch JOIN eos_rental.rental_agreements g ON g.tenant_id = ch.tenant_id AND g.id = ch.agreement_id
      WHERE ch.tenant_id = $1 AND ch.id = $2`, [actor.tenantId, chargeId]);
  const ch = cr[0];
  if (!ch) throw new FinanceFoundationError("RENTAL_CHARGE_NOT_FOUND", "NOT_FOUND", "no rental charge with that id");
  const { rows: tx } = await c.query(`SELECT status, tax_minor FROM eos_rental.rental_charge_tax_evidence WHERE tenant_id = $1 AND charge_id = $2 ORDER BY version DESC LIMIT 1`,
    [actor.tenantId, chargeId]);
  const companyId = await resolveOperatingCompanyFromKey(c, actor.tenantId, ch.operating_company_key);
  const counterpartyId = (await ensureExternalCounterparty(c, actor, ch.account_id)).id;
  const subtotal = BigInt(ch.amount_minor);
  const taxStatus = String(tx[0]?.status ?? "NOT_DETERMINED");
  const tax = taxStatus === "DETERMINED" ? BigInt(tx[0].tax_minor) : null;
  const exceptions = tax === null ? ["TAX_NOT_DETERMINED"] : [];
  const status: "READY" | "HELD" = exceptions.length === 0 ? "READY" : "HELD";
  const total = tax === null ? null : subtotal + tax;
  const destination = await resolveAccountingDestination(c, actor.tenantId, companyId);
  // Lineage: the agreement's deployments (Work Orders, Equipment, serials) the rent is for.
  const { rows: lin } = await c.query(
    `SELECT COALESCE(array_agg(DISTINCT s.deployment_work_order_id) FILTER (WHERE s.deployment_work_order_id IS NOT NULL), '{}') AS wos,
            COALESCE(array_agg(DISTINCT s.equipment_id) FILTER (WHERE s.equipment_id IS NOT NULL), '{}') AS eqs,
            COALESCE(array_agg(DISTINCT f.serial_number) FILTER (WHERE s.deployed_at IS NOT NULL), '{}') AS sns
       FROM eos_rental.rental_assignments s JOIN eos_rental.fleet_units f ON f.id = s.fleet_unit_id
      WHERE s.tenant_id = $1 AND s.agreement_id = $2`, [actor.tenantId, ch.agreement_id]);
  const line = { kind: LINE_KIND[String(ch.kind)], ref: String(ch.rental_agreement_number), qty: Number(ch.period_count),
    unit: String(ch.unit_amount_minor), extended: subtotal.toString(), wos: [...lin[0].wos].sort(), eqs: [...lin[0].eqs].sort(), sns: [...lin[0].sns].sort(),
    period: ch.kind === "PERIOD" ? { start: String(ch.period_start instanceof Date ? isoDay(ch.period_start) : ch.period_start), end: String(ch.period_end instanceof Date ? isoDay(ch.period_end) : ch.period_end) } : null };
  const content = { source: "RENTAL_CHARGE", chargeId, agreement: ch.agreement_id, companyId, key: ch.operating_company_key, customer: ch.account_id, counterpartyId,
    obligorBasis: "RENTAL_CUSTOMER", disposition: "RENTAL", currency: ch.currency, subtotal: subtotal.toString(), tax: tax?.toString() ?? null, taxEvidence: taxStatus,
    total: total?.toString() ?? null, status, exceptions, line };
  const fingerprint = createHash("sha256").update(JSON.stringify(content)).digest("hex");

  const { rows: current } = await c.query(
    `SELECT id, version, status, content_fingerprint, readiness_exceptions, total_minor FROM eos_finance.billing_packages
      WHERE tenant_id = $1 AND source_kind = 'RENTAL_CHARGE' AND rental_charge_id = $2 AND status IN ('HELD', 'READY') FOR UPDATE`, [actor.tenantId, chargeId]);
  if (current[0] && current[0].content_fingerprint === fingerprint) {
    const consequence = current[0].status === "READY" ? await establishPackageReceivableOn(c, actor, String(current[0].id)) : null;
    return Object.freeze({ outcome: "replayed" as const, packageId: String(current[0].id), version: Number(current[0].version), status: current[0].status,
      readinessExceptions: Object.freeze([...current[0].readiness_exceptions]), totalMinor: current[0].total_minor === null ? null : String(current[0].total_minor), consequence });
  }
  const version = current[0] ? Number(current[0].version) + 1 : 1;
  if (current[0]) {
    if (current[0].status === "READY") {
      // A READY rental package's charge and tax are immutable; nothing here re-prices it (a provider-side correction would).
      throw new FinanceFoundationError("RENTAL_PACKAGE_ALREADY_READY", "CONFLICT", "the charge's package is READY; it is not re-versioned");
    }
    await c.query(`UPDATE eos_finance.billing_packages SET status = 'SUPERSEDED', status_changed_at = now() WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, current[0].id]);
    await retirePackageReceivableOn(c, actor, String(current[0].id), "the rental billing package was superseded by a new version");
  }
  const packageId = `bpk_${randomUUID()}`;
  await c.query(
    `INSERT INTO eos_finance.billing_packages (id, tenant_id, source_kind, sales_order_id, rental_charge_id, rental_agreement_id, version, supersedes_package_id, status,
        readiness_exceptions, operating_company_id, operating_company_key, commercial_customer_account_id, counterparty_id, obligor_basis, commercial_disposition,
        sales_agreement_id, currency, subtotal_minor, shipping_minor, install_charge_minor, tax_minor, total_minor, down_payment_minor, trade_in_minor, balance_minor,
        accounting_destination_id, content_fingerprint, prepared_by, tax_evidence_status)
     VALUES ($1,$2,'RENTAL_CHARGE',NULL,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'RENTAL_CUSTOMER','RENTAL',NULL,$13,$14,NULL,NULL,$15,$16,NULL,NULL,$16,$17,$18,$19,$20)`,
    [packageId, actor.tenantId, chargeId, ch.agreement_id, version, current[0]?.id ?? null, status, exceptions, companyId, ch.operating_company_key, ch.account_id,
      counterpartyId, ch.currency, subtotal.toString(), tax?.toString() ?? null, total?.toString() ?? null, destination?.id ?? null, fingerprint, actor.principalId, taxStatus]);
  await c.query(
    `INSERT INTO eos_finance.billing_package_lines (package_id, tenant_id, line_number, sales_order_id, sales_order_line_number, rental_charge_id, kind, ref,
        business_unit, ordered_qty, fulfilled_qty, billable_qty, eligibility, unit_price_minor, extended_minor, price_source,
        fulfillment_ids, source_work_order_ids, equipment_ids, serial_numbers)
     VALUES ($1,$2,1,NULL,NULL,$3,$4,$5,'RENTAL',$6,$6,$6,'ELIGIBLE',$7,$8,'RENTAL_AGREEMENT_TERMS','{}',$9,$10,$11)`,
    [packageId, actor.tenantId, chargeId, line.kind, line.ref, line.qty, line.unit, line.extended, line.wos, line.eqs, line.sns]);
  await c.query(
    `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at, reason)
     VALUES ($1, $2, 'finance.billingPackage.prepare', $3, 'billing_package', $4, $5::jsonb, $6::jsonb, now(), $7)`,
    [`audit_${randomUUID()}`, actor.tenantId, actor.principalId, packageId, current[0] ? JSON.stringify({ supersededPackageId: current[0].id, version: current[0].version }) : null,
      JSON.stringify({ rentalChargeId: chargeId, rentalAgreementId: ch.agreement_id, version, status, readinessExceptions: exceptions, totalMinor: total?.toString() ?? null }),
      "rental billing package prepared from a governed rental charge"]);
  const consequence = status === "READY" ? await establishPackageReceivableOn(c, actor, packageId) : null;
  return Object.freeze({ outcome: current[0] ? "superseded" as const : "recorded" as const, packageId, version, status, readinessExceptions: Object.freeze(exceptions),
    totalMinor: total?.toString() ?? null, consequence });
}

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
