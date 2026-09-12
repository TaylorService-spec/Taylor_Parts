// eos_ops Equipment — the installed register, the model catalog, and the one command that turns
// company-held serialized stock into a customer's machine.
//
// ════════════════════ WHAT THIS IS, AND WHAT IT IS NOT ════════════════════
//
// The same standing as cycleCountRepository.ts: a REPOSITORY and transaction boundary against the
// eos_ops schema. It is not wired to an HTTP operation, no client calls it, and nothing is cut over
// -- see docs/design/eos-operational-data-plane-inventory-authority-cutover.md. What it does own is
// the boundary: every governed fact about installation is asserted here or by the schema, never
// left to a caller to remember.
//
// It does NOT replace functions/src/equipmentInstall/installSerializedAssetCommand.ts. That command
// is the deployed Firestore writer and is untouched. This is the same act expressed against the
// target authority, and the two are kept honest by the same contract, not by shared code -- there
// is no monorepo path from a Firestore command to a Postgres repository, and inventing one would
// couple the thing being retired to the thing replacing it.
//
// ════════════════════ THE TWO LOCATION NAMESPACES ARE TWO TYPES HERE ════════════════════
//
// `equipment.locationId` in Firestore is a CRM customer site id and shares its field name with the
// inventory location id on entirely unrelated records (the P1B census measured 290/290 resolving
// into `locations` and 0/290 into any inventory registry). A shared field name is exactly how the
// two namespaces get unioned by a migration nobody reviewed closely enough.
//
// So a customer site is `CustomerLocationRef` and an inventory location is `LocationRef` /
// `CustodyLocationRef`, and the two are NOT structurally assignable in either direction -- each
// carries a distinct literal `namespace` discriminator, so TypeScript refuses the swap at the call
// site rather than at code review. The schema does the other half: the column is
// `customer_location_id`, is not typed with either location enum, and `equipment` has no
// `location_type` column at all.
//
// ════════════════════ WHY INSTALLATION WRITES NO LEDGER ROW ════════════════════
//
// ADR-010 §3 describes installation as appending a governed CONSUMED effect "from the customer
// Location". That sentence predates migration 007's ruling and cannot be honoured as written: the
// customer Location is not in `ops_location_type`, so there is no movement row this schema can emit
// from it, and emitting one from the ORIGIN warehouse would claim stock left a place it left at
// delivery time, not at install time. The gap is real and is recorded in
// docs/handoff/w1-c7-registrations.md rather than closed by guessing which of the two the ledger
// actually wants. This module moves CUSTODY and nothing else.
import type { Pool, PoolClient } from "pg";
import {
  type OperatingCompanyKey,
  type OpsCustodyLocationType,
  type OpsLocationType,
  type OpsSerialStatus,
  requireOperatingCompanyKey,
} from "./operatingCompanyCustody.js";

const SCHEMA = "eos_ops";

// ════════════════════ vocabulary ════════════════════

/** `eos_ops.ops_equipment_status`. The client's EQUIPMENT_STATUS, unchanged. */
export const OPS_EQUIPMENT_STATUSES = ["ACTIVE", "INACTIVE", "RETIRED"] as const;
export type OpsEquipmentStatus = (typeof OPS_EQUIPMENT_STATUSES)[number];

/** `eos_ops.ops_equipment_model_status`. The D1 contract's MODEL_STATUSES, unchanged. */
export const OPS_EQUIPMENT_MODEL_STATUSES = ["DRAFT", "ACTIVE", "INACTIVE", "RETIRED"] as const;
export type OpsEquipmentModelStatus = (typeof OPS_EQUIPMENT_MODEL_STATUSES)[number];

/**
 * A CRM customer site — the `locations` collection, NOT an inventory location.
 *
 * The `namespace` field is not decoration. It is what stops a `LocationRef` (WAREHOUSE / BIN /
 * MOBILE) from being passed where a customer site is expected, and vice versa, given that the two
 * would otherwise be the same `{ id: string }` shape under two names.
 */
export interface CustomerLocationRef {
  readonly namespace: "CRM_LOCATION";
  readonly id: string;
}

/** Where a unit physically was before installation. Always PHYSICAL — never EQUIPMENT. */
export interface InstallOriginRef {
  readonly namespace: "OPS_LOCATION";
  readonly type: OpsLocationType;
  readonly id: string;
}

export function customerLocation(id: unknown): CustomerLocationRef {
  if (typeof id !== "string" || id.trim() === "") {
    throw new EquipmentCustodyError("REQUEST_INVALID", "a customer location id is required");
  }
  return { namespace: "CRM_LOCATION", id };
}

