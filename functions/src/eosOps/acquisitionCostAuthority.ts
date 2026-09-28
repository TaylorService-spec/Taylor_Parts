// THE GOVERNED ACQUISITION-COST FACT, in PostgreSQL -- Owner Ruling R3.
//
// What a receipt of stock COST to acquire, written as immutable financial evidence in
// `eos_finance.inventory_acquisition_costs` by the receipt transaction that produced it.
//
// ════════════════════ ONE DEFINITION OF THE COST SEMANTICS ════════════════════
//
// The rules about money -- integer minor units, both-or-neither price and currency, no negative
// amounts, exact extended cost, required lineage -- are NOT restated here. They live in
// `finance/acquisitionCost.ts`, which is a pure module with no Firebase dependency of any kind, and
// this authority calls it. Restating them would create a second place the rules could drift, and
// "the PostgreSQL cost and the Firestore cost disagreed" is precisely the class of defect a
// migration must not introduce.
//
// What IS new here is the company (Ruling R3): the Firestore fact carried whatever
// `operatingCompanyId` the source document held, while a PostgreSQL purchase order carries an
// operational KEY. The id is resolved from that key through the governed binding, in this same
// transaction, and frozen onto the fact.
//
// ════════════════════ NO PRICE MEANS UNKNOWN, NEVER ZERO ════════════════════
//
// `planAcquisitionCost` returns null for an unpriced line and the caller writes nothing. The absence
// of a row is how "the cost of this receipt is not known" is said. A zero-cost row would read as
// "this was free" and would silently inflate every margin computed from it -- which is why nothing
// in this module has a default price, and why the caller must not invent one.

import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import {
  PURCHASE_ORDER_LINE_PRICE,
  buildAcquisitionCostFact,
  governedPurchasePrice,
  type AcquisitionCostFact,
} from "../finance/acquisitionCost.js";
import { resolveActiveOperatingCompanyId } from "./operatingCompanyBinding.js";

const SCHEMA = "eos_finance";

export class AcquisitionCostAuthorityError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AcquisitionCostAuthorityError";
  }
}

/** What the receipt knows about one line's purchase, and where it landed. */
export interface AcquisitionCostInput {
  /** From the purchase order line. Absent/null means UNPRICED, which is a legitimate outcome. */
  readonly unitPriceMinor: number | null;
  readonly currency: string | null;
  /** The stamp the source purchase order carries, copied verbatim. Null where it carries none. */
  readonly priceAuthorityVersion: number | null;
  /** The OPERATIONAL key on the purchase order. Resolved to a governed company id, never assumed equal to one. */
  readonly operatingCompanyKey: string;
  readonly purchaseOrderId: string;
  readonly purchaseOrderLineId: string;
  readonly purchaseOrderSourceType: string;
  readonly purchaseOrderVersion: number | null;
  readonly supplierId: string | null;
  readonly supplierName: string | null;
  readonly partId: string;
  readonly receivedQuantity: number;
  readonly receivingId: string;
  readonly receivingLineId: string;
  /** The receipt's governed business event time -- the same instant every other effect carries. */
  readonly receivedAt: Date;
  readonly receivingLocationType: string;
  readonly receivingLocationId: string;
}

export interface PlannedAcquisitionCost {
  readonly fact: AcquisitionCostFact;
  readonly priceAuthorityVersion: number | null;
  readonly receivedAt: Date;
}

/**
 * Decide whether this receipt line produces cost evidence, and build it if so.
 *
 * Returns NULL for an unpriced line. Throws for a line that is priced INCOHERENTLY (an amount with
 * no currency, a fractional amount, a negative amount) or whose company cannot be governed -- a
 * malformed price is not the same fact as an absent one and must never be silently dropped.
 */
export async function planAcquisitionCost(
  client: PoolClient,
  tenantId: string,
  input: AcquisitionCostInput,
): Promise<PlannedAcquisitionCost | null> {
  const price = governedPurchasePrice({
    unitPriceMinor: input.unitPriceMinor ?? undefined,
    currency: input.currency ?? undefined,
  });
  if (price === null) return null;

  // RULING R3: resolved, never inferred. Read only once a price exists, so an unpriced receipt is
  // not refused for a company binding no fact was going to carry.
  const operatingCompanyId = await resolveActiveOperatingCompanyId(client, tenantId, input.operatingCompanyKey);

  const fact = buildAcquisitionCostFact({
    price,
    operatingCompanyId,
    purchaseOrderId: input.purchaseOrderId,
    purchaseOrderLineId: input.purchaseOrderLineId,
    purchaseOrderSourceType: input.purchaseOrderSourceType,
    purchaseOrderVersion: input.purchaseOrderVersion,
    supplierId: input.supplierId,
    supplierName: input.supplierName,
    partId: input.partId,
    receivedQuantity: input.receivedQuantity,
    receivingId: input.receivingId,
    receivingLineId: input.receivingLineId,
    receivedAtMillis: input.receivedAt.getTime(),
    receivingLocationType: input.receivingLocationType,
    receivingLocationId: input.receivingLocationId,
  });
  return { fact, priceAuthorityVersion: input.priceAuthorityVersion, receivedAt: input.receivedAt };
}

/**
 * Write one planned fact, INSIDE the caller's transaction.
 *
 * `acquisition_cost_one_per_receipt_line` is the duplicate guard, and it is a plain INSERT rather
 * than an upsert on purpose: a second fact for the same receipt line is a financial defect, and the
 * right response is to fail the whole receipt, not to overwrite the first one.
 */
export async function insertAcquisitionCostFact(
  client: PoolClient,
  tenantId: string,
  actorPrincipalId: string,
  planned: PlannedAcquisitionCost,
): Promise<string> {
  const f = planned.fact;
  const id = `acq_${randomUUID()}`;
  await client.query(
    `INSERT INTO ${SCHEMA}.inventory_acquisition_costs
       (id, tenant_id, cost_basis, operating_company_id,
        purchase_order_id, purchase_order_line_id, purchase_order_source_type, purchase_order_version,
        supplier_id, supplier_name, part_id, received_quantity,
        unit_price_minor, extended_cost_minor, currency, price_authority_version,
        receiving_id, receiving_line_id, received_at, receiving_location_type, receiving_location_id,
        created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)`,
    [
      id, tenantId, PURCHASE_ORDER_LINE_PRICE, f.operatingCompanyId,
      f.purchaseOrderId, f.purchaseOrderLineId, f.purchaseOrderSourceType, f.purchaseOrderVersion,
      f.supplierId, f.supplierName, f.partId, f.receivedQuantity,
      f.unitPriceMinor, f.extendedCostMinor, f.currency, planned.priceAuthorityVersion,
      f.receivingId, f.receivingLineId, planned.receivedAt, f.receivingLocationType, f.receivingLocationId,
      actorPrincipalId,
    ],
  );
  return id;
}
