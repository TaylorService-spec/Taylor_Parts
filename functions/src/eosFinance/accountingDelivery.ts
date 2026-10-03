// THE ACCOUNTING DELIVERY CONTROL PLANE (DECISIONS #198; Controller FINANCE ACTIVATION 2 H–Q). See migration 1764470000000.
//
// Around the EXISTING eos_finance.accounting_handoffs (#197). EOS is the operational truth; an accounting provider is a
// DESTINATION that may later create the formal invoice, its number and its GL treatment. This module:
//   * derives a VERSIONED, PROVIDER-NEUTRAL payload from the READY Billing Package and its receivable (canonical JSON,
//     sha256 fingerprint; the same truth always yields the same bytes);
//   * hands it to an ADAPTER (prepare / deliver / interpret acknowledgement / interpret rejection) chosen by the company's
//     own destination -- the adapter receives frozen copies and its answer is narrowed to a provider document reference
//     or a failure code: it can never change an amount, the package, the receivable or any financial fact;
//   * records every attempt durably, and moves the handoff only along the exact transitions the database enforces.
//
// NO REAL PROVIDER, NO CREDENTIAL, NO NETWORK: the production adapter registry is EMPTY, so a handoff can only be delivered
// where a caller injects an adapter (the deterministic test adapter in test/support). NOTHING SCHEDULES: there is no timer,
// queue or cron here -- a first delivery is an explicit server-side call, and a retry is a GOVERNED act with a recorded
// reason, permitted only after a retryable failure. A replayed request returns its attempt; it never delivers twice.
// No transport operation reaches this module, so no Sales or Technician employee can deliver, retry or acknowledge.
import type { Pool, PoolClient } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { FinanceFoundationError, type FinanceActor, type FinanceFoundationCategory } from "./financeFoundation";
import { buildObligationPayload, type ObligationPayloadV1 } from "./obligationHandoff";

type Queryable = Pick<PoolClient, "query">;

export const ACCOUNTING_PAYLOAD_CONTRACT = "eos.accounting.operational-billing-package";
/** The direct-sale contract version (v1). A financed sale uses v2 (its two-party composition). */
export const ACCOUNTING_PAYLOAD_CONTRACT_VERSION = 1;

/** The provider-neutral payload, contract version 1. Money is integer minor units as decimal STRINGS (never floats). */
export interface AccountingPayloadV1 {
  readonly contract: { readonly name: typeof ACCOUNTING_PAYLOAD_CONTRACT; readonly version: 1 };
  /** What this is NOT: an accounting invoice. The provider assigns any document number and GL treatment. */
  readonly semantics: "OPERATIONAL_BILLING_PACKAGE_NOT_AN_ACCOUNTING_INVOICE";
  readonly handoff: { readonly id: string; readonly idempotencyKey: string; readonly correlationId: string | null };
  readonly operatingCompany: { readonly id: string };
  readonly destination: { readonly id: string; readonly externalCompanyRef: string | null };
  readonly billingPackage: {
    readonly id: string; readonly version: number; readonly contentFingerprint: string; readonly preparedAt: string;
    readonly salesOrderId: string; readonly salesAgreementId: string | null; readonly currency: string; readonly taxEvidence: "DETERMINED";
    readonly amounts: Readonly<Record<"subtotalMinor" | "shippingMinor" | "installChargeMinor" | "taxMinor" | "totalMinor"
      | "downPaymentMinor" | "tradeInMinor" | "balanceMinor", string | null>> & { readonly customerDiscountMinor?: string | null };
    readonly lines: readonly {
      readonly lineNumber: number; readonly salesOrderLineNumber: number; readonly kind: string; readonly ref: string; readonly businessUnit: string;
      readonly billableQty: number; readonly unitPriceMinor: string; readonly extendedMinor: string; readonly serialNumbers: readonly string[];
    }[];
  };
  readonly receivable: { readonly obligationId: string; readonly amountMinor: string; readonly currency: string };
  readonly customer: { readonly counterpartyId: string; readonly kind: "EXTERNAL_ORGANIZATION"; readonly crmAccountId: string; readonly name: string | null };
}

/** A party's receivable in the financed composition: present exactly when that party owes Taylor something. */
export interface PayloadReceivable { readonly obligationId: string; readonly kind: "RECEIVABLE" | "FUNDING_RECEIVABLE"; readonly amountMinor: string }

/**
 * Contract version 2 -- a FINANCED SALE (Owner rulings #200 / #201): ONE commercial sale whose payment composition names
 * both financial parties. It states the composition; it does not say how an accounting system should book a lease.
 */
