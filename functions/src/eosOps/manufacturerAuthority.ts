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
// ════════════════════ THE READS ════════════════════
//
// The live legacy surface is manufacturerReadService.ts's `getManufacturerCatalog`, which reads the
// whole collection for the Part and Equipment forms. So: LIST, and GET BY ID for a form resolving one
// reference.
//
// SEARCH is the third, and it is the same read narrowed in the database rather than in the browser. The
// legacy client filters a list it already holds; that is only tenable while the whole catalog is small
// enough to ship on every form load, and it is the CLIENT -- not the authority -- deciding what matching
// means. SEARCH states the match once, on the server, over the SAME normalized_name the list is ordered
// by, under the SAME capability. It adds no reach: every row it can return, LIST already returns.
//
// ALL THREE ARE THE SAME AUTHORIZATION. There is no read here a caller without
// `inventory.manufacturer.read` can perform, and no fallback to Firestore when the table is empty -- an
// empty governed table is an honest empty answer, not a reason to go looking somewhere else.
import type { Pool, PoolClient } from "pg";

export const MANUFACTURER_READ = "inventory.manufacturer.read";

export const MANUFACTURER_STATUSES = Object.freeze(["ACTIVE", "INACTIVE"] as const);
export type ManufacturerStatus = (typeof MANUFACTURER_STATUSES)[number];

/** Bounds on the search input and its page. Stated here so no caller can choose an unbounded read. */
export const MANUFACTURER_SEARCH_TERM_MAX = 200;
export const MANUFACTURER_SEARCH_DEFAULT_LIMIT = 50;
export const MANUFACTURER_SEARCH_MAX_LIMIT = 200;

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

/**
 * The manufacturers whose name CONTAINS `term`, case- and whitespace-insensitively.
 *
 * MATCHING IS THE NORMALIZED NAME -- the column the table already indexes and orders by
 * (manufacturers_by_name), whose derivation is stated once in manufacturerMigration.ts#normalizeName:
 * trim, collapse internal whitespace, uppercase. So "taylor  company" and "Taylor Company" find the same
 * row, and the rule a caller experiences is the rule the column actually holds.
 *
 * CONTAINS, not prefix: the word a user remembers is frequently not the first one ("Soft Serve" for
 * "Taylor Soft Serve"). The term is a BOUND PARAMETER and its LIKE metacharacters are escaped, so a
 * caller cannot smuggle in a pattern that widens the match.
 *
 * INACTIVE rows are included, for the same reason LIST includes them. An empty term is INVALID_INPUT
 * rather than "everything": a caller that wants everything has LIST, and silently promoting a blank box
 * to a whole-table read is how a search endpoint becomes an accidental export.
 */
export async function searchManufacturers(
  db: Pick<Pool | PoolClient, "query">,
  reader: ManufacturerReader,
  term: string,
  options?: { readonly limit?: number },
): Promise<readonly ManufacturerRecord[]> {
  assertMayRead(reader);
  const raw = typeof term === "string" ? term.trim().replace(/\s+/g, " ") : "";
  if (!raw) refuse("SEARCH_TERM_REQUIRED", "INVALID_INPUT", "a non-empty search term is required");
  if (raw.length > MANUFACTURER_SEARCH_TERM_MAX) {
    refuse("SEARCH_TERM_TOO_LONG", "INVALID_INPUT", `a search term is at most ${MANUFACTURER_SEARCH_TERM_MAX} characters`);
  }
  const limit = options?.limit ?? MANUFACTURER_SEARCH_DEFAULT_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MANUFACTURER_SEARCH_MAX_LIMIT) {
    refuse("SEARCH_LIMIT_INVALID", "INVALID_INPUT", `limit must be an integer between 1 and ${MANUFACTURER_SEARCH_MAX_LIMIT}`);
  }
  // The caller's text is DATA. Backslash, % and _ are escaped so the term can only ever match itself.
  const pattern = `%${raw.toUpperCase().replace(/([\\%_])/g, "\\$1")}%`;
  const { rows } = await db.query(
    `SELECT id, name, status, provenance FROM eos_ops.manufacturers
      WHERE tenant_id = $1 AND normalized_name LIKE $2 ESCAPE '\\'
      ORDER BY normalized_name, id LIMIT $3`,
    [reader.tenantId, pattern, limit]);
  return Object.freeze(rows.map(toRecord));
}