export interface EquipmentModelRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly manufacturerId: string;
  readonly manufacturerName: string;
  readonly modelNumber: string;
  readonly displayName: string;
  readonly family: string | null;
  readonly subtype: string | null;
  readonly revision: string | null;
  readonly status: OpsEquipmentModelStatus;
  readonly sourceAuthority: string;
  readonly version: number;
}

export interface EquipmentRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly operatingCompanyKey: OperatingCompanyKey;
  readonly accountId: string;
  /** The CRM customer site. Never an inventory location — see the file header. */
  readonly customerLocation: CustomerLocationRef;
  readonly equipmentModelId: string | null;
  readonly name: string;
  readonly status: OpsEquipmentStatus;
  readonly serialNumber: string | null;
  readonly assetTag: string | null;
  /** Where the unit came from, TYPED — or null for a machine with no company origin. */
  readonly installedFrom: InstallOriginRef | null;
}

/** The custody side of the relationship, as it reads after installation. */
export interface InstalledUnitRecord {
  readonly custodyId: string;
  readonly tenantId: string;
  readonly partId: string;
  readonly serialNumber: string;
  readonly status: OpsSerialStatus;
  readonly locationType: OpsCustodyLocationType;
  readonly equipmentId: string;
}

/**
 * The states a unit may be installed FROM, in the eos_ops vocabulary.
 *
 * A STRICT SUBSET of the Firestore command's four (AVAILABLE / RESERVED / STAGED / DELIVERED),
 * and the difference is not a decision made here. `ops_serial_status` has FIVE values; the
 * serialized-asset lifecycle has EIGHT (functions/src/serializedAsset/types.ts). STAGED, DELIVERED,
 * LOADED, IN_TRANSIT and RECEIVED have no representation in the operational status enum at all, so
 * a unit in one of them cannot be described by this schema, never mind installed from it.
 *
 * That is a real and currently unresolved gap, and it belongs to the inventory vocabulary rather
 * than to Equipment -- widening a shared enum is not this lane's to make. It is recorded in
 * docs/handoff/w1-c7-registrations.md. What is refused here is the pretence: nothing maps DELIVERED
 * onto AVAILABLE to make the install go through.
 */
export const INSTALLABLE_CUSTODY_STATUSES: readonly OpsSerialStatus[] =
  Object.freeze(["AVAILABLE", "RESERVED"]);

export type EquipmentCustodyFailureCode =
  | "REQUEST_INVALID"
  | "UNIT_NOT_FOUND"
  | "ALREADY_INSTALLED"
  | "STATUS_NOT_INSTALLABLE"
  | "OPERATING_COMPANY_MISMATCH"
  | "EQUIPMENT_ALREADY_HAS_UNIT"
  | "EQUIPMENT_EXISTS"
  | "MODEL_NOT_FOUND";

export class EquipmentCustodyError extends Error {
  constructor(readonly code: EquipmentCustodyFailureCode, message: string) {
    super(message);
    this.name = "EquipmentCustodyError";
  }
}

const requireText = (value: unknown, what: string): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new EquipmentCustodyError("REQUEST_INVALID", `${what} is required`);
  }
  return value;
};

// Postgres SQLSTATEs this module translates into domain failures. Anything else propagates: a
// constraint nobody anticipated is a bug, and swallowing it into a tidy domain error would hide it.
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
const sqlState = (error: unknown): string | null =>
  typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : null;
const constraintName = (error: unknown): string =>
  typeof error === "object" && error !== null && "constraint" in error
    ? String((error as { constraint: unknown }).constraint)
    : "";

// ════════════════════ the model catalog ════════════════════

export interface EquipmentModelInput {
  readonly id: string;
  readonly manufacturerId: string;
  readonly manufacturerName: string;
  readonly modelNumber: string;
  readonly displayName: string;
  readonly family?: string | null;
  readonly subtype?: string | null;
  readonly revision?: string | null;
  readonly status: OpsEquipmentModelStatus;
  readonly sourceAuthority: string;
  readonly version: number;
}

/**
 * Record one catalog model.
 *
 * THE CANONICAL ID IS THE CALLER'S, NOT THIS MODULE'S. `buildEquipmentModelId` is the identity
 * authority (functions/src/equipmentCompatibility/domain/equipmentModel.ts, mirrored on the client)
 * and re-deriving it here would put a second minting rule in the system -- the same objection the
 * migration raises against restating the derivation in SQL. This layer asserts the id is present
 * and lets the schema's shape constraint refuse anything that is not canonical.
 */
