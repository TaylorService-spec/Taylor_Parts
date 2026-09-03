// CERT-FIN-02 -- the governed FINANCIAL POLICY PROFILE: one operating company's deployment-time
// accounting configuration, and the boundary that stops it changing casually afterwards.
//
// PURE. No Firestore, no clock, no I/O, no floating-point money. Every decision lives here so the
// same rules govern the command, the callable and the screen, and so the whole thing is testable
// offline.
//
// ============================ WHY THIS IS NOT "THE WEIGHTED AVERAGE SETTING" ============================
//
// EOS does not have an accounting method. Each CUSTOMER's accounting team picks one during
// deployment, it is approved as part of that deployment, and it locks when that company's financial
// authority is activated. The platform's job is to support several methods correctly and to refuse
// to change one on live books. So nothing here is named after a method, nothing branches on a
// customer, and "which method Taylor uses" is a row in a collection, not a line of code.
//
// ============================ THE THREE LAYERS, KEPT APART ============================
//
//   1. PLATFORM INVARIANTS  -- not configurable, not fields, not dropdowns. UNKNOWN is never zero;
//      history is never silently rewritten; a transfer never manufactures cost; company boundaries
//      hold; money is integer minor units. A customer cannot buy their way out of these, so they
//      are constants here and informational text on the screen (see PLATFORM_INVARIANTS below).
//   2. SUPPORTED STRATEGIES -- what the engine actually implements and tests. A method absent from
//      these vocabularies cannot be selected, because selecting it would promise arithmetic that
//      does not exist.
//   3. DEPLOYMENT CHOICE    -- the profile document. Data, chosen once, then locked.
//
// A future accounting-policy MIGRATION (approval -> effective date -> impact assessment ->
// conversion -> activation) is deliberately NOT built. The only thing built here is the boundary
// that says a locked profile cannot be edited through ordinary configuration.

import {
  PHYSICAL_CONSUMPTION_ACTIVE,
  PHYSICAL_CONSUMPTION_BLOCKER,
} from "../workOrderConsumption/consumptionActivation.js";

// ============================ 1. PLATFORM INVARIANTS (NOT CONFIGURABLE) ============================

/**
 * How EOS treats a cost it does not know. There is exactly one legal answer and it is not a choice:
 * an unknown cost stays unknown. Substituting 0 reads as "this was free" and silently inflates every
 * margin derived from it, which is the single worst outcome available on this path.
 *
 * Exported so the screen can DISPLAY it. It is deliberately NOT a field on the profile: a dropdown
 * with one legal value is a fake choice, and rendering an invariant as configurable invites someone
 * to ask for the other option.
 */
export const UNKNOWN_COST_TREATMENT = "PRESERVE_AS_UNKNOWN" as const;

/** The invariants a profile cannot override, in the words the screen shows. Display + test data. */
export const PLATFORM_INVARIANTS: readonly { readonly id: string; readonly statement: string }[] =
  Object.freeze([
    Object.freeze({
      id: "UNKNOWN_NEVER_ZERO",
      statement: "An unknown cost stays unknown. EOS never substitutes $0.",
    }),
    Object.freeze({
      id: "HISTORY_IMMUTABLE",
      statement:
        "Recorded cost facts are never rewritten in place. A correction is a new, linked, auditable fact.",
    }),
    Object.freeze({
      id: "TRANSFER_CREATES_NO_COST",
      statement:
        "Moving stock between company locations changes custody, not cost. No internal movement manufactures an acquisition cost.",
    }),
    Object.freeze({
      id: "COMPANY_PARTITION",
      statement: "Cost never crosses an operating company boundary.",
    }),
    Object.freeze({
      id: "INTEGER_MINOR_UNITS",
      statement: "Money is exact integer minor units with an explicit currency. Never floating point.",
    }),
    Object.freeze({
      id: "FAIL_CLOSED_MARGIN",
      statement:
        "When required cost evidence is missing, EOS reports UNKNOWN rather than a number it cannot support.",
    }),
    Object.freeze({
      id: "NO_SILENT_RECALCULATION",
      statement:
        "Changing accounting policy never silently recalculates recognized history. That requires a governed migration.",
    }),
  ]);