export interface AccountingPayloadV2 extends Omit<AccountingPayloadV1, "contract" | "receivable" | "customer"> {
  readonly contract: { readonly name: typeof ACCOUNTING_PAYLOAD_CONTRACT; readonly version: 2 };
  readonly composition: {
    readonly kind: "FINANCED_SALE";
    readonly currency: string;
    readonly totalCommercialMinor: string;
    /** #203: the trade-in credit -- cash-equivalent consideration, never cash and never a discount ("0" when none). */
    readonly tradeInCreditMinor: string;
    readonly commercialCustomer: { readonly counterpartyId: string; readonly crmAccountId: string; readonly name: string | null;
      readonly contributionMinor: string; readonly receivable: PayloadReceivable | null };
    readonly financingProvider: { readonly counterpartyId: string; readonly crmAccountId: string; readonly name: string | null;
      readonly financedAmountMinor: string; readonly receivable: PayloadReceivable;
      readonly arrangementId: string; readonly arrangementKind: string; readonly providerReference: string | null; readonly fundingStatus: string;
      readonly approvalEvidence: { readonly evidenceId: string; readonly documentReference: string; readonly signed: true; readonly approved: true; readonly recordedAt: string } };
  };
}
/**
 * Contract version 3 -- a RENTAL charge (#207): the v1 shape with no Sales Order (the source is a Rental Agreement charge) and a
 * `rental` block naming the agreement and the charged period. It states the rent; it says nothing of ownership (none moves).
 */
export interface AccountingPayloadV3 extends Omit<AccountingPayloadV1, "contract" | "billingPackage"> {
  readonly contract: { readonly name: typeof ACCOUNTING_PAYLOAD_CONTRACT; readonly version: 3 };
  readonly billingPackage: Omit<AccountingPayloadV1["billingPackage"], "salesOrderId" | "lines"> & {
    readonly salesOrderId: null;
    readonly lines: readonly (Omit<AccountingPayloadV1["billingPackage"]["lines"][number], "salesOrderLineNumber"> & { readonly salesOrderLineNumber: null })[];
  };
  readonly rental: {
    readonly agreementId: string; readonly agreementNumber: string; readonly chargeId: string; readonly chargeKind: string;
    readonly periodStart: string | null; readonly periodEnd: string | null; readonly ownershipTransfers: false;
  };
}
/** #206: an obligation-anchored handoff (a company-side intercompany obligation, or a vendor payable) carries its own contract. */
export type AccountingPayload = AccountingPayloadV1 | AccountingPayloadV2 | AccountingPayloadV3 | ObligationPayloadV1;

export interface AccountingDestinationRef {
  readonly id: string; readonly operatingCompanyId: string; readonly providerKey: string; readonly externalCompanyRef: string | null;
}
export interface PreparedDelivery { readonly deliveryIdempotencyKey: string; readonly request: unknown }
export interface ProviderAcknowledgement { readonly providerDocumentReference: string; readonly echoedPayloadFingerprint?: string }
export type DeliveryFailureDisposition = "REJECTED" | "FAILED_RETRYABLE" | "FAILED_FINAL";
export interface ProviderRejection { readonly disposition: DeliveryFailureDisposition; readonly code: string; readonly detail?: string }

/**
 * THE ADAPTER BOUNDARY. An adapter turns the payload into ITS request, delivers it and reads the answer. Everything it is
 * given is frozen; everything it returns is narrowed and validated here. It has no database handle.
 */
export interface AccountingDeliveryAdapter {
  readonly key: string;
  prepare(payload: AccountingPayload, destination: AccountingDestinationRef, deliveryIdempotencyKey: string): PreparedDelivery;
  deliver(prepared: PreparedDelivery): Promise<unknown>;
  interpretAcknowledgement(response: unknown): ProviderAcknowledgement | null;
  interpretRejection(response: unknown): ProviderRejection | null;
}

/** Production registers NO adapter: no provider is selected (Controller Y). Delivery refuses ADAPTER_NOT_AVAILABLE. */
export const PRODUCTION_ACCOUNTING_ADAPTERS: Readonly<Record<string, AccountingDeliveryAdapter>> = Object.freeze({});

export interface AccountingDeliveryDeps {
  readonly pool: Pool;
  readonly adapters?: Readonly<Record<string, AccountingDeliveryAdapter>>;
}

export type DeliveryOutcome = "ACKNOWLEDGED" | DeliveryFailureDisposition;
export interface DeliveryResult {
  readonly outcome: "delivered" | "replayed";
  readonly handoffId: string;
  readonly attemptId: string;
  readonly attemptNumber: number;
  readonly attemptOutcome: DeliveryOutcome | "IN_PROGRESS";
  readonly handoffStatus: string;
  readonly providerDocumentReference: string | null;
  readonly failureCode: string | null;
  readonly exceptionId: string | null;
}

const refuse = (code: string, category: FinanceFoundationCategory, message: string): never => {
  throw new FinanceFoundationError(code, category, message);
};
const requireText = (v: unknown, name: string): string => {
  if (typeof v !== "string" || v.trim() === "" || v.length > 200) refuse(`${name.toUpperCase()}_REQUIRED`, "INVALID_INPUT", `${name} is required`);
  return (v as string).trim();
};
const minorText = (v: unknown): string | null => (v === null || v === undefined ? null : BigInt(v as string).toString());

