// THE NATIVE WORK ORDER NUMBER ALLOCATOR.
//
// Mirrors eosCommercial/commercialNumbering.ts exactly -- same counter shape, same single-statement
// increment, same format discipline. A second, subtly different numbering implementation is how two
// series drift apart, and this platform already made that argument once.
//
// SCOPE IS TENANT + YEAR, and it is not decided here: migration 1761004800000's unique index is
// (tenant_id, work_order_number), so a Taylor and a Ventana Work Order in one tenant draw from ONE
// sequence. Had numbering been company-scoped that index would carry operating_company_key.
//
// THE CALLER'S TRANSACTION. `db` is the command's own client, so the allocation commits or rolls back
// with the Work Order it numbers. A number handed out for a create that then failed is a gap somebody
// has to explain, and the counter is a row precisely so that cannot happen.
import type { PoolClient } from "pg";

const SCHEMA = "eos_ops";

/** WO-YYYY-###### -- the format the target's CHECK constraint enforces and legacy already used. */
export const WORK_ORDER_NUMBER_PATTERN = /^WO-[0-9]{4}-[0-9]{6,}$/;

export class WorkOrderNumberingError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "WorkOrderNumberingError";
  }
}

/** The year the number carries. UTC, so the same instant never produces two different years. */
export function workOrderNumberYear(at: Date): number {
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) {
    throw new WorkOrderNumberingError("NUMBER_CLOCK_INVALID", "a Work Order number needs a real instant");
  }
  return at.getUTCFullYear();
}

/**
 * Six digits, and NOT truncated once a year outgrows six.
 *
 * The CHECK is `[0-9]{6,}`, so the sixth digit is a floor rather than a cap. Truncating at six would
 * start re-issuing numbers on the 1,000,000th Work Order -- silently, and only in the busiest year.
 */
export function formatWorkOrderNumber(year: number, sequence: number): string {
  if (!Number.isInteger(year) || year < 1970 || year > 9999) {
    throw new WorkOrderNumberingError("NUMBER_YEAR_INVALID", `year ${year} is outside the governed range`);
  }
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new WorkOrderNumberingError("NUMBER_SEQUENCE_INVALID", "a sequence starts at 1");
  }
  return `WO-${year}-${String(sequence).padStart(6, "0")}`;
}

export interface AllocatedWorkOrderNumber {
  readonly year: number;
  readonly sequence: number;
  readonly number: string;
}

/**
 * Allocate the next Work Order number for a tenant and year.
 *
 * ONE STATEMENT. The INSERT ... ON CONFLICT DO UPDATE ... RETURNING takes the counter row's lock and
 * returns the incremented value together, so two concurrent creates serialize on that row rather than
 * both reading the same maximum and colliding on the unique index. There is no SELECT max() anywhere in
 * this module, and a test asserts that by reading its own source.
 */
export async function allocateWorkOrderNumber(
  db: Pick<PoolClient, "query">,
  tenantId: string,
  at: Date,
): Promise<AllocatedWorkOrderNumber> {
  if (typeof tenantId !== "string" || tenantId.trim() === "") {
    throw new WorkOrderNumberingError("NUMBER_TENANT_REQUIRED", "a Work Order number is only allocatable within a tenant");
  }
  const year = workOrderNumberYear(at);
  const { rows } = await db.query(
    `INSERT INTO ${SCHEMA}.work_order_number_counters (tenant_id, year, last_value)
     VALUES ($1, $2, 1)
     ON CONFLICT (tenant_id, year)
     DO UPDATE SET last_value = ${SCHEMA}.work_order_number_counters.last_value + 1, updated_at = now()
     RETURNING last_value`,
    [tenantId, year],
  );
  const sequence = Number(rows[0].last_value);
  return Object.freeze({ year, sequence, number: formatWorkOrderNumber(year, sequence) });
}
