// FINANCING-PROVIDER FINANCED SALES (Owner ruling #200; DECISIONS #200). See migration 1764480000000 for the record.
//
// ONE Taylor commercial sale, its commercial customer unchanged, paid from two sources:
//   * the FINANCED AMOUNT -- Taylor invoices the financing provider, which pays Taylor up front. Taylor's claim is a
//     FUNDING_RECEIVABLE against the provider's counterparty (the foundation's existing kind; the database requires the
//     organization to be governed as a FINANCING_PROVIDER). The customer pays the provider under the provider's own lease;
//     EOS neither owns nor administers that, and the provider's collection / repossession is outside EOS.
//   * a CUSTOMER CONTRIBUTION (deposit / down payment), when one exists -- a separate customer RECEIVABLE for exactly that
//     amount. Never a receivable for the financed portion.
//       total commercial amount = customer contribution + financed amount        -- the two never overlap.
//
// FUNDING ENTITLEMENT (#200 §11 -- the triggering milestone is NOT yet ruled): the arrangement carries an explicit
// governed status. NO receivable of either kind exists until it reaches FUNDING_ENTITLED, which is recorded with its
// stated basis; before that a decline / cancellation simply holds. After funding nothing converts to customer A/R.
//
// Provider-neutral: the provider is any organization governed as a FINANCING_PROVIDER. Server-side only -- no transport
// operation and no capability (an employee surface is a later, governed addition).
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { ensureExternalCounterparty, FinanceFoundationError, openObligationOn, type FinanceActor, type FinanceFoundationCategory } from "./financeFoundation";
// Used at call time only (billingPackage imports this module for the financed consequence).
import * as billingPackage from "./billingPackage";

type Queryable = Pick<PoolClient, "query">;

export const FINANCING_STATUSES = Object.freeze(["APPLIED", "APPROVED", "FUNDING_ENTITLED", "FUNDED", "DECLINED", "CANCELLED"] as const);
export type FinancingStatus = (typeof FINANCING_STATUSES)[number];
/** Exact transitions (the database enforces the same set). FUNDED, DECLINED and CANCELLED are terminal. */
export const FINANCING_TRANSITIONS: Readonly<Record<FinancingStatus, readonly FinancingStatus[]>> = Object.freeze({
  APPLIED: ["APPROVED", "DECLINED", "CANCELLED"],
  APPROVED: ["FUNDING_ENTITLED", "DECLINED", "CANCELLED"],
  FUNDING_ENTITLED: ["FUNDED"],
  FUNDED: [],
  DECLINED: [],
  CANCELLED: [],
});
/** States in which the provider's payment is owed to Taylor: only then does any receivable exist. */
export const FUNDING_ENTITLED_STATES: readonly FinancingStatus[] = Object.freeze(["FUNDING_ENTITLED", "FUNDED"]);

export interface FinancedConsequence {
  readonly financing: "HELD_UNTIL_FUNDING_ENTITLEMENT" | "ESTABLISHED";
  readonly arrangementStatus: string;
  readonly fundingReceivable: { readonly outcome: "recorded" | "replayed"; readonly obligationId: string; readonly amountMinor: string } | null;
  readonly contributionReceivable: { readonly outcome: "recorded" | "replayed"; readonly obligationId: string; readonly amountMinor: string } | null;
}

const refuse = (code: string, category: FinanceFoundationCategory, message: string): never => {
  throw new FinanceFoundationError(code, category, message);
};
const text = (v: unknown, name: string, max = 200): string => {
  if (typeof v !== "string" || v.trim() === "" || v.length > max) refuse(`${name.replace(/[A-Z]/g, (m) => `_${m}`).toUpperCase()}_REQUIRED`, "INVALID_INPUT", `${name} is required`);
  return (v as string).trim();
};

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

