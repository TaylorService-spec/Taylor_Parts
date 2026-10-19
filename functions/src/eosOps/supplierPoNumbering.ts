// THE SUPPLIER PURCHASE ORDER'S OWN NUMBER -- SPO-YYYY-######. The receivingNumbering.ts pattern, for the same reasons:
//
//   * its own counter (eos_ops.supplier_po_number_counters), keyed by nothing but the tenant and the UTC year, so no other series (RR, RO, WO,
//     eos_commercial.number_counters) is the authority for a purchasing reference;
//   * TRANSACTION-SCOPED: it takes the caller's PoolClient and opens no transaction, so the number commits with the order it names and a rolled-back
//     create consumes none (GAP-SAFE);
//   * SERIALIZED BY THE COUNTER ROW (INSERT .. ON CONFLICT DO UPDATE takes the row lock), and the partial unique index
//     supplier_purchase_orders_spo_number_unique is the independent structural proof that one number cannot reach two orders;
//   * INDEPENDENT OF IDENTITY: the number is what a person says to the supplier; the id is what the system joins on.
import type { PoolClient } from "pg";

const SCHEMA = "eos_ops";

/** The format the `supplier_purchase_order_spo_number_format` CHECK enforces, in one place. */
export const SUPPLIER_PO_NUMBER_PATTERN = /^SPO-[0-9]{4}-[0-9]{6,}$/;

export class SupplierPoNumberError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "SupplierPoNumberError";
  }
}

/** Six digits MINIMUM, not exactly six: a tenant past 999,999 orders in a year gets seven digits, never a collision or a wrap. */
export function formatSupplierPoNumber(year: number, sequence: number): string {
  if (!Number.isInteger(year) || year < 1970 || year > 9999) {
    throw new SupplierPoNumberError("YEAR_INVALID", "a supplier purchase order number is stamped with a four-digit UTC year");
  }
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new SupplierPoNumberError("SEQUENCE_INVALID", "a supplier purchase order sequence starts at 1");
  }
  return `SPO-${year}-${String(sequence).padStart(6, "0")}`;
}

/** Allocate the next number for (tenant, UTC year) INSIDE the caller's transaction. Call it ONLY on the apply path, never on a replay. */
export async function allocateSupplierPoNumber(client: PoolClient, tenantId: string, year: number): Promise<string> {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.supplier_po_number_counters (tenant_id, year, last_value)
          VALUES ($1, $2, 1)
     ON CONFLICT (tenant_id, year)
     DO UPDATE SET last_value = ${SCHEMA}.supplier_po_number_counters.last_value + 1, updated_at = now()
       RETURNING last_value`,
    [tenantId, year]);
  return formatSupplierPoNumber(year, Number(rows[0].last_value));
}