/** Canonical JSON: object keys sorted at every depth, so the same truth always fingerprints the same. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value as object).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(",")}}`;
}
function deepFreeze<T>(v: T): T {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v as object)) deepFreeze((v as Record<string, unknown>)[k]);
  }
  return v;
}

async function tx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
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
 * THE PAYLOAD, derived -- never stored truth of its own. Fails closed unless the package is READY with DETERMINED tax, the
 * receivable is the package's own (same company, counterparty, currency and EXACT total; not VOID), and the destination is
 * the handoff company's own.
 */
export async function buildAccountingPayload(db: Queryable, tenantId: string, handoffId: string)
  : Promise<{ readonly payload: AccountingPayload; readonly fingerprint: string; readonly destination: AccountingDestinationRef }> {
  const { rows: hr } = await db.query(`SELECT * FROM eos_finance.accounting_handoffs WHERE tenant_id = $1 AND id = $2`, [tenantId, handoffId]);
  const h = hr[0] ?? refuse("ACCOUNTING_HANDOFF_NOT_FOUND", "NOT_FOUND", "no accounting handoff with that id");
  if (h.payload_kind !== "OPERATIONAL_BILLING_PACKAGE") {
    // #206: anchored on an OBLIGATION -- the same destination rules, its own provider-neutral contract.
    const { rows: odr } = await db.query(`SELECT * FROM eos_finance.accounting_destinations WHERE tenant_id = $1 AND id = $2`, [tenantId, h.accounting_destination_id]);
    const od = odr[0] ?? refuse("ACCOUNTING_DESTINATION_MISSING", "PRECONDITION_FAILED", "the handoff has no accounting destination");
    if (od.operating_company_id !== h.operating_company_id) {
      refuse("DESTINATION_COMPANY_MISMATCH", "PRECONDITION_FAILED", "a company's handoff is delivered only to that company's own destination");
    }
    if (od.status !== "ACTIVE") refuse("ACCOUNTING_DESTINATION_INACTIVE", "PRECONDITION_FAILED", "the handoff's destination is not active");
    if (!od.provider_key) refuse("ADAPTER_NOT_AVAILABLE", "PRECONDITION_FAILED", "the destination names no delivery adapter");
    const obligationPayload = await buildObligationPayload(db, tenantId, h, od);
    return { payload: deepFreeze(obligationPayload), fingerprint: createHash("sha256").update(canonicalJson(obligationPayload)).digest("hex"),
      destination: deepFreeze({ id: String(od.id), operatingCompanyId: String(od.operating_company_id), providerKey: String(od.provider_key),
        externalCompanyRef: od.external_company_ref ?? null }) };
  }
  const { rows: pr } = await db.query(`SELECT * FROM eos_finance.billing_packages WHERE tenant_id = $1 AND id = $2`, [tenantId, h.billing_package_id]);
  const p = pr[0];
  const financedSale = p?.commercial_disposition === "FINANCED_SALE";
  const rental = p?.commercial_disposition === "RENTAL";
  if (!p || p.status !== "READY" || p.tax_evidence_status !== "DETERMINED"
      || p.obligor_basis !== (financedSale ? "FINANCING_PROVIDER_FUNDED" : rental ? "RENTAL_CUSTOMER" : "DIRECT_SALE_CUSTOMER")) {
    refuse("PAYLOAD_SOURCE_NOT_AUTHORITATIVE", "PRECONDITION_FAILED", "only a READY direct sale, financed sale or rental package with DETERMINED tax is delivered");
  }
  const { rows: or } = await db.query(
    `SELECT o.*, b.originated_minor FROM eos_finance.obligations o JOIN eos_finance.obligation_balances b ON b.tenant_id = o.tenant_id AND b.obligation_id = o.id
      WHERE o.tenant_id = $1 AND o.id = $2`, [tenantId, h.obligation_id]);
  const o = or[0];
  // The handoff's anchoring receivable: a direct sale's customer RECEIVABLE for the total, or a financed sale's provider
  // FUNDING_RECEIVABLE for the financed amount.
  const anchorKind = financedSale ? "FUNDING_RECEIVABLE" : "RECEIVABLE";
  const anchorCounterparty = financedSale ? p.financing_provider_counterparty_id : p.counterparty_id;
  // A direct sale's receivable is the total less any trade-in credit (#203); without a trade-in, the total exactly.
  const anchorAmount = financedSale ? p.financed_amount_minor : (BigInt(p.total_minor) - BigInt(p.trade_in_minor ?? 0)).toString();
  if (!o || o.kind !== anchorKind || o.status === "VOID" || o.source_domain !== "BILLING_PACKAGE" || o.source_record_id !== p.id
      || o.operating_company_id !== p.operating_company_id || o.operating_company_id !== h.operating_company_id
      || o.counterparty_id !== anchorCounterparty || o.currency !== p.currency || BigInt(o.originated_minor) !== BigInt(anchorAmount)) {
    refuse("PAYLOAD_RECEIVABLE_MISMATCH", "PRECONDITION_FAILED", "the receivable is not exactly the package's own -- nothing is delivered");
  }
  const { rows: dr } = await db.query(`SELECT * FROM eos_finance.accounting_destinations WHERE tenant_id = $1 AND id = $2`, [tenantId, h.accounting_destination_id]);
  const d = dr[0] ?? refuse("ACCOUNTING_DESTINATION_MISSING", "PRECONDITION_FAILED", "the handoff has no accounting destination");
  if (d.operating_company_id !== h.operating_company_id) {
    refuse("DESTINATION_COMPANY_MISMATCH", "PRECONDITION_FAILED", "a company's handoff is delivered only to that company's own destination");
  }
  if (d.status !== "ACTIVE") refuse("ACCOUNTING_DESTINATION_INACTIVE", "PRECONDITION_FAILED", "the handoff's destination is not active");
  if (!d.provider_key) refuse("ADAPTER_NOT_AVAILABLE", "PRECONDITION_FAILED", "the destination names no delivery adapter");
  const { rows: cr } = await db.query(
    `SELECT c.id, c.kind, c.crm_account_id, a.name FROM eos_finance.financial_counterparties c
       LEFT JOIN eos_crm.accounts a ON a.tenant_id = c.tenant_id AND a.id = c.crm_account_id WHERE c.tenant_id = $1 AND c.id = $2`, [tenantId, p.counterparty_id]);
  const cp = cr[0];
  if (!cp || cp.kind !== "EXTERNAL_ORGANIZATION") refuse("UNSUPPORTED_FINANCIAL_OBLIGOR", "PRECONDITION_FAILED", "a direct sale's obligor is an external organization");
  const { rows: lr } = await db.query(
    `SELECT * FROM eos_finance.billing_package_lines WHERE tenant_id = $1 AND package_id = $2 ORDER BY line_number`, [tenantId, p.id]);
  const common = {
    semantics: "OPERATIONAL_BILLING_PACKAGE_NOT_AN_ACCOUNTING_INVOICE",
    handoff: { id: String(h.id), idempotencyKey: String(h.idempotency_key), correlationId: h.correlation_id ?? null },
    operatingCompany: { id: String(h.operating_company_id) },
    destination: { id: String(d.id), externalCompanyRef: d.external_company_ref ?? null },
    billingPackage: {
      id: String(p.id), version: Number(p.version), contentFingerprint: String(p.content_fingerprint), preparedAt: new Date(p.prepared_at).toISOString(),
      salesOrderId: (rental ? null : String(p.sales_order_id)) as string, salesAgreementId: p.sales_agreement_id ?? null, currency: String(p.currency), taxEvidence: "DETERMINED",
      amounts: {
        subtotalMinor: minorText(p.subtotal_minor), shippingMinor: minorText(p.shipping_minor), installChargeMinor: minorText(p.install_charge_minor),
        taxMinor: minorText(p.tax_minor), totalMinor: minorText(p.total_minor), downPaymentMinor: minorText(p.down_payment_minor),
        tradeInMinor: minorText(p.trade_in_minor), balanceMinor: minorText(p.balance_minor),
        // #203: present ONLY when a customer sales discount applies (a payload without one is unchanged).
        ...(p.customer_discount_minor === null || p.customer_discount_minor === undefined ? {} : { customerDiscountMinor: minorText(p.customer_discount_minor) }),
      },
      lines: lr.map((l) => ({
        lineNumber: Number(l.line_number), salesOrderLineNumber: (l.sales_order_line_number === null ? null : Number(l.sales_order_line_number)) as number, kind: String(l.kind), ref: String(l.ref),
        businessUnit: String(l.business_unit), billableQty: Number(l.billable_qty), unitPriceMinor: minorText(l.unit_price_minor) as string,
        extendedMinor: minorText(l.extended_minor) as string, serialNumbers: [...(l.serial_numbers ?? [])],
      })),
    },
  } as const;
  const payload: AccountingPayload = financedSale
    ? { contract: { name: ACCOUNTING_PAYLOAD_CONTRACT, version: 2 }, ...common, composition: await financedComposition(db, tenantId, p, o, cp) }
    : rental ? { contract: { name: ACCOUNTING_PAYLOAD_CONTRACT, version: 3 }, ...(common as unknown as Omit<AccountingPayloadV3, "contract" | "receivable" | "customer" | "rental">),
        receivable: { obligationId: String(o.id), amountMinor: minorText(o.originated_minor) as string, currency: String(o.currency) },
        customer: { counterpartyId: String(cp.id), kind: "EXTERNAL_ORGANIZATION", crmAccountId: String(cp.crm_account_id), name: cp.name ?? null },
        rental: await rentalBlock(db, tenantId, p) }
    : { contract: { name: ACCOUNTING_PAYLOAD_CONTRACT, version: 1 }, ...common,
        receivable: { obligationId: String(o.id), amountMinor: minorText(o.originated_minor) as string, currency: String(o.currency) },
        customer: { counterpartyId: String(cp.id), kind: "EXTERNAL_ORGANIZATION", crmAccountId: String(cp.crm_account_id), name: cp.name ?? null } };
  const fingerprint = createHash("sha256").update(canonicalJson(payload)).digest("hex");
  const destination: AccountingDestinationRef = { id: String(d.id), operatingCompanyId: String(d.operating_company_id), providerKey: String(d.provider_key),
    externalCompanyRef: d.external_company_ref ?? null };
  return { payload: deepFreeze(payload), fingerprint, destination: deepFreeze(destination) };
}

