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
import {
  COMMERCIAL_CAPABILITIES, fail, requireCatalogReferences, requireAccountLocation, requireTenantAccount, requireTenantEmployee, runCommercialCommand,
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
 * TRADE-INS (#203 Owner ruling): cash-equivalent consideration that buys down the balance -- never cash, never a discount --
 * and incoming used equipment. Each item: description (required), manufacturer / modelNumber / serialNumber /
 * equipmentModelId when KNOWN (never invented), creditMinor (the agreed credit; never an acquisition value or a resale price).
 */
interface TradeInInput { description: string; manufacturer: string | null; modelNumber: string | null; serialNumber: string | null; equipmentModelId: string | null; creditMinor: number }
function parseTradeIns(raw: unknown): TradeInInput[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length > 20) return fail("TRADE_IN_INVALID", "INVALID_INPUT", "tradeIns is a list of at most 20 items");
  const opt = (v: unknown, name: string): string | null => {
    if (v === undefined || v === null) return null;
    if (typeof v !== "string" || v.trim() === "" || v.length > 200) fail("TRADE_IN_INVALID", "INVALID_INPUT", `tradeIns ${name} is text when stated`);
    return (v as string).trim();
  };
  return raw.map((t) => {
    if (!t || typeof t !== "object" || Array.isArray(t)) fail("TRADE_IN_INVALID", "INVALID_INPUT", "each trade-in is an object");
    const o = t as Record<string, unknown>;
    for (const k of Object.keys(o)) {
      if (!["description", "manufacturer", "modelNumber", "serialNumber", "equipmentModelId", "creditMinor"].includes(k)) fail("TRADE_IN_INVALID", "INVALID_INPUT", `tradeIns does not accept ${k}`);
    }
    if (typeof o.description !== "string" || o.description.trim() === "" || o.description.length > 300) fail("TRADE_IN_INVALID", "INVALID_INPUT", "each trade-in states what it is");
    if (!Number.isSafeInteger(o.creditMinor) || (o.creditMinor as number) < 1) fail("TRADE_IN_INVALID", "INVALID_INPUT", "each trade-in states its agreed credit in positive minor units");
    return { description: (o.description as string).trim(), manufacturer: opt(o.manufacturer, "manufacturer"), modelNumber: opt(o.modelNumber, "modelNumber"),
      serialNumber: opt(o.serialNumber, "serialNumber"), equipmentModelId: opt(o.equipmentModelId, "equipmentModelId"), creditMinor: o.creditMinor as number };
  });
}
/** The itemised trade-ins ARE the trade-in credit; a disagreeing bare tradeInMinor is refused. */
function withTradeIns(fields: Record<string, unknown>, tradeIns: TradeInInput[] | undefined): Record<string, unknown> {
  if (tradeIns === undefined) return fields;
  const sum = tradeIns.reduce((n, t) => n + t.creditMinor, 0);
  if (fields.tradeInMinor !== undefined && fields.tradeInMinor !== sum) fail("TRADE_IN_CONFLICT", "INVALID_INPUT", "tradeInMinor disagrees with the itemised trade-ins");
  return { ...fields, tradeInMinor: sum };
}
async function replaceTradeIns(db: Queryable, tenantId: string, agreementId: string, companyKey: string | null, actor: string, tradeIns: TradeInInput[]): Promise<void> {
  await db.query(`DELETE FROM eos_commercial.sales_agreement_trade_ins WHERE tenant_id = $1 AND sales_agreement_id = $2`, [tenantId, agreementId]);
  if (tradeIns.length === 0) return;
  const { rows } = await db.query(`SELECT operating_company_id FROM eos_policy.tenant_operating_company_keys WHERE tenant_id = $1 AND operating_company_key = $2 AND status = 'ACTIVE'`,
    [tenantId, companyKey]);
  if (!rows[0]) fail("OPERATING_COMPANY_UNRESOLVED", "PRECONDITION_FAILED", "a trade-in is received by the Agreement's governed operating company");
  for (const [i, t] of tradeIns.entries()) {
    await db.query(
      `INSERT INTO eos_commercial.sales_agreement_trade_ins (tenant_id, sales_agreement_id, item_number, description, manufacturer, model_number, serial_number,
          equipment_model_id, agreed_credit_minor, receiving_operating_company_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [tenantId, agreementId, i + 1, t.description, t.manufacturer, t.modelNumber, t.serialNumber, t.equipmentModelId, t.creditMinor, rows[0].operating_company_id, actor]);
  }
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
      const fields = withTradeIns(withTaxEvidence(rawFields, taxEvidence), tradeIns);
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
      computeAgreementTotals(built.lines as never, built.totals as never, discount);
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
      const fields = withTradeIns(withTaxEvidence(rawFields, taxEvidence), tradeIns);
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
      computeAgreementTotals(lines as never, { ...current.charges, ...((patch.totals as Record<string, number> | undefined) ?? {}) } as never,
        discountChange === undefined ? standing : discountChange);
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
