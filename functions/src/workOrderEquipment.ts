// WHICH MACHINE THIS WORK ORDER IS ABOUT.
//
// GOVERNANCE: docs/assessments/core-transaction-actionability-audit.md, gap 4; Owner Slice 2.
//
// ════════════════════ THE GAP THIS CLOSES ════════════════════
//
// A Work Order declared `customerId` and `locationId` and NO equipment reference at all. The Taylor
// service invoice identifies make / model / serial / install date BEFORE any service activity, and
// that was unanswerable from the Work Order — a technician was dispatched to a customer and a site,
// never to a unit.
//
// ════════════════════ TWO RULES, BECAUSE INSTALL IS GENUINELY DIFFERENT ════════════════════
//
// SERVICE_CALL / PM / WARRANTY / INSPECTION all act on a machine that ALREADY EXISTS. They may
// carry an `equipmentId`, and when they do it is validated against the real record.
//
// INSTALL is the opposite case and must not be forced into the same shape: the installed Equipment
// DOES NOT EXIST YET. It is created at installation completion, from the serialized asset that was
// physically delivered — `workOrderInstallCommand` already owns that path
// (workOrderId + serializedAssetId -> equipmentId). Accepting an `equipmentId` on an INSTALL at
// creation would mean pointing at a unit nobody has installed, so it is REFUSED with that reason
// rather than silently ignored.
//
// ════════════════════ OPTIONAL, NOT REQUIRED ════════════════════
//
// Every Work Order written before this existed has no equipment, and those records stay valid and
// readable. Requiring the reference would retroactively invalidate the entire history and would
// also be wrong going forward: a service call can legitimately be raised before anyone knows which
// unit it is about.
//
// This module is PURE. It reads no database. The caller fetches the Equipment inside its own
// transaction and hands the document here, so the rules stay assertable offline and there is one
// place they are written down.

/** What each Work Order type may say about equipment at CREATION time. */
export const WORK_ORDER_EQUIPMENT_RULE = Object.freeze({
  SERVICE_CALL: "OPTIONAL_EXISTING",
  PM: "OPTIONAL_EXISTING",
  WARRANTY: "OPTIONAL_EXISTING",
  INSPECTION: "OPTIONAL_EXISTING",
  // The unit is created at completion, not named at creation. See the header.
  INSTALL: "FORBIDDEN_AT_CREATE",
} as const);

export type WorkOrderEquipmentRule = typeof WORK_ORDER_EQUIPMENT_RULE[keyof typeof WORK_ORDER_EQUIPMENT_RULE];

export type WorkOrderEquipmentErrorCode =
  /** An INSTALL named a unit that cannot exist yet. */
  | "EQUIPMENT_NOT_ALLOWED_FOR_TYPE"
  /** The referenced Equipment does not exist. */
  | "EQUIPMENT_NOT_FOUND"
  /** The Equipment belongs to a different customer. */
  | "EQUIPMENT_ACCOUNT_MISMATCH"
  /** The Equipment is installed at a different site than the one being visited. */
  | "EQUIPMENT_LOCATION_MISMATCH"
  /** The reference is not a usable id. */
  | "EQUIPMENT_REF_INVALID";

export class WorkOrderEquipmentError extends Error {
  code: WorkOrderEquipmentErrorCode;
  constructor(code: WorkOrderEquipmentErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "WorkOrderEquipmentError";
  }
}

/** The minimal Equipment facts this validation needs. Never the whole document. */
export interface EquipmentIntegrityFacts {
  exists: boolean;
  accountId?: string | null;
  locationId?: string | null;
}

/**
 * May a Work Order of this type carry an equipment reference at all?
 *
 * Returns the rule so a caller can decide whether to fetch anything. Throws only for the case that
 * is genuinely wrong: an INSTALL naming a unit that does not exist yet.
 */
export function assertEquipmentAllowedForType(type: string | undefined, equipmentId: string | undefined): void {
  if (equipmentId === undefined || equipmentId === null) return;
  if (typeof equipmentId !== "string" || equipmentId.trim().length === 0) {
    throw new WorkOrderEquipmentError("EQUIPMENT_REF_INVALID", "equipmentId, when provided, must be a non-empty string.");
  }
  // A Work Order with no type is valid (it may carry a complaint instead), and an untyped one is
  // not an INSTALL — so it follows the ordinary rule rather than being refused for a type it does
  // not claim.
  const rule = type ? WORK_ORDER_EQUIPMENT_RULE[type as keyof typeof WORK_ORDER_EQUIPMENT_RULE] : "OPTIONAL_EXISTING";
  if (rule === "FORBIDDEN_AT_CREATE") {
    throw new WorkOrderEquipmentError(
      "EQUIPMENT_NOT_ALLOWED_FOR_TYPE",
      "An INSTALL Work Order cannot reference installed equipment at creation: the unit does not exist " +
        "until the installation is completed, and is linked then from the serialized asset that was delivered."
    );
  }
}

/**
 * Does this Equipment belong to the customer and site being visited?
 *
 * ACCOUNT IS STRICT. Equipment belongs to one Account, and servicing another customer's machine on
 * this customer's Work Order is not a near-miss — it is the wrong record, and every downstream
 * consumer (history, warranty, billing responsibility) would inherit the error.
 *
 * LOCATION IS CHECKED ONLY WHEN BOTH SIDES KNOW. Equipment whose `locationId` is absent cannot be
 * proven incompatible with anything, and refusing on absence would block legitimate work on records
 * whose site was never captured. Where both are known and differ, it is refused: a unit installed
 * at one site is not the unit at another, even for the same customer.
 */
export function assertEquipmentIntegrity(
  facts: EquipmentIntegrityFacts,
  workOrder: { customerId: string; locationId?: string | null }
): void {
  if (!facts.exists) {
    throw new WorkOrderEquipmentError("EQUIPMENT_NOT_FOUND", "The referenced equipment does not exist.");
  }
  if (facts.accountId !== workOrder.customerId) {
    throw new WorkOrderEquipmentError(
      "EQUIPMENT_ACCOUNT_MISMATCH",
      "The referenced equipment belongs to a different customer than this Work Order."
    );
  }
  const equipmentLocation = facts.locationId ?? null;
  const workOrderLocation = workOrder.locationId ?? null;
  if (equipmentLocation !== null && workOrderLocation !== null && equipmentLocation !== workOrderLocation) {
    throw new WorkOrderEquipmentError(
      "EQUIPMENT_LOCATION_MISMATCH",
      "The referenced equipment is installed at a different location than this Work Order."
    );
  }
}
