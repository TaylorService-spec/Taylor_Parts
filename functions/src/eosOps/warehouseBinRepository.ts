// The eos_ops WAREHOUSE / BIN location-authority repository — migration 008's write and read contract.
//
// ════════════════════ WHAT THIS IS, AND WHAT IT REPLACES ════════════════════
//
// Migration 005 recorded that Warehouses and Bins "remain FIRESTORE reference data in this tranche"
// and named the follow-on that would change it: "the reference-dependency migration ... happens
// together with importing that reference data, not before." Migration 008 is that migration, and
// this module is the writer that stops it being an unmaintained copy of anything.
//
// It is NOT wired to an HTTP operation and NOT called by the deployed client. That is deliberate and
// is the same boundary cycleCountRepository.ts states for itself: the authority, the contracts and
// the transaction boundaries land first; the cutover is a separate, authorized step.
//
// ════════════════════ R3 — IDENTITY IS THE TYPED PAIR, NEVER A BARE ID ════════════════════
//
// `resolveOpsLocation` is the only way this module hands out a location, and it takes
// `{ type, locationId }` together. A bare id is refused rather than guessed at, because
// `wh-phoenix` and a bin id are drawn from different namespaces whose only distinguishing fact is
// the type that accompanies them. It also refuses:
//
//   * a pair whose id does not exist under THAT type (a BIN id presented as a WAREHOUSE);
//   * MOBILE — the Truck/Mobile registry is separate reference data that migration 008 does not
//     import, so this layer answers "not an authority I hold" instead of inventing one.
//
// This is where the per-type referential rule lives until every arm of it can be a foreign key;
// migration 008's header says why a two-of-three FK was refused.
//
// ════════════════════ THE OPERATING COMPANY IS READ, NEVER INFERRED ════════════════════
//
// A Warehouse IS the company boundary root (ownership/ownershipMatrix.ts). `createWarehouse`
// therefore REQUIRES the governed key and refuses to manufacture one — the same contract migration
// 007 gives at the SQL boundary and `requireOperatingCompanyKey` gives in TypeScript.
//
// `createBin` REFUSES an `operatingCompanyKey` in its input rather than ignoring it. A bin's company
// is its warehouse's, and it is returned by reading the parent through the composite foreign key.
// Accepting one would let a caller state a company for a bin that disagrees with the warehouse it
// hangs off, and there would be no way afterwards to tell which was meant.
//
// ════════════════════ WHAT THIS MODULE DELIBERATELY CANNOT DO ════════════════════
//
// There is no method that changes a bin's `warehouse_id` (binRegistry.ts's `warehouse_not_movable`:
// moving a bin between warehouses moves every historical movement at it across a custody boundary).
// There is no delete of a warehouse, a bin, or a code claim — a claim is a permanent reservation,
// which is what stops a stale printed label ever resolving to a different shelf. And there is no
// quantity anywhere: balance is a derived read over `inventory_movements`, never a stored number.
// `test/eosOpsWarehouseBinAuthority.test.mjs` proves these absences from the source text, the same
// way migration 005's ledger contract is proved.
import type { Pool, PoolClient } from "pg";
import {
  BIN_STATUSES,
  DEFAULT_BIN_CODE_FORMAT,
  deriveBinId,
  formatBinCode,
  isSafeIdSegment,
  normalizeBinCode,
  type BinCodeFormatPolicy,
  type BinStatus,
} from "../inventoryLocation/binRegistry.js";
import {
  OperatingCompanyAuthorityError,
  requireOperatingCompanyKey,
  type OperatingCompanyKey,
  type OpsLocationType,
} from "./operatingCompanyCustody.js";

const SCHEMA = "eos_ops";

/** `eos_ops.ops_location_status`. Warehouses and bins share it: both are ACTIVE or INACTIVE. */
export const OPS_LOCATION_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type OpsLocationStatus = (typeof OPS_LOCATION_STATUSES)[number];

/** `eos_ops.ops_location_provenance`. Carried verbatim from the governed §3A warehouse record. */
export const OPS_LOCATION_PROVENANCES = ["NATIVE", "MIGRATED"] as const;
export type OpsLocationProvenance = (typeof OPS_LOCATION_PROVENANCES)[number];

/** `eos_ops.ops_bin_claim_state`. Neither state is ever released. */
export const OPS_BIN_CLAIM_STATES = ["HELD", "SUPERSEDED"] as const;
export type OpsBinClaimState = (typeof OPS_BIN_CLAIM_STATES)[number];