/**
 * The financed composition (v2), fail closed: the arrangement is funding-entitled by SIGNED + APPROVED evidence; the
 * provider's FUNDING_RECEIVABLE is the financed amount; the customer's RECEIVABLE is exactly the contribution (and exists
 * only when it is positive); contribution + financed = total; nothing VOID; one company, one currency.
 */
async function financedComposition(db: Queryable, tenantId: string, p: Record<string, any>, funding: Record<string, any>, customer: Record<string, any>)
  : Promise<AccountingPayloadV2["composition"]> {
  const { rows: fr } = await db.query(
    `SELECT fa.*, e.document_reference, e.signed, e.approved, e.recorded_at AS evidence_recorded_at
       FROM eos_commercial.financing_arrangements fa LEFT JOIN eos_commercial.financing_approval_evidence e ON e.id = fa.entitlement_evidence_id
      WHERE fa.tenant_id = $1 AND fa.id = $2`, [tenantId, p.financing_arrangement_id]);
  const fa = fr[0];
  if (!fa || !["FUNDING_ENTITLED", "FUNDED"].includes(fa.status) || fa.signed !== true || fa.approved !== true) {
    refuse("PAYLOAD_FUNDING_NOT_ENTITLED", "PRECONDITION_FAILED", "a financed sale is delivered only once signed + approved provider documentation entitles Taylor");
  }
  const { rows: pr } = await db.query(
    `SELECT c.id, c.kind, c.crm_account_id, a.name FROM eos_finance.financial_counterparties c
       LEFT JOIN eos_crm.accounts a ON a.tenant_id = c.tenant_id AND a.id = c.crm_account_id WHERE c.tenant_id = $1 AND c.id = $2`, [tenantId, p.financing_provider_counterparty_id]);
  const provider = pr[0];
  if (!provider || provider.kind !== "EXTERNAL_ORGANIZATION" || provider.crm_account_id !== fa.financing_provider_account_id) {
    refuse("PAYLOAD_PROVIDER_MISMATCH", "PRECONDITION_FAILED", "the package's provider is not the arrangement's provider");
  }
  const contribution = BigInt(p.customer_contribution_minor);
  const financed = BigInt(p.financed_amount_minor);
  const { rows: cr } = await db.query(
    `SELECT o.id, o.counterparty_id, o.currency, o.status, b.originated_minor FROM eos_finance.obligations o
       JOIN eos_finance.obligation_balances b ON b.tenant_id = o.tenant_id AND b.obligation_id = o.id
      WHERE o.tenant_id = $1 AND o.source_domain = 'BILLING_PACKAGE' AND o.source_record_id = $2 AND o.kind = 'RECEIVABLE'`, [tenantId, p.id]);
  const ar = cr[0];
  const arValid = contribution === 0n ? !ar
    : Boolean(ar && ar.status !== "VOID" && ar.counterparty_id === p.counterparty_id && ar.currency === p.currency && BigInt(ar.originated_minor) === contribution);
  const tradeInCredit = BigInt(p.trade_in_minor ?? 0);
  if (!arValid || contribution + tradeInCredit + financed !== BigInt(p.total_minor) || BigInt(funding.originated_minor) !== financed) {
    refuse("PAYLOAD_COMPOSITION_MISMATCH", "PRECONDITION_FAILED", "the receivables are not exactly the package's composition -- nothing is delivered");
  }
  return {
    kind: "FINANCED_SALE", currency: String(p.currency), totalCommercialMinor: String(p.total_minor), tradeInCreditMinor: tradeInCredit.toString(),
    commercialCustomer: { counterpartyId: String(customer.id), crmAccountId: String(customer.crm_account_id), name: customer.name ?? null,
      contributionMinor: contribution.toString(), receivable: ar ? { obligationId: String(ar.id), kind: "RECEIVABLE", amountMinor: contribution.toString() } : null },
    financingProvider: { counterpartyId: String(provider.id), crmAccountId: String(provider.crm_account_id), name: provider.name ?? null,
      financedAmountMinor: financed.toString(), receivable: { obligationId: String(funding.id), kind: "FUNDING_RECEIVABLE", amountMinor: financed.toString() },
      arrangementId: String(fa.id), arrangementKind: String(fa.arrangement_kind), providerReference: fa.provider_reference ?? null, fundingStatus: String(fa.status),
      approvalEvidence: { evidenceId: String(fa.entitlement_evidence_id), documentReference: String(fa.document_reference), signed: true, approved: true,
        recordedAt: new Date(fa.evidence_recorded_at).toISOString() } },
  };
}

