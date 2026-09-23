// THE POSTGRESQL MANUFACTURER READ AUTHORITY.
//
// ════════════════════ WHAT THIS DOES NOT DO ════════════════════
//
// It does not read Firestore, it does not consult permissionCatalog.ts, and it does not look at a
// Role key, a Job Role, an Employee title or `caller.role`. Authorization is the canonical
// capability and nothing else -- the caller resolves its effective capability set through
// capabilitiesForRoleKeys (Roles) and principal_capabilities (direct grants), and hands the set in.
//
// MANUFACTURER HAS NO BUSINESS SCOPE. The source record is {manufacturerId, name, status}: no
// operating company, no warehouse, no owner. So there is no contextual predicate to evaluate --
// holding the capability reaches every manufacturer in the tenant, because that is what the record
// actually says. A scope check invented here would refuse reads the source permits.
//
// ════════════════════ ONLY THE READS THAT EXIST ════════════════════
//
// The live surface is manufacturerReadService.ts's `getManufacturerCatalog`, which reads the whole
// collection for the Part and Equipment forms. So: LIST, and GET BY ID for a form resolving one
// reference. No search endpoint is built, because no caller has one -- the client filters a list it
// already holds.
import type { Pool, PoolClient } from "pg";

export const MANUFACTURER_READ = "inventory.manufacturer.read";

export const MANUFACTURER_STATUSES = Object.freeze(["ACTIVE", "INACTIVE"] as const);
export type ManufacturerStatus = (typeof MANUFACTURER_STATUSES)[number];

export interface ManufacturerRecord {
  readonly id: string;
  readonly name: string;
  readonly status: ManufacturerStatus;
  readonly provenance: string;
}

export type ManufacturerReadCategory = "FORBIDDEN" | "INVALID_INPUT";

export class ManufacturerReadError extends Error {
  constructor(readonly code: string, readonly category: ManufacturerReadCategory, message: string) {
    super(`${code}: ${message}`);
    this.name = "ManufacturerReadError";
  }
}
const refuse = (code: string, category: ManufacturerReadCategory, message: string): never => {
  throw new ManufacturerReadError(code, category, message);
};

export interface ManufacturerReader {
  readonly tenantId: string;
  /** Effective capability keys. Provenance (Role or direct) is irrelevant to the decision. */
  readonly capabilities: ReadonlySet<string>;
}

function assertMayRead(reader: ManufacturerReader): void {
  if (!(reader.capabilities instanceof Set) || !reader.capabilities.has(MANUFACTURER_READ)) {
    refuse("CAPABILITY_MISSING", "FORBIDDEN", `this read requires ${MANUFACTURER_READ}`);
  }
}

const toRecord = (r: Record<string, unknown>): ManufacturerRecord => Object.freeze({
  id: String(r.id),
  name: String(r.name),
  status: String(r.status) as ManufacturerStatus,
  provenance: String(r.provenance),
});

/**
 * Every manufacturer in the tenant, ACTIVE and INACTIVE alike, ordered by normalized name.
 *
 * INACTIVE ones are INCLUDED deliberately: equipment already names them, and a form resolving an
 * existing reference must still be able to show what it points at. Filtering is the caller's
 * decision -- a picker offering new choices wants ACTIVE only, a record display wants both.
 */
export async function listManufacturers(
  db: Pick<Pool | PoolClient, "query">,
  reader: ManufacturerReader,
): Promise<readonly ManufacturerRecord[]> {
  assertMayRead(reader);
  const { rows } = await db.query(
    `SELECT id, name, status, provenance FROM eos_ops.manufacturers
      WHERE tenant_id = $1 ORDER BY normalized_name, id`,
    [reader.tenantId]);
  return Object.freeze(rows.map(toRecord));
}

/** One manufacturer, or null. Null is not an error: a dangling reference is a real possibility. */
export async function getManufacturer(
  db: Pick<Pool | PoolClient, "query">,
  reader: ManufacturerReader,
  manufacturerId: string,
): Promise<ManufacturerRecord | null> {
  assertMayRead(reader);
  const id = typeof manufacturerId === "string" ? manufacturerId.trim() : "";
  if (!id) refuse("MANUFACTURER_ID_REQUIRED", "INVALID_INPUT", "a manufacturerId is required");
  const { rows } = await db.query(
    `SELECT id, name, status, provenance FROM eos_ops.manufacturers
      WHERE tenant_id = $1 AND id = $2`,
    [reader.tenantId, id]);
  return rows.length === 1 ? toRecord(rows[0]) : null;
}