export class LocationAuthorityError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "LocationAuthorityError";
  }
}

/** R3. A location is a TYPE and an ID together; neither half identifies anything on its own. */
export interface OpsLocationRef {
  readonly type: OpsLocationType;
  readonly locationId: string;
}

export interface WarehouseRecord {
  readonly id: string;
  readonly tenantId: string;
  /** The company boundary. Stated at create, never derived from a name or a site label. */
  readonly operatingCompanyKey: OperatingCompanyKey;
  readonly name: string;
  /** Human site description ("Phoenix, AZ"). NOT a reference to another record. */
  readonly siteLabel: string;
  readonly status: OpsLocationStatus;
  readonly provenance: OpsLocationProvenance;
}

export interface BinRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly warehouseId: string;
  readonly area: string;
  readonly aisle: string;
  readonly bay: number;
  readonly position: number;
  /** DERIVED from the racking attributes by the injected formatter. Never an identity. */
  readonly code: string;
  readonly name: string | null;
  readonly status: OpsLocationStatus;
  readonly idempotencyKey: string;
}

/**
 * A resolved location: the typed pair, plus the two facts every caller of it actually needs — which
 * warehouse it rolls up to (ADR-014 Model A) and whose inventory authority that warehouse is.
 */
export interface ResolvedOpsLocation {
  readonly type: OpsLocationType;
  readonly locationId: string;
  /** For a WAREHOUSE this is the location itself; for a BIN it is its immutable parent. */
  readonly warehouseId: string;
  readonly operatingCompanyKey: OperatingCompanyKey;
  readonly status: OpsLocationStatus;
}

// ═══════════════════════════════════ shared guards ═══════════════════════════════════

function requireSafeSegment(value: unknown, what: string): string {
  if (!isSafeIdSegment(value)) {
    throw new LocationAuthorityError("ID_INVALID", `${what} is not a safe identity segment`);
  }
  return value;
}

function requireStatus(value: unknown): OpsLocationStatus {
  if (typeof value !== "string" || !(OPS_LOCATION_STATUSES as readonly string[]).includes(value)) {
    throw new LocationAuthorityError("STATUS_INVALID", "status must be ACTIVE or INACTIVE");
  }
  return value as OpsLocationStatus;
}

function requireNonBlank(value: unknown, what: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new LocationAuthorityError("FIELD_INVALID", `${what} is required`);
  }
  return value;
}

// The bin and warehouse status vocabularies are the same two labels in two modules. If one ever
// grows a third, this fails loudly at import rather than letting a bin be stored with a status the
// warehouse table cannot express.
const STATUS_VOCABULARIES_AGREE =
  BIN_STATUSES.length === OPS_LOCATION_STATUSES.length
  && BIN_STATUSES.every((s) => (OPS_LOCATION_STATUSES as readonly string[]).includes(s));
if (!STATUS_VOCABULARIES_AGREE) {
  throw new Error("BIN_STATUSES and OPS_LOCATION_STATUSES have diverged; eos_ops cannot store a bin status it has no label for");
}

// ═══════════════════════════════════ warehouses ═══════════════════════════════════

export interface WarehouseDraft {
  readonly warehouseId: string;
  /** MANDATORY. The Warehouse IS the company root, so this is stated here or the call fails. */
  readonly operatingCompanyKey: OperatingCompanyKey;
  readonly name: string;
  readonly siteLabel: string;
  readonly status: OpsLocationStatus;
  readonly provenance: OpsLocationProvenance;
}

