// LEGACY PURCHASING FIRESTORE DOCUMENT -> eos_ops PURCHASING ROW: the MAPPING CONTRACT.
//
// MIGRATION_ONLY. Sibling of legacyInventoryMovementMapping.ts, and held to the same rules: pure,
// no Firebase, no Firestore, no Postgres connection, no `pg` client, no clock, no randomness. It
// transforms exactly one legacy document DTO into either
//
//   (A) a validated CANDIDATE row for migration 008's tables, or
//   (B) an explicit, typed REFUSAL carrying enough non-secret evidence for a reject bucket.
//
// It NEVER returns undefined/null as an implicit reject: every input yields one or the other.
// Reading the source store, writing Postgres, the reject bucket itself, tenant resolution and the
// cutover are all OUT OF SCOPE and deliberately absent.
//
// ============================ WHY A SEPARATE MAPPING BOUNDARY ============================
//
// Because the legacy purchasing documents and the target tables disagree in five places, and each
// disagreement is a way to silently launder governance out of the record if the import "just copies
// the fields":
//
//   1. THE PURCHASE ORDER'S IDENTITY IS STATED THREE TIMES. The Firestore document id, its own
//      `reorderRequestId` field, and the request's `purchaseOrderId` back-link are all pinned equal
//      by ruling R-16 — but they are three values, and only a command kept them in step. Migration
//      008 collapses them into ONE column. An import that trusted any one of them alone would carry
//      a disagreement into a schema that can no longer express it, silently choosing a winner. So
//      all three are compared here and any disagreement is a REFUSAL.
//
//   2. THE PRICE STAMP CAN OUTRUN THE PRICE. normalizeLegacyPurchaseOrder already refuses a document
//      that "claims the price authority but carries no governed price" — reading it as unpriced
//      "would turn a corrupt record into a free one". The same refusal is re-applied here, because
//      a reader's refusal protects the read path and an importer's refusal protects the authority.
//
//   3. DATES ARE STRINGS. `orderedDate` / `expectedArrivalDate` are free strings in Firestore and
//      DATE columns in Postgres. A string that is not an ISO calendar day is REFUSED, never coerced
//      or parsed by a locale-dependent Date constructor that would turn "03/04/2026" into whichever
//      of March and April the runtime happened to prefer.
//
//   4. THE TRANSFER ORDER'S COMPANY IS A DIRECTIONAL PAIR, NOT A SCALAR. Both halves are required,
//      neither may be substituted for the other, and no scalar owner is ever synthesized from one.
//
//   5. THE TRANSFER ORDER STATES ITS ENDPOINTS TWICE. Typed `origin`/`destination` on every record,
//      plus legacy `fromWarehouseId`/`toWarehouseId` on the WAREHOUSE->WAREHOUSE subset. The target
//      schema keeps only the typed refs (migration 008's header says why). Before dropping the
//      scalars, this mapper PROVES per record that they agree — a census that measured zero
//      disagreements is evidence about a moment, not a guarantee about a row.
//
// ============================ THE COMPANY IS NEVER INFERRED ============================
//
// Not from a warehouse, not from a supplier, not from a part, not from a user, not from a location
// name, and not from the other half of a transfer's pair. Every mapper takes the governed key(s)
// from the SOURCE DOCUMENT and refuses when absent (MISSING_OPERATING_COMPANY /
// MISSING_PARTICIPATING_COMPANY). That is the import-time expression of the same ruling the
// commands enforce at write time: `operatingCompanyId` is derived by the authority that owns it, is
// never client-supplied, and is never manufactured when missing.
//
// ============================ PART ID ============================
//
// `part_id` is the canonical `Part.partId` and nothing else. This module does NOT own
// canonicalization and does NOT invent a second one: it takes an injected `PartIdAuthority` whose
// DEFAULT is `requireCanonicalPartId` from partIdContract.ts, exactly as
// legacyInventoryMovementMapping.ts does. An import run that injects nothing still gets canonical
// validation.

import { isOperatingCompanyIdShape } from "../../ownership/operatingCompanyAuthority.js";
import { requireCanonicalPartId } from "./partIdContract.js";

// ---------------------------------------------------------------------------------------------
// Target vocabulary (mirrors migrations/1758672000000_purchasing-object-authority.sql, which this
// module must not and does not modify -- the schema is owned elsewhere).
// ---------------------------------------------------------------------------------------------

export const OPS_REORDER_REQUEST_STATUSES = [
  "PENDING_REVIEW", "APPROVED", "REJECTED",
  "READY_FOR_PARTS_MANAGER", "ASSIGNED_TO_PARTS_ASSOCIATE", "PURCHASING_IN_PROGRESS",
  "ORDERED", "RECEIVED", "CANCELLED", "VOIDED",
] as const;
export type OpsReorderRequestStatus = (typeof OPS_REORDER_REQUEST_STATUSES)[number];

export const OPS_RECEIVING_ORDER_STATUSES = ["EXPECTED", "CHECKED_IN", "PUTAWAY_COMPLETE", "CANCELLED"] as const;
export type OpsReceivingOrderStatus = (typeof OPS_RECEIVING_ORDER_STATUSES)[number];

export const OPS_RECEIVING_SOURCE_KINDS = ["REORDER_PURCHASE_ORDER", "PURCHASE_ORDER"] as const;
export type OpsReceivingSourceKind = (typeof OPS_RECEIVING_SOURCE_KINDS)[number];

