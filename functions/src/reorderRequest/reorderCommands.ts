// Reorder — the PURE trusted command core (Owner rulings R-13 / R-15 / R-16, 2026-08-30).
//
// Workstream 2B moves exactly TWO writes behind trusted authority: the two that author a governed
// company fact. Everything else in the reorder workflow keeps its existing client-direct path under
// unchanged Rules, because moving it would be rebuilding a working state machine rather than moving
// the authority the new facts require.
//
//   createReorderRequest        derives operatingCompanyId from the governed Warehouse
//   recordReorderPurchaseOrder  copies it from the request onto the PO
//
// PURE: no Firestore, no firebase-functions, no clock. The callable supplies the actor, the time,
// the warehouse read and the transaction; every decision that can be wrong lives here where a test
// can reach it.
//
// ============================ THE COMPANY IS DERIVED, NEVER SUPPLIED ============================
//
// Ruling R-13 as refined: a client-supplied `operatingCompanyId` is REFUSED with an explicit
// forbidden-authority error -- not ignored. Ignoring it would let a caller believe it had set the
// company and be silently wrong, and it would leave the boundary invisible in the API. The refusal
// is the documentation.
//
// ============================ IDENTITY IS INHERITED, NOT REDESIGNED ============================
//
// The PO's document id IS the reorder request's id, its `reorderRequestId` is pinned equal to it,
// and the request's `purchaseOrderId` points back at the same value. That 1:1 contract predates this
// change and survives it unaltered -- no new id is minted, and this is not a multi-line purchasing
// model.

import { resolveOperatingCompany } from "../ownership/operatingCompanyAuthority";

export type ReorderCommandCode =
  | "INVALID"
  | "PART_REQUIRED"
  | "WAREHOUSE_REQUIRED"
  | "WAREHOUSE_NOT_IN_SCOPE"
  | "WAREHOUSE_NOT_GOVERNED"
  | "WAREHOUSE_NO_COMPANY"
  | "COMPANY_NOT_CLIENT_SUPPLIABLE"
  | "QUANTITY_INVALID"
  | "RECOMMENDATION_STATUS_INVALID"
  | "WORK_ORDER_REF_INVALID"
  | "REQUEST_NOT_FOUND"
  | "REQUEST_STATE_INVALID"
  | "REQUEST_NO_COMPANY"
  | "PO_ALREADY_EXISTS"
  | "SUPPLIER_REQUIRED"
  | "PO_FIELD_INVALID"
  | "IDEMPOTENCY_PAYLOAD_MISMATCH";

export class ReorderCommandError extends Error {
  readonly code: ReorderCommandCode;
  constructor(code: ReorderCommandCode, message: string) {
    super(message);
    this.code = code;
    this.name = "ReorderCommandError";
  }
}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

// The two initial statuses the existing client create produces, preserved exactly. This command
// changes WHO may write and WHAT company travels with the record -- not the state machine.
const RECOMMENDATION_STATUSES = ["READY", "NEEDS_PLANNING"] as const;
export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number];

export interface CreateReorderRequestInput {
  partId: string;
  /** The governed Warehouse needing replenishment. REQUIRED (ruling R-13). */
  warehouseId: string;
  recommendationStatus: RecommendationStatus;
  requestedQty: number;
  quantitySource: string;
  urgency?: string | null;
  recommendedQty?: number | null;
  workOrderId?: string | null;
  /**
   * NOT AN INPUT. Declared only so a caller that supplies it is REFUSED rather than silently
   * ignored -- the boundary has to be visible from the API surface.
   */
  operatingCompanyId?: never;
}

export interface BuiltReorderRequest {
  partId: string;
  warehouseId: string;
  operatingCompanyId: string;
  recommendationStatus: RecommendationStatus;
  urgency: string | null;
  quantitySource: string;
  recommendedQty: number | null;
  requestedQty: number;
  status: string;
  currentOwner: string;
  requestedBy: string;
  createdAt: number;
  workOrderId: string | null;
}

