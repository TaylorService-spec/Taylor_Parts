// The eos_ops TRUCK / MOBILE-LOCATION repository — the schema and transaction boundary for
// migration 008's two registries and the 1:1 relationship between them.
//
// ════════════════════ WHAT THIS PROVES, AND WHAT IT DOES NOT ════════════════════
//
// Same posture as cycleCountRepository.ts: this is the REPOSITORY CONTRACT, not a cutover. It is not
// wired to any HTTP operation, the deployed client does not call it, and the Firestore Truck
// Registry (functions/src/truckRegistry/) stays authoritative until a separately authorized import
// runs. What it establishes is the boundary a governed command will sit on top of, and the set of
// operations that are POSSIBLE against these tables -- which is deliberately smaller than "whatever
// SQL allows".
//
// ════════════════════ IDENTITY IS NOT MUTABLE HERE, BY CONSTRUCTION ════════════════════
//
// There is no `renameTruck`, no `changeMobileLocationId`, and no update path that touches
// `truck_id`, `location_type` or `location_id`. Both are already referenced by operational ledger
// evidence keyed on the id; rewriting one would break the only link between a movement and the place
// it happened. A caller cannot ask for it, because the function does not exist -- the same way
// cycleCountRepository.ts offers no update or delete for `inventory_movements`.
//
// ════════════════════ REASSIGNMENT IS A RELATIONSHIP CHANGE, NEVER AN IDENTITY CHANGE ════════════════════
//
// `relinkTruck` writes exactly two nullable columns on the truck row. It never writes an id on
// either side, so moving a truck from one MOBILE location to another leaves both records the same
// records they were. This is the truck side of the relationship only: the DRIVER assignment is a
// different relationship whose other end is Employee identity, it has no column in migration 008,
// and nothing in this module touches it.
//
// No assignment history is recorded, because none exists to record: the Firestore commands overwrite
// the current link and keep only an Audit Event summary, so a history table here would be a second
// authority for a question nothing can answer.
//
// ════════════════════ THE 1:1 IS THE DATABASE'S JOB NOW ════════════════════
//
// Firestore needed a `location_truck_claims/{locationId}` guard document because it cannot express
// cross-document uniqueness (functions/src/truckRegistry/types.ts:7-9). Migration 008 expresses it
// as a partial UNIQUE index plus a composite foreign key, so there is no claim to maintain and this
// module has no concept of one. `linkTruck` and `relinkTruck` still run inside a single
// BEGIN/COMMIT: the constraint is what makes a concurrent second link fail, and the transaction is
// what makes the failure leave nothing behind.
//
// The link functions translate the two constraint violations into named errors
// (LOCATION_ALREADY_LINKED / LOCATION_NOT_FOUND) rather than letting a constraint name reach the
// caller, so the reason survives the boundary the way the Firestore service's sanitized taxonomy
// already does.
//
// ════════════════════ OPERATING COMPANY: STATED FOR A LOCATION, JOINED FOR A TRUCK ════════════════════
//
// `createMobileLocation` REFUSES a missing company key before it reaches the NOT NULL column, so a
// caller that never decided one gets the reason instead of a constraint name -- the same contract
// `createSheet` gives in cycleCountRepository.ts. It is never defaulted and never derived; in
// particular no function here accepts a warehouse id for any purpose.
//
// `readTruck` returns the linked location's `operatingCompanyKey` when the truck is linked, and null
// when it is not. That is a JOIN to the one authoritative statement, not an inference: the fact is
// stated once, on the location that holds the stock, and read from there. An unlinked truck holds no
// stock, so the honest answer is that it has no operating company of its own -- which is why the
// field is nullable rather than filled in from somewhere.
import type { Pool, PoolClient } from "pg";
import {
  type OperatingCompanyKey,
  type OpsLocationType,
  requireOperatingCompanyKey,
} from "./operatingCompanyCustody.js";

export {
  type OperatingCompanyKey,
  type OpsLocationType,
} from "./operatingCompanyCustody.js";

const SCHEMA = "eos_ops";

/** The only location type either table may carry. Migration 008 CHECKs the same value. */
export const MOBILE: OpsLocationType = "MOBILE";

/** `eos_ops.ops_truck_status`, mirroring functions/src/truckRegistry/types.ts:11-12. */
export const TRUCK_STATUSES = ["ACTIVE", "IDLE", "OUT_OF_SERVICE"] as const;
export type TruckStatus = (typeof TRUCK_STATUSES)[number];

