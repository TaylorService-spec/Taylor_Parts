// RECEIVING'S OWN REFERENCE NUMBER -- RO-YYYY-######.
//
// ════════════════════ WHY THIS IS NOT eos_commercial.number_counters ════════════════════
//
// A counter table already exists. Reusing it was refused deliberately: its series column is the
// `commercial_number_series` enum, so drawing Receiving numbers from it would make COMMERCIAL the
// authority for an OPERATIONS reference number -- a Commercial migration could then renumber or
// retire the series every Receiving Order in the system is numbered from. Receiving owns its own
// counter, in its own schema, keyed by nothing but the tenant and the UTC year.
//
// ════════════════════ WHAT MAKES IT SAFE ════════════════════
//
// TRANSACTION-SCOPED. It takes the caller's PoolClient and never opens a transaction of its own, so
// the number and the receipt commit together: a rolled-back receipt consumes no number it did not
// keep, and a committed receipt cannot be missing one.
//
// SERIALIZED BY THE COUNTER ROW. `INSERT ... ON CONFLICT DO UPDATE` takes a row lock on the
// (tenant, year) counter. Two concurrent receipts queue on it, and the second reads the first's
// committed value rather than racing it. `receiving_orders_number_unique` (migration 040) is the
// independent structural proof that the same number cannot reach two receipts even if some future
// caller bypassed this function entirely.
//
// INDEPENDENT OF IDENTITY. The number is not derived from the Receiving Order id, and the id is not
// derived from the number. A reference number is what a person says out loud; an id is what the
// system joins on, and tying them together would make either one unable to change without the other.

import type { PoolClient } from "pg";

const SCHEMA = "eos_ops";

/** receivingOrderNumbering.ts's format, and the `receiving_order_number_format` CHECK, in one place. */
export const RECEIVING_ORDER_NUMBER_PATTERN = /^RO-[0-9]{4}-[0-9]{6,}$/;

export class ReceivingNumberError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ReceivingNumberError";
  }
}

/**
 * Format one allocated sequence value.
 *
 * Six digits MINIMUM, not exactly six. A tenant that takes more than 999,999 receipts in a year gets
 * a seven-digit number rather than a collision or a wrapped counter -- the format CHECK is written
 * `{6,}` for exactly this reason.
 */
export function formatReceivingOrderNumber(year: number, sequence: number): string {
  if (!Number.isInteger(year) || year < 1970 || year > 9999) {
    throw new ReceivingNumberError("YEAR_INVALID", "a receiving order number is stamped with a four-digit UTC year");
  }
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new ReceivingNumberError("SEQUENCE_INVALID", "a receiving order sequence starts at 1");
  }
  return `RO-${year}-${String(sequence).padStart(6, "0")}`;
}

/**
 * Allocate the next receiving order number for (tenant, UTC year), INSIDE the caller's transaction.
 *
 * Call this ONLY on the apply path. A replay returns the receipt that already exists, which already
 * carries its number; allocating again would burn a number nothing is named by and would make the
 * counter a count of attempts rather than of receipts.
 */
export async function allocateReceivingOrderNumber(
  client: PoolClient,
  tenantId: string,
  year: number,
): Promise<string> {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.receiving_number_counters (tenant_id, year, last_value)
          VALUES ($1, $2, 1)
     ON CONFLICT (tenant_id, year)
     DO UPDATE SET last_value = ${SCHEMA}.receiving_number_counters.last_value + 1, updated_at = now()
       RETURNING last_value`,
    [tenantId, year],
  );
  const sequence = Number(rows[0].last_value);
  return formatReceivingOrderNumber(year, sequence);
}
