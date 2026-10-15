"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROUNDING_POLICIES = exports.UNIT_CODES = exports.VALIDATION_ERROR_CODES = exports.OEM_STATUSES = exports.MANUFACTURER_STATUSES = exports.RELATIONSHIP_TYPES = exports.ALIAS_STATUSES = exports.ALIAS_TYPES = exports.STOCKING_CLASSES = exports.CONTROL_TYPES = exports.PART_STATUSES = void 0;
// ---------------------------------------------------------------------------
// Enums (exact accepted names: ADR-008 / part-master spec §2/§4/§5/§6)
// ---------------------------------------------------------------------------
exports.PART_STATUSES = ["DRAFT", "ACTIVE", "INACTIVE", "SUPERSEDED", "DISCONTINUED"];
exports.CONTROL_TYPES = ["STANDARD", "SERIALIZED", "LOT", "SERIALIZED_LOT"];
exports.STOCKING_CLASSES = ["STOCKED", "NON_STOCK", "SERVICE", "KIT"];
// The ten accepted alias types (spec §2).
exports.ALIAS_TYPES = [
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
];
exports.ALIAS_STATUSES = ["ACTIVE", "INACTIVE"];
exports.RELATIONSHIP_TYPES = ["SUPERSEDED_BY", "SUBSTITUTE", "KIT_COMPONENT"];
exports.MANUFACTURER_STATUSES = ["ACTIVE", "INACTIVE"];
exports.OEM_STATUSES = ["OEM", "AFTERMARKET", "UNKNOWN"];
// ---------------------------------------------------------------------------
// Validation result model -- mirrors the PR 0.1 detector's valid:true/false
// convention: pure, non-throwing, structured codes, deterministic order.
// ---------------------------------------------------------------------------
exports.VALIDATION_ERROR_CODES = [
    "REQUIRED",
    "INVALID_FORMAT",
    "OUT_OF_RANGE",
    "INVALID_ENUM",
    "CONFLICTING_FIELDS",
    "INVALID_COMBINATION",
    "INVALID_DATE_RANGE",
    "PRECISION_EXCEEDED",
];
// ---------------------------------------------------------------------------
// Unit-of-measure value objects (pure; conversion math in units.ts).
// Quantities are DECIMAL STRINGS (never floats) validated to per-unit
// precision; conversion factors are positive integer ratios.
// ---------------------------------------------------------------------------
exports.UNIT_CODES = ["EACH", "KIT", "BOTTLE", "TUBE", "BOX", "CASE", "FOOT", "ROLL", "GALLON", "OUNCE", "POUND"];
exports.ROUNDING_POLICIES = ["HALF_UP", "REJECT_INEXACT"];
//# sourceMappingURL=types.js.map