/** The terminal status. Reachable only together with active=false -- see `truck_out_of_service_is_inactive`. */
export const DEACTIVATED_STATUS: TruckStatus = "OUT_OF_SERVICE";

export class TruckFleetRepositoryError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "TruckFleetRepositoryError";
  }
}
export class MobileLocationNotFoundError extends TruckFleetRepositoryError {
  constructor(locationId: string) {
    super("LOCATION_NOT_FOUND", `no MOBILE location ${locationId} in this tenant`);
  }
}
export class TruckNotFoundError extends TruckFleetRepositoryError {
  constructor(truckId: string) {
    super("TRUCK_NOT_FOUND", `no truck ${truckId} in this tenant`);
  }
}
export class LocationAlreadyLinkedError extends TruckFleetRepositoryError {
  constructor(locationId: string) {
    super("LOCATION_ALREADY_LINKED", `MOBILE location ${locationId} is already linked to a truck`);
  }
}
export class TruckAlreadyLinkedError extends TruckFleetRepositoryError {
  constructor(truckId: string) {
    super("TRUCK_ALREADY_LINKED", `truck ${truckId} is already linked to a MOBILE location`);
  }
}
export class TruckLifecycleError extends TruckFleetRepositoryError {
  constructor(message: string) {
    super("TRUCK_LIFECYCLE", message);
  }
}

/** The typed pair that IS a location's identity (R3). Never an id on its own. */
export interface MobileLocationRef {
  readonly type: OpsLocationType;
  readonly id: string;
}

export interface MobileLocationRecord {
  readonly tenantId: string;
  readonly location: MobileLocationRef;
  /** MANDATORY authority. Stated by the caller from authored configuration; never inferred. */
  readonly operatingCompanyKey: OperatingCompanyKey;
  readonly displayLabel: string;
  readonly active: boolean;
}

export interface TruckRecord {
  readonly tenantId: string;
  readonly truckId: string;
  readonly vehicleNumber: string;
  readonly displayLabel: string;
  readonly status: TruckStatus;
  readonly active: boolean;
  /** Descriptive only. Where the truck is based. Never an input to a company answer. */
  readonly homeWarehouseId: string;
  /** The 1:1 link, or null for a truck no MOBILE location has been attached to yet. */
  readonly mobileLocation: MobileLocationRef | null;
  /**
   * The linked location's stated company, or null when unlinked. Read from the location row -- the
   * single place the fact is stated -- never computed here.
   */
  readonly operatingCompanyKey: OperatingCompanyKey | null;
}

export interface CreateMobileLocationInput {
  readonly locationId: string;
  readonly operatingCompanyKey: OperatingCompanyKey;
  readonly displayLabel: string;
  readonly active?: boolean;
}

export interface CreateTruckInput {
  readonly truckId: string;
  readonly vehicleNumber: string;
  readonly displayLabel: string;
  readonly homeWarehouseId: string;
  readonly status?: TruckStatus;
  readonly active?: boolean;
  /** Optional at creation: the live registries are unlinked for 5 of 7 MOBILE locations. */
  readonly mobileLocationId?: string | null;
}

const nonEmpty = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TruckFleetRepositoryError("INVALID_INPUT", `${field} is required and must be a non-empty string`);
  }
  return value;
};

/**
 * The governed lifecycle biconditional, checked before the INSERT so a caller gets the reason rather
 * than `truck_out_of_service_is_inactive`. Mirrors truckRegistryCommands.ts:339-381, where
 * deactivate sets OUT_OF_SERVICE + active=false together and reactivate sets ACTIVE|IDLE +
 * active=true together.
 */
function requireLifecycleConsistent(status: TruckStatus, active: boolean): void {
  if ((status === DEACTIVATED_STATUS) !== (active === false)) {
    throw new TruckLifecycleError(
      `status ${status} with active=${String(active)} is not a state the governed truck lifecycle can produce`,
    );
  }
}

async function inTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function mobileLocationFromRow(row: Record<string, unknown>): MobileLocationRecord {
  return {
    tenantId: row.tenant_id as string,
    location: { type: row.location_type as OpsLocationType, id: row.location_id as string },
    operatingCompanyKey: row.operating_company_key as string,
    displayLabel: row.display_label as string,
    active: row.active as boolean,
  };
}