/**
 * Build a NEW reorder request.
 *
 * @param warehouseCompanyId the company read from the governed Warehouse by the caller, INSIDE its
 *        transaction. Passed in rather than fetched so this stays pure, and read transactionally so
 *        the company cannot drift between the read and the write.
 */
export function buildCreateReorderRequest(
  input: CreateReorderRequestInput,
  ctx: {
    actorUid: string;
    nowMillis: number;
    warehouseGoverned: boolean;
    warehouseCompanyId: unknown;
    /** R-17. Did the SHARED eligibility resolver (reorderWarehouseEligibility.ts) admit this
     *  warehouse for this principal? REQUIRED, and deliberately not optional-defaulting-true: a
     *  caller that forgets it fails to compile rather than silently skipping the scope check. */
    warehouseInScope: boolean;
  },
): BuiltReorderRequest {
  if (!input || typeof input !== "object") throw new ReorderCommandError("INVALID", "Missing input");

  // FIRST, before anything else: refuse a client-supplied company outright. Checked ahead of the
  // ordinary field validation so the boundary error is what a caller sees, rather than a generic
  // complaint about some other field they got wrong at the same time.
  if ((input as unknown as Record<string, unknown>).operatingCompanyId !== undefined) {
    throw new ReorderCommandError(
      "COMPANY_NOT_CLIENT_SUPPLIABLE",
      "operatingCompanyId is derived from the governed Warehouse and cannot be supplied by a caller.",
    );
  }

  if (!nonEmpty(input.partId)) throw new ReorderCommandError("PART_REQUIRED", "partId is required");
  if (!nonEmpty(input.warehouseId)) {
    throw new ReorderCommandError("WAREHOUSE_REQUIRED", "warehouseId is required -- a reorder replenishes a specific warehouse");
  }
  if (!(RECOMMENDATION_STATUSES as readonly string[]).includes(input.recommendationStatus)) {
    throw new ReorderCommandError("RECOMMENDATION_STATUS_INVALID", "recommendationStatus must be READY or NEEDS_PLANNING");
  }
  if (!isInt(input.requestedQty)) throw new ReorderCommandError("QUANTITY_INVALID", "requestedQty must be a whole number");
  if (input.recommendationStatus === "NEEDS_PLANNING" && input.requestedQty <= 0) {
    throw new ReorderCommandError("QUANTITY_INVALID", "A manually entered quantity must be greater than zero");
  }
  if (!nonEmpty(input.quantitySource)) throw new ReorderCommandError("INVALID", "quantitySource is required");
  if (input.workOrderId != null && !nonEmpty(input.workOrderId)) {
    throw new ReorderCommandError("WORK_ORDER_REF_INVALID", "workOrderId, when provided, must be a non-empty Work Order id");
  }

  // R-17 -- THE SELECTOR IS UX, THIS IS ENFORCEMENT.
  //
  // Checked BEFORE the governed/company facts, so a caller who posts a warehouse outside their scope
  // learns that and nothing else. Telling them instead that the warehouse is ungoverned, or has no
  // company, would answer a question about a warehouse they are not entitled to ask about.
  //
  // The scope comes from the same resolver listReorderWarehouseOptions filters by, which is what
  // makes the ruling's invariant hold in both directions: everything offered is accepted, and
  // nothing unoffered is accepted just because it was typed instead of clicked.
  if (!ctx.warehouseInScope) {
    throw new ReorderCommandError(
      "WAREHOUSE_NOT_IN_SCOPE",
      `You are not authorized to raise a reorder for warehouse "${input.warehouseId}"`,
    );
  }

  // The warehouse must be a governed, ACTIVE warehouse -- resolved by the caller through the
  // existing receiving-location authority, not by a second opinion invented here.
  if (!ctx.warehouseGoverned) {
    throw new ReorderCommandError(
      "WAREHOUSE_NOT_GOVERNED",
      `warehouseId "${input.warehouseId}" is not a governed ACTIVE warehouse`,
    );
  }
  // And it must carry a governed company. Today no sandbox warehouse does, so this REFUSES rather
  // than inventing one -- which is the correct answer until the physical roots are populated.
  const company = ctx.warehouseCompanyId;
  if (!nonEmpty(company) || resolveOperatingCompany(company).company === null) {
    throw new ReorderCommandError(
      "WAREHOUSE_NO_COMPANY",
      `warehouse "${input.warehouseId}" carries no governed operatingCompanyId, so a reorder against it has no owner`,
    );
  }

  return {
    partId: input.partId.trim(),
    warehouseId: input.warehouseId.trim(),
    operatingCompanyId: company.trim(),
    recommendationStatus: input.recommendationStatus,
    urgency: nonEmpty(input.urgency) ? input.urgency.trim() : null,
    quantitySource: input.quantitySource.trim(),
    recommendedQty: isInt(input.recommendedQty) ? input.recommendedQty : null,
    requestedQty: input.requestedQty,
    // Unchanged initial state, matching what the client path produced.
    status: input.recommendationStatus === "READY" ? "READY_FOR_PARTS_MANAGER" : "PENDING_REVIEW",
    currentOwner: "INVENTORY",
    // The ACTOR. Deliberately not the owner: company responsibility is the warehouse's, and who
    // asked is a different fact from who is responsible.
    requestedBy: ctx.actorUid,
    createdAt: ctx.nowMillis,
    workOrderId: nonEmpty(input.workOrderId) ? input.workOrderId.trim() : null,
  };
}