// ============================ 2. SUPPORTED STRATEGIES ============================

/**
 * Cost methods for INTERCHANGEABLE inventory -- parts that are not individually identifiable, where
 * pretending someone picked a particular accounting lot would be fiction.
 *
 * LIFO, STANDARD_COST and REPLACEMENT_COST are deliberately ABSENT. Nothing authorizes them and
 * nothing implements them; pre-registering a name would suggest the arithmetic exists.
 */
export const INVENTORY_COST_METHODS = Object.freeze(["WEIGHTED_AVERAGE", "FIFO"] as const);
export type InventoryCostMethod = (typeof INVENTORY_COST_METHODS)[number];

/**
 * Cost methods for individually IDENTIFIABLE inventory (serialized units, high-value equipment).
 *
 * SPECIFIC_IDENTIFICATION is available because a serialized unit's own acquisition cost is already
 * derivable from governed lineage. A deployment may still choose to pool serialized stock with
 * everything else, so the interchangeable methods remain legal here.
 */
export const SERIALIZED_COST_METHODS = Object.freeze([
  "SPECIFIC_IDENTIFICATION",
  "WEIGHTED_AVERAGE",
  "FIFO",
] as const);
export type SerializedCostMethod = (typeof SERIALIZED_COST_METHODS)[number];

/**
 * The business events at which inventory cost may become COGS.
 *
 * `available: false` is not a placeholder for "coming soon" -- it means the backend cannot honour the
 * choice today and therefore must not offer it. `validateFinancialPolicyProfile` refuses an
 * unavailable point, so an operator cannot configure a promise the system cannot keep.
 *
 * PHYSICAL MOVEMENT IS NOT ON THIS LIST, AND THAT IS THE POINT. A warehouse-to-truck transfer, a bin
 * relocation, a staging move, a receipt and a cycle count are not sales. None of them may ever
 * appear here.
 */
export interface CogsRecognitionPoint {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly available: boolean;
  /** Why it cannot be chosen. Null when available. Shown verbatim, never paraphrased into "coming soon". */
  readonly blockedReason: string | null;
}

export const COGS_RECOGNITION_POINTS: readonly CogsRecognitionPoint[] = Object.freeze([
  Object.freeze({
    id: "SALES_ORDER_FULFILLMENT",
    label: "Sales order fulfillment",
    description: "Cost is relieved when a sales order line is fulfilled to the customer.",
    available: true,
    blockedReason: null,
  }),
  Object.freeze({
    id: "INVOICE_ISSUE",
    label: "Invoice issue",
    description: "Cost is relieved when the invoice carrying the line is issued.",
    available: true,
    blockedReason: null,
  }),
  Object.freeze({
    id: "EQUIPMENT_INSTALL",
    label: "Equipment installation / acceptance",
    description:
      "For identifiable equipment: cost is relieved when the unit is installed and accepted at the customer site.",
    available: true,
    blockedReason: null,
  }),
  Object.freeze({
    id: "WORK_ORDER_CONSUMPTION",
    label: "Work order part consumption",
    description: "Cost is relieved when a technician consumes a part against a work order.",
    // DERIVED FROM THE PHYSICAL AUTHORITY'S OWN GATE, not restated beside it.
    //
    // The consumption movement authority now EXISTS (functions/src/workOrderConsumption/) -- built,
    // tested, and inert behind one named boolean. While that boolean is false, `qtyUsed` records as
    // it always has and physical on-hand stays overstated, so recognizing cost here would relieve
    // inventory the system still counts on the shelf.
    //
    // Reading the constant rather than hard-coding `false` means flipping the physical gate makes
    // this recognition point available in the same act. A second copy of that decision would be a
    // second thing to forget.
    available: PHYSICAL_CONSUMPTION_ACTIVE,
    blockedReason: PHYSICAL_CONSUMPTION_ACTIVE
      ? null
      : `Physical consumption is built but not active (${PHYSICAL_CONSUMPTION_BLOCKER}): a technician cannot yet name the inventory location stock was consumed from, so consumption does not remove physical stock. Recognizing cost here would relieve inventory the system still counts on the shelf.`,
  }),
]);