export async function recordEquipmentModel(
  pool: Pool,
  tenantId: string,
  actorId: string,
  model: EquipmentModelInput,
): Promise<EquipmentModelRecord> {
  requireText(tenantId, "tenantId");
  requireText(actorId, "actorId");
  requireText(model?.id, "equipment model id");

  const result = await pool.query(
    `INSERT INTO ${SCHEMA}.equipment_models
       (id, tenant_id, manufacturer_id, manufacturer_name, model_number, display_name,
        family, subtype, revision, status, source_authority, version, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
     RETURNING id, tenant_id, manufacturer_id, manufacturer_name, model_number, display_name,
               family, subtype, revision, status::text AS status, source_authority, version`,
    [
      model.id, tenantId, model.manufacturerId, model.manufacturerName, model.modelNumber,
      model.displayName, model.family ?? null, model.subtype ?? null, model.revision ?? null,
      model.status, model.sourceAuthority, model.version, actorId,
    ],
  );
  return modelRow(result.rows[0]);
}

export async function readEquipmentModel(
  pool: Pool,
  tenantId: string,
  equipmentModelId: string,
): Promise<EquipmentModelRecord | null> {
  const result = await pool.query(
    `SELECT id, tenant_id, manufacturer_id, manufacturer_name, model_number, display_name,
            family, subtype, revision, status::text AS status, source_authority, version
       FROM ${SCHEMA}.equipment_models WHERE tenant_id = $1 AND id = $2`,
    [tenantId, equipmentModelId],
  );
  return result.rows.length === 0 ? null : modelRow(result.rows[0]);
}

// ════════════════════ the installed register ════════════════════

export interface EquipmentAttributes {
  readonly name: string;
  readonly equipmentModelId?: string | null;
  readonly serialNumber?: string | null;
  readonly assetTag?: string | null;
  readonly installedOn?: string | null;
  readonly warrantyExpiresOn?: string | null;
  readonly notes?: string | null;
}

export interface InstallRequest {
  readonly tenantId: string;
  readonly actorId: string;
  /** Stated by the caller. Never defaulted, never inferred, and verified against the unit below. */
  readonly operatingCompanyKey: OperatingCompanyKey;
  /** The unit, addressed the way `serialized_custody` identifies one: part + serial, tenant-wide. */
  readonly partId: string;
  readonly serialNumber: string;
  /** The Equipment id to mint. Derived by the caller (equipmentDocIdFor) so replay is a conflict. */
  readonly equipmentId: string;
  readonly accountId: string;
  readonly customerLocation: CustomerLocationRef;
  readonly equipment: EquipmentAttributes;
}

export interface InstallResult {
  readonly equipment: EquipmentRecord;
  readonly unit: InstalledUnitRecord;
}

/**
 * Install one serialized unit as customer Equipment.
 *
 * ONE TRANSACTION, for the reason the Firestore command gives and this schema makes structural: an
 * Equipment record nothing is installed in, and a custody row pointing at an Equipment that does not
 * exist, are both worse than neither happening. Here the second is not merely undesirable -- the
 * foreign key makes it impossible, so the transaction is what keeps the FIRST from happening alone.
 *
 * THE ORIGIN IS READ, NOT SUPPLIED. `installed_from_*` comes off the custody row this command is
 * about to move, whose `location_type` is a real enum. A caller cannot state an origin, so a caller
 * cannot state a wrong one, and nothing here falls back to WAREHOUSE when the type is unclear --
 * the whole point of taking it from a typed column is that it never is.
 */
