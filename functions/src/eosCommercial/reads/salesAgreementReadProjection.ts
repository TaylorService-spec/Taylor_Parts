// Governed PostgreSQL Sales Agreement read projections -- wave C3. Reached only through the C4 transport (commercialHttp.ts).
//
// Totals are NOT stored (C1 keeps only the charge inputs): subtotal / total / balance are computed at read time by the
// existing governed arithmetic, computeAgreementTotals, from the stored lines and charges -- never a second stored
// answer. Acceptance is projected as PostgreSQL holds it: accepted_at and accepted_by (a governed EOS principal id,
// not a Firebase uid), which the C1 CHECK constraint keeps present exactly when state is ACCEPTED.
// Lineage is derived from foreign keys: the source Opportunity from sales_agreements.opportunity_id, the resulting
// Sales Order from sales_orders.sales_agreement_id -- never a stored backlink.
import { SALES_AGREEMENT_STATES } from "../../salesAgreement/salesAgreementLifecycle";
import { computeAgreementTotals } from "../../salesAgreement/salesAgreementCommands";
import { fail } from "../commands/commercialCommandKernel";
import {
  COMMERCIAL_READ_CAPABILITIES, decodeCommercialCursor, isoOf, minorOf, optionalAccountId, pageOf, personOf, refuseOutsideReach, SALES_CHANNEL_SCOPED, salesChannelScopedWithLineage,
  requireEnumFilter, requirePageSize, requireRecordId, runCommercialRead, type CommercialPersonReference, type CommercialReadActor,
  type CommercialReadDeps, type Queryable,
} from "./commercialReadKernel";
import type { CommercialLineageReference, CommercialPage } from "./opportunityReadProjection";

export interface SalesAgreementLineProjection {
  readonly lineNumber: number;
  readonly kind: string;
  readonly ref: string;
  readonly businessUnit: string;
  readonly quantity: number;
  /** The committed unit price, integer minor units; null while unpriced. */
  readonly unitPriceMinor: number | null;
  /** quantity x unitPriceMinor; null when unpriced, never 0. */
  readonly extendedMinor: number | null;
  readonly condition: string | null;
  readonly warranty: string | null;
  readonly estimatedArrivalAt: string | null;
}

export interface SalesAgreementTotalsProjection {
  /** The SELLING PRICE (the lines' arithmetic). */
  readonly subtotalMinor: number | null;
  /** The customer sales discount amount (0 when none) and SELLING PRICE - DISCOUNT (#203). */
  readonly customerDiscountMinor: number | null;
  readonly netSellingMinor: number | null;
  readonly shippingMinor: number;
  readonly installChargeMinor: number;
  readonly taxMinor: number;
  readonly totalMinor: number | null;
  readonly downPaymentMinor: number;
  readonly tradeInMinor: number;
  readonly balanceMinor: number | null;
}

/**
 * TAX EVIDENCE (DECISIONS #197): unknown tax is not zero tax. `amountMinor` is present only for a DETERMINED tax (0 = a
 * determined zero); NOT_DETERMINED and LEGACY_UNVERIFIED carry none, whatever the stored charge column says.
 */
export interface SalesAgreementTaxEvidenceProjection {
  readonly status: "NOT_DETERMINED" | "DETERMINED" | "LEGACY_UNVERIFIED";
  readonly amountMinor: number | null;
}

/** The customer sales discount as entered (#203): what the salesperson stated, not only its amount. */
export type SalesAgreementDiscountProjection =
  | { readonly kind: "PERCENT"; readonly percentBasisPoints: number }
  | { readonly kind: "FIXED_AMOUNT"; readonly amountMinor: number }
  | null;

/**
 * One traded-in item (#203; Owner ruling #204): a PROPOSAL until decided. Only an APPROVED credit is consideration (it is
 * what the Agreement's tradeInMinor sums). Incoming equipment as known; never an acquisition value or a resale price.
 */