export type CogsRecognitionPointId = (typeof COGS_RECOGNITION_POINTS)[number]["id"];

/** Every recognition point id, available or not -- for validation and display. */
export const COGS_RECOGNITION_POINT_IDS: readonly string[] = Object.freeze(
  COGS_RECOGNITION_POINTS.map((p) => p.id),
);

export function cogsRecognitionPoint(id: unknown): CogsRecognitionPoint | null {
  return COGS_RECOGNITION_POINTS.find((p) => p.id === id) ?? null;
}

/**
 * Inbound freight and other landed costs.
 *
 * EXCLUDED is the only supported value, and that is enforcement rather than a stub: capitalizing
 * freight requires a deterministic, approved allocation method, and inventing a per-item split would
 * be exactly the arbitrary arithmetic this module exists to refuse. When an allocation policy is
 * approved, a value is added here -- a data-shaped change, not a schema-shaped one.
 */
export const FREIGHT_TREATMENTS = Object.freeze(["EXCLUDED"] as const);
export type FreightTreatment = (typeof FREIGHT_TREATMENTS)[number];

export const LANDED_COST_TREATMENTS = Object.freeze(["EXCLUDED"] as const);
export type LandedCostTreatment = (typeof LANDED_COST_TREATMENTS)[number];

// ============================ 3. LIFECYCLE ============================

/**
 * DRAFT      -- being prepared with the customer's accounting team. Editable.
 * APPROVED   -- the accounting team has signed off. Still editable (an approval can be revised right
 *               up until activation), but it carries the approval evidence.
 * LOCKED     -- financial authority is active for this company. NOT editable by any ordinary path.
 *
 * There is deliberately no UNLOCKED, no SUSPENDED and no REOPENED. Coming back from LOCKED is an
 * accounting-policy migration, which is a separate governed thing that does not exist yet -- and a
 * status value is not the place to pretend it does.
 */
export const PROFILE_STATUSES = Object.freeze(["DRAFT", "APPROVED", "LOCKED"] as const);
export type ProfileStatus = (typeof PROFILE_STATUSES)[number];

/** Statuses an ordinary configuration path may still write to. LOCKED is absent, permanently. */
export const EDITABLE_STATUSES: readonly ProfileStatus[] = Object.freeze(["DRAFT", "APPROVED"]);

export function isEditableStatus(status: unknown): boolean {
  return typeof status === "string" && (EDITABLE_STATUSES as readonly string[]).includes(status);
}

/**
 * The legal transitions. LOCKED has no outbound edge -- the map says so, so no caller has to remember.
 */
export const PROFILE_TRANSITIONS: Readonly<Record<ProfileStatus, readonly ProfileStatus[]>> =
  Object.freeze({
    DRAFT: Object.freeze(["APPROVED"] as ProfileStatus[]),
    APPROVED: Object.freeze(["DRAFT", "LOCKED"] as ProfileStatus[]),
    LOCKED: Object.freeze([] as ProfileStatus[]),
  });

export function isLegalTransition(from: unknown, to: unknown): boolean {
  if (typeof from !== "string" || typeof to !== "string") return false;
  const allowed = PROFILE_TRANSITIONS[from as ProfileStatus];
  return allowed !== undefined && (allowed as readonly string[]).includes(to);
}

// ============================ THE PROFILE ============================

/**
 * The deployment approval evidence.
 *
 * A RECORD OF WHO SAID YES, NOT AN ELECTRONIC SIGNATURE. No cryptographic claim, no legal
 * attestation semantics, no separate signing identity -- inventing any of those would be inventing
 * an authority nobody granted. `approvedBy` is a free-text name of the accounting-team member as
 * supplied during deployment; `recordedByUid` is the EOS principal who entered it, which is the only
 * identity EOS can actually vouch for. The two are kept apart deliberately.
 */
export interface ProfileApproval {
  readonly approvedBy: string;
  readonly approvedOn: string;
  readonly reference: string | null;
  readonly recordedByUid: string;
}

