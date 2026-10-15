"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TruckLifecycleError = exports.TruckAlreadyLinkedError = exports.LocationAlreadyLinkedError = exports.TruckNotFoundError = exports.MobileLocationNotFoundError = exports.TruckFleetRepositoryError = exports.DEACTIVATED_STATUS = exports.TRUCK_STATUSES = exports.MOBILE = void 0;
exports.createMobileLocation = createMobileLocation;
exports.readMobileLocation = readMobileLocation;
exports.listMobileLocationsWithoutTruck = listMobileLocationsWithoutTruck;
exports.listMobileLocationsForCompany = listMobileLocationsForCompany;
exports.createTruck = createTruck;
exports.readTruck = readTruck;
exports.readTruckAtMobileLocation = readTruckAtMobileLocation;
exports.linkTruck = linkTruck;
exports.relinkTruck = relinkTruck;
exports.unlinkTruck = unlinkTruck;
exports.changeTruckStatus = changeTruckStatus;
const operatingCompanyCustody_js_1 = require("./operatingCompanyCustody.js");
const SCHEMA = "eos_ops";
/** The only location type either table may carry. Migration 008 CHECKs the same value. */
exports.MOBILE = "MOBILE";
/** `eos_ops.ops_truck_status`, mirroring functions/src/truckRegistry/types.ts:11-12. */
exports.TRUCK_STATUSES = ["ACTIVE", "IDLE", "OUT_OF_SERVICE"];
/** The terminal status. Reachable only together with active=false -- see `truck_out_of_service_is_inactive`. */
exports.DEACTIVATED_STATUS = "OUT_OF_SERVICE";
class TruckFleetRepositoryError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "TruckFleetRepositoryError";
    }
}
exports.TruckFleetRepositoryError = TruckFleetRepositoryError;
class MobileLocationNotFoundError extends TruckFleetRepositoryError {
    constructor(locationId) {
        super("LOCATION_NOT_FOUND", `no MOBILE location ${locationId} in this tenant`);
    }
}
exports.MobileLocationNotFoundError = MobileLocationNotFoundError;
class TruckNotFoundError extends TruckFleetRepositoryError {
    constructor(truckId) {
        super("TRUCK_NOT_FOUND", `no truck ${truckId} in this tenant`);
    }
}
exports.TruckNotFoundError = TruckNotFoundError;
class LocationAlreadyLinkedError extends TruckFleetRepositoryError {
    constructor(locationId) {
        super("LOCATION_ALREADY_LINKED", `MOBILE location ${locationId} is already linked to a truck`);
    }
}
exports.LocationAlreadyLinkedError = LocationAlreadyLinkedError;
class TruckAlreadyLinkedError extends TruckFleetRepositoryError {
    constructor(truckId) {
        super("TRUCK_ALREADY_LINKED", `truck ${truckId} is already linked to a MOBILE location`);
    }
}
exports.TruckAlreadyLinkedError = TruckAlreadyLinkedError;
class TruckLifecycleError extends TruckFleetRepositoryError {
    constructor(message) {
        super("TRUCK_LIFECYCLE", message);
    }
}
exports.TruckLifecycleError = TruckLifecycleError;
const nonEmpty = (value, field) => {
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
function requireLifecycleConsistent(status, active) {
    if ((status === exports.DEACTIVATED_STATUS) !== (active === false)) {
        throw new TruckLifecycleError(`status ${status} with active=${String(active)} is not a state the governed truck lifecycle can produce`);
    }
}
/** A checked-out client (it can be released) rather than a pool. */
const isCallerClient = (db) => typeof db?.release === "function";
async function inTransaction(pool, fn) {
    // A caller that already OWNS a transaction (the Administration registry operations, which append their audit row in the
    // same transaction -- Controller TRUCK INVENTORY ACTIVATION OD-T7) passes its client; the work joins that transaction.
    if (isCallerClient(pool))
        return fn(pool);
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
    }
    catch (error) {
        await client.query("ROLLBACK");
        throw error;
    }
    finally {
        client.release();
    }
}
function mobileLocationFromRow(row) {
    return {
        tenantId: row.tenant_id,
        location: { type: row.location_type, id: row.location_id },
        operatingCompanyKey: row.operating_company_key,
        displayLabel: row.display_label,
        active: row.active,
    };
}
function truckFromRow(row) {
    const locationId = row.mobile_location_id ?? null;
    return {
        tenantId: row.tenant_id,
        truckId: row.truck_id,
        vehicleNumber: row.vehicle_number,
        displayLabel: row.display_label,
        status: row.status,
        active: row.active,
        homeWarehouseId: row.home_warehouse_id,
        mobileLocation: locationId === null ? null : { type: row.mobile_location_type, id: locationId },
        operatingCompanyKey: row.operating_company_key ?? null,
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
async function createMobileLocation(pool, tenantId, actorId, input) {
    const locationId = nonEmpty(input.locationId, "locationId");
    const displayLabel = nonEmpty(input.displayLabel, "displayLabel");
    // Refused HERE as well as by the NOT NULL column, so no code path can quietly supply a placeholder.
    const operatingCompanyKey = (0, operatingCompanyCustody_js_1.requireOperatingCompanyKey)(input.operatingCompanyKey);
    const active = input.active ?? true;
    const { rows } = await pool.query(`INSERT INTO ${SCHEMA}.mobile_locations
       (tenant_id, location_type, location_id, operating_company_key, display_label, active, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
     RETURNING *`, [tenantId, exports.MOBILE, locationId, operatingCompanyKey, displayLabel, active, actorId]);
    return mobileLocationFromRow(rows[0]);
}
async function readMobileLocation(
// Pool OR an open transaction client, so a receipt can validate a MOBILE destination inside the
// transaction that writes it.
pool, tenantId, locationId) {
    const { rows } = await pool.query(`SELECT * FROM ${SCHEMA}.mobile_locations
      WHERE tenant_id = $1 AND location_type = $2 AND location_id = $3`, [tenantId, exports.MOBILE, locationId]);
    return rows.length === 0 ? null : mobileLocationFromRow(rows[0]);
}
/**
 * Every MOBILE location in this tenant that no truck is linked to.
 *
 * This is not a diagnostic: it is the shape the live data is actually in. 5 of the 7 sandbox
 * `mobile_locations` have no truck at all while carrying ledger references, and this read is how an
 * operator sees that set without inferring a truck for it.
 */
async function listMobileLocationsWithoutTruck(pool, tenantId) {
    const { rows } = await pool.query(`SELECT m.* FROM ${SCHEMA}.mobile_locations m
       LEFT JOIN ${SCHEMA}.trucks t
         ON t.tenant_id = m.tenant_id
        AND t.mobile_location_type = m.location_type
        AND t.mobile_location_id = m.location_id
      WHERE m.tenant_id = $1 AND t.truck_id IS NULL
      ORDER BY m.location_id`, [tenantId]);
    return rows.map(mobileLocationFromRow);
}
async function listMobileLocationsForCompany(pool, tenantId, operatingCompanyKey) {
    const { rows } = await pool.query(`SELECT * FROM ${SCHEMA}.mobile_locations
      WHERE tenant_id = $1 AND operating_company_key = $2
      ORDER BY location_id`, [tenantId, (0, operatingCompanyCustody_js_1.requireOperatingCompanyKey)(operatingCompanyKey)]);
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
async function createTruck(pool, tenantId, actorId, input) {
    const truckId = nonEmpty(input.truckId, "truckId");
    const vehicleNumber = nonEmpty(input.vehicleNumber, "vehicleNumber");
    const displayLabel = nonEmpty(input.displayLabel, "displayLabel");
    const homeWarehouseId = nonEmpty(input.homeWarehouseId, "homeWarehouseId");
    const status = input.status ?? "ACTIVE";
    const active = input.active ?? status !== exports.DEACTIVATED_STATUS;
    requireLifecycleConsistent(status, active);
    const mobileLocationId = input.mobileLocationId ?? null;
    return inTransaction(pool, async (client) => {
        try {
            await client.query(`INSERT INTO ${SCHEMA}.trucks
           (tenant_id, truck_id, vehicle_number, display_label, status, active,
            home_warehouse_id, mobile_location_type, mobile_location_id, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`, [
                tenantId, truckId, vehicleNumber, displayLabel, status, active,
                homeWarehouseId, mobileLocationId === null ? null : exports.MOBILE, mobileLocationId, actorId,
            ]);
        }
        catch (error) {
            throw translateLinkViolation(error, truckId, mobileLocationId);
        }
        const { rows } = await client.query(`${TRUCK_SELECT} WHERE t.tenant_id = $1 AND t.truck_id = $2`, [tenantId, truckId]);
        return truckFromRow(rows[0]);
    });
}
async function readTruck(pool, tenantId, truckId) {
    const { rows } = await pool.query(`${TRUCK_SELECT} WHERE t.tenant_id = $1 AND t.truck_id = $2`, [tenantId, truckId]);
    return rows.length === 0 ? null : truckFromRow(rows[0]);
}
/** The reciprocal read: which truck, if any, holds this MOBILE location. */
async function readTruckAtMobileLocation(pool, tenantId, locationId) {
    const { rows } = await pool.query(`${TRUCK_SELECT} WHERE t.tenant_id = $1 AND t.mobile_location_type = $2 AND t.mobile_location_id = $3`, [tenantId, exports.MOBILE, locationId]);
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
async function linkTruck(pool, tenantId, actorId, truckId, locationId) {
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
async function relinkTruck(pool, tenantId, actorId, truckId, locationId) {
    return setTruckLink(pool, tenantId, actorId, truckId, nonEmpty(locationId, "locationId"), {
        requireCurrentlyLinked: true,
    });
}
/** Detach a truck from its MOBILE location. The location survives, unlinked, with its company intact. */
async function unlinkTruck(pool, tenantId, actorId, truckId) {
    return setTruckLink(pool, tenantId, actorId, truckId, null, { requireCurrentlyLinked: true });
}
async function setTruckLink(pool, tenantId, actorId, truckId, locationId, options) {
    nonEmpty(truckId, "truckId");
    return inTransaction(pool, async (client) => {
        const current = await client.query(`SELECT mobile_location_id FROM ${SCHEMA}.trucks WHERE tenant_id = $1 AND truck_id = $2 FOR UPDATE`, [tenantId, truckId]);
        if (current.rows.length === 0)
            throw new TruckNotFoundError(truckId);
        const currentlyLinked = current.rows[0].mobile_location_id !== null;
        if (options.requireCurrentlyLinked && !currentlyLinked) {
            throw new TruckFleetRepositoryError("TRUCK_NOT_LINKED", `truck ${truckId} is not linked to a MOBILE location`);
        }
        if (!options.requireCurrentlyLinked && currentlyLinked)
            throw new TruckAlreadyLinkedError(truckId);
        try {
            await client.query(`UPDATE ${SCHEMA}.trucks
            SET mobile_location_type = $3, mobile_location_id = $4, updated_by = $5, updated_at = now()
          WHERE tenant_id = $1 AND truck_id = $2`, [tenantId, truckId, locationId === null ? null : exports.MOBILE, locationId, actorId]);
        }
        catch (error) {
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
async function changeTruckStatus(pool, tenantId, actorId, truckId, status) {
    if (status === exports.DEACTIVATED_STATUS) {
        throw new TruckLifecycleError(`${exports.DEACTIVATED_STATUS} is reachable only through the governed, inventory-guarded deactivation path`);
    }
    if (!exports.TRUCK_STATUSES.includes(status)) {
        throw new TruckFleetRepositoryError("INVALID_INPUT", `status must be one of ${exports.TRUCK_STATUSES.join("|")}`);
    }
    const { rows } = await pool.query(`UPDATE ${SCHEMA}.trucks
        SET status = $3, updated_by = $4, updated_at = now()
      WHERE tenant_id = $1 AND truck_id = $2 AND active = true
      RETURNING truck_id`, [tenantId, truckId, status, actorId]);
    if (rows.length === 0) {
        const existing = await readTruck(pool, tenantId, truckId);
        if (existing === null)
            throw new TruckNotFoundError(truckId);
        throw new TruckLifecycleError(`truck ${truckId} is deactivated; reactivate it before changing its status`);
    }
    return (await readTruck(pool, tenantId, truckId));
}
/**
 * Constraint violations -> named errors, so the reason survives the boundary instead of a constraint
 * name. `23505` is the partial unique index (another truck already holds that location) and `23503`
 * is the composite foreign key (no such MOBILE location in this tenant).
 */
function translateLinkViolation(error, truckId, locationId) {
    const code = error?.code;
    if (code === "23505" && locationId !== null)
        return new LocationAlreadyLinkedError(locationId);
    if (code === "23503" && locationId !== null)
        return new MobileLocationNotFoundError(locationId);
    void truckId;
    return error;
}
//# sourceMappingURL=truckFleetRepository.js.map