export async function installSerializedUnitAsEquipment(
  pool: Pool,
  request: InstallRequest,
): Promise<InstallResult> {
  const tenantId = requireText(request?.tenantId, "tenantId");
  const actorId = requireText(request.actorId, "actorId");
  const companyKey = requireOperatingCompanyKey(request.operatingCompanyKey);
  const partId = requireText(request.partId, "partId");
  const serialNumber = requireText(request.serialNumber, "serialNumber");
  const equipmentId = requireText(request.equipmentId, "equipmentId");
  const accountId = requireText(request.accountId, "accountId");
  const attributes = request.equipment ?? ({} as EquipmentAttributes);
  requireText(attributes.name, "equipment name");
  if (request.customerLocation?.namespace !== "CRM_LOCATION") {
    throw new EquipmentCustodyError(
      "REQUEST_INVALID",
      "customerLocation must be a CRM_LOCATION ref -- an inventory location is not a customer site",
    );
  }
  const customerLocationId = requireText(request.customerLocation.id, "customer location id");

  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");

    // FOR UPDATE: a concurrent install of the same unit waits here rather than racing the status
    // check, which is the only reason the ALREADY_INSTALLED refusal below means anything.
    const unit = await client.query(
      `SELECT id, operating_company_key, status::text AS status,
              location_type::text AS location_type, location_id
         FROM ${SCHEMA}.serialized_custody
        WHERE tenant_id = $1 AND part_id = $2 AND serial_number = $3
        FOR UPDATE`,
      [tenantId, partId, serialNumber],
    );
    if (unit.rows.length === 0) {
      throw new EquipmentCustodyError("UNIT_NOT_FOUND", `no serialized custody row for ${partId}/${serialNumber}`);
    }
    const held = unit.rows[0];

    // Checked on the STATUS here rather than on a link field, because in this schema they are the
    // same fact: migration 007's biconditional makes INSTALLED and EQUIPMENT custody equivalent,
    // and the generated equipment_id is a projection of the location, not an independent column
    // that could disagree with it.
    if (held.status === "INSTALLED") {
      throw new EquipmentCustodyError(
        "ALREADY_INSTALLED",
        `serialized unit is already installed as equipment ${String(held.location_id)}`,
      );
    }
    if (!INSTALLABLE_CUSTODY_STATUSES.includes(held.status as OpsSerialStatus)) {
      throw new EquipmentCustodyError(
        "STATUS_NOT_INSTALLABLE",
        `unit is ${String(held.status)}; installable statuses are ${INSTALLABLE_CUSTODY_STATUSES.join("/")}`,
      );
    }
    // VERIFIED, NOT ADOPTED. The custody row already carries an operating company; taking it from
    // there would let a caller install into a company it never named, and taking only the caller's
    // would let an install cross companies silently. Both are stated, and they must agree.
    if (held.operating_company_key !== companyKey) {
      throw new EquipmentCustodyError(
        "OPERATING_COMPANY_MISMATCH",
        `unit is held by operating company ${String(held.operating_company_key)}, not ${companyKey}`,
      );
    }

    let equipment: EquipmentRecord;
    try {
      const created = await client.query(
        `INSERT INTO ${SCHEMA}.equipment
           (id, tenant_id, operating_company_key, account_id, customer_location_id,
            equipment_model_id, name, status, serial_number, asset_tag, installed_on,
            warranty_expires_on, notes, installed_from_location_type, installed_from_location_id,
            created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', $8, $9, $10, $11, $12, $13, $14, $15, $15)
         RETURNING id, tenant_id, operating_company_key, account_id, customer_location_id,
                   equipment_model_id, name, status::text AS status, serial_number, asset_tag,
                   installed_from_location_type::text AS installed_from_location_type,
                   installed_from_location_id`,
        [
          equipmentId, tenantId, companyKey, accountId, customerLocationId,
          attributes.equipmentModelId ?? null, attributes.name,
          // The serial is carried onto the register the way the Firestore command carries it: from
          // the unit, not from the request, so the two records cannot name different serials.
          attributes.serialNumber ?? serialNumber,
          attributes.assetTag ?? null, attributes.installedOn ?? null,
          attributes.warrantyExpiresOn ?? null, attributes.notes ?? null,
          held.location_type, held.location_id, actorId,
        ],
      );
      equipment = equipmentRow(created.rows[0]);
    } catch (error) {
      if (sqlState(error) === UNIQUE_VIOLATION) {
        throw new EquipmentCustodyError("EQUIPMENT_EXISTS", `equipment ${equipmentId} already exists`);
      }
      if (sqlState(error) === FOREIGN_KEY_VIOLATION && constraintName(error) === "equipment_model_same_tenant") {
        throw new EquipmentCustodyError(
          "MODEL_NOT_FOUND",
          `equipment model ${String(attributes.equipmentModelId)} is not in this tenant's catalog`,
        );
      }
      throw error;
    }

    let installed: InstalledUnitRecord;
    try {
      const moved = await client.query(
        `UPDATE ${SCHEMA}.serialized_custody
            SET status = 'INSTALLED', location_type = 'EQUIPMENT', location_id = $1,
                updated_by = $2, updated_at = now()
          WHERE id = $3
        RETURNING id, tenant_id, part_id, serial_number, status::text AS status,
                  location_type::text AS location_type, equipment_id`,
        [equipmentId, actorId, held.id],
      );
      installed = installedUnitRow(moved.rows[0]);
    } catch (error) {
      // ADR-010 §3's "exactly one Serialized Asset", arriving from the index rather than from a
      // read this command would otherwise have had to remember to do.
      if (sqlState(error) === UNIQUE_VIOLATION
        && constraintName(error) === "serialized_custody_one_unit_per_equipment") {
        throw new EquipmentCustodyError(
          "EQUIPMENT_ALREADY_HAS_UNIT",
          `equipment ${equipmentId} already has an installed serialized unit`,
        );
      }
      throw error;
    }

    await client.query("COMMIT");
    return { equipment, unit: installed };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function readEquipment(
  pool: Pool,
  tenantId: string,
  equipmentId: string,
): Promise<EquipmentRecord | null> {
  const result = await pool.query(
    `SELECT id, tenant_id, operating_company_key, account_id, customer_location_id,
            equipment_model_id, name, status::text AS status, serial_number, asset_tag,
            installed_from_location_type::text AS installed_from_location_type,
            installed_from_location_id
       FROM ${SCHEMA}.equipment WHERE tenant_id = $1 AND id = $2`,
    [tenantId, equipmentId],
  );
  return result.rows.length === 0 ? null : equipmentRow(result.rows[0]);
}

/**
 * The unit installed in one Equipment record, if any.
 *
 * The relationship read in the direction nothing could answer before: `equipment` carries no
 * pointer back at the unit, deliberately -- the custody row's location IS the link, and a second
 * copy of it on the register is the copy that gets stale.
 */
export async function readInstalledUnit(
  pool: Pool,
  tenantId: string,
  equipmentId: string,
): Promise<InstalledUnitRecord | null> {
  const result = await pool.query(
    `SELECT id, tenant_id, part_id, serial_number, status::text AS status,
            location_type::text AS location_type, equipment_id
       FROM ${SCHEMA}.serialized_custody
      WHERE tenant_id = $1 AND equipment_id = $2`,
    [tenantId, equipmentId],
  );
  return result.rows.length === 0 ? null : installedUnitRow(result.rows[0]);
}

/** Every machine at one customer site. The CRM-side relationship, served by its own index. */
export async function readEquipmentAtCustomerLocation(
  pool: Pool,
  tenantId: string,
  location: CustomerLocationRef,
): Promise<readonly EquipmentRecord[]> {
  if (location?.namespace !== "CRM_LOCATION") {
    throw new EquipmentCustodyError("REQUEST_INVALID", "a CRM_LOCATION ref is required");
  }
  const result = await pool.query(
    `SELECT id, tenant_id, operating_company_key, account_id, customer_location_id,
            equipment_model_id, name, status::text AS status, serial_number, asset_tag,
            installed_from_location_type::text AS installed_from_location_type,
            installed_from_location_id
       FROM ${SCHEMA}.equipment
      WHERE tenant_id = $1 AND customer_location_id = $2
      ORDER BY name`,
    [tenantId, location.id],
  );
  return result.rows.map(equipmentRow);
}

// ════════════════════ row projections ════════════════════

function modelRow(row: Record<string, any>): EquipmentModelRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    manufacturerId: row.manufacturer_id,
    manufacturerName: row.manufacturer_name,
    modelNumber: row.model_number,
    displayName: row.display_name,
    family: row.family ?? null,
    subtype: row.subtype ?? null,
    revision: row.revision ?? null,
    status: row.status as OpsEquipmentModelStatus,
    sourceAuthority: row.source_authority,
    version: Number(row.version),
  };
}

function equipmentRow(row: Record<string, any>): EquipmentRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    operatingCompanyKey: row.operating_company_key,
    accountId: row.account_id,
    customerLocation: { namespace: "CRM_LOCATION", id: row.customer_location_id },
    equipmentModelId: row.equipment_model_id ?? null,
    name: row.name,
    status: row.status as OpsEquipmentStatus,
    serialNumber: row.serial_number ?? null,
    assetTag: row.asset_tag ?? null,
    installedFrom: row.installed_from_location_id == null
      ? null
      : {
        namespace: "OPS_LOCATION",
        type: row.installed_from_location_type as OpsLocationType,
        id: row.installed_from_location_id,
      },
  };
}

function installedUnitRow(row: Record<string, any>): InstalledUnitRecord {
  return {
    custodyId: row.id,
    tenantId: row.tenant_id,
    partId: row.part_id,
    serialNumber: row.serial_number,
    status: row.status as OpsSerialStatus,
    locationType: row.location_type as OpsCustodyLocationType,
    equipmentId: row.equipment_id,
  };
}