export interface SalesAgreementTradeInProjection {
  readonly itemNumber: number;
  readonly description: string;
  readonly manufacturer: string | null;
  readonly modelNumber: string | null;
  readonly serialNumber: string | null;
  readonly equipmentModelId: string | null;
  readonly proposedValueMinor: number;
  readonly notes: string | null;
  readonly evidenceReference: string | null;
  readonly approvalStatus: "PROPOSED" | "APPROVED" | "DECLINED";
  readonly approvedCreditMinor: number | null;
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  readonly decisionReason: string | null;
  readonly receivingOperatingCompanyId: string;
  readonly acquisitionStatus: string;
}

export interface SalesAgreementSummaryProjection {
  readonly id: string;
  readonly salesAgreementNumber: string;
  readonly opportunityId: string | null;
  readonly accountId: string;
  readonly accountName: string | null;
  readonly owner: CommercialPersonReference;
  readonly accountablePerson: CommercialPersonReference | null;
  readonly creditedSalesperson: CommercialPersonReference | null;
  /** The governed operating company, resolved from the stored key through the ACTIVE binding; null when unbound. */
  readonly operatingCompanyId: string | null;
  /** The stored operating company KEY (a different vocabulary from the company id). */
  readonly operatingCompanyKey: string | null;
  readonly state: string;
  readonly currency: string;
  readonly acceptedAt: string | null;
  /** The governed EOS principal who accepted; null unless ACCEPTED. */
  readonly acceptedByPrincipalId: string | null;
  readonly totals: SalesAgreementTotalsProjection;
  readonly taxEvidence: SalesAgreementTaxEvidenceProjection;
  readonly customerDiscount: SalesAgreementDiscountProjection;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lines: readonly SalesAgreementLineProjection[];
}

export interface SalesAgreementDetailProjection extends SalesAgreementSummaryProjection {
  readonly location: { readonly locationId: string; readonly name: string | null } | null;
  readonly customerPO: string | null;
  readonly isLease: boolean | null;
  readonly fulfillmentIntent: string | null;
  readonly shippingInstructions: string | null;
  readonly shipVia: string | null;
  readonly specialInstructions: string | null;
  readonly sourceOpportunity: CommercialLineageReference | null;
  readonly salesOrder: CommercialLineageReference | null;
  readonly tradeIns: readonly SalesAgreementTradeInProjection[];
}

/** Every governed Agreement create writes both; C1 leaves them nullable only for identity-only rows. */
export const SALES_AGREEMENT_IS_COMPLETE = "a.state IS NOT NULL AND a.currency IS NOT NULL";

const SUMMARY_COLUMNS = `a.id, a.sales_agreement_number, a.opportunity_id, a.account_id, acc.name AS account_name, a.operating_company_key, (SELECT k.operating_company_id FROM eos_policy.tenant_operating_company_keys k
  WHERE k.tenant_id = a.tenant_id AND k.operating_company_key = a.operating_company_key AND k.status = 'ACTIVE') AS operating_company_id,
  a.state::text AS state, a.currency, a.accepted_at, a.accepted_by, a.created_at, a.updated_at,
  a.shipping_minor, a.install_charge_minor, a.tax_minor, a.down_payment_minor, a.trade_in_minor, a.tax_evidence_status,
  a.customer_discount_kind, a.customer_discount_basis_points, a.customer_discount_amount_minor,
  a.owner_employee_id, EXISTS (SELECT 1 FROM eos_workforce.employees e WHERE e.tenant_id = a.tenant_id AND e.id = a.owner_employee_id) AS owner_resolved,
  a.accountable_employee_id, EXISTS (SELECT 1 FROM eos_workforce.employees e WHERE e.tenant_id = a.tenant_id AND e.id = a.accountable_employee_id) AS accountable_resolved,
  a.credited_salesperson_employee_id, EXISTS (SELECT 1 FROM eos_workforce.employees e WHERE e.tenant_id = a.tenant_id AND e.id = a.credited_salesperson_employee_id) AS credited_resolved`;

