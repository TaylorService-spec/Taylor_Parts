// EOS Operational Data Plane — the governed Supplier / Supplier Catalog Item repository.
//
// The PostgreSQL authority for the two business objects created by migration 008
// (migrations/1758499200000_supplier-and-supplier-catalog-authority.sql). Same contract as
// cycleCountRepository.ts: every function takes the shared `Pool` (this module never opens a
// connection and never reads DATABASE_URL — test/eosOpsNoFirebase.test.mjs proves it), every read
// and write is tenant-scoped in the SQL itself, and failures are a stable `code` plus a message.
//
// ════════════════════ WHAT THIS MODULE IS THE BOUNDARY FOR ════════════════════
//
// It is the ONLY place that writes these two tables, and it is where three rules are refused
// BEFORE they reach SQL — so a caller gets the reason rather than a constraint name:
//
//   * part_id must be the canonical `Part.partId`. Gated by `requireCanonicalPartId`
//     (migration/partIdContract.ts) — the ONE canonicalization, imported, never restated. This
//     module has no second normalizer, no alias lookup and no fallback; see that file's header.
//   * supplier_id must match the governed id pattern, and the supplier must EXIST. Existence is
//     the database's answer, via the foreign key; this module translates the violation into
//     SUPPLIER_NOT_FOUND rather than leaking a constraint name.
//   * a version-checked write applies only to the version the caller read. Optimistic concurrency
//     is expressed as `AND version = $n` in the UPDATE, so a lost update is a zero-row result, not
//     a silent overwrite.
//
// ════════════════════ WHAT IT DELIBERATELY DOES NOT DO ════════════════════
//
//   * NO NORMALIZATION OF ITS OWN. `normalizedKey` is carried verbatim from the governed record.
//     normalizeSupplierName (supplierMaster/supplierMasterValidation.ts) is the one definition of
//     "normalized"; a second one here would drift from it, and dedup detection would then depend
//     on which layer computed the key.
//   * NO AUTHORIZATION. Capability checks belong to the governed command layer above this, the way
//     policyCommands.ts gates before touching PostgresPolicyRepository. A repository that also
//     decided authorization would be two authorities in one file.
//   * NO AUTO-MERGE. `findActiveSuppliersByNormalizedKey` REPORTS suspected duplicates and nothing
//     else — S2's stated policy is detection, never auto-merge.
//   * NO OPERATING COMPANY COLUMN. Neither table asserts where stock is or whose custody it sits
//     in, and no governed source record carries one. See migration 008's header.
import type { Pool, PoolClient } from "pg";
import { requireCanonicalPartId } from "./migration/partIdContract.js";

const SCHEMA = "eos_ops";

/** supplierMasterTypes.ts SUPPLIER_ID_PATTERN — the governed id space this table shares. */
const SUPPLIER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export const SUPPLIER_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type SupplierStatus = (typeof SUPPLIER_STATUSES)[number];

export const SUPPLIER_ITEM_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type SupplierItemStatus = (typeof SUPPLIER_ITEM_STATUSES)[number];

export const AVAILABILITY_STATES = ["AVAILABLE", "UNAVAILABLE", "UNKNOWN"] as const;
export type AvailabilityState = (typeof AVAILABILITY_STATES)[number];

/** The seven optional business strings, in the order migration 008 declares them. */
export const SUPPLIER_OPTIONAL_FIELDS = [
  "vendorNumber",
  "contactName",
  "phone",
  "email",
  "address",
  "paymentTermsRef",
  "notes",
] as const;
export type SupplierOptionalField = (typeof SUPPLIER_OPTIONAL_FIELDS)[number];

const OPTIONAL_COLUMN: Readonly<Record<SupplierOptionalField, string>> = Object.freeze({
  vendorNumber: "vendor_number",
  contactName: "contact_name",
  phone: "phone",
  email: "email",
  address: "address",
  paymentTermsRef: "payment_terms_ref",
  notes: "notes",
});

/** eos_ops error idiom (CycleCountRepositoryError): a stable `code` plus a human message. */
export class SupplierCatalogRepositoryError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export interface SupplierRecord {
  readonly tenantId: string;
  readonly supplierId: string;
  readonly name: string;
  readonly normalizedKey: string;
  readonly status: SupplierStatus;
  readonly version: number;
  readonly vendorNumber: string | null;
  readonly contactName: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly address: string | null;
  readonly paymentTermsRef: string | null;
  readonly notes: string | null;
}

