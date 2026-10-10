// Governed PostgreSQL Sales Agreement commands -- wave C2. Reached only through the C4 transport (commercialHttp.ts).
//
// Validation is the existing pure builders' (salesAgreementCommands.ts). Totals are never stored: C1 keeps only the
// charge inputs, and subtotal / total / balance are computed from lines and charges when read. Acceptance metadata is
// written only by accept, from the governed command context -- never from a client-supplied accepted_by.
import type { PoolClient } from "pg";
import {
  buildAcceptSalesAgreement, buildCreateSalesAgreement, buildUpdateSalesAgreementDraft, computeAgreementTotals, type CustomerDiscount,
} from "../../salesAgreement/salesAgreementCommands";
import { allocateCommercialNumber } from "../commercialNumbering";
import { discountAuthorityOf, discountWithinAuthority } from "../../salesAuthority/salesDiscountAuthority";
import {
  COMMERCIAL_CAPABILITIES, SALES_AGREEMENT_TRADE_IN_APPROVE_CAPABILITY, fail, requireCatalogReferences, requireAccountLocation, requireReservedHolder, requireTenantAccount, requireTenantEmployee, runCommercialCommand,
  type CommercialActorContext, type CommercialCommandDeps,
} from "./commercialCommandKernel";
import { resolveCreationAccountablePerson, stageCreationAccountablePerson } from "./commercialCreation";
import { lockAgreement, lockAgreementForOpportunity, lockOpportunity, newRecordId, operatingCompanyKeyFor, replaceAgreementLines, type AgreementRow } from "./commercialRecordStore";

type Queryable = Pick<PoolClient, "query">;
const target = (id: string) => ({ family: "salesAgreement" as const, id });

const CREATE_FORBIDDEN = ["accountId", "sourceOpportunityId", "state", "salesAgreementNumber", "salesOrderId", "acceptedByUid",
  "acceptedAtMillis", "acceptedBy", "acceptedAt", "currency", "totals", "inheritedOperatingCompanyId", "inheritedCreditedSalespersonId"];
const ACCEPT_FORBIDDEN = ["state", "acceptedAtMillis", "acceptedByUid", "acceptedAt", "acceptedBy", "lines", "totals"];

function refuseFields(input: Record<string, unknown>, fields: readonly string[]): void {
  const present = fields.filter((f) => f in input);
  if (present.length > 0) fail("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `these fields are server-derived and may not be supplied: ${present.join(", ")}`);
}

const agreementLineRows = (lines: readonly { kind: string; ref: string; businessUnitId: string; quantity: number; unitPrice: number | null;
  condition: string | null; warranty: string | null; estimatedArrivalMillis: number | null }[]) =>
  lines.map((l) => ({ kind: l.kind as never, ref: l.ref, businessUnitId: l.businessUnitId, quantity: l.quantity, unitPrice: l.unitPrice,
    condition: l.condition, warranty: l.warranty, estimatedArrivalMillis: l.estimatedArrivalMillis }));

/** DQ-020: an Agreement's governing channel is its source Opportunity's stored channel (none -> null, admits no scoped caller). */
async function sourceOpportunityChannel(db: Queryable, tenantId: string, agreement: AgreementRow): Promise<string | null> {
  if (agreement.opportunityId === null) return null;
  const { rows } = await db.query<{ sales_channel: string | null }>(
    `SELECT sales_channel::text FROM eos_commercial.opportunities WHERE tenant_id = $1 AND id = $2`, [tenantId, agreement.opportunityId]);
  return rows[0]?.sales_channel ?? null;
}

/**
 * TAX EVIDENCE (Owner ruling 2026-10-02; DECISIONS #197): unknown tax is NOT zero tax. A new or edited Agreement records an
 * explicit state -- `taxEvidence: { status: "DETERMINED", amountMinor, currency }` (0 allowed: a DETERMINED zero) or
 * `{ status: "NOT_DETERMINED" }`; omitting it means NOT_DETERMINED. A bare `taxMinor` is a commercial input, never evidence.
 * This records evidence only: no tax calculation, rate, jurisdiction or provider exists here.
 */
type TaxEvidence = { readonly status: "NOT_DETERMINED" } | { readonly status: "DETERMINED"; readonly amountMinor: number; readonly currency: string };
const AGREEMENT_CURRENCY = "USD";
function parseTaxEvidence(raw: unknown): TaxEvidence | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return fail("TAX_EVIDENCE_INVALID", "INVALID_INPUT", "taxEvidence states its status");
  const t = raw as Record<string, unknown>;
  const keys = Object.keys(t).sort().join(",");
  if (t.status === "NOT_DETERMINED" && keys === "status") return { status: "NOT_DETERMINED" };
  if (t.status === "DETERMINED" && keys === "amountMinor,currency,status") {
    if (!Number.isSafeInteger(t.amountMinor) || (t.amountMinor as number) < 0) {
      return fail("TAX_EVIDENCE_INVALID", "INVALID_INPUT", "a DETERMINED tax states its amount in non-negative minor units (0 is a determined zero)");
    }
    if (t.currency !== AGREEMENT_CURRENCY) return fail("TAX_CURRENCY_MISMATCH", "INVALID_INPUT", `the tax determination must be in the Agreement's currency (${AGREEMENT_CURRENCY})`);
    return { status: "DETERMINED", amountMinor: t.amountMinor as number, currency: AGREEMENT_CURRENCY };
  }
  return fail("TAX_EVIDENCE_INVALID", "INVALID_INPUT", "taxEvidence is { status: NOT_DETERMINED } or { status: DETERMINED, amountMinor, currency }");
}
/**
 * Merge evidence into the builder's charge input: a DETERMINED amount IS the tax; an explicit NOT_DETERMINED carries no
 * tax into the Agreement's arithmetic (a previously determined amount leaves the total). A conflicting bare taxMinor is refused.
 */