export const OPS_TRANSFER_ORDER_STATUSES = ["REQUESTED", "IN_TRANSIT", "COMPLETED", "CANCELLED"] as const;
export type OpsTransferOrderStatus = (typeof OPS_TRANSFER_ORDER_STATUSES)[number];

/** `ops_location_type` — PHYSICAL ONLY. Narrower than the client's INVENTORY_LOCATION_TYPES. */
export const OPS_LOCATION_TYPES = ["WAREHOUSE", "BIN", "MOBILE"] as const;
export type OpsLocationType = (typeof OPS_LOCATION_TYPES)[number];

/** `ops_tracking_mode` — NONE | SERIAL. LOT is deliberately absent and is an explicit refusal. */
export const OPS_TRACKING_MODES = ["NONE", "SERIAL"] as const;
export type OpsTrackingMode = (typeof OPS_TRACKING_MODES)[number];

// ---------------------------------------------------------------------------------------------
// Refusal taxonomy
// ---------------------------------------------------------------------------------------------

/**
 * Stable refusal codes. STABLE means a reject-bucket row written today still reads correctly after
 * this file changes, so codes are never renamed or reused for a different meaning.
 */
export const PURCHASING_REFUSAL_CODES = [
  /** The DTO is not an object at all. */
  "INVALID_SOURCE_ROW",
  /** No usable document id. Every target row is keyed, and a keyless source cannot produce one. */
  "MISSING_DOCUMENT_ID",
  /** No governed operating company on the source record. NEVER inferred, never defaulted. */
  "MISSING_OPERATING_COMPANY",
  /** Present but not a governed operating-company id shape (operatingCompanyAuthority.ts). */
  "INVALID_OPERATING_COMPANY",
  /**
   * A transfer order carrying only one half of its directional pair. Refused rather than completed
   * from the other half: "both or neither, never a scalar owner" (ownershipBackfillRules.ts), and a
   * synthesized second company would assert a participation nobody recorded.
   */
  "MISSING_PARTICIPATING_COMPANY",
  /** part_id absent, or not the canonical Part.partId (partIdContract.ts). */
  "INVALID_PART_ID",
  /** A quantity that is absent, non-integer, or outside what the target column accepts. */
  "INVALID_QUANTITY",
  /** A status string outside the target enum. FAIL CLOSED: an unknown state has no known meaning. */
  "UNKNOWN_STATUS",
  /** A tracking mode outside NONE|SERIAL — LOT included, which is deferred, not coercible. */
  "UNSUPPORTED_TRACKING_MODE",
  /** A location type outside WAREHOUSE|BIN|MOBILE, or a malformed location ref. */
  "INVALID_LOCATION",
  /**
   * THE IDENTITY RULING. The purchase order's document id, its `reorderRequestId`, and (where the
   * request was supplied) the request's `purchaseOrderId` do not all name the same record.
   */
  "PO_IDENTITY_MISMATCH",
  /** A purchase order that claims the price authority but carries no governed price. */
  "PO_PRICE_MISSING",
  /** An amount without a currency, a currency without an amount, or a non-integer minor amount. */
  "INVALID_PRICE",
  /** A date field that is not an ISO yyyy-mm-dd calendar day. Never coerced. */
  "INVALID_DATE",
  /** Required text (supplier name, external PO number, void reason) absent or blank. */
  "MISSING_REQUIRED_TEXT",
  /** A receipt whose source kind is outside the closed discriminator. */
  "UNKNOWN_RECEIVING_SOURCE",
  /** A legacy receipt whose reorderRequestId is not its purchaseOrderId, or a canonical one carrying one. */
  "RECEIVING_SOURCE_IDENTITY_MISMATCH",
  /** A receipt with no lines, a duplicate line id, or a line whose serials contradict its tracking mode. */
  "INVALID_RECEIPT_LINES",
  /**
   * A transfer order whose legacy fromWarehouseId/toWarehouseId disagree with its typed
   * origin/destination. The scalars are being RETIRED, and a retirement that silently discarded a
   * disagreement would destroy the only evidence that the two ever differed.
   */
  "LEGACY_ENDPOINT_DISAGREEMENT",
  /** Origin and destination are the same place. A transfer between one place and itself moves nothing. */
  "TRANSFER_ENDPOINTS_IDENTICAL",
  /** A serial set that does not match the record's quantity, or contains duplicates/blanks. */
  "INVALID_SERIAL_SET",
] as const;
export type PurchasingRefusalCode = (typeof PURCHASING_REFUSAL_CODES)[number];

export interface MappingRefusal {
  readonly ok: false;
  readonly code: PurchasingRefusalCode;
  /** Non-secret evidence for a reject bucket: which document, which field, what was wrong. */
  readonly documentId: string | null;
  readonly detail: string;
}

export type MappingResult<T> = { readonly ok: true; readonly row: T } | MappingRefusal;

const refuse = (code: PurchasingRefusalCode, documentId: string | null, detail: string): MappingRefusal =>
  Object.freeze({ ok: false as const, code, documentId, detail });

// ---------------------------------------------------------------------------------------------
// Injected seams and shared primitives
// ---------------------------------------------------------------------------------------------

/**
 * The part-id gate. Returns the value UNCHANGED or throws. The DEFAULT is the canonical contract, so
 * shape-only is never the production default — a caller must ask for something weaker explicitly.
 */