/** The conversion from purchase unit to stocking unit. types.ts ConversionFactor, decomposed. */
export interface PurchaseConversion {
  readonly purchaseUnit: string;
  readonly numerator: number;
  readonly denominator: number;
}

export interface SupplierCatalogItemRecord {
  readonly tenantId: string;
  /** `<partId>__<supplierId>`, DERIVED by the database. Never supplied by a caller. */
  readonly itemId: string;
  readonly partId: string;
  readonly supplierId: string;
  readonly supplierSku: string;
  /** A decimal STRING, as pg returns NUMERIC — never a float. */
  readonly cost: string;
  readonly currency: string;
  readonly leadTimeDays: number;
  readonly minOrderQty: string | null;
  readonly orderMultiple: string | null;
  readonly conversion: PurchaseConversion | null;
  readonly contractStart: string | null;
  readonly contractEnd: string | null;
  /** ISO-8601 instant, or null. When the terms were last confirmed with the supplier. */
  readonly lastVerifiedAt: string | null;
  readonly availability: AvailabilityState;
  readonly preferred: boolean;
  readonly status: SupplierItemStatus;
  readonly version: number;
}

export interface CreateSupplierInput {
  readonly supplierId: string;
  readonly name: string;
  /** Carried verbatim from the governed record. Never recomputed here. */
  readonly normalizedKey: string;
  readonly status?: SupplierStatus;
  readonly vendorNumber?: string | null;
  readonly contactName?: string | null;
  readonly phone?: string | null;
  readonly email?: string | null;
  readonly address?: string | null;
  readonly paymentTermsRef?: string | null;
  readonly notes?: string | null;
}

export interface CreateSupplierCatalogItemInput {
  readonly partId: string;
  readonly supplierId: string;
  readonly supplierSku: string;
  readonly cost: string;
  readonly currency: string;
  readonly leadTimeDays: number;
  readonly minOrderQty?: string | null;
  readonly orderMultiple?: string | null;
  readonly conversion?: PurchaseConversion | null;
  readonly contractStart?: string | null;
  readonly contractEnd?: string | null;
  readonly lastVerifiedAt?: string | null;
  readonly availability?: AvailabilityState;
  readonly status?: SupplierItemStatus;
}

// ---------------------------------------------------------------------------
// Boundary gates
// ---------------------------------------------------------------------------

/** The governed supplier id, unchanged or refused. Format only — existence is the FK's answer. */
export function requireSupplierId(value: unknown, context = "supplier_id"): string {
  if (typeof value !== "string" || !SUPPLIER_ID_PATTERN.test(value)) {
    throw new SupplierCatalogRepositoryError(
      "SUPPLIER_ID_INVALID",
      `${context} must match [A-Za-z0-9_-]{1,64}`,
    );
  }
  return value;
}

function requireNonBlank(value: unknown, code: string, context: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new SupplierCatalogRepositoryError(code, `${context} must be a non-blank string`);
  }
  return value;
}

/**
 * An optional business string: absent/null means ABSENT. A blank string is refused rather than
 * stored, mirroring supplierMasterCommands.ts's assertOptionalFields — the database CHECK says the
 * same thing, but a caller deserves the field name back, not a constraint name.
 */
function optionalString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new SupplierCatalogRepositoryError(
      "OPTIONAL_FIELD_BLANK",
      `optional field "${field}" must be a non-blank string when present`,
    );
  }
  return value;
}

function requireConversion(conversion: PurchaseConversion | null | undefined): PurchaseConversion | null {
  if (conversion === undefined || conversion === null) return null;
  requireNonBlank(conversion.purchaseUnit, "CONVERSION_INVALID", "purchaseUnit");
  for (const key of ["numerator", "denominator"] as const) {
    const v = conversion[key];
    if (!Number.isInteger(v) || v <= 0) {
      throw new SupplierCatalogRepositoryError("CONVERSION_INVALID", `conversion ${key} must be a positive integer`);
    }
  }
  return conversion;
}

/**
 * Translate the two database-stated relationship failures into this module's codes. A foreign key
 * violation on supplier_catalog_items means the supplier does not exist; a unique violation on the
 * partial preferred index means some other item is already the preferred one for that part.
 */