function withTaxEvidence(fields: Record<string, unknown>, evidence: TaxEvidence | null): Record<string, unknown> {
  if (evidence === null) return fields;
  const amount = evidence.status === "DETERMINED" ? evidence.amountMinor : 0;
  if (fields.taxMinor !== undefined && fields.taxMinor !== amount) {
    fail("TAX_EVIDENCE_CONFLICT", "INVALID_INPUT", `taxMinor disagrees with the ${evidence.status} tax evidence`);
  }
  return { ...fields, taxMinor: amount };
}

/**
 * CUSTOMER SALES DISCOUNT input (#203): `customerDiscount: { kind: "PERCENT", percentBasisPoints } | { kind: "FIXED_AMOUNT",
 * amountMinor } | null` (null clears; omitted leaves it). Transaction-specific; never a price-book or cost change.
 */
function parseCustomerDiscount(raw: unknown): CustomerDiscount | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return fail("DISCOUNT_INVALID", "INVALID_INPUT", "customerDiscount is { kind, percentBasisPoints | amountMinor } or null");
  const d = raw as Record<string, unknown>;
  const keys = Object.keys(d).sort().join(",");
  if (d.kind === "PERCENT" && keys === "kind,percentBasisPoints" && Number.isSafeInteger(d.percentBasisPoints)
      && (d.percentBasisPoints as number) >= 1 && (d.percentBasisPoints as number) <= 10000) {
    return { kind: "PERCENT", percentBasisPoints: d.percentBasisPoints as number };
  }
  if (d.kind === "FIXED_AMOUNT" && keys === "amountMinor,kind" && Number.isSafeInteger(d.amountMinor) && (d.amountMinor as number) >= 1) {
    return { kind: "FIXED_AMOUNT", amountMinor: d.amountMinor as number };
  }
  return fail("DISCOUNT_INVALID", "INVALID_INPUT", "a discount is PERCENT (1-10000 basis points) or FIXED_AMOUNT (positive minor units)");
}

/**
 * TRADE-IN PROPOSALS (#203; Owner ruling #204). The salesperson identifies what the customer offers -- description
 * (required), manufacturer / modelNumber / serialNumber / equipmentModelId when KNOWN (never invented), notes and an evidence
 * reference -- and a PROPOSED value. A proposal is not consideration: it never reduces the balance. Only a value approved
 * by salesAgreement.tradeIn.approve (approveSalesAgreementTradeIn) becomes the trade-in credit.
 */