export async function createWarehouse(
  pool: Pool,
  tenantId: string,
  actorId: string,
  draft: WarehouseDraft,
): Promise<WarehouseRecord> {
  const id = requireSafeSegment(draft.warehouseId, "warehouseId");
  // Refused HERE as well as by the NOT NULL column, so a caller that omitted it gets the reason
  // rather than a constraint name. `requireOperatingCompanyKey` throws its own typed error.
  const operatingCompanyKey = requireOperatingCompanyKey(draft.operatingCompanyKey);
  const name = requireNonBlank(draft.name, "name");
  const siteLabel = requireNonBlank(draft.siteLabel, "siteLabel");
  const status = requireStatus(draft.status);
  if (!(OPS_LOCATION_PROVENANCES as readonly string[]).includes(draft.provenance)) {
    throw new LocationAuthorityError("PROVENANCE_INVALID", "provenance must be NATIVE or MIGRATED");
  }

  await pool.query(
    `INSERT INTO ${SCHEMA}.warehouses
       (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
    [id, tenantId, operatingCompanyKey, name, siteLabel, status, draft.provenance, actorId],
  );
  return { id, tenantId, operatingCompanyKey, name, siteLabel, status, provenance: draft.provenance };
}

export async function readWarehouse(
  pool: Pool | PoolClient,
  tenantId: string,
  warehouseId: string,
): Promise<WarehouseRecord | null> {
  if (!isSafeIdSegment(warehouseId)) return null;
  const { rows } = await pool.query<{
    id: string; operating_company_key: string; name: string; site_label: string;
    status: OpsLocationStatus; provenance: OpsLocationProvenance;
  }>(
    `SELECT id, operating_company_key, name, site_label, status, provenance
       FROM ${SCHEMA}.warehouses WHERE tenant_id = $1 AND id = $2`,
    [tenantId, warehouseId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id, tenantId, operatingCompanyKey: row.operating_company_key,
    name: row.name, siteLabel: row.site_label, status: row.status, provenance: row.provenance,
  };
}

/**
 * ACTIVE <-> INACTIVE only. There is no method that moves a warehouse between operating companies:
 * the company is the boundary a warehouse's whole movement history was recorded under, and
 * reassigning it would silently restate who owned every past receipt.
 */
export async function setWarehouseStatus(
  pool: Pool,
  tenantId: string,
  actorId: string,
  warehouseId: string,
  status: OpsLocationStatus,
): Promise<WarehouseRecord> {
  const id = requireSafeSegment(warehouseId, "warehouseId");
  const next = requireStatus(status);
  const { rowCount } = await pool.query(
    `UPDATE ${SCHEMA}.warehouses SET status = $3, updated_by = $4, updated_at = now()
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id, next, actorId],
  );
  if (!rowCount) throw new LocationAuthorityError("WAREHOUSE_NOT_FOUND", "warehouse not found");
  const record = await readWarehouse(pool, tenantId, id);
  if (!record) throw new LocationAuthorityError("WAREHOUSE_NOT_FOUND", "warehouse disappeared after update");
  return record;
}

// ═══════════════════════════════════ bins ═══════════════════════════════════

/**
 * Everything a caller supplies to create a bin.
 *
 * There is no `binId` and no `code`: both are SERVER-DERIVED (`deriveBinId` from the nonce, the code
 * from the racking attributes through the injected formatter), and binRegistry.ts already refuses a
 * caller-supplied one rather than silently replacing it. There is no `operatingCompanyKey` either —
 * see the header.
 */
export interface BinDraft {
  readonly warehouseId: string;
  readonly area: string;
  readonly aisle: string;
  readonly bay: number;
  readonly position: number;
  readonly name?: string | null;
  readonly idempotencyKey: string;
}

function assertNoCompanyOnBin(draft: Record<string, unknown>): void {
  if (draft.operatingCompanyKey !== undefined) {
    throw new OperatingCompanyAuthorityError(
      "a bin never states its own operating company; it is the parent warehouse's and is read from there",
    );
  }
}

function normalizeRacking(draft: BinDraft, policy: BinCodeFormatPolicy): {
  area: string; aisle: string; bay: number; position: number; code: string;
} {
  const area = requireNonBlank(draft.area, "area").trim().replace(/\s+/g, "_").toUpperCase();
  const aisle = requireNonBlank(draft.aisle, "aisle").trim().replace(/\s+/g, "").toUpperCase();
  if (!Number.isInteger(draft.bay) || draft.bay < 0) throw new LocationAuthorityError("BAY_INVALID", "bay must be a non-negative integer");
  if (!Number.isInteger(draft.position) || draft.position < 0) throw new LocationAuthorityError("POSITION_INVALID", "position must be a non-negative integer");
  // ONE code-derivation authority. Reused from binRegistry.ts rather than restated, so a change of
  // formatter policy can never mean two different things in two persistence layers.
  const code = formatBinCode({ aisle, bay: draft.bay, position: draft.position }, policy);
  if (!code.valid) throw new LocationAuthorityError("CODE_INVALID", code.reason);
  return { area, aisle, bay: draft.bay, position: draft.position, code: code.value };
}

/**
 * Create a bin and reserve its code, in ONE transaction.
 *
 * The bin row and its HELD claim are a single fact expressed in two tables: a bin with no claim
 * would have a code nothing reserved, and a claim with no bin would reserve a code for nothing. A
 * crash between the two would produce exactly one of those, so they are never two round trips.
 */