/** First delivery of a READY_FOR_DELIVERY handoff. A replayed request returns its attempt; a second request refuses. */
export async function deliverAccountingHandoff(deps: AccountingDeliveryDeps, actor: FinanceActor, input: { handoffId: unknown; idempotencyKey: unknown }) {
  return runAttempt(deps, actor, { handoffId: requireText(input?.handoffId, "handoffId"), requestKey: requireText(input?.idempotencyKey, "idempotencyKey"),
    initiation: "INITIAL", reason: null });
}

/** A GOVERNED retry: only after a RETRYABLE failure, with a stated reason. Never automatic. */
export async function retryAccountingHandoffDelivery(deps: AccountingDeliveryDeps, actor: FinanceActor, input: { handoffId: unknown; reason: unknown; idempotencyKey: unknown }) {
  return runAttempt(deps, actor, { handoffId: requireText(input?.handoffId, "handoffId"), requestKey: requireText(input?.idempotencyKey, "idempotencyKey"),
    initiation: "GOVERNED_RETRY", reason: requireText(input?.reason, "reason") });
}

async function replayOf(db: Queryable, tenantId: string, requestKey: string): Promise<DeliveryResult | null> {
  const { rows } = await db.query(
    `SELECT a.*, h.status AS handoff_status, x.id AS exception_id FROM eos_finance.accounting_handoff_attempts a
       JOIN eos_finance.accounting_handoffs h ON h.tenant_id = a.tenant_id AND h.id = a.handoff_id
       LEFT JOIN eos_finance.accounting_handoff_exceptions x ON x.tenant_id = a.tenant_id AND x.attempt_id = a.id
      WHERE a.tenant_id = $1 AND a.request_idempotency_key = $2`, [tenantId, requestKey]);
  const a = rows[0];
  return a ? resultOf("replayed", a, a.handoff_status, a.exception_id) : null;
}
const resultOf = (outcome: "delivered" | "replayed", a: Record<string, any>, handoffStatus: string, exceptionId: string | null): DeliveryResult => Object.freeze({
  outcome, handoffId: String(a.handoff_id), attemptId: String(a.id), attemptNumber: Number(a.attempt_number), attemptOutcome: a.outcome,
  handoffStatus, providerDocumentReference: a.provider_document_reference ?? null, failureCode: a.failure_code ?? null, exceptionId: exceptionId ?? null,
});

