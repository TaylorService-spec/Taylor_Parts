// IMPORTED SERVICE HISTORY -- THE READ SIDE, ON EOS (Firebase exit B4, DECISIONS #B4; F7f-1). It replaces the Firebase callable
// listImportedServiceHistory (the Account page's "Imported historical service" section) with the SAME answer over eos_ops.imported_service_history.
//
// It is a read and nothing else: no write path exists in this module (the writer is the Data Import SERVICE_HISTORY plane, dataImportOperations.ts).
// A record is history of service performed in ANOTHER system: it is never a Work Order, and the technician name and equipment serial leave exactly as
// they were stored -- text a former system recorded -- never resolved to a current Employee or Equipment record.
//
// AUTHORITY. customer.record.read -- the existing authority to read a Customer record (reading a customer's history is reading about that customer);
// deliberately NOT the import capability (gating the read on admin.dataImport.* would make the history visible only to whoever imported it). Then
// COMPANY (#235 / #237): a record belongs to the operating company its import was staged for, and a caller reads only the records of companies it is
// authorized for -- a record of another company reads as one that does not exist (no flag, no count). A caller with no company authority is REFUSED,
// never answered with an empty history. An account that is not this tenant's reads as a missing one.
import type { Pool } from "pg";
import { acceptOnly, DATE_AS_TEXT, ID_SHAPE, inTransaction, reachableCompanies, refuse, requireCapability, type RecordsActor } from "./recordsSupport.js";

const SCHEMA = "eos_ops";
export const IMPORTED_SERVICE_HISTORY_READ_CAPABILITY = "customer.record.read";
/** The kind every row carries, so a consumer can never mistake one for a Work Order. */
export const IMPORTED_SERVICE_RECORD_KIND = "IMPORTED_SERVICE_HISTORY";
/** Hard ceiling. A customer's whole history is not a page, and this is a section on one. */
export const IMPORTED_SERVICE_HISTORY_MAX = 100;

export async function listImportedServiceHistory(deps: { readonly pool: Pool }, actor: RecordsActor, input: Record<string, unknown>) {
  requireCapability(actor, IMPORTED_SERVICE_HISTORY_READ_CAPABILITY);
  const i = acceptOnly(input, ["accountId", "limit"]);
  if (!ID_SHAPE(i.accountId)) refuse("ACCOUNT_ID_REQUIRED", "INVALID_INPUT", "an account is required");
  const accountId = i.accountId as string;
  let bounded = IMPORTED_SERVICE_HISTORY_MAX;
  if (i.limit !== undefined && i.limit !== null) {
    if (typeof i.limit !== "number" || !Number.isFinite(i.limit)) refuse("LIMIT_INVALID", "INVALID_INPUT", "limit must be a number");
    bounded = Math.max(1, Math.min(Math.trunc(i.limit as number), IMPORTED_SERVICE_HISTORY_MAX));
  }

  return inTransaction(deps.pool, "snapshot", async (c) => {
    const reach = await reachableCompanies(c, actor);
    const account = await c.query(`SELECT 1 FROM eos_crm.accounts WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, accountId]);
    if (account.rows.length === 0) refuse("ACCOUNT_NOT_FOUND", "NOT_FOUND", "customer not found");
    // One more than asked for, so "there is more than this" is a fact rather than a guess. Newest service first; a row with no date cannot exist.
    const { rows } = await c.query(
      `SELECT id, ${DATE_AS_TEXT("service_date")} AS service_date, summary, external_reference, technician_name, equipment_serial_number,
              location_name, source_system, import_job_id
         FROM ${SCHEMA}.imported_service_history
        WHERE tenant_id = $1 AND account_id = $2 AND operating_company_key = ANY($3::text[])
        ORDER BY service_date DESC, id LIMIT $4`,
      [actor.tenantId, accountId, [...reach.keys], bounded + 1]);
    return {
      accountId,
      // An ALLOW-LIST, not a passthrough: a column added to the table is invisible here until somebody adds it here too.
      rows: rows.slice(0, bounded).map((r) => ({
        id: String(r.id),
        recordKind: IMPORTED_SERVICE_RECORD_KIND,
        serviceDate: String(r.service_date),
        summary: String(r.summary),
        externalReference: (r.external_reference as string | null) ?? null,
        technicianName: (r.technician_name as string | null) ?? null,
        equipmentSerialNumber: (r.equipment_serial_number as string | null) ?? null,
        locationName: (r.location_name as string | null) ?? null,
        sourceSystem: (r.source_system as string | null) ?? null,
        importJobId: (r.import_job_id as string | null) ?? null,
      })),
      truncated: rows.length > bounded,
    };
  });
}
