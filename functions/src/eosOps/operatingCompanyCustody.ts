// eos_ops domain vocabulary — the operating-company authority key, and the TWO location vocabularies
// migration 007 keeps apart.
//
// ════════════════════ WHY THIS FILE EXISTS SEPARATELY ════════════════════
//
// `OpsLocationType` used to live in cycleCountRepository.ts because Cycle Count was the only reader.
// It is now shared vocabulary with a rule attached -- physical movement and serialized custody are
// deliberately NOT the same enum -- and a rule that lives inside one feature's repository is a rule
// the next feature's repository will quietly restate differently. It is re-exported from
// cycleCountRepository.ts so no existing import has to move.
//
// ════════════════════ THE OPERATING COMPANY IS OPAQUE HERE ════════════════════
//
// `OperatingCompanyKey` is a branded-by-convention string, not a union of this deployment's company
// names. Migration 007's header says why in SQL terms; the same reason holds in TypeScript: a union
// type here would be a second place the valid set is declared, and it would drift from the EOS
// authority layer that actually decides. This module validates SHAPE (a non-empty string), never
// MEMBERSHIP. Membership is the authority layer's answer, and this layer does not guess it -- in
// particular it is never derived from a Warehouse, a Truck, an Employee or a homeWarehouseId.

/**
 * The physical inventory-movement location vocabulary — `eos_ops.ops_location_type`.
 *
 * The three places company-held stock can physically be, and the three the warehouse-aggregate
 * invariant (ADR-014 / Decision #160) is defined over. EQUIPMENT is NOT one of them: an installed
 * unit has left company inventory, and a movement row pointing at an Equipment id would enter a
 * customer-owned machine into a balance that sums company stock.
 */
export const OPS_LOCATION_TYPES = ["WAREHOUSE", "BIN", "MOBILE"] as const;
export type OpsLocationType = (typeof OPS_LOCATION_TYPES)[number];

/**
 * The serialized-CUSTODY location vocabulary — `eos_ops.ops_custody_location_type`.
 *
 * A superset of the physical one by exactly one label. Custody answers "where is this unit now",
 * and after installation the honest answer is the customer's Equipment record, whose id the custody
 * row carries in `locationId`. CUSTOMER is deliberately absent: the Equipment record already names
 * the account, and a second account reference here would be a second authority for it.
 */
export const OPS_CUSTODY_LOCATION_TYPES = ["WAREHOUSE", "BIN", "MOBILE", "EQUIPMENT"] as const;
export type OpsCustodyLocationType = (typeof OPS_CUSTODY_LOCATION_TYPES)[number];

/** `eos_ops.ops_serial_status`. */
export const OPS_SERIAL_STATUSES = ["AVAILABLE", "RESERVED", "INSTALLED", "CONSUMED", "SCRAPPED"] as const;
export type OpsSerialStatus = (typeof OPS_SERIAL_STATUSES)[number];

/** Opaque, tenant-scoped, governed elsewhere. A non-empty string is all this layer asserts. */
export type OperatingCompanyKey = string;

export class OperatingCompanyAuthorityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperatingCompanyAuthorityError";
  }
}

/**
 * Refuse a missing operating company rather than substituting one.
 *
 * There is no default and no inference: the caller states the governed key or the call fails, which
 * is the same contract migration 007 gives at the SQL boundary (NOT NULL, no DEFAULT).
 */
export function requireOperatingCompanyKey(value: unknown): OperatingCompanyKey {
  if (typeof value !== "string" || value.trim() === "") {
    throw new OperatingCompanyAuthorityError(
      "operatingCompanyKey is required and is never defaulted, inferred or manufactured",
    );
  }
  return value;
}

export function isOpsLocationType(value: unknown): value is OpsLocationType {
  return typeof value === "string" && (OPS_LOCATION_TYPES as readonly string[]).includes(value);
}

export function isOpsCustodyLocationType(value: unknown): value is OpsCustodyLocationType {
  return typeof value === "string" && (OPS_CUSTODY_LOCATION_TYPES as readonly string[]).includes(value);
}

/** A physical location is always a valid custody location. The reverse is not true. */
export function custodyLocationTypeOf(physical: OpsLocationType): OpsCustodyLocationType {
  return physical;
}

/** Where a serialized unit physically or contractually sits, in the CUSTODY vocabulary. */
export interface CustodyLocationRef {
  readonly type: OpsCustodyLocationType;
  /** Opaque. For EQUIPMENT this is the Equipment id (the install command's `currentEquipmentId`). */
  readonly id: string;
}

/** One row of `eos_ops.serialized_custody`. */
export interface SerializedCustodyRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly operatingCompanyKey: OperatingCompanyKey;
  readonly partId: string;
  readonly serialNumber: string;
  readonly status: OpsSerialStatus;
  readonly location: CustodyLocationRef;
}

/**
 * The INSTALLED rule, as a BICONDITIONAL — the same one
 * `serialized_custody_installed_is_equipment` enforces in SQL.
 *
 * Both directions, because the product's existing serialized-asset contract already states it both
 * ways: functions/src/serializedAsset/types.ts's `validateSerializedAssetValue` rejects
 * `installed_requires_link` AND `link_requires_installed`, and the mirrored client module
 * field-ops-app-vite/src/domain/serializedAssetIdentity.js enforces the identical pair. An installed
 * unit is never still in WAREHOUSE/BIN/MOBILE custody, and an EQUIPMENT custody row never describes
 * a unit the company still considers its own stock.
 */
export function isInstalledCustodyConsistent(
  status: OpsSerialStatus,
  locationType: OpsCustodyLocationType,
): boolean {
  return (status === "INSTALLED") === (locationType === "EQUIPMENT");
}