export interface FinancialPolicyProfile {
  readonly operatingCompanyId: string;
  readonly status: ProfileStatus;
  readonly inventoryCostMethod: InventoryCostMethod;
  readonly serializedInventoryCostMethod: SerializedCostMethod;
  readonly cogsRecognitionPointId: string;
  readonly freightTreatment: FreightTreatment;
  readonly landedCostTreatment: LandedCostTreatment;
  /** Present once the accounting team has signed off. Required to reach APPROVED, and to LOCK. */
  readonly approval: ProfileApproval | null;
}

export type FinancialPolicyFailureCode =
  | "PROFILE_MALFORMED"
  | "COMPANY_REQUIRED"
  | "METHOD_UNSUPPORTED"
  | "RECOGNITION_UNSUPPORTED"
  | "RECOGNITION_UNAVAILABLE"
  | "TREATMENT_UNSUPPORTED"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_MALFORMED"
  | "PROFILE_LOCKED"
  | "TRANSITION_ILLEGAL";

export class FinancialPolicyError extends Error {
  readonly code: FinancialPolicyFailureCode;
  constructor(code: FinancialPolicyFailureCode, message: string) {
    super(message);
    this.code = code;
    this.name = new.target.name;
  }
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim().length > 0 ? v.trim() : null;

/** ISO calendar date, `YYYY-MM-DD`. A date the accounting team states, not a server clock reading. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validateApproval(raw: unknown): ProfileApproval {
  if (!isPlainObject(raw)) {
    throw new FinancialPolicyError("APPROVAL_MALFORMED", "approval must be an object");
  }
  const approvedBy = str(raw.approvedBy);
  const approvedOn = str(raw.approvedOn);
  const recordedByUid = str(raw.recordedByUid);
  if (approvedBy === null) {
    throw new FinancialPolicyError(
      "APPROVAL_MALFORMED",
      "approval.approvedBy is required -- an approval with nobody's name on it is not evidence",
    );
  }
  if (approvedOn === null || !ISO_DATE.test(approvedOn)) {
    throw new FinancialPolicyError(
      "APPROVAL_MALFORMED",
      "approval.approvedOn must be an ISO calendar date (YYYY-MM-DD)",
    );
  }
  if (recordedByUid === null) {
    throw new FinancialPolicyError(
      "APPROVAL_MALFORMED",
      "approval.recordedByUid is required -- EOS records which principal entered the approval",
    );
  }
  const reference = raw.reference === undefined || raw.reference === null ? null : str(raw.reference);
  if (raw.reference !== undefined && raw.reference !== null && reference === null) {
    throw new FinancialPolicyError("APPROVAL_MALFORMED", "approval.reference, when present, must be a non-empty string");
  }
  return Object.freeze({ approvedBy, approvedOn, reference, recordedByUid });
}

const PROFILE_KEYS = new Set([
  "operatingCompanyId",
  "status",
  "inventoryCostMethod",
  "serializedInventoryCostMethod",
  "cogsRecognitionPointId",
  "freightTreatment",
  "landedCostTreatment",
  "approval",
]);

/**
 * Validate and normalize a profile. Fail-closed: an unknown key, an unsupported method or an
 * unavailable recognition point is refused rather than dropped or defaulted.
 *
 * NOTE what is NOT here: no `unknownCostTreatment` field. That is a platform invariant
 * (UNKNOWN_COST_TREATMENT), not a deployment choice, and giving it a field would invite someone to
 * set the other value.
 */
export function validateFinancialPolicyProfile(raw: unknown): FinancialPolicyProfile {
  if (!isPlainObject(raw)) {
    throw new FinancialPolicyError("PROFILE_MALFORMED", "financial policy profile must be an object");
  }
  const unknownKey = Object.keys(raw).find((k) => !PROFILE_KEYS.has(k));
  if (unknownKey !== undefined) {
    throw new FinancialPolicyError("PROFILE_MALFORMED", `unknown financial policy field: ${unknownKey}`);
  }

  const operatingCompanyId = str(raw.operatingCompanyId);
  if (operatingCompanyId === null) {
    throw new FinancialPolicyError(
      "COMPANY_REQUIRED",
      "a financial policy profile belongs to exactly one operating company -- it is never global",
    );
  }

  const status = raw.status;
  if (typeof status !== "string" || !(PROFILE_STATUSES as readonly string[]).includes(status)) {
    throw new FinancialPolicyError("PROFILE_MALFORMED", `status must be one of ${PROFILE_STATUSES.join(", ")}`);
  }

  const inventoryCostMethod = raw.inventoryCostMethod;
  if (
    typeof inventoryCostMethod !== "string" ||
    !(INVENTORY_COST_METHODS as readonly string[]).includes(inventoryCostMethod)
  ) {
    throw new FinancialPolicyError(
      "METHOD_UNSUPPORTED",
      `inventoryCostMethod must be one of ${INVENTORY_COST_METHODS.join(", ")} -- a method EOS does not implement cannot be configured`,
    );
  }

  const serializedInventoryCostMethod = raw.serializedInventoryCostMethod;
  if (
    typeof serializedInventoryCostMethod !== "string" ||
    !(SERIALIZED_COST_METHODS as readonly string[]).includes(serializedInventoryCostMethod)
  ) {
    throw new FinancialPolicyError(
      "METHOD_UNSUPPORTED",
      `serializedInventoryCostMethod must be one of ${SERIALIZED_COST_METHODS.join(", ")}`,
    );
  }

  const point = cogsRecognitionPoint(raw.cogsRecognitionPointId);
  if (point === null) {
    throw new FinancialPolicyError(
      "RECOGNITION_UNSUPPORTED",
      `cogsRecognitionPointId must be one of ${COGS_RECOGNITION_POINT_IDS.join(", ")}`,
    );
  }
  if (!point.available) {
    throw new FinancialPolicyError("RECOGNITION_UNAVAILABLE", point.blockedReason ?? `${point.id} cannot be activated`);
  }

  const freightTreatment = raw.freightTreatment;
  if (typeof freightTreatment !== "string" || !(FREIGHT_TREATMENTS as readonly string[]).includes(freightTreatment)) {
    throw new FinancialPolicyError(
      "TREATMENT_UNSUPPORTED",
      "freight capitalization requires an approved, deterministic allocation method; EXCLUDED is the only supported treatment",
    );
  }

  const landedCostTreatment = raw.landedCostTreatment;
  if (
    typeof landedCostTreatment !== "string" ||
    !(LANDED_COST_TREATMENTS as readonly string[]).includes(landedCostTreatment)
  ) {
    throw new FinancialPolicyError(
      "TREATMENT_UNSUPPORTED",
      "landed-cost capitalization requires an approved, deterministic allocation method; EXCLUDED is the only supported treatment",
    );
  }

  const approval =
    raw.approval === undefined || raw.approval === null ? null : validateApproval(raw.approval);
  if (approval === null && status !== "DRAFT") {
    throw new FinancialPolicyError(
      "APPROVAL_REQUIRED",
      `a ${status} financial policy requires recorded accounting approval`,
    );
  }

  return Object.freeze({
    operatingCompanyId,
    status: status as ProfileStatus,
    inventoryCostMethod: inventoryCostMethod as InventoryCostMethod,
    serializedInventoryCostMethod: serializedInventoryCostMethod as SerializedCostMethod,
    cogsRecognitionPointId: point.id,
    freightTreatment: freightTreatment as FreightTreatment,
    landedCostTreatment: landedCostTreatment as LandedCostTreatment,
    approval,
  });
}

/**
 * THE LOCK. One place, so no caller can forget it and no screen can be the only thing enforcing it.
 *
 * Called by the command before ANY write. A disabled control is a courtesy; this is the rule.
 */
export function assertProfileMutable(stored: { readonly status?: unknown } | null): void {
  if (stored !== null && stored.status === "LOCKED") {
    throw new FinancialPolicyError(
      "PROFILE_LOCKED",
      "this financial policy is locked because financial authority is active; changing accounting policy requires a governed financial-policy migration",
    );
  }
}