const REFERENCE = /^[\x21-\x7e](?:[\x20-\x7e]{0,198}[\x21-\x7e])?$/;
const FAILURE_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const DISPOSITIONS: readonly string[] = ["REJECTED", "FAILED_RETRYABLE", "FAILED_FINAL"];

/** Narrow the adapter's answer: a validated reference, or a validated failure. Anything else fails CLOSED (final, reviewed). */
function interpret(adapter: AccountingDeliveryAdapter, response: unknown, fingerprint: string)
  : { outcome: "ACKNOWLEDGED"; reference: string } | { outcome: DeliveryFailureDisposition; code: string; detail: string | null } {
  let ack: ProviderAcknowledgement | null = null;
  let rej: ProviderRejection | null = null;
  try {
    ack = adapter.interpretAcknowledgement(response);
    if (!ack) rej = adapter.interpretRejection(response);
  } catch {
    return { outcome: "FAILED_FINAL", code: "PROVIDER_RESPONSE_UNINTERPRETABLE", detail: null };
  }
  if (ack) {
    const reference = typeof ack.providerDocumentReference === "string" ? ack.providerDocumentReference.trim() : "";
    if (!REFERENCE.test(reference)) return { outcome: "FAILED_FINAL", code: "PROVIDER_REFERENCE_INVALID", detail: null };
    if (ack.echoedPayloadFingerprint !== undefined && ack.echoedPayloadFingerprint !== fingerprint) {
      return { outcome: "FAILED_FINAL", code: "ACKNOWLEDGEMENT_PAYLOAD_MISMATCH", detail: "the provider acknowledged a different payload" };
    }
    return { outcome: "ACKNOWLEDGED", reference };
  }
  if (rej && DISPOSITIONS.includes(rej.disposition) && typeof rej.code === "string" && FAILURE_CODE.test(rej.code)) {
    const detail = typeof rej.detail === "string" ? rej.detail.replace(/[^\x20-\x7e]/g, " ").slice(0, 500) : null;
    return { outcome: rej.disposition, code: rej.code, detail };
  }
  return { outcome: "FAILED_FINAL", code: "PROVIDER_RESPONSE_UNINTERPRETABLE", detail: null };
}