function truckFromRow(row: Record<string, unknown>): TruckRecord {
  const locationId = (row.mobile_location_id as string | null) ?? null;
  return {
    tenantId: row.tenant_id as string,
    truckId: row.truck_id as string,
    vehicleNumber: row.vehicle_number as string,
    displayLabel: row.display_label as string,
    status: row.status as TruckStatus,
    active: row.active as boolean,
    homeWarehouseId: row.home_warehouse_id as string,
    mobileLocation:
      locationId === null ? null : { type: row.mobile_location_type as OpsLocationType, id: locationId },
    operatingCompanyKey: (row.operating_company_key as string | null) ?? null,
  };
}

// ---------------------------------------------------------------------------------------------
// MOBILE locations
// ---------------------------------------------------------------------------------------------

/**
 * Create one MOBILE inventory location.
 *
 * `locationId` is carried VERBATIM -- operator-typed free text, already referenced by ledger
 * evidence. Nothing here normalizes, prefixes or generates it.
 */
export async function createMobileLocation(
  pool: Pool,
  tenantId: string,
  actorId: string,
  input: CreateMobileLocationInput,
): Promise<MobileLocationRecord> {
  const locationId = nonEmpty(input.locationId, "locationId");
  const displayLabel = nonEmpty(input.displayLabel, "displayLabel");
  // Refused HERE as well as by the NOT NULL column, so no code path can quietly supply a placeholder.
  const operatingCompanyKey = requireOperatingCompanyKey(input.operatingCompanyKey);
  const active = input.active ?? true;

  const { rows } = await pool.query(
    `INSERT INTO ${SCHEMA}.mobile_locations
       (tenant_id, location_type, location_id, operating_company_key, display_label, active, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
     RETURNING *`,
    [tenantId, MOBILE, locationId, operatingCompanyKey, displayLabel, active, actorId],
  );
  return mobileLocationFromRow(rows[0]);
}

export async function readMobileLocation(
  pool: Pool,
  tenantId: string,
  locationId: string,
): Promise<MobileLocationRecord | null> {
  const { rows } = await pool.query(
    `SELECT * FROM ${SCHEMA}.mobile_locations
      WHERE tenant_id = $1 AND location_type = $2 AND location_id = $3`,
    [tenantId, MOBILE, locationId],
  );
  return rows.length === 0 ? null : mobileLocationFromRow(rows[0]);
}

/**
 * Every MOBILE location in this tenant that no truck is linked to.
 *
 * This is not a diagnostic: it is the shape the live data is actually in. 5 of the 7 sandbox
 * `mobile_locations` have no truck at all while carrying ledger references, and this read is how an
 * operator sees that set without inferring a truck for it.
 */
export async function listMobileLocationsWithoutTruck(
  pool: Pool,
  tenantId: string,
): Promise<readonly MobileLocationRecord[]> {
  const { rows } = await pool.query(
    `SELECT m.* FROM ${SCHEMA}.mobile_locations m
       LEFT JOIN ${SCHEMA}.trucks t
         ON t.tenant_id = m.tenant_id
        AND t.mobile_location_type = m.location_type
        AND t.mobile_location_id = m.location_id
      WHERE m.tenant_id = $1 AND t.truck_id IS NULL
      ORDER BY m.location_id`,
    [tenantId],
  );
  return rows.map(mobileLocationFromRow);
}

export async function listMobileLocationsForCompany(
  pool: Pool,
  tenantId: string,
  operatingCompanyKey: OperatingCompanyKey,
): Promise<readonly MobileLocationRecord[]> {
  const { rows } = await pool.query(
    `SELECT * FROM ${SCHEMA}.mobile_locations
      WHERE tenant_id = $1 AND operating_company_key = $2
      ORDER BY location_id`,
    [tenantId, requireOperatingCompanyKey(operatingCompanyKey)],
  );
  return rows.map(mobileLocationFromRow);
}

// ---------------------------------------------------------------------------------------------
// Trucks
// ---------------------------------------------------------------------------------------------

const TRUCK_SELECT = `
  SELECT t.*, m.operating_company_key
    FROM ${SCHEMA}.trucks t
    LEFT JOIN ${SCHEMA}.mobile_locations m
      ON m.tenant_id = t.tenant_id
     AND m.location_type = t.mobile_location_type
     AND m.location_id = t.mobile_location_id`;

