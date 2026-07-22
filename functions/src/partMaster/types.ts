// INV-1 Phase 1, PR 1.1 -- Part Master pure domain foundation (ADR-008
// Accepted; Decision #40). PURE: no firebase, no persistence, no I/O, no
// wall clock, no randomness. This module defines contracts only; the
// normalized collections (parts/part_aliases/part_supplier_items/
// part_relationships/manufacturers) are LATER gated PRs -- nothing here
// names a Firestore path or document.
//
// Authority boundary (ADR-008 / spec field-authority matrix): the Part core
// carries DESCRIPTIVE identity only. On-hand/reserved/available (ledger),
// supplier cost/terms (part_supplier_items), Work Order usage, analytics
// outputs, and AI recommendations are other domains' authority and are
// deliberately unrepresentable here. Part ≠ Equipment (ADR-006 boundary).

// ---------------------------------------------------------------------------
// Branded identifiers -- immutable value semantics; construct only via the
// parse* functions in validation.ts (no hidden generation, no randomness).
// ---------------------------------------------------------------------------
export type PartId = string & { readonly __brand: "PartId" };
export type InternalPartNumber = string & { readonly __brand: "InternalPartNumber" };
export type ManufacturerId = string & { readonly __brand: "ManufacturerId" };
export type PartAliasId = string & { readonly __brand: "PartAliasId" };
export type SupplierItemId = string & { readonly __brand: "SupplierItemId" };
export type PartRelationshipId = string & { readonly __brand: "PartRelationshipId" };

// ---------------------------------------------------------------------------
// Enums (exact accepted names: ADR-008 / part-master spec §2/§4/§5/§6)
// ---------------------------------------------------------------------------
export const PART_STATUSES = ["DRAFT", "ACTIVE", "INACTIVE", "SUPERSEDED", "DISCONTINUED"] as const;
export type PartStatus = (typeof PART_STATUSES)[number];

export const CONTROL_TYPES = ["STANDARD", "SERIALIZED", "LOT", "SERIALIZED_LOT"] as const;
export type ControlType = (typeof CONTROL_TYPES)[number];

export const STOCKING_CLASSES = ["STOCKED", "NON_STOCK", "SERVICE", "KIT"] as const;
export type StockingClass = (typeof STOCKING_CLASSES)[number];

// The ten accepted alias types (spec §2).
export const ALIAS_TYPES = [
  "INTERNAL_PN",
  "MANUFACTURER_PN",
  "SUPPLIER_SKU",
  "UPC",
  "EAN",
  "GTIN",
  "LEGACY",
  "CUSTOMER_REF",
  "VENDOR_REF",
  "BARCODE_OTHER",
] as const;
export type AliasType = (typeof ALIAS_TYPES)[number];

export const ALIAS_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type AliasStatus = (typeof ALIAS_STATUSES)[number];

export const RELATIONSHIP_TYPES = ["SUPERSEDED_BY", "SUBSTITUTE", "KIT_COMPONENT"] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export const MANUFACTURER_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type ManufacturerStatus = (typeof MANUFACTURER_STATUSES)[number];

export const OEM_STATUSES = ["OEM", "AFTERMARKET", "UNKNOWN"] as const;
export type OemStatus = (typeof OEM_STATUSES)[number];

// ---------------------------------------------------------------------------
// Validation result model -- mirrors the PR 0.1 detector's valid:true/false
// convention: pure, non-throwing, structured codes, deterministic order.
// ---------------------------------------------------------------------------
export const VALIDATION_ERROR_CODES = [
  "REQUIRED",
  "INVALID_FORMAT",
  "OUT_OF_RANGE",
  "INVALID_ENUM",
  "CONFLICTING_FIELDS",
  "INVALID_COMBINATION",
  "INVALID_DATE_RANGE",
  "PRECISION_EXCEEDED",
] as const;
export type ValidationErrorCode = (typeof VALIDATION_ERROR_CODES)[number];