interface TradeInInput {
  description: string; manufacturer: string | null; modelNumber: string | null; serialNumber: string | null; equipmentModelId: string | null;
  proposedValueMinor: number; notes: string | null; evidenceReference: string | null;
}
const TRADE_IN_FIELDS = ["description", "manufacturer", "modelNumber", "serialNumber", "equipmentModelId", "proposedValueMinor", "notes", "evidenceReference"];
function parseTradeIns(raw: unknown): TradeInInput[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length > 20) return fail("TRADE_IN_INVALID", "INVALID_INPUT", "tradeIns is a list of at most 20 items");
  const opt = (v: unknown, name: string, max = 200): string | null => {
    if (v === undefined || v === null) return null;
    if (typeof v !== "string" || v.trim() === "" || v.length > max) fail("TRADE_IN_INVALID", "INVALID_INPUT", `tradeIns ${name} is text when stated`);
    return (v as string).trim();
  };
  return raw.map((t) => {
    if (!t || typeof t !== "object" || Array.isArray(t)) fail("TRADE_IN_INVALID", "INVALID_INPUT", "each trade-in is an object");
    const o = t as Record<string, unknown>;
    for (const k of Object.keys(o)) {
      if (!TRADE_IN_FIELDS.includes(k)) {
        fail(k === "creditMinor" || k === "approvedCreditMinor" ? "TRADE_IN_REQUIRES_APPROVAL" : "TRADE_IN_INVALID", "INVALID_INPUT",
          k === "creditMinor" || k === "approvedCreditMinor" ? "a trade-in credit is assigned only by approval; propose a value (proposedValueMinor)" : `tradeIns does not accept ${k}`);
      }
    }
    if (typeof o.description !== "string" || o.description.trim() === "" || o.description.length > 300) fail("TRADE_IN_INVALID", "INVALID_INPUT", "each trade-in states what it is");
    if (!Number.isSafeInteger(o.proposedValueMinor) || (o.proposedValueMinor as number) < 1) fail("TRADE_IN_INVALID", "INVALID_INPUT", "each trade-in states its proposed value in positive minor units");
    return { description: (o.description as string).trim(), manufacturer: opt(o.manufacturer, "manufacturer"), modelNumber: opt(o.modelNumber, "modelNumber"),
      serialNumber: opt(o.serialNumber, "serialNumber"), equipmentModelId: opt(o.equipmentModelId, "equipmentModelId"),
      proposedValueMinor: o.proposedValueMinor as number, notes: opt(o.notes, "notes", 2000), evidenceReference: opt(o.evidenceReference, "evidenceReference", 300) };
  });
}
/** A bare trade-in credit is never stated by the client: the credit is the sum of APPROVED trade-ins (#204). */
function refuseBareTradeInCredit(fields: Record<string, unknown>): void {
  if ("tradeInMinor" in fields) fail("TRADE_IN_REQUIRES_APPROVAL", "INVALID_INPUT", "the trade-in credit is the sum of approved trade-ins; propose a trade-in instead");
}
/**
 * Replace the proposals. An item whose facts are unchanged keeps its decision; a changed or new item is PROPOSED again, so
 * an approved value never survives a change to what was approved.
 */