/**
 * Create one truck, optionally linked to an existing MOBILE location, in ONE transaction.
 *
 * The link is optional because the source data says so, not as a convenience -- see
 * `listMobileLocationsWithoutTruck`. When a link is requested, the composite foreign key proves the
 * location exists and the partial unique index proves no other truck holds it; both are translated
 * into named errors below.
 */
export async function createTruck(
  pool: Pool,
  tenantId: string,
  actorId: string,
  input: CreateTruckInput,
): Promise<TruckRecord> {
  const truckId = nonEmpty(input.truckId, "truckId");
  const vehicleNumber = nonEmpty(input.vehicleNumber, "vehicleNumber");
  const displayLabel = nonEmpty(input.displayLabel, "displayLabel");
  const homeWarehouseId = nonEmpty(input.homeWarehouseId, "homeWarehouseId");
  const status = input.status ?? "ACTIVE";
  const active = input.active ?? status !== DEACTIVATED_STATUS;
  requireLifecycleConsistent(status, active);
  const mobileLocationId = input.mobileLocationId ?? null;

  return inTransaction(pool, async (client) => {
    try {
      await client.query(
        `INSERT INTO ${SCHEMA}.trucks
           (tenant_id, truck_id, vehicle_number, display_label, status, active,
            home_warehouse_id, mobile_location_type, mobile_location_id, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
        [
          tenantId, truckId, vehicleNumber, displayLabel, status, active,
          homeWarehouseId, mobileLocationId === null ? null : MOBILE, mobileLocationId, actorId,
        ],
      );
    } catch (error) {
      throw translateLinkViolation(error, truckId, mobileLocationId);
    }
    const { rows } = await client.query(`${TRUCK_SELECT} WHERE t.tenant_id = $1 AND t.truck_id = $2`, [tenantId, truckId]);
    return truckFromRow(rows[0]);
  });
}

export async function readTruck(pool: Pool, tenantId: string, truckId: string): Promise<TruckRecord | null> {
  const { rows } = await pool.query(`${TRUCK_SELECT} WHERE t.tenant_id = $1 AND t.truck_id = $2`, [tenantId, truckId]);
  return rows.length === 0 ? null : truckFromRow(rows[0]);
}

/** The reciprocal read: which truck, if any, holds this MOBILE location. */
export async function readTruckAtMobileLocation(
  pool: Pool,
  tenantId: string,
  locationId: string,
): Promise<TruckRecord | null> {
  const { rows } = await pool.query(
    `${TRUCK_SELECT} WHERE t.tenant_id = $1 AND t.mobile_location_type = $2 AND t.mobile_location_id = $3`,
    [tenantId, MOBILE, locationId],
  );
  return rows.length === 0 ? null : truckFromRow(rows[0]);
}

/**
 * Attach a MOBILE location to a truck that has none.
 *
 * Refuses a truck that is already linked, rather than silently moving it -- moving is `relinkTruck`,
 * which is a different, explicit operation. One transaction: the UPDATE's WHERE clause holds the
 * "currently unlinked" precondition and the unique index holds the "location is free" one, so a
 * concurrent second call fails instead of racing.
 */
export async function linkTruck(
  pool: Pool,
  tenantId: string,
  actorId: string,
  truckId: string,
  locationId: string,
): Promise<TruckRecord> {
  return setTruckLink(pool, tenantId, actorId, truckId, nonEmpty(locationId, "locationId"), {
    requireCurrentlyLinked: false,
  });
}

/**
 * Move a truck from one MOBILE location to another.
 *
 * CHANGES THE RELATIONSHIP, NEVER THE IDENTITY: the statement writes `mobile_location_type` and
 * `mobile_location_id` and nothing else. `truck_id` is part of the primary key and is not in the SET
 * list; the location's own `location_id` belongs to another row entirely and is never touched.
 */
export async function relinkTruck(
  pool: Pool,
  tenantId: string,
  actorId: string,
  truckId: string,
  locationId: string,
): Promise<TruckRecord> {
  return setTruckLink(pool, tenantId, actorId, truckId, nonEmpty(locationId, "locationId"), {
    requireCurrentlyLinked: true,
  });
}

/** Detach a truck from its MOBILE location. The location survives, unlinked, with its company intact. */
export async function unlinkTruck(
  pool: Pool,
  tenantId: string,
  actorId: string,
  truckId: string,
): Promise<TruckRecord> {
  return setTruckLink(pool, tenantId, actorId, truckId, null, { requireCurrentlyLinked: true });
}

async function setTruckLink(
  pool: Pool,
  tenantId: string,
  actorId: string,
  truckId: string,
  locationId: string | null,
  options: { readonly requireCurrentlyLinked: boolean },
): Promise<TruckRecord> {
  nonEmpty(truckId, "truckId");
  return inTransaction(pool, async (client) => {
    const current = await client.query(
      `SELECT mobile_location_id FROM ${SCHEMA}.trucks WHERE tenant_id = $1 AND truck_id = $2 FOR UPDATE`,
      [tenantId, truckId],
    );
    if (current.rows.length === 0) throw new TruckNotFoundError(truckId);
    const currentlyLinked = current.rows[0].mobile_location_id !== null;
    if (options.requireCurrentlyLinked && !currentlyLinked) {
      throw new TruckFleetRepositoryError("TRUCK_NOT_LINKED", `truck ${truckId} is not linked to a MOBILE location`);
    }
    if (!options.requireCurrentlyLinked && currentlyLinked) throw new TruckAlreadyLinkedError(truckId);

    try {
      await client.query(
        `UPDATE ${SCHEMA}.trucks
            SET mobile_location_type = $3, mobile_location_id = $4, updated_by = $5, updated_at = now()
          WHERE tenant_id = $1 AND truck_id = $2`,
        [tenantId, truckId, locationId === null ? null : MOBILE, locationId, actorId],
      );
    } catch (error) {
      throw translateLinkViolation(error, truckId, locationId);
    }
    const { rows } = await client.query(`${TRUCK_SELECT} WHERE t.tenant_id = $1 AND t.truck_id = $2`, [tenantId, truckId]);
    return truckFromRow(rows[0]);
  });
}

/**
 * Change a truck's descriptive status.
 *
 * Refuses the terminal OUT_OF_SERVICE outright, the same way `changeStatus` does in the Firestore
 * service (validation.ts:57-63: that state is reachable only through the governed, inventory-guarded
 * deactivation path, which also flips `active`). Deactivation is not implemented here because the
 * governed inventory-presence predicate it must run first lives on the Firestore side today; adding
 * a deactivate that skipped the predicate would be a weaker version of an existing guarded command.
 */
export async function changeTruckStatus(
  pool: Pool,
  tenantId: string,
  actorId: string,
  truckId: string,
  status: TruckStatus,
): Promise<TruckRecord> {
  if (status === DEACTIVATED_STATUS) {
    throw new TruckLifecycleError(
      `${DEACTIVATED_STATUS} is reachable only through the governed, inventory-guarded deactivation path`,
    );
  }
  if (!(TRUCK_STATUSES as readonly string[]).includes(status)) {
    throw new TruckFleetRepositoryError("INVALID_INPUT", `status must be one of ${TRUCK_STATUSES.join("|")}`);
  }
  const { rows } = await pool.query(
    `UPDATE ${SCHEMA}.trucks
        SET status = $3, updated_by = $4, updated_at = now()
      WHERE tenant_id = $1 AND truck_id = $2 AND active = true
      RETURNING truck_id`,
    [tenantId, truckId, status, actorId],
  );
  if (rows.length === 0) {
    const existing = await readTruck(pool, tenantId, truckId);
    if (existing === null) throw new TruckNotFoundError(truckId);
    throw new TruckLifecycleError(`truck ${truckId} is deactivated; reactivate it before changing its status`);
  }
  return (await readTruck(pool, tenantId, truckId)) as TruckRecord;
}

/**
 * Constraint violations -> named errors, so the reason survives the boundary instead of a constraint
 * name. `23505` is the partial unique index (another truck already holds that location) and `23503`
 * is the composite foreign key (no such MOBILE location in this tenant).
 */
function translateLinkViolation(error: unknown, truckId: string, locationId: string | null): unknown {
  const code = (error as { code?: string } | null)?.code;
  if (code === "23505" && locationId !== null) return new LocationAlreadyLinkedError(locationId);
  if (code === "23503" && locationId !== null) return new MobileLocationNotFoundError(locationId);
  void truckId;
  return error;
}