export async function createBin(
  pool: Pool,
  tenantId: string,
  actorId: string,
  draft: BinDraft,
  policy: BinCodeFormatPolicy = DEFAULT_BIN_CODE_FORMAT,
): Promise<BinRecord> {
  assertNoCompanyOnBin(draft as unknown as Record<string, unknown>);
  const warehouseId = requireSafeSegment(draft.warehouseId, "warehouseId");
  const idempotencyKey = requireNonBlank(draft.idempotencyKey, "idempotencyKey");
  const racking = normalizeRacking(draft, policy);
  const id = deriveBinId(idempotencyKey);
  const name = draft.name === undefined || draft.name === null || draft.name.trim() === "" ? null : draft.name.trim();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Scope validation is not optional: a bin in a warehouse that does not exist is a place nobody
    // can go. The composite foreign key would refuse it anyway; this makes the refusal legible.
    const parent = await readWarehouse(client, tenantId, warehouseId);
    if (!parent) throw new LocationAuthorityError("WAREHOUSE_UNKNOWN", "parent warehouse does not exist");

    await client.query(
      `INSERT INTO ${SCHEMA}.bins
         (id, tenant_id, warehouse_id, area, aisle, bay, "position", code, name, status,
          idempotency_key, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ACTIVE', $10, $11, $11)`,
      [id, tenantId, warehouseId, racking.area, racking.aisle, racking.bay, racking.position,
       racking.code, name, idempotencyKey, actorId],
    );
    await client.query(
      `INSERT INTO ${SCHEMA}.bin_code_claims
         (tenant_id, warehouse_id, code, bin_id, claim_state, claimed_by)
       VALUES ($1, $2, $3, $4, 'HELD', $5)`,
      [tenantId, warehouseId, racking.code, id, actorId],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return {
    id, tenantId, warehouseId, area: racking.area, aisle: racking.aisle, bay: racking.bay,
    position: racking.position, code: racking.code, name, status: "ACTIVE", idempotencyKey,
  };
}

/**
 * Correct a mislabelled rack. The BIN ID DOES NOT CHANGE — that is the whole point of ruling O-3,
 * and it is why every movement ever recorded at this bin survives the correction.
 *
 * The old claim is marked SUPERSEDED and STAYS RESERVED to this same bin, permanently. Nothing
 * releases it, so a label still reading the old code can only ever resolve back here.
 *
 * The warehouse is not a parameter. A rename never moves a bin.
 */
export async function renameBin(
  pool: Pool,
  tenantId: string,
  actorId: string,
  binId: string,
  attrs: { readonly area: string; readonly aisle: string; readonly bay: number; readonly position: number; readonly name?: string | null },
  policy: BinCodeFormatPolicy = DEFAULT_BIN_CODE_FORMAT,
): Promise<BinRecord> {
  assertNoCompanyOnBin(attrs as unknown as Record<string, unknown>);
  if ((attrs as Record<string, unknown>).warehouseId !== undefined) {
    throw new LocationAuthorityError("WAREHOUSE_NOT_MOVABLE", "a bin's parent warehouse is immutable");
  }
  const id = requireSafeSegment(binId, "binId");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await selectBin(client, tenantId, id);
    if (!existing) throw new LocationAuthorityError("BIN_NOT_FOUND", "bin not found");
    const racking = normalizeRacking({ ...attrs, warehouseId: existing.warehouseId, idempotencyKey: existing.idempotencyKey }, policy);

    if (racking.code !== existing.code) {
      // The old claim is SUPERSEDED, never deleted, and never repointed.
      const superseded = await client.query(
        `UPDATE ${SCHEMA}.bin_code_claims
            SET claim_state = 'SUPERSEDED', superseded_at = now()
          WHERE tenant_id = $1 AND warehouse_id = $2 AND code = $3 AND bin_id = $4 AND claim_state = 'HELD'`,
        [tenantId, existing.warehouseId, existing.code, id],
      );
      if (superseded.rowCount !== 1) {
        // A rename's own claim is missing, points elsewhere, or is already superseded. Never
        // repaired: a bin whose reservation history cannot be read is not one to keep renaming.
        throw new LocationAuthorityError("CLAIM_INTEGRITY", "the bin's held code claim is missing or does not point at it");
      }
      await client.query(
        `INSERT INTO ${SCHEMA}.bin_code_claims
           (tenant_id, warehouse_id, code, bin_id, claim_state, claimed_by)
         VALUES ($1, $2, $3, $4, 'HELD', $5)`,
        [tenantId, existing.warehouseId, racking.code, id, actorId],
      );
    }

    const name = attrs.name === undefined ? existing.name
      : (attrs.name === null || attrs.name.trim() === "" ? null : attrs.name.trim());
    await client.query(
      `UPDATE ${SCHEMA}.bins
          SET area = $3, aisle = $4, bay = $5, "position" = $6, code = $7, name = $8,
              updated_by = $9, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, racking.area, racking.aisle, racking.bay, racking.position, racking.code, name, actorId],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  const result = await selectBin(pool, tenantId, id);
  if (!result) throw new LocationAuthorityError("BIN_NOT_FOUND", "bin disappeared after commit");
  return result;
}

export async function setBinStatus(
  pool: Pool,
  tenantId: string,
  actorId: string,
  binId: string,
  status: BinStatus,
): Promise<BinRecord> {
  const id = requireSafeSegment(binId, "binId");
  const next = requireStatus(status);
  const { rowCount } = await pool.query(
    `UPDATE ${SCHEMA}.bins SET status = $3, updated_by = $4, updated_at = now()
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id, next, actorId],
  );
  if (!rowCount) throw new LocationAuthorityError("BIN_NOT_FOUND", "bin not found");
  const record = await selectBin(pool, tenantId, id);
  if (!record) throw new LocationAuthorityError("BIN_NOT_FOUND", "bin disappeared after update");
  return record;
}