async function replaceTradeIns(db: Queryable, tenantId: string, agreementId: string, companyKey: string | null, actor: string, tradeIns: TradeInInput[]): Promise<void> {
  const { rows: prior } = await db.query(`SELECT * FROM eos_commercial.sales_agreement_trade_ins WHERE tenant_id = $1 AND sales_agreement_id = $2`, [tenantId, agreementId]);
  await db.query(`DELETE FROM eos_commercial.sales_agreement_trade_ins WHERE tenant_id = $1 AND sales_agreement_id = $2`, [tenantId, agreementId]);
  if (tradeIns.length === 0) return;
  const { rows } = await db.query(`SELECT operating_company_id FROM eos_policy.tenant_operating_company_keys WHERE tenant_id = $1 AND operating_company_key = $2 AND status = 'ACTIVE'`,
    [tenantId, companyKey]);
  if (!rows[0]) fail("OPERATING_COMPANY_UNRESOLVED", "PRECONDITION_FAILED", "a trade-in is received by the Agreement's governed operating company");
  for (const [i, t] of tradeIns.entries()) {
    const was = prior.find((p) => p.item_number === i + 1);
    const same = was && was.description === t.description && was.manufacturer === t.manufacturer && was.model_number === t.modelNumber
      && was.serial_number === t.serialNumber && was.equipment_model_id === t.equipmentModelId && Number(was.proposed_value_minor) === t.proposedValueMinor
      && was.notes === t.notes && was.evidence_reference === t.evidenceReference;
    await db.query(
      `INSERT INTO eos_commercial.sales_agreement_trade_ins (tenant_id, sales_agreement_id, item_number, description, manufacturer, model_number, serial_number,
          equipment_model_id, proposed_value_minor, notes, evidence_reference, receiving_operating_company_id, created_by,
          approval_status, approved_credit_minor, decided_by, decided_at, decision_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [tenantId, agreementId, i + 1, t.description, t.manufacturer, t.modelNumber, t.serialNumber, t.equipmentModelId, t.proposedValueMinor, t.notes,
        t.evidenceReference, rows[0].operating_company_id, actor,
        same ? was.approval_status : "PROPOSED", same ? was.approved_credit_minor : null, same ? was.decided_by : null, same ? was.decided_at : null,
        same ? was.decision_reason : null]);
  }
}
/** The Agreement's trade-in credit IS the sum of its APPROVED trade-ins. */
async function syncApprovedTradeInCredit(db: Queryable, tenantId: string, agreementId: string): Promise<number> {
  const { rows } = await db.query(
    `UPDATE eos_commercial.sales_agreements a SET trade_in_minor = COALESCE((SELECT sum(approved_credit_minor) FROM eos_commercial.sales_agreement_trade_ins t
        WHERE t.tenant_id = a.tenant_id AND t.sales_agreement_id = a.id AND t.approval_status = 'APPROVED'), 0)
      WHERE a.tenant_id = $1 AND a.id = $2 RETURNING trade_in_minor`, [tenantId, agreementId]);
  return Number(rows[0].trade_in_minor);
}

/**
 * EMPLOYEE SALES AUTHORITY (#204): a discount the actor STATES -- or a standing fixed amount whose effective percentage rose
 * because the selling price fell -- must be within the actor's configured maximum. Refused otherwise (never silently
 * accepted, never a warning). NOT_CONFIGURED fails closed.
 */
async function requireDiscountAuthority(db: Queryable, actor: CommercialActorContext, discount: CustomerDiscount, sellingMinor: number | null): Promise<void> {
  const authority = await discountAuthorityOf(db, actor.tenantId, actor.principalId);
  const within = discountWithinAuthority(authority, discount.kind === "PERCENT"
    ? { basisPoints: discount.percentBasisPoints } : { amountMinor: discount.amountMinor, sellingMinor });
  if (within) return;
  if (authority.state === "NOT_CONFIGURED") {
    fail("DISCOUNT_AUTHORITY_NOT_CONFIGURED", "FORBIDDEN", "no maximum customer discount is configured for you, so no discount can be applied");
  }
  const max = authority.state === "CONFIGURED" ? authority.maxBasisPoints : 0;
  fail("DISCOUNT_EXCEEDS_AUTHORITY", "FORBIDDEN", max === 0
    ? "you have no customer discount authority (0%)"
    : `the discount exceeds your maximum customer discount of ${(max / 100).toFixed(2)}%${discount.kind === "FIXED_AMOUNT" && sellingMinor !== null && sellingMinor > 0
      ? ` (at most ${(BigInt(max) * BigInt(sellingMinor) / 10000n).toString()} minor units on this selling price)` : ""}`);
}
const discountColumns = (d: CustomerDiscount | null): [string | null, number | null, number | null] =>
  d === null ? [null, null, null] : d.kind === "PERCENT" ? ["PERCENT", d.percentBasisPoints, null] : ["FIXED_AMOUNT", null, d.amountMinor];

async function requireAgreement(db: Queryable, tenantId: string, id: unknown): Promise<AgreementRow> {
  if (typeof id !== "string" || id.trim() === "") fail("AGREEMENT_REQUIRED", "INVALID_INPUT", "salesAgreementId is required");
  const row = await lockAgreement(db, tenantId, id as string);
  if (!row) return fail("RECORD_NOT_FOUND", "NOT_FOUND", "the Sales Agreement does not exist in this tenant");
  if (row.state === null) fail("RECORD_INCOMPLETE", "PRECONDITION_FAILED", "the Sales Agreement was not created through a governed command and carries no lifecycle");
  return row;
}

export function createSalesAgreement(deps: CommercialCommandDeps, actor: CommercialActorContext, input: Record<string, unknown>) {
  return runCommercialCommand(deps, actor, "salesAgreement.create", [COMMERCIAL_CAPABILITIES.SALES_AGREEMENT_CREATE], input?.idempotencyKey,
    async (db, now, scope) => {
      refuseFields(input, CREATE_FORBIDDEN);
      if (typeof input.opportunityId !== "string" || input.opportunityId.trim() === "") fail("OPPORTUNITY_REQUIRED", "INVALID_INPUT", "opportunityId is required");
      const opportunity = await lockOpportunity(db, actor.tenantId, input.opportunityId as string);
      if (!opportunity) return fail("RECORD_NOT_FOUND", "NOT_FOUND", "the Opportunity does not exist in this tenant");
      if (opportunity.stage === null) fail("RECORD_INCOMPLETE", "PRECONDITION_FAILED", "the Opportunity carries no governed lifecycle");
      scope.admitChannel(opportunity.salesChannel); // DQ-020: its source Opportunity's channel
      if (opportunity.outcome === "LOST") fail("OPPORTUNITY_LOST", "PRECONDITION_FAILED", "a LOST Opportunity cannot receive a Sales Agreement");
      if (await lockAgreementForOpportunity(db, actor.tenantId, opportunity.id)) {
        fail("AGREEMENT_ALREADY_EXISTS", "CONFLICT", "the Opportunity already has a Sales Agreement");
      }
      const { idempotencyKey: _k, opportunityId: _o, accountableEmployeeId, taxEvidence: rawTax, customerDiscount: rawDiscount, tradeIns: rawTradeIns, ...rawFields } = input;
      const taxEvidence = parseTaxEvidence(rawTax);
      const discount = parseCustomerDiscount(rawDiscount) ?? null;
      const tradeIns = parseTradeIns(rawTradeIns);
      refuseBareTradeInCredit(rawFields);
      const fields = withTaxEvidence(rawFields, taxEvidence);
      const built = buildCreateSalesAgreement({
        ...(fields as Record<string, unknown>),
        accountId: opportunity.accountId,
        sourceOpportunityId: opportunity.id,
        inheritedOperatingCompanyId: opportunity.operatingCompanyId,
        inheritedCreditedSalespersonId: opportunity.creditedSalespersonId,
      } as never, { actorUid: actor.principalId, nowMillis: now.getTime() });
      await requireTenantAccount(db, actor.tenantId, built.accountId);
      await requireAccountLocation(db, actor.tenantId, built.accountId, built.locationId);
      await requireTenantEmployee(db, actor.tenantId, built.ownerEmployeeId, "OWNER");
      await requireTenantEmployee(db, actor.tenantId, built.creditedSalespersonId, "CREDITED_SALESPERSON");
      await requireCatalogReferences(deps, db, actor.tenantId, built.lines);
      // The discount is checked against the SELLING PRICE it applies to (never more than the selling price).
      const createdTotals = computeAgreementTotals(built.lines as never, built.totals as never, discount);
      if (discount !== null) await requireDiscountAuthority(db, actor, discount, createdTotals.subtotalMinor);
      const established = await resolveCreationAccountablePerson(db, actor.tenantId, "salesAgreement", accountableEmployeeId, built.ownerEmployeeId);
      const number = await allocateCommercialNumber(db, actor.tenantId, "SALES_AGREEMENT", now);
      const id = newRecordId("sag");
      await db.query(
        `INSERT INTO eos_commercial.sales_agreements (id, tenant_id, sales_agreement_number, account_id, opportunity_id, owner_employee_id,
           operating_company_key, state, currency, credited_salesperson_employee_id, location_id, customer_po, is_lease, fulfillment_intent,
           shipping_instructions, ship_via, special_instructions, shipping_minor, install_charge_minor, tax_minor, down_payment_minor,
           trade_in_minor, created_by, updated_by, tax_evidence_status, tax_evidence_currency, tax_evidence_recorded_by, tax_evidence_recorded_at,
           customer_discount_kind, customer_discount_basis_points, customer_discount_amount_minor)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'DRAFT','USD',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$21,$22,$23,$24,$25,$26,$27,$28)`,
        [id, actor.tenantId, number.number, built.accountId, opportunity.id, built.ownerEmployeeId,
          await operatingCompanyKeyFor(db, actor.tenantId, built.operatingCompanyId),
          built.creditedSalespersonId, built.locationId, built.customerPO, built.isLease, built.fulfillmentIntent, built.shippingInstructions,
          built.shipVia, built.specialInstructions, built.totals.shippingMinor, built.totals.installChargeMinor, built.totals.taxMinor,
          built.totals.downPaymentMinor, built.totals.tradeInMinor, actor.principalId,
          taxEvidence?.status ?? "NOT_DETERMINED", taxEvidence?.status === "DETERMINED" ? taxEvidence.currency : null,
          taxEvidence?.status === "DETERMINED" ? actor.principalId : null, taxEvidence?.status === "DETERMINED" ? now : null, ...discountColumns(discount)],
      );
      await replaceAgreementLines(db, actor.tenantId, id, agreementLineRows(built.lines));
      if (tradeIns !== undefined) {
        await replaceTradeIns(db, actor.tenantId, id, await operatingCompanyKeyFor(db, actor.tenantId, built.operatingCompanyId), actor.principalId, tradeIns);
      }
      const accountable = await stageCreationAccountablePerson(db, actor.tenantId, actor.principalId, "salesAgreement", id, established);
      return {
        result: { salesAgreementId: id, salesAgreementNumber: number.number, opportunityId: opportunity.id, state: "DRAFT", ...accountable },
        target: target(id),
      };
    });
}

/** Firestore draft-patch field -> column. `lines` and `totals` are handled on their own. */
const DRAFT_COLUMNS: Readonly<Record<string, string>> = Object.freeze({
  locationId: "location_id", creditedSalespersonId: "credited_salesperson_employee_id", customerPO: "customer_po", isLease: "is_lease",
  fulfillmentIntent: "fulfillment_intent", shippingInstructions: "shipping_instructions", shipVia: "ship_via",
  specialInstructions: "special_instructions",
});
const CHARGE_COLUMNS: Readonly<Record<string, string>> = Object.freeze({
  shippingMinor: "shipping_minor", installChargeMinor: "install_charge_minor", taxMinor: "tax_minor",
  downPaymentMinor: "down_payment_minor", tradeInMinor: "trade_in_minor",
});

export function updateSalesAgreementDraft(deps: CommercialCommandDeps, actor: CommercialActorContext, input: Record<string, unknown>) {
  return runCommercialCommand(deps, actor, "salesAgreement.updateDraft", [COMMERCIAL_CAPABILITIES.SALES_AGREEMENT_UPDATE_DRAFT],
    input?.idempotencyKey, async (db, now, scope) => {
      const current = await requireAgreement(db, actor.tenantId, input.salesAgreementId);
      scope.admitChannel(await sourceOpportunityChannel(db, actor.tenantId, current));
      const { idempotencyKey: _k, salesAgreementId: _a, taxEvidence: rawTax, customerDiscount: rawDiscount, tradeIns: rawTradeIns, ...rawFields } = input;
      const taxEvidence = parseTaxEvidence(rawTax);
      const discountChange = parseCustomerDiscount(rawDiscount);
      const tradeIns = parseTradeIns(rawTradeIns);
      refuseBareTradeInCredit(rawFields);
      const fields = withTaxEvidence(rawFields, taxEvidence);
      const patch = buildUpdateSalesAgreementDraft(
        { state: current.state as never, lines: current.lines as never, totals: computeAgreementTotals(current.lines as never, current.charges) },
        fields as never,
        { actorUid: actor.principalId, nowMillis: now.getTime() },
      );
      const changed = Object.keys(fields);
      const values: unknown[] = [actor.tenantId, current.id, actor.principalId];
      const sets: string[] = [];
      for (const [field, column] of Object.entries(DRAFT_COLUMNS)) {
        if (!(field in patch)) continue;
        if (field === "creditedSalespersonId") await requireTenantEmployee(db, actor.tenantId, patch[field] as string, "CREDITED_SALESPERSON");
        if (field === "locationId") await requireAccountLocation(db, actor.tenantId, current.accountId, patch[field]);
        values.push(patch[field]);
        sets.push(`${column} = $${values.length}`);
      }
      const totals = patch.totals as Record<string, number> | undefined;
      if (totals) {
        for (const [field, column] of Object.entries(CHARGE_COLUMNS)) {
          values.push(totals[field]);
          sets.push(`${column} = $${values.length}`);
        }
      }
      // Tax evidence moves only by an explicit statement; a changed bare taxMinor is no longer evidenced (NOT_DETERMINED).
      if (taxEvidence !== null || "taxMinor" in rawFields) {
        const determined = taxEvidence?.status === "DETERMINED";
        values.push(determined ? "DETERMINED" : "NOT_DETERMINED"); sets.push(`tax_evidence_status = $${values.length}`);
        values.push(determined ? AGREEMENT_CURRENCY : null); sets.push(`tax_evidence_currency = $${values.length}`);
        values.push(determined ? actor.principalId : null); sets.push(`tax_evidence_recorded_by = $${values.length}`);
        values.push(determined ? now : null); sets.push(`tax_evidence_recorded_at = $${values.length}`);
      }
      const lines = (patch.lines as AgreementRow["lines"] | undefined) ?? current.lines;
      await requireCatalogReferences(deps, db, actor.tenantId, lines);
      // The discount (new, or the standing one against changed lines) never exceeds the selling price.
      const { rows: disc } = await db.query(`SELECT customer_discount_kind, customer_discount_basis_points, customer_discount_amount_minor, operating_company_key
        FROM eos_commercial.sales_agreements WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, current.id]);
      const standing: CustomerDiscount | null = disc[0].customer_discount_kind === "PERCENT"
        ? { kind: "PERCENT", percentBasisPoints: Number(disc[0].customer_discount_basis_points) }
        : disc[0].customer_discount_kind === "FIXED_AMOUNT" ? { kind: "FIXED_AMOUNT", amountMinor: Number(disc[0].customer_discount_amount_minor) } : null;
      const nextTotals = computeAgreementTotals(lines as never, { ...current.charges, ...((patch.totals as Record<string, number> | undefined) ?? {}) } as never,
        discountChange === undefined ? standing : discountChange);
      if (discountChange) {
        await requireDiscountAuthority(db, actor, discountChange, nextTotals.subtotalMinor);
      } else if (discountChange === undefined && standing?.kind === "FIXED_AMOUNT" && patch.lines) {
        // A standing fixed amount over a LOWER selling price is a larger effective percentage: the actor must hold it.
        const before = computeAgreementTotals(current.lines as never, current.charges, standing).subtotalMinor;
        if (nextTotals.subtotalMinor === null || before === null || nextTotals.subtotalMinor < before) {
          await requireDiscountAuthority(db, actor, standing, nextTotals.subtotalMinor);
        }
      }
      if (discountChange !== undefined) {
        const [kind, bp, amount] = discountColumns(discountChange);
        values.push(kind); sets.push(`customer_discount_kind = $${values.length}`);
        values.push(bp); sets.push(`customer_discount_basis_points = $${values.length}`);
        values.push(amount); sets.push(`customer_discount_amount_minor = $${values.length}`);
      }
      if (tradeIns !== undefined) await replaceTradeIns(db, actor.tenantId, current.id, disc[0].operating_company_key, actor.principalId, tradeIns);
      await db.query(
        `UPDATE eos_commercial.sales_agreements SET ${[...sets, "updated_by = $3", "updated_at = now()"].join(", ")}
          WHERE tenant_id = $1 AND id = $2 AND state = 'DRAFT'`,
        values,
      );
      if (tradeIns !== undefined) await syncApprovedTradeInCredit(db, actor.tenantId, current.id);
      if (patch.lines) await replaceAgreementLines(db, actor.tenantId, current.id, agreementLineRows(patch.lines as AgreementRow["lines"]));
      return { result: { salesAgreementId: current.id, changed }, target: target(current.id) };
    }, { family: "salesAgreement", id: input?.salesAgreementId });
}