type Row = Record<string, any> & { id: string };

async function linesByAgreement(db: Queryable, tenantId: string, ids: readonly string[]): Promise<Map<string, SalesAgreementLineProjection[]>> {
  const out = new Map<string, SalesAgreementLineProjection[]>(ids.map((id) => [id, []]));
  if (ids.length === 0) return out;
  const { rows } = await db.query(
    `SELECT sales_agreement_id, line_number, kind::text AS kind, ref, business_unit::text AS business_unit, quantity, unit_price_minor,
            condition::text AS condition, warranty, estimated_arrival_at
       FROM eos_commercial.sales_agreement_lines
      WHERE tenant_id = $1 AND sales_agreement_id = ANY($2::text[]) ORDER BY sales_agreement_id, line_number`,
    [tenantId, ids],
  );
  for (const l of rows) {
    const unitPriceMinor = minorOf(l.unit_price_minor);
    out.get(l.sales_agreement_id)!.push({
      lineNumber: l.line_number, kind: l.kind, ref: l.ref, businessUnit: l.business_unit, quantity: l.quantity, unitPriceMinor,
      extendedMinor: unitPriceMinor === null ? null : l.quantity * unitPriceMinor,
      condition: l.condition, warranty: l.warranty, estimatedArrivalAt: isoOf(l.estimated_arrival_at),
    });
  }
  return out;
}

const discountOf = (r: Row): SalesAgreementDiscountProjection => (r.customer_discount_kind === "PERCENT"
  ? { kind: "PERCENT", percentBasisPoints: Number(r.customer_discount_basis_points) }
  : r.customer_discount_kind === "FIXED_AMOUNT" ? { kind: "FIXED_AMOUNT", amountMinor: Number(r.customer_discount_amount_minor) } : null);

function summaryOf(r: Row, lines: readonly SalesAgreementLineProjection[]): SalesAgreementSummaryProjection {
  const customerDiscount = discountOf(r);
  const totals = computeAgreementTotals(lines.map((l) => ({ extendedMinor: l.extendedMinor })) as never, {
    shippingMinor: minorOf(r.shipping_minor) ?? undefined, installChargeMinor: minorOf(r.install_charge_minor) ?? undefined,
    taxMinor: minorOf(r.tax_minor) ?? undefined, downPaymentMinor: minorOf(r.down_payment_minor) ?? undefined,
    tradeInMinor: minorOf(r.trade_in_minor) ?? undefined,
  }, customerDiscount);
  return {
    id: r.id, salesAgreementNumber: r.sales_agreement_number, opportunityId: r.opportunity_id, accountId: r.account_id,
    accountName: r.account_name ?? null,
    owner: personOf(r.owner_employee_id, r.owner_resolved)!,
    accountablePerson: personOf(r.accountable_employee_id, r.accountable_resolved),
    creditedSalesperson: personOf(r.credited_salesperson_employee_id, r.credited_resolved),
    operatingCompanyId: r.operating_company_id, operatingCompanyKey: r.operating_company_key, state: r.state, currency: r.currency,
    acceptedAt: isoOf(r.accepted_at), acceptedByPrincipalId: r.accepted_by,
    totals: totals as SalesAgreementTotalsProjection,
    taxEvidence: { status: r.tax_evidence_status, amountMinor: r.tax_evidence_status === "DETERMINED" ? minorOf(r.tax_minor) : null },
    customerDiscount,
    createdAt: isoOf(r.created_at)!, updatedAt: isoOf(r.updated_at)!, lines,
  };
}

