// GOVERNED LATE COST EVIDENCE (Finance Closure, DECISIONS #206; FBR-F4).
//
// An UNPRICED receipt line is valid operationally and carries an open COST_EVIDENCE_MISSING exception -- never a fabricated
// zero cost and never a fabricated obligation. This command supplies the missing acquisition cost LATER, once, for ONE receipt
// line, with its reason and evidence reference, WITHOUT rewriting the receipt:
//
//   * a new acquisition-cost evidence row (basis GOVERNED_LATE_COST_EVIDENCE) beside the receipt's own lines;
//   * the supply record (who supplied it, when, why) and the exception's resolution (COST_EVIDENCE_SUPPLIED);
//   * the COST_EVIDENCE fact (the ordinary projection, idempotent per evidence row);
//   * once the receipt's evidence is COMPLETE, its consequences EXACTLY ONCE: an internal purchase's paired intercompany
//     obligations (#202) or an external purchase's vendor payable -- each idempotent on its own governed key.
//
// Authority: inventory.receipt.correct (the governed receipt-record correction authority, #193 / #194) narrowed by WAREHOUSE
// operational scope over the receipt's location -- the same door as a receipt correction.
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { authorizeObjectAction, postgresContextualReader } from "./contextualAuthorization.js";
import { InventoryScopeError, resolveScopeLocation } from "./inventoryScopeAuthority.js";
import { FinanceFoundationError, projectReceiptAcquisitionCostOn } from "../eosFinance/financeFoundation.js";
import { establishIntercompanyObligationsOn, INTERCOMPANY_RECEIPT_TRIGGER } from "../eosFinance/intercompany.js";
import { establishReceiptPayableOn } from "../eosFinance/vendorPayable.js";

export const COST_EVIDENCE_SUPPLY_CAPABILITY = "inventory.receipt.correct";

export class CostEvidenceSupplyError extends Error {
  constructor(readonly code: string, readonly category: "INVALID_INPUT" | "NOT_FOUND" | "PRECONDITION_FAILED" | "CONFLICT" | "FORBIDDEN", message: string) {
    super(message);
    this.name = "CostEvidenceSupplyError";
  }
}
const refuse = (code: string, category: CostEvidenceSupplyError["category"], message: string): never => {
  throw new CostEvidenceSupplyError(code, category, message);
};

export interface CostEvidenceActor { readonly tenantId: string; readonly principalId: string; readonly capabilities: ReadonlySet<string> }