async function runAttempt(deps: AccountingDeliveryDeps, actor: FinanceActor,
  r: { handoffId: string; requestKey: string; initiation: "INITIAL" | "GOVERNED_RETRY"; reason: string | null }): Promise<DeliveryResult> {
  const adapters = deps.adapters ?? PRODUCTION_ACCOUNTING_ADAPTERS;
  // ── 1. START: one transaction records the attempt and moves the handoff into delivery (or replays / refuses) ──
  const started = await tx(deps.pool, async (c) => {
    const replay = await replayOf(c, actor.tenantId, r.requestKey);
    if (replay) return { replay } as const;
    const { rows } = await c.query(`SELECT * FROM eos_finance.accounting_handoffs WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [actor.tenantId, r.handoffId]);
    const h = rows[0] ?? refuse("ACCOUNTING_HANDOFF_NOT_FOUND", "NOT_FOUND", "no accounting handoff with that id");
    const required = r.initiation === "INITIAL" ? "READY_FOR_DELIVERY" : "FAILED_RETRYABLE";
    if (h.status !== required) {
      refuse(r.initiation === "INITIAL" ? "HANDOFF_NOT_DELIVERABLE" : "HANDOFF_NOT_RETRYABLE", "CONFLICT",
        `a ${r.initiation === "INITIAL" ? "first delivery" : "governed retry"} requires ${required}; the handoff is ${h.status}`);
    }
    const built = await buildAccountingPayload(c, actor.tenantId, r.handoffId);
    const adapter = adapters[built.destination.providerKey];
    if (!adapter || adapter.key !== built.destination.providerKey) {
      refuse("ADAPTER_NOT_AVAILABLE", "PRECONDITION_FAILED", "no delivery adapter is available for this destination (no provider is configured)");
    }
    let retryOf: string | null = null;
    if (r.initiation === "GOVERNED_RETRY") {
      const { rows: last } = await c.query(
        `SELECT id FROM eos_finance.accounting_handoff_attempts WHERE tenant_id = $1 AND handoff_id = $2 ORDER BY attempt_number DESC LIMIT 1`, [actor.tenantId, h.id]);
      retryOf = String(last[0].id);
    }
    const attemptNumber = Number(h.attempt_count) + 1;
    const deliveryKey = `delivery:${h.id}:${built.fingerprint.slice(0, 32)}`;
    const attemptId = `aha_${randomUUID()}`;
    await c.query(
      `INSERT INTO eos_finance.accounting_handoff_attempts (id, tenant_id, handoff_id, attempt_number, operating_company_id, accounting_destination_id,
          adapter_key, payload_contract, payload_contract_version, payload, payload_fingerprint, delivery_idempotency_key, request_idempotency_key,
          initiation, retry_of_attempt_id, retry_reason, initiated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [attemptId, actor.tenantId, h.id, attemptNumber, h.operating_company_id, built.destination.id, adapter.key, ACCOUNTING_PAYLOAD_CONTRACT,
        built.payload.contract.version, canonicalJson(built.payload), built.fingerprint, deliveryKey, r.requestKey, r.initiation, retryOf, r.reason, actor.principalId]);
    await c.query(
      `UPDATE eos_finance.accounting_handoffs SET status = 'DELIVERY_IN_PROGRESS', attempt_count = attempt_count + 1, last_attempt_at = now(),
          failure_reason = NULL, updated_at = now() WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, h.id]);
    return { attemptId, attemptNumber, deliveryKey, adapter, built } as const;
  }).catch(async (err) => {
    // The same request racing itself: the loser's unique request key means the winner's attempt IS the answer.
    if ((err as { code?: string })?.code === "23505") {
      const replay = await replayOf(deps.pool, actor.tenantId, r.requestKey);
      if (replay) return { replay } as const;
    }
    throw err;
  });
  if ("replay" in started) return started.replay as DeliveryResult;

  // ── 2. DELIVER, outside any transaction: the adapter sees frozen copies and has no database handle ──
  const { adapter, built } = started;
  let interpreted: ReturnType<typeof interpret>;
  try {
    const prepared = adapter.prepare(built.payload, built.destination, started.deliveryKey);
    const response = await adapter.deliver(prepared);
    interpreted = interpret(adapter, response, built.fingerprint);
  } catch {
    // A delivery that threw is treated as retryable -- but only a governed retry ever re-attempts it.
    interpreted = { outcome: "FAILED_RETRYABLE", code: "ADAPTER_DELIVERY_ERROR", detail: null };
  }

  // ── 3. RECORD the outcome once. Nothing here touches a package, an obligation or a financial fact. ──
  return tx(deps.pool, async (c) => {
    const { rows } = await c.query(`SELECT * FROM eos_finance.accounting_handoff_attempts WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [actor.tenantId, started.attemptId]);
    const a = rows[0];
    if (a.outcome !== "IN_PROGRESS") return resultOf("replayed", a, "UNKNOWN", null);
    const ack = interpreted.outcome === "ACKNOWLEDGED" ? (interpreted as { reference: string }).reference : null;
    const fail = interpreted.outcome === "ACKNOWLEDGED" ? null : (interpreted as { code: string; detail: string | null });
    const { rows: done } = await c.query(
      `UPDATE eos_finance.accounting_handoff_attempts SET outcome = $3, outcome_at = now(), provider_document_reference = $4, failure_code = $5, failure_detail = $6
        WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [actor.tenantId, a.id, interpreted.outcome, ack, fail?.code ?? null, fail?.detail ?? null]);
    await c.query(
      `UPDATE eos_finance.accounting_handoffs SET status = $3, provider_document_reference = $4, provider_acknowledged_at = CASE WHEN $4::text IS NULL THEN NULL ELSE now() END,
          failure_reason = $5, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
      [actor.tenantId, a.handoff_id, interpreted.outcome, ack, fail?.code ?? null]);
    let exceptionId: string | null = null;
    if (interpreted.outcome === "REJECTED" || interpreted.outcome === "FAILED_FINAL") {
      exceptionId = `ahx_${randomUUID()}`;
      await c.query(
        `INSERT INTO eos_finance.accounting_handoff_exceptions (id, tenant_id, handoff_id, attempt_id, operating_company_id, kind, reason_code, detail, required_action)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [exceptionId, actor.tenantId, a.handoff_id, a.id, a.operating_company_id,
          interpreted.outcome === "REJECTED" ? "PROVIDER_REJECTED" : "DELIVERY_FAILED_FINAL", fail!.code, fail!.detail,
          interpreted.outcome === "REJECTED" ? "CORRECT_AND_SUPERSEDE_PACKAGE" : "REVIEW_DESTINATION_CONFIGURATION"]);
    }
    return resultOf("delivered", done[0], interpreted.outcome, exceptionId);
  });
}

/** Resolve an OPEN delivery exception once, with a stated resolution. The receivable and the handoff are untouched. */
export async function resolveAccountingHandoffException(pool: Pool, actor: FinanceActor, input: { exceptionId: unknown; resolution: unknown }) {
  const exceptionId = requireText(input?.exceptionId, "exceptionId");
  const resolution = requireText(input?.resolution, "resolution");
  const { rows } = await pool.query(
    `UPDATE eos_finance.accounting_handoff_exceptions SET status = 'RESOLVED', resolved_by = $3, resolved_at = now(), resolution = $4
      WHERE tenant_id = $1 AND id = $2 AND status = 'OPEN' RETURNING id`, [actor.tenantId, exceptionId, actor.principalId, resolution]);
  if (!rows[0]) refuse("ACCOUNTING_EXCEPTION_NOT_OPEN", "CONFLICT", "no OPEN delivery exception with that id");
  return Object.freeze({ exceptionId, status: "RESOLVED" as const });
}

/** Read one handoff's delivery record: the handoff, its attempts and its exceptions. */
export async function readAccountingHandoffDelivery(db: Queryable, tenantId: string, handoffId: string) {
  const { rows: h } = await db.query(`SELECT * FROM eos_finance.accounting_handoffs WHERE tenant_id = $1 AND id = $2`, [tenantId, handoffId]);
  if (!h[0]) return null;
  const { rows: attempts } = await db.query(
    `SELECT * FROM eos_finance.accounting_handoff_attempts WHERE tenant_id = $1 AND handoff_id = $2 ORDER BY attempt_number`, [tenantId, handoffId]);
  const { rows: exceptions } = await db.query(
    `SELECT * FROM eos_finance.accounting_handoff_exceptions WHERE tenant_id = $1 AND handoff_id = $2 ORDER BY opened_at, id`, [tenantId, handoffId]);
  return Object.freeze({ handoff: h[0], attempts, exceptions });
}

/** #207: the rental block of a v3 payload -- the agreement and the charged period, read from governed records. */
async function rentalBlock(db: Queryable, tenantId: string, p: Record<string, any>): Promise<AccountingPayloadV3["rental"]> {
  const { rows } = await db.query(
    `SELECT c.id, c.kind, to_char(c.period_start, 'YYYY-MM-DD') AS ps, to_char(c.period_end, 'YYYY-MM-DD') AS pe, g.id AS agreement_id, g.rental_agreement_number
       FROM eos_rental.rental_charges c JOIN eos_rental.rental_agreements g ON g.tenant_id = c.tenant_id AND g.id = c.agreement_id
      WHERE c.tenant_id = $1 AND c.id = $2`, [tenantId, p.rental_charge_id]);
  const r = rows[0] ?? refuse("PAYLOAD_SOURCE_NOT_AUTHORITATIVE", "PRECONDITION_FAILED", "the rental package's charge is missing");
  if (r.agreement_id !== p.rental_agreement_id) refuse("PAYLOAD_SOURCE_NOT_AUTHORITATIVE", "PRECONDITION_FAILED", "the rental package names another agreement than its charge");
  return { agreementId: String(r.agreement_id), agreementNumber: String(r.rental_agreement_number), chargeId: String(r.id), chargeKind: String(r.kind),
    periodStart: r.ps ?? null, periodEnd: r.pe ?? null, ownershipTransfers: false };
}