/** Record the customer's financing arrangement on its Sales Agreement. The commercial customer is never replaced. */
export async function recordFinancingArrangement(pool: Pool, actor: FinanceActor, input: {
  salesAgreementId: unknown; financingProviderAccountId: unknown; arrangementKind: unknown; customerContributionMinor: unknown;
  providerReference?: unknown; idempotencyKey: unknown;
}) {
  for (const k of Object.keys(input ?? {})) {
    if (!["salesAgreementId", "financingProviderAccountId", "arrangementKind", "customerContributionMinor", "providerReference", "idempotencyKey"].includes(k)) {
      refuse("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `not accepted: ${k}`);
    }
  }
  const agreementId = text(input.salesAgreementId, "salesAgreementId");
  const providerId = text(input.financingProviderAccountId, "financingProviderAccountId");
  const key = text(input.idempotencyKey, "idempotencyKey");
  if (input.arrangementKind !== "LEASE" && input.arrangementKind !== "FINANCING") refuse("ARRANGEMENT_KIND_INVALID", "INVALID_INPUT", "arrangementKind is LEASE or FINANCING");
  // The contribution is stated explicitly -- 0 is a real "none", an omission is not.
  if (!Number.isSafeInteger(input.customerContributionMinor) || (input.customerContributionMinor as number) < 0) {
    refuse("CUSTOMER_CONTRIBUTION_INVALID", "INVALID_INPUT", "customerContributionMinor is stated in non-negative minor units (0 = none)");
  }
  const reference = input.providerReference === undefined || input.providerReference === null ? null : text(input.providerReference, "providerReference");
  return tx(pool, async (c) => {
    const { rows: replay } = await c.query(`SELECT * FROM eos_commercial.financing_arrangements WHERE tenant_id = $1 AND idempotency_key = $2`, [actor.tenantId, key]);
    if (replay[0]) return Object.freeze({ outcome: "replayed" as const, arrangementId: String(replay[0].id), status: String(replay[0].status) });
    const { rows: ag } = await c.query(`SELECT id, account_id, currency, state::text AS state FROM eos_commercial.sales_agreements WHERE tenant_id = $1 AND id = $2 FOR SHARE`,
      [actor.tenantId, agreementId]);
    const a = ag[0] ?? refuse("SALES_AGREEMENT_NOT_FOUND", "NOT_FOUND", "no Sales Agreement with that id");
    if (a.state === "DECLINED") refuse("SALES_AGREEMENT_DECLINED", "PRECONDITION_FAILED", "a declined Agreement takes no financing");
    if (a.account_id === providerId) refuse("FINANCING_PROVIDER_IS_CUSTOMER", "PRECONDITION_FAILED", "the financing provider never replaces the commercial customer");
    const id = `fin_${randomUUID()}`;
    await c.query(
      `INSERT INTO eos_commercial.financing_arrangements (id, tenant_id, sales_agreement_id, commercial_customer_account_id, financing_provider_account_id,
          arrangement_kind, currency, customer_contribution_minor, provider_reference, idempotency_key, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,
      [id, actor.tenantId, agreementId, a.account_id, providerId, input.arrangementKind, a.currency ?? "USD", input.customerContributionMinor, reference, key, actor.principalId])
      .catch((e: { message?: string; constraint?: string }) => {
        if (/FINANCING_PROVIDER_NOT_GOVERNED/.test(e.message ?? "")) refuse("FINANCING_PROVIDER_NOT_GOVERNED", "PRECONDITION_FAILED", "the organization is not governed as a financing provider");
        if (e.constraint === "financing_arrangement_one_per_agreement") refuse("FINANCING_ARRANGEMENT_EXISTS", "CONFLICT", "the Agreement already has a financing arrangement");
        throw e;
      });
    await c.query(
      `INSERT INTO eos_commercial.financing_arrangement_events (id, tenant_id, arrangement_id, from_status, to_status, reason, provider_reference, recorded_by, idempotency_key)
       VALUES ($1,$2,$3,NULL,'APPLIED','financing arrangement recorded',$4,$5,$6)`, [`fev_${randomUUID()}`, actor.tenantId, id, reference, actor.principalId, `${key}:applied`]);
    return Object.freeze({ outcome: "recorded" as const, arrangementId: id, status: "APPLIED" });
  });
}

/**
 * Move an arrangement along its governed lifecycle. Entering FUNDING_ENTITLED requires the stated entitlement basis and,
 * in the same transaction, establishes the receivables of the Agreement's current READY financed package (if one exists;
 * otherwise the package establishes them when it becomes READY).
 */
export async function transitionFinancingArrangement(pool: Pool, actor: FinanceActor, input: {
  arrangementId: unknown; toStatus: unknown; reason: unknown; fundingEntitlementBasis?: unknown; providerReference?: unknown; idempotencyKey: unknown;
}) {
  const id = text(input.arrangementId, "arrangementId");
  const reason = text(input.reason, "reason", 500);
  const key = text(input.idempotencyKey, "idempotencyKey");
  const to = input.toStatus as FinancingStatus;
  if (!FINANCING_STATUSES.includes(to)) refuse("FINANCING_STATUS_INVALID", "INVALID_INPUT", `toStatus is one of ${FINANCING_STATUSES.join(", ")}`);
  const basis = to === "FUNDING_ENTITLED" ? text(input.fundingEntitlementBasis, "fundingEntitlementBasis", 500) : null;
  if (to !== "FUNDING_ENTITLED" && input.fundingEntitlementBasis !== undefined) refuse("FIELD_NOT_ACCEPTED", "INVALID_INPUT", "an entitlement basis belongs only to FUNDING_ENTITLED");
  const reference = input.providerReference === undefined || input.providerReference === null ? null : text(input.providerReference, "providerReference");
  return tx(pool, async (c) => {
    const { rows: replay } = await c.query(`SELECT to_status FROM eos_commercial.financing_arrangement_events WHERE tenant_id = $1 AND idempotency_key = $2`, [actor.tenantId, key]);
    if (replay[0]) return Object.freeze({ outcome: "replayed" as const, arrangementId: id, status: String(replay[0].to_status), consequences: [] });
    const { rows } = await c.query(`SELECT * FROM eos_commercial.financing_arrangements WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [actor.tenantId, id]);
    const fa = rows[0] ?? refuse("FINANCING_ARRANGEMENT_NOT_FOUND", "NOT_FOUND", "no financing arrangement with that id");
    if (!FINANCING_TRANSITIONS[fa.status as FinancingStatus].includes(to)) {
      refuse("FINANCING_TRANSITION_REFUSED", "CONFLICT", `${fa.status} -> ${to} is not a financing transition`);
    }
    if (reference !== null && fa.provider_reference !== null && reference !== fa.provider_reference) {
      refuse("PROVIDER_REFERENCE_ALREADY_RECORDED", "CONFLICT", "a provider reference is recorded once");
    }
    await c.query(
      `UPDATE eos_commercial.financing_arrangements SET status = $3, funding_entitlement_basis = COALESCE($4, funding_entitlement_basis),
          provider_reference = COALESCE(provider_reference, $5), updated_by = $6, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
      [actor.tenantId, id, to, basis, reference, actor.principalId]);
    await c.query(
      `INSERT INTO eos_commercial.financing_arrangement_events (id, tenant_id, arrangement_id, from_status, to_status, reason, provider_reference, recorded_by, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [`fev_${randomUUID()}`, actor.tenantId, id, fa.status, to, basis ? `${reason} [entitlement basis: ${basis}]` : reason, reference, actor.principalId, key]);
    const consequences = [];
    if (to === "DECLINED" || to === "CANCELLED") {
      // Before funding, a decline / cancellation HOLDS the sale (#200 §12): its READY package is re-evaluated, and the new
      // version is HELD with FINANCING_NOT_AVAILABLE. Nothing becomes customer A/R.
      const { rows: so } = await c.query(
        `SELECT DISTINCT p.sales_order_id FROM eos_finance.billing_packages p WHERE p.tenant_id = $1 AND p.financing_arrangement_id = $2 AND p.status = 'READY'`, [actor.tenantId, id]);
      for (const r of so) consequences.push(await billingPackage.prepareBillingPackageOn(c, actor, { salesOrderId: String(r.sales_order_id) }));
    }
    if (to === "FUNDING_ENTITLED") {
      const { rows: pk } = await c.query(
        `SELECT id FROM eos_finance.billing_packages WHERE tenant_id = $1 AND financing_arrangement_id = $2 AND status = 'READY'`, [actor.tenantId, id]);
      for (const p of pk) consequences.push({ packageId: String(p.id), ...(await financedConsequenceOn(c, actor, String(p.id))) });
    }
    return Object.freeze({ outcome: "transitioned" as const, arrangementId: id, status: to, consequences });
  });
}

/**
 * THE FINANCED CONSEQUENCE of ONE READY financed package, inside the caller's transaction. HELD until the arrangement is
 * funding-entitled; then exactly one FUNDING_RECEIVABLE (provider, financed amount) and -- only for a positive contribution
 * -- one customer RECEIVABLE (contribution amount). Idempotent; amounts come from the package, never re-derived.
 */
export async function financedConsequenceOn(c: Queryable, actor: FinanceActor, packageId: string): Promise<FinancedConsequence> {
  const { rows } = await c.query(
    `SELECT p.*, fa.status AS arrangement_status FROM eos_finance.billing_packages p
       JOIN eos_commercial.financing_arrangements fa ON fa.tenant_id = p.tenant_id AND fa.id = p.financing_arrangement_id
      WHERE p.tenant_id = $1 AND p.id = $2`, [actor.tenantId, packageId]);
  const p = rows[0] ?? refuse("FINANCED_PACKAGE_NOT_FOUND", "NOT_FOUND", "no financed billing package with that id");
  if (p.status !== "READY" || p.commercial_disposition !== "FINANCED_SALE" || p.obligor_basis !== "FINANCING_PROVIDER_FUNDED") {
    refuse("FINANCED_PACKAGE_NOT_READY", "PRECONDITION_FAILED", "only a READY financed package has a financed consequence");
  }
  if (p.tax_evidence_status !== "DETERMINED") refuse("TAX_NOT_DETERMINED", "PRECONDITION_FAILED", "the package's tax is not from DETERMINED evidence");
  if (!FUNDING_ENTITLED_STATES.includes(p.arrangement_status)) {
    return Object.freeze({ financing: "HELD_UNTIL_FUNDING_ENTITLEMENT" as const, arrangementStatus: String(p.arrangement_status), fundingReceivable: null, contributionReceivable: null });
  }
  const financed = BigInt(p.financed_amount_minor);
  const contribution = BigInt(p.customer_contribution_minor);
  if (financed + contribution !== BigInt(p.total_minor)) refuse("FINANCING_COMPOSITION_MISMATCH", "PRECONDITION_FAILED", "contribution + financed must equal the total");
  const funding = await openObligationOn(c, actor, {
    operatingCompanyId: p.operating_company_id, counterpartyId: p.financing_provider_counterparty_id, kind: "FUNDING_RECEIVABLE", currency: p.currency,
    sourceDomain: "BILLING_PACKAGE", sourceRecordId: packageId, originationAmountMinor: financed, basis: "FINANCED_SALE_FINANCED_AMOUNT",
    effectiveAt: p.prepared_at, idempotencyKey: `fr:bpk:${packageId}`, correlationId: p.sales_order_id,
  });
  let contributionReceivable = null;
  if (contribution > 0n) {
    const ar = await openObligationOn(c, actor, {
      operatingCompanyId: p.operating_company_id, counterpartyId: p.counterparty_id, kind: "RECEIVABLE", currency: p.currency,
      sourceDomain: "BILLING_PACKAGE", sourceRecordId: packageId, originationAmountMinor: contribution, basis: "FINANCED_SALE_CUSTOMER_CONTRIBUTION",
      effectiveAt: p.prepared_at, idempotencyKey: `ar:bpk:${packageId}`, correlationId: p.sales_order_id,
    });
    contributionReceivable = Object.freeze({ outcome: ar.outcome, obligationId: ar.obligationId, amountMinor: contribution.toString() });
  }
  return Object.freeze({
    financing: "ESTABLISHED" as const, arrangementStatus: String(p.arrangement_status),
    fundingReceivable: Object.freeze({ outcome: funding.outcome, obligationId: funding.obligationId, amountMinor: financed.toString() }), contributionReceivable,
  });
}

/** Read an arrangement and its history. */
export async function readFinancingArrangement(db: Queryable, tenantId: string, arrangementId: string) {
  const { rows } = await db.query(`SELECT * FROM eos_commercial.financing_arrangements WHERE tenant_id = $1 AND id = $2`, [tenantId, arrangementId]);
  if (!rows[0]) return null;
  const { rows: events } = await db.query(
    `SELECT from_status, to_status, reason, provider_reference, recorded_by, recorded_at FROM eos_commercial.financing_arrangement_events
      WHERE tenant_id = $1 AND arrangement_id = $2 ORDER BY recorded_at, id`, [tenantId, arrangementId]);
  return Object.freeze({ arrangement: rows[0], events });
}

/** Resolve the provider's counterparty for a package (the organization's single EXTERNAL_ORGANIZATION counterparty). */
export async function providerCounterpartyOn(c: Queryable, actor: FinanceActor, providerAccountId: string): Promise<string> {
  return (await ensureExternalCounterparty(c, actor, providerAccountId)).id;
}