export type PartIdAuthority = (value: unknown, context?: string) => string;
export const canonicalPartIdAuthority: PartIdAuthority = requireCanonicalPartId;

export interface MappingOptions {
  readonly partIdAuthority?: PartIdAuthority;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

/**
 * ISO CALENDAR DAY, exactly.
 *
 * Deliberately NOT `new Date(value)`: that accepts "03/04/2026", "March 4", and a full timestamp,
 * and resolves each by rules that depend on the runtime and the offset it happens to be in. An
 * ordered date that shifted by a day during import would be indistinguishable afterwards from one
 * the buyer actually entered. The round-trip check rejects impossible days ("2026-02-31") that the
 * regex alone would accept.
 */
function isoCalendarDay(value: unknown): string | null {
  const s = text(value);
  if (s === null || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const parsed = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === s ? s : null;
}

/** Governed operating-company shape. MEMBERSHIP is the authority layer's answer, not this module's. */
function companyKey(
  value: unknown,
  documentId: string | null,
  field: string,
  missingCode: PurchasingRefusalCode,
): { ok: true; key: string } | MappingRefusal {
  const s = text(value);
  if (s === null) return refuse(missingCode, documentId, `${field} is absent and is never inferred`);
  if (!isOperatingCompanyIdShape(s)) {
    return refuse("INVALID_OPERATING_COMPANY", documentId, `${field} is not a governed operating company id`);
  }
  return { ok: true, key: s };
}

function locationRef(
  value: unknown,
  documentId: string | null,
  field: string,
): { ok: true; type: OpsLocationType; id: string } | MappingRefusal {
  if (!isObject(value)) return refuse("INVALID_LOCATION", documentId, `${field} is not a location ref`);
  const type = text(value.type);
  const id = text(value.locationId) ?? text(value.id);
  if (type === null || !(OPS_LOCATION_TYPES as readonly string[]).includes(type)) {
    // Widening the physical vocabulary is a schema decision, not an import decision. VENDOR,
    // CUSTOMER and VIRTUAL endpoints are refused rather than mapped to a "closest" physical place.
    return refuse("INVALID_LOCATION", documentId, `${field}.type ${String(type)} is not a physical location type`);
  }
  if (id === null) return refuse("INVALID_LOCATION", documentId, `${field}.locationId is absent`);
  return { ok: true, type: type as OpsLocationType, id };
}

function serialSet(
  value: unknown,
  quantity: number,
  trackingMode: OpsTrackingMode,
  documentId: string | null,
): { ok: true; serials: readonly string[] } | MappingRefusal {
  if (trackingMode === "NONE") {
    if (value !== undefined && !(Array.isArray(value) && value.length === 0)) {
      return refuse("INVALID_SERIAL_SET", documentId, "a NONE-tracked record carries no serial numbers");
    }
    return { ok: true, serials: [] };
  }
  if (!Array.isArray(value)) {
    return refuse("INVALID_SERIAL_SET", documentId, "a SERIAL record must carry its serial numbers");
  }
  const serials = value.map((s) => text(s));
  if (serials.some((s) => s === null)) {
    return refuse("INVALID_SERIAL_SET", documentId, "a serial number is blank or not a string");
  }
  const clean = serials as string[];
  // One physical unit, one serial. A count that disagrees with the quantity means the record cannot
  // say which units it describes, and picking one reading would invent custody evidence.
  if (clean.length !== quantity) {
    return refuse("INVALID_SERIAL_SET", documentId, `serial count ${clean.length} does not match quantity ${quantity}`);
  }
  if (new Set(clean).size !== clean.length) {
    return refuse("INVALID_SERIAL_SET", documentId, "serial numbers contain duplicates");
  }
  return { ok: true, serials: clean };
}

function partId(
  value: unknown,
  documentId: string | null,
  authority: PartIdAuthority,
  context: string,
): { ok: true; partId: string } | MappingRefusal {
  try {
    return { ok: true, partId: authority(value, context) };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "part id refused";
    return refuse("INVALID_PART_ID", documentId, reason);
  }
}

// ---------------------------------------------------------------------------------------------
// Reorder Request
// ---------------------------------------------------------------------------------------------

export interface ReorderRequestRow {
  readonly id: string;
  readonly operatingCompanyKey: string;
  readonly partId: string;
  readonly warehouseId: string;
  readonly status: OpsReorderRequestStatus;
  readonly requestedQuantity: number;
  readonly recommendedQuantity: number | null;
  readonly workOrderId: string | null;
  readonly reorderRequestNumber: string | null;
  readonly requestedBy: string;
}

export function mapLegacyReorderRequest(
  documentId: unknown,
  data: unknown,
  options: MappingOptions = {},
): MappingResult<ReorderRequestRow> {
  const id = text(documentId);
  if (!isObject(data)) return refuse("INVALID_SOURCE_ROW", id, "source document is not an object");
  if (id === null) return refuse("MISSING_DOCUMENT_ID", null, "reorder request has no document id");

  const company = companyKey(data.operatingCompanyId, id, "operatingCompanyId", "MISSING_OPERATING_COMPANY");
  if (company.ok !== true) return company;

  const part = partId(data.partId, id, options.partIdAuthority ?? canonicalPartIdAuthority, "reorder_requests.part_id");
  if (part.ok !== true) return part;

  const warehouseId = text(data.warehouseId);
  if (warehouseId === null) {
    return refuse("MISSING_REQUIRED_TEXT", id, "warehouseId is required -- a reorder replenishes a specific warehouse");
  }
  const status = text(data.status);
  if (status === null || !(OPS_REORDER_REQUEST_STATUSES as readonly string[]).includes(status)) {
    return refuse("UNKNOWN_STATUS", id, `status ${String(status)} is not a governed reorder request status`);
  }
  // >= 0, matching the column. The stricter "a manually entered quantity must be greater than zero"
  // rule belongs to the CREATE command and is not re-litigated against historical records here.
  if (!isInt(data.requestedQty) || (data.requestedQty as number) < 0) {
    return refuse("INVALID_QUANTITY", id, "requestedQty must be a whole number >= 0");
  }
  if (data.recommendedQty != null && !isInt(data.recommendedQty)) {
    return refuse("INVALID_QUANTITY", id, "recommendedQty, when present, must be a whole number");
  }
  const requestedBy = text(data.requestedBy);
  if (requestedBy === null) return refuse("MISSING_REQUIRED_TEXT", id, "requestedBy is required");

  const number = text(data.reorderRequestNumber);
  if (number !== null && !/^RR-[0-9]{4}-[0-9]{6,}$/.test(number)) {
    // Never normalized into validity, and never replaced with the document id: an absent reference is
    // a true fact about a legacy record, but a MALFORMED one is a corrupt record.
    return refuse("MISSING_REQUIRED_TEXT", id, "reorderRequestNumber is present but malformed");
  }

  return {
    ok: true,
    row: Object.freeze({
      id,
      operatingCompanyKey: company.key,
      partId: part.partId,
      warehouseId,
      status: status as OpsReorderRequestStatus,
      requestedQuantity: data.requestedQty as number,
      recommendedQuantity: isInt(data.recommendedQty) ? (data.recommendedQty as number) : null,
      workOrderId: text(data.workOrderId),
      reorderRequestNumber: number,
      requestedBy,
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// Purchase Order
// ---------------------------------------------------------------------------------------------

export interface PurchaseOrderRow {
  /** IS the reorder request id. One value, because the target has one column. */
  readonly id: string;
  readonly operatingCompanyKey: string;
  readonly partId: string;
  readonly supplierName: string;
  readonly externalPoNumber: string;
  readonly orderedQuantity: number;
  readonly orderedDate: string;
  readonly expectedArrivalDate: string | null;
  readonly unitPriceMinor: number | null;
  readonly currency: string | null;
  readonly priceAuthorityVersion: number | null;
  readonly createdBy: string;
}

/**
 * A legacy `reorder_purchase_orders` document -> the purchase order row.
 *
 * `requestBackLink` is the REQUEST's own `purchaseOrderId`, supplied by the import when it has the
 * request in hand. It is optional because an import may process purchase orders without their
 * requests loaded — but when it IS supplied it is CHECKED, because the third statement of the
 * identity is the one most likely to have drifted and the one the target schema will no longer be
 * able to express.
 */
export function mapLegacyPurchaseOrder(
  documentId: unknown,
  data: unknown,
  options: MappingOptions & { readonly requestBackLink?: unknown } = {},
): MappingResult<PurchaseOrderRow> {
  const id = text(documentId);
  if (!isObject(data)) return refuse("INVALID_SOURCE_ROW", id, "source document is not an object");
  if (id === null) return refuse("MISSING_DOCUMENT_ID", null, "purchase order has no document id");

  // ---- THE IDENTITY RULING (R-16), checked across every statement of it that is available ----
  const storedRequestId = text(data.reorderRequestId);
  if (storedRequestId === null) {
    return refuse("PO_IDENTITY_MISMATCH", id, "purchase order carries no reorderRequestId");
  }
  if (storedRequestId !== id) {
    return refuse(
      "PO_IDENTITY_MISMATCH",
      id,
      `document id and reorderRequestId ${storedRequestId} disagree; the target schema has one column for both`,
    );
  }
  if (options.requestBackLink !== undefined) {
    const backLink = text(options.requestBackLink);
    if (backLink !== id) {
      return refuse(
        "PO_IDENTITY_MISMATCH",
        id,
        `the reorder request's purchaseOrderId ${String(backLink)} does not name this purchase order`,
      );
    }
  }

  const company = companyKey(data.operatingCompanyId, id, "operatingCompanyId", "MISSING_OPERATING_COMPANY");
  if (company.ok !== true) return company;

  const part = partId(data.partId, id, options.partIdAuthority ?? canonicalPartIdAuthority, "purchase_orders.part_id");
  if (part.ok !== true) return part;

  const supplierName = text(data.supplierName);
  if (supplierName === null) return refuse("MISSING_REQUIRED_TEXT", id, "supplierName is required");
  const externalPoNumber = text(data.externalPoNumber);
  if (externalPoNumber === null) return refuse("MISSING_REQUIRED_TEXT", id, "externalPoNumber is required");
  if (!isInt(data.orderedQuantity) || (data.orderedQuantity as number) <= 0) {
    return refuse("INVALID_QUANTITY", id, "orderedQuantity must be a whole number greater than zero");
  }
  const orderedDate = isoCalendarDay(data.orderedDate);
  if (orderedDate === null) {
    return refuse("INVALID_DATE", id, "orderedDate is not an ISO yyyy-mm-dd calendar day");
  }
  let expectedArrivalDate: string | null = null;
  if (data.expectedArrivalDate != null) {
    expectedArrivalDate = isoCalendarDay(data.expectedArrivalDate);
    if (expectedArrivalDate === null) {
      return refuse("INVALID_DATE", id, "expectedArrivalDate is present but not an ISO yyyy-mm-dd calendar day");
    }
  }

  // ---- FIN-BLOCK-003A: the amount and its currency move together; a stamp implies a price ----
  const hasAmount = data.unitPriceMinor !== undefined && data.unitPriceMinor !== null;
  const hasCurrency = data.currency !== undefined && data.currency !== null;
  if (hasAmount !== hasCurrency) {
    return refuse("INVALID_PRICE", id, "a committed price is an amount AND a currency, or neither");
  }
  let unitPriceMinor: number | null = null;
  let currency: string | null = null;
  if (hasAmount) {
    // Integer MINOR units. A float here is the defect the whole authority exists to prevent, and it
    // is refused rather than rounded.
    if (!isInt(data.unitPriceMinor) || (data.unitPriceMinor as number) < 0) {
      return refuse("INVALID_PRICE", id, "unitPriceMinor must be a non-negative integer in minor units");
    }
    const cur = text(data.currency);
    if (cur === null || !/^[A-Z]{3}$/.test(cur)) {
      return refuse("INVALID_PRICE", id, "currency must be a three-letter uppercase code");
    }
    unitPriceMinor = data.unitPriceMinor as number;
    currency = cur;
  }
  let priceAuthorityVersion: number | null = null;
  if (data.priceAuthorityVersion !== undefined && data.priceAuthorityVersion !== null) {
    if (!isInt(data.priceAuthorityVersion) || (data.priceAuthorityVersion as number) < 1) {
      return refuse("INVALID_PRICE", id, "priceAuthorityVersion must be a positive whole number");
    }
    priceAuthorityVersion = data.priceAuthorityVersion as number;
  }
  // The one-directional implication. Stamp without price is INCOHERENT and refused; price without
  // stamp is a pre-authority record, which is legal and stays receivable.
  if (priceAuthorityVersion !== null && unitPriceMinor === null) {
    return refuse("PO_PRICE_MISSING", id, "purchase order claims the price authority but carries no governed price");
  }

  const createdBy = text(data.createdBy);
  if (createdBy === null) return refuse("MISSING_REQUIRED_TEXT", id, "createdBy is required");

  return {
    ok: true,
    row: Object.freeze({
      id,
      operatingCompanyKey: company.key,
      partId: part.partId,
      supplierName,
      externalPoNumber,
      orderedQuantity: data.orderedQuantity as number,
      orderedDate,
      expectedArrivalDate,
      unitPriceMinor,
      currency,
      priceAuthorityVersion,
      createdBy,
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// Purchase Order Void
// ---------------------------------------------------------------------------------------------

export interface PurchaseOrderVoidRow {
  readonly purchaseOrderId: string;
  readonly operatingCompanyKey: string;
  readonly partId: string;
  readonly reason: string;
  readonly voidedBy: string;
}

/**
 * A legacy `reorder_purchase_order_voids` document -> the void row.
 *
 * The void record's own document id IS the reorderRequestId, which IS the purchase order id, and the
 * stored `reorderRequestId` / `reorderPurchaseOrderId` fields are both pinned equal to it by the
 * Rules contract. All three are checked, for the same reason the purchase order's three are: the
 * target has ONE column and cannot carry a disagreement forward.
 *
 * `operatingCompanyId` is required here rather than copied from the purchase order at import time,
 * because a void that could not state whose purchase it cancels is not evidence.
 */
export function mapLegacyPurchaseOrderVoid(
  documentId: unknown,
  data: unknown,
  options: MappingOptions = {},
): MappingResult<PurchaseOrderVoidRow> {
  const id = text(documentId);
  if (!isObject(data)) return refuse("INVALID_SOURCE_ROW", id, "source document is not an object");
  if (id === null) return refuse("MISSING_DOCUMENT_ID", null, "void record has no document id");

  const storedRequestId = text(data.reorderRequestId);
  const storedPoId = text(data.reorderPurchaseOrderId);
  if (storedRequestId !== id || storedPoId !== id) {
    return refuse(
      "PO_IDENTITY_MISMATCH",
      id,
      "the void record's document id, reorderRequestId and reorderPurchaseOrderId must all name one record",
    );
  }

  const company = companyKey(data.operatingCompanyId, id, "operatingCompanyId", "MISSING_OPERATING_COMPANY");
  if (company.ok !== true) return company;

  const part = partId(data.partId, id, options.partIdAuthority ?? canonicalPartIdAuthority, "purchase_order_voids.part_id");
  if (part.ok !== true) return part;

  const reason = text(data.reason);
  if (reason === null) {
    return refuse("MISSING_REQUIRED_TEXT", id, "a void records why, or it records nothing");
  }
  const voidedBy = text(data.voidedBy);
  if (voidedBy === null) return refuse("MISSING_REQUIRED_TEXT", id, "voidedBy is required");

  return {
    ok: true,
    row: Object.freeze({
      purchaseOrderId: id,
      operatingCompanyKey: company.key,
      partId: part.partId,
      reason,
      voidedBy,
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// Receiving Order
// ---------------------------------------------------------------------------------------------

export interface ReceivingLineRow {
  readonly lineId: string;
  readonly partId: string;
  readonly trackingMode: OpsTrackingMode;
  readonly expectedQuantity: number;
  readonly receivedQuantity: number;
  readonly serialNumbers: readonly string[];
}

export interface ReceivingOrderRow {
  readonly id: string;
  readonly operatingCompanyKey: string;
  readonly sourceKind: OpsReceivingSourceKind;
  readonly purchaseOrderId: string;
  readonly reorderRequestId: string | null;
  readonly receivingLocationType: OpsLocationType;
  readonly receivingLocationId: string;
  readonly status: OpsReceivingOrderStatus;
  readonly receivingOrderNumber: string | null;
  readonly idempotencyKey: string;
  readonly createdBy: string;
  readonly lines: readonly ReceivingLineRow[];
}

export function mapLegacyReceivingOrder(
  documentId: unknown,
  data: unknown,
  options: MappingOptions = {},
): MappingResult<ReceivingOrderRow> {
  const id = text(documentId);
  if (!isObject(data)) return refuse("INVALID_SOURCE_ROW", id, "source document is not an object");
  if (id === null) return refuse("MISSING_DOCUMENT_ID", null, "receiving order has no document id");

  const company = companyKey(data.operatingCompanyId, id, "operatingCompanyId", "MISSING_OPERATING_COMPANY");
  if (company.ok !== true) return company;

  const source = isObject(data.source) ? data.source : null;
  if (source === null) return refuse("UNKNOWN_RECEIVING_SOURCE", id, "receiving order carries no source ref");
  const sourceKind = text(source.type);
  if (sourceKind === null || !(OPS_RECEIVING_SOURCE_KINDS as readonly string[]).includes(sourceKind)) {
    // The discriminator is STATED, never sniffed from which collection an id happens to resolve in.
    return refuse("UNKNOWN_RECEIVING_SOURCE", id, `source.type ${String(sourceKind)} is not a governed source kind`);
  }
  const purchaseOrderId = text(source.purchaseOrderId);
  if (purchaseOrderId === null) return refuse("MISSING_REQUIRED_TEXT", id, "source.purchaseOrderId is required");
  const reorderRequestId = text(source.reorderRequestId);
  const legacy = sourceKind === "REORDER_PURCHASE_ORDER";
  if (legacy && reorderRequestId !== purchaseOrderId) {
    return refuse(
      "RECEIVING_SOURCE_IDENTITY_MISMATCH",
      id,
      "a legacy receipt's reorderRequestId IS its purchaseOrderId",
    );
  }
  if (!legacy && reorderRequestId !== null) {
    return refuse(
      "RECEIVING_SOURCE_IDENTITY_MISMATCH",
      id,
      "a canonical purchase order has no reorder request; absence is the true statement",
    );
  }

  const location = locationRef(data.receivingLocation, id, "receivingLocation");
  if (location.ok !== true) return location;

  const status = text(data.status);
  if (status === null || !(OPS_RECEIVING_ORDER_STATUSES as readonly string[]).includes(status)) {
    return refuse("UNKNOWN_STATUS", id, `status ${String(status)} is not a governed receiving order status`);
  }
  const idempotencyKey = text(data.idempotencyKey);
  if (idempotencyKey === null) return refuse("MISSING_REQUIRED_TEXT", id, "idempotencyKey is required");
  const createdBy = text(data.createdBy);
  if (createdBy === null) return refuse("MISSING_REQUIRED_TEXT", id, "createdBy is required");
  const number = text(data.receivingOrderNumber);
  if (number !== null && !/^RO-[0-9]{4}-[0-9]{6,}$/.test(number)) {
    return refuse("MISSING_REQUIRED_TEXT", id, "receivingOrderNumber is present but malformed");
  }

  const rawLines = Array.isArray(data.lines) ? data.lines : null;
  if (rawLines === null || rawLines.length === 0) {
    return refuse("INVALID_RECEIPT_LINES", id, "a receiving order records at least one line");
  }
  const authority = options.partIdAuthority ?? canonicalPartIdAuthority;
  const seen = new Set<string>();
  const lines: ReceivingLineRow[] = [];
  for (const raw of rawLines) {
    if (!isObject(raw)) return refuse("INVALID_RECEIPT_LINES", id, "a receipt line is not an object");
    const lineId = text(raw.lineId);
    if (lineId === null) return refuse("INVALID_RECEIPT_LINES", id, "a receipt line has no lineId");
    // The same line twice in one receipt makes the intended quantity ambiguous, and collapsing them
    // would pick an answer nobody asked for.
    if (seen.has(lineId)) return refuse("INVALID_RECEIPT_LINES", id, `duplicate lineId ${lineId}`);
    seen.add(lineId);
    const linePart = partId(raw.partId, id, authority, `receiving_order_lines.part_id (${lineId})`);
    if (linePart.ok !== true) return linePart;
    const trackingMode = text(raw.trackingMode);
    if (trackingMode === null || !(OPS_TRACKING_MODES as readonly string[]).includes(trackingMode)) {
      return refuse("UNSUPPORTED_TRACKING_MODE", id, `line ${lineId} trackingMode ${String(trackingMode)} is not NONE or SERIAL`);
    }
    if (!isInt(raw.receivedQuantity) || (raw.receivedQuantity as number) <= 0) {
      return refuse("INVALID_QUANTITY", id, `line ${lineId} receivedQuantity must be a whole number greater than zero`);
    }
    if (!isInt(raw.expectedQuantity) || (raw.expectedQuantity as number) < 0) {
      return refuse("INVALID_QUANTITY", id, `line ${lineId} expectedQuantity must be a whole number >= 0`);
    }
    const serials = serialSet(raw.serialNumbers, raw.receivedQuantity as number, trackingMode as OpsTrackingMode, id);
    if (serials.ok !== true) return serials;
    lines.push(Object.freeze({
      lineId,
      partId: linePart.partId,
      trackingMode: trackingMode as OpsTrackingMode,
      expectedQuantity: raw.expectedQuantity as number,
      receivedQuantity: raw.receivedQuantity as number,
      serialNumbers: serials.serials,
    }));
  }

  return {
    ok: true,
    row: Object.freeze({
      id,
      operatingCompanyKey: company.key,
      sourceKind: sourceKind as OpsReceivingSourceKind,
      purchaseOrderId,
      reorderRequestId: legacy ? purchaseOrderId : null,
      receivingLocationType: location.type,
      receivingLocationId: location.id,
      status: status as OpsReceivingOrderStatus,
      receivingOrderNumber: number,
      idempotencyKey,
      createdBy,
      lines: Object.freeze(lines),
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// Transfer Order — the directional pair, and the retirement of the legacy warehouse scalars
// ---------------------------------------------------------------------------------------------

export interface TransferOrderRow {
  readonly id: string;
  /** BOTH. Never a scalar owner, never one completed from the other. */
  readonly sourceOperatingCompanyKey: string;
  readonly destinationOperatingCompanyKey: string;
  readonly partId: string;
  readonly trackingMode: OpsTrackingMode;
  readonly quantity: number;
  readonly originLocationType: OpsLocationType;
  readonly originLocationId: string;
  readonly destinationLocationType: OpsLocationType;
  readonly destinationLocationId: string;
  readonly serialNumbers: readonly string[];
  readonly status: OpsTransferOrderStatus;
  readonly transferOrderNumber: string | null;
  readonly idempotencyKey: string;
  readonly createdBy: string;
  /**
   * Whether this record ALSO carried the legacy fromWarehouseId/toWarehouseId scalars that this
   * mapping retires. Reported, not stored: the target schema has no column for them, and an import
   * run needs to be able to say how many records it dropped a duplicate representation from without
   * that being invisible.
   */
  readonly legacyWarehouseScalarsDropped: boolean;
}

/**
 * A legacy `transfer_orders` document -> the transfer order row.
 *
 * TWO governance facts are enforced here that nothing downstream can recover if they are lost:
 *
 *   1. THE PAIR IS ATOMIC. `sourceOperatingCompanyId` and `destinationOperatingCompanyId` are both
 *      required. A record carrying one is REFUSED with MISSING_PARTICIPATING_COMPANY rather than
 *      completed from the other — the stored deserializer already refuses a half-pair, and
 *      synthesizing the missing half would assert a participation nobody recorded. Equal keys are
 *      fine and are NOT collapsed into a scalar: a same-company transfer states the same key twice.
 *
 *   2. THE LEGACY SCALARS ARE RECONCILED, THEN DROPPED. `fromWarehouseId`/`toWarehouseId` exist on
 *      the WAREHOUSE->WAREHOUSE subset only. Where present they MUST equal the typed endpoints'
 *      location ids AND both endpoints must be WAREHOUSE; anything else is
 *      LEGACY_ENDPOINT_DISAGREEMENT. The live census measured zero disagreements across 23 such
 *      records — this re-proves it per record at import time, which is the difference between a
 *      finding and a guarantee, and only then discards them.
 */
export function mapLegacyTransferOrder(
  documentId: unknown,
  data: unknown,
  options: MappingOptions = {},
): MappingResult<TransferOrderRow> {
  const id = text(documentId);
  if (!isObject(data)) return refuse("INVALID_SOURCE_ROW", id, "source document is not an object");
  if (id === null) return refuse("MISSING_DOCUMENT_ID", null, "transfer order has no document id");

  // ---- 1. THE DIRECTIONAL PAIR ----
  const src = companyKey(
    data.sourceOperatingCompanyId, id, "sourceOperatingCompanyId", "MISSING_PARTICIPATING_COMPANY",
  );
  if (src.ok !== true) return src;
  const dst = companyKey(
    data.destinationOperatingCompanyId, id, "destinationOperatingCompanyId", "MISSING_PARTICIPATING_COMPANY",
  );
  if (dst.ok !== true) return dst;
  // A scalar owner on a PARTICIPATING_COMPANIES record is a contradiction, not a convenience: it
  // would name one company responsible for a movement the pair says two companies are party to.
  if (data.operatingCompanyId !== undefined) {
    return refuse(
      "MISSING_PARTICIPATING_COMPANY",
      id,
      "a transfer order carries a participating pair, never a scalar operatingCompanyId",
    );
  }

  const part = partId(data.partId, id, options.partIdAuthority ?? canonicalPartIdAuthority, "transfer_orders.part_id");
  if (part.ok !== true) return part;

  const trackingMode = text(data.trackingMode);
  if (trackingMode === null || !(OPS_TRACKING_MODES as readonly string[]).includes(trackingMode)) {
    return refuse("UNSUPPORTED_TRACKING_MODE", id, `trackingMode ${String(trackingMode)} is not NONE or SERIAL`);
  }
  if (!isInt(data.quantity) || (data.quantity as number) <= 0) {
    return refuse("INVALID_QUANTITY", id, "quantity must be a whole number greater than zero");
  }

  const origin = locationRef(data.origin, id, "origin");
  if (origin.ok !== true) return origin;
  const destination = locationRef(data.destination, id, "destination");
  if (destination.ok !== true) return destination;
  if (origin.type === destination.type && origin.id === destination.id) {
    return refuse("TRANSFER_ENDPOINTS_IDENTICAL", id, "origin and destination are the same place");
  }

  // ---- 2. RECONCILE THE LEGACY SCALARS, THEN DROP THEM ----
  const from = text(data.fromWarehouseId);
  const to = text(data.toWarehouseId);
  if ((from === null) !== (to === null)) {
    // Half a legacy pair proves nothing and cannot be reconciled against both endpoints. Refused
    // rather than partly checked.
    return refuse("LEGACY_ENDPOINT_DISAGREEMENT", id, "fromWarehouseId and toWarehouseId are present together or not at all");
  }
  const legacyWarehouseScalarsDropped = from !== null;
  if (from !== null && to !== null) {
    if (origin.type !== "WAREHOUSE" || destination.type !== "WAREHOUSE") {
      return refuse(
        "LEGACY_ENDPOINT_DISAGREEMENT",
        id,
        "legacy warehouse scalars are present on a transfer whose typed endpoints are not both WAREHOUSE",
      );
    }
    if (from !== origin.id || to !== destination.id) {
      return refuse(
        "LEGACY_ENDPOINT_DISAGREEMENT",
        id,
        `legacy scalars (${from} -> ${to}) disagree with typed endpoints (${origin.id} -> ${destination.id})`,
      );
    }
  }

  const serials = serialSet(data.serialNumbers, data.quantity as number, trackingMode as OpsTrackingMode, id);
  if (serials.ok !== true) return serials;

  const status = text(data.status);
  if (status === null || !(OPS_TRANSFER_ORDER_STATUSES as readonly string[]).includes(status)) {
    return refuse("UNKNOWN_STATUS", id, `status ${String(status)} is not a governed transfer order status`);
  }
  const idempotencyKey = text(data.idempotencyKey);
  if (idempotencyKey === null) return refuse("MISSING_REQUIRED_TEXT", id, "idempotencyKey is required");
  const createdBy = text(data.createdBy);
  if (createdBy === null) return refuse("MISSING_REQUIRED_TEXT", id, "createdBy is required");
  const number = text(data.transferOrderNumber);
  if (number !== null && !/^TO-[0-9]{4}-[0-9]{6,}$/.test(number)) {
    return refuse("MISSING_REQUIRED_TEXT", id, "transferOrderNumber is present but malformed");
  }

  return {
    ok: true,
    row: Object.freeze({
      id,
      sourceOperatingCompanyKey: src.key,
      destinationOperatingCompanyKey: dst.key,
      partId: part.partId,
      trackingMode: trackingMode as OpsTrackingMode,
      quantity: data.quantity as number,
      originLocationType: origin.type,
      originLocationId: origin.id,
      destinationLocationType: destination.type,
      destinationLocationId: destination.id,
      serialNumbers: serials.serials,
      status: status as OpsTransferOrderStatus,
      transferOrderNumber: number,
      idempotencyKey,
      createdBy,
      legacyWarehouseScalarsDropped,
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------------------------

export interface TransferMigrationReconciliation {
  readonly total: number;
  readonly mapped: number;
  readonly refused: number;
  readonly crossCompany: number;
  readonly sameCompany: number;
  readonly legacyScalarsReconciledAndDropped: number;
  /** Refusal counts by code, so a run can be accounted for line by line rather than in aggregate. */
  readonly refusalsByCode: Readonly<Record<string, number>>;
}

/**
 * Account for a transfer-order import run.
 *
 * EVERY source record lands in exactly one bucket -- `mapped + refused === total` -- which is the
 * property that makes this a reconciliation rather than a summary. A run that silently dropped a
 * record would break that identity, and the caller checking it is what turns "the import looked
 * fine" into a statement with evidence behind it.
 *
 * The cross-company split is computed from the mapped rows' own key pair, the same comparison
 * migration 008's generated column makes, so the pre-import expectation and the post-import count
 * are the same question asked twice rather than two different questions.
 */
export function reconcileTransferOrderMigration(
  results: readonly MappingResult<TransferOrderRow>[],
): TransferMigrationReconciliation {
  let crossCompany = 0;
  let sameCompany = 0;
  let legacyScalars = 0;
  let mapped = 0;
  let refused = 0;
  const refusalsByCode: Record<string, number> = {};
  for (const result of results ?? []) {
    if (result?.ok === true) {
      mapped += 1;
      if (result.row.sourceOperatingCompanyKey !== result.row.destinationOperatingCompanyKey) crossCompany += 1;
      else sameCompany += 1;
      if (result.row.legacyWarehouseScalarsDropped) legacyScalars += 1;
    } else {
      refused += 1;
      const code = result?.code ?? "INVALID_SOURCE_ROW";
      refusalsByCode[code] = (refusalsByCode[code] ?? 0) + 1;
    }
  }
  return Object.freeze({
    total: mapped + refused,
    mapped,
    refused,
    crossCompany,
    sameCompany,
    legacyScalarsReconciledAndDropped: legacyScalars,
    refusalsByCode: Object.freeze(refusalsByCode),
  });
}