export function getSalesAgreementDetail(deps: CommercialReadDeps, actor: CommercialReadActor, input: Record<string, unknown>): Promise<SalesAgreementDetailProjection> {
  return runCommercialRead(deps, actor, [COMMERCIAL_READ_CAPABILITIES.SALES_AGREEMENT_READ], () => requireRecordId(input?.salesAgreementId, "salesAgreementId"),
    async (db, tenantId, salesAgreementId, reach) => {
      const { rows } = await db.query(
        `SELECT ${SUMMARY_COLUMNS}, (${SALES_AGREEMENT_IS_COMPLETE}) AS complete,
                a.location_id, loc.name AS location_name, a.customer_po, a.is_lease, a.fulfillment_intent::text AS fulfillment_intent,
                a.shipping_instructions, a.ship_via, a.special_instructions,
                o.opportunity_number, o.stage::text AS opportunity_stage, o.sales_channel::text AS sales_channel,
                so.id AS order_id, so.sales_order_number AS order_number, so.state::text AS order_state, so.sales_channel::text AS order_channel
           FROM eos_commercial.sales_agreements a
           LEFT JOIN eos_crm.accounts acc ON acc.tenant_id = a.tenant_id AND acc.id = a.account_id
           LEFT JOIN eos_crm.account_locations loc ON loc.tenant_id = a.tenant_id AND loc.account_id = a.account_id AND loc.id = a.location_id
           LEFT JOIN eos_commercial.opportunities o ON o.tenant_id = a.tenant_id AND o.id = a.opportunity_id
           LEFT JOIN eos_commercial.sales_orders so ON so.tenant_id = a.tenant_id AND so.sales_agreement_id = a.id
          WHERE a.tenant_id = $1 AND a.id = $2`,
        [tenantId, salesAgreementId],
      );
      if (rows.length === 0) return fail("RECORD_NOT_FOUND", "NOT_FOUND", "the Sales Agreement does not exist in this tenant");
      const r = rows[0] as Row;
      // An Agreement carries no channel of its own: its channel IS its source Opportunity's, joined in this statement.
      // No source Opportunity (or one with no channel) admits no scoped holder.
      if (!reach.admits(COMMERCIAL_READ_CAPABILITIES.SALES_AGREEMENT_READ, r.sales_channel ?? null)) refuseOutsideReach("Sales Agreement");
      if (!r.complete) fail("RECORD_INCOMPLETE", "PRECONDITION_FAILED", "the Sales Agreement was not created through a governed command and carries no lifecycle");
      const lines = await linesByAgreement(db, tenantId, [r.id]);
      const { rows: tradeInRows } = await db.query(
        `SELECT item_number, description, manufacturer, model_number, serial_number, equipment_model_id, proposed_value_minor, notes, evidence_reference,
                approval_status, approved_credit_minor, decided_by, decided_at, decision_reason, receiving_operating_company_id, acquisition_status
           FROM eos_commercial.sales_agreement_trade_ins WHERE tenant_id = $1 AND sales_agreement_id = $2 ORDER BY item_number`, [tenantId, r.id]);
      return {
        ...summaryOf(r, lines.get(r.id)!),
        tradeIns: tradeInRows.map((t) => Object.freeze({ itemNumber: t.item_number, description: t.description, manufacturer: t.manufacturer ?? null,
          modelNumber: t.model_number ?? null, serialNumber: t.serial_number ?? null, equipmentModelId: t.equipment_model_id ?? null,
          proposedValueMinor: Number(t.proposed_value_minor), notes: t.notes ?? null, evidenceReference: t.evidence_reference ?? null,
          approvalStatus: t.approval_status, approvedCreditMinor: t.approved_credit_minor === null ? null : Number(t.approved_credit_minor),
          decidedBy: t.decided_by ?? null, decidedAt: t.decided_at === null ? null : new Date(t.decided_at).toISOString(), decisionReason: t.decision_reason ?? null,
          receivingOperatingCompanyId: t.receiving_operating_company_id, acquisitionStatus: t.acquisition_status })),
        location: r.location_id === null ? null : { locationId: r.location_id, name: r.location_name ?? null },
        customerPO: r.customer_po, isLease: r.is_lease, fulfillmentIntent: r.fulfillment_intent,
        shippingInstructions: r.shipping_instructions, shipVia: r.ship_via, specialInstructions: r.special_instructions,
        // Pass 10 P10-4: lineage only where the reader could read the linked record. A global holder is unchanged.
        sourceOpportunity: r.opportunity_id === null || r.opportunity_number === null
          || !reach.admits(COMMERCIAL_READ_CAPABILITIES.OPPORTUNITY_READ, r.sales_channel ?? null) ? null
          : { id: r.opportunity_id, number: r.opportunity_number, state: r.opportunity_stage },
        salesOrder: r.order_id === null || !reach.admits(COMMERCIAL_READ_CAPABILITIES.SALES_ORDER_READ, r.order_channel ?? null) ? null
          : { id: r.order_id, number: r.order_number, state: r.order_state },
      };
    }, salesChannelScopedWithLineage([COMMERCIAL_READ_CAPABILITIES.OPPORTUNITY_READ, COMMERCIAL_READ_CAPABILITIES.SALES_ORDER_READ]));
}