export function acceptSalesAgreement(deps: CommercialCommandDeps, actor: CommercialActorContext, input: Record<string, unknown>) {
  return runCommercialCommand(deps, actor, "salesAgreement.accept", [COMMERCIAL_CAPABILITIES.SALES_AGREEMENT_ACCEPT], input?.idempotencyKey,
    async (db, now, scope) => {
      refuseFields(input, ACCEPT_FORBIDDEN);
      const current = await requireAgreement(db, actor.tenantId, input.salesAgreementId);
      scope.admitChannel(await sourceOpportunityChannel(db, actor.tenantId, current));
      buildAcceptSalesAgreement(
        { state: current.state as never, lines: current.lines as never, operatingCompanyId: current.operatingCompanyId },
        { actorUid: actor.principalId, nowMillis: now.getTime() },
      );
      await requireCatalogReferences(deps, db, actor.tenantId, current.lines);
      const { rowCount: pending } = await db.query(`SELECT 1 FROM eos_commercial.sales_agreement_trade_ins
        WHERE tenant_id = $1 AND sales_agreement_id = $2 AND approval_status = 'PROPOSED'`, [actor.tenantId, current.id]);
      if (pending) fail("TRADE_IN_APPROVAL_PENDING", "PRECONDITION_FAILED", "a proposed trade-in awaits approval or decline before the Agreement is accepted");
      const accepted = await db.query<{ accepted_at: Date }>(
        `UPDATE eos_commercial.sales_agreements SET state = 'ACCEPTED', accepted_at = $3, accepted_by = $4, updated_by = $4, updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND state = 'DRAFT' RETURNING accepted_at`,
        [actor.tenantId, current.id, now, actor.principalId],
      );
      if (accepted.rowCount !== 1) fail("ILLEGAL_TRANSITION", "PRECONDITION_FAILED", "only a DRAFT Sales Agreement can be accepted");
      return {
        result: { salesAgreementId: current.id, state: "ACCEPTED", acceptedAt: accepted.rows[0].accepted_at.toISOString(), acceptedBy: actor.principalId },
        target: target(current.id),
      };
    }, { family: "salesAgreement", id: input?.salesAgreementId });
}