function translate(err: unknown): never {
  const e = err as { code?: string; constraint?: string };
  if (e?.code === "23503") {
    throw new SupplierCatalogRepositoryError("SUPPLIER_NOT_FOUND", "no supplier exists at that id in this tenant");
  }
  if (e?.code === "23505" && e.constraint === "supplier_catalog_items_one_preferred_per_part") {
    throw new SupplierCatalogRepositoryError("PREFERRED_ALREADY_SET", "another supplier item is already preferred for this part");
  }
  if (e?.code === "23505") {
    throw new SupplierCatalogRepositoryError("ALREADY_EXISTS", "a record already exists at that identity");
  }
  if (e?.code === "23514") {
    throw new SupplierCatalogRepositoryError("CONSTRAINT_VIOLATED", `a stored-shape rule was violated: ${e.constraint ?? "unknown"}`);
  }
  throw err;
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

const SUPPLIER_COLUMNS =
  "tenant_id, supplier_id, name, normalized_key, status, version, " +
  "vendor_number, contact_name, phone, email, address, payment_terms_ref, notes";

function supplierFromRow(row: Record<string, unknown>): SupplierRecord {
  return {
    tenantId: row.tenant_id as string,
    supplierId: row.supplier_id as string,
    name: row.name as string,
    normalizedKey: row.normalized_key as string,
    status: row.status as SupplierStatus,
    version: row.version as number,
    vendorNumber: (row.vendor_number as string | null) ?? null,
    contactName: (row.contact_name as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    address: (row.address as string | null) ?? null,
    paymentTermsRef: (row.payment_terms_ref as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
  };
}

const ITEM_COLUMNS =
  "tenant_id, item_id, part_id, supplier_id, supplier_sku, cost, currency, lead_time_days, " +
  "min_order_qty, order_multiple, purchase_unit, conversion_numerator, conversion_denominator, " +
  "to_char(contract_start, 'YYYY-MM-DD') AS contract_start, " +
  "to_char(contract_end, 'YYYY-MM-DD') AS contract_end, " +
  "to_char(last_verified_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS last_verified_at, " +
  "availability, preferred, status, version";

function itemFromRow(row: Record<string, unknown>): SupplierCatalogItemRecord {
  const unit = row.purchase_unit as string | null;
  return {
    tenantId: row.tenant_id as string,
    itemId: row.item_id as string,
    partId: row.part_id as string,
    supplierId: row.supplier_id as string,
    supplierSku: row.supplier_sku as string,
    cost: row.cost as string,
    currency: row.currency as string,
    leadTimeDays: row.lead_time_days as number,
    minOrderQty: (row.min_order_qty as string | null) ?? null,
    orderMultiple: (row.order_multiple as string | null) ?? null,
    conversion: unit === null ? null : {
      purchaseUnit: unit,
      numerator: row.conversion_numerator as number,
      denominator: row.conversion_denominator as number,
    },
    contractStart: (row.contract_start as string | null) ?? null,
    contractEnd: (row.contract_end as string | null) ?? null,
    lastVerifiedAt: (row.last_verified_at as string | null) ?? null,
    availability: row.availability as AvailabilityState,
    preferred: row.preferred as boolean,
    status: row.status as SupplierItemStatus,
    version: row.version as number,
  };
}

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

export async function createSupplier(
  pool: Pool,
  tenantId: string,
  actorId: string,
  input: CreateSupplierInput,
): Promise<SupplierRecord> {
  const supplierId = requireSupplierId(input.supplierId, "supplierId");
  const name = requireNonBlank(input.name, "NAME_INVALID", "name");
  // Verbatim. See the header: there is no second definition of "normalized" in this module.
  const normalizedKey = requireNonBlank(input.normalizedKey, "NORMALIZED_KEY_INVALID", "normalizedKey");
  const optionals = SUPPLIER_OPTIONAL_FIELDS.map((f) => optionalString(input[f], f));

  try {
    const { rows } = await pool.query(
      `INSERT INTO ${SCHEMA}.suppliers
         (tenant_id, supplier_id, name, normalized_key, status, version,
          vendor_number, contact_name, phone, email, address, payment_terms_ref, notes,
          created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $8, $9, $10, $11, $12, $13, $13)
       RETURNING ${SUPPLIER_COLUMNS}`,
      [tenantId, supplierId, name, normalizedKey, input.status ?? "ACTIVE", ...optionals, actorId],
    );
    return supplierFromRow(rows[0]);
  } catch (err) {
    return translate(err);
  }
}

export async function readSupplier(
  pool: Pool,
  tenantId: string,
  supplierId: string,
): Promise<SupplierRecord | null> {
  const { rows } = await pool.query(
    `SELECT ${SUPPLIER_COLUMNS} FROM ${SCHEMA}.suppliers WHERE tenant_id = $1 AND supplier_id = $2`,
    [tenantId, requireSupplierId(supplierId, "supplierId")],
  );
  return rows.length === 0 ? null : supplierFromRow(rows[0]);
}

/**
 * Change the governed fields of a supplier, at the version the caller read. `patch` carries only
 * the fields being changed; a field set to null is CLEARED, which is how an optional business
 * string is removed. `normalizedKey` travels with `name` because the caller computed both from the
 * same governed normalizer — this module will not derive one from the other.
 */
export async function updateSupplier(
  pool: Pool,
  tenantId: string,
  actorId: string,
  supplierId: string,
  expectedVersion: number,
  patch: { name?: string; normalizedKey?: string } & Partial<Record<SupplierOptionalField, string | null>>,
): Promise<SupplierRecord> {
  requireSupplierId(supplierId, "supplierId");
  if ((patch.name === undefined) !== (patch.normalizedKey === undefined)) {
    throw new SupplierCatalogRepositoryError(
      "NORMALIZED_KEY_INVALID",
      "name and normalizedKey must change together -- this module never derives one from the other",
    );
  }

  const sets: string[] = [];
  const values: unknown[] = [tenantId, supplierId, expectedVersion, actorId];
  const push = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };
  if (patch.name !== undefined) {
    push("name", requireNonBlank(patch.name, "NAME_INVALID", "name"));
    push("normalized_key", requireNonBlank(patch.normalizedKey, "NORMALIZED_KEY_INVALID", "normalizedKey"));
  }
  for (const field of SUPPLIER_OPTIONAL_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(patch, field)) {
      push(OPTIONAL_COLUMN[field], optionalString(patch[field], field));
    }
  }
  if (sets.length === 0) {
    throw new SupplierCatalogRepositoryError("NO_CHANGE", "an update must change at least one field");
  }

  return applyVersionedUpdate(pool, tenantId, supplierId, expectedVersion, sets, values);
}

export async function setSupplierStatus(
  pool: Pool,
  tenantId: string,
  actorId: string,
  supplierId: string,
  expectedVersion: number,
  status: SupplierStatus,
): Promise<SupplierRecord> {
  requireSupplierId(supplierId, "supplierId");
  if (!(SUPPLIER_STATUSES as readonly string[]).includes(status)) {
    throw new SupplierCatalogRepositoryError("STATUS_INVALID", `status must be ${SUPPLIER_STATUSES.join("/")}`);
  }
  return applyVersionedUpdate(
    pool, tenantId, supplierId, expectedVersion,
    ["status = $5"], [tenantId, supplierId, expectedVersion, actorId, status],
  );
}

/**
 * The one versioned-UPDATE shape both supplier writers use. A zero-row result is ambiguous by
 * construction (absent, or present at a different version), so it is disambiguated by a follow-up
 * read rather than guessed at.
 */
async function applyVersionedUpdate(
  pool: Pool,
  tenantId: string,
  supplierId: string,
  expectedVersion: number,
  sets: readonly string[],
  values: readonly unknown[],
): Promise<SupplierRecord> {
  let rows: Record<string, unknown>[];
  try {
    ({ rows } = await pool.query(
      `UPDATE ${SCHEMA}.suppliers
          SET ${sets.join(", ")}, version = version + 1, updated_at = now(), updated_by = $4
        WHERE tenant_id = $1 AND supplier_id = $2 AND version = $3
        RETURNING ${SUPPLIER_COLUMNS}`,
      [...values],
    ));
  } catch (err) {
    return translate(err);
  }
  if (rows.length === 1) return supplierFromRow(rows[0]);

  const current = await readSupplier(pool, tenantId, supplierId);
  if (current === null) throw new SupplierCatalogRepositoryError("SUPPLIER_NOT_FOUND", "no supplier exists at that id in this tenant");
  throw new SupplierCatalogRepositoryError(
    "VERSION_CONFLICT",
    `expected version ${expectedVersion}, stored ${current.version}`,
  );
}

/**
 * Dedup DETECTION. Returns the OTHER ACTIVE suppliers sharing a normalized key — a suspected
 * duplicate for a human to judge. It merges nothing and refuses nothing; the index backing it is
 * deliberately not UNIQUE for exactly that reason (migration 008's header).
 */
export async function findActiveSuppliersByNormalizedKey(
  pool: Pool,
  tenantId: string,
  normalizedKey: string,
  excludeSupplierId: string | null = null,
): Promise<SupplierRecord[]> {
  const { rows } = await pool.query(
    `SELECT ${SUPPLIER_COLUMNS} FROM ${SCHEMA}.suppliers
      WHERE tenant_id = $1 AND normalized_key = $2 AND status = 'ACTIVE'
        AND ($3::text IS NULL OR supplier_id <> $3)
      ORDER BY supplier_id`,
    [tenantId, requireNonBlank(normalizedKey, "NORMALIZED_KEY_INVALID", "normalizedKey"), excludeSupplierId],
  );
  return rows.map(supplierFromRow);
}

// ---------------------------------------------------------------------------
// Supplier catalog items — the Part↔Supplier relationship
// ---------------------------------------------------------------------------

export async function createSupplierCatalogItem(
  pool: Pool,
  tenantId: string,
  actorId: string,
  input: CreateSupplierCatalogItemInput,
): Promise<SupplierCatalogItemRecord> {
  // The ONE canonicalization. It returns the same string or throws; it never substitutes an alias,
  // a supplier SKU or a manufacturer part number for a part id.
  const partId = requireCanonicalPartId(input.partId, "supplier_catalog_items.part_id");
  const supplierId = requireSupplierId(input.supplierId, "supplierId");
  const supplierSku = requireNonBlank(input.supplierSku, "SUPPLIER_SKU_INVALID", "supplierSku");
  const conversion = requireConversion(input.conversion);

  try {
    const { rows } = await pool.query(
      `INSERT INTO ${SCHEMA}.supplier_catalog_items
         (tenant_id, part_id, supplier_id, supplier_sku, cost, currency, lead_time_days,
          min_order_qty, order_multiple, purchase_unit, conversion_numerator, conversion_denominator,
          contract_start, contract_end, last_verified_at, availability, preferred, status, version,
          created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, FALSE, $17, 1, $18, $18)
       RETURNING ${ITEM_COLUMNS}`,
      [
        tenantId, partId, supplierId, supplierSku, input.cost, input.currency, input.leadTimeDays,
        input.minOrderQty ?? null, input.orderMultiple ?? null,
        conversion?.purchaseUnit ?? null, conversion?.numerator ?? null, conversion?.denominator ?? null,
        input.contractStart ?? null, input.contractEnd ?? null, input.lastVerifiedAt ?? null,
        input.availability ?? "UNKNOWN", input.status ?? "ACTIVE", actorId,
      ],
    );
    return itemFromRow(rows[0]);
  } catch (err) {
    return translate(err);
  }
}

export async function readSupplierCatalogItem(
  pool: Pool,
  tenantId: string,
  partId: string,
  supplierId: string,
): Promise<SupplierCatalogItemRecord | null> {
  const { rows } = await pool.query(
    `SELECT ${ITEM_COLUMNS} FROM ${SCHEMA}.supplier_catalog_items
      WHERE tenant_id = $1 AND part_id = $2 AND supplier_id = $3`,
    [
      tenantId,
      requireCanonicalPartId(partId, "supplier_catalog_items.part_id"),
      requireSupplierId(supplierId, "supplierId"),
    ],
  );
  return rows.length === 0 ? null : itemFromRow(rows[0]);
}

/** Every supplier item for one part, preferred first — the procurement read this table exists for. */
export async function listSupplierCatalogItemsForPart(
  pool: Pool,
  tenantId: string,
  partId: string,
): Promise<SupplierCatalogItemRecord[]> {
  const { rows } = await pool.query(
    `SELECT ${ITEM_COLUMNS} FROM ${SCHEMA}.supplier_catalog_items
      WHERE tenant_id = $1 AND part_id = $2
      ORDER BY preferred DESC, supplier_id`,
    [tenantId, requireCanonicalPartId(partId, "supplier_catalog_items.part_id")],
  );
  return rows.map(itemFromRow);
}

export async function setSupplierCatalogItemStatus(
  pool: Pool,
  tenantId: string,
  actorId: string,
  partId: string,
  supplierId: string,
  expectedVersion: number,
  status: SupplierItemStatus,
): Promise<SupplierCatalogItemRecord> {
  const canonicalPartId = requireCanonicalPartId(partId, "supplier_catalog_items.part_id");
  requireSupplierId(supplierId, "supplierId");
  if (!(SUPPLIER_ITEM_STATUSES as readonly string[]).includes(status)) {
    throw new SupplierCatalogRepositoryError("STATUS_INVALID", `status must be ${SUPPLIER_ITEM_STATUSES.join("/")}`);
  }

  // Deactivating the preferred item clears `preferred` in the SAME statement. The CHECK
  // (preferred implies ACTIVE) makes that mandatory rather than tidy: leaving the flag would be a
  // constraint violation, and clearing it in a second statement would leave a window where the
  // part has no preferred supplier for a reason nobody asked for.
  let rows: Record<string, unknown>[];
  try {
    ({ rows } = await pool.query(
      `UPDATE ${SCHEMA}.supplier_catalog_items
          SET status = $5,
              preferred = (preferred AND $6),
              version = version + 1, updated_at = now(), updated_by = $7
        WHERE tenant_id = $1 AND part_id = $2 AND supplier_id = $3 AND version = $4
        RETURNING ${ITEM_COLUMNS}`,
      // `staysActive` is passed as its own boolean rather than re-deducing $5: one placeholder
      // cannot be both the enum the column takes and the text a comparison would need.
      [tenantId, canonicalPartId, supplierId, expectedVersion, status, status === "ACTIVE", actorId],
    ));
  } catch (err) {
    return translate(err);
  }
  if (rows.length === 1) return itemFromRow(rows[0]);
  return itemConflict(pool, tenantId, canonicalPartId, supplierId, expectedVersion);
}

/**
 * Make one ACTIVE supplier item THE preferred one for its part, clearing whichever item held it.
 *
 * Both statements run in ONE transaction, and the partial unique index means the pair is not
 * merely convention: if a concurrent transaction set a different preferred item, this one fails on
 * the index rather than producing a part with two. That is the invariant that used to live only
 * inside partSupplierItems.ts's Firestore transaction.
 */
export async function setPreferredSupplier(
  pool: Pool,
  tenantId: string,
  actorId: string,
  partId: string,
  supplierId: string,
  expectedVersion: number,
): Promise<SupplierCatalogItemRecord> {
  const canonicalPartId = requireCanonicalPartId(partId, "supplier_catalog_items.part_id");
  requireSupplierId(supplierId, "supplierId");

  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    // Clear the incumbent first: the unique index is immediate, so setting before clearing would
    // conflict with a row this same transaction is about to release.
    await client.query(
      `UPDATE ${SCHEMA}.supplier_catalog_items
          SET preferred = FALSE, version = version + 1, updated_at = now(), updated_by = $4
        WHERE tenant_id = $1 AND part_id = $2 AND preferred AND supplier_id <> $3`,
      [tenantId, canonicalPartId, supplierId, actorId],
    );
    const { rows } = await client.query(
      `UPDATE ${SCHEMA}.supplier_catalog_items
          SET preferred = TRUE, version = version + 1, updated_at = now(), updated_by = $5
        WHERE tenant_id = $1 AND part_id = $2 AND supplier_id = $3 AND version = $4
          AND status = 'ACTIVE'
        RETURNING ${ITEM_COLUMNS}`,
      [tenantId, canonicalPartId, supplierId, expectedVersion, actorId],
    );
    if (rows.length !== 1) {
      await client.query("ROLLBACK");
      return itemConflict(pool, tenantId, canonicalPartId, supplierId, expectedVersion);
    }
    await client.query("COMMIT");
    return itemFromRow(rows[0]);
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* the original failure is the one that matters */ }
    return translate(err);
  } finally {
    client.release();
  }
}

/** Disambiguate a zero-row versioned write: absent, wrong version, or not ACTIVE. Never guessed. */
async function itemConflict(
  pool: Pool,
  tenantId: string,
  partId: string,
  supplierId: string,
  expectedVersion: number,
): Promise<never> {
  const current = await readSupplierCatalogItem(pool, tenantId, partId, supplierId);
  if (current === null) {
    throw new SupplierCatalogRepositoryError("ITEM_NOT_FOUND", "no supplier catalog item exists for that part and supplier");
  }
  if (current.version !== expectedVersion) {
    throw new SupplierCatalogRepositoryError("VERSION_CONFLICT", `expected version ${expectedVersion}, stored ${current.version}`);
  }
  throw new SupplierCatalogRepositoryError("ITEM_NOT_ACTIVE", "only an ACTIVE supplier item can be preferred");
}