export interface SalesAgreementListOptions {
  readonly limit: number;
  readonly accountId: string | null;
  readonly state: string[] | null;
  readonly cursor: { number: string; id: string } | null;
  /** Lane GA: null/absent = every channel; otherwise ONLY Agreements whose source Opportunity carries one of these. */
  readonly salesChannels?: readonly string[] | null;
}

export function prepareSalesAgreementList(input: Record<string, unknown> | undefined): SalesAgreementListOptions {
  return {
    limit: requirePageSize(input?.limit),
    accountId: optionalAccountId(input?.accountId),
    state: requireEnumFilter(input?.state, "state", SALES_AGREEMENT_STATES),
    cursor: decodeCommercialCursor("salesAgreement", input?.cursor),
  };
}

export async function readSalesAgreementPage(db: Queryable, tenantId: string, o: SalesAgreementListOptions): Promise<CommercialPage<SalesAgreementSummaryProjection>> {
  const { rows } = await db.query(
    `SELECT ${SUMMARY_COLUMNS}
       FROM eos_commercial.sales_agreements a
       LEFT JOIN eos_crm.accounts acc ON acc.tenant_id = a.tenant_id AND acc.id = a.account_id
       LEFT JOIN eos_commercial.opportunities src ON src.tenant_id = a.tenant_id AND src.id = a.opportunity_id
      WHERE a.tenant_id = $1 AND ${SALES_AGREEMENT_IS_COMPLETE}
        AND ($2::text IS NULL OR a.account_id = $2)
        AND ($3::text[] IS NULL OR a.state::text = ANY($3::text[]))
        AND ($4::text IS NULL OR (a.sales_agreement_number, a.id) < ($4::text, $5::text))
        AND ($7::text[] IS NULL OR src.sales_channel::text = ANY($7::text[]))
      ORDER BY a.sales_agreement_number DESC, a.id DESC
      LIMIT $6`,
    [tenantId, o.accountId, o.state, o.cursor?.number ?? null, o.cursor?.id ?? null, o.limit + 1, o.salesChannels ?? null],
  );
  const kept = (rows as Row[]).slice(0, o.limit);
  const lines = await linesByAgreement(db, tenantId, kept.map((r) => r.id));
  return pageOf("salesAgreement", rows as Row[], o.limit, (r) => r.sales_agreement_number, (r) => summaryOf(r, lines.get(r.id)!));
}

export function listSalesAgreements(deps: CommercialReadDeps, actor: CommercialReadActor, input?: Record<string, unknown>): Promise<CommercialPage<SalesAgreementSummaryProjection>> {
  return runCommercialRead(deps, actor, [COMMERCIAL_READ_CAPABILITIES.SALES_AGREEMENT_READ], () => prepareSalesAgreementList(input),
    (db, tenantId, options, reach) => readSalesAgreementPage(db, tenantId,
      { ...options, salesChannels: reach.channelsFor(COMMERCIAL_READ_CAPABILITIES.SALES_AGREEMENT_READ) }),
    SALES_CHANNEL_SCOPED);
}