/**
 * TRADE-IN VALUE DECISION (Owner ruling #204): salesAgreement.tradeIn.approve -- business approval, held by Owner / Executive
 * and General Manager Roles, never implied by Sales, Finance configuration or System Administration authority. On a DRAFT
 * Agreement a PROPOSED item is APPROVED with the value the approver assigns (it may differ from the proposal) or DECLINED with
 * a reason. The Agreement's trade-in credit becomes the sum of approved values. The approved credit is consideration only:
 * it writes no acquisition / book value and no price.
 */
function decideTradeIn(deps: CommercialCommandDeps, actor: CommercialActorContext, input: Record<string, unknown>, decision: "APPROVED" | "DECLINED") {
  return runCommercialCommand(deps, actor, decision === "APPROVED" ? "salesAgreement.approveTradeIn" : "salesAgreement.declineTradeIn",
    [SALES_AGREEMENT_TRADE_IN_APPROVE_CAPABILITY], input?.idempotencyKey, async (db, now, scope) => {
      const allowed = ["idempotencyKey", "salesAgreementId", "itemNumber", "reason", ...(decision === "APPROVED" ? ["approvedCreditMinor"] : [])];
      for (const k of Object.keys(input ?? {})) if (!allowed.includes(k)) fail("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `not accepted: ${k}`);
      // RESERVED (Owner G7, DECISIONS #226): holding the capability is not enough -- it must be held through a reserved
      // Role (owner / generalManager), so a grant that predates the invariant, or any other path, decides nothing.
      await requireReservedHolder(db, actor.tenantId, actor.principalId, SALES_AGREEMENT_TRADE_IN_APPROVE_CAPABILITY);
      const current = await requireAgreement(db, actor.tenantId, input.salesAgreementId);
      scope.admitChannel(await sourceOpportunityChannel(db, actor.tenantId, current));
      if (current.state !== "DRAFT") fail("ILLEGAL_TRANSITION", "PRECONDITION_FAILED", "a trade-in value is decided only on a DRAFT Sales Agreement");
      if (!Number.isSafeInteger(input.itemNumber) || (input.itemNumber as number) < 1) fail("INVALID_INPUT", "INVALID_INPUT", "itemNumber is required");
      const reason = typeof input.reason === "string" && input.reason.trim() !== "" ? input.reason.trim() : null;
      if (decision === "DECLINED" && reason === null) fail("REASON_REQUIRED", "INVALID_INPUT", "a declined trade-in states its reason");
      if (decision === "APPROVED" && (!Number.isSafeInteger(input.approvedCreditMinor) || (input.approvedCreditMinor as number) < 1)) {
        fail("TRADE_IN_INVALID", "INVALID_INPUT", "approvedCreditMinor is the approved value in positive minor units");
      }
      const { rows } = await db.query(`SELECT approval_status FROM eos_commercial.sales_agreement_trade_ins
        WHERE tenant_id = $1 AND sales_agreement_id = $2 AND item_number = $3 FOR UPDATE`, [actor.tenantId, current.id, input.itemNumber]);
      if (!rows[0]) fail("RECORD_NOT_FOUND", "NOT_FOUND", "the Sales Agreement has no such trade-in item");
      if (rows[0].approval_status !== "PROPOSED") fail("TRADE_IN_ALREADY_DECIDED", "PRECONDITION_FAILED", `the trade-in is already ${rows[0].approval_status}; a changed proposal is decided again`);
      await db.query(`UPDATE eos_commercial.sales_agreement_trade_ins SET approval_status = $4, approved_credit_minor = $5, decided_by = $6, decided_at = $7, decision_reason = $8
        WHERE tenant_id = $1 AND sales_agreement_id = $2 AND item_number = $3`,
        [actor.tenantId, current.id, input.itemNumber, decision, decision === "APPROVED" ? input.approvedCreditMinor : null, actor.principalId, now, reason]);
      const credit = await syncApprovedTradeInCredit(db, actor.tenantId, current.id);
      const { rows: disc } = await db.query(`SELECT customer_discount_kind, customer_discount_basis_points, customer_discount_amount_minor
        FROM eos_commercial.sales_agreements WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, current.id]);
      const standing: CustomerDiscount | null = disc[0].customer_discount_kind === "PERCENT"
        ? { kind: "PERCENT", percentBasisPoints: Number(disc[0].customer_discount_basis_points) }
        : disc[0].customer_discount_kind === "FIXED_AMOUNT" ? { kind: "FIXED_AMOUNT", amountMinor: Number(disc[0].customer_discount_amount_minor) } : null;
      const totals = computeAgreementTotals(current.lines as never, { ...current.charges, tradeInMinor: credit }, standing);
      if (totals.totalMinor !== null && credit > totals.totalMinor) {
        fail("TRADE_IN_EXCEEDS_TOTAL", "PRECONDITION_FAILED", "approved trade-in credit cannot exceed the Agreement total");
      }
      return {
        result: { salesAgreementId: current.id, itemNumber: input.itemNumber as number, approvalStatus: decision,
          approvedCreditMinor: decision === "APPROVED" ? input.approvedCreditMinor as number : null, tradeInCreditMinor: credit, balanceMinor: totals.balanceMinor },
        target: target(current.id),
      };
    }, { family: "salesAgreement", id: input?.salesAgreementId });
}
export const approveSalesAgreementTradeIn = (deps: CommercialCommandDeps, actor: CommercialActorContext, input: Record<string, unknown>) =>
  decideTradeIn(deps, actor, input, "APPROVED");
export const declineSalesAgreementTradeIn = (deps: CommercialCommandDeps, actor: CommercialActorContext, input: Record<string, unknown>) =>
  decideTradeIn(deps, actor, input, "DECLINED");