export interface ValidationIssue {
  readonly code: ValidationErrorCode;
  readonly path: string; // field path, e.g. "internalPartNumber"
  readonly message: string;
}

export type Result<T> =
  | { readonly valid: true; readonly value: T }
  | { readonly valid: false; readonly errors: readonly ValidationIssue[] };

// ---------------------------------------------------------------------------
// Part core (descriptive authority ONLY -- see header). Deliberately absent:
// onHand, reserved, available, supplierCost, purchasePrice, leadTime,
// reorderRecommendation, workOrderQuantityUsed, aiRecommendation, alias
// arrays, supplier arrays, tenant fields.
// ---------------------------------------------------------------------------
export interface PartFlags {
  readonly expiryTracked: boolean;
  readonly consumable: boolean;
  readonly returnableCore: boolean;
}

export interface Part {
  readonly partId: PartId;
  readonly internalPartNumber: InternalPartNumber;
  readonly name: string;
  readonly description?: string;
  readonly category?: string;
  readonly status: PartStatus;
  readonly stockingUnit: UnitCode;
  readonly controlType: ControlType;
  readonly stockingClass: StockingClass;
  readonly flags: PartFlags;
  readonly manufacturerId?: ManufacturerId; // primary manufacturer
  readonly manufacturerPartNumber?: string; // primary MPN (raw display value)
  readonly oemStatus?: OemStatus;
}

// ---------------------------------------------------------------------------
// Alias record (pure shape; the deterministic future storage key is derived
// by buildAliasKey() in normalization.ts -- storage-independent).
// ---------------------------------------------------------------------------
export interface PartAlias {
  readonly aliasType: AliasType;
  readonly rawValue: string; // original display value, preserved verbatim
  readonly normalizedValue: string; // output of the single normalization authority
  readonly partId: PartId;
  readonly status: AliasStatus;
  readonly source: string; // free-form source classification (e.g. "import", "manual")
  /** Required for MANUFACTURER_PN (per-manufacturer uniqueness scope); absent otherwise. */
  readonly manufacturerId?: ManufacturerId;
  readonly effectiveFrom?: string; // ISO date, optional per spec
  readonly effectiveTo?: string;
}

export interface Manufacturer {
  readonly manufacturerId: ManufacturerId;
  readonly name: string;
  readonly status: ManufacturerStatus;
}

export interface PartRelationship {
  readonly fromPartId: PartId;
  readonly toPartId: PartId;
  readonly relationshipType: RelationshipType;
  readonly status: "ACTIVE" | "INACTIVE";
  readonly reasonCode: string;
  readonly effectiveFrom?: string; // ISO date
  readonly effectiveTo?: string;
  /** KIT_COMPONENT only: component quantity in the component part's stocking unit. */
  readonly componentQuantity?: string; // decimal string, unit-precision validated
  readonly componentUnit?: UnitCode;
}

// ---------------------------------------------------------------------------
// Unit-of-measure value objects (pure; conversion math in units.ts).
// Quantities are DECIMAL STRINGS (never floats) validated to per-unit
// precision; conversion factors are positive integer ratios.
// ---------------------------------------------------------------------------
export const UNIT_CODES = ["EACH", "KIT", "BOTTLE", "TUBE", "BOX", "CASE", "FOOT", "ROLL", "GALLON", "OUNCE", "POUND"] as const;
export type UnitCode = (typeof UNIT_CODES)[number];

export interface UnitDefinition {
  readonly code: UnitCode;
  readonly label: string;
  /** decimal places allowed in quantities of this unit (0 = integer-only) */
  readonly precision: 0 | 1 | 2 | 3;
  readonly fractional: boolean; // false => integer-only
}

export interface ConversionFactor {
  /** stockingQty = purchaseQty * numerator / denominator (both positive integers) */
  readonly numerator: number;
  readonly denominator: number;
}

export const ROUNDING_POLICIES = ["HALF_UP", "REJECT_INEXACT"] as const;
export type RoundingPolicy = (typeof ROUNDING_POLICIES)[number];