// ============================ RECORD PURCHASE ORDER ============================

/** The state a request must be in for its PO to be recorded. Unchanged from the retired Rules branch. */
export const PO_RECORDABLE_STATUS = "PURCHASING_IN_PROGRESS";

export interface RecordReorderPurchaseOrderInput {
  reorderRequestId: string;
  supplierName: string;
  externalPoNumber: string;
  orderedQuantity: number;
  orderedDate: string;
  expectedArrivalDate?: string | null;
  /** NOT AN INPUT -- the company is the request's. Declared so supplying it is refused. */
  operatingCompanyId?: never;
}

export interface BuiltReorderPurchaseOrder {
  reorderRequestId: string;
  partId: string;
  operatingCompanyId: string;
  supplierName: string;
  externalPoNumber: string;
  orderedQuantity: number;
  orderedDate: string;
  expectedArrivalDate: string | null;
  status: "ORDERED";
  createdBy: string;
  createdAt: number;
}

/** The patch applied to the request in the SAME transaction. Neither half lands without the other. */
export interface OrderedRequestPatch {
  status: "ORDERED";
  purchaseOrderId: string;
  orderedBy: string;
  orderedAt: number;
}

export interface RecordPoResult {
  purchaseOrder: BuiltReorderPurchaseOrder;
  requestPatch: OrderedRequestPatch;
}

/**
 * Build the PO and its paired request transition.
 *
 * Returns BOTH halves together, deliberately. The invariant migrating out of Rules (R-16) is that
 * neither exists without the other, and a builder that could produce one alone would make the
 * caller responsible for remembering the pairing. Here it is impossible to have one and not the
 * other before the transaction even opens.
 *
 * @param request the reorder request document, read by the caller inside the transaction.
 */