export async function supplyReceiptCostEvidence(deps: { readonly pool: Pool }, actor: CostEvidenceActor, input: Record<string, unknown>) {
  const allowed = ["receivingId", "receivingLineId", "unitPriceMinor", "currency", "reason", "evidenceReference"];
  const extra = Object.keys(input ?? {}).filter((k) => !allowed.includes(k));
  if (extra.length) refuse("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `not accepted: ${extra.sort().join(", ")}`);
  const str = (v: unknown, name: string, max = 200): string => {
    if (typeof v !== "string" || v.trim() === "" || v.length > max) refuse(`${name.toUpperCase()}_REQUIRED`, "INVALID_INPUT", `${name} is required`);
    return (v as string).trim();
  };
  const receivingId = str(input.receivingId, "receivingId");
  const lineId = str(input.receivingLineId, "receivingLineId");
  if (!Number.isSafeInteger(input.unitPriceMinor) || (input.unitPriceMinor as number) < 0) refuse("UNIT_PRICE_INVALID", "INVALID_INPUT", "unitPriceMinor is a whole number of minor units (0 or more)");
  if (typeof input.currency !== "string" || !/^[A-Z]{3}$/.test(input.currency)) refuse("CURRENCY_INVALID", "INVALID_INPUT", "currency is an ISO 4217 code");
  const reason = str(input.reason, "reason", 500);
  const evidenceReference = input.evidenceReference === undefined || input.evidenceReference === null ? null : str(input.evidenceReference, "evidenceReference", 300);
  if (!actor.capabilities.has(COST_EVIDENCE_SUPPLY_CAPABILITY)) refuse("CAPABILITY_REQUIRED", "FORBIDDEN", `this command requires ${COST_EVIDENCE_SUPPLY_CAPABILITY}`);

  const c: PoolClient = await deps.pool.connect();
  try {
    await c.query("BEGIN");
    const { rows: rr } = await c.query(
      `SELECT r.*, r.status::text AS status_text, r.receiving_location_type::text AS location_type FROM eos_ops.receiving_orders r
        WHERE r.tenant_id = $1 AND r.id = $2 FOR UPDATE`, [actor.tenantId, receivingId]);
    const r = rr[0] ?? refuse("RECEIPT_NOT_FOUND", "NOT_FOUND", "no receipt with that id");
    if (r.status_text === "CANCELLED") refuse("RECEIPT_CANCELLED", "PRECONDITION_FAILED", "a cancelled receipt takes no cost evidence");
    let scopeWarehouseId: string;
    try {
      scopeWarehouseId = (await resolveScopeLocation(c, actor.tenantId, { type: String(r.location_type), locationId: String(r.receiving_location_id) })).scopeWarehouseId;
    } catch (err) {
      if (err instanceof InventoryScopeError) refuse(err.code, "PRECONDITION_FAILED", `the receipt location has no governing warehouse: ${err.message}`);
      throw err;
    }
    const scoped = await authorizeObjectAction(postgresContextualReader(c), {
      actor, capabilityKey: COST_EVIDENCE_SUPPLY_CAPABILITY, predicates: [{ kind: "OPERATIONAL_SCOPE" as const, scopeType: "WAREHOUSE", scopeId: scopeWarehouseId }],
    });
    if (!scoped.allowed) refuse(scoped.reason, "FORBIDDEN", scoped.reason === "OUTSIDE_OPERATIONAL_SCOPE" ? "this receipt location is outside your warehouse scope" : "not authorized to supply this receipt's cost evidence");
    const { rows: xs } = await c.query(
      `SELECT x.* FROM eos_finance.cost_evidence_exceptions x WHERE x.tenant_id = $1 AND x.receiving_id = $2 AND x.receiving_line_id = $3
          AND NOT EXISTS (SELECT 1 FROM eos_finance.cost_evidence_exception_resolutions z WHERE z.exception_id = x.id) FOR UPDATE`, [actor.tenantId, receivingId, lineId]);
    const x = xs[0] ?? refuse("COST_EVIDENCE_NOT_MISSING", "PRECONDITION_FAILED", "that receipt line has no open missing-cost exception");
    const { rows: ln } = await c.query(`SELECT * FROM eos_ops.receiving_order_lines WHERE tenant_id = $1 AND receiving_order_id = $2 AND line_id = $3`,
      [actor.tenantId, receivingId, lineId]);
    const line = ln[0] ?? refuse("RECEIPT_LINE_NOT_FOUND", "NOT_FOUND", "no such line on the receipt");
    const { rows: po } = await c.query(`SELECT * FROM eos_ops.purchase_orders WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, r.source_purchase_order_id]);
    const p = po[0] ?? refuse("PURCHASE_ORDER_NOT_FOUND", "PRECONDITION_FAILED", "the receipt names no purchase order");
    if (p.currency && p.currency !== input.currency) refuse("CURRENCY_MISMATCH", "PRECONDITION_FAILED", `the purchase order is in ${p.currency}`);
    const unit = BigInt(input.unitPriceMinor as number);
    const qty = Number(line.received_quantity);
    const acqId = `acq_${randomUUID()}`;
    // The receipt's own row shape; only the basis says how the cost arrived. The receipt itself is never edited.
    await c.query(
      `INSERT INTO eos_finance.inventory_acquisition_costs (id, tenant_id, cost_basis, operating_company_id, purchase_order_id, purchase_order_line_id,
          purchase_order_source_type, purchase_order_version, supplier_id, supplier_name, part_id, received_quantity, unit_price_minor, extended_cost_minor,
          currency, price_authority_version, receiving_id, receiving_line_id, received_at, receiving_location_type, receiving_location_id, created_by)
       VALUES ($1,$2,'GOVERNED_LATE_COST_EVIDENCE',$3,$4,'L1','REORDER_PURCHASE_ORDER',NULL,$5,$6,$7,$8,$9,$10,$11,NULL,$12,$13,$14,$15,$16,$17)`,
      [acqId, actor.tenantId, x.operating_company_id, p.id, p.supplier_id ?? null, p.supplier_name ?? null, line.part_id, qty, unit.toString(),
        (unit * BigInt(qty)).toString(), input.currency, receivingId, lineId, r.received_at, String(r.location_type), String(r.receiving_location_id), actor.principalId]);
    const supplyId = `ces_${randomUUID()}`;
    await c.query(
      `INSERT INTO eos_finance.cost_evidence_supplies (id, tenant_id, receiving_id, receiving_line_id, exception_id, unit_price_minor, currency, evidence_reference,
          reason, acquisition_cost_id, supplied_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [supplyId, actor.tenantId, receivingId, lineId, x.id, unit.toString(), input.currency, evidenceReference, reason, acqId, actor.principalId]);
    await c.query(
      `INSERT INTO eos_finance.cost_evidence_exception_resolutions (exception_id, tenant_id, resolution, receiving_correction_id, reason, resolved_by, cost_evidence_supply_id)
       VALUES ($1,$2,'COST_EVIDENCE_SUPPLIED',NULL,$3,$4,$5)`, [x.id, actor.tenantId, reason, actor.principalId, supplyId]);
    const fa = { tenantId: actor.tenantId, principalId: actor.principalId };
    const projection = await projectReceiptAcquisitionCostOn(c, fa, { receivingId });
    // The receipt's consequences, exactly once, when its evidence is now complete.
    let intercompany: unknown = null;
    const { rows: ict } = await c.query(`SELECT id, status FROM eos_finance.intercompany_transactions WHERE tenant_id = $1 AND source_kind = 'REORDER_RECEIPT' AND source_record_id = $2`,
      [actor.tenantId, receivingId]);
    if (ict[0]?.status === "COST_EVIDENCE_MISSING") {
      intercompany = await establishIntercompanyObligationsOn(c, fa, { correlationId: String(ict[0].id), trigger: `${INTERCOMPANY_RECEIPT_TRIGGER}; governed late cost evidence` })
        .catch((e) => (e?.code === "INTERCOMPANY_NOT_ESTABLISHABLE" ? { outcome: "still_held" } : Promise.reject(e)));
    }
    const payable = await establishReceiptPayableOn(c, fa, receivingId);
    await c.query("COMMIT");
    return Object.freeze({ supplyId, acquisitionCostId: acqId, exceptionId: String(x.id), extendedCostMinor: (unit * BigInt(qty)).toString(),
      remainingMissingLines: projection.missingCostEvidence.length, intercompany, payable });
  } catch (err) {
    await c.query("ROLLBACK").catch(() => undefined);
    if (err instanceof FinanceFoundationError) refuse(err.code, err.category === "NOT_FOUND" ? "NOT_FOUND" : "PRECONDITION_FAILED", err.message);
    const m = /^([A-Z][A-Z0-9_]+):\s*(.*)$/s.exec((err as { message?: string })?.message ?? "");
    if (m && !(err instanceof CostEvidenceSupplyError)) refuse(m[1], "CONFLICT", m[2]);
    throw err;
  } finally {
    c.release();
  }
}