async function selectBin(pool: Pool | PoolClient, tenantId: string, binId: string): Promise<BinRecord | null> {
  const { rows } = await pool.query<{
    id: string; warehouse_id: string; area: string; aisle: string; bay: number; position: number;
    code: string; name: string | null; status: OpsLocationStatus; idempotency_key: string;
  }>(
    `SELECT id, warehouse_id, area, aisle, bay, "position", code, name, status, idempotency_key
       FROM ${SCHEMA}.bins WHERE tenant_id = $1 AND id = $2`,
    [tenantId, binId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id, tenantId, warehouseId: row.warehouse_id, area: row.area, aisle: row.aisle,
    bay: row.bay, position: row.position, code: row.code, name: row.name, status: row.status,
    idempotencyKey: row.idempotency_key,
  };
}

export async function readBin(pool: Pool, tenantId: string, binId: string): Promise<BinRecord | null> {
  if (!isSafeIdSegment(binId)) return null;
  return selectBin(pool, tenantId, binId);
}

export const BIN_LIST_LIMIT = 500;

/** The warehouse -> bin hierarchy, read through the foreign key rather than by parsing a code. */
export async function listBinsForWarehouse(
  pool: Pool,
  tenantId: string,
  warehouseId: string,
  limit: number = BIN_LIST_LIMIT,
): Promise<readonly BinRecord[]> {
  if (!isSafeIdSegment(warehouseId)) return [];
  const bounded = Math.min(Math.max(1, Math.trunc(limit)), BIN_LIST_LIMIT);
  const { rows } = await pool.query<{
    id: string; warehouse_id: string; area: string; aisle: string; bay: number; position: number;
    code: string; name: string | null; status: OpsLocationStatus; idempotency_key: string;
  }>(
    `SELECT id, warehouse_id, area, aisle, bay, "position", code, name, status, idempotency_key
       FROM ${SCHEMA}.bins WHERE tenant_id = $1 AND warehouse_id = $2
      ORDER BY area, aisle, bay, "position" LIMIT $3`,
    [tenantId, warehouseId, bounded],
  );
  return rows.map((row) => ({
    id: row.id, tenantId, warehouseId: row.warehouse_id, area: row.area, aisle: row.aisle,
    bay: row.bay, position: row.position, code: row.code, name: row.name, status: row.status,
    idempotencyKey: row.idempotency_key,
  }));
}

// ═══════════════════════════════════ code resolution ═══════════════════════════════════

export type BinCodeLookup =
  | { readonly result: "FOUND"; readonly binId: string; readonly code: string }
  | { readonly result: "FOUND_SUPERSEDED_CODE"; readonly binId: string; readonly code: string; readonly supersededCode: string }
  | { readonly result: "NOT_FOUND" }
  | { readonly result: "MALFORMED"; readonly detail: string };

/**
 * Resolve a scanned or typed code WITHIN ONE WAREHOUSE.
 *
 * There is deliberately no WRONG_WAREHOUSE answer: the lookup is scoped to the warehouse the caller
 * named, so it cannot observe that another warehouse holds the same code and must not pretend to
 * (ruling O-7). A SUPERSEDED code resolves to its original bin and reports that bin's CURRENT code,
 * so an operator can be told the label is out of date.
 */
export async function resolveBinCode(
  pool: Pool,
  tenantId: string,
  warehouseId: string,
  rawCode: unknown,
): Promise<BinCodeLookup> {
  if (!isSafeIdSegment(warehouseId)) return { result: "MALFORMED", detail: "warehouse_invalid" };
  const normalized = normalizeBinCode(rawCode);
  if (!normalized.valid) return { result: "MALFORMED", detail: normalized.reason };
  const { rows } = await pool.query<{ bin_id: string; claim_state: OpsBinClaimState; current_code: string }>(
    `SELECT c.bin_id, c.claim_state, b.code AS current_code
       FROM ${SCHEMA}.bin_code_claims c
       JOIN ${SCHEMA}.bins b ON b.tenant_id = c.tenant_id AND b.id = c.bin_id
      WHERE c.tenant_id = $1 AND c.warehouse_id = $2 AND c.code = $3`,
    [tenantId, warehouseId, normalized.value.code],
  );
  const row = rows[0];
  if (!row) return { result: "NOT_FOUND" };
  if (row.claim_state === "SUPERSEDED") {
    return { result: "FOUND_SUPERSEDED_CODE", binId: row.bin_id, code: row.current_code, supersededCode: normalized.value.code };
  }
  return { result: "FOUND", binId: row.bin_id, code: row.current_code };
}

// ═══════════════════════════════════ the typed pair (R3) ═══════════════════════════════════

/**
 * Resolve `{ location_type, location_id }` against the location authority.
 *
 * THIS IS THE ONLY WAY THIS MODULE HANDS OUT A LOCATION, and it never takes a bare id. Returns the
 * warehouse the location rolls up to (for a BIN, its immutable parent — ADR-014 Model A) and the
 * operating company that warehouse belongs to, READ rather than inferred.
 *
 * MOBILE is refused with its own code, not collapsed into "not found": the Truck/Mobile registry is
 * reference data migration 008 does not import, and the honest answer is "this layer is not its
 * authority yet" rather than "there is no such truck".
 */
export async function resolveOpsLocation(
  pool: Pool,
  tenantId: string,
  ref: OpsLocationRef,
): Promise<ResolvedOpsLocation> {
  if (!ref || typeof ref !== "object") {
    throw new LocationAuthorityError("LOCATION_REF_INVALID", "a location is a { type, locationId } pair");
  }
  if (ref.type === "MOBILE") {
    throw new LocationAuthorityError(
      "LOCATION_TYPE_NOT_IN_POSTGRES",
      "MOBILE location reference data is not held by eos_ops; resolve it through the Truck/Mobile registry",
    );
  }
  if (ref.type !== "WAREHOUSE" && ref.type !== "BIN") {
    throw new LocationAuthorityError("LOCATION_TYPE_INVALID", "location type must be WAREHOUSE, BIN or MOBILE");
  }
  const locationId = requireSafeSegment(ref.locationId, "locationId");

  if (ref.type === "WAREHOUSE") {
    const warehouse = await readWarehouse(pool, tenantId, locationId);
    // A BIN id presented as a WAREHOUSE lands here and is NOT FOUND, because the namespaces are
    // separate tables. The type is what decides which one is consulted -- that is R3 working.
    if (!warehouse) throw new LocationAuthorityError("LOCATION_NOT_FOUND", "no warehouse with that id");
    return {
      type: "WAREHOUSE", locationId, warehouseId: warehouse.id,
      operatingCompanyKey: warehouse.operatingCompanyKey, status: warehouse.status,
    };
  }

  const { rows } = await pool.query<{ bin_status: OpsLocationStatus; warehouse_id: string; operating_company_key: string }>(
    `SELECT b.status AS bin_status, b.warehouse_id, w.operating_company_key
       FROM ${SCHEMA}.bins b
       JOIN ${SCHEMA}.warehouses w ON w.tenant_id = b.tenant_id AND w.id = b.warehouse_id
      WHERE b.tenant_id = $1 AND b.id = $2`,
    [tenantId, locationId],
  );
  const row = rows[0];
  if (!row) throw new LocationAuthorityError("LOCATION_NOT_FOUND", "no bin with that id");
  return {
    type: "BIN", locationId, warehouseId: row.warehouse_id,
    operatingCompanyKey: row.operating_company_key, status: row.bin_status,
  };
}