export function buildRecordReorderPurchaseOrder(
  input: RecordReorderPurchaseOrderInput,
  request: Record<string, unknown> | null,
  ctx: { actorUid: string; nowMillis: number; purchaseOrderExists: boolean },
): RecordPoResult {
  if (!input || typeof input !== "object") throw new ReorderCommandError("INVALID", "Missing input");
  if ((input as unknown as Record<string, unknown>).operatingCompanyId !== undefined) {
    throw new ReorderCommandError(
      "COMPANY_NOT_CLIENT_SUPPLIABLE",
      "operatingCompanyId is inherited from the reorder request and cannot be supplied by a caller.",
    );
  }
  if (!nonEmpty(input.reorderRequestId)) throw new ReorderCommandError("INVALID", "reorderRequestId is required");
  if (request === null) throw new ReorderCommandError("REQUEST_NOT_FOUND", `No reorder request ${input.reorderRequestId}`);

  if (request.status !== PO_RECORDABLE_STATUS) {
    throw new ReorderCommandError(
      "REQUEST_STATE_INVALID",
      `reorder request is ${String(request.status)}, not ${PO_RECORDABLE_STATUS}`,
    );
  }
  // 1:1 is enforced by identity, and this is the guard that says so out loud.
  if (ctx.purchaseOrderExists) {
    throw new ReorderCommandError("PO_ALREADY_EXISTS", "this reorder request already has a purchase order");
  }

  // The company is INHERITED from the historical request -- not re-derived from the warehouse.
  // Re-deriving would silently rewrite history if the warehouse were later reassigned.
  const company = request.operatingCompanyId;
  if (!nonEmpty(company) || resolveOperatingCompany(company).company === null) {
    throw new ReorderCommandError(
      "REQUEST_NO_COMPANY",
      "the reorder request carries no governed operatingCompanyId, so its purchase order would have no owner",
    );
  }
  if (!nonEmpty(request.partId)) throw new ReorderCommandError("REQUEST_STATE_INVALID", "the reorder request has no partId");

  if (!nonEmpty(input.supplierName)) throw new ReorderCommandError("SUPPLIER_REQUIRED", "supplierName is required");
  if (!nonEmpty(input.externalPoNumber)) throw new ReorderCommandError("PO_FIELD_INVALID", "externalPoNumber is required");
  if (typeof input.orderedQuantity !== "number" || !(input.orderedQuantity > 0)) {
    throw new ReorderCommandError("PO_FIELD_INVALID", "orderedQuantity must be greater than zero");
  }
  if (!nonEmpty(input.orderedDate)) throw new ReorderCommandError("PO_FIELD_INVALID", "orderedDate is required");
  if (input.expectedArrivalDate != null && !nonEmpty(input.expectedArrivalDate)) {
    throw new ReorderCommandError("PO_FIELD_INVALID", "expectedArrivalDate, when provided, must be a non-empty string");
  }

  const requestId = input.reorderRequestId.trim();
  return {
    purchaseOrder: {
      // Pinned equal to the document id the caller will use. Identity unchanged (R-16).
      reorderRequestId: requestId,
      partId: request.partId.trim(),
      operatingCompanyId: company.trim(),
      supplierName: input.supplierName.trim(),
      externalPoNumber: input.externalPoNumber.trim(),
      orderedQuantity: input.orderedQuantity,
      orderedDate: input.orderedDate.trim(),
      expectedArrivalDate: nonEmpty(input.expectedArrivalDate) ? input.expectedArrivalDate.trim() : null,
      status: "ORDERED",
      createdBy: ctx.actorUid,
      createdAt: ctx.nowMillis,
    },
    requestPatch: {
      status: "ORDERED",
      // The forward link, equal to the PO's id and to the request's own id.
      purchaseOrderId: requestId,
      orderedBy: ctx.actorUid,
      orderedAt: ctx.nowMillis,
    },
  };
}

/**
 * The fingerprint an idempotency key is bound to.
 *
 * Ruling: a retry with the SAME key and a materially different payload must be REFUSED, not
 * silently treated as the original. So the key alone is not the identity -- the key plus what it
 * was used to say is. Field order is fixed, and only the fields that change the record are
 * included, so a cosmetic difference cannot manufacture a mismatch.
 *
 * SEPARATED by U+001F, not concatenated. Joining on "" would let field boundaries move without
 * changing the result -- ["ab","c"] and ["a","bc"] would fingerprint identically, so a retry that
 * shifted a value across two fields would replay as though it were the original. The unit separator
 * cannot occur in a part id, a warehouse id, a date or a supplier name, so no value can forge a
 * boundary. `null` is marked with U+0000 rather than "": an absent field is not an empty one.
 */
export function commandFingerprint(parts: readonly (string | number | null)[]): string {
  return parts.map((p) => (p === null ? "\u0000" : String(p))).join("\u001F");
